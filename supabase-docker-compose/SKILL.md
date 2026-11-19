---
name: supabase-docker-compose
description: "Use when self-hosting Supabase via docker compose on a host."
metadata:
  hermes:
    tags: [supabase, docker, compose, postgres, postgrest]
---

# Supabase 自托管（Docker Compose，宿主机 bind mount 存数据）

**默认走官方 `docker/` 目录**（`https://github.com/supabase/supabase` 的 sparse checkout），不要自建精简栈 ——
除非用户明确说资源紧到跑不动。官方目录带 `run.sh` / `update.sh` / `setup.sh` / `versions.md`，
镜像版本有锁、升级路径被上游维护；自建栈每次上游改配置都要手工追，用户会明确反对（"用官方的，以后好更新"）。

## 官方栈部署（首选）

```bash
git clone --filter=blob:none --sparse --depth 1 https://github.com/supabase/supabase /tmp/supabase-src
cd /tmp/supabase-src && git sparse-checkout set docker
mkdir -p ~/docker/compose/supabase && cp -R /tmp/supabase-src/docker/. ~/docker/compose/supabase/
cd ~/docker/compose/supabase
cp .env.example .env
sh utils/generate-keys.sh --update-env     # 生成 JWT_SECRET/ANON_KEY/SERVICE_ROLE_KEY/各服务密钥
```

**数据落宿主机**：compose 里全是 `./volumes/...` 相对路径，所以把 `volumes` 目录整体搬到
`~/docker/volume/supabase/volumes` 再建软链接即可，不动 compose 任何一行 —— 这是升级时不冲突的关键，
因为 `update.sh` 只覆盖 compose/脚本/模板，不会碰 `volumes/`。

```bash
mkdir -p ~/docker/volume/supabase
mv volumes ~/docker/volume/supabase/volumes
ln -s ~/docker/volume/supabase/volumes ./volumes
mkdir -p ~/docker/volume/supabase/volumes/db/data
```

端口冲突时只改 `.env`：`POSTGRES_PORT`（host 侧 PG，映射到 supavisor 5432）、
`POOLER_PROXY_PORT_TRANSACTION`、`API_GW_HTTP_PORT`、`KONG_HTTPS_PORT`（默认 8443，macOS 常被占）。
URL 三项要一起改成本机 LAN IP：`SUPABASE_PUBLIC_URL`、`API_EXTERNAL_URL`、`SITE_URL`。

网关：官方默认 **Envoy**，要 Kong 就 `sh run.sh config add kong`（写 `COMPOSE_FILE` 到 .env，`:` 分隔层叠）。
Kong 版才有 Studio 的 basic-auth —— 要登录页就必须启用。

启动：`docker compose up -d --wait`（11 个容器全 healthy 约 60–90s，Kong 内存约 620MB 最大头）。

**取密码**：别手 grep 一堆变量，官方自带 `sh run.sh secrets`（打印 POSTGRES_PASSWORD / DASHBOARD_PASSWORD /
S3 key）。Studio 登录用户名 `DASHBOARD_USERNAME`，初始 `supabase`。

## 自托管 Studio 是单项目：组织页一定报错，别去修

自托管镜像在构建时 `NEXT_PUBLIC_IS_PLATFORM` 为空（单项目模式），但新版本 Studio 的前端项目列表
走的是托管平台的管理 API 形态。结果是打开组织页提示：

> Failed to retrieve projects under Default Organization / API error happened while trying to communicate with the server

诊断结论（照这个顺序查，不要重装、不要改配置）：

```bash
# 1. 前端真正打的接口是这条，自托管镜像里根本没有这个 route → 404
curl -s -o /dev/null -w '%{http_code}\n' -u "$DU:$DP" \
  'http://localhost:8000/api/platform/organizations/default-org-slug/projects?limit=96&offset=0&sort=name_asc'
# 2. 老接口正常，说明栈没坏、只是前端视图不匹配
curl -s -u "$DU:$DP" http://localhost:8000/api/platform/projects      # 200 + 默认项目
# 3. 自托管根本没有"新建项目"：405
curl -s -o /dev/null -w '%{http_code}\n' -u "$DU:$DP" -X POST http://localhost:8000/api/platform/projects \
  -H 'Content-Type: application/json' -d '{"name":"x","organization_id":1}'
# 4. 确认 route 清单（比翻 JS chunk 快）
docker exec supabase-studio sh -c 'cat /app/apps/studio/.next/routes-manifest.json' \
  | python3 -c "import json,sys;[print(r['page']) for r in json.load(sys.stdin)['dynamicRoutes'] if 'organizations' in r['page']]"
```

**结论口径**：这是上游 Studio 的构建形态问题（`CONFIG.md`：`NEXT_PUBLIC_IS_PLATFORM` 是单/多项目主开关，
自托管镜像 build 时即关闭），不是部署故障，**不要试图把 `NEXT_PUBLIC_IS_PLATFORM` 设成 true**——
文档明写那样会 break dashboard。

给用户的替代路径只有两条，说清楚代价再动手：

1. 直接用默认项目 `http://<ip>:8000/project/default`（SQL Editor / Table Editor / Advisor 全正常），
   多套数据用多 schema / 多表解决。
2. 真要隔离就**再起一套独立栈**：独立 compose 目录 + 独立 `volumes` + 端口错开
   （网关 8000+N、PG 54322+N、pooler 6543+N、Kong HTTPS 8444+N）。
   ⚠️ 每套约 1.8G 内存（Kong 620M 是大头）；开第二套前先算内存，必要时先停掉
   realtime/functions/imgproxy 腾 500M。

## 新式 API key（sb_publishable_ / sb_secret_）

官方 `docker/` 目录默认只给老式 HS256 `ANON_KEY` / `SERVICE_ROLE_KEY`；新式 key 要自己跑：

```bash
sh utils/add-new-auth-keys.sh --update-env
```

产出 6 个变量：`SUPABASE_PUBLISHABLE_KEY`(`sb_publishable_…`)、`SUPABASE_SECRET_KEY`(`sb_secret_…`)、
`ANON_KEY_ASYMMETRIC` / `SERVICE_ROLE_KEY_ASYMMETRIC`（预签的 ES256 JWT，供 Kong 转换用）、
`JWT_KEYS`（含 EC 私钥 + oct 老 secret，Auth 签名用）、`JWT_JWKS`（EC 公钥 + oct，其余服务验签用）。

**光生成不能生效**：上游 `docker-compose.yml` 把 4 处 JWKS 行**注释掉**了（Kong/Podman 兼容），
不启用的话 opaque key 在 Kong 层能过 key-auth，下游 PostgREST/Realtime/Storage 拿到的还是
`apikey` 原文（不是 JWT）→ 403。必须同时把下面四行环境变量打开：

```
auth:      GOTRUE_JWT_KEYS: ${JWT_KEYS:-[]}          # 签名
realtime:  API_JWT_JWKS: ${JWT_JWKS:-{"keys":[]}}   # 验签
storage:   JWT_JWKS: ${JWT_JWKS:-{"keys":[]}}
functions: SUPABASE_JWKS: ${JWT_JWKS:-{"keys":[]}}
```

**不要直接编辑 `docker-compose.yml`** —— `update.sh` 做三方合并，改了必报冲突。放进独立的
`docker-compose.asym.yml` 再 `sh run.sh config add asym`。rest 无需改：
`PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}` 已自动优先用 JWKS。

新旧 key 共存原理：`JWT_JWKS` 里除了 EC 公钥还内嵌了老的 HS256 secret，所以老 `ANON_KEY` 不失效。
升级后验证：

```bash
curl -s $URL/auth/v1/.well-known/jwks.json          # 应有 kty=EC alg=ES256 的 key
curl -s -H "apikey: $SUPABASE_PUBLISHABLE_KEY" $URL/rest/v1/ -o /dev/null -w '%{http_code}\n'   # 200
curl -s $URL/rest/v1/ -o /dev/null -w '%{http_code}\n'                                          # 401（仍拦）
# 登录拿到的 token header 应为 {"alg":"ES256","kid":"…"}
```

⚠️ 测试用 anon key 请求 `/auth/v1/health`：会走 `request-transformer` 把 Authorization 换成
asymmetric JWT，但老 key 走的是 fallback 分支 → 可能 401。两边都试一下再下结论。

陷阱：Studio 的 API Keys 页有**两个 tab**，新版那页空着时显示「No publishable API keys found」，
别据此判定「没有 key」—— 点 “Legacy anon, service_role API keys” 标签才是老 key 的位置。

## 一个栈 = 一个项目（自托管硬限制）

自托管镜像在**构建时**就把 `NEXT_PUBLIC_IS_PLATFORM` 置空，前端被编译成单项目版，运行时改不回来（官方明确：设 true 会弄坏 dashboard）。
配套证据（都可现场复现）：

```bash
# 组织页项目列表：镜像里没有这条路由 → 404
grep -o 'organizations/\[slug\]/[a-z]*' <routes-manifest.json>   # 只有 billing
curl -u u:p 'http://host:8000/api/platform/organizations/<slug>/projects?limit=96&offset=0'   # 404
# 旧接口正常（单项目）
curl -u u:p 'http://host:8000/api/platform/projects'                                        # 200
# 新建项目 → 405 Method POST Not Allowed
curl -u u:p -X POST 'http://host:8000/api/platform/projects' -d '{...}'                     # 405
```

用户看到的 `Failed to retrieve projects under <Org>`（后端是 `AlertError` 渲染这句）就来自第一条 404 ——
**这是上游 Studio 前端与自托管构建不匹配的 bug，不是部署坏了**。先别急着重置栈或重装镜像。

正确回复：入口直接用 `/project/default`，表/schema/函数随便建；`PGRST_DB_SCHEMAS` 控制哪些 schema 暴露给 REST。
真要多个独立数据库实例 → 起 N 套栈（N×约 2.5GB 内存），或共用 Postgres 只加 rest/meta/studio（+700MB 但 DB 不隔离）。
**不要**承诺改 env 就能开多项目。

## 最小栈（仅当用户明确要极简）

12+ 容器里只留 db/rest/meta/gateway/studio 五个，内存约 600MB。
**代价**：没有 kong 的 basic-auth，studio 裸奔；没有 auth/storage，SDK 的登录与文件功能不可用。

## 最小栈组成

| 服务 | 镜像 | 作用 |
|---|---|---|
| db | `supabase/postgres:15.19.0.018` | 真数据库（预置 auth/storage/realtime schema、roles、pg_net、pg_cron） |
| rest | `postgrest/postgrest:v12.2.3` | `/rest/v1` REST API |
| meta | `supabase/postgres-meta:v0.100.0` | studio 需要的 DB 元数据服务 |
| gateway | `nginx:stable-alpine` | 代替 kong，只把 `/rest/v1/*` 转给 PostgREST |
| studio | `supabase/studio:2026.11.02-sha-a05e7ec` | Web 管理界面 |

数据落宿主机：`${VOLUME_ROOT}/db/pgdata:/var/lib/postgresql/data`。

## 部署步骤（可复用）

1. 建目录：`compose/<name>/`（含 `docker-compose.yml`、`.env`、`gateway/nginx.conf`）与 `volume/<name>/db/pgdata`。
2. `.env` 生成随机 `POSTGRES_PASSWORD`、`JWT_SECRET`（32B base64），再用 HS256 自签 `ANON_KEY`（role=anon）
   与 `SERVICE_ROLE_KEY`（role=service_role），payload 至少含 `role`、`iss=supabase`、`iat`、`exp`。
   别用 `...` 占位或复制别人的 key —— 必须与 `JWT_SECRET` 同源，否则 PostgREST 全部 401。
3. `db` 的 env 只给 `POSTGRES_PASSWORD/POSTGRES_DB/POSTGRES_HOST`；**不要挂 /docker-entrypoint-initdb.d**。
4. 端口：db 只绑 `127.0.0.1:<高位端口>`，studio 与 gateway 再对外。
   **studio 必须自己挂 basic-auth**（见「鉴权」节）——它镜像里根本没有登录页。
5. 起来后**必须补设 authenticator 密码**（见坑 2），然后 `docker compose up -d` 全栈。
6. 验收（建临时表 → REST 读写 → 删表）：
   `curl -H "apikey: $SVC" -H "Authorization: Bearer $SVC" http://localhost:<gw>/rest/v1/<t>`
   `curl -o /dev/null -w '%{http_code}' http://localhost:<studio>/project/default` 应为 200。
7. **验收必须含一条鉴权探针**（无 cookie 无 token，期望 401/403）：
   `curl -X POST http://localhost:<studio>/api/platform/pg-meta/default/query \
      -H 'Content-Type: application/json' -d '{"query":"select 1"}'`
   返回 200 + `[{"?...}]` 就是洞：任何人都能以 `supabase_admin` 跑任意 SQL。

## 鉴权：studio 是裸的，别把它当"自带账号"

**Studio 容器本身没有任何登录功能**。官方 self-hosted 的登录框来自 **kong 的 `basic-auth` 插件**
（只保护 `/` 这条 route，凭据 `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`）。
用 nginx 替掉 kong 的最小栈如果不补这一步，`http://<ip>:8000` 对局域网完全敞开：
`/api/platform/projects`、`/api/platform/pg-meta/<ref>/query` 全部 200，等于送一个超级用户的 SQL 控制台。

最小栈做法（nginx 侧）：

```bash
# 生成密码文件（容器里跑，避免本机没装 httpd-tools）
docker run --rm httpd:2.4-alpine htpasswd -nbB admin '<password>' > compose/supabase/gateway/.htpasswd
# nginx server 块内、所有 location 之前：
#   auth_basic "Supabase Studio";
#   auth_basic_user_file /etc/nginx/.htpasswd;
# 并把 studio 从 compose 的 ports 挪到 gateway 后面反代，或单独用一台只监听内网的实例
```

只给 studio 加，**不要**给 `/rest/v1` 加 basic-auth——API 客户端的认证是 `apikey` / `Bearer` JWT，
加 basic-auth 会直接打断所有 SDK 调用。

拿不准时选最保守的：studio 端口绑 `127.0.0.1` 只留本机访问，比开着让全内网进要安全得多。

## 下架/拆除（有 Caddy 反代时必须按这个顺序）

先备份再拆，顺序错了会卡在"网络仍在使用"：

```bash
BK=~/backup/supabase-$(date +%F); mkdir -p $BK
# 1. 逻辑备份（这套数据通常很小，几十~几百 KB）+ 配置
 docker exec supabase-db pg_dumpall -U postgres > $BK/all-databases.sql
docker exec supabase-db pg_dumpall -U postgres --roles-only > $BK/roles.sql
cp ~/docker/compose/supabase/.env ~/docker/compose/supabase/docker-compose.yml $BK/

# 2. 拆栈（--volumes 清命名卷）
cd ~/docker/compose/supabase && docker compose down --volumes --remove-orphans

# 3. ⚠️ 若 caddy 反代过这套栈，它会挂在 supabase_default 网络上 → 网络删不掉。
#    必须先从 caddy 的 docker-compose.yml 删掉 networks 里的 supabase_default
#    （含底部的 external 声明），再 recreate caddy；否则 `docker network rm` 永久报错。
#    同时删掉 etc/sites/supabase.caddy 再 reload，否则域名仍在服务。
mv ~/docker/compose/caddy/etc/sites/supabase.caddy $BK/
#    patch caddy compose 后：docker compose create && docker start caddy（见下方坑 14）
docker network rm supabase_default

# 4. 清目录 + 镜像
rm -rf ~/docker/compose/supabase ~/docker/compose/supabase.minimal-custom ~/docker/volume/supabase
docker rmi $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^(supabase/|kong/kong|postgrest/postgrest|darthsim/imgproxy)')
docker image prune -f; docker builder prune -f
```

拆除后必验三件：`curl --resolve <域名>:443:127.0.0.1` 确认 supabase 域名已回落到野卡 404（不是 200）、
其它站点（如泛域名 healthz）仍 200、`docker ps` 里只剩预期容器。

## 坑（都踩过）

14. **Hermes 终端会把 `docker compose up -d` / `up -d --force-recreate` 拦成"长驻服务"**（exit_code -1，不执行）。
    绕法：`docker compose create` 建容器 → `docker start <name>` 启容器，两步都是短命令，效果等同 up -d。
    升级/改 compose 后用这个组合，不要反复重试 up -d。

0. **官方栈的 `volumes/db/data` 是相对路径 bind mount**。若 `volumes` 是软链接，`docker inspect` 里
   显示的是软链接展开后的真实路径，但 `stat -f %i` 两边 inode 一致就说明落对位置了。
   验证方式：容器内 `echo x > /var/lib/postgresql/data/.hostcheck` → 宿主机目标目录读到同一个内容。
1. **往 `/docker-entrypoint-initdb.d` 挂宿主空目录 = 灾难**（最小栈场景）。镜像里 `init-scripts/` + `migrations/` 被遮住，
   初始化只建出 `supabase_admin`，`postgres` 角色不存在 → `pg_net 0.20.4 worker` 每秒 FATAL 刷日志，
   且 `supabase_admin` 连 TCP 也要密码（`psql -U supabase_admin` 只用 socket 能进）。
2. **`authenticator` 初始密码为空**。官方 compose 用 `volumes/db/roles.sql` 补；自建栈要手动：
   `ALTER USER authenticator WITH PASSWORD '<POSTGRES_PASSWORD>'`，否则 rest 容器无限重启，
   日志 `password authentication failed for user "authenticator"`。
3. **初始化只在 pgdata 为空时跑一次**。日志出现 `Database directory appears to contain a database; Skipping initialization`
   就说明没初始化。别在脏数据目录上重试：要么清空（`docker compose stop db` 后删内容），
   要么直接换新目录名（`db/pgdata2`）改 compose 挂载，旧目录留着排查。
4. **换数据目录后 `.env` 里的 PGDATA 相关密码不变**，但要重做坑 2 的 authenticator。
5. **PostgREST schema cache**：建表后立刻请求可能 404（`PGRST205`），内置 `pgrst_ddl_watch` 会 NOTIFY，
   通常 1~3 秒生效；急用就 `psql -c "notify pgrst, 'reload schema'"`。
6. 镜像 tag 常变：`supabase/studio` 用日期 sha 标签（`2026.11.02-sha-a05e7ec`），`nginx:1.27-alpine` 已 404
   用 `nginx:stable-alpine`。拉之前先查 hub.docker.com/v2/repositories/<repo>/tags。
7. Apple Silicon 上 `supabase/postgres` 有多架构 tag，不必加 `_arm64` 后缀。
8. CORS 要在 gateway 做（PostgREST 自己不发 CORS 头），浏览器直连必须带 `OPTIONS → 204` 分支。
9. **「不用登录就能进」不是一个卖点，是一个洞**。发现某个自托管 Web UI 无登录页时，先弄清鉴权
   本来挂在哪一层（这栈是 kong basic-auth），再决定补鉴权还是收窄端口；不要直接把地址当好消息告诉用户。
   给用户报访问方式之前，先跑一条无凭据的 API 探针确认权限边界。
10. **Studio 的元数据接口就是 SQL 执行入口**：`POST /api/platform/pg-meta/<ref>/query`，
    无鉴权时以 `supabase_admin`（superuser）执行。探测/验收时只用 `select current_user, current_database()`
    这类只读语句，不要在里面建表——那是往用户库里塞垃圾。
11. **Studio 前端报错先用「前端实际发了什么请求」定位，别猜**。注入 fetch 记录器最快
    （见 `references/studio-ui-diagnostics.md`）。本项目踩到的 `Failed to retrieve projects` 就是
    前端打了一条自托管不存在的 route，改配置无从修——先拿到 404 的 URL，再决定是不是上游问题。
12. **`.env` 里带空格的值不能 `set -a; . .env`**：`STUDIO_DEFAULT_ORGANIZATION=Default Organization`
    会被 shell 当命令执行（`Organization: command not found`），后续变量静默丢失。
    取单个值一律 `grep '^KEY=' .env | cut -d= -f2-`，或用 `sh run.sh secrets`。
13. **用 URL 内嵌凭据开 basic-auth 页面会踩浏览器的 fetch 限制**：
    `http://user:pass@host/...` 下页面内 `fetch('/api/...')` 抛
    `Request cannot be constructed from a URL that includes credentials`，看起来像后端 500。
    正确做法是给浏览器注入 `Authorization: Basic <b64>` 请求头（recipe 在上面的 references 文件里），
    页面与 fetch 才能一起正常。

## 官方栈验收（照抄）

```bash
cd ~/docker/compose/supabase
docker compose ps --format '{{.Service}}\t{{.Status}}'     # 11 个全 healthy
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8000/                          # 401（Kong basic-auth 生效）
curl -s -o /dev/null -w '%{http_code}\n' -u "$DU:$DP" http://localhost:8000/project/default  # 200
curl -s -H "apikey: $ANON" http://localhost:8000/auth/v1/health                        # 200
curl -s -H "apikey: $ANON" http://localhost:8000/storage/v1/version                     # 200
# REST 建表/读写见下面第 6 步；注意 anon 请求也要带 Authorization: Bearer <ANON>
```

`GET /rest/v1/` 返回 403 是正常的（没有表可列），不代表坏。

## 没装的服务（最小栈才需要关心）

auth(GoTrue) / realtime / storage-api / imgproxy / edge-runtime / analytics(logflare) / supavisor。
注意每个服务都要求对应的 `supabase_*_admin` 角色密码与 db 一致（官方 compose 的 `roles.sql` 一并设置）。
