---
name: caddy-reverse-proxy
description: Use when adding/fixing a site on the local Caddy proxy.
---

# 本机 Caddy 反代站点维护

本机（macOS + Docker Desktop）跑一个 Caddy，用 DNS-01 拿 `*.apple806.cc` 泛域名证书，
把内网/本机容器服务暴露成 `https://<sub>.apple806.cc:555`。新增一个后端服务 = 改一个
站点文件 + validate + reload，不重启容器、不申请新证书。

## 固定布局

```
~/docker/compose/caddy/            # compose + 配置（目录挂载到 /etc/caddy:ro）
  docker-compose.yml               # 自定义镜像 caddy-dns:local（含 tencentcloud DNS 插件）
  .env                             # TENCENTCLOUD_SECRET_ID/KEY
  etc/Caddyfile                    # 全局：acme_dns tencentcloud、admin 2019、协议 h1 h2
  etc/sites/apple806.cc.caddy      # *.apple806.cc 通配站点，全部子域写这里
  backups/                         # 改动前备份放这
~/docker/volume/caddy/{data,config,logs}   # 证书/ACME 账号/访问日志
```

HTTP 入口只映射了宿主 `443`（+80 跳转）；公网是家里路由器 `555 → 443`。
`443` 从公网**不通**，`555` 通。

## 加站点流程

1. **先查现状**（不改任何东西）
   ```bash
   docker ps --format '{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Networks}}'
   curl -s http://127.0.0.1:2019/config/ | python3 -m json.tool | head -60
   ```
   重点看：后端容器端口绑在 `127.0.0.1:<port>` 还是 `0.0.0.0`，在哪个 docker 网络，
   caddy 是否已在同一网络（当前只在 `caddy` + `tabby-web_default`）。

2. **在 caddy 容器内实测后端可达性**——决定用哪种上游地址
   ```bash
   docker exec caddy getent hosts host.docker.internal          # 应得 192.168.65.254
   docker exec caddy wget -qO- http://host.docker.internal:8089/health
   ```
   返回 200 就直接用 `host.docker.internal:<宿主端口>`，**不要**为了用容器名去改网络。

3. **确认 DNS 记录已存在**（决定能不能拿到流量）
   ```bash
   curl -s "https://dns.alidns.com/resolve?name=<sub>.apple806.cc&type=A" \
     | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('Answer'),d.get('Status'))"
   ```
   DNSPod 里配的是 `*.apple806.cc` 泛解析时任何子域都能查到；返回空表示没有记录，
   先让用户去 DNSPod 加 A 记录，加了也没用——证书有了，流量不会来。

4. **备份 + 写站点块**：`cp etc/sites/apple806.cc.caddy backups/apple806.cc.caddy.$(date +%s)`，
   然后在通配站点里按已有顺序插 `@<name> host ...` / `handle @<name> { reverse_proxy ... }`，
   保持末尾 `handle { respond "Not Found" 404 }` 兜底块不动。模板见 `templates/site-block.caddyfile`。

5. **校验后热重载**（不要 restart，重启会断连接）
   ```bash
   docker exec caddy caddy validate --config /etc/caddy/Caddyfile   # 期望 Valid configuration
   docker exec caddy caddy reload   --config /etc/caddy/Caddyfile
   ```

6. **本机验证**（绕开 DNS 与代理，直接打 443 的 SNI）
   ```bash
   curl -s -o /dev/null -w '%{http_code} ssl=%{ssl_verify_result}\n' \
     --resolve <sub>.apple806.cc:443:127.0.0.1 https://<sub>.apple806.cc/health
   # 未知子域仍应是 404：
   curl -s -o /dev/null -w '%{http_code}\n' \
     --resolve foo.apple806.cc:443:127.0.0.1 https://foo.apple806.cc/
   ```

7. **公网验证**（真实出口 IP，必须 `--noproxy '*'`，端口 555）
   ```bash
   curl -s --noproxy '*' -m 15 --resolve <sub>.apple806.cc:555:<公网IP> \
     https://<sub>.apple806.cc:555/health
   ```

## 坑

- **本地 dig 不可信**：Clash 等 fake-ip 把域名都解析成 `198.18.0.x`，连不存在的名字也有值。
  判断方法：随手查一个乱码子域，也能返回 IP 就是假的。查真实记录用阿里 DoH（第 3 步）。
- **`docker exec caddy wget https://127.0.0.1/` 必然 TLS 握手失败**：容器内 wget 既不做 SNI
  也不信任泛域名证书，看到 `tlsv1 alert internal error` 不代表配置错。验证一律在宿主用
  `curl --resolve`，它同时解决了 DNS 和 SNI。
- **泛域名只匹配一级**：`a.apple806.cc` ✓，`a.b.apple806.cc` ✗（且证书域名也不能跨级）。
- **上游是 `127.0.0.1:<port>` 的服务**（只绑回环、不想暴露公网）用 `host.docker.internal`，
  别把端口改成 `0.0.0.0`，也别为加网络而重建 caddy。
- **config 改动 reload，凭据/镜像改动才 recreate**；`.env` 变更后 `up -d --force-recreate`。
- **`logging:` 属于 service 层**，写在 compose 顶层报 `additional properties 'logging' not allowed`。
- **`etc/` 是目录挂载**（macOS 编辑器原子保存会锁死单文件 inode），创建新站点文件后直接
  reload 即可，无需重启。
- **后端自己生成的绝对 URL 必须带 `:555`**，否则回调落到公网不通的 443。判断准则：
  用户浏览器敲的地址是什么，base URL 就是什么。

## 汇报

中文、简洁代码块 + 对齐列表，不要花哨卡片；先说改了哪个文件（附备份路径）、为什么这么写、
再列验证输出。异常/需用户确认的项用 ⚠️ 单独标出（如公网端口、后端只有 /health 没有页面、
顺带发现的其他子域 404）。
