# 失陷主机的 /tmp 残留清理（四步模板）

适用：上一轮已止血（C2 已 DROP、cron 已清、gluesource 已删），本轮只需拔掉 `/tmp` `/dev/shm` 里攻击者留下的工具与回显文件。特征是**文件小、时间聚集在一个窗口、无包归属、内容是探测/横向工具**。

同一条流程也用于**清掉历次排查自己留下的脚本**（用户说「tmp 下那些 ioc 脚本是你的吧，删掉」）。两者清单口径不同，但步骤完全一致：判归属 → 归档 → plan 预演 → apply → 复查数字。

## 0. 先判归属，别把上一轮自己的脚本当植入

清理前必做：`ls -la --time-style=full-iso /tmp/*.sh` + `head -c 260` 逐个看内容。判据：

```
本工具/我的残留   文件名命中 hunt*/clean*/ev*/n*.sh/j*.sh，内容里是 grep/find/ss/pm2
攻击者残留        自写客户端（protocol 实现）、探测输出、抓到的页面 HTML、私钥
```

时间是最好的分辨器：攻击窗口（本例 08:09→09:56）内的文件是攻击者的，清理阶段（10:2x 之后）的是自己的。文件名不带时间信息，只能用 mtime 分。

## 1. 快照（几百 KB，别省）

```bash
EV=/root/evidence-clean-$(date +%Y%m%d)-<host>
mkdir -p $EV/tmp-final
cp -a /tmp/.notice-k /tmp/.notice-d $EV/tmp-final/ 2>/dev/null
for f in nk1 nr nr2 nstat nssh2 lg .m np1.* np2.* npb.* nph.* nps.* npsd.* npt.* nptg.* n60_probe.txt; do
  cp -a "/tmp/$f" "$EV/tmp-final/" 2>/dev/null
done
ls -1 $EV/tmp-final | wc -l        # 必须等于待删数量，不等就是漏拷
```

点开头目录（`.notice-k`）用 `cp -a` 整目录拷，不要 glob `.*` 去拷 `/tmp`。

## 2. 清单落文件，再逐条删

```bash
cat > $EV/delete-manifest-tmp.txt <<'EOF'
/tmp/.notice-k/k
/tmp/.notice-d/my.py
...
EOF
wc -l < $EV/delete-manifest-tmp.txt     # 与快照数对齐
while read -r f; do [ -e "$f" ] && rm -f "$f" && echo "  rm $f"; done < $EV/delete-manifest-tmp.txt
rmdir /tmp/.notice-k /tmp/.notice-d          # 目录单独删，不会误伤
```

删文件用清单、删目录用 `rmdir`（不存在时静默失败），**不要用 `find /tmp -name 'notice*' -delete`** —— 快照目录里躺着的正是同名原件，一条 wide find 会把证据一起删掉。

## 3. 复查给数字，不给形容词

```bash
ls -1d /tmp/.notice-* 2>/dev/null | wc -l                          # 0
ls -1 /dev/shm/*.py /dev/shm/n* 2>/dev/null | wc -l                # 0
grep -c 'notice' /etc/crontab /var/spool/cron/crontabs/* 2>/dev/null | grep -v ':0'   # 无输出
find /web/app/logs/xxl-job -type d -name gluesource -exec sh -c 'echo "$1: $(ls -1 $1|wc -l)"' _ {} \;
pm2 jlist | python3 -c "..."      # online=N/M + 列出 stopped
grep -ac '' /root/.ssh/authorized_keys; grep -c '<攻击者key指纹>' /root/.ssh/authorized_keys   # 0
iptables -S | grep -c <C2-ip>      # INPUT/OUTPUT 各 2 条
for p in 9040 9050 9010; do printf '%s -> ' $p; curl -s -o /dev/null -w '%{http_code}\n' -m 4 http://127.0.0.1:$p/; done
```

## 4. 判读这些残留说明了什么（决定还要做什么）

| 残留物 | 说明 | 后续动作 |
|---|---|---|
| `*.priv` / `.notice-k/k`（`BEGIN OPENSSH PRIVATE KEY`） | 攻击者**生成**的密钥，准备横向。`ssh-keygen -yf` 出指纹后与所有 `authorized_keys` 比对：不在里面 = 未拿到 SSH 持久化 | 记指纹进 IOC，全队扫一遍 |
| `my.py` 这类自写协议客户端（`mysql_native_password`、`HOST=os.environ.get('MH', ...)`） | 攻击者**已能连**该库，写客户端是为了绕开没装 mysql 客户端 | 目标库/账号按**已泄露**处理，P0 轮换口令 |
| `nstat` / `nr` / `nssh2` 探测输出 | 横向测绘记录：列出 `OPEN/CLOSED` 的 IP:port | 把输出的目标 IP 列进横向排查对象 |
| `np1/nps/npt`（Grafana/Prometheus 页面 HTML） | 拿到内网监控面板，可读全部指标 | 监控端点加认证 + 内网收口 |
| `n60_probe.txt`（`ROUTE`/`PORTS` 段） | 打穿另一网段（`via 172.30.x`） | 该网段主机同批排查 |

## 5. 清自己的排查残留（两侧口径不同，别混淆）

清单用 `plan` / `apply` 两段式脚本（`scripts/ops-triage-cleanup.sh`）：`plan` 只打印待删清单 + 被安全检查剔除的路径 + 总大小，人工核过再 `apply`。模式表要覆盖 `ioc* hunt* ir2* triage* n*.sh nb.sh nssh o_* *.cookie *.json jobinfo.html j*chk jx jl`，并显式 `grep -vE '/evidence-|/ops-triage-|\.lock$|\.sock$'` 做剔除。

必守的边界：

```
要归档再删   采集报告目录（ir2/ triage<port>/ 含 report.html+report.txt）→ cp -a 进 /root/evidence-<date>/tmp-residue/
不许碰       arthas*.*（JVM 调试 dump）、cls/（日志采集）、.java_pid*（活进程 socket）、
             tomcat*/、pg_wal_backup_*（数据库备份）、systemd-private-*、aliyun_assist socket/lock
```

**先看清大目录再删。** `du -sh /tmp/* | sort -h | tail` 必跑：几百 MB 的单个目录多半是「从 jar 解包出来查字节码」的临时产物（`BOOT-INF/` + `META-INF/` 结构），确认是解包物而不是业务数据才删；顺手 `ls -la` 看结构一眼就能定性。

**root 文件用 ecs-user/普通账号删不掉。** `rm: Operation not permitted` / `Permission denied` 不是文件被占用，是属主 root 且 `/tmp` 带 sticky bit。补一轮 `sudo -n rm -rf <清单>`；`/root/**` 下的归档同理（`mkdir: cannot create directory '/root': Permission denied`）。复查以 `ls -A /tmp | grep -vE 'tomcat|hsperfdata|\.sock|\.lock|systemd-private|^aliyun'` 的计数为准，残留数为系统项数量即完成。

**自查式收尾**：`grep -alE 'notice|/dev/tcp|uid=0\(root\)' <执行器日志目录> -r` 的结果按 mtime 分组，最后一个时间戳之前的都是历史。11:30 之后 0 条新命中，才能写「攻击已停止」——只看当日总命中数 46 条会误判成还在打。
