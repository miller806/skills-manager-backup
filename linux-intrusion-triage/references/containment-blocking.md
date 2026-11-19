# 封堵与阻断的生效性验证

封 IP / 加 iptables / 改 nginx 之后**必须实测**。规则显示正常而流量照进，是这一阶段最常见的假象，判据全部来自真实探活与计数器。

## 1. docker 发布端口的规则不能加在 INPUT

`docker -p` 的端口在 `nat PREROUTING` 就被 DNAT 成容器地址，随后走 `FORWARD`（命中 `DOCKER-USER`），**根本不经过 INPUT**。表现特征：

```
iptables -L INPUT -v -n | grep <port>     # 规则在，计数器恒为 0
curl -sS -o /dev/null -w '%{http_code}' <public-url>   # 仍是 200
```

只要这两条同时成立，就不是「规则没生效」而是「链错了」。规则写入 `DOCKER-USER`（`-I DOCKER-USER`，它是唯一在 FORWARD 之前由用户可控的链），验证看计数增长：

```
iptables -I DOCKER-USER 1 -p tcp --dport <port> ! -s 10.0.0.0/8 ! -s 172.16.0.0/12 ! -s 192.168.0.0/16 -j DROP
iptables -L DOCKER-USER -v -n            # 打几次后再看，计数器必须涨
```

非 docker 的原生监听才用 INPUT。写规则前先 `ss -lntp` 确认监听者是 `docker-proxy` 还是业务进程，再决定链。

## 2. 持久化没有 netfilter-persistent 时用 systemd oneshot

Ubuntu 20.04 默认不带 `netfilter-persistent`。不要为这个装包，写一个 unit：

```ini
[Unit]
Description=restore dns/port containment rules
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/sbin/iptables-restore /etc/iptables/rules.v4
[Install]
WantedBy=multi-user.target
```

`iptables-save > /etc/iptables/rules.v4` 之后再 `systemctl enable --now`。验收：`systemctl restart docker`（或重启机器）后规则仍在、计数器仍增长。只 `enable` 不重启验证等于没验。

## 3. 反代后面的管理端：location 正则不可信

`location ~ ^/(admin|api)/` 拦不住 `/admin;/toLogin`——**`;` 是合法的 path parameter 分隔符**，正则不匹配就落回 `location /` 的 proxy 分支，照样 200。同理 `//`、`%3b`、大小写、尾随 `;`。

按原文 URI 判，而不是按 location 解析后的 path：

```nginx
if ($request_uri ~* "^/(xxl-job-admin|api)(;|%3b|/|$)|\.\./") { return 403; }
```

必须逐个变体实测，全部 403 才算收口：

```
for u in '/admin/toLogin' '/admin;/toLogin' '/admin;//toLogin' '/ADMIN/toLogin' '/admin%3b/toLogin' '/admin;/' ; do
  printf '%-24s ' "$u"; curl -s -o /dev/null -w '%{http_code}\n' "https://<host>$u"; done
```

`nginx -t && nginx -s reload` 之后再跑一遍，不要只 reload 不测。

## 4. nginx 拦截是补丁，不是修复

后台确实要暴露给外部时，正确的顺序是：改默认口令 → 清空/禁用默认 admin 账号 → 执行器加 access-token → 加 Basic Auth + IP 白名单 → 前端反代只放行必要 path。**把后台从公网摘出去（只允许堡垒机/内网段）才是根治**，location 拦截只是争取时间。汇报里必须把「已止血」和「已修复」分开写。

## 5. 绑定地址要逐个端口收，别只改一个

同一产品常有两个以上监听面（例如 Flink 的 REST 8081 与 ZK clientPort 2181）。改 `rest.bind-address` 只解决一个；`ss -lntp` 逐个检查 `*:` 监听，ZK 要在 `zoo.cfg` 单独配 `clientPortAddress=127.0.0.1` 或前面加认证。宣布「已收口」前贴 `ss -lntp` 全表，而不是描述改了哪个配置。

## 6. 从外部真实探活，不要在本机 curl

本机 `curl 127.0.0.1:<port>` 走 loopback，不过 PREROUTING/FORWARD，一定通——用它验证封堵只会得到假阳性。验证一律从外部：`nc -G 3 -z -v <public-ip> <port>`，或从另一台机器 curl 公网域名。
