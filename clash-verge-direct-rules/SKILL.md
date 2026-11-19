---
name: clash-verge-direct-rules
description: Use when a host must bypass Clash Verge proxy to go DIRECT.
---

# 本机代理客户端直连规则（Clash Verge / FlClash）

## 何时用
本机装了代理客户端（TUN 或系统代理），访问某公网主机 / SSH 被代理劫持导致失败，需要这些 IP 走直连；或用户怀疑"是不是被切成全局了"。

## 第 0 步：先确认当前跑的是哪个客户端

用户经常临时换客户端，别默认还是上次那个。Verge 和 FlClash 的配置形态完全不同（YAML prepend vs JS 覆写），认错客户端等于白干。

```bash
ps aux | grep -iE "mihomo|clash-verge|FlClash" | grep -v grep | awk '{print $2,$11}'
ls -d "$HOME/Library/Application Support"/*lash* "$HOME/Library/Application Support"/*ollow*
```

判断要点：
- `clash-verge-service` + `/var/run/clash-verge-service/users/$(id -u)/verge-mihomo.sock` → Verge 在跑，走下面的 Verge 章节。
- `FlClashCore`、`$HOME/Library/Application Support/com.follow.clash/` → FlClash，见 `references/flclash-override.md`。
- Verge 的 service daemon 可能在退出后仍以 0% CPU 挂着，**以 socket 文件是否存在为准**，不看进程。
- 两个客户端会抢同一个 `198.18.0.1` utun 和 `mixed-port 10808`；同时开必然互相打架，先让用户只留一个。

## 被切成 global？先量再答

用户问"你是不是把我搞成全局了"时，别只念 `mode` 字段——他信的是出口 IP。两条都做：

```bash
curl -s --unix-socket $S http://localhost/configs | python3 -c "import json,sys;d=json.load(sys.stdin);print('mode:',d.get('mode'))"
curl -s --max-time 8 http://myip.ipip.net        # 国内站看：应为家宽/办公出口
curl -s --max-time 8 https://api.ip.sb/ip        # 国外站看：应为机场节点
curl -s --unix-socket $S http://localhost/connections | python3 -c "import json,sys,collections;print(collections.Counter((tuple(c['chains'])[0] if c.get('chains') else 'none') for c in (json.load(sys.stdin).get('connections') or [])).most_common(10))"
```

- `mode: rule` + 国内站看到家宽 IP + `baidu/36kr/apple` 类域名 `chains==['DIRECT']` → 正常规则分流，不是 global。
- global 的特征是国内域名也挂到境外节点上，`baidu.com` 会走机场。
- 顺手把结论说清"我只改过让流量直连的规则，方向相反"——用户真正担心的是被改了配置。

## 先诊断，别猜

```bash
# 拿当前生效规则（unix socket，无需 sudo）
S=/var/run/clash-verge-service/users/$(id -u)/verge-mihomo.sock
curl -sS --unix-socket $S http://localhost/rules > /tmp/rules.json
curl -sS --unix-socket $S http://localhost/connections > /tmp/conn.json
```

关键判断：起一个真实连接，看 `/connections` 里这条流量的 `rule` / `rulePayload` / `chains`。

- `chains` 含真实节点名 = **走了代理**，出口 IP 是机房 IP，目标侧安全组/白名单不认。
- `chains == ['DIRECT']` = 已直连。

**不要用 `nc -z` / `curl` 的"成功"判断连通性。** TUN 模式下本地内核先 accept TCP，`nc` 恒返回 succeeded，连不存在的 IP:PORT 也 succeeded。必须看真实协议层（SSH banner / HTTP 状态码 / `kex_exchange_identification`）。

典型症状对照：
| 现象 | 含义 |
|---|---|
| `Connection closed by remote port 22` | 出口 IP 不在对端白名单，先查代理链 |
| `Empty reply from server` | 同上，或协议不匹配 |
| `Permission denied (publickey)` | 网络已通，是密钥问题（另一回事）|

## 配置位置（Clash Verge Rev）

配置目录：`~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/`

```
profiles.yaml          # 索引: 哪个 profile 用哪个 rules 覆写文件
profiles/<uid>.yaml    # 每个订阅的 rules / merge / proxies 覆写
Merge.yaml             # 全局合并（不一定生效，别指望）
```

从 `profiles.yaml` 找 `current:` 那个 uid，找到它的 `option.rules` 指向的文件——**改那个**，不要改订阅拉下来的 yaml（会被覆盖）。

FlClash 的等价物是 JS 覆写脚本，路径/写法/验证步骤见 `references/flclash-override.md`。

## 规则文件写法

```yaml
prepend:
  - IP-CIDR,192.168.0.0/16,DIRECT,no-resolve
  - IP-CIDR,8.222.227.110/32,DIRECT,no-resolve
append: []
delete: []
```

要点：
- 用 `prepend`，插到 9000+ 条订阅规则最前面。放 append 会被 `GeoIP,cn` 或 `Match` 抢先命中。
- 必须带 `no-resolve`，否则每条规则对域名连接都触发一次 DNS 查询。
- 单 IP 写 `/32`（YAML 里裸 IP 不合法）。
- 内网段（192.168/10/172.16）一起 prepend，TUN 下更稳。

## 生效方式

规则文件改了不会自动重载，必须让 Verge 重新生成 runtime config：

```bash
osascript -e 'tell application "Clash Verge" to quit'
sleep 4 && open -a "Clash Verge"
sleep 8
curl -sS --unix-socket $S http://localhost/rules | python3 -c "import json,sys; [print(r['type'],r['payload'],'->',r['proxy']) for r in json.load(sys.stdin)['rules'][:20]]"
```

确认新 IPCIDR 排在 `#0` 起、指向 `DIRECT`。

## 验证：按出接口做 A/B，一步定位是代理还是目标侧

比翻 `/connections` 更硬的证据：同一时刻同一个 IP，只换源接口发两次连接。走网络接口直连能通、走 utun 不通 = 100% 代理劫持；两边都不通 = 与代理无关（安全组/对端问题）。不需要改任何配置。

```bash
# 取物理口地址（en1 是这台机的有线/WiFi 主口）
EN1IP=$(ipconfig getifaddr en1)
curl -s -o /dev/null --interface $EN1IP -w "direct http=%{http_code} t=%{time_total}\n" --max-time 10 http://<ip>:<port>/
route get <ip>        # 看 interface: utun4 => 默认走代理；en1 => 已直连
```

SSH 层用 `-o BindAddress=$EN1IP`。需要精确到 socket 参数时用 python：`setsockopt(IPPROTO_IP, IP_BOUND_IF, if_nametoindex('en1'))`，重连一次读 banner（`SSH-2.0-OpenSSH...` 才算真通）。

```bash
# 必须抓一次真实连接确认 rule 命中
ssh -o BatchMode=yes -i <key> root@<ip> hostname
# 同时另起一条命令查 /connections，应看到 rule=IPCIDR [x/32] chain=DIRECT
```

## 坑

- `/Library/Application Support/clash-verge-service/users/<uid>/runtime/` **无 sudo 读不了**，别去翻 config.yaml，走 unix socket 的 `/rules` `/connections` `/configs`。
- 本机 `sudo` 需密码，所有操作限定在用户可写的 `profiles/*.yaml`。
- 若用域名访问目标且被 fake-ip 解析，还需加 `DOMAIN-SUFFIX,...,DIRECT`；纯 IP 访问不受影响。
- 后台命令别用 `&`，会用 `terminal(background=true)` 然后另开一条命令抓状态。
- **某个端口直连也超时 ≠ 代理问题。** 同一 IP 上 A 端口通、B 端口不通时，去查对端安全组/防火墙白名单（尤其云主机只放行了 Web 端口、没放行 22）。别把安全组问题写成"代理坏了"。
- **换客户端后整套直连规则不会跟过去。** 新客户端的订阅里没有自建主机的 IP 白名单，所有自有云主机都会落到 `MATCH,,漏网之鱼 → 节点`，症状跟第一次踩坑一模一样。诊断时先确认当前客户端的最终 config（不是订阅源）里到底有没有那些 `/32` 规则。
- 改 FlClash 的 `database.sqlite` 不是可行路径（App 运行中会覆盖），只能走 UI；Verge 则可以直接改 `profiles/*.yaml` 后重启 App。详见 `references/flclash-override.md`。
