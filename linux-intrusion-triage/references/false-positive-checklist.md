# 误报清单（False-positive checklist）

每条都是实际跑出来、被当成入侵证据看过的假阳性。采集脚本里对应位置必须已经修掉；人工排查时遇到同样的信号，直接按「如何排除」一栏处理，不要写进报告结论。

| # | 信号 | 为什么是假的 | 如何排除 |
|---|---|---|---|
| 1 | `/var/spool/cron/{crontabs,atjobs,atspool}` 是目录 → 报「cron 被 mkdir 手法利用」 | 这三个目录是 cron 包自带的 | 只扫 `find /var/spool/cron/crontabs -mindepth 1 -type d`；且降级 WARN，注明「cron 报 NOT A REGULAR FILE 并忽略，未生效」 |
| 2 | `/etc/pam.d/other` 含 `pam_permit.so` → 报 PAM 后门 | `pam_permit` 是发行版默认，它不执行命令 | 只认 `^[^#].*pam_(exec|python|script)\.so` |
| 3 | `/etc/cron.daily/{apt-compat,man-db,logrotate,popularity-contest}` 含 `curl/wget` → 报「cron 里藏外连」 | 全是发行版官方脚本 | 叠加 `dpkg -S <file>` 查归属，能查到就跳过 |
| 4 | `ExecStart=/bin/bash -c ...` 在 `/usr/lib/systemd/system/` → 报「systemd 后门」 | `cloud-init-hotplugd.service` 等打包 unit 就这么写 | 查 `dpkg -S`，打包的标 `[pkg]` 备查；只有 `/etc/systemd/system/` 下且无归属才报 |
| 5 | 十几个 `PPID=1` 的进程 → 报「投放器孤儿进程」 | `cron`/`dbus`/`irqbalance`/`agetty`/`PM2 God Daemon` 启动时父进程就退出了，天生 PPID=1 | 读 `/proc/<pid>/exe`，只报指向 `/tmp|/dev/shm|/var/tmp|/root|/home|/web|/opt|/data|/srv` 或读不到 exe 的 |
| 6 | `dpkg -V` 刷几十行 `/usr/share/doc/*.gz` md5 不符 → 报「包被篡改」 | 文档/man/locale 的差异在裁剪镜像、装语言包、gzip 版本不同时普遍存在 | 只留 `/bin/ /sbin/ /lib/ /usr/lib/`，排除 `doc|man|locale` |
| 7 | `/tmp/sqlite-3.x-<uuid>-libsqlitejdbc.so` → 报「/tmp 有可执行文件」 | sqlite-jdbc 运行时自己解压出的临时库，每个 JVM 一份 | 看文件名模式 `sqlite-*-libsqlitejdbc.so`；报 WARN 备查即可 |
| 8 | `systemd-executor (deleted)` / `python3.12 (deleted)` / `node (deleted)` → 报「已删除仍运行的后门」 | apt 升级替换了二进制，老进程还映射着旧的 | 按 exe 路径分级：`/usr/ /lib/` 下 → benign（仅备查）；`/tmp|/root|/home` 下 → 强特征 |
| 9 | `bash -c export LANG=...;free;uptime;df` → 报「webshell 触发 shell -c」 | FinalShell / 宝塔等面板的监控采集，父进程是该用户的 `sshd` | 看 `echo finalshell_separator` 之类标记 + 父进程是 sshd + 该用户有在线会话；报 WARN 要求人工确认，不算 CRITICAL |
| 10 | 采集脚本自身 + `report.txt` + `tee` 落盘的 `/tmp/console.txt` 命中 OOB 正则 | 报告中含 `### SECTION:` 和 IOC 正则原文 | 内容扫描统一走一个 `cscan()`/`ioc_scan()`，排除 `$SELF_PATH`、`$OUT/`、以及首 4KB 含 `### SECTION:` 的文件 |
| 11 | 2024 年的 OAST 载荷被算成今天的 CRITICAL | 按内容 `grep -rl` 不看时间 | 加 `-newermt "$SINCE"` 判窗口；窗外降 INFO 只计数，且不进取证包 |
| 12 | `authorized_keys` 里出现不认识的 key → 直接判后门 | 可能是离职同事、客户运维、云厂商 | 一律 `[REVIEW]` 人工确认；用 `ssh-keygen -lf` 取指纹，与登录日志里的 `Accepted ... SHA256:xxx` 对照 —— 每次登录都用它，说明是「已知在用」不是「静默植入」 |
| 13 | `/tmp/positions.yaml`、`/tmp/<app>/positions.yaml` 出现在窗口内 → 报「攻击者投放的清单」 | logrotate / filebeat 的状态文件，每次跑都重写 | `head -c 200` 看到 `positions:` + 一堆 `/opt/app/log/...: "<offset>"` 即 logrotate/filebeat 状态；看首行 key 判断是哪个工具 |
| 14 | `/tmp/notice*.png` 是 1x1 PNG、或 `*.jsp.png`/`*.php.png` 双后缀 → 报「webshell 上传」 | 上传接口的探测载荷：`.jsp.png` 是绕过后缀校验的试探，1x1 是探测响应 | `file -b` 得 `PNG image data, 1 x 1` + 大小几十字节 = 探测，不是执行型代码；按铁律 5 归入「被探测」 |
| 15 | `/tmp/hunt2.sh`、`/tmp/ir2/`、`/tmp/ioc*.sh`、`/tmp/<app><ip>.sh` 出现在窗口内 → 报「第二阶段投放器」 | 上一轮我们自己跑的 `hunt-linux.sh` 全量采集及其输出目录 | `head -5` 看是否含 `hunt-linux.sh — Linux 主机入侵排查` 头注释；目录里有 `report.html`+`report.txt`+`samples_manifest.txt` 也是铁证；在本轮报告里写「N 项为上次排查残留」并清掉 |
| 16 | 执行器/白名单脚本相关文件 mtime 很新 → 报「持久化被重写」 | 合规脚本（日志清理、端口守卫）是运维刚部署的 | `head -20` 看有无中文用途注释头（`# 用途:` / `# 部署:`）；有则 `stat` 对比脚本 mtime 与 cron 条目 mtime，同日即同一部署动作 |
| 17 | `/tmp/<app>/plugins/<...>.jar`、`/tmp/ge/*.jar` → 报「jar 投放」 | 业务自己的 starter/插件缓存目录 | 看 jar 名是否带业务前缀（`<brand>-spring-boot-starter-*`）；与 `ps` 里运行中的 jar 名字对照，属同一套业务即 benign |

## 一个通用原则

任何一条「强特征」命中，都要能回答「这在我这个发行版/这个业务里，正常长什么样」。
答不上来就先降级成 WARN 加一句「需人工确认」，而不是写进结论 —— 误报一次消耗的信任，比漏报一次被追问的代价大得多。
