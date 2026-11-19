---
name: hermes-gateway-troubleshooting
description: Use when Hermes gateway logs spam or restart-loop.
---

# Hermes 网关排障

本机 7 个 profile 网关全部在用，不要提议停用/退役。

## 第一步：分类日志，不要读全文

```bash
sed -E 's/^[0-9-]+ [0-9:,]+ //' gateway.error.log \
 | sed -E 's/[0-9a-f]{8,}/<ID>/g; s/[0-9]{6,}/<NUM>/g' \
 | cut -c1-90 | sort | uniq -c | sort -rn | head -20
```

再用 `ls -l` 看最后修改时间。**刷屏已停和仍在刷，日志内容是一样的**——历史行留在文件里，极易误判成「还在刷」。用户看 `tail` 说「还有」时，先比对最后写入时间与当前时间。

## 巡检判定：用 ERROR 条数，不要用日志 mtime

`netcheck.sh` 曾用 `gateway.log` 的 mtime 判「存活」（mtime 超 300s=⚠️/900s=❌），必然误报：gateway 空闲没消息时本来就不写日志，一夜能报出 `日志 10765s 未更新`。**日志新旧与进程生死无关**，已删除该逻辑。

正确判据是「没有错误日志就算正常」：扫 `gateway.log` **和** `errors.log` 两个文件的 15 分钟窗口（>10 分钟巡检间隔，避免缝隙漏报），命中 `(ERROR|CRITICAL)` 即异常，按消息去重只列前 3 类，避免同一条重连错误刷屏。两个文件内容不完全重合——`errors.log` 收 traceback，漏了它就漏报。

注意区分：`agent.tool_executor: Tool X returned error` 是 agent 自己的工具失败，也写在同一份日志里，属噪音；统计归因时按 logger 名分组看，别只按关键词 grep。

## 症状：被同一条 WARNING 刷屏

`Watch notification not admitted for discord chat=<id>: admission_conflict`

根因在 `state.db`，不在配置：

```sql
SELECT delegation_id, delivery_state, delivery_attempts, origin_session
FROM async_delegations WHERE delivery_state='pending';
```

pending 行的 `origin_session` 指向**已删除的 discord thread** 时，每次投递必 `admission_conflict` → 塞回队列 → 2 秒后重试，永久循环。

两个兜底机制同时失效，所以永不停止：
- `_MAX_DELIVERY_ATTEMPTS=8`：每轮重投刷新 `updated_at`，但 `delivery_attempts` 恒为 0，够不到上限转身
- `_ORPHAN_STALE_S=60s`：`idle` 恒为 0s，够不到孤儿判定

修复（**不要删行**，`result_json` 里有 2-4KB 结果数据）：先备份 `state.db`，再

```sql
UPDATE async_delegations SET delivery_state='dropped', delivery_claim=NULL,
  delivery_claimed_at=NULL, updated_at=<now>
WHERE delivery_state='pending';
```

改完 25-30 秒内不再新增即成功。

## 无效尝试（别再试）

- `display.background_process_notifications=off`：只门控 `_drain_watch_notifications` 路径，durable 投递（`raise_not_accepted=True`）绕过它。
- 改「另一个」profile 的该配置：事件 profile 作用域由 session key 决定（`agent:main:discord:thread:X` 里的 `main` = default），不是网关进程的 `HERMES_HOME`。
- 只重启网关：行还在库里，重启后照样刷。
- `launchctl kickstart`：被网关内部护栏拦截，用 `hermes -p <profile> gateway restart`（可正常执行）。

## 症状：每次启动刷一排配置 WARNING

这几个告警互不相干、都无害，但会污染 `gateway.error.log`，一次启动每 profile 各来 3-4 条。逐个修：

**① `env_passthrough is the quoted string`**
config 里写成了带引号的字符串，要的是 list。默认值 `[]`：

```bash
hermes -p <profile> config set terminal.env_passthrough '["ATLASCLOUD_API_KEY"]'
```

list 类型的值必须写成 JSON 字面量字符串（单引号包住双引号），写完用 `yaml.safe_load` 验证 `type(v) is list`。

**② `session_reset.mode: both is no longer applied`**
旧行为已退役，由插件 `hermes-session-reset-policy` 重新提供。修好后的告警变成 `✓ session_reset.mode: both is applied by the session reset plugin`。

**③ `restart_drain_timeout=180s exceeds the live launchd exit timeout (60s)`**
launchd `ExitTimeOut` 是 60s，drain 超了会被 SIGKILL 掉正在跑的会话。源码 `resolve_launchd_capped_drain(180, 60) = 50.0`——留 10s 收尾余量，所以设 **50**：

```bash
hermes -p <profile> config set agent.restart_drain_timeout 50
```

**④ `platform 'X' has no valid toolsets configured`**
见下节。

## 症状：platform_toolsets 里有早已不存在的 toolset

先用源码自带的校验器列真伪，别靠猜：

```bash
cd ~/.hermes/hermes-agent && ./venv/bin/python -c "
import sys; sys.path.insert(0,'.')
from toolsets import validate_toolset
print(validate_toolset('hermes-teams'))"
```

`False` = 该名字在 `toolsets.TOOLSETS` 里根本不存在。历史上随插件退役消失的名字：`hermes-google_chat`、`hermes-homeassistant`、`hermes-teams`。

**它们内联在别的平台列表里**，不只是独立的 platform 键——比如 `discord: [hermes-discord, hermes-google_chat, hermes-homeassistant]`、`slack: [..., hermes-teams]`。只删顶层键会漏掉大部分，必须扫整个 `platform_toolsets` 块的每个 `- item`。

⚠️ **`validate_toolset()` 返回 False 不等于该删。**它校验的是「toolset 名」，而 `cli:` 列表里混着裸工具名（`terminal`/`file`/`memory`/`messaging`）。一次 `validate_toolset` 全量过滤会把 `cli: - messaging` 一起摘掉，可能真的削掉能力。**只删 `hermes-` 前缀的裸名**，裸工具名一律保留。

## 症状：Discord 反复 `discord_websocket_health_stale`（每 ~2 分钟重连一次）

先别怀疑 discord.py 重连逻辑。`socket_closed` 属 `_TERMINAL_HEALTH_REASONS`（adapter.py），首次探测就升级重连——它只是**如实报告**连接已断，不是病因。

按次数排上游异常，`ClientConnectorError` / `ConnectionResetError` 各几千条就说明**连接在本地出口被 RST**，不是 Discord 踢的（`grep -c "has stopped responding to the gateway"` = 0 即无 1006/1011）。

关键判别：**多 profile 是否同一秒一起断**。按 5 秒窗口聚合，多 profile 同窗占比 >30% = 共享出口（Clash）问题，不是单 profile 的 bug。

确认手法——绕过 discord.py，用同一个代理直连 Gateway 并心跳：连接 3 条，若**同一秒**全部 `ConnectionClosedError(None,None,None)`，且此前心跳 op11 ACK 正常，就是代理内核隧道状态损坏（进程活着、端口在 listen、HTTP 请求 200，但长连接被 RST）。时段性（白天 40-120 次/小时、凌晨 3-12 次）也是线路/内核特征。

修复：**重启 Clash 内核，不要重启网关**。Clash Verge → 服务 → 重装/重启内核，之后 `unhealthy` 应立刻归零。

### 验证：长持探测 + 分段计数

现成脚本 `scripts/ws_hold_probe.py`（免手写）：`python ws_hold_probe.py -n 3 --seconds 350`。它只发 op1 心跳、不做 identify，不占 bot session。三条铁律：

**① 超时 ≠ 失败，退出码语义要显式设计。** `asyncio.wait_for(main(), timeout=N)` 在连接**还活着**时才抛 `TimeoutError`，连接真断了反而正常 return。所以退出码必须是：`0` = 存活到上限、`2` = 有连接提前断开、`3` = 连不上。用统一退出码或只看 stderr 会把「存活 660s」误报成故障，进而误导用户。同理 `CancelledError` 链是 `wait_for` 取消 `await ws.recv()` 的正常痕迹，不是网络错误。

**② 结果必须自己落盘，别依赖后台进程捕获的 stdout。** 后台进程输出会被中段截断（只留尾部若干字符），而 `UP`/`DOWN` 行恰好在前部。脚本内 `open(..., 'w', buffering=1)` 带时间戳逐行写文件，再回读该文件。

**③ 部分断连要在超时判定里单独统计**，不能只看 `gather` 是否结束——一条 10s 断、另一条活满上限时，`gather` 仍会等到上限才返回。每条连接的最终状态记进共享 dict，超时后扫一遍 dict 里有没有 `down`。

修复确认不能只看日志空窗，跑**分段计数循环**（6 轮 × 600s，每轮记四个量）：

```bash
cnt() { grep -c "$1" ~/.hermes/logs/gateway.error.log 2>/dev/null | head -1; }
# 每轮: unhealthy / ClientProxyConnectionError / ConnectionResetError / 文件字节数
```

⚠️ `cnt` 里的 `| head -1` 不能省。`grep -c` 无匹配时**同时**输出 `0` 并返回 1，写成 `$(grep -c X f || echo 0)` 会拼成两行 `0\n0`，整条 `printf` 被拆乱，数据看着像坏了。

`logsize` 是关键信号：故障期间文件持续增长；修好后应**冻结不变**。只看 `unhealthy=0` 不够——它只说明没新增该关键词。

**判定「0 条」前按 logger 名分类，不要按关键词计数。** 排查过程中 agent 自己的 `execute_code` 报错会被 `agent.tool_executor` 写进同一个 `gateway.error.log`，`grep -icE "discord|websocket|unhealthy"` 会命中这些自造噪音（一条报错正文里就抄着你要找的关键词）。用 `grep -oE "WARNING [a-z_.]+|ERROR [a-z_.]+" | sort | uniq -c` 看归属，只认平台/连接器的行。

⚠️ 直连 Discord 不通（`nc` 超时、`curl rc=35`）时**代理不能关**。discord 规则指向 `🔰 选择节点`（`type = select`，无自动故障切换）——持续抖动要换节点，或给 discord 单建 `url-test`/`fallback` 组。

### 变体：端口在、出口全死（走代理 http=000）——和上面的 RST 不是一回事

`nc -z 127.0.0.1:10808` 成功**只证明代理在 listen**，不证明能出网。判定出口必须走代理发真实请求：

```bash
curl -s -o /dev/null -w 'code=%{http_code} t=%{time_total}\n' --max-time 8 \
  -x http://127.0.0.1:10808 https://discord.com/api/v10/gateway
```

- `000` = 「选中节点 → 上游」整条链断（隧道/线路），aiohttp 在 `_create_proxy_connection` 抛 `ClientConnectorError`，表现为**每 5 分钟一轮** `Disconnected` → 5s 后 `Failed to connect`，可连挂数小时（网关重启多少次都没用，代理侧好了才自动恢复；本机是一次 Clash Verge 重下发配置后自愈）。
- `200` 但长连接被 RST = 内核隧道状态损坏，按上一节重启内核。
- 巡检脚本把这种情况写成「端口开放」是误导——结论要写「代理出口故障」，否则用户以为代理没事。

`discord.com` 解析到 `198.18.0.x` 是 TUN + fake-ip 的**正常**结果，不是 DNS 故障，别顺着 DNS 查。直接查内核状态、读选中节点和实测延迟见 `references/clash-core-diagnostics.md`（unix socket API，比开 GUI 快）。

另：`~/.hermes/profiles/<p>/cron/output/` 里巡检报的「N 条 ERROR（近 15 分钟）」是**窗口内累计条数**，不是新增量，跨报告对比时不要当成事件计数。

## 症状：cron 跑完 ok 但消息没投递

日志：`Job 'X': origin has thread_id=Y but delivery target lost it (deliver=..., target=...)`

根因在 `deliver` 字段：**Discord 线程投递必须写满三段** `discord:<chat_id>:<thread_id>`。只写 `discord:<chat_id>`（即使 origin 里 thread_id 完整）会丢掉线程，落到频道根层或投递失败。

```bash
hermes cron edit <job_id> --deliver 'discord:<chat_id>:<thread_id>'
```

改前备份 `~/.hermes/profiles/<p>/cron/jobs.json`。验证：`hermes cron run <job_id>` 后查 `cron/executions.db` 的 `delivery_outcome='delivered'`，并确认 `gateway.error.log` 不再出现 `delivery target lost it`。**验收要看 `delivery_outcome` 与 `cron/output/<job>/*.md` 实际生成**，脚本 stdout 有内容不代表投递成功。

`jobs.json` 是**多会话共享**的：其他 profile/session 会并发改 `deliver`、新建任务。改完顺手把整张表读一遍（`id / name / deliver / origin.thread_id`），发现不是自己动的条目先问用户，不要擅自回滚。

## 症状：error.log 无限增长

`gateway.log` 的 `max_size_mb` **不作用于** `gateway.error.log`，后者无轮转。

清理用**截断不删文件**——进程持有句柄，删了它继续写已删 inode，空间不释放：

```bash
gzip -c gateway.error.log > gateway.error.log.$(date +%Y%m%d).gz
: > gateway.error.log
```

## 症状：网关反复启动退出（崩溃循环）

日志归类后若见某条 ERROR 上万次，典型是平台凭证冲突。两个 profile 共用 `TELEGRAM_BOT_TOKEN` → 抢不到的一方退出 → launchd 拉起 → 循环，一天能堆 200M+。

`hermes gateway status` 会直接给 `⚠ Profiles 'X' and 'Y' 共用同一个 TELEGRAM_BOT_TOKEN`。注释掉一方的 `TELEGRAM_BOT_TOKEN`/`TELEGRAM_ALLOWED_USERS`/`TELEGRAM_HOME_CHANNEL` 并重启即可；注意 `deliver=origin` 的 cron 任务若指向被注释的平台，投递会失效。

## 进程结构（`ps -ef | grep hermes` 看着乱是正常的）

每 profile 3 进程：`osascript 壳(ppid=1)` → `主管 python` → `worker python`。内存大头在 worker（300-450MB），7 个合计约 2.6GB。

命令行里那一大段 Python 源码是启动器的 `_hermes_closure_repair` 自愈逻辑（`hermes update` 中断后修复用），**不是报错**。用户贴这段说「有报错」「为什么这么多 error 字眼」时，逐个指认：

- `error` → `--error-log` 参数名、`gateway.error.log` 文件名
- `ImportError` → 内联脚本里的**异常类型判断**：`except Exception as exc: if _hermes_closure_repair() or not isinstance(exc, ImportError): raise`，语义是「import 失败先尝试自愈，自愈失败才抛」。同段还有 `except Exception` / `try:` / `raise` 各若干处
- `Traceback` / `ModuleNotFound` 同理属源码文本

**先验证再解释**，不要凭 `ps` 输出下结论：

```bash
grep -c "ImportError\|Traceback\|ModuleNotFound" ~/.hermes/logs/gateway.error.log \
  ~/.hermes/profiles/*/logs/gateway.error.log
```

全部 0 就说明脚本里那串字样一次都没真正触发。这段内联是必要的——它必须在任何 checkout 模块 import **之前**执行，否则被 `hermes update` 弄坏的 checkout 无人能修；且改动会被 `hermes update` 覆盖，属上游设计，**不要改**。

给用户看干净进程用：

```bash
ps -eo pid,rss,etime,args | grep hermes | awk '{print $1,$2,$3,$4,$5" "$6}'
```

- 层级 `3` = 新启动器结构；层级 `1` = 旧结构，`hermes gateway restart` 即升级
- launchd 退出码：`0` 正常；`75` = EX_TEMPFAIL，启动时短暂失败后重试成功，网关本身在跑

## 改 Hermes config 的方式

`patch` 工具改 `config.yaml` 会被硬拦截（`Refusing to write to Hermes config file`），改用：

```bash
hermes -p <profile> config set <key.path> <value>
```

改前先 `cp` 全部 config 到 `~/.hermes/profiles/h-ops/backups/<topic>-$(date +%Y%m%d_%H%M%S)/`。

**批量改 7 个 profile 一定要显式循环**：

```bash
for p in default h-douyin h-finance h-lark h-news h-obsidian h-ops; do
  hermes -p $p config set <key.path> <value>
done
```

不写 `-p` 只作用于当前 profile。改完**按 profile 各自的日志**验证，不要只看 h-ops。

## 插件是 per-profile 的

`hermes plugins install <name>` 只装进**当前 profile** 的 `plugins/` 目录，其他 profile 完全看不到。给 7 个都装要循环 `-p`，且每个都得再跑一次 `plugins enable`：

```bash
for p in default h-douyin h-finance h-lark h-news h-obsidian h-ops; do
  hermes -p $p plugins install hermes-session-reset-policy
  hermes -p $p plugins enable  hermes-session-reset-policy
done
```

`plugins enable` 只对**正在跑**的网关热生效（输出会写 `Gateway reloaded plugins`），但配置类告警的消失需要**重启**——插件热加载不改已发出的启动期 WARNING。验证方式：比对告警行时间戳与各 profile 最近一次重启时间，早于重启的就是历史残留，别当「还在报」。

## 余量：修完还剩哪些告警可以不管

`/plan` 命令名撞车（core 命令 vs `plan` 技能）不是故障——Hermes 的设计是**跳过自动注册**，技能改走 `/skill plan`，日志里那条 `collides with a core Hermes command; skipping auto-registration` 属预期。要么改技能名，要么忽略。

`launchd exit=75`（EX_TEMPFAIL）同理：进程活着、平台 `connected` 就不用管，它是「请稍后重启我」的正常重启路径，不是崩溃。
