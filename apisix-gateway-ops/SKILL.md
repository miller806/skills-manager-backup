---
name: apisix-gateway-ops
description: Use when adding, debugging or upgrading APISIX gateways.
version: 1.1.0
metadata:
  hermes:
    tags: [APISIX, Gateway, ReverseProxy, DevOps]
---

# APISIX 网关路由维护

用户问「APISIX 路由怎么配 / 加一条路由 / 某个域名打不通 / 升级 APISIX」时读本技能。

## 先查现状（只读，不要先动）

APISIX 的**唯一事实来源是 etcd**，dashboard 只是个前端。任何一条都要能不经 dashboard 读到：

```bash
docker ps --format '{{.Names}}|{{.Image}}|{{.Ports}}' | grep -i -E 'apisix|etcd'
# admin key（v3.x 在 config.yaml 的 deployment.admin.admin_key）
docker exec apisix grep -n -A5 admin_key /usr/local/apisix/conf/config.yaml
# 路由/上游/证书清单直接读 etcd，不依赖 admin API 是否可达
docker exec etcd etcdctl --endpoints=127.0.0.1:2379 get /apisix/routes --prefix --keys-only
docker exec etcd etcdctl --endpoints=127.0.0.1:2379 get /apisix/upstreams --prefix --keys-only
docker exec etcd etcdctl --endpoints=127.0.0.1:2379 get /apisix/ssls --prefix --keys-only
# 单条完整定义（含 upstream nodes / host / plugins）
docker exec etcd etcdctl --endpoints=127.0.0.1:2379 get /apisix/routes/<id>
# dashboard 的 etcd 地址与登录账号
docker exec apisix-dashboard cat /usr/local/apisix-dashboard/conf/conf.yaml
```

Admin API 列表（用于程序化核对）：
`curl -s http://127.0.0.1:9180/apisix/admin/routes -H "X-API-KEY: <key>"`，
body 是 `{"list":[{"value":{…},"key":…}]}`。**必须用真实的 `X-API-KEY`**，缺失/错误只回
`{"error_msg":"failed to check token"}`，不是路由问题。

## 升级（3.13 → 3.20 实录，2026-11-19）

100 这台 docker 配了 systemd drop-in 代理 `/etc/systemd/system/docker.service.d/http-proxy.conf`，
拉镜像必须走它；代理一挂 `docker pull` 就**无限阻塞**（无输出、不报错、`ps` 里进程在但不动）。
排查顺序：`docker info | grep -A4 "HTTP Proxy"` → 从 100 用 `curl -x <proxy>` 测代理能否出网 → 能出网再 pull。

```
升级三步（全部实测：拉镜像 57s，recreate 10s，9080 中断共 ~20s）
1. 备份: etcdctl snapshot save + Admin API 导出 routes/upstreams/consumers/ssls + cp -a compose 目录
2. docker pull apache/apisix:3.20.0-ubuntu  （3.20.0 是 2026-11 最新，只有 -ubuntu/-debian/-redhat 变体）
3. compose 里改 image tag → docker compose up -d apisix（不用改 config.yaml）
```

**3.13→3.20 兼容性实测**：现有 config.yaml 零改动可用。已启用插件里只有两个名字对不上——
`proxy-cache`（3.20 里是目录而非单文件，正常）和 `elasticsearch-logge`（config 里的历史拼写错误，
文件实为 `elasticsearch-logger.lua`，且该插件从未启用过）。**插件清单对比用**：
`docker run --rm --entrypoint ls <img> /usr/local/apisix/apisix/plugins/ | grep '\.lua$' | sed 's/\.lua$//'`。

**升级后必查 ULIMIT 告警**：3.20 启动会报 `maximum number of open file descriptors [1024]`，
compose 里给 apisix 服务加：
```yaml
    ulimits:
      nofile:
        soft: 65536
        hard: 65536
```
再 `docker compose up -d apisix`（又一次 10s 中断）才消失。

回滚：compose 改回旧 tag + `docker compose up -d apisix`（旧镜像保留在本地），etcd 数据不受影响。

## 本编队现状（192.168.2.100）

```
容器        镜像                              端口
apisix      apache/apisix:3.13.0-ubuntu       9080 http / 9443 https / 9180 admin(内嵌UI)
dashboard   apache/apisix-dashboard            9000（admin/admin，只读用）
etcd        bitnamilegacy/etcd:3.6.4           2379
```

- **compose 在 /opt/docker/compose/apisix/**，config.yaml 在 `apisix_conf/config.yaml`（不是目录根下！
  compose 里 `version:` 已过时无害）。改配置后 `docker compose restart apisix`（约 10s）。
- **compose 的 ports 段把 9080/9443/9180/9091/2379/9000 全部 `0.0.0.0` 发布**，防火墙是否放行取决于
  上级路由器；删映射要从 compose 改，不能只改 docker。
- admin_key 2026-11-19 已换成随机值（备份在 `/root/evidence-20261119/new-admin-key.txt`），
  `allow_admin` 已收为 127.0.0.1/32 + 172.19.0.0/16。**不要再把旧 key `edd1c9…` 写进文档或脚本。**
- 路由模式统一是 **Host 匹配 + `uri: /*`（全 method）**，靠 `host` 区分业务，见下表。

```
name               host                          upstream              鉴权
(nacos) dev-redis   dev.nacos.host                192.168.2.56:8848     key-auth(api-key, 2026-11-19 加)
cregis-developer   cregis-developer.cregis.dev   192.168.2.117:80      ⚠️ 无(Next.js 站,调用方=阿里云侧,保持不动)
cregis-product     cregis-product.cregis.dev     192.168.2.117:80      ⚠️ 无(同上)
loki               loki.gateway.internal         192.168.2.184:30100   key-auth(loki-key)
devN9e             n9e.gateway.internal          192.168.2.100:17000   key-auth + consumer-restriction
```

采集端已全部改内网直连（2026-11-19）：`.40/.56/.90/.101/.121` 与 `192.168.2.100` 本机的 categraf 写
`http://192.168.2.100:17000/...`；`.40/.90/.33` 的 promtail 推 `http://192.168.2.184:30100/...`。
阿里云侧还有 6 台 categraf（网关看 **export NAT 后的阿里云 EIP** `47.236.92.237 / 47.236.111.11 /
47.236.120.102 / 8.222.226.187 / 8.222.227.110 / 8.219.64.65`，心跳 UA 里带内网 IP `172.30.163.x`、
`172.16.21.180`，其中 4 台没有公网 IP）——**动 n9e/loki 路由的鉴权前必须把这 6 台一起改，否则会中断采集**。
另外 `.50/.91` 不在 ssh-ops 的 CMDB 表里（直连 SSH 不通），它们的 promtail 还走网关。

- **没有 80/443 前端**：客户端一律带端口，`curl -H "Host: x" http://192.168.2.100:9080/`。
  不要因为 `curl http://<ip>/` 不通报障——宿主 80/443 根本没监听。

每次上手先重读一遍实际路由（上节命令），别照抄上表——它是形态参考不是配置源。`headers/ip/get`
三条 demo 路由（指向 httpbin.org）已删，再看到就是被人重新加回来了。

## 升级 APISIX

完整流程与 3.13→3.20 的兼容性核对表见 `references/upgrade.md`。四条铁律：

1. **升级前必做 etcd 快照 + 全量导出**（routes/upstreams/consumers/ssls/global_rules），并整目录备份
   compose —— APISIX 的配置只在 etcd 里，容器回滚不等于数据回滚。
2. **拉不到镜像是这条链路上最常见的卡点，先解决它再谈升级**。100 这台的 `docker.service.d` 里配了
   `HTTP_PROXY/HTTPS_PROXY` 指向内网某台代理机，那台一旦失效，`docker pull` 表现为**无任何输出、
   卡到超时**（不是报错）。内网「能上网的代理」候选会变，**每次都要现测**：用 registry 的 `/v2/`
   探一下，回 `401` = 通（registry 正常鉴权响应），回 `000` = 不可用（探测命令见 references）。
   只 ping 通不够，要看端口：ARP 显示 REACHABLE 但所有 TCP 端口关闭的设备（当纯 NAT 用的路由器）
   照样不能当代理。
3. **改 docker 的 proxy drop-in 要 `restart docker`，会连带重启这台机上所有容器**，绝不能和 APISIX
   升级混进同一次变更，要单独安排窗口。
4. 升级的**中断窗口 30–60 秒**（比 `docker compose restart` 的 10 秒长：要等新镜像启动 + 配置加载），
   必须让用户选时间点，并提前把回滚命令写出来。

宿主机不出网时两条可走的路（按成本排序）：Mac 上起 SSH 反向端口转发给宿主机临时用（拉完即撤、
零配置残留）；或在 Mac 侧用 `curl` 逐层拉镜像文件（绕开 docker pull）再传上去 `docker load`。
细节见 `references/upgrade.md`。

## Dashboard 选型（重要）

两套 dashboard 完全不同，别混：

- **旧版独立 dashboard**（`apache/apisix-dashboard` 容器，Go manager-api，9000 端口，admin/admin）：
  3.0.1 是重构前最后一个版本，官方明说「仅应与 APISIX 3.0 一起使用，更高/更低版本未测试」。
  镜像 2023 年就冻结了。在 3.x 新版上还能用（released 2026 年的老 bin 实测对 3.13 可用：
  登录 `POST /apisix/admin/user/login` 后 `/apisix/admin/routes` 返回 200 且能列出路由），
  但**新建/编辑路由时的表单和后端版本容易错位**（缺新字段、schema 解析失败）。读路由可以靠它，写路由别依赖它。
- **新版内嵌 UI**（从 APISIX 3.x 起打进 apisix 镜像，`enable_admin_ui` 默认 true）：入口
  `http://<ip>:9180/ui/`（注意结尾斜杠，`/ui` 只回 301），首次打开要求填 Admin API Key
  （就是 config.yaml 里 `deployment.admin.admin_key` 的 key），填错右上角 `failed to check token`。
  只读 `/ui/` 和 `/ui/assets/*` 是静态资源，不需要 key。

判断现场用的是哪个：`curl -s -o /dev/null -w '%{http_code}' 127.0.0.1:9180/ui/` 回 200 就有内嵌 UI；
`docker ps` 里有没有 `apisix-dashboard` 容器是旧版。升级 APISIX 时旧版 dashboard 容器可以不动，
但写操作切到 `9180/ui` 或 Admin API。

## 加一条路由

Dashboard（9000）与 Admin API 等价，**用户说「我该怎么配」时给两份都行，但字段名要说 dashboard 的叫法**：
名称 / 路径 / 高级匹配→Host / 上游→RoundRobin→节点 `ip:port` 权重 1。

Admin API 形式（幂等，用 PUT）：

```bash
K=$(docker exec apisix grep -oP 'key: \K[0-9a-f]{32}' /usr/local/apisix/conf/config.yaml | head -1)
curl -X PUT http://127.0.0.1:9180/apisix/admin/routes/<route-name> \
  -H "X-API-KEY: $K" -H 'Content-Type: application/json' -d '{
    "name": "<route-name>",
    "uri": "/*",
    "host": "<domain.internal>",
    "methods": ["GET","POST","PUT","DELETE","PATCH","HEAD","OPTIONS"],
    "upstream": {"type":"roundrobin","scheme":"http","pass_host":"pass",
                 "nodes":{"192.168.2.x:port":1},
                 "timeout":{"connect":6,"send":6,"read":60}}
  }'
```

要点：
- **路由 ID 一定是字符串**。纯数字 ID 会和内置 stub `route 1` 混在一起，用业务名做 ID。
- `PUT /routes/<id>` 幂等，重复执行不会多出一条；`POST` 每次新建。
- 多业务共用 9080 时，**`host` 是区分手段**，不要靠改端口或抢 `/*` 路径。
- 后端要保留子路径前缀就 `uri: /api/*` + 不开 rewrite；后端不认前缀用
  `proxy-rewrite: {"regex_uri": ["^/api/(.*)", "/$1"]}`。
- 常用插件：`key-auth`（配 consumer 里的 key）、`cors`、`limit-count`、`redirect: {http_to_https:true}`（等 443 有证书后再开）、`proxy-rewrite`。

## 坑

- **upstream 写 `127.0.0.1` 指向 APISIX 容器自己**。代理本机上其他服务用 `host.docker.internal:<port>`
  或宿主 `192.168.2.100:<port>`；同 compose 网络的服务用容器名。
- **APISIX 镜像里没有 curl**（ubuntu 基础镜像只留了少量工具）。容器内测可达性用 `getent hosts` /
  `/dev/tcp` / openresty 自带工具，或用宿主 curl 打映射端口 —— 报 `curl: not found` 不是网络不通。
- **`uri: /*` + 空 plugins 的路由等于把内网服务裸奔到网关**。新建路由时默认把鉴权插件带上，或在汇报里明确标
  ⚠️。存量里出现 `remote_addr` 字段说明那条路由是从外部 IP 创建的，值得复查。
- **admin API 的 `allow_admin: 0.0.0.0/0` + 明文 admin_key 在 config.yaml**：9180 对整网开放就能任意增删路由。
  收紧要改配置文件并重启容器（会短暂中断 9080），属于要用户点头的变更。
- **9080 经路由器映射到公网（出口 112.28.138.245）**，互联网扫器已在打，细节与处置见
  `references/public-exposure.md`。别再新增 `/*` 无鉴权路由，demo 路由（/get /ip /headers）必须删。
- **没有 ssl 对象时 9443 上没有任何证书**，https 别指望直接能用。

## 观测面板

网关指标（`apisix_http_*`/`apisix_nginx_*`/`apisix_etcd_*`）默认从 **9091** 出，而这台机器上
9091 是**死的**（privileged agent 因非 root + 无 capability 起不来，且只绑 127.0.0.1）。
要做网关面板先读 `references/metrics-observability.md`，别直接去写面板 JSON。

## 验证

```bash
# 1) 按 Host 直打网关端口（最接近真实流量）
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: <domain.internal>' http://192.168.2.100:9080/<path>
# 2) 路由是否落库
curl -s http://127.0.0.1:9180/apisix/admin/routes -H "X-API-KEY: $K" | grep <route-name>
# 3) 实时匹配/报错
 docker logs -f apisix --tail 50
```

状态码怎么读：`401` = key-auth 生效但没带 key（链路是通的）；`404` 来自 upstream = 网关转发成功；
`502/503` 才是 upstream 不可达。

## 汇报

中文、代码块 + 对齐列表，先给现状表（容器/端口/现有路由+鉴权状态），再给配置方法，
最后列可选的写操作让用户挑（建路由 / 补鉴权 / 收紧 admin / 删 demo 路由），并声明「这些是写操作，你点头我再动」。
安全缺陷用 ⚠️ 单列。
