---
name: host-health-inspection
description: Use when setting up recurring host health checks (巡检).
---

# Host Health Inspection (巡检)

Two deliverables every time: (1) a deterministic snapshot script that collects raw metrics, (2) a cron job whose prompt turns that output into a judged report. Never let the agent free-form shell into the box each run — the script is the contract.

Works for the local macOS host (Mac mini), and the same shape adapts to Linux servers. Metric reading rules and thresholds: `references/host-metrics-thresholds.md`. Ready-to-use macOS collector: `scripts/macmini_health.sh`. Multi-host Linux fleet (PG CMDB + parallel SSH) collector notes — key-auth branch, `/proc` parsing, mount exclusions, deep-probe timeouts: `references/linux-fleet-inspect.md`. When the user says a job "stopped" / "不继续做了", work `references/cron-run-diagnosis.md` before touching anything.

## Procedure

1. **Collect once, by hand, before scheduling.** Run the metric commands in `references/host-metrics-thresholds.md` directly so you can quote the current real numbers to the user in the same reply that announces the job. A schedule announced without a present-tense baseline reads as unfinished work.
2. **Write the script under the profile's scripts dir:** `~/.hermes/profiles/<profile>/scripts/<name>.sh`. Fixed sections in fixed order, plain `KEY: value` lines, no timestamps inside values that would differ run to run (uptime/date are fine — the job is not a change-detector). Every section must print something on failure (`|| echo "no data"`), otherwise the agent reads silence as "healthy".
3. **Create the cron job** with `cronjob_manage action=create`:
   - `schedule`: natural language is fine — `every day at 9am`, `every 2h`.
   - `script`: **filename only** (e.g. `macmini_health.sh`), resolved against the profile scripts dir. An absolute path is rejected outright.
   - `prompt`: fully self-contained (cron runs with no chat context) — must restate host identity, every numeric threshold, what is *expected* to be down (e.g. on-demand daemons) so it isn't alerted, and the exact output format.
   - `enabled_toolsets: ["terminal"]`: enough for read-only inspection and cuts per-run token overhead.
   - `deliver` defaults to the originating chat. For a specific destination give `platform:chat_id`; a **thread needs all three segments** — `discord:<channel_id>:<thread_id>`. A two-segment target aims at the parent channel and `cronjob_manage` returns a `guidance` warning saying so: treat that warning as an error, not a note.
   - `attach_to_session: true` when the user may reply to the report.
4. **Fire it once with `action='run'`** to prove the whole path (script → prompt → delivery) works. It returns immediately; the outcome re-enters the conversation later. Then check three things, not one:
   - the artifact at `~/.hermes/profiles/<profile>/cron/output/<job_id>/<timestamp>.md` — the judged report itself;
   - `discord action=fetch_messages channel_id=<target>` — the message actually sitting in the destination channel/thread. `last_status: ok` plus a `delivered` row in `~/.hermes/profiles/<profile>/cron/deliveries.db` only prove the gateway *attempted* delivery; a `Mirror: no session found for …` line in the profile gateway log is the tell that it went nowhere.
   - the ⚠️ items were real (next step).
5. **Triage every ⚠️ before forwarding it.** The run's report is a draft. Re-verify each alert with a direct command yourself and say whether it is real, then offer the fix — do not hand the user a raw alarm.

## Pitfalls

- **多机巡检的多步流水线必须落在脚本里，cron 只粘贴。** 采集吐原始 JSON、每轮由 agent 现写解析排版，是最常见的返工源头（格式漂移、解析报错、上下文被吃掉）。Linux 群机版的做法见 `references/linux-fleet-inspect.md`：脚本产出 `report.txt` + `results.json`，cron prompt 只写「读文件、原样贴进代码块、不要增删」。
- **`free -h` / `df -h` 的整行文本不要带到 Python 里切片。** 列顺序随 procps 版本变，无 `MemAvailable` 列时算错；改读 `/proc/meminfo`（kB，记得 ×1024）和 `/proc/uptime`。磁盘按 `used/size` 自算百分比，并排除 `/var/lib/kubelet/pods/*`、`/boot`、`/run/*`、`/snap/*`。
- **深挖命令必须自己带 `timeout`。** 磁盘告警机上的 `du -x -d1` 一旦碰到 NFS/网络存储就挂死，SSH 层超时会把整台机的深挖结果全丢（v1 里 5 台告警机深挖全部 `SSH超时(30s)`）。写成 `( timeout 20 du ... || true )`，并把深挖并发压到 2。
- **SSH 失败要分类再决定重试次数。** `no output` 无信息量：`permission denied`→auth（重试 3 次），`banner`/`timed out`/`connection closed`→network（只重试 2 次）。握手不通的机器按 3 次重试会白烧整轮时间。
- **Never overwrite the collector without re-reading it.** The skill copy at `scripts/macmini_health.sh` and the profile copy at `~/.hermes/profiles/h-ops/scripts/macmini_health.sh` are two files, and cron runs the **profile** one. `write_file` refuses a stale overwrite — read both, edit, then `cp` the skill copy over the profile copy (or the reverse) and diff them; editing only one leaves cron silently running the old logic.
- **Do not schedule a recurring report into a Discord thread.** Threads archive after their `auto_archive_duration` (7 days is the maximum) with no activity, and an archived thread takes no further deliveries — a once-a-day job hits that wall within a week. Point `deliver` at a real text channel (`discord:<channel_id>`) for anything recurring. When the user says 子区 / 子频道, that word covers both a Discord thread and a real channel under a category: confirm which before creating anything, because a thread is one API call while a new channel needs Manage Channels that the bot may not have.
- **`df -h` on macOS prints `105Gi`, not `105G`.** Pipe through `sed 's/Gi$/G/'` before printing a `G`-suffixed total, or one row reads `105Gi / 926Gi` in a block where every other row is GB.
- **A container reporting `unhealthy` is not an outage.** Docker healthchecks commonly reference a binary the image lacks (`wget` in a curl-only image), so `FailingStreak` climbs while the app serves fine. Confirm with `docker inspect <c> --format '{{json .State.Health}}'` for the failing command *plus* a direct probe of the real port. Classify as probe bug, report the healthcheck fix, and never restart the container to "clear" it without asking — the flag is wrong, not the service.
- **`memory_pressure` output is inverted from what its name suggests.** The line `System-wide memory free percentage: N%` is FREE percent, not pressure. Labeling it `PRESSURE:` in a script produces a confidently wrong number (73% reads as alarming pressure when it means 27% used).
- **A `healthy`/`degraded` flip right after a container restart is warm-up, not a fault.** MCPHub's `/health` returns `status: degraded, connected: 3/5` for the first ~60s while `uvx`-based stdio servers finish booting (`fetch`, `dev-mysql-ubs`, `pro-doris` take ~55s). Docker marks the container healthy as soon as curl gets HTTP 200, so `docker ps` says healthy while `/health` still says degraded. Wait 60s and re-query `/health` before reporting; do not restart again.
- **Fix a broken healthcheck by editing the compose file, not `docker inspect`.** This host's mcphub compose lives at `/Users/miller/docker/compose/mcphub/docker-compose.yml` and is **CRLF** — patch it with a Python bytes replace or the whole file's line endings get rewritten. Back it up first, validate with `docker compose config --quiet`, then `docker compose up -d`. `docker compose up` looks like a long-lived process to the terminal guard: run it with `background=true` and poll health in a separate call.
- **Keep the collector script in this skill as the canonical copy.** The profile copy at `~/.hermes/profiles/h-ops/scripts/macmini_health.sh` is what cron executes; re-copy from `scripts/macmini_health.sh` here after any edit so the two don't drift. The skill copy carries the `|| echo` fallbacks and the FREE_PCT label.
- **Lark 授权别用 `status != ready` 判故障。** `needs_refresh` 只是 access token 过期、下次调用会自动换；真正的失效信号是 refresh 窗口过期（刷新报 20037）。巡检要按 `refreshExpiresAt` 剩余天数报警，并每次主动 `--verify` 一次让窗口滚动续期。详见 `references/lark-auth-token-lifecycle.md`。
- **Small `Pages free` is normal on macOS, never alert on it alone.** Free pages tiny + large inactive + nonzero compressed is macOS doing file caching. Alert on the computed used total, on compressed growth, and on swap turning nonzero. Report the schedule *and* the `next_run_at` the tool returned, and keep the manual test fire in the same reply.
- **`pgrep -f "<cmd> <subcmd>"` is not a liveness probe for launchd-managed daemons.** A launchd-supervised process (`ai.hermes.gateway`) runs as `python3 -I -c "<inline source>"`, so the literal string `hermes gateway run` exists only in the pid file's `argv` field and never in `ps` output — the probe returns empty every single day and the report says DOWN while the service is fine. Judge by the pid file, and require BOTH aliveness and identity (`grep -q hermes` on the pid's command) so a recycled PID reading `1` does not read as UP: `GW_PID=$(python3 -c "import json;print(json.load(open('$HOME/.hermes/gateway.pid'))['pid'])" 2>/dev/null); { [ -n "$GW_PID" ] && ps -p "$GW_PID" -o command= 2>/dev/null | grep -q hermes; } || GW_PID=""`. Fix the collector, never the service.
- **Never add a listening-port fallback for the gateway on this host.** Port 20128 is held by an unrelated `next-server` (since 2026-11-01), so `lsof -iTCP:20128` succeeds even with the gateway dead — the fallback converts a real outage into a silent ✅. The pid file is the only per-profile signal; when it is missing or stale, report DOWN plus `hermes gateway status` as the follow-up command.
- **Protocol-correct output is part of the deliverable, not cosmetic.** When quoting a probe result in the report, quote what the probe actually is (`20128` returns 307, `pgrep` misses), so the user is not left chasing a phantom outage.

## Verifying a collector edit without polluting history

The collector appends to `~/.hermes/profiles/<profile>/data/<name>.tsv` on every run, so a manual test fire adds a fake sample and shifts the TREND block. Wrap every test: copy the tsv to `/tmp`, run the script, restore the copy, then confirm with `tail -1` that the last line is still the scheduled run's. Test the DOWN branch **offline** — write the pid check into a `/tmp` copy and feed it fake pid files (nonexistent pid, pid `1`, corrupt JSON, missing file) rather than killing the real daemon.

## 诊断：用户问「这个任务怎么不跑了」

A missing report in the thread the user is looking at is almost never a stopped job. The job usually ran and delivered somewhere else — a superseded thread, or a different thread than the one they are reading. Establish where the output actually went before changing any config; full command sequence in `references/cron-run-diagnosis.md`.

Three verdicts, ranked by how often they are the answer:

1. **Job ran fine, wrong thread.** The user is looking at an abandoned / superseded thread. Confirm by fetching recent messages from the job's configured `deliver` target and from the thread they asked in, then tell them the live thread ID and name.
2. **Job still running.** `cron/executions.db` shows `status='running'` with a `progress_at` that keeps advancing — a full 巡检 takes minutes, and queues behind a busy agent session. Re-poll until it flips to `completed` instead of declaring failure; a run that finishes 4 minutes late is not a fault.
3. **Genuinely not running.** Only after (1) and (2) are excluded: `enabled=false` / `paused_at` set / `failure_streak > 0` with a `last_error`, or `progression` absent entirely (ticker heartbeat stale).

Report the evidence as a table of job id → trigger time → duration → delivery target, so the user can see the run they thought was missing. Then name the real anomaly separately — in these jobs it is usually the collector's own probe lying, not the schedule.

## Reporting format (this user)

Let the **script** render the report body; the agent only adds a verdict and anomaly lines. Hand-reformatting a metrics table on every run is what makes these reports look sloppy — column drift, mixed units, dropped rows.

The collector's last section prints `----- REPORT BLOCK (paste verbatim) -----` … `===== END =====`: label + `▰▱` bar + numbers, one row per metric, aligned with `printf '%-20s'`. The cron prompt instructs the agent to paste those lines unchanged into one code block and add nothing inside it.

- One-line verdict above the block: `✅ 全部正常` or `⚠️ 有 N 项需关注`.
- Anomalies below, each prefixed ⚠️, with one concrete command to investigate. No anomaly ⇒ no advice section.
- Optional closing trend line from the script's `TREND` section (`~/.hermes/profiles/h-ops/data/macmini_health.tsv`, appended each run) so slow leaks — compressed climbing, disk creeping — show up without a separate alert rule.
- Discord does not render markdown tables, so bars + aligned spaces, never pipes-as-table. No image cards.
- Keep block content emoji-free: terminals and Discord both measure emoji/CJK as double-width, so a `✔` inside the block breaks the alignment of every line after it, while the same glyph outside the block is fine.
- Only read-only actions inside the job. Any restart/reconfigure is proposed in chat and awaits confirmation.
