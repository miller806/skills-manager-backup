---
name: linux-intrusion-triage
description: Use when checking a host for signs of intrusion (入侵排查).
---

# Linux Intrusion Triage (入侵排查)

Read-only compromise assessment of a Linux host. The deliverable is a **verdict backed by an evidence chain**, not a list of commands you ran. Every "异常" you report must either be explained (with the mechanism) or escalated with a concrete next command — an unexplained anomaly is an unfinished job.

两种采集方式，产物完全相同（`report.html` 网页版 + `report.txt` 14 段 / `summary.txt` / `samples.tgz` / `samples_manifest.txt`）：

- **`scripts/hunt-linux.sh`（首选）** — 单文件、纯只读，直接扔到目标机本机跑：`scp` 上去 → `bash /tmp/hunt-linux.sh`。不依赖客户端、不需要从本机驱动 SSH，脚本被限权/不许登录时也能交付给对方自己跑。
- 手工两段式（本地驱动 SSH）— 只在需要边看边追问、或单机取某个特定证据时用。

**网页报告内建**：脚本跑完自动出 `report.html`（单文件、内联 CSS、零外部依赖、离线/内网可开、可直接 Ctrl-P 存 PDF）。交付给业务方的就是这个文件，不要手工另做图文。
- 只重渲染、不重采集：`bash hunt-linux.sh --html-only /path/report.txt`（同一份 txt 换样式/补渲染，不用再登机器）。
- 渲染器是 awk 单 pass，低于任何采集成本；不要在目标机上装 python/jq。

判定规则在下文；信号判读表在 `references/benign-vs-malicious-signals.md`；误报清单在 `references/false-positive-checklist.md`；网页渲染器与验收方法在 `references/html-report.md`。

## 铁律

1. **Only read.** No `rm`, no `chmod`, no service restarts, no config edits during triage. Collection scripts may `grep`/`find`/`stat`/`ps`/`ss` and nothing else.
2. **Say "未发现入侵" only after the passive checks pass**, and list which checks passed — a bare "没问题" from an intrusion check is worthless to the user.
3. **Before creating any file on the host, check whether it is your own leftover.** Collections run from earlier sessions leave `/tmp/*.sh`, `/tmp/chec*.sh`, `/tmp/m1.sh` etc. Grep them for write/exfil primitives (`curl|wget|nc|base64|chmod|authorized_keys|crontab|> /|useradd`) — empty output means they are triage leftovers, and you must say so rather than reporting them as implants.
4. **时间窗纪律：任何 CRITICAL 必须有窗口内的时间戳。** 按 mtime 过滤后再判级——一份 2024 年的扫描残留和今天植入的后门，在 `grep -rl` 眼里长得一模一样。窗口外的同特征文件只计数、降级为 INFO，不进取证包（否则 400 条上限会被历史垃圾占满，真样本反而漏采）。
5. **区分「探测型载荷」和「执行型代码」，这决定定性。** `oastify/interactsh/burpcollaborator` 命中的文件默认只证明「有人试过」，不证明「进来了」。必须再单独统计 webshell 代码（`Runtime.getRuntime().exec` / `<%@ page` / `eval($_POST`）和反弹 shell（`/dev/tcp/`、`bash -i >&`、`nc -e`）的数量：两者皆为 0 才能判「扫描/渗透测试遗留」，任一非 0 立即按真实入侵升级。细节见判读表。
6. **文件名不是定性依据，`POC-*` / `MARKER_*` / `*-poc` 这类「看起来像测试标记」的名字两头都骗人。** 真实攻击者同样会用这种命名（伪装成别人家的演练来拖延处置），自家演练也会留下真实外联。定性只认三样：载荷是不是执行型（铁律 5）、有没有向外部域名/IP 外联、有没有数据被打包下载。任一成立即按真实入侵处置，哪怕文件名里写着 POC；三者全无才可在报告里写「疑似扫描/演练遗留」，并且**把结论交给用户确认，不自行清理**。

## Procedure

### 1. Establish identity and blast radius first

```
hostname; uptime; date; cat /etc/os-release | head -3
hostname -I; curl -s --max-time 8 http://169.254.169.254/latest/meta-data/instance-id 2>/dev/null
```
Get the cloud instance id / security group so external reachability can be reasoned about rather than guessed. On AWS, IMDSv2 needs a token first (`X-aws-ec2-metadata-token`); a plain GET returning 401 means v2 is enforced, not that metadata is blocked.

### 2. Accounts and authentication

```
awk -F: '$3==0 {print $1,$3,$7}' /etc/passwd            # UID 0 — must be root only
awk -F: '$7 !~ /nologin|false|sync|halt|shutdown/ {print $1,$3,$7}' /etc/passwd
stat -c '%n %y' /etc/passwd /etc/shadow /etc/group /etc/sudoers
sshd -T 2>/dev/null | grep -E '^(permitrootlogin|passwordauthentication|pubkeyauthentication|maxauthtries|permitemptypasswords|maxsessions)'
```

`/etc/passwd` and `/etc/shadow` mtimes years in the past are the single strongest "no account was added" evidence — quote them.

### 3. Login forensics — success AND failure, by source IP

```
zgrep -h Accepted /var/log/secure /var/log/secure-* 2>/dev/null \
 | awk '{for(i=1;i<=NF;i++){if($i=="for")u=$(i+1); if($i=="from")ip=$(i+1)} print u, ip}' | sort | uniq -c | sort -rn
zgrep -hcE 'Failed password|Invalid user' /var/log/secure /var/log/secure-* 2>/dev/null | paste -sd+ | bc
last -30
last -f /var/log/wtmp-<YYYYMMDD> | head -5     # rotated wtmp — `last` alone only covers the current file
```

`last` reads the *current* `/var/log/wtmp`; after rotation it shows only the last day or two, which looks like "everything is recent". Pull the rotated `wtmp-*` file for the incident window before drawing conclusions about a gap in sessions.

### 4. Process, network, persistence

```
ps -eo user,pid,ppid,pcpu,pmem,etime,args --sort=-pcpu | head -20
ss -tlnp | awk 'NR==1 || $4 !~ /^127\./'
ss -tnp  | awk '$5 !~ /^127\.|^172\.|^\[::1\]/'
ps -eo user,pid,args --no-headers | grep -iE 'xmrig|minerd|kinsing|kdevtmpfsi|/tmp/[a-z0-9]{6,}|nc -e|bash -i >&'
crontab -l; ls -la /var/spool/cron/; find /etc/cron* -newermt '<window start>'
find /etc/systemd/system -type f
```

Correlate every unexplained outbound connection to a pid and a purpose. DB ports (3306), monitoring agents (a known IP:port reporting every few seconds), and CDN/API 443 are normal; say so explicitly instead of leaving them as an unnamed risk.

### 5. Web tier (only if the host serves HTTP)

```
find <webroot> -xdev -type f \( -name '*.jsp' -o -name '*.php' -o -name '*.asp*' \) -newermt '<window start>'
grep -aiE '\.jsp|cmd=|exec=|jndi:|base64_decode|/actuator|\.\./\.\./' *access*log* | tail -20
```

### 5b. 中间件 Web 控制台未授权 = 现成 RCE

Flink 8081 / YARN 8088 / Druid 8888 / Nacos 8848 / RabbitMQ 15672 / Elasticsearch 9200 这类管理端一旦没认证，就是「上传即执行」的入口：不需要 webshell、不落 web 访问日志，**痕迹只留在产品自己的作业列表和日志里**，所以常规 webshell 扫描完全看不见。

```
ss -lntp | grep -E ':(8081|8088|8888|8848|9200|15672)\b'
ss -tnp state established '( sport = :<port> )'
grep -E -i 'security|ssl|auth|bind-address' <product>/conf/*.{yaml,yml,properties}   # 空 = 无鉴权
```

判读要点：**「任务/作业列表里出现大量同名、几秒就结束的条目」是入口证据，不是业务异常。** 当成业务故障去查，会把应急拖成例行排障。Flink 的 jar 载荷解析、回显读取路径和处置顺序见 skill `flink-cdc-ops` 的「一堆同名短命作业」一节。

- **xxl-job admin（默认 admin/123456）的 GLUE 模式 = 不落 webshell 文件的 RCE，痕迹只在执行器的作业日志目录。** 判据一行：`find / -xdev -type d -name gluesource 2>/dev/null`（常见路径 `<app>/applogs/xxl-job/<appname>/<port>/gluesource/`），目录里堆着几百个 `<jobId>_<epochMs>.sh` 就是对方在批量下发；`head -c 120` 抽第一个看，`id; hostname`、`id > /tmp/x.txt`、`cat > /tmp/q.json` 这类一行式探测即实证。同一批落地物里常伴随 `/dev/shm` 下的 base64 admin token（`{"id":1,"username":"admin",…}`）——那是「怎么进来的」的答案，直接进证据链。处置顺序：先查 `xxl_job_info` 有无新增 jobId 再谈删脚本，否则任务会重新投放。

### 6. External reachability — measure it, do not infer it from `ss`

A listener on `0.0.0.0:6379` is not an exposed Redis if the cloud security group drops it. Probe from outside and report the measurement:

```
for p in 6379 8848 9000 111; do printf '%-6s ' $p; nc -G 4 -z -v <ip> $p 2>&1 | tail -1; done
```

**开测前先验探测器：先对「不存在的 IP」和「真实 IP 的高位随机端口」各打一发。** 客户端挂着 `HTTP_PROXY`/`HTTPS_PROXY` 或 Clash TUN 模式（本机多出 `198.18.0.1` 接口）时，`nc -z` **和 Python `socket.connect`** 对任何地址任何端口都返回成功，结果会是「每个端口全部 OPEN」——这不是暴露面，是代理想当然。对照组命中成功就**别再换客户端重试**，改用不受客户端网络影响的方式：从目标机自身打它的公网 IP（`curl -m4 -w '%{http_code}' http://<自身公网IP>:<port>/`，`000` = 外部不可达；公网 DNAT 在 PREROUTING 按 destination 生效，所以这一发真的走了一遍外部路径），或读目标机 `ss -Htn state established "( sport = :<port> )"` 并发数（0 = 没人连进来）。报告里写明口径；没有验证过的 `nc` 数字不要写进「公网暴露面」。

Report both halves: what is listening, and what is actually reachable. The gap between them *is* the answer to "暴露面有多大".

### 7. Attribute suspicious keys before calling them suspicious

For every line of every `authorized_keys` (root and every login-capable user):

```
while IFS= read -r l; do [ -z "$l" ] && continue; printf '%s\n' "$l" | ssh-keygen -lf - ; done < /root/.ssh/authorized_keys
ssh-keygen -lf <your-own-private-key>            # local comparison
```

A fingerprint matching a key you hold locally means the entry is **your own operator key** — state that and move on. The login log itself carries the same fingerprint (`Accepted publickey … SHA256:xxx`), so a key in `authorized_keys` that also appears in every `Accepted` line is a used-and-known key, not silent persistence.

### 7b. 复扫（用户说「再扫一次」/ 同一批机器第二轮）

用户第二次说「扫一遍」时，交付物**不是又一份同样的报告**，而是「上一轮的处置到底生效了没有」。上一轮的残留物会把 IOC 扫描原样再报一遍（见 铁律 3、`references/fleet-multi-host.md` §2），所以先把**上一轮的整改清单逐条实测**，再谈有没有新入侵：

1. **先捞上一轮的结论与清单**：本机 scratch 里上一轮的 `fin/`、`out/`、`delete-manifest*.txt`、`evidence-*` 目录就是基线。没有基线就明说「这轮是首次、无法对比」，不要拿本轮数字冒充「已改善」。
2. **凭据轮换要按「运行中的进程」验收，不是按配置文件**。库端值、配置里的值、`/proc/<pid>/cmdline` 里的值三处必须一致才算换完：
   ```
   ps -eo args --no-headers | grep -o 'access-token=[A-Za-z0-9]*' | sort | uniq -c
   for p in $(pgrep -f '<jar>'); do tr '\0' ' ' < /proc/$p/cmdline | grep -o 'access-token=[A-Za-z0-9]*'; done
   ```
   登录类应用常见**启动参数里写死 token/password**（PM2 json 的 `args`、`-Dxxx.access-token=`、`--spring.datasource.password=`），改了 yml/改了库但没重启进程、或只改了其中一处，运行时仍是旧值 —— 报告里要写「旧 token 仍有效，等于没轮换」，不要写「已轮换」。
3. **防护规则按链路验收**：`iptables -S <链>` 要看**规则实际在哪个链**。docker 主机的业务端口走 `DOCKER-USER`（DNAT 后的流量不经过 INPUT），只在 INPUT 上找 DROP 会得出「全裸」的错误结论，反之亦然。同一台上两者都查。
4. **逐项给数字**：恶意进程 0 / 新落地物 0 / 新登录源 0 / 窗口内 web 后缀文件 0 / gluesource 0 ——上一轮是 662 个载荷，这一轮是 0，才是「处置有效」的证据。

### 8. 多机批量排查（fleet / 一次查 N 台）

单机报告讲细节，多机报告的价值在**分辨率**：哪台失陷、哪台只是被探测、哪台只有暴露面。驱动脚本、轮询与回传细节见 `references/fleet-multi-host.md`。

1. **先跑轻量 IOC 扫描**（进程 / `/tmp`·`/dev/shm` 残留 / cron / 监听 / established / 已知 C2 IP），几分钟出结果，用它决定哪几台要深挖；全量 `hunt-linux.sh` 同时后台并行跑，不阻塞 IOC 判读。
2. **全量一律 nohup 后台**：`scp` 上去 → `rm -rf $OUT; nohup bash /tmp/hunt.sh --days 14 --out $OUT >$OUT.log 2>&1 &`。完成标志只看 `$OUT/report.html` 是否存在，不要 tail 日志干等。
3. **轮询 20s × N 次**，不要一次长 sleep；完成后**逐文件 `scp` 回传**（`report.html`/`report.txt`/`summary.txt` 一次一个），把多个远端路径塞进一个参数会静默失败。
4. **汇总交给代码**：解析每台 `report.txt` 的 `### SECTION:` 切段，只打印含 ⚠ 的行做横向对比，别用眼睛扫七份报告。
5. **分层结论**：`已失陷`（有执行回显 / 凭据抓取 / 持久化落地物）> `被探测`（只有上传探测文件、无持久化）> `干净`（无落地物，只有暴露面）。同一批次三种都会同时出现，别因为一台失陷就把整批写成失陷。
6. **横向必查**：全批次 IP 的常见管理端口外部可达性（§6 的 `nc -G 3 -z -v`），以及同一 IOC 是否出现在多台——同特征多机命中意味着横向移动，攻击窗口要按最早那台算。

## 无法登录目标机时：离线模拟验证

用户说「你不能登录这台机器」不是让你空口交付。用本地 docker 把脚本**真跑一遍**，覆盖三类现场：

```bash
docker run --rm -v $PWD/hunt-linux.sh:/tmp/hunt-linux.sh:ro -v $PWD/setup.sh:/tmp/s.sh:ro ubuntu:20.04 \
  bash -c 'bash /tmp/s.sh; bash /tmp/hunt-linux.sh --days 30 --out /tmp/o --no-pack'
```

`setup.sh` 里造三个场景，逐个断言预期判级（这是唯一能证明「不加噪、不漏报」的方法）：

| 场景 | 造什么 | 预期 |
|---|---|---|
| A 历史残留 | 2024 年的 XXE/SSI 载荷 + `touch -d` 回拨 mtime | CRITICAL 0，INFO 计数 >0 |
| B 今日后门 | `/tmp/.x.sh` 里写 `/dev/tcp` 反弹 shell | CRITICAL ≥1，判读为「按真实入侵处置」 |
| C 混合 | 老残留 + 今日 `shell.jsp` + cron.d 目录 + 系统 `pam_permit` | CRITICAL 只计 webshell，cron/PAM 不报或少报 |

镜像选 `ubuntu:20.04` 而不是最新版：老 `bash`/老 `dpkg`/无 `rg`，最接近客户生产机。验证完必须贴出 `bash -n` 结果、每个场景的实际判级行，以及破坏性命令扫描（`grep -nE 'rm |mv |kill|chmod|useradd|systemctl (stop|restart)'`）为空的证据。

## 判读：benign 还是 malicious

Details and the full table: `references/benign-vs-malicious-signals.md`. The three that cost time:

- **One pid flooding tens of thousands of `error: no more sessions` lines is an SSH multiplexing client, not an attack.** Verify: the pid is the *only* pid producing that message; the first and last timestamps bracket exactly one session's `session opened`/`session closed` pair (`sshd[<pid>]`); the live `/var/log/secure` currently has 0 such lines; the count in the rotated file dates from a single long-lived connection. Mechanism: a VS Code Remote-SSH / Gateway-style client opens more channels than `MaxSessions` allows and sshd logs an error per rejected channel. Say "日志噪音" and name the client.
- **Thousands of `Failed password` from one IP with zero `Accepted` from it is scanning, not compromise.** Report the accepted-login table separately from the failure counts; brute force only matters when it lands an `Accepted`.
- **An `Accepted` login from the office egress IP attributed to `root` is the运维 conversation itself.** Map every accepted source IP to a known operator before treating repeated logins as suspicious.

## 处置阶段（用户明确说「清掉」之后才进入）

排查阶段只读（铁律 1）。进入这一段前先问一句「这台机上现在还有没有正在进行的测试/演练」——**不要用文件名自己回答这个问题**（铁律 6）。

顺序固定，前一步不做完不进下一步：

1. **先快照，再动手。** `EV=/root/evidence-$(date +%Y%m%d)`，`cp -a` 进 cron / nginx conf.d / opt 载荷目录 / tmp / `authorized_keys` / `ps` / `ss`，webshell 目录 `tar czf`。几百 MB 是正常代价，比不可恢复便宜。
2. **先列清单，后删除。** 生成 `delete-manifest-<hhmm>.txt` → `sort -u` → 按目录分类计数打印 → 逐条确认没有业务文件混进来。哈希命名的上传件必须 `file -b` + `head -c 150` 看内容再决定（`<svg><script>alert(1)</script>` 是 XSS 探针、1x1 PNG 是探测载荷，不是业务图片）。
3. **不要停用系统服务。** 只删恶意条目、保留系统条目：`logrotate`/`sysstat`/`e2scrub` 依赖 cron，`systemctl stop cron` 是过度处置，等于给机器留一个「重启后不轮转日志」的新故障。拿快照目录做白名单基准——遍历 `$EV/cron/*`，跳过系统项，其余才进清单。
4. **按名字模式全盘跑一遍，再复查一遍。** 路径穿越能写到 web 根以外任何位置（`/web /opt /home /srv /var/www /usr/local /etc /root` 都可能命中），只清上传目录会反复「复活」。用 `-xdev` + 明确根目录列表，不要裸全盘 `grep -rl`（必超时）。
5. **复查要给数字，不给形容词**：恶意进程 0、异常监听端口 0、`/etc/cron.d` 只剩系统文件、窗口内 webshell 后缀文件 0、`/etc/ld.so.preload` 不存在、`authorized_keys` 只有已知 key、业务进程数与本地探活 HTTP 码。
6. **必须回答「攻击是否仍在进行」**：看 nginx access log 最后一条时间戳（`grep -a` 取）。还在打就先 `conf.d/00-block-attackers.conf` 里 `deny <ip>;` + `nginx -t && nginx -s reload`，并在汇报第一行写明。封 IP 只是止血，入口（上传穿越 / actuator 未授权 / 中间件控制台）不修，换 IP 就能再进来——汇报里要把「已止血」和「已修复」分开写。
7. **删完账号别急着收工，会话层凭据要单独吊销。** 删库里的用户、改口令、删接口都不会让已签发的 token 失效：token 存在 redis / oauth2 表里，TTL 未到就照样能调业务接口，用户的现象是「接口都删了怎么还能用」。查法与吊销清单见 `references/session-token-revocation.md`；验收必须用旧 token 重放一次拿到 401，而不是报「已删 N 个 key」。

多根目录清单、manifest 脚本骨架、误伤防护、封堵生效性验证见 `references/containment-blocking.md`；`/tmp`·`/dev/shm` 残留（攻击者私钥、自写 DB 客户端、探测输出）的快照→清单→删→复查四步模板与判读表见 `references/tmp-residue-cleanup.md`（同文件的 §5 覆盖「清掉自己历次排查留下的脚本」：plan/apply 两段式现成脚本 `scripts/ops-triage-cleanup.sh`、报告先归档、root 文件需 sudo、大目录先 `du -sh` 复核）。

## Pitfalls

- **On this Mac, SSH to fleet hosts needs `-o BindInterface=en1`.** The machine is dual-homed (en1 = internal 192.168.x); with the default route on the other interface, a plain `ssh` to some hosts is accepted then dropped with `Connection closed by <ip> port 22`, which looks exactly like a host-side firewall. If a connection that worked minutes ago closes instantly, retry with `BindInterface=en1` before diagnosing the remote side. Also pass `-o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=12`.
- **`ssh_exec.py`/remote calls have a 30s ceiling — split compound collections.** Pipe a script (`ssh … 'bash -s' < script.sh`) instead of a long one-liner chain; one script per phase, and keep each phase's grep bounded. A single giant script times out and loses everything with it.
- **Do not report `/tmp/*.sh` as implants without the provenance grep.** Their names (`chec.sh`, `k1.sh`, `m9.sh`) look like attacker staging but are the previous triage session's own scripts.
- **自己上传的脚本一律用 `ops-triage-<YYYYMMDD>-<用途>.sh` 命名，禁止 `ioc2.sh` / `hunt*` / `nb.sh` / `nssh` / `o_1280297` 这类名字。** 攻击风格或裸名字的脚本在下一轮排查里就是误报源，也会让用户怀疑「是不是被入侵了」。采集输出目录用 `/tmp/ops-triage-<date>-out/`；不留 0 字节半成品；一次性脚本用完即删，需要保留的放 `/root/evidence-<date>/`。验收口径：`ls /tmp` 时每条都能从文件名看出「运维排查、哪天生成」。
- **采集脚本会把自己抓成样本，而且只在第二次运行时暴露。** `report.txt`/`report.html` 里含 `### SECTION:` 和 IOC 正则原文（网页版的内联 CSS/正则示例夹着 `oast.live`、`/dev/tcp/`），`grep -rl /tmp` 会把脚本自身、`tee` 落盘的终端输出、**以及上一次采集的 `out2/` 目录**全算成 OOB 载荷。只排除 `$OUT/` 不够——历次输出目录名不同，必须按「是不是本工具的产物」判断：文件名命中 `report.html|report.txt|summary.txt|samples_manifest.txt|run*.log`、或所在目录同时有 `samples_manifest.txt` / (`report.txt`+`report.html`)、或 head 120KB 内含 `### SECTION:` / `LINUX HOST INTRUSION TRIAGE`。取 120KB 而不是 4KB：网页版把正文推到 100KB 之后，小窗口会漏判。打包与清单逻辑要复用同一个判定函数，否则历史报告会被装进取证包。
- **脚本改动必须在真机连跑两次才能验收。** 自指类误报（自己抓自己、历史输出目录、上一轮 log）第一次跑不出来——第一次运行时那个目录还不存在。用不同的 `--out` 连跑两轮，第二轮 `CRITICAL/WARN` 数字回落、且两次唯一差值是新增的会话行，才算修好；只跑一轮就宣布「误报已消除」是把问题留给下一次。
- **`dpkg -S` 归属是抑制误报的主力，但对 conffile 天然失效。** `/etc/cron.d/*`、`/etc/apt/apt.conf.d/20auto-upgrades` 这类 conffile 查不到归属，会被当成植入——必须叠加 `-newermt "$SINCE"` 做与运算。反过来，`/usr/lib/systemd/system/*.service` 这类打包 unit 能查到归属，就该标 `[pkg]` 备查而不是报 ⚠️。
- **完整性校验只看二进制，别看文档。** `dpkg -V` 对 `/usr/share/doc`、`/usr/share/man`、`/usr/share/locale` 的 md5 差异在裁剪镜像、装了语言包、或者 `gzip` 版本不同的机器上普遍存在，几十行全是噪音。过滤成只留 `/bin/ /sbin/ /lib/ /usr/lib/` 且排除 `doc|man|locale`。
- **`dpkg -V` 要跑在后台，且必须用 root。** 负载高的机器（load 10+、上千个包）上一次全量校验会超过 SSH 工具的 30~60s 上限，前台跑必超时且丢掉全部输出。写法：`nohup bash -c 'dpkg -V > /tmp/.d.txt 2>&1; echo done >> /tmp/.d.txt' &`，靠文件末尾的 `done` 判完。非 root 跑会多出一批 `??5?????? c /etc/security/limits.conf`、`/etc/at.deny`、`/boot/System.map-*` 以及 `unable to open ... Permission denied` 警告——那是权限不是篡改，必须 `sudo -n dpkg -V` 重跑再下结论（`/usr/local/share/aliyun-assist/*` 这类云助手自带文件即使 root 也会报差异，属正常）。
- **cron 持久化必查 `/etc/crontab` 的内联行，不能只扫 `/etc/cron.d/`。** 按名字删掉 `/etc/cron.d/` 下几十个文件后，`/etc/crontab` 里那行 `* * * * * root /bin/bash /tmp/xxx.sh` 仍在，即使脚本文件已被删，条目照样每分钟拉起——「已清理」四个字立刻失真，而且条目会指向一个不存在的文件，看起来像无害残留。验收不看文件在不在，看日志：`grep -a 'CRON\[' /var/log/syslog | tail` 列出**实际执行**的命令行，条目来自哪个文件都逃不掉；`grep -ac` 给累计次数，用它算「还剩几小时没清」。
- **攻击者脚本里出现的凭据一律按已泄露处理，汇报里点名系统和账号。** `/dev/shm/*.py` 这类带 `host/port/user/password/db` 的一次性客户端说明对方已经能连库；只删文件不轮换口令等于没处置。P0 项里单独列「轮换 <系统> <账号>」，不要塞进「清理可疑文件」里一句带过。
- **`/var/spool/cron/{crontabs,atjobs,atspool,anacron}` 本身就是目录** —— 扫「cron 里出现目录 = 攻击者 mkdir 手法」时只扫 `crontabs` 子目录，扫整个 `/var/spool/cron` 会把三个系统目录当 CRITICAL。而且这条命中要降 WARN 并写明「cron 会报 NOT A REGULAR FILE 并忽略，未生效」。
- **`pam_permit.so` 是发行版自带**（`/etc/pam.d/other` 默认就有），不是后门。只认 `pam_exec`/`pam_python`/`pam_script`。
- **带 JNI 导出符号的 `.so` 是业务自研 SDK，不是库劫持。** 判据一行：`nm -D --defined-only /usr/lib/libxxx.so | grep -c ' Java_[A-Za-z0-9_]*_'` > 3 即业务库（库名带业务前缀、包名如 `com.<brand>.crypto.*`、被 `/proc/<pid>/maps` 正常映射、jar 内加载所以 `grep -rl` 在 bin/conf/script 里查不到引用，都是配套证据）。库劫持的特征是**被别人 dlopen/预加载**（`LD_PRELOAD`、`/etc/ld.so.preload`），不是自己导出几百个 JNI 入口。别把「dpkg 无归属 + 近窗口内变更」直接报成劫持。
- **`/usr/lib/modules/*` 下的 `modules.softdep` / `vdso*.so` / `modules.*.bin` 无 dpkg 归属是正常的**——内核包构建产物，dpkg 有意不登记。无归属扫描要在 `dpkg -S` 之前按路径前缀跳过 `/usr/lib/modules/*`、`/lib/modules/*`，否则每台机器每次都给一条 WARN。
- **GUI SSH 客户端会派生出 `bash -c` 进程，看着像 webshell 触发。** FinalShell 的探针长这样：`bash -c export LANG=…; free; echo finalshell_separator; uptime; cat /proc/net/dev; df`；Xshell/MobaXterm/Termius 也有同类心跳命令。`shell -c` 扫描要带 `grep -vE 'finalshell_separator|Xshell|MobaXterm|termius'`，判读时点名「运维 GUI 客户端监控面板」。真正的 webshell 派生是 `sh -c '<来自 HTTP 参数的单行命令>'`，父进程是 web 容器进程。
- **established 对端出现「已退役 / CMDB 里已删」的 IP 时，先按已沦陷处理。** 台账是期望态不是现实态：机器还在发连接就说明它活着，而且很可能是攻击跳板或 IP 被复用。不要因为台账上没有它就把这条连接跳过，也不要顺手把它写成「无害的历史记录」。
- **`requirepass` set + `protected-mode no` + `0.0.0.0` is a real finding even when the security group currently blocks the port.** Report it as hardening (bind 127.0.0.1), not as an intrusion; do not restart Redis to fix it during triage.
- **上传目录里成百上千的样本，先看时间聚集度再下结论。** 398 个文件全落在同一个 42 分钟窗口、文件名只有十来个技术族前缀（`XxeSvg*`/`SsiBfRce*`/`GsOutputFile*`）、每个载荷带唯一 `NN.<32位>.oastify.com` 子域 —— 这是扫描器单轮跑完的产物，不是多波次人工入侵。反过来，样本横跨数月、文件名随机、且混入 webshell 代码，才是真实攻击者在反复试探。

- **清理阶段的宽模式 `find` 会把取证快照目录一起删掉。** `find /opt /web /tmp /etc /root -name 'notice*' -o -name 'i[0-9]*'` 这种写法，`/root/evidence-<date>/` 里躺着的正是同名原件，扫一遍等于把证据删了。要么把 `$EV` 放进 `-prune`，要么根目录列表里不写 `/root`。执行前先 `find … | grep -c evidence`，看到快照路径立刻收窄范围——快照目录名和载荷文件名撞车是必然的，不是巧合。
- **`grep` 在 nginx access log 上会返回 `Binary file … matches` 而不是匹配行。** 日志里混进过乱码后，`grep -E '<ip>'` 只给你这一行、拿不到时间戳，看起来像「攻击停了」或「日志坏了」。用 `grep -a`；统计条数用 `grep -ac`。
- **「清完之后进程又自己起来了」先别认定还有漏掉的持久化。** 拉起它的可能是你刚刚还原过的现场（处置中途恢复过就一定会发生），也可能是 `/etc/`、`/usr/local/` 下另一份同名载荷。判据：`ps -o lstart` 的启动时间对上你上一步操作的时间点，以及 `ls -d /opt/<name>` 是否真的重新出现在磁盘上。两样都空 = 是你自己的动作，不要去追不存在的后门。
- **处置后业务目录可能被攻击者「顺手」铺了一层。** 路径穿越的可写面包含 web 根以外的 `dist/`、`nginx/html/`、各站点目录，清理只覆盖应用 `storage/` 时会留下一地 `i<id>p.txt` 之类回显文件。验收口径是「按名字模式在全部 web 根下 `-xdev` 扫完为空」，不是「应用目录为空」。
- **「攻击是否已停止」按最后一个攻击特征文件的 mtime 判，不按当日总命中数。** 执行器日志里 `uid=0(root)` 命中 46 个文件看着像一直在打，实际全落在 08:09→09:53 一个窗口，之后为 0。做法：命中文件按 mtime `sort | cut -c1-16 | uniq -c`，再单独算「指定时刻之后新增」的条数，两个数字一起报。
- **执行器端口白名单要覆盖该应用的所有监听端口，不能只盖主端口。** 同一个 XXL-JOB 执行器 jar 常同时监听业务端口和 `-Dserver.port` 指定的备用端口（实测 `ubs-job-server.jar` 同时听 `12000` 与 `8700`，两个端口的 `/idleBeat` 都返回 200）。只给 12000 做入向白名单时，`8700` 就是完整的绕过通道。验证方法：`for p in $(ss -ltn | grep -oE ':[0-9]+' | tr -d :); do echo "$p guard=$(iptables -S INPUT | grep -c -- "--dport $p .*DROP")"; done`，把每个 `guard=0` 但 `/idleBeat` 返回 200 的端口都补上规则。
- **清理脚本自己的备份目录会被下一轮扫描当成新载荷。** 归档路径 `/root/incident_glueclean_*/gluesource/` 里的文件名和结构跟真实载荷目录一模一样，`find -type d -name gluesource` 必然命中，`head -c 60` 看到的就是自己写的 `echo PROBE_*`。判据：路径含 `incident_`，且内容是自己打 RCE 探测时用的那行。删掉归档副本并重扫，不要把备份目录报成「还有残留」。
- **`find / -xdev -type d -name gluesource` 在客户端会超时，且不必全盘。** 用 `find /web /udun /opt /var /root -xdev -name gluesource`；实测目录落在 `<app>/applogs|logs/xxl-job/<app>/<port>/gluesource`，`null` 作为 appname 是正常现象（执行器没配 appname）。清空后目录存在但 `ls | wc -l` = 0，这是正确状态，不是「清理失败」。
- **gluesource 扫描禁止写死单一路径，必须先通配枚举再逐目录计数。** 写死 `/web/app/logs/xxl-job/null/0/gluesource` 会让「干净的机器」结论直接失真：另一台的路径是 `/web/app/logs/xxl-job/<appname>/<port>/gluesource`，实测漏掉过 662 个载荷（该机 12100 端口还在监听，属于活口）。正确写法：`ls -d /web/app/logs/xxl-job/*/*/gluesource /web/app/logs/xxl-job/*/gluesource <其它根>/*/*/gluesource 2>/dev/null`，逐个目录输出 `n=` 并汇总 `glue_total`；`glue_total=0` 才能写「无载荷」。
- **自己打的 RCE 探测请求会在执行器上落一个 gluesource 文件，收尾必须清。** 验证「旧 token 是否仍可用」时 `POST /run` 带 `glueSource: "echo PROBE_$(hostname)"`，执行器会把它落成 `<jobId>_<n>.sh`，收尾扫描就会看到「还剩 1 个载荷」。识别方法：`head -c 200` 看到的就是自己写的那行 `echo PROBE_*`，mtime 对上探测时刻——是自己留的，不是漏网后门，删掉并在汇报里注明。
- **XXL-JOB 的 accessToken 是 per-group 的，不是全局一个值。** `xxl_job_group` 每个 appname（`ubs-job`/`easynode-job`/`warehouse-job`/`warehouse-flow-job`/`udun-job`）各有一行独立 token，同一个值不会跨组复用。轮换时必须：①`SELECT id, app_name, RIGHT(access_token,8) FROM xxl_job_group` 列出全部组；②按组分配新 UUID；③改库 `WHERE id=<组>`；④逐台改对应 `/udun/conf/ubs/<该服务>.yml`。只换一台机器的 job.yml 而不同步库（或反之）会让执行器注册失败。核对时打印 `head=前8 / tail=后8`，比 `grep -c` 更可靠。
- **先查 `xxl_job_registry` 再决定能否安全轮换。** 注册表为空说明这些组当前没有执行器在线注册，轮换不会打断线上调用；若有在线执行器，轮换后必须重启对应进程并等 `Started ... in Ns`，期间执行器不可用。
- **远端替换配置优先用 `sed -i`，不要假定有 `python3`。** CentOS/Amazon Linux/Rocky 的老机器（实测 srv-33 amzn-2）没有 python3，脚本里写 `python3 - <<PY` 会静默失败、文件一个字节都没改，而脚本其余部分照常输出「已处理」——极易误判为成功。改成 `sed -i "s/$OLD/$NEW/" "$f"` 后再 `grep | sed` 回读校验。
- **执行器端口的入向白名单要按「调用方」放行，不是按网段。** 执行器 `/run` 只应被 admin 调用，`-s 192.168.2.0/24 -j ACCEPT` 等于给内网任何一台失陷机器留了 RCE 入口（攻击者本来就从内网横向打过来的）。正确：`-s <admin_ip>/32` + `-s 127.0.0.1/32` ACCEPT，其余 `-A INPUT --dport <port> -j DROP`。
- **一个主机上只留一套策略引擎，声明式脚本会全量抹掉手工规则。** 手工 `iptables -I INPUT` 加的白名单/DROP，会在下一次 `netguard.sh` / `incident-iptables.service` 这类「先删自己管的规则再重建」的脚本执行时消失，而脚本本身照常输出 `applied` ——看起来加固过、其实回到裸奔。改策略只改声明式脚本里的 `PORTS/NETS/ALLOW_RULES` 变量；确认主机上哪几个 unit 会写 iptables（`grep -lcE 'iptables|nft' $(grep -l ExecStart /etc/systemd/system/*.service)`），保留一个、把其余 disable。
- **「防护还在不在」要看四样，只看 `is-enabled` 会得出相反的结论。** `systemctl is-active`（enabled 但 inactive = 重启后从未执行）+ 名单文件 `mode`（644 时非 root 执行 `iptables-restore` 会静默清空 INPUT）+ `iptables -t filter -S INPUT` 是否真有规则（首行 `-P INPUT ACCEPT` 不代表没有规则，也不代表有）+ 快照 mtime 是否晚于策略变更。`iptables-restore --test` 返回 0 也不保证全量加载：`iptables-save` 快照里混了 `*raw` 表时，老版 `iptables-restore` 会部分拒绝并退出。
- **token 轮换后必须重启进程才生效，别拿「文件已改」当完成。** 校验口径是「用旧 token 打 `/run` 必须失败、新 token 必须返回 `code:200`」，而不是 `grep` 配置文件。重启后 Java 应用约 30–45s 才恢复监听，`ss` 看不到端口属正常启动中，用循环等待而不是立即判定失败。

- **登录类/中间件服务的凭据常直接躺在进程命令行上，`ps` 就能拿到；按「已泄露」计入 P0。** `pgrep -af java` 里看到 `--spring.datasource.password=`、`-Dxxx.access-token=`、`--eureka.client.serviceUrl.defaultZone=http://user:pass@` 时，任何能登上这台机的账号（含无 sudo 的业务账号）一句 `ps` 就拿到明文，不受文件权限保护。这类发现属于**加固项不是入侵证据**（除非同时有被利用痕迹），汇报里单列「<系统> <账号> 凭据在命令行明文暴露」，给改法（`--spring.datasource.password-file`、环境变量、`/etc/<app>/secret.env` 600），并配���「轮换」——只删日志或改文件权限不解决问题。
- **判断「凭据暴露」要先分清内网与公网**：同一批机器上，安全组经常已把公网挡住而内网全通（同 VPC 任意机器可连 3306/6379/9092）。结论写「内网敞口、公网已挡」，不要因为公网打不通就把整条降级成「无风险」。
- **「日志里不该成功的请求返回了 200」不能直接当成功看，也不能直接当误报压掉。** 先做三件事再下结论：①确认 `log_format` 里那两个数字到底是什么（`$upstream_response_time` vs `$request_time`），`$upstream_response_time` 有值才证明请求到了后端，否则是 SPA/静态兜底；②看 `GlobalExceptionHandler` 有没有 `@ResponseStatus`——只有 `@RestControllerAdvice` 时，**所有业务异常都返回 HTTP 200**，错误码在 body 里，200 与「读到了文件」是两回事；③拿正常业务接口（如验证码）的耗时做对照，200 组耗时和正常业务一致、404 组明显更慢，就说明 200 是后端抛异常快速返回、路径根本没命中。全程不要把「200 次数」写进结论段，写「到达后端但为错误体」+ 支撑数字。
- **接口「已经删了」要按字节码核对，不是凭印象。** 两层都搜：类名（`FileController.class`）和 `@RequestMapping` 字面量（`infra/file`），并且**必须覆盖 `BOOT-INF/lib` 下的全部依赖 jar**——controller 常常不在主 jar 的 `BOOT-INF/classes` 里，只解主 jar 会得出「接口还在」的错误结论，逐个解依赖 jar 才会发现它真的不存在。搜不到路由字面量时，剩下的命中多半是「拼 URL 的模板字符串」（如 `formatFileUrl`），不是路由。
- **用当前现场复现历史行为会拿到假阴性。** 处置过程中你已经改过 nginx、加过 `global-guard.conf`、封过 IP，再拿当时的 URL 去请求得到 403/404，证明的是「你后来加上的防护生效了」，不是「当时攻击者也被拦住了」。复现前先确认：拦截规则文件的 mtime 是否在你处置的时间点之后、备份里有没有这套规则。没有旧配置就先还原到备份状态（或直接读原始 access log），别用现网状态去反驳历史日志。

其余误报（含 `pam_permit`、`sqlite-jdbc` 临时库、FinalShell 监控、文档 md5 噪音等 12 条）已收进 `references/false-positive-checklist.md`，采集脚本里对应位置都已修掉。

## 报告格式（this user）

Chinese, verdict first, then evidence, in compressed code blocks with aligned columns — no markdown tables (Discord doesn't render them), no image cards.

```
## 一、结论
入侵判定：未发现入侵 / 疑似入侵
- 每条结论一行，带数字

## 二~N、按维度分节，每节一个代码块
（账户 / 登录 / 完整性 / 网络 / 暴露面）

## 最后：建议加固
⚠️ 每项一行，附具体命令，区分"加固"与"入侵"
```

- 多机排查用「一台一行」的分层结论块（代码块 + 对齐列，不用 markdown 表格），先给判定，再给时间线和 P0/P1/P2：

```
主机   角色             判定      关键证据
──────────────────────────────────────────────────
65     marketing 门户   ⚠️ 已失陷  cron 条目仍在每分钟触发
237    业务节点         ⚠️ 已失陷  PG 凭据抓取脚本 + xxl-job token
102    ubs-uat-03       ⚠️ 被探测  仅 /tmp 探测文件，无持久化
110/187/116  干净        ✅ 无落地物（但管理端口全裸奔）
```

- 时间线单独一段，一条一行「时刻 + 动作 + 落地物」，让用户能自己判断攻击节奏；P0/P1/P2 每条都写「立即/今日/本周 + 具体对象」，不写「建议加强安全」。
- 每条结论必须能追溯到本节的一个具体数字或时间戳；没有证据的行删掉。
- **网页和口头汇报的数字必须是同一个口径，且写在卡片上。** 统计「成功登录」时脚本用的是 `zgrep auth.log*`（含 `.gz` 轮转），当前 `auth.log` 只有 22 条而总数是 56——差异不是 bug，是窗口不同。卡片底注直接写「auth.log* 含轮转」，别让用户自己猜；汇报时也不要拿另一个口径的数字去对照。
- **批量加固是写操作，不是排查（铁律 1）。** 排查报告里发现「防护半失效」时，不要边查边改：先把结论交给用户，得到「修掉」的许可再进处置阶段；改之前 `mkdir -p /root/evidence-<date>` + `iptables-save > $EV/iptables-before-<hhmmss>.rules` + `cp -a` 被替换的 unit 与脚本，改完立刻 `iptables-save > $EV/iptables-after.rules`，汇报里给出修复前后两份快照路径。
- **不要用视觉模型判断整页长图。** 一两万像素高的截图进去只会得到含糊描述。核对渲染结果用 JS 读 DOM：`document.querySelectorAll('section').length`（章节数）、`[...document.querySelectorAll('.sc')].map(e=>e.innerText)`（统计卡）、`querySelectorAll('.l.cr|.l.wn').length`（汇总节高亮）。视觉检查只留首屏一屏。
- ⚠️ 只标注真正需要动作的项，并说明是"入侵证据"还是"加固建议"——混在一起会让用户误判严重性。
- **处置阶段的汇报，第一行就是「攻击是否仍在进行」。** 然后在同一个代码块里给「已止血 / 已清理 / 仍未修复」，三段分开写；不要把「封了 IP」说成「修好了」。最末明确列出「需要你或开发决定」的项（入口代码修复、host key 轮换等有中断风险的动作），并说明中断代价。
- 结尾问一句是否要把该次排查沉淀为脚本/文档，不要自行创建。
