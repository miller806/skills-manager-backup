# Cron 任务「好像不跑了」的诊断顺序

按顺序做，第 1-3 步就能定案，第 4 步是给用户的证据。全程只读。

## 1. 任务定义：是否被禁用/暂停

```bash
python3 - <<'PY'
import json
j=json.load(open('/Users/miller/.hermes/profiles/h-ops/cron/jobs.json'))
jobs=j if isinstance(j,list) else j.get('jobs',j)
if isinstance(jobs,dict): jobs=list(jobs.values())
for x in jobs:
    print(x['id'], x['name'], x.get('enabled'), x.get('state'),
          x.get('next_run_at'), x.get('last_run_at'), x.get('last_status'))
PY
```

`enabled=true` + `state=scheduled` + 新鲜 `next_run_at` ⇒ 调度层没问题，继续往下。

## 2. 实际执行记录（唯一可信的执行证据）

```sql
-- ~/.hermes/profiles/<p>/cron/executions.db
-- 列: job_id, status, claimed_at, started_at, finished_at, progress_at, error
SELECT job_id, claimed_at, status, finished_at, progress_at, error
FROM executions ORDER BY claimed_at DESC LIMIT 25;
```

判读：

- `status='completed'` ⇒ 跑完了，问题在投递或子区，看第 3、4 步。
- `status='running'` + `progress_at` 在最近几分钟内推进 ⇒ **还在跑**，隔 20-30 秒再查一次，别报故障。全量巡检 20 台机器需要 3-9 分钟；gateway 被长会话占着时会排队，晚 4-9 分钟出报告属正常。
- 整段时间**完全没有行** ⇒ 调度器没触发，查 `cron/ticker_heartbeat`（unix 时间戳）与 `ticker_last_success`。
- 有 `status='failed'` ⇒ 读 `error`；`[blocked_config] provider credential missing` 是 profile 的 `.env` 缺 key，不是任务坏了。

## 3. 投递记录

```sql
-- ~/.hermes/profiles/<p>/cron/deliveries.db
SELECT execution_id, status, created_at, finished_at, error
FROM deliveries ORDER BY created_at DESC LIMIT 8;
```

`status='delivered'` 只证明 gateway **尝试**投递。真正落到哪个频道要配 `jobs.json` 里的 `deliver` 三看：`deliver` 字段、`origin.thread_id`、`delivery_outcome`。

## 4. 目标频道里的真实消息

拿 `deliver` 的频道/子区 ID 直接读 Bot API（当前会话没有 discord 工具、或要读非本会话频道时用这条路；Discord 需走本机代理）：

```bash
TOKEN=$(grep -hE '^DISCORD_BOT_TOKEN=' ~/.hermes/profiles/h-ops/.env | head -1 | cut -d= -f2- | tr -d '"'"'"' ')
ch=<频道或子区 ID>
curl -sS --max-time 15 -x http://127.0.0.1:10808 \
  -H "Authorization: Bot $TOKEN" \
  "https://discord.com/api/v10/channels/$ch/messages?limit=5" | python3 -c "
import json,sys
for m in json.load(sys.stdin):
    print(m['timestamp'][:19], '|', m['author']['username'], '|', (m['content'] or '')[:100].replace(chr(10),' '))
"
```

- 消息里的 `timestamp` 是 **UTC**，本机 CST 要 +8 小时才和 `date` 对得上。别因为差 8 小时以为查错了频道。
- 子区是否还活着：`GET /channels/<id>` 看 `thread_metadata.archived` 与 `auto_archive_duration`。

## 5. 结论怎么写

给用户一张「任务 → 触发时间 → 耗时 → 投递到哪个子区」的清单，再加一句结论：任务在跑，只是不在他看的那个子区。

最容易被当成「任务停了」的两种真实情况：

- **旧子区被取代**：早先的任务投到 `discord:<channel>`，每次触发自动开一个新子区；改成固定三段式目标后旧子区就再没消息，而用户往往还留在最早那个旧子区里。查 `GET /guilds/<gid>/threads/active` 会把所有历史子区都列出来。
- **报告里每天都有一条同样的假告警**：例如「gateway DOWN」其实是探针判据错（`pgrep -f "hermes gateway run"` 对 launchd 托管的网关恒空）。这种固定出现的告警要先当探针 bug 复核，再当故障处理。
