# Benign vs malicious: signal interpretation

A triage verdict hinges on explaining the loudest anomaly. Each row is what the signal looks like, how to confirm it is benign, and what confirmation would flip it to malicious.

| Signal | Benign when | Malicious when |
|---|---|---|
| `sshd[PID]: error: no more sessions` × tens of thousands | Exactly one pid emits it; 0 occurrences in the live `secure`; first/last timestamps bracket one session's open/close; `MaxSessions 10` with an IDE client attached | Multiple pids, ongoing in live log, or paired with session openings you cannot attribute |
| `Failed password` / `Invalid user` bursts | No `Accepted` from the same IP | An `Accepted` from that IP, any user, any method |
| `Accepted publickey for root from <ip>` | `<ip>` is a known operator/office egress; the key fingerprint matches a key you hold | Fingerprint absent from `authorized_keys`, or from an IP you cannot identify |
| Unknown key in `authorized_keys` | Its fingerprint equals your local operator key, and it appears in every `Accepted` line | Fingerprint not held by anyone on the team; line mtime predates/ignores known onboarding |
| `/tmp/*.sh` scripts | Names match prior triage sessions; no write/exfil primitives inside; dated to a known triage window | Contain `curl|wget` to an external host, `authorized_keys`, `crontab`, `base64 -d`, or setuid/chmod |
| Process pegging CPU | A JVM/known binary via `pmem`/`etime` matching its service start | `kdevtmpfsi`/`xmrig`/`kinsing`, or an ELF under `/tmp`, `/dev/shm`, `/var/tmp` |
| `0.0.0.0` listener on a sensitive port | External probe times out (security group drops it); connections all from 127.0.0.1/local subnet | Probe succeeds from the internet, or established conns from foreign IPs |
| Outbound `ESTAB` to a foreign IP | Correlates to a pid you can name (DB 3306, metrics agent, CDN 443) and repeats at a regular interval | An unnamed pid, a raw-IP destination, or beaconing at fixed short intervals |
| webshell extensions under webroot | None newer than the deployment window | New `.jsp/.php/.asp` with recent mtime, or access-log entries for them |
| `/etc/sudoers` mtime recently changed | Content is the distro/cloud-init default (`root ALL`, `%wheel ALL`, `ec2-user NOPASSWD:ALL` from cloud-init) | A new NOPASSWD line, a new user, or an ALL=(ALL) for an account you did not create |
| OOB 载荷（`oastify`/`interactsh`/`burpcollaborator`）落在上传目录 | 时间全聚在一轮扫描窗口内；文件名只有十来个技术族前缀（`XxeSvg*`/`SsiBfRce*`/`GsOutputFile*`/`AvColabM3u*`）；每个载荷带唯一 `NN.<32位>.<域>` 子域；同目录 webshell 代码计数 = 0、反弹 shell 计数 = 0 | 同目录出现 `Runtime.getRuntime().exec` / `<%@ page` / `eval($_POST` / `/dev/tcp/` / `bash -i >&`；或文件横跨数月、文件名随机 |
| 上传目录里几百个样本「堆着」无人清理 | 入口写入成功但从未被执行（access log 对这些文件名 0 命中），攻击者有探针无落地 | 访问日志里出现对这些文件的 GET/POST，或文件被应用进程读入过 |
| `auditd` active with `No rules` | Treated as a *hardening* gap, reported as such | Never evidence of intrusion by itself |

## Log rotation traps

- `last` reads only the current `/var/log/wtmp`. After rotation it starts at the rotation time and every session looks recent — read `wtmp-<YYYYMMDD>` for the actual window.
- `zgrep` with `/var/log/secure*` transparently covers `.gz` rotations; a plain `grep` silently misses everything older than the current file.
- Before concluding "no logins at time T", confirm which file covers T and which was rotated away.

## Ordering of the verdict

1. Account integrity (UID 0 set, passwd/shadow mtime) — cheapest, most decisive.
2. Attribution of every `Accepted` login.
3. Attack-noise volume (failures, scans) — contextual only.
4. Persistence (cron, systemd units, `authorized_keys`, rc.local, `/tmp` executables).
5. Exposure (listening vs actually reachable).
6. Egress correlation.

Stop escalating at the first phase that fails; everything after it is scope, not verdict.
