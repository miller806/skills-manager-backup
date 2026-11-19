# checkpoint 存储（S3/OSS）鉴权与 endpoint 排障

用于：checkpoint 全线失败、`PermanentRedirect` / `InvalidAccessKeyId` / `AccessDenied`、
`Could not restore operator state backend`、改完 config.yaml 却不生效。

## 1. 错误码对照

| 现象 | 含义 | 下一步 |
|---|---|---|
| `403 InvalidAccessKeyId` | AK 本身不存在 / 已被删除 | 别回滚配置，回滚也没用；换 AK 或改指向 |
| `403 AccessDenied`（object 级） | AK 有效，无该 bucket 权限 | 换 bucket 或加授权 |
| `403 PermanentRedirect` | bucket 的 region 与 endpoint 不符 | body 里 `<Endpoint>` 就是正确 endpoint |
| `403 SecondLevelDomainForbidden` | path-style 访问 | 客户端必须用 virtual-hosted style（boto3: `Config(s3={'addressing_style':'virtual'})`） |
| `403 SignatureDoesNotMatch` | 自己手写签名时 StringToSign 拼错 | 见第 3 节 |
| `NoSuchBucket` | AK 有效但没有这个 bucket | 确认 bucket 名 + 区域 |

`PermanentRedirect` 和 `AccessDenied` 的 XML body 常常都带 `<Endpoint>`，一次请求即可定 region：

```
<Error><Code>PermanentRedirect</Code><Endpoint>flink-checkpoint-dev.oss-cn-hangzhou.aliyuncs.com</Endpoint>...
```

## 2. 探测脚本（服务级 ListBuckets，最干净的判据）

ListBuckets 与 bucket 无关，能直接区分「AK 死了」和「AK 活着但没权限」。

```python
import base64, hashlib, hmac, email.utils, urllib.request, urllib.error, re

def list_buckets(ak, sk, endpoint="oss-cn-hangzhou.aliyuncs.com"):
    date = email.utils.formatdate(usegmt=True)          # 必须是 RFC1123 GMT
    sts = f"GET\n\n\n{date}\n/"                        # 无 bucket，资源就是根
    sig = base64.b64encode(hmac.new(sk.encode(), sts.encode(), hashlib.sha1).digest()).decode()
    req = urllib.request.Request(f"https://{endpoint}/",
                                 headers={"Date": date, "Authorization": f"OSS {ak}:{sig}"})
    try:
        body = urllib.request.urlopen(req, timeout=10).read().decode(errors="replace")
        return "200 " + ",".join(re.findall(r"<Name>(.*?)</Name>", body))
    except urllib.error.HTTPError as e:
        code = re.search(r"<Code>(.*?)</Code>", e.read().decode(errors="replace"))
        return f"{e.code} {code.group(1) if code else '?'}"

print(list_buckets(AK_OLD, SK_OLD))
print(list_buckets(AK_NEW, SK_NEW))
```

输出解读：`200` 后面那串队列表就是这套 AK 能操作的 bucket 全集 —— 直接拿去比对
`state.checkpoints.dir` 里的 bucket 在不在里面，不用一个个 bucket 试。

探 bucket 真实 region（用任意一套有效 AK）：

```python
# 故意用错误 endpoint 发一次，读 body 里的 <Endpoint>
```

## 3. OSS V1 签名要点

```
StringToSign = VERB \n Content-MD5 \n Content-Type \n Date \n CanonicalizedResource
Authorization: OSS <AccessKeyId>:base64(hmac-sha1(SecretKey, StringToSign))
```

- `Date` 必须是 RFC1123 GMT（`email.utils.formatdate(usegmt=True)`），本地时间会 `RequestTimeTooSkewed`。
- Content-MD5 / Content-Type 为空时**对应行留空但换行不能少**。
- `CanonicalizedResource` 是 `/<bucket>/<key>`。
- **带 query 的请求（如 `ListObjects?prefix=&max-keys=`）要把 query 拼进 CanonicalizedResource**，否则稳定报 `SignatureDoesNotMatch`。只测「AK 是否有效」时别用带参数的 ListObjects，直接 ListBuckets 就没有这个坑。
- 用 boto3 就不用管这些；手写签名只在没有 CLI / SDK 的跳板上用。

## 4. 改配置后的验收

```
GET /jobmanager/config | 过滤 s3.          → 必须等于 conf/config.yaml 里的值（否则 JM 没重启）
GET /jobs/{J}/checkpoints                  → counts.failed 停止增长、latest.completed 有新的 external_path
TM 日志 grep 'PermanentRedirect|InvalidAccessKeyId|AccessDenied'  → 归零
```

`/jobmanager/config` 是运行时生效值，读文件永远证明不了生效 —— 交付时把「已写入」和「已生效」分开报。

## 5. 切 bucket 的代价必须在结论里写清

换 `state.checkpoints.dir` 到另一个 bucket = 历史 checkpoint 全部不可用。CDC 作业只能从空状态起：
源端的增量（上次 checkpoint 之后）不会自动补，需要确认源库 binlog 保留期内能否全量重跑，
或对 `UNIQUE KEY` 表用单表 repair 补一次。别只说「改一下路径就好」。
