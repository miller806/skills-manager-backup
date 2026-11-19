---
name: tabby-web-selfhost
description: Use when self-hosting or fixing Tabby Web in Docker.
---

# Tabby Web 自建

Tabby Web 是 Eugeny/tabby 的浏览器版服务端。镜像 `ghcr.io/eugeny/tabby-web:latest`
+ `mariadb:10.7.1`，默认 9090:80。部署后能打开界面 ≠ 能用，两个前置条件必须都满足。

## 真正能用的三个条件

1. **app-dist 版本包层级正确**（见坑 1）
2. **有一个能登录的账号**：内网用 Django admin 本地账号即可，**不需要 OAuth**（见坑 0）
3. **连接网关部署** → `POST /api/1/gateways/choose` 不能是 503

## 验证顺序（照这个顺序查，能最快定位）

```bash
curl -s localhost:9090/api/1/versions            # plugins 必须是 tabby-* 而不是 tmpXXXX
curl -s -b /tmp/cj localhost:9090/api/1/user     # 200 且 is_pro:true（先用 admin 登录拿 cookie）
curl -s -XPOST localhost:9090/api/1/gateways/choose -d '{}' -H 'Content-Type: application/json'
                                                 # 期望 200，不是 503 no_gateways
```

`/api/1/auth/providers` 返回 `[]` **不是阻塞项**——那只影响 SPA 登录页，admin 登录照常可用。
真正的端到端验证是在浏览器里手搓网关 WebSocket 握手（见「端到端验证」）。

浏览器端必须实测 `/app`：`/terminal` 单独打开永远白屏（它只作为 iframe 被 `/app` 注入 connector），
`/app` 正常时 iframe 内 `app-root` 的 `display` 为 `flex`、能读到 "Profiles and connections" 和版本号。

## 坑 0：内网别配 OAuth，直接建本地账号

OAuth 回调必须是 `https://<域名>/complete/<provider>/`，内网 `http://IP` 走不通。
直接建一个 Django 本地账号（`is_superuser` + `force_pro`），入口是 `/admin/login/`：

```bash
cat > /tmp/mkuser.py <<'PYEOF'
from tabby.app.models import User
u, _ = User.objects.get_or_create(username='miller', defaults={'email': 'miller@local'})
u.set_password('自定密码')
u.is_staff = u.is_superuser = u.force_pro = True
u.save()
PYEOF
docker cp /tmp/mkuser.py tabby-web:/tmp/mkuser.py
docker exec tabby-web sh -c 'cd /app && /venv/*/bin/python ./manage.py shell < /tmp/mkuser.py'
```

登录后 `/api/1/user` 返回 200（含 `is_pro:true`、`custom_connection_gateway`），`/app` 正常可用。
注意 `/login` 是 SPA 路由登录不了的，只能走 `/admin/login/`。

## 坑 1：add_version 多套一层临时目录（必踩）

`add_version` 用 `fs.put(str(tempdir), target, recursive=True)`，本地文件系统下把 tempdir
本身也拷进去，得到 `app-dist/<ver>/tmpXXXX/tabby-*/`。此时 `/api/1/versions` 的 `plugins`
返回 `["tmpXXXX"]`，前端拼错路径 → `/app` 白屏、`/terminal` 卡在 Tabby logo（进度条 100% 不动）。

```bash
V=~/docker/volume/tabby-web/app-dist/<ver>
for d in "$V"/tmp*/*; do mv "$d" "$V"/; done && rmdir "$V"/tmp*
docker compose restart tabby    # versions 结果有缓存，不重启不生效
```

## 坑 2：nightly 版本前端是坏的

`tabby-web-container` 的 `dist-tags.latest` 指向 nightly（如 `1.0.231-nightly.0`），别照抄。
nightly 的 Angular 包未经 Linker 处理，控制台报：

```
Error: The injectable 'PlatformLocation' needs to be compiled using the JIT compiler,
but '@angular/compiler' is not available.
→ 随后 Attempted to require @angular/common / window.bootstrapTabby is not a function
```

用 stable 版。查最新 stable：`curl -s https://registry.npmjs.org/tabby-web-container | jq '.versions|keys'`
过滤掉带 `-` 的（当前最新 stable 1.0.163）。

## 坑 3：终端需要独立的连接网关

`/terminal` 不是独立页面，必须由 `/app` 以 iframe 嵌入，通过
`postMessage('request-connector')` / `'connector-ready'` 握手注入 `window.__connector__`，
再按 `/app-dist/<ver>/tabby-web-container/dist/{preload,bundle}.js` 加载插件。真正 TCP 连接走 WebSocket 网关。

网关未部署 → `app_gateway` 表 0 行 → `/api/1/gateways/choose` 503，用户看到的现象是
"点连接没反应 / All connection gateways are unavailable"。

```yaml
  gateway:
    image: ghcr.io/eugeny/tabby-connection-gateway:v0.3.0   # 只有 amd64
    platform: linux/amd64              # arm64 宿主必须写，靠 Rosetta，实测可用
    command: ["--token-auth", "--host", "0.0.0.0", "--port", "9000"]
    environment:
      TABBY_AUTH_TOKEN: "${TCG_AUTH_TOKEN}"
    ports:
      - "9000:9000"
```

gateway 是容器：**`127.0.0.1` 指容器自己**，连接目标必须填局域网 IP，否则 `connection-failed Errno 111`。
`docker compose up -d` 在 macOS 会被误判为长驻进程而拒绝前台执行 —— 用 `docker compose create <svc>`
+ `docker compose start <svc>` 绕过。

## 端到端验证：浏览器里手搓网关握手

curl 测不出网关是否真通（是 WebSocket + 二进制 TCP），在浏览器 console 里发：

```js
const ws = new WebSocket('ws://<ip>:9000');
// onmessage: {_:'hello',auth_required:true} → 回 {_: 'hello', version:1, auth_token: '<TOKEN>'}
//            {_:'ready'}                  → 发 {_: 'connect', host:'192.168.2.90', port:22}
//            {_:'connected'}              → 下一帧就是 SSH banner（Blob）
```

期望序列：`OPEN → hello → ready → connected → TCP_ESTABLISHED → BANNER`。
错误 token 会在 hello 阶段返回 `{_:'error', code:'incorrect-auth-token'}`，可用作鉴权单测。
容器内直接测 TCP 可达性：`docker exec tabby-gateway python -c "import socket;socket.create_connection(('IP',22),3)"`。

自建网关**不要**配 admin 端口：admin 只用于官方托管网关的 `authorize-client` 流程，
自建走 `--token-auth`，前端直接用 `TABBY_AUTH_TOKEN` 握手。网关地址 token 填在 Tabby Web 设置里，
或写 `app_user.custom_connection_gateway` / `custom_connection_gateway_token` 字段。

安全提醒：网关是 "任意 host:port 的 TCP 隧道"，暴露到公网前必须换强 token + 反代鉴权，
否则等于开放内网扫描入口。

## 坑 4：杂项

- healthcheck 用 `http://127.0.0.1:80`，容器内 `localhost` 解析到 `::1` 而 gunicorn 只监听 IPv4 → 永远 unhealthy。
- `/login` 是 SPA 路由，curl 拿到的是 index.html；真登录在 `/api/1/auth/social/login/<provider>`。
- OAuth 回调必须是 `https://<域名>/complete/<provider>/`，GitHub/Google 不接受 http+IP。
  **局域网内不需要域名/证书/反代**（9090 与 9000 都映射到 0.0.0.0，其余机器直连 IP 即可），
  只有要公网访问时才需域名 + 反代（反代要给 WebSocket 透传 `Upgrade`/`Connection`）。
- `DEBUG = bool(os.getenv("DEBUG", False))` —— 字符串 "False" 是真值，别指望 DEBUG=False 关掉调试。

## 坑 5：客户端配置同步强制 HTTPS（重要）

后端 `TokenMiddleware` 只看 `Authorization: Bearer <config_sync_token>`，**不检查协议**，
所以 `curl http://.../api/1/configs` 能通。但桌面客户端里硬校验：

```
// tabby-settings/src/services/configSync.service.ts
if (!/^https:\/\//i.test(host)) throw new Error(`Config sync host must use HTTPS (got: ${host})`)
```

注释说明原因：远端 YAML 会被合并进本地配置，`profiles[].command/env` 会执行，明文 HTTP 可 MITM → RCE。
**别去改客户端绕过，给一个 TLS 入口**。最省事：同 compose 网络里加个 nginx:alpine 反代。

```yaml
# docker-compose.tls.yml（overlay）
  tabby-tls:
    image: nginx:1.27-alpine
    ports: ["8443:443"]        # 不用 443：macOS 需 root
    volumes:
      - ./certs:/etc/nginx/certs:ro
      - ./nginx-tls.conf:/etc/nginx/conf.d/default.conf:ro
      - ./nginx-upgrade-map.conf:/etc/nginx/conf.d/00-upgrade-map.conf:ro
```

- 上游写 `server tabby:80;`（compose 默认网络按 service 名解析）
- **nginx 无内置 `$connection_upgrade`**：必须 `map $http_upgrade $connection_upgrade`，且 map 要在 `http{}` 层，
  所以单独挂成 `conf.d/00-upgrade-map.conf`（前缀 00- 保证先于 default.conf 加载），否则 `[emerg] unknown "connection_upgrade" variable`
- **自签证书必须两层：根 CA（`CA:TRUE`）+ 服务器证书（`CA:FALSE`）**，见坑 6。
  单张 `openssl req -x509` 生成的证书是 `CA:FALSE`，macOS 勉强能信任，**Windows 一定装不上**。
- Electron 用系统信任库，客户端必须把**根 CA**（不是服务器证书）装进信任库

客户端填写：`Sync host = https://<ip>:8443`，`Secret sync token = app_user.config_sync_token`（128 位 hex），
点圆点会走 `GET /api/1/user` 做连通性测试。

**同步覆盖范围**（用户必问，答错会误导备份策略）：同步的是整个 `config.yml` 去掉 `configSync` 段，
含 profiles/groups/plugins/defaults 与三个可排除项（hotkeys/appearance/vault），**不含**会话历史与本地文件。
详见 `references/config-sync-scope.md`。三条硬规则：

- **autoSync 只下载、不上传**：每 60s 轮询远端 `modified_at`，只在远端更新时 `download()`。
  本机新增连接**不会自动推送**，必须手动点 Upload。它不是双向实时同步。
- **无合并**：整份覆盖，最后上传的赢。多机同时改会互相丢改动。
- **开了 Vault 加密就没有逃生舱**：整份配置被塞进 `vault:` 字段，密码短语只存在客户端、
  服务器上没有 → 短语丢失等于备份报废。

传多份快照用「新建多个命名 config」，每份是独立条目，互不干扰。

**坑 5.1：绿勾 ≠ 已同步（最容易误判为成功）**

客户端 Config sync 页面的绿勾只代表 `testConnection()` 的 `GET /api/1/user` 通了；
下面的 Configs 列表出现只代表 `loadConfigs()` 的 `GET /api/1/configs` 通了。**两者都是 GET，一个字节都没上传。**

```ts
isEnabled () { return this.isAvailable() && !!host && !!token && !!configID }  // 三个都要
uploadAndSync (cfg) { ...; this.configSync.setConfig(cfg); await this.configSync.upload() }  // configID 只在这里写
```

`configID` 只能由用户点 **「Upload as a new config」**（或列表某行的 Upload/Replace）写入。
没绑定前 `isEnabled()=false` → 自动上传/自动下载全部静默不生效。**用户说「同步成功了」时先查这个。**

判定，二选一为准（别信界面提示）：

```bash
docker logs tabby-tls 2>&1 | grep -E "POST|PUT|PATCH" | grep api/1   # 空 = 从未上传
curl -s --cacert certs/tabby-ca.crt -H "Authorization: Bearer $TOK" \
  https://IP:8443/api/1/configs     # 看 content 是否 "{}"、modified_at 是否最新
```

界面真正完成绑定后才会出现 **「Sync automatically」开关**（模板里受 `hasMatchingRemoteConfig()` 控制）——
开关出现即 configID 已设。

⚠️ 客户端首次进入时会看到一个 `content="{}"` 的 `Unnamed config (日期)` 条目，那是旧的空壳，
**容易误认为已上传**；上传前先删掉，否则用户会对着空配置以为配好了。

**同步闭环验证**（客户端同样的调用方式）：`POST→GET→PATCH→GET→DELETE` 全通；
`PATCH` 会前移 `modified_at`，客户端靠它判断远端有新版本（auto sync 每分钳对比）。
注意 `/api/1/configs` **不带尾斜杠**（URLconf `^api/1/configs$`，带斜杠 404）。

## 坑 6：客户端 `TypeError: Failed to fetch` —— 先看服务端日志，别猜证书

**排查铁律：服务端访问日志没有该请求，就不是应用层问题**（不是 CORS、不是 token）。
`docker logs tabby-tls | grep api/1` 里只有浏览器请求、没有客户端请求 → 连接根本没到服务器。
两个高频原因，按此顺序查：

1. **客户端机器开着 HTTP 代理（Clash/V2Ray 等）**，`https_proxy=http://127.0.0.1:10808` 把内网 IP 的流量
   也劫走了。代理返回 `200 Connection established` 建立隧道后 TLS 卡死 → fetch 抛 `Failed to fetch`。
   Windows 上验证：`curl.exe -v -k https://IP:8443/` 输出里出现 `Uses proxy env variable https_proxy` 即中招。
   解法（任选）：`$env:https_proxy=""` 临时绕开；或 Clash 规则顶部加 `IP-CIDR,192.168.0.0/16,DIRECT`。
   **注意 Electron 读系统代理，装好证书但代理仍劫持照样连不上。**
2. **客户端没装根证书**（见坑 7）。区分方法：`curl.exe -v` 报 `SSL certificate problem: unable to get local issuer certificate`。

客户端**必须完全退出再重开**（不是关窗口）——Electron 只在启动时读信任库。

## 坑 7：证书链结构 + Windows 装根证书

`CA:FALSE` 的自签证书 `certutil -addstore -f Root` 会失败（macOS `security add-trusted-cert` 反而不报错，容易误判合格）。
必须生成 CA + 叶子：

```bash
# CA:TRUE，10 年
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -sha256 \
  -keyout certs/ca.key -out certs/tabby-ca.crt -config certs/ca.cnf   # v3_ca: basicConstraints=critical,CA:TRUE,pathlen:0
# 叶子：SAN 必含实际访问的 IP，否则客户端域名校验失败
openssl req -newkey rsa:2048 -nodes -sha256 -keyout certs/server.key -out certs/server.csr -config certs/leaf.cnf
openssl x509 -req -in certs/server.csr -CA certs/tabby-ca.crt -CAkey certs/ca.key -CAcreateserial \
  -days 3650 -sha256 -extfile certs/leaf.cnf -extensions v3_ext -out certs/server.crt
cat certs/server.crt certs/tabby-ca.crt > certs/fullchain.crt
openssl verify -CAfile certs/tabby-ca.crt certs/server.crt    # 必须 OK
```

- nginx 的 `ssl_certificate` 指向 **fullchain.crt**（叶子+CA），`/cert` 分发入口只给 **tabby-ca.crt**（根），私钥绝不外发
- **分发入口必须走纯 http 的另一个端口**：客户端装信任之前无法通过 https 下载证书，死循环。
  在同一个 nginx 加 `listen 8080` 的 server 块，只暴露证书，其余 403：
  ```nginx
  server {                      # 注意 location = / 用 root+try_files，
      listen 8080;              # location / 配 alias 指向具体文件会 500
      location = / {
          default_type application/x-x509-ca-cert;
          add_header Content-Disposition 'attachment; filename="tabby-ca.crt"' always;
          root /etc/nginx/certs;
          try_files /tabby-ca.crt =404;
      }
      location / { return 403; }
  }
  ```
  ⚠️ 新增端口要 `docker compose create` + `start` 重建容器，`restart` 不生效
  ⚠️ **别把证书塞进 tabby-web 的 `/app/public/` 让 gunicorn 发**：Django 只按白名单路由静态文件，
  `/app/public/certs/x.crt` 一律 404（拿到的是 6712 字节 404 页面，客户端 certutil 会报 `0x8007000d 数据无效`）。
  证书分发只能走 nginx 的独立 http 端口。
- Windows 侧：`curl.exe -o tabby-ca.crt http://IP:8080/` → `certutil -addstore -f Root tabby-ca.crt`（**必须管理员**）
  → `curl.exe -s https://IP:8443/api/1/user` 返回 JSON 即成功
- 换证书后**旧的已装信任全部失效**，每台客户端都要重装新 CA（`certs/old/` 留档）

## 拆除（下线整套服务）

用户说「停掉 tabby 容器、删掉、不用备份」＝容器 + 镜像 + compose 目录 + volume 目录 + 网络
五样一起清，别只 `down`。按顺序做：

```bash
# 1. 摸清归属（compose 项目名、工作目录、挂载来源），别靠猜目录名
docker inspect tabby-web --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}} {{index .Config.Labels "com.docker.compose.project.config_files"}}'
docker inspect tabby-web tabby-web-db --format '{{.Name}}: {{range .Mounts}}{{.Type}} {{.Source}}  {{end}}'

# 2. 带 overlay 一起 down，否则 tls/gateway 会留成孤儿
docker compose -f docker-compose.yml -f docker-compose.tls.yml down --remove-orphans

# 3. 删目录 + 镜像（目录先 du -sh 记一下大小，汇报要用）
rm -rf ~/docker/compose/tabby-web ~/docker/volume/tabby-web
docker rmi ghcr.io/eugeny/tabby-web:latest ghcr.io/eugeny/tabby-connection-gateway:v0.3.0 mariadb:10.7.1
```

**坑 8：`down` 报 `Network ... Resource is still in use` —— 是 caddy 占着**

caddy 的 compose 里把 `tabby-web_default` 声明成 `external: true` 并接进 `networks:`，
所以 tabby 的容器全删了这个网络仍有活跃端点，`docker network rm` 也删不掉。
`docker network inspect tabby-web_default --format '{{range .Containers}}{{.Name}} {{end}}'` 能看到是谁。
处理：先改 `compose/caddy/docker-compose.yml`（删掉该网络的 `networks:` 条目和 `external: true` 声明），
再 `docker network disconnect tabby-web_default caddy && docker network rm tabby-web_default`。
**改 compose 就够了，caddy 不用 recreate**——它已经接上 `caddy` 网络，删掉一个多余网络声明不影响运行容器，
只影响下次 recreate。同类教训见 `caddy-reverse-proxy` 技能。

**坑 9：下线前查 caddy 有没有 tabby 站点块**

`grep -rniE "tabby|:9090|:8443|:9000" compose/caddy/etc/` —— 有站点块要一起删再 reload。
空的 grep（exit 1）是正常结果，说明本来就直连端口没走反代。

收尾核查（三段都要绿）：
- 端口无监听：`for p in 9090 8443 9000 8080; do lsof -nP -iTCP:$p -sTCP:LISTEN; done`
- `docker ps -a` / `docker images` / `docker network ls` / 两个目录都不再有 tabby
- ⚠️ 提醒用户：客户端里配过的 `https://<ip>:8443` config sync 会失效，关掉即可，
  本地已下载的配置在客户端自己机器上、不受影响（见坑 5 的同步语义）。

## 排障姿态

`/terminal` 白屏时别猜，直接 CDP 抓 `Runtime.exceptionThrown`：

```python
cdp('Runtime.enable'); cdp('Log.enable')
goto_url('http://127.0.0.1:9090/app'); wait_for_load(); time.sleep(14)
for e in drain_events():
    if e.get('method') == 'Runtime.exceptionThrown':
        print(e['params']['exceptionDetails'].get('exception',{}).get('description','')[:400])
```

同时看 iframe 内部状态：`document.querySelector('iframe').contentDocument.querySelector('app-root')`
的 `display` 和 `innerHTML.length`，能立刻区分"没加载"和"加载了但崩了"。
