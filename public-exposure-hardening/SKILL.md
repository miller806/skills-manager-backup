---
name: public-exposure-hardening
description: "Use when auditing public ports/NAT mappings and hardening."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos, linux]
metadata:
  hermes:
    tags: [DevOps, Security, Network, nginx]
    related_skills: [ssh-ops-mcp, linux-intrusion-triage, caddy-reverse-proxy]
---

# 公网暴露面梳理与网关收敛加固

用于「路由器上开了这些映射 / 这些端口对外，有没有风险、怎么防护」这类任务：把 NAT 端口转发、内网实际监听、公网实际可达三者对齐，识别不该外露的管理面，然后给出收敛到统一入口的方案。

## ⚠️ 铁律：用本机做的公网端口扫描必须先做假阳性对照

开发机常挂 Clash Verge / TUN 代理。此时 `nc -z` / `socket.connect` 对**任意**公网 IP **任意**端口都返回成功 —— 扫描结果全是假的，据此下结论会把无关端口报成「OPEN」、把真实暴露漏掉。

开扫前先打三条不可能开的对照，任一条「成功」就说明扫描不可信：

```bash
nc -G 2 -z 1.1.1.1 12345 && echo "假阳性：本机走代理，端口扫描作废"
```

- 对照仍然全 open → 放弃本机扫描，改用：① 内网机器当跳板（`sshpass -e ssh <host> 'curl …'`，见 ssh-ops-mcp 的 references/running-commands.md）；② 直接看路由器 NAT 表 + 内网 `ss -lntp`；③ **让用户用手机 4G（断 WiFi）复核**，这是最干净的外部视角。
- NAT 表也不是全集：路由器自己的管理面（LuCI / 厂商 Web）常常没有映射规则却监听在 WAN 口上。**必须单独探 80/443 根路径**，看返回的是业务页面还是路由器登录页（LuCI 指纹 `/cgi-bin/luci/`，自签证书常见 issuer=subject 且有效期 100 年）。这类缺口优先级高于所有业务规则 —— 它等于网关失守。

## 流程

1. **逐行还原规则表**。截图逐行读，格式统一成 `名称 | 协议 | 外部IP | 外部端口 | 内部IP | 内部端口`，不要概括。特别确认「外部服务器IP」列是「所有WAN口」还是具体 IP —— 所有WAN口意味着多线路各开一遍，暴露面按 WAN 数翻倍，也是加固时要改的第一项。
2. **内网对齐监听**。对每个内部目标机跑 `ss -lntp`（收窄用 `ss -lntp | grep -e ':8080 ' -e ':9099 '`）。规则指向的端口不一定真在听 → 死映射只是白送攻击面；端口在听但没在规则里 → 说明还有别的入口或直连路径。
3. **定性每一条暴露**。按「是什么服务 / 有没有鉴权 / 后端活没活」三问定性，不要只看端口号。具体判据见 `references/exposure-probe-criteria.md`。
4. **给收敛方案**，不是给一列「去关掉」。默认答案是：公网只留 443 → 统一 nginx 入口按 Host 路由 → 网关层做鉴权/限流/白名单 → 管理面独立 host + 双层校验 + 后端绑回环。配置草案与取舍见 `references/gateway-consolidation.md`。

## 高危清单（每项都在这套环境里真实命中过）

- **网关 Admin 用官方默认密钥**。APISIX 默认 `X-API-KEY: edd1c9f034335f136f87ad84b625c8f1`，内网 `:9180` 直接能拉全量路由表、能改路由劫持流量。Admin/Dashboard/etcd 端口必须只绑 `127.0.0.1`，现在多半是 `0.0.0.0`。
- **网关路由只挂了 Host 匹配、没挂 key-auth**。APISIX 里 `host` 是匹配条件不是鉴权。实测 `curl -H "Host: <某个内部域名>" :9080/` 就能把请求打到内网任意 upstream —— 按 `plugins` 为空的路由逐条点名，这类通常是临时加的、可以删。
- **管理面直怼公网**：Jenkins / Nacos / Swagger / Dashboard / DB / Redis。判断依据：Jenkins `GET /whoAmI/api/json` 匿名 200（`anonymous` 用户名）+ `/view/All/api/json` 403 = 匿名可读接口、无权限列 job，仍是爆破面；Nacos 的 `/nacos/v1/ns/catalog/services` 也常因路由未拦截而可达。
- **失效映射**：后端机器 ping 不通 / 端口 closed 的规则纯增攻击面，直接删。
- **开发机整机暴露**：映射到本人 Mac / 开发笔记本的 HTTPS 口，机器上有 SSH 私钥和 git 凭据，一律建议删。

## 加固口径（不要让用户只收到「去关掉」）

- 路由器上：删死映射与个人测试映射；「所有WAN口」改绑单 WAN（若本来是随手选的）；源 IP 白名单是成本最低的一道墙。
- 边缘 nginx：`server_tokens off` + `limit_req`/`limit_conn` + `map $request_uri` 拦 `/.env`·`/.git`·`wp-login`·`phpmyadmin`·`actuator` 并 `return 444`（不回包，不给指纹）+ `geo` 白名单。
- 管理面：独立 host，`allow/deny` + `auth_basic`；**不要试图挂在 `/jenkins/` 这类子路径**，它有绝对 redirect 和 cookie path，加前缀必歪。后端再绑 `127.0.0.1` 或只允许边缘机访问，做第二道。
- 单入口必然引入单点：切换前先备好备份机 / keepalived VIP / 路由层健康检查，不能事后补。
- 证书先看清是 Cloudflare Origin CA 还是公开 CA —— 源站在 CF 后面的，最省事的是源站防火墙只放行 CF 网段，公网直连源 IP 全 drop，攻击面从「全世界」缩到「CF 节点」。

## 输出规范

- 中文、按风险排序、每条给动作。开头先给规则还原清单（对齐列表，Discord 不支持表格渲染）。
- 异常项单独 `⚠️` 标注；区分「高危 / 中危 / 建议」三档，不要把死映射和默认密钥混在同一档。
- 结尾给 2~3 个需要用户确认的问题（多 WAN 是否有意、某个映射谁在用、要不要出配置），不要一次抛一堆决策。

## 坑

- **只看 HTTP 状态码会误判**。SPA 对所有路径回 200（回的是 index.html），`/.env` 200 不代表泄露；先打一个 `/randompath` 基准对比 size/body。反向也有：应用层拦截自定义文案（「非法请求」）也常返回 200，要看 body 第一行。
- **`000` / `Empty reply from server` 是「TCP 通但不说 HTTP」**，多半是 TLS 服务或非 HTTP 协议，别当成「服务挂了」；换 `https://` 再试，仍不行就按非 HTTP 处理。
- **同端口多个 vhost 是合并到 443 时的头号障碍**。收敛前先 grep 一遍 `listen` 与 `server_name`，`*.example.cc` 这类泛域名在多个 conf 里重复出现会互相抢匹配，`nginx -t` 只报重复 listen、不报语义冲突 —— 必须先出 host 映射表再动手。
- 远端 `grep -rn 'pattern' /path` 经 ssh-ops MCP 会被引号分段规则拦掉（见 ssh-ops-mcp）；改 `grep -rn pattern /path` 不带引号，或 `grep -e`。
- 公网 IP 上不同端口的「业务」可能是同一台机器同一个 nginx 的多个 `listen`，还原时要落回到 `ss -lntp` 的 pid/进程名，否则会以为有十几个独立服务。
