# Docker 宿主机端口收口：把发布端口限回内网

容器用 `-p` / compose `ports:` 发布的端口，`docker-proxy` 监听 `0.0.0.0`，公网直接可达。要把它收回到内网时，**规则加在 INPUT 链上无效**。

## 为什么 INPUT 无效

发布端口的路径是：

```
外部包 → nat PREROUTING → DNAT 到容器 IP(172.x) → FORWARD → 容器
```

DNAT 在 PREROUTING 就完成了，包的目的地址已变成容器 IP，**从不经过 INPUT 链**。INPUT 上的 DROP 规则计数器会一直是 0，而公网仍然 200。

唯一有效的挂载点是 **`DOCKER-USER` 链**（docker 自带、在 FORWARD 里最先被引用、重启 docker 不会删掉自定义规则）。

## 判定流量是否真的被拦

### 开发机上一切 TCP 探测都不可信，只有 curl 例外

挂 Clash / TUN 代理的开发机上，对**已 DROP 的端口**做探测会得到互相矛盾的结论：

```
nc -G 4 -z -v <ip> 8123          → "succeeded!"      ← 假阳性（代理进程在本地替你应答）
bash -c '>/dev/tcp/<ip>/8123'    → 成功               ← 同样假阳性
curl -m 6 http://<ip>:8123/      → http_code=000      ← 唯一可信
```

这不是规则没生效。**结论：验证封堵必须从另一台真实云主机发起**（同 VPC 的另一台、或任意没有代理的服务器），用 `curl` 看 http_code、用 `bash /dev/tcp` 看 TCP 层，两者都 blocked 才算封住。

```bash
# 在另一台云主机(无代理)上执行
for p in 8123 9200 27017; do
  printf "%-6s " $p
  curl -s -m 5 -o /dev/null -w "http=%{http_code}\n" "http://<目标公网IP>:$p/"
done
for p in 8123 9200 27017; do
  timeout 5 bash -c "cat </dev/null >/dev/tcp/<目标公网IP>/$p" 2>/dev/null \
    && echo "  $p TCP_OPEN" || echo "  $p TCP_BLOCKED"
done
```

同一脚本还要跑内网侧，确认业务没被打断（`http://<内网IP>:8123/` 仍 200）。

### 计数器只能定位「挂错链」，不能替代外部验证

```bash
iptables -vnL DOCKER-USER --line-numbers | grep 'dpt:8123'   # pkts 应持续增长
iptables -vnL INPUT      --line-numbers | grep 'dpt:8123'   # 纯 docker 端口这里恒为 0
```

INPUT 计数恒 0 而规则看起来齐全 = 流量走了 DNAT，必须挂 `DOCKER-USER`。但反面不成立：**计数器不为 0 也不能证明公网已封**，仍要做上面的跨主机验证。

### nft / legacy 双后端

`iptables --version` 报 legacy 时，别以为规则都落在 legacy 表里：`update-alternatives --list iptables` 同时存在 `iptables-nft`，`docker` 装的规则可能在另一个后端。用同后端查询确认：

```bash
iptables-legacy -S DOCKER-USER | grep -c '<port>'
iptables-nft    -S DOCKER-USER | grep -c '<port>'   # 两边只有一边有 → 就是这个后端在生效
```

## 规则形态：白名单式，ACCEPT 在前 DROP 在后

按端口分组，先放行 RFC1918 + 回环，再全量 DROP：

```bash
PORTS="8083 3306 6379 8080"
NETS="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.0/8"
for p in $PORTS; do
  iptables -I DOCKER-USER 1 -p tcp --dport $p -j DROP      # 先落到底
  for n in $NETS; do
    iptables -I DOCKER-USER 1 -p tcp -s $n --dport $p -j ACCEPT   # 再逐个插到最上面
  done
done
```

⚠️ **顺序陷阱**：`iptables -I` 是插到链顶。若按「先 ACCEPT 后 DROP」的直觉顺序写，后插的 DROP 会跑到最上面，把内网流量一起吞掉。必须**先插 DROP、再把 ACCEPT 一个个插到它上面**。写完立刻 `iptables -L DOCKER-USER -n --line-numbers` 确认 ACCEPT 行号小于 DROP 行号。

脚本要写成幂等的：每轮先 `iptables -D` 清掉同名旧规则再插入，否则重复执行会堆出几十条重复项。

## 收口范围别只盯一个端口

同一台机器上一起收的通常是一组：应用管理面（8083）、数据库（3306）、缓存（6379）、中间件控制台（8080/9001）、监控 UI（30080/28080）。逐个探一遍再一起改，不要只堵住被攻击的那一个。

## 持久化

- docker 重启会重建 FORWARD/DOCKER 链，自定义 `DOCKER-USER` 规则**会丢**，必须开机/重启后重放。
- Ubuntu 20.04 默认**没有** `netfilter-persistent` / `/etc/iptables/rules.v4`，不要假设 `apt install iptables-persistent` 已装。用 systemd oneshot 重放最省事：

```ini
[Unit]
Description=Restrict sensitive ports to internal networks
After=docker.service network-online.target
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/netguard.sh
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
```

`Requires=` + `After=docker.service` 是必需的 —— 规则依赖 DOCKER-USER 链存在，docker 没起时链不存在、脚本会静默跳过。`RemainAfterExit=yes` 让 `Type=oneshot` 显示为 active。

脚本里对每条链先 `iptables -n -L $CHAIN >/dev/null 2>&1 || continue`，链不存在就跳过，这样一个脚本能同时兼容有 docker 和没 docker 的机器。

## 验证两侧

改完必须双向验证，只测公网会漏掉业务被打断：

```bash
# 公网侧：应全部 000/超时
for p in 8083 3306 6379; do curl -s -m 5 -o /dev/null -w "$p %{http_code}\n" http://<公网IP>:$p/; done

# 内网侧：业务必须仍通（从同网段的另一台机器发起）
timeout 6 curl -s -o /dev/null -w '%{http_code}\n' http://<内网IP>:8083/xxl-job-admin/toLogin
timeout 5 bash -c 'cat </dev/null >/dev/tcp/<内网IP>/3306' && echo OK
```

还要查依赖这些端口的注册/心跳是否恢复（如执行器 registry 的 `update_time`），端口通不代表应用层没受影响。

## 云上补充

- 机器若在阿里云/腾讯云，安全组是更外层、更靠前的收口点；本机 iptables 是第二道。两边都做才算稳（安全组要用 API/控制台改，本机规则改不了它）。
- 同时确认机器有无 IPv6 公网地址（`ip -6 -o addr show scope global`）。有的话 IPv4 的 iptables 规则完全不管用，得配 `ip6tables`；没有则无需处理。
