# 暴露面探测判据表

按「是什么服务 / 有没有鉴权 / 后端活没活」三问定性每个对外端口。以下命令都是在**内网可信机器**或**确认无代理的出口**上跑。

## 1. 指纹与鉴权

```bash
# 统一取 Server 头 + 状态码 + 体积（注意 SPA 假象，见下）
curl -sk -m 6 -o /dev/null -w "code=%{http_code} size=%{size_download} server=%header{server}\n" http://<ip>:<port>/

# 敏感路径批量点（先做 /randompath 基准）
for p in /.env /.git/config /doc.html /swagger-ui/index.html /v3/api-docs /actuator/env /actuator/heapdump; do
  printf "%-26s -> " "$p"; curl -sk -m 5 -o /dev/null -w "%{http_code} %{size_download}\n" "http://<ip>:<port>$p"
done
```

判据：

| 现象 | 结论 |
|---|---|
| 敏感路径 200 且 body 与 `/randompath` 基准**体积/首行相同** | SPA 兜底，无泄露 |
| 敏感路径 200 且 body 是配置/文档内容 | 真泄露 |
| 200 但 body 是「非法请求」类自定义文案 | 应用层拦了，记「弱防护」不如「无 WAF」重要 |
| 401 `{...Missing API key...}` | 网关层鉴权生效，正常 |
| 404 对 `/` 而对某 Host 200 | 路由靠 Host 区分，见第 3 节 |
| `000` / `Empty reply from server` | TCP 通、非 HTTP 或 TLS，换 `https://` 再试 |

`/doc.html`（Knife4j）返回 200 基本就等于接口清单全泄；`/v3/api-docs` 404 但 `/doc.html` 200 说明是 Knife4j 老版本静态页，仍然泄。

## 2. Jenkins

```bash
curl -s -m 8 http://<ip>:7876/whoAmI/api/json      # anonymous:true → 匿名身份可交互
curl -s -m 8 -o /dev/null -w "%{http_code}\n" http://<ip>:7876/view/All/api/json   # 403 = 匿名无 job 读权限（好）
curl -s -m 8 -D - -o /dev/null http://<ip>:7876/login | grep -i x-jenkins            # 版本号，用于匹配已知 CVE
```

`X-Jenkins: <ver>` + `Server: Jetty(...)` 就能查版本漏洞；匿名 `whoAmI` 200 本身不算洞，但配合公网可达就是稳定爆破面（Jenkins 账号 = 代码执行 = 整段内网）。

## 3. 网关路由（APISIX 等）

```bash
# 官方默认密钥，命中即未改过
K=edd1c9f034335f136f87ad84b625c8f1
curl -s -H "X-API-KEY: $K" http://<gw>:9180/apisix/admin/routes | \
  python3 -c "import sys,json;[print(r['value'].get('uri'),'|',r['value'].get('name'),'|',list((r['value'].get('plugins') or {}).keys())) for r in json.load(sys.stdin)['list']]"

# 逐条看 upstream 与 host 匹配，plugins 为空的路由 = 免鉴权直通内网
curl -s -H "X-API-KEY: $K" http://<gw>:9180/apisix/admin/routes | \
  python3 -c "import sys,json;[print(json.dumps(r['value'],ensure_ascii=False)) for r in json.load(sys.stdin)['list'] if not r['value'].get('plugins')]"

# 验证：伪造 Host 直打内网目标
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: <路由里出现的域名>" http://<gw>:9080/
```

- `plugins` 含 `key-auth` → 正常；为空、且 `host` 是内部域名 → 免鉴权后门，可删或补 `key-auth`+`limit-count`+`ip-restriction`。
- `/get`（httpbin 代理）这类 demo 路由会回显 `origin`，泄露内网出口 IP，必须下线。
- 附带确认 `docker ps` 里的端口绑定：`0.0.0.0:9180->9180` 需要改成 `127.0.0.1:9180->9180`。

## 4. 活没活

```bash
ping -c 2 -W 1 <内网ip>
nc -G 2 -z <内网ip> <port> && echo open || echo closed
```

ping 不通 + 端口全 closed = 映射已死，直接删；只有 TCP 通但应用空回包（`Empty reply`）说明后端进程在听但业务没起。
