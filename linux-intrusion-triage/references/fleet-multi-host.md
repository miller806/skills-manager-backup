# 多机批量排查驱动（fleet triage）

一次查 N 台的标准流水线：轻量 IOC → 并行全量采集 → 逐文件回传 → 代码聚合 → 分层结论。

## 0. 主机清单与登录方式

从 CMDB/资产表拿 `IP + 用户 + 私钥`，不要假设全 fleet 同一把钥匙或同一用户（常见 `root` 与 `ecs-user` 混用，个别机器要独立 key）。每台先跑一次连通性冒烟：

```
ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=no \
    -o ConnectTimeout=10 -o BatchMode=yes -o LogLevel=ERROR $U@$IP 'hostname; uptime -p'
```

冒烟失败的机器单独记录，不要混进「干净」里。

## 1. 轻量 IOC 扫描（几分钟，先出方向）

写成 `iocscan.sh` 上传执行，一次覆盖：IOC 进程名（`notice*`/`gluesource`/`kdevtmpfsi`/`xmrig`/`kinsing`/`/tmp/[a-z0-9]{6,}`）、`/tmp`·`/var/tmp`·`/dev/shm`·`/opt`·`/web`·`/root`·`/usr/local/bin` 的可疑文件名、`/etc/cron.d` 与 `crontab -l`、`ss -tlnp` 非本地监听、`ss -tnp state established` 对端聚合、已知 C2 IP 直匹配、`/etc/passwd` UID 0 与关键文件 mtime。

结果落 `ioc_<host>.txt`，逐台读。命中 `notice*`/`n163*` 这类名字时**不要立刻定性**，先 `stat` 看 mtime、`head -c 300` 看内容——`uid=0(root)+hostname+版本号` 是命令执行回显（实证），`<svg><text>xxx</text></svg>` 是 XSS 探针（只算探测）。

## 2. 并行全量采集

```
scp -i $KEY $OPT scripts/hunt-linux.sh $U@$IP:/tmp/hunt2.sh
ssh -i $KEY $OPT $U@$IP 'rm -rf /tmp/ir2; nohup bash /tmp/hunt2.sh --days 14 --out /tmp/ir2 >/tmp/ir2.log 2>&1 & echo LAUNCHED'
```

统一 `--days 14 --out /tmp/ir2`，跨机可比。完成标志：`/tmp/ir2/report.html` 存在（`ls` 一次即可，不要 `tail -f`）。

**复查（同一台机器的第二轮及以上排查）先列清上次的落地物名再动手**：上一轮的 `/tmp/hunt*`、`/tmp/ioc*`、`/tmp/ir2*`、`/tmp/xxx<ip>.sh`、`/tmp/*cookie*.txt` 和取证快照 `$EV/` 都还在，第二轮 IOC 扫描会把它们原样报一遍。按名字前缀 + mtime 写成排除清单，并在报告里显式写「N 个 /tmp 文件为上次排查残留，非植入」——否则「再次排查」的结论与上一轮看不出区别，用户无法判断到底有没有变化。

## 3. 轮询与回传

轮询 6~8 轮、每轮间隔 20s，检查 `report.html` 是否出现。完成后**逐文件**回传：

```
for f in report.html report.txt summary.txt; do
  scp -i $KEY $OPT $U@$IP:/tmp/ir2/$f ./hunt$H/$f || echo "FAIL $H $f"
done
```

多路径合并成 `scp host:'a b c' .` 不可靠，会静默少传。回传失败要打印主机名+文件名，不要 `2>/dev/null` 吞掉。

## 4. 聚合（用代码，不用眼睛）

```python
for p in r.split("### SECTION:")[1:]:
    title = p.split("\n")[0].strip()
    body  = "\n".join(p.split("\n")[1:])
```

只横向打印含 `⚠` 的行、`4. AUTH LOG` 的成功登录聚合、`7. PERSISTENCE: CRON` 的非系统条目。七台 × 13 段全读会淹掉上下文，也会漏掉差异。

## 5. 二次确认（IOC 命中后）

每一条命中都要落到「是什么 + 什么时候 + 谁写的」：

```
stat -c '%n ctime=%z mtime=%y' <file>
head -c 300 <file>
grep -a '<关键字>' /var/log/syslog /var/log/auth.log | tail
find <webroot> -xdev -type f -newermt '<window>' | wc -l
```

**入口优先**：web 攻击先看 access log 里写入动作的完整 URL 与状态码（`grep -aE 'upload|\.\.%2f|\.\./\.\.' *access*log*`，必须 `-a`，否则只返回 `Binary file matches`），RCE 先看中间件作业列表，SSH 先看 `Accepted` 的指纹。

## 6. 外部可达性

从本机（不是目标机）逐端口探：`nc -G 3 -z -v <ip> <port>`（macOS 用 `-G` 不用 `-w`）。把「监听了什么」和「外部真能连到什么」分两列写进报告——两者之差就是暴露面。

**先验探测器本身，再信探测结果。** 客户端挂着 HTTP(S)_PROXY（Clash 之类，或 TUN 模式在 `198.18.0.0/15` 段劫持）时，`nc -z` 对**任何**地址任何端口都返回 `succeeded`，会得出「11 个端口全部公网 OPEN」这种一眼假的结论。开测前先打三个不可能存在的对照：`nc -G 3 -z -v 20.0.0.1 22`（不存在的公网 IP）、`nc -G 3 -z -v <真实 IP> <高位随机端口>`、以及 `ifconfig` 里有没有 `198.18.0.1` 这个 Clash 假接口。任一对照 succeeded，**本机上所有 socket 探测（含 python `socket.connect`，它也走 TUN）都失准**，不要再换客户端重试。

```
env | grep -i proxy               # 一层代理：有代理键就 --no-proxy 或直连重测
ifconfig | grep 198.18.0.1        # 二层代理：TUN 假接口存在则本机探测全部作废
```

**实测最可靠的取证方式：从目标机自己身上打它的公网 IP。** 公网 IP 的 DNAT 在 `PREROUTING` 上按 destination 生效，`curl http://<目标机自己的公网IP>:<port>/` 若返回 `000` 就说明该端口外部不可达（curl 不受 TUN 影响，因为目标机在云上）；同一次调用里对 `127.0.0.1:<port>` 打一发作对照，两者一对比就分清了「监听」与「暴露」。`nc -G 3 -z -v 20.0.0.1 22` / 20.0.0.1 的对照必须写进报告作为口径声明。

仍拿不到真实可达性时，改用**内网侧证据 + 明确口径**：①目标机 `ss -Htn state established "( sport = :<port> )"` 看谁真的连进来（并发数为 0 是强证据，比任何外部探测都硬）；②同组另一台机器用 `timeout 3 bash -c "</dev/tcp/<ip>/<port>"` 双向实测；③云元数据拿安全组——`169.254.169.254` 超时是这台机器上元数据服务被关或路由不通（常见），不等于被云厂商拦，此时直接看管控台。不要把未验证的 `nc` 结果写成「公网全开」。

## 6b. 修完后核查「防火墙是否真的还生效」——比查有没有入侵更容易漏

批量排查最容易发现的不是植入物，而是**上一轮应急留下的防护已经失效**。只看 `systemctl is-enabled` 会给出错误答案，必须看 `is-active` + 名单文件 mode + 规则是否真在链上：

```
systemctl is-active <unit>; systemctl is-enabled <unit>   # enabled 但 inactive = 重启后没跑过
ls -l /etc/iptables/*.rules                              # mode 644 + 非 root 执行 iptables-restore = 静默清空 INPUT
iptables -t filter -S INPUT | tail -3                    # 规则是否真的在（只看 -S 首行会被 -P ACCEPT 骗）
```

两个典型半失效态：①`iptables-save` 打包出来的快照里混了 `*raw` 表，老版本 `iptables-restore` 对 raw 表中的 INPUT 规则会整体拒绝并退出，「restore 成功」的文件其实一行都没加载；②多个 worker 并行跑同一个 dump/apply 脚本，后写的覆盖先写的，留下无头无尾的残片。**并行写同一份策略文件必须是单台串行，或每台写自己的文件**——parallel 只适合「跑哪些台」，不适合「同时改同一份共享配置」。

一个主机上只保留一套策略引擎。手工加在 INPUT 的白名单/DROP 规则，会被声明式脚本下一次 `start` 全量清掉——所以「哪个 unit 谁写规则」要在同一台机器上查清（`ls /etc/systemd/system/*.service` + `grep -cE 'iptables|nft' <每个 ExecStart 脚本>`），再决定保留哪个、disable 哪个。多台机器共享同一个策略（同 md5 的 `netguard.sh`）是正常成熟形态，不是横向植入；没见过的脚本先 `head -30` 看有没有中文注释+白名单变量，别当 RCE。

## 7. 收尾

远端 `/tmp/hunt2.sh`、`/tmp/ir2*`、`/tmp/d*.sh` 是排查残留，下轮排查时按铁律 3 认自己人；需要的话一并清理，但**取证快照目录永不删**。
