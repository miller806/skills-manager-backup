# admin context-path：统一到根 `/` 还是统一到 `/xxl-job-admin`

## 为什么会分成两派

- 2.x 官方镜像把 `/xxl-job-admin` **烤进镜像**，`PARAMS` 里不写也生效。
- 3.5.0 官方镜像默认 `context-path=/`，必须显式加参数才有前缀。

所以升级完一轮后，同一环境里常出现「有的 admin 在 `/`、有的在 `/xxl-job-admin`」。用户看到 URL 里还带 `xxl-job-admin` 时的正确回应是：**这是显式配置的前缀，不是升级残留**，然后让他二选一。

## 逐机查实际落在哪（不要看文档/记忆，看运行态）

```bash
# 参数里有没有 context-path（有的镜像用 PARAMS 传，有的走 compose 内联）
for c in $(sudo docker ps --format '{{.Names}}' | grep -i xxl-job-admin); do
  echo "[$c] $(sudo docker inspect $c --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -o 'context-path=[^ ]*')"
done
# 三条路径探测：200/302 的那条就是真实入口
for u in / /auth/login /xxl-job-admin/auth/login; do
  echo -n "$u -> "; curl -s -o /dev/null -w '%{http_code}\n' -m5 "http://127.0.0.1:8083$u"
done
```

判读：`/` 302 + `/auth/login` 200 + `/xxl-job-admin/auth/login` 404 ⇒ 根路径；反之 ⇒ 带前缀。

## 方案对比

| | 方案A：统一带 `/xxl-job-admin` | 方案B：统一到根 `/` |
|---|---|---|
| 改哪一端 | 每台 admin 的 `PARAMS`（要动含密码的字符串） | 每台 admin 的 `PARAMS`（同一风险）+ 全部执行器 `admin-addresses` |
| 执行器改动量 | 0（老配置原样可用） | 每个执行器都要去后缀并重启 |
| 入口形态 | `http://host:8083/xxl-job-admin/auth/login` | `http://host:8083/auth/login` |
| 适合 | 执行器不归你管 / 数量多 / 升级窗口内保注册通道 | 执行器自己维护、追求 URL 干净 |

**任选一种都行，但必须全场统一**；混着的话同一个执行器换台 admin 就得改地址。

## 切到根路径：两种部署形态

统一先备份（`.env` 与 compose 都备，带时间戳后缀 `bak3-<ts>`）。

```bash
# A. 参数在 .env 的一行 PARAMS 里（sed 只删这一个 token，别整行重写——密码段常以 & 结尾）
sed -i 's# --server.servlet.context-path=/xxl-job-admin##' .env
grep -o 'context-path=[^ ]*' .env || echo 'context-path 已移除'

# B. 参数内联在 compose 的 PARAMS: >- 多行块里
sed -i '/--server.servlet.context-path=\/xxl-job-admin/d' docker-compose.yml
grep -n 'context-path' docker-compose.yml || echo 'context-path 已移除'
```

改完**必须 recreate**（`up -d`）而不是 restart —— `docker restart` 不会重读 env/compose。

```bash
if command -v docker-compose >/dev/null; then docker-compose up -d; else docker compose up -d; fi
```

同机多容器时 `docker compose up -d <服务名>` 只重建目标服务，别把同 compose 里的 mysql 一起重启。

## 切完立刻验（三步都要过）

```bash
for u in / /auth/login /xxl-job-admin/auth/login; do
  echo -n "$u -> "; curl -s -o /dev/null -w '%{http_code}\n' -m5 "http://127.0.0.1:8083$u"; done
# 执行器新注册端点必须「有映射」（任意空 body 也会回 200/业务错误码，404 就是没挂上）
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:8083/api/registry
# 老执行器正在撞墙的证据：数字就是这几分钟掉线的注册次数
docker logs --since 3m xxl-job-admin 2>&1 | grep -c 'No mapping for POST /xxl-job-admin'
```

## ⚠️ 改 admin 路径 = 当场切断注册通道

老执行器仍打 `/xxl-job-admin/api/registry`，admin 挪到根路径后这个路径立刻 404，**注册与调度全部中断**（不是降级，是全断）。所以：

1. 先逐机列全所有执行器的 `admin-addresses`（**外部 config 和 jar 内 `BOOT-INF/classes/application-job.yml` 两处都查**）。
2. 执行器侧同步改（或与 admin 同窗口），`/xxl-job-admin` 后缀去掉。
3. 执行器由用户维护时，把「旧地址 → 新地址」逐条列给他（主机、jar/配置文件、原值、新值），并明确告知**在他改完之前注册是断的**。
4. PM2 管执行器：`pm2 restart` 不重读 json 里的 env，必须 `pm2 delete` + `pm2 start`。

## 主机名别名

`admin-addresses` 里常写 `ubs.xxl` / `udun3.xxl` / `ubs.sign` 这类别名，**每台机器的 `/etc/hosts` 各不相同**（同一别名在 A 机指 192.168.2.67、在 B 机指 172.30.163.163，甚至一个别名在两台 admin IP 间轮询）。按域名猜机器必错，改地址前先 `getent hosts <别名>` 在**目标执行器那台**上确认。
