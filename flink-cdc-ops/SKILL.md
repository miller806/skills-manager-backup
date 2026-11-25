---
name: flink-cdc-ops
description: Use when Flink CDC pipelines stall or restart repeatedly.
---

# Flink CDC 管线卡死/重启排障

适用：MySQL→Doris 的 Flink CDC pipeline 吞吐归零、反复 failover、出现 server-id / NoClassDefFoundError / Failed-to-close-reader 报错。

## 第一步：区分「慢」和「零吞吐」

不要看一次数字就下结论。用 REST 连续采样 3-5 轮（每轮 50-60s），看增量：

```
/jobs/overview                                   # 找当前 jid（旧 jid 会 404）
/jobs/{J}                                        # state / duration / timestamps(RESTARTING)
/jobs/{J}                                        # 算子 id 在 vertices[] 数组里，从这里取
/jobs/{J}/vertices/{V}/subtasks/{S}/metrics?get=numRecordsOut,numRecordsIn,numRecordsOutPerSecond,idleTimeMsPerSecond
/jobs/{J}/checkpoints                            # counts.completed/failed/restored
/jobs/{J}/exceptions                             # root-exception
```

- 增量稳定增长 → 只是慢（单表大 split 拖慢整体，正常）。
- 增量全部为 0 且 `idleTimeMsPerSecond=1000` → 零吞吐，进入下面流程。
- **快照阶段增量不动很常见**：换表、分片间隙、补 binlog 位点时本来就不涨（一片 8k 的表可能空档 60-70 秒）。这时**别用 REST 计数回答「是不是卡住了」**，直接采样源库连接的字节：

```
ss -tni state established '( dport = :3306 )' | grep -A1 '<源库IP>' | grep -o 'bytes_received:[0-9]*'
sleep 60   # 再采一次
```

  60 秒有几百 KB~1MB 增量就是在读，只是日志不打印进度。零增量才需要怀疑，此时再用差集法确认是哪张表、跑了多久。
- `numRecordsOut` 从大数**归零** → 算子重启过，去 `/jobs/{J}` 看 `timestamps.RESTARTING`。

注意：`/jobs/{J}/metrics` 和 `/jobs/{J}/vertices/{V}/metrics` 的 value 全是 `None`，必须走到 subtask 级。

`/jobs/{J}/vertices` 这个端点经常返回 `Unable to load requested file`（尤其 JM 刚重启、作业刚恢复时）。**算子列表永远从 `/jobs/{J}` 的 `vertices[]` 取**，别直接把 `/jobs/{J}/vertices` 当独立接口用。

## 「作业在跑但数据不同步」：先分清快照相位 / binlog 相位

用户说「改了源库一条数据没同步过去」时，**不要去调指标、不要去查 sink**。先做一步判定：这个作业到底进没进 binlog 相位。

### 唯一硬标准：binlog 位点行

```bash
TM=$(ls -t $L/flink-root-taskexecutor-*.log | head -1)
grep -a 'Binlog offset for tables' $TM | grep -aE 'on checkpoint <该作业的号段>:' | wc -l
```

**该作业一条都没有 = 它从未进过 binlog 相位**，此时源库做任何变更都不可能同步过来。这一条比 checkpoint、比指标、比 `ss` 连接都硬。

各作业的 checkpoint 号段互不相同（同一个 TM 日志里混着 8 个作业），先用 `/jobs/{J}/checkpoints` 拿到本作业最新的 id，再拿这个号去 grep，否则会被别的作业的位点行骗过去。

### 第二证据：JM 侧的枚举器相位（**别用不存在的相位名**）

```bash
grep -a 'Assigner status changes from' $JM | tail -5
grep -a 'The enumerator under' $JM | tail -3
```

3.6.0 的 `AssignerStatus` 只有 5 个值（解包 `flink-cdc-pipeline-connector-mysql-3.6.0-1.20.jar` 的 `assigners/AssignerStatus$1..$5` 可证）：

```
INITIAL_ASSIGNING → INITIAL_ASSIGNING_FINISHED
  → NEWLY_ADDED_ASSIGNING → NEWLY_ADDED_ASSIGNING_SNAPSHOT_FINISHED
  → NEWLY_ADDED_ASSIGNING_FINISHED
```

**`BINLOG_READING` 这个相位在 3.6.0 里根本不存在**（早期笔记写成存在，是错的）。进增量后状态**停在 `INITIAL_ASSIGNING_FINISHED` 不再打印迁移**，所以「最后一条 `Assigner status changes` 是 `INITIAL_ASSIGNING_FINISHED`」= 已经在跟 binlog，不是卡住。

「枚举器坏了」只有两种真实情形：

```
① checkpoint 拍在全量未跑完那一刻  → 恢复后继续搬快照（不是坏，是没跑完）
② 恢复时 assigner 类型对不上        → 退化成新建 assigner 从头开始
   （yml 在 initial ↔ latest-offset 之间改过，checkpoint 里存的是另一种）
```

三个 assigner 实现决定进哪种：`MySqlSnapshotSplitAssigner`（纯全量）/ `MySqlHybridSplitAssigner`（initial 混合）/ `MySqlBinlogSplitAssigner`（latest-offset 直接进增量）。

### ⚠️ `scan.startup.mode: initial` + `-s <chk>` 恢复会退回全量

这是最坑的坑，也是「明明从 checkpoint 恢复却还在搬全量」的原因：

```
scan.startup.mode: initial   ← 告诉 CDC「从快照开始」
-s flink-checkpoint/.../chk-N ← 告诉 Flink「恢复状态」
```

两者不冲突，但**状态里如果没带着「全量已完成」这个相位，枚举器就回到 `INITIAL_ASSIGNING`**，重新把所有 split 分配一遍。表现：

- `checkpoints` 每 5 分钟照常 COMPLETED、`failed=0` → 看起来完全健康
- source `idleTimeMsPerSecond=100%`、`currentFetchEventTimeLag=-1`、队列 0、无背压 → 看起来像卡死
- 指标停在一个固定数字不动 → **那个数字是快照导出的行数累积，不是速率**
- `grep 'Finished exporting'` 能看到它在一片一片地搬（`ubs_pay.order_address:1`、`:2` 各 8095 行）
- binlog 位点行 **0 条**

**别把「指标不动」当成「卡住」去查背压、查线程栈、查网络。** 先数 binlog 位点行，再 grep `Finished exporting`，结论立刻分开：

```
位点行 0 条 + 还有 Finished exporting 在涨 → 在搬全量，不是卡住
位点行 0 条 + Finished exporting 也停了   → 真卡，查枚举器/线程栈
位点行有 + 指标不动                       → 源库这段时间真没写入
```

### 指标口径（别读错）

```
Source  read-records  恒为 0（CDC source 不打这个指标，不代表没读）
Source  write-records 快照阶段 = 已导出快照行数累积；binlog 阶段才近似实时
Sink    write-records DorisBatchStreamLoad 不按它计数，恒 0 是正常的
```

判活**只看 source 的 `numRecordsOut` 增量 + binlog 位点行**，别看 read-records（永远 0）、也别看 sink 的 write-records（批量 sink 不记）。

另外 **1 个 TM 混跑多个作业时，TM 日志里的 `stream load started for _0_<表名>` 不能归因到具体作业**——只能当「集群里有东西在写」的证据，不能当「本作业在写」的证据。按表名反推也不行，多个作业的表名会重名（ods_dev/ods_fat/ods_uat 三套环境连同一个 Doris）。

### 处理选项（让用户选，别自作主张）

```
A 等全量跑完        最稳、最慢。300+ 表的库按 parallelism=1 要数小时，期间源库变更一分都同步不到
B savepoint 重启    快，但若枚举器状态本身已坏仍会退回全量
C latest-offset     2 分钟见效，丢弃历史欠账（从当前 binlog 尾部开始）
```

用户问的是「测试一条数据要能立刻同步」时，C 才是对的选择。改法：

```yaml
scan.startup.mode: latest-offset
```

**合法值只有这几个**（解包 `flink-cdc-pipeline-connector-mysql-*.jar` 读 `StartupMode` 枚举的常量池可证）：`initial` / `earliest-offset` / `latest-offset` / `snapshot` / `specific-offset` / `timestamp`。**`latest` 不存在**，写成 `latest` 会在提交时解析失败。别凭印象填，改完用一个不起眼的方式确认（提交后 grep `Starting offset is initialized` 或 `Adding split(s) to reader`）。

然后 **不带 `-s`** 重新提交（带 `-s` 会把状态里的相位一起恢复回来，又退回全量）。验收看这两行：

```
Starting offset is initialized to {... pos=<当前尾部>}     ← latest-offset 生效
MySqlBinlogSplit{splitId='binlog-split'...               ← JM 分配了 binlog split
```

代价要说清楚：从上次 checkpoint 到现在的变更不会补。`UNIQUE KEY(id)` 的表可以在低峰期用单表 repair 任务补一次全量，幂等不产生重复行。

## 目标端表不存在 → `SchemaEvolveException` → `failJob` 无限循环

**这是 `evolve` + 容错 jar 组合下最恶的一种故障**，因为容错 jar 不覆盖它，且失败是**全局**的。

### 症状链（真实报错原文）

```
SchemaEvolveException{applyingEvent=AlterColumnTypeEvent{
    tableId=ods_dev.ubs_webhook_webhook_config,
    typeMapping={is_open=INT NOT NULL},
    oldTypeMapping={is_open=TINYINT NOT NULL}}, ...}
exceptionMessage='Failed to read Doris target column types'
cause='DorisSchemaChangeException: can not parse response schema
  "errCode = 7, detailMessage = table not found,
   tableName=ubs_webhook_webhook_config"'

SchemaRegistry.failJob(SchemaRegistry.java:397)
  ← TolerantMetadataApplier.adaptStringTypes(:124)
  ← TolerantMetadataApplier.applySchemaChange(:48)
```

链条：源库 DDL → `evolve` 必须**先去 Doris 读该表的现有列类型**才能推导新 schema → Doris 没这张表 → `errCode=7` → 抛 `SchemaEvolveException` → `SchemaRegistry.failJob()` **整作业全局失败**（不是单表跳过）→ 重启后又收到同一个 binlog 事件 → 无限循环。

**启动即撞：** 从 checkpoint 恢复时，源库 binlog 里积压的 DDL 事件会立刻重放，所以作业一起就崩，看 `checkpoint restored` 是成功的，容易误判成「恢复坏了」。

### 为什么 `scan.startup.mode: initial` 救不了（重要，实测）

直觉是「initial 会建表」。实测**不行**，因为 schema 状态来自 **checkpoint**，不由 startup mode 决定：

```
08:11:40,462  CreateTableEvent{tableId=ubs_webhook.webhook_config, schema=columns={...}}
08:11:40,462  ... is redundant for current schema          ← 被判冗余
08:11:40,465  0> Finished schema change events: []          ← 建表事件被丢弃，没下发 sink
08:11:40,573  Step 1 - AlterColumnTypeEvent{is_open TINYINT→INT}
08:11:40,584  → table not found → SchemaEvolveException
```

checkpoint 里已经存了这张表的 schema（历史 binlog 带来的），CDC 比对后认为「已经有了」，把 `CreateTableEvent` 丢掉。整个日志里 `is redundant for current schema` 会出现几十上百次。**`-s <chk>` 恢复 = schema 状态被继承 = 建表永远被吞。**

### 正确做法：先一次性 bootstrap 建表，再恢复主任务

分两步，顺序不能反：

**第 1 步 —— 独立 bootstrap pipeline 把目标表建出来**

```yaml
source:
  type: mysql
  hostname: <同主任务源库>
  tables: <库>.<表1>,<库>.<表2>,...   # 显式列全名，别用通配
  server-id: <一段未占用的号>          # 与主任务不同段
  scan.startup.mode: initial
sink:
  type: doris-tolerant                  # 与主任务同一 sink 配置
  fenodes: <同主任务>
route:
  - source-table: (<库>).(<表>)
    sink-table: <ods_env>.$1_$2
pipeline:
  name: Bootstrap <X> For <ENV>
  parallelism: 1
  schema.change.behavior: evolve
```

**关键：不带 `-s`**（要干净 schema 状态，才肯下发 CreateTableEvent）。验收看这两行：

```
Successfully applied schema change event CreateTableE...
Finished exporting N records ... for split <表名>
```

建完立刻 `PATCH /jobs/{J}?mode=cancel`，别让它一直跟 binlog 抢 server-id。

**第 2 步 —— 再从主任务的 checkpoint 恢复**，此时 Doris 里表已存在，`evolve` 推导能读到列类型，不再 failJob。

验收：`Going to restore from checkpoint No.<N>`、`Binlog offset for tables` 行在推进、`Global failure triggered` = 0。

### 排查时先确认「目标端到底有没有这张表」

别只看报错就动手。Doris 直查：

```python
# 见「Doris REST 直查」一节的模板
q("show tables like '%webhook%'")          # 0 张 = 从未同步过
q("select count(*) from `oms_xxx`")
```

同时查**源库**该表的行数：源库本来就是空表时，Doris 建表后 0 行是**正确结果**，不是又没同步。两边都查完再下结论。

### 作业运行中新建源表：sink 不建目标表，直接 stream load 报 NOT_FOUND

与上面「目标端表不存在 → SchemaEvolveException」是**两种不同的故障**，别混：

```
改结构时目标表不存在  → 走 DDL 通道，evolve 要读列类型 → SchemaEvolveException → 全局 failJob
跑着的时候新建源表    → 不走 DDL 通道，sink 直接写数据 → DorisBatchLoadException
```

实测形态：作业已在 binlog 相位，源库 `CREATE TABLE` 后 JM 日志确实出现 `including table '<库>.<表>' for further processing`（源端发现了新表），但 sink **从未收到 `CreateTableEvent`**，第一笔数据直接 stream load：

```
io.cregis.cdc.internal.doris.flink.exception.DorisBatchLoadException:
  stream load error: [NOT_FOUND]TStatus: errCode = 7,
  detailMessage = table not found, tableName=<表>
  ← SinkWrapperException: Failed to handle event DataChangeEvent{... op=INSERT}
```

处理：**手工在 Doris 建好结构一致的表**（列名/类型/顺序与源库对齐，`UNIQUE KEY(<pk>)` + `light_schema_change`），下一批数据就能落。作业**不会**因此永久损坏，建完表后自己继续写。

判据：日志里 `including table` 有、`Successfully applied schema change event CreateTableE` 没有 = 只有源端发现了新表，sink 没建表。

### ⚠️ Doris 侧**物理上做不到**的两类 ALTER：nullable→NOT NULL / varchar 缩短

`Can not change default value` 这个报错文案具有误导性——实测**与默认值无关**，真因是 Doris 拒绝「可空改非空」。
在 `zz_` 临时表上逐一实测（Doris 5.7.99 / SelectDB）：

```
A  nullable → non-nullable        Can not change from nullable to non-nullable   ← 真正原因
B  varchar(90) → varchar(32)      Shorten type length is prohibited
C  在空表上做 A                    同样失败（与数据无关）
D  换成无默认值的列再做 A          同样失败（与默认值无关）
```

所以「源库 `MODIFY COLUMN x varchar(32) NOT NULL`」这类 DDL，**在 Doris 侧无论怎么补数据/改默认值都做不了**，
每次 checkpoint 恢复都会重放它 → 无限 failJob。容错 jar 也不覆盖（`TOLERATED_DORIS_DDL` 命中 0）。

**唯一可行解：重建目标表**（百行级表秒完成；大表要评估）：

```sql
CREATE TABLE `ods_x`.`<t>_bak_<date>` AS SELECT * FROM `ods_x`.`<t>`;   -- 备份
-- 建新表：把争议列写成源端的定义（非空 / 短长度）
-- INSERT 搬数据 → 校验行数 → DROP 原表 → 重建 → 回灌
```

⚠️ **`ALTER TABLE db.t REPLACE WITH TABLE db.t2` 在某些 SelectDB 版本不支持库名前缀**，报
`mismatched input '.' expecting {<EOF>, ';'}`（pos 指向 `db.`）。此时走 DROP+重建+回灌，别在语法上纠缠。

⚠️ **`TRUNCATE`/`DROP` 原表之后必须走完全程**：中途 REPLACE 失败时数据只在备份表里，此时作业仍在 RESTARTING
不会写入，是安全的；但**别在看到 REPLACE 报错后停手**，要继续重建 + 回灌，否则表会长时间空着。

**先分清是不是这个类型**：查源库 `information_schema.columns` 与 Doris `SHOW FULL COLUMNS` 逐列比对，
重点看「源 `is_nullable=NO` 且 `column_default IS NULL`，目标端却是 `NULL`」的列——这类列一旦被 ALTER 就会撞。
（这套环境的通用模式是 Doris 侧一律建成可空，所以几乎所有非空列都是潜在雷。）

### 容错 jar 覆盖矩阵（更新）

```
✅ NO_CHANGE（含 NOT NULL → NULL）
✅ VARCHAR_NARROWING（"Shorten type length is prohibited"）
✅ STRING_TO_DECIMAL（"Can not change VARCHAR/STRING to DECIMAL"）
❌ 目标端表不存在（errCode=7 table not found）   ← 本故障，必须手工 bootstrap
❌ 目标端列不存在（`Doris target column is missing: <col>`）← 包装 jar 自造消息，见下节
❌ RENAME COLUMN 漂移 / 源表 DROP TABLE / ADD COLUMN 冲突
❌ 目标端表卡在 SCHEMA_CHANGE（errCode=2 not NORMAL）
❌ 源端断连 EOF / checkpoint 恢复损坏
```

**容错是白名单制**，`ToleranceReason` 枚举只有四个值 + 一个 ADAPTED 改写分支，其余事件一律 rethrow：

```
TOLERATED  NO_CHANGE                目标端已是期望状态（Doris 回 "Nothing is changed"）→ 忽略该 DDL，继续
TOLERATED  TYPE_NARROWING           整数 → 字符串窄化
TOLERATED  STRING_TO_DECIMAL        DECIMAL 相关变更被拒
TOLERATED  TARGET_ALREADY_STRING    目标端已是 STRING
ADAPTED    NUMERIC_CONVERSION_REJECTED  数值 → DECIMAL 被拒，改写为 STRING 下发
其余事件                             rethrow
```

判据只有两条 grep：

```bash
grep -ho 'TOLERATED_DORIS_DDL reason\[[A-Z_]*\]' $JM | sort | uniq -c
grep -ho 'ADAPTED_DORIS_DDL[^,]*' $JM | sort | uniq -c
```

**出现 `TOLERATED_DORIS_DDL` 就是容错确实命中并放行了**；反过来，「日志里有 ERROR」**不能**推出「容错没生效」。两者不矛盾：同一句 Doris 报错在不同时刻可能一次抛出、一次容忍，差异来自 class 版本或目标端 schema 当时能否读到。看到这种不一致，先去验版本（判据四），不要当成逻辑 bug 去改代码。

## 报错是谁抛的：包装 jar 自造 vs Doris 真报错

动手前先分清异常来自哪一层。包装 jar 会自己拼消息，把「包装层判定失败」误读成「Doris 报错」，就会去修一个不存在的故障；反过来把真报错当成 jar 的噪音忽略，就会漏掉目标端已经损坏的事实。

### 判据一：消息串在不在 jar 的常量池里

`cause='null'`（没有底层异常）就是自造的铁证。取字符串常量确认归属——服务器通常没有 `strings`，用 zipfile 读 class：

```python
import zipfile,re
z=zipfile.ZipFile('/path/lib/<wrapper>.jar')
b=z.read('io/cregis/cdc/TolerantMetadataApplier.class')
print(b'Doris target column is missing: ' in b)     # True = 包装层自己拼的
for m in re.finditer(rb'[ -~]{6,120}',b): print(m.group().decode())
```

`TolerantMetadataApplier` 的自造消息族：`Doris target column is missing: <col>`、`Failed to read Doris target column types`。它靠内部类 `TargetSchemaLookup` 取目标端 `columnTypes` 再比对——**抛出时说明目标端列清单确实对不上**，但这句话不是 Doris 返回的，别去 Doris 日志里找。

### 判据二：日志里和 UI 上长得不一样，是渲染差异不是来源差异

`SchemaEvolveException` 在 `flink-cdc-dist-*.jar` 里**没有重写 `getMessage()`，只重写了 `toString()`**（解包该类方法表可证：两个 `<init>` / `getApplyingEvent` / `getExceptionMessage` / `getCause` / `toString`）。log4j 打印异常走 `getMessage()`，所以日志里只有两种形态：

```
Caused by: ...SchemaEvolveException                              ← message 为 null，光秃秃一行类名
Caused by: ...SchemaEvolveException: <cause 的 message>           ← 有底层异常时才带冒号后半段
```

`SchemaEvolveException{applyingEvent=... exceptionMessage='...' cause='...'}` 那套展开是 **Web UI 调 `toString()`** 才出现的。

**日志里没有 applyingEvent 三个字段，不能推出「用户贴的不是本机报错」** —— 同一份异常，日志存精简版、UI 存展开版。判来源用判据三的 grep，不要用格式比对。反过来，日志里异常头只有一行类名、没有 cause 文本时，说明 message 为 null，此时**别去猜它代表什么，直接看栈帧下面的 `Caused by:` 链**。

### 判据三：粘贴的报错必须回日志 grep 一次

用户贴报错时不要直接当事实往下推。对**全部**日志文件（含轮转 `.log.N`、`.out`）grep 一个独有子串：

```bash
grep -rl '<报错里的独有子串>' $FLINK_HOME/log/ | wc -l
```

**0 命中 = 那段文本不是本机这份日志产出的**（别的环境 / 旧 jar / 人工拼接）。此时按本机日志里真实出现的异常链分析，并把「你贴的这条在本机日志里 0 次」如实讲清楚，不要顺着错误前提编方案。日志轮转是 100MB×10，翻的时候先核每个文件的起止时间戳。

### 判据四：栈帧行号在不在当前 jar 里 —— 判定「跑的是哪一版 class」

怀疑「容错逻辑没生效」时，**先确认跑的是不是你以为的那版 jar**。同一个类名可以同时来自两个地方，看栈帧尾部：

```
~[?:?]                      → 无 blob id，来自 JVM classpath（$FLINK_HOME/lib 或解包目录）
~[blob_p-<sha>:<version>]   → 有 blob id，来自本次作业上传的 pipeline jar
```

再拿栈里的行号去核当前 jar：**行号落在该方法的行号区间之外，就是另一个 build**。

```bash
python3 scripts/class_line_map.py $FLINK_HOME/lib/<wrapper>.jar io/xxx/TolerantMetadataApplier.class
python3 scripts/class_line_map.py $FLINK_HOME/lib/<wrapper>.jar io/xxx/TolerantMetadataApplier.class --line 32
```

实测形态：栈里 `applySchemaChange(...java:32) ~[?:?]`，而当前 jar 的 `applySchemaChange` 只有 48..112 行 —— 第 32 行根本不存在。结论是那一刻加载的是**旧版 class**，新版的容错分支还没进去，不是容错逻辑写错。

判定落地到「先对齐 jar 版本，再谈改代码」。全盘 `find / -name '<wrapper>*.jar'` 只找到一份也**不能排除**旧版存在过：`/tmp/flink-web-*/flink-web-upload/` 下的临时副本会被清理，当时那个类可能已经从磁盘上消失了 —— 此时靠「行号不存在」这条硬证据定论，别硬找文件。

### Doris 真报错 `errCode = 2` 的两族

`errCode = 2` 是 Doris 原样返回的（类比 MySQL 1054），出现在 `DorisSchemaChangeException: Failed to schemaChange, response: {"msg":"Error","code":1,...}` 里：

```
errCode = 2, detailMessage = Nothing is changed. please check your alter stmt.
errCode = 2, detailMessage = Table[<t>]'s state(SCHEMA_CHANGE) is not NORMAL. Do not allow doing ALTER ops
```

第二族表示**该表上一个 schema change 作业没走完**，后续 ALTER 全被拒。查队列状态，`FINISHED` 之外（PENDING / RUNNING / WAITING_TXN）都算卡住：

```sql
SHOW ALTER TABLE COLUMN FROM `<db>` WHERE TableName = '<t>';
```

### 半改名：RENAME 只成功一半，目标端列名与源端不一致

**机制**（实测，别再靠猜）：Doris 的 schema change 是**表级串行**——同一张表同一时刻只允许一个 ALTER 在跑，后来的直接回 `errCode = 2 ... state(SCHEMA_CHANGE) is not NORMAL`。而 Flink 把一条 MySQL 语句拆出的多个事件**毫秒级连发，完全不看目标端忙不忙**。

先分清哪些操作真的锁表（3M 行 / 8 桶实测，用「发一条 RENAME 当探针，能成功=没锁」判定）：

```
操作                       产生 schema change 作业   阻塞后续 ALTER
RENAME COLUMN（普通列/KEY 列）   0 个（纯元数据）        否 ✓
ADD COLUMN                      1 个                  否 ✓
MODIFY COLUMN（改类型）          1 个                  是 ✗  窗口实测 2.89 秒
                               PENDING → WAITING_TXN → RUNNING → FINISHED
```

**MySQL 的 `CHANGE COLUMN a b INT` 是「改名 + 改类型」两件事**，Doris 无 `CHANGE` 语法，Flink 只能拆成 RENAME + MODIFY 两个动作下发。所以一条 `CHANGE` 改两列 = 4 个动作：

```
① RENAME c1 → is_c1     OK   （轻活，不锁）
② MODIFY is_c1 → INT    OK   （重活，锁住表 3 秒）
③ RENAME c2 → is_c2     ✗ 撞锁
④ MODIFY is_c2 → INT    ✗ 撞锁
最终列 = [id, is_c1, c2]        ← 只有第一列改完，第二列名字都没变
```

**失败位置的规律**：重活**之后**的操作必被拒；重活**之前**的轻活不受影响。所以同一张表同一批变更里**只能有一个重活，且必须排在最后**（`RENAME` 先、`MODIFY` 后的顺序实测两条连发都成功）。

一组对照把「拆分」和「等待」分清（这是解释时最容易说错的地方）：

```
两条 MODIFY 间隔 0 秒   ① OK  ② ✗ SCHEMA_CHANGE is not NORMAL
两条 MODIFY 间隔 5 秒   ① OK  ② OK   数据完好
两条 ADD / 两条 RENAME  连发    ① OK  ② OK   （都不产生锁窗口）
```

**拆分是必须的，但不是充分的——缺的是「等前一个 schema change 跑完」。** 给用户解释这条因果时先说清「拆分没问题」，再讲缺的是等待；把顺序说反会被立刻纠正（用户原话：「不是已经拆成两个sql了吗」——他说得对）。

规避只有三条，按代价排序：

```
① 改结构时一条 SQL 只动一个字段，中间隔 5 秒以上   最省事，实测有效
② 同表多条改动排序：所有 RENAME 先发，唯一一个 MODIFY 放最后
③ sink 侧包装「同表 DDL 互斥 + 撞 SCHEMA_CHANGE 重试」  逻辑最对，但当前容错 jar 没实现
```

容错 jar **既没有重试也没有同表串行化**，撞上就是 rethrow——别指望它兜住。

这种状态下**先修表再谈 checkpoint**，换哪个恢复点都会继续撞。逐列比对源库 `information_schema.columns` 与 Doris `SHOW FULL COLUMNS`，别只比列数——列数相同最容易漏。

想在测试集群里复现 / 量出自己环境的锁窗口：`references/ddl-lock-repro.md`。

### schema 快照被 checkpoint 固化后：保位点与修 schema 不可兼得

checkpoint 里存着一份现实中不存在的 schema 时，从它恢复 = 继续用错 schema 推演化（`CreateTableEvent` 判 `is redundant` 丢弃，唯一纠正机会被跳过）。可选只有两条：

```
带 -s <chk> 恢复    保住 binlog 位点，但错误 schema 原样回来，DDL 事件继续撞
不带 -s 重启        schema 重新快照、正确；丢的是上次 checkpoint 到现在的增量
```

`latest-offset` 只决定「从哪读」，不做全量快照，所以不带 `-s` 时**丢的是增量不是全量**——但这段增量往往正好含那次 DDL 对应的数据变更。把「保位点」和「修 schema」摆成二选一交给用户拍，并把损失范围（这段时间的行数变化）量化给他，不要替他决定。

## 「行数对得上但字段是空的」：目标端列缺失

**这不是 checkpoint、位点或并发的问题。** 容错 jar 只按**目标端**表的列清单拼写入语句，源端多出来的列被静默丢弃 —— 行数一致、零报错、字段恒为 NULL/DEFAULT。

判据只有一条：拿源库 `information_schema.columns` 与 Doris 同库的列清单做**全库**集合比对（不是只看用户给的 DDL 脚本涉及的几十张表，脚本之外的历史欠账一样要算）。先确认表是一一对应的，再比列。

两个高频误判：

```
跑 initial 全量 ≠ 对齐 schema   日志里 CREATE TABLE IF NOT EXISTS 刷几十次，ALTER TABLE 是 0 次，
                               只建不存在的表，对已存在旧表零帮助
evole 配了 ≠ 补历史欠账         evolve 只作用于运行中收到的 DDL 事件，不会回头补
```

**Doris DDL 三条硬约束**（实测）：`varchar(N)` 按字节 → MySQL 的 N 要写成 `VARCHAR(N*3)`；对已有数据的表加 `NOT NULL` 列必须带 `DEFAULT`，否则 `code:1 Error`；`CHANGE COLUMN` 是 MySQL 语法，Doris 报 `no viable alternative at input '... CHANGE'`，须拆成 `RENAME` / `MODIFY` / `ADD`。

**时机决定成本**：`initial` 快照按表排队，对还没轮到的表先 `ADD COLUMN`，快照写入时就填对了；已跑完的表只能事后重灌（UNIQUE KEY 表用单表 repair 幂等重跑）。

完整比对脚本、临时表验证法、补列 vs 删表重建的选型判据见 `references/target-schema-drift.md`。

## 已知根因：孤儿 blc 线程占用 server-id

**症状链**：作业 cancel 或 failover 后，`blc-<源库IP>:3306` 线程卡在 `sun.nio.ch.Net.poll`（Socket 读，`interrupt()` 停不掉）→ Flink 侧 task 已 CANCELED，MySQL 侧连接仍 ESTAB、server_id 仍被占 → 同一 server-id 新连接被踢：

```
io.debezium.DebeziumException: A slave with the same server_uuid/server_id as this slave
has connected to the master; the first event 'mysql-bin.000xxx' at <pos> ...
  Caused by: com.github.shyiko.mysql.binlog.network.ServerException: (同上)
```

→ failover → 恢复灌回旧位点 → 再卡 → 再留一个孤儿，自我复现死循环。

**取证**：
```
ss -tni | 按裸 IP 过滤，比对两次采样的 bytes_received 增量
/taskmanagers/{tm}/thread-dump 找 blc- 线程，看是否全卡在同一栈
（端点挂在 TM 上，`/jobs/{J}/thread-dump` 不存在，会 404）
线程名 blc-<IP>:3306 → 直接定位到哪个源库
```

- `ss` 匹配**裸 IP**，别匹配 `'IP:3306'`：对端显示为 `[::ffff:IP]:3306`，中间的 `]` 让这个串永远匹配不上，会得到「0 条连接」的假结论。
- 一条 pipeline 的每个 subtask 各持一条 blc 线程，所以同一源库看到 `parallelism` 条正常；**超过 parallelism 的多余那条就是孤儿**（对比线程 Id 与当前 task 的存活起始时间）。
- 先把全部 pipeline 的 server-id 拉出来对照：`grep -H 'server-id:' yml/*/*.yml`。不同源库用同一段号**不算冲突**（dev/fat/uat 各连各的 MySQL），**只有同一 hostname 的源库**上重复才是元凶。

**修复**：治本＝重启 TaskManager 进程（唯一能真杀线程）；快速绕过＝给该 pipeline 换一段**未被占用**的 `server-id`（孤儿占着旧段但碰不到新段）。换完不需要从 checkpoint 重启，卡的是连接不是状态。

**同源副作用**：孤儿线程持有实例引用 → 作业 ClassLoader 无法回收 → 之后才触发类加载 → `NoClassDefFoundError: ErrorPacket / ColumnUtils`。这是**结果不是原因**，先用 `unzip -t` 排除 jar 损坏即可。

## `jobmanager.sh stop` / `taskmanager.sh stop` 不杀进程（pid 文件过期）

**症状**：`./bin/jobmanager.sh stop` 打印 `No standalonesession daemon (pid: NNN) is running anymore`，
但 `ps` 里 JM 还在、8081 还占着、REST 仍是旧进程在应答。`taskmanager.sh stop` 同理，
甚至会「停完更乱」——再 `start` 一次就多出一批新 TM，变成 4 个 TM / 48 slot。

**原因**：`/tmp/flink-*-pid` 里的 pid 与真实进程不符（进程被 kill -9 过、或 pid 被复用）。
`stop` 脚本只按 pid 文件操作，找不到就打印「已经不在了」，**并不去扫真实进程**。

**正确姿势**：按进程特征 pgrep 杀，别信 stop 脚本：

```bash
pkill -f 'StandaloneSessionClusterEntrypoint'   # JM
pkill -f 'TaskManagerRunner'                    # TM
ss -tlnp | grep ':8081 ' || echo '8081 released'   # 确认端口释放再 start
```

⚠️ **`taskmanager.sh start` 每调一次就起一个新 TM**（只报「已有 N 个在跑」然后照样起，不做数量校验）。
批量脚本里重复调用会瞬间把 slot 数翻倍。**启动前先 `pgrep -f TaskManagerRunner | wc -l` 确认是 0**，
再按 `conf/workers` 的行数逐个 start。

⚠️ **改完 S3/checkpoint 配置后 JM 和 TM 都必须重启**，并验证每个进程的启动时间都晚于配置修改时间：

```bash
stat -c '%y' conf/config.yaml | cut -c1-19        # 配置修改时间
ps -eo pid,lstart,cmd | grep -E '[S]tandaloneSession|[T]askManagerRunner' | cut -c1-60
```

## Standalone Session 集群：一份日志混着所有作业

`start-cluster.sh` 起的 session 集群，JM 和 TM **各自只有一个日志文件**，`log/` 下没有按作业分的子目录。一个 JM 日志里会攒下当天所有 jid：

```
grep -aoE 'Job [0-9a-f]{32}' $JM | sort -u | wc -l    # 当天有多少作业写过这个文件
grep -a 'Submitting job' $JM | tail -20               # 作业名 + jid
GET /jobs/overview                                    # 现在还活着的
```

log4j 的 pattern 是 `%d{...} %-5p %-60c %x - %m%n`，**不带 job id / task id 字段**，靠 grep jid 分离不了作业。按这三个维度收窄：

```
grep -a '<源库IP>'              $TM   # 最可靠：一条 pipeline 只连自己的源库
grep -aE '\bubs_[a-z0-9_]+\.'  $TM   # 按库名前缀
grep -a 'stream load started for _0_' $TM   # sink 输出必带目标表名，最精确
```

先把作业↔源库映射建起来：`grep -H -m1 'hostname:' yml/*/*.yml`。

**推论**：对整份 TM 日志直接统计关键词是错误的——8 个作业的行混在一起，`load failed` / `Failed to close` 的计数会被别的作业污染。必须先用 `--filter <源库IP>` 收窄再做计数，否则得出的「今日异常 N 次」全是废数据。

定位「这个 jid 的异常」还有一条路：`grep -a 'Error during binlog processing'` 之类带源库 File/Pos 的行能反推是哪个 pipeline；单纯的异常栈行分不出主。

## 「一堆同名短命作业」不是 CDC 故障，先排除 Web UI 未授权 RCE

`/jobs/overview` 里出现大量同名、并行度 1、跑几秒就 FINISHED 的作业（名字可能叫 `rt`、`test` 或随机串），**不要按 CDC 管线去查 checkpoint / 背压 / 位点**——CDC pipeline 只在 RUNNING/RESTARTING 之间摆动，不会产生「一批跑完即终态」的短命作业。这个形态本身就是入侵信号。

三条判据，同时成立即可定性：

```
GET /jobs/{J}   vertices 名 = "Source: Collection Source -> Map -> Sink: Print to Std. Out"
                → fromElements + print 的 shell 执行器，根本不是 CDC source/sink
ls -la /tmp/flink-web-*/flink-web-upload/     → 一堆 2-3KB 的 jar（只有 R.class / R$1.class）
grep -a "Submitting job '<名字>'" $JM        → 配合 JarRunHandler 时间点对上
```

链路是固定的：`POST /jars/upload` → `POST /jars/{id}/run?entry-class=<类>`（entry-class 走 query parameter，日志必留 `Configuring the job submission via query parameters is deprecated`）→ 并行度 1 → 作业体在 TM 上起 `ProcessBuilder("/bin/sh","-c","<base64> | base64 -d | sh")` → 命令输出经 print sink 落到 **TM 的 `.out` 日志**，攻击者从 Web UI 的 TaskManager stdout 页逐条读回显。所以「一个个短命作业」= 一条条 shell 命令的往返。

取证顺序：先 `grep -a '##' log/flink-root-taskexecutor-*.out`（载荷通常给每步打分隔标记）把命中的命令段整段导出成独立文件，**这段回显就是泄露清单**，逐条列给用户；再谈清理。清理前先打包留证。

结论里必须区分两件事：

```
根因    8081 无鉴权。conf/flink-conf.yaml 里 security/ssl/auth/bind-address 全空 + ss 看到 *:8081 = 对全网卡开放
线索    established 对端里有「已退役 / CMDB 已删」的 IP → 该机已沦陷或 IP 被复用，台账没它不等于不用追
```

处置按顺序：封 8081（`iptables -I INPUT -p tcp --dport 8081 ! -s 127.0.0.1 -j DROP`，先问用户）→ 隔离来源 IP → 轮换回显里出现过的**全部**凭据（连数据库的 root 密码、镜像库 token、`.m2/settings.xml`、`.docker/config.json`、`application.yml`）→ 最后才删 jar 与作业记录。

**只要回显里打印过密码，就必须按「已泄露」处置**，即使攻击者试连的那个库当时网络不通、`closed`——回显已经出网了。

完整入侵面排查靠 skill `linux-intrusion-triage`。

## 日志取证要点

- TM 日志**多文件轮转**：`flink-root-taskexecutor-*.log` 可能有多个，`tail -1` 停在旧时间会误判「日志停了」。先 `ls -la --time-style=+%H:%M:%S` 看哪个在写。
- 找「当前哪个文件在写」用 `find log -name '*.log*' -newermt '<今天> 00:00' -printf '%TH:%TM %10s %f\n'`，比 `ls -t` 靠谱（轮转刚切出来的新文件可能是 0 字节）。
- 轮转策略是 **100MB × 保留 10 个**（`conf/log4j-console.properties` 的 `appender.rolling.policies.size.size` 与 `strategy.max`，后者取 `MAX_LOG_FILE_NUMBER` 环境变量）。**每次 JM/TM 重启都会把 `.log` 顶成 `.1`、旧的往后挤一格，两三次重启后证据彻底消失。** 定位到关键异常段就立刻 `sed -n '起,止p'` 导出成独立文件再谈重启，别指望「等会儿再翻」。
- 按时间戳严格过滤，别用宽松 grep：shell 统计 `grep -a '19:'` 会混入历史日期行导致 split/记录数偏高。用 python 判断 `ln.startswith('20xx-xx-xx') and ln[11:16] >= '起时:分'` 重算。
- **`Exporting data from split` 行会重复打印**：同一个 split 可能打多次（重启/重试/恢复），实测 100 行 START 只对应 76 个不同 split。**一律按 split 名去重后再计数**，否则 split 总数、进度百分比全偏高。
- 判断快照完成度靠**集合比对**，不是计数：`Exporting data from split 'X'` 集合 vs `Finished exporting ... for split 'X'` 集合，差集即悬挂 split。**同一个差集也就是「现在正在搬哪张表」的答案**——快照阶段每表只打这两行，差集里剩下那条带着起始时间，就是当前表名 + 已跑时长。用户问「是不是卡住了」先跑这个再谈 REST 计数（算子计数不含表名，看不出在处理谁）。
- 一个 split 跑 5-10 分钟不算卡：记录多 + 跨境 RTT 时单表就是这样。只有「差集里那条的起始时间早于该 split 的历史常规耗时」才值得怀疑。
- 找 failover 的**真因和时段**要 grep `Error during binlog processing`（行首带时间戳，还带上次 offset 的 file/pos）。直接 grep 报错正文（如 `same server_uuid/server_id`）只命中栈里的 `Caused by:` 行，不带时间，统计不出时段分布。
- 报错栈是多行的，`grep -A/-B` 抓不全时用 `awk '/起始行/,/结束行/'` 取整段；只看前 45 行足够读到根 `Caused by`。
- 换过 server-id 之后**用计数验收**：`same server_uuid/server_id` / `produced an uncaught exception` / `Failed to close the source reader` 三个都归零、该源库 blc 线程数 = 0、`numRecordsOut` 连续 5 分钟增长，才算真的修好。
- 验收前先排除「功劳记错」：`ps -eo pid,lstart,etime,cmd | grep -E 'standalonesession|taskexecutor'` 看 JM/TM 的启动时间是否晚于配置改动。集群重启本身就会清掉全部孤儿线程，两者叠加时容易把效果全归给 server-id，导致下次只改配置不重启、问题复发时误判。
- 单表快照几十分钟是正常的（记录多 + RTT 高）。8095 条/8 分钟、大表 25 分钟，都不是卡死。

## 关键 WARN 的正确解读

```
WARN SplitFetcherManager - Failed to close the source reader in 30000 ms. There are still N split fetchers running
INFO Task - Un-registering task and sending final execution state CANCELED
```

两行连着出现 = cancel 后线程**没死**。每个 cancel 留下 N 条（N=parallelism），一条不少。UI 上看作业已经没了，JVM 里还活着。

## 重启策略：配在哪、怎么验证

`restart-strategy` **写不进 pipeline yml**——`PipelineOptions` 只认 `parallelism` / `local-time-zone`，`pipeline:` 段没有这个键（查 `flink-cdc-dist-*.jar` 里 `org/apache/flink/cdc/common/pipeline/PipelineOptions.class` 的字符串可确认）。只有两个合法位置：

**A. 集群级** —— `$FLINK_HOME/conf/config.yaml` 的**顶层** `execution:` 下、与 `checkpointing:` 同级：

⚠️ **`execution:` 在 config.yaml 里可能出现多次**：`jobmanager:` 段下也可能有一个同名的子键，那是 `jobmanager.execution.*`，改它不生效也不报错。改前先 `grep -n '^execution:'` 确认是**顶格（无缩进）**的那个，并用缩进对齐旁边的 `checkpointing:`。改完必须跑 YAML 解析校验，否则一个缩进错误就让 JM 起不来：

```bash
python3 -c "import yaml; d=yaml.safe_load(open('<path>/config.yaml')); print(d['execution'].get('restart-strategy'))"
```

```yaml
execution:
   checkpointing:
     interval: 300s
   restart-strategy:
     type: fixed-delay
     fixed-delay:
       attempts: 10
       delay: 10s
```

改前先 `cp config.yaml config.yaml.bak_$(date +%Y%m%d)`（同目录已有历史 `.bak_` 文件，沿用该命名）。**必须重启 JobManager 才生效**——该文件只在 JM 启动时读，重启 JM 会中断该集群全部作业（它们会从 checkpoint 恢复）。作业正在跑全量时不要动。

**B. 单次提交** —— `flink-cdc.sh` 的 `-D`（对应 `CliFrontendOptions.FLINK_CONFIG`，`key=val` 可重复）：

```bash
flink-cdc.sh <pipeline.yml> -D restart-strategy.type=fixed-delay \
  -D restart-strategy.fixed-delay.attempts=10 -D restart-strategy.fixed-delay.delay=10s
```

只对本次提交生效，不用重启 JM。

**验证配上了没有，不要靠读文件** —— 查 JobManager 实际生效配置：

```
GET /jobmanager/config      # 返回 [{key,value}] 数组，按 restart / uncaught / classloader 过滤
```

列表里查不到 `restart-strategy.*` = 没配。未配时默认无限重试，每次重试都可能新增孤儿。

顺带把 `classloader.check-leaked-classloader` 打开（默认 `false`）：泄漏时日志直接告警，孤儿线程复发不用再靠线程栈推断。

### 改配置分两步：写入 ≠ 生效

用户说「改一下但不要重启」时，只做**写入**，并在回复里把两件事分开报清楚：

```
写入   文件路径 + 备份文件名 + diff（改了几行、改成什么）+ YAML 解析校验结果
生效   查 GET /jobmanager/config，明确写出「仍是旧值 X，未生效，需重启 JM」+ 重启后的自测命令
```

不要把「已修改」当成结论交付——用户无法从文件改动判断运行时是否生效，而这两者在这里恰好**永远不一致**，直到 JM 重启。备份用 `config.yaml.bak_<改名要点>`，别覆盖同一天已有的 `.bak_`。

## 快照慢：先量化，再给优化方案

用户说「慢」的时候不要凭感觉答。跑 `scripts/split_durations.py <tm.log> --since '<起时>' --filter <源库IP>`：配对 START/FINISH 得到每个 split 的耗时，同时输出分组吞吐和 parallelism 仿真。拿到数字再做两件事：

1. **按表大小分组算吞吐**。如果大表小表吞吐几乎一样，瓶颈就在**共享链路带宽/RTT**，不在单表处理逻辑——此时调 `scan.snapshot.fetch.size`、`split.size` 基本无感，只有加并发才有效。反过来说，往返次数÷10 只省几秒，就说明不是往返次数的问题，别写成优化项。
2. **用最长单 split 定天花板**。`parallelism=p` 的最短总时长 ≈ max(最长单 split, 总耗时/p)。超过某个 p 后完全没收益，因为被最长那张表卡住；把上限算出来再报给用户，别线性外推。

逐 split 的固定开销要单独算：快照阶段**每个 split 读完都要重连一次 binlog 补增量**（`Connected to MySQL binlog` → `Stopped reading binlog after 0 events`，跨境 RTT 下每条 2-3 秒）。表多而空的库，这部分能占快照总时长 20% 以上，收窄 `tables` 白名单比调并行更省——但改白名单会动业务语义，必须让用户拍。

**风险约束**：`parallelism` 不能超过分配给该 pipeline 的 server-id 段宽度，否则 subtask 抢同一段 server-id，直接复现本 skill 开头的冲突。改并行度前先数 `server-id: A-B` 里有几个号。

算式、分组样例和仿真脚本说明见 `references/throughput-tuning.md`。

## 判断全量跑完没有：三个标志行

不要用「剩余表数」倒推。快照真正结束的唯一信号是 binlog split 被加入 reader：

```
Source reader 0 adds split MySqlBinlogSplit{splitId='binlog-split'...
Adding split(s) to reader: [MySqlBinlogSplit{...}
Binlog offset for tables [...]          # 之后就是这个在刷
```

表清单要用 `grep -o "including table '[^']*'"` 收集（这是 CDC 扫描到的表全集），不要用 split 计数反推——日志里 split 名会重复打印。

**「还剩 N 张没完成」绝大部分是空表，正常。** 备份/测试表不会生成 split：`*_copy`、`*_copy1`、`*_backup_2026xxxx`、`test_*`、`*_clean`、`*_del`、`sys_*_1` 这几个后缀几乎必是空的。看到差集里全是这类名字就可以直接结论「已跑完，剩余为空表」，不必逐张查 COUNT。

## 「慢是不是因为外网」怎么答

不要只报 RTT。看**同一源库、同一轮运行里不同表的吞吐差**：

- 各表吞吐接近（比如都在 100-200 条/s）→ 瓶颈在共享链路，加并发/换链路才有效。
- 各表吞吐差 20 倍以上（实测最快 365 条/s、最慢 18 条/s，同一跨境源库）→ 瓶颈是**单行体积（BLOB / 长文本）+ 可用带宽**，不是 RTT。此时 `fetch.size` 无意义，改并行度分担才对。

再算一次 RTT 理论上限把话说死：`fetchSize / RTT`（1024 / 0.09 ≈ 11,377 条/s）。实测最快只到上限的 3% 时，「在等网络往返」这个假设可以直接否掉。

## schema.change.behavior：默认值可能不是代码里的那个

判断一个 pipeline 实际跑在什么 behavior 下，**不能只看 yml，也不能只看 jar 里的源码默认值**：

- 代码默认值：`PipelineOptions.PIPELINE_SCHEMA_CHANGE_BEHAVIOR` 的 `defaultValue` 是 **`LENIENT`**。
- **真正生效的优先级**：`<pipeline>.yml` 的 `pipeline:` 段 > `$FLINK_CDC_HOME/conf/flink-cdc.yaml` > 代码默认值。

`conf/flink-cdc.yaml` 是一个容易被忽略的全局默认文件（部署包里自带，带 `parallelism: 4` 和 `schema.change.behavior: EVOLVE`）。**只要它把值写出来了，所有未在 yml 里显式配置的 pipeline 都会继承它，而不是继承代码默认值。** 实测该环境基线是 `EVOLVE`，所以「yml 没写 behavior」不等于「跑在 lenient」。

**验收只能看运行时日志**，不能靠读配置：
```
grep -a 'normalized with .* behavior' $JM | grep -o 'normalized with [A-Z_]* behavior' | sort | uniq -c
# 想看某个库/表：
grep -a 'normalized with' $JM | grep -o 'tableId=[a-z_]*\|normalized with [A-Z_]*' 
```

**五种行为的关键差异**（`SchemaCoordinator` 的日志里能看到 `Step 4 - After being normalized with X behavior`）：

| 值 | 失败时 | 备注 |
|---|---|---|
| `exception` | 拒绝所有 schema change | 日志含 `Unexpected schema change events occurred in EXCEPTION mode` |
| `evolve` | 抛 `SchemaEvolveException` → 全局 failover | sink 必须支持 schema change |
| `try_evolve` | 吞掉失败，后续数据按差异做 cast | **cast 不保证无损**，可能丢精度 |
| `lenient`（代码默认） | 吞掉失败；额外把 `DropTable`/`TruncateTable` 丢弃 | 文档写「本模式是默认」，但会被 `conf/flink-cdc.yaml` 覆盖 |
| `ignore` | 静默丢弃全部 schema change | 只适合下游完全不支持变更 |

**`lenient` 并不会改写 `AlterColumnTypeEvent`**——实测 LENIENT 归一化后仍是 `[AlterColumnTypeEvent{...}]`。`SchemaDerivator` 里只有 `lenientizeAddColumnEvent` / `lenientizeDropColumnEvent` / `lenientizeRenameColumnEvent`，没有 `lenientizeAlterColumnType`。所以别把「改 behavior」当成「解决列类型变更」的手段。

**用 SPI 容错 jar 时该配 `evolve`，不要配 `try_evolve`。** 两者是替代关系而不是叠加关系：

- 容错 jar 的 catch 在 **MetadataApplier（TM 侧 sink 端）**，只精确覆盖指定的几类事件，其余 rethrow。
- `try_evolve` 的 catch 在 **SchemaCoordinator（JM 侧）**，兜住**所有**事件类型。

配 `try_evolve` 会让 JM 先把异常吞掉，日志里只有 `keeps running in tolerant mode`，**看不出容错 jar 到底有没有命中，也掩盖了未覆盖的 6 类事件**。配 `evolve` 才能让「jar 覆盖的 → 吞掉并打 `TOLERATED_DORIS_DDL` 告警；jar 未覆盖的 → 如实 failover」这条边界成立。

## JobManager Metaspace OOM：反复重提作业的隐性代价

**症状**：JM 进程直接消失（`ss` 里 8081/6123 都不监听，`ps` 只剩 TM 和 ZK），REST 无响应。JM 日志末尾是 `java.lang.OutOfMemoryError: Metaspace`。

**成因**：`flink-cdc.sh` 每次提交都新建一个 ChildFirstClassLoader 承载 pipeline jar；cancel 不保证回收。一天内提交几十次就攒够。默认 `jobmanager.memory.jvm-metaspace.size: 512m` 撑不住。

**排查**：
```bash
grep -a 'OutOfMemoryError: Metaspace' $JM | cut -c1-60
grep -ac 'Successfully ran initialization on master' $JM   # 累计提交次数
ps -eo pid,etime,rss,cmd | grep -E '[S]tandaloneSession|[T]askManagerRunner'
```

**修复**：`config.yaml` 的 `jobmanager.memory` 下同时调 `jvm-metaspace.size` 和 `process.size`——**只调 metaspace 会启动失败**，process 必须大于 metaspace 加堆。实测 `metaspace: 2g` + `process: 3g` 可用。改完 `./bin/jobmanager.sh start`（TM 不用重启，会重新注册）。

**注意**：重启后 JM 会从 ZK HA 状态**自动恢复全部旧作业**（日志里一串 `was granted leadership`），这些作业用的是**旧 classpath**——刚改过 yml 的 pipeline 仍跑旧算子，必须再 cancel + 从新 checkpoint 重提。别看到 `jobs-running: N` 就以为切换生效了，要逐个查 `/jobs/{J}/plan` 里有没有新标识。

## checkpoint 全线失败 / 全员 RESTARTING：先对齐三处 S3 配置

判据（先分清是 checkpoint 通道坏了，不是作业逻辑坏了）：

```
/jobs/overview  全部 RESTARTING、tasks.running=0
/jobs/{J}/checkpoints  counts.restored 几十次且仍在涨、latest.completed 为空
报错族  PermanentRedirect / InvalidAccessKeyId / AccessDenied
        + Could not restore operator state backend for SourceOperator（读失败时的表现）
```

`restored` 快速累加 = 固定延迟重启策略在空转，永远恢复不成功。别去查背压、查源库。

**三处配置必须逐一对齐，它们在本集群里不会自动同步：**

```
GET /jobmanager/config     JM 运行时内存里的生效值（JM 不重启就永远是老配置）
conf/config.yaml           磁盘值（下次启动才生效）
TM 进程启动时间 + TM 日志 banner   TM 实际加载了哪一版
```

`grep -E '^s3\.' conf/config.yaml` 与 `/jobmanager/config` 的 endpoint / access-key 不一致 = 只改了文件没重启 JM。**只重启 TM 是最坏状态**：TM 跑新配置、JM 跑旧配置，两边对同一批 checkpoint 路径判断不一致。

改 AK / endpoint 时这五项必须一起看，少一项就是「改了一半」：

```
s3.endpoint / s3.access-key / s3.secret-key
state.checkpoints.dir / state.savepoints.dir   ← bucket 必须属于新 endpoint 的 region，且新 AK 有权限
```

典型故障形态：AK + endpoint 换成了新区域，但 `state.checkpoints.dir` 仍指向旧 bucket → 写不进、也读不出，全员重启循环。

**判定 AK 到底有没有效，用 ListBuckets（服务级，与 bucket 无关），不要用 ListObjects：**

```
403 InvalidAccessKeyId   AK 本身已不存在/被删 → 回滚配置无用，只能换新 AK 或改指向
200 + bucket 列表        AK 有效，问题在 endpoint / bucket 权限
403 AccessDenied         AK 有效，但无该 bucket 权限
```

bucket 的真实 region 一次错误请求就能探出来：`PermanentRedirect` / `AccessDenied` 的 XML body 里带 `<Endpoint>`，那就是正确 endpoint。不要靠猜 bucket 在哪个 region。

修复路径三选一，摆给用户拍，别替他选：

```
A 申请新 bucket 所属区域的 AK        最温和，历史 checkpoint 全保留
B 把 checkpoints.dir/savepoints.dir 切到新 bucket   旧 checkpoint 全废，CDC 从空状态起
                                                   → 必须确认源库 binlog 还在有效期，否则漏数据
C 回滚 config.yaml 到旧备份          仅当旧 AK 仍有效；先用 ListBuckets 验，别假设它还能用
```

**任何一条都必须 JM + TM 一起重启**，并且重启后 `GET /jobmanager/config` 的 `s3.*` 要等于磁盘值才算生效。

### ⚠️ `path-style-access` 写成连字符版（或漏写）在 flink-s3-fs-presto 上无效

`SecondLevelDomainForbidden` 的另一条成因，**不是 AK/bucket 问题**：配置里写了 `path-style-access` 却仍是 path-style 请求。

**两个类读的键名不同**（解包 `flink-s3-fs-presto-*.jar` 读常量池可证）：

```
S3FileSystemFactory          映射出  presto.s3.path.style.access   （点号）
                                       presto.s3.path-style-access  （连字符）
PrestoS3FileSystem  真正读取的键      presto.s3.path.style.access   （只有点号）
```

`PrestoS3FileSystem` 的常量池里**没有** `presto.s3.path-style-access`。所以 config.yaml 写
`s3.path-style-access: false`（连字符）→ factory 映射成同样连字符的 presto 键 → **Presto 读不到，回落到默认 path-style=true** → OSS 报 SecondLevelDomainForbidden。

**正确写法（config.yaml 顶层）**：

```yaml
s3.endpoint: oss-cn-beijing.aliyuncs.com
s3.path.style.access: false          # 点号！false = virtual-hosted，OSS 唯一可用形态
s3.access-key: <AK>
s3.secret-key: <SK>
```

**判定「配置到底生效没有」只看运行时，不看文件**：

```
GET /jobmanager/config | grep path.style     # 出现 s3.path.style.access=false 才算生效
```

⚠️ **「运行时显示 false、日志仍报 path-style」= 键名映射断在某一层**，此时不要继续调 AK / endpoint / bucket，回头核对键名点号还是连字符。

⚠️ **改完必须 JM + TM 一起重启**：TM 也需要 presto S3 配置（写 checkpoint 走 TM）。只重启 JM 会出现
「作业能 RUNNING 但 checkpoint 全部 failed」——恢复读走 JM 新配置（通了），写入走 TM 老配置（仍然 path-style）。
判据：JM 日志 `SecondLevelDomainForbidden` 少、**TM 日志里成百上千次**，就是 TM 没重启。

### 顺带核 slot 总量：restored 循环会掩盖「作业根本起不来」

```
sum(/jobs/overview 里每个 job 的 tasks.total)  vs  sum(/taskmanagers 的 slotsNumber)
ps -eo pid,lstart,cmd | grep '[T]askManagerRunner'      ← TM 进程数，别只看 slots 总数
```

slot 不够时即使 checkpoint 修好，也有一半作业排不上（日志表现为 `NoResourceAvailableException: Could not acquire the minimum required resources`）。这是独立问题，要在结论里单独指出，不要混进 S3 根因。

签名细节（OSS V1 / StringToSign / SignatureDoesNotMatch 成因）与可直接跑的探测脚本见 `references/checkpoint-storage-s3.md`。

## 切换 sink 实现/配置但保留状态

改 `type:`、换 jar、改路由这类变更要保留 binlog 位点，就得 cancel + 从 checkpoint 重提。**实测：算子名随 `type:` 变化（`Flink CDC Event Sink: doris` → `: doris-tolerant`）不影响恢复**——state 按算子 UID 匹配，不按名字。前提是 `externalized-checkpoint-retention: RETAIN_ON_CANCELLATION` 已开。

完整流程、逐条验证点和踩过的坑见 `references/pipeline-switch.md`。

## 批量切换 pipeline 的脚本陷阱

```bash
for f in ...; do cd $CDC && ./bin/flink-cdc.sh $f ...; done   # ✗ 错
```

`cd` 在循环里改掉了 cwd，第二轮起相对路径 `yml/dev/x.yml` 就找不到——而且 `flink-cdc.sh` 找不到 yml 时的报错不会中断脚本，结果是「cancel 成功了、重提失败了」，作业直接停在 CANCELED。**批量脚本一律用绝对路径**（yml 和 FLINK_HOME 都要），并在每轮后 sleep 十几秒确认新 jid 出现再进下一轮；中途异常先 `pkill` 掉脚本再人工补提，不要让它继续 cancel 后面的作业。

## 重启后作业全没了：先查 ZK 的 dataDir

`jobs-running: 0` 且 JM 日志有 `Successfully recovered 0 persisted job graphs` —— 不是恢复失败，是 HA 里压根没有作业图。**先查 ZK 用了哪个 dataDir，别急着从 S3 找 checkpoint。**

```bash
grep -a "No 'dataDir' configured" $FLINK_HOME/log/flink-root-zookeeper-*.log
# WARN ... Set to '/tmp/<uuid>/zookeeper'.   ← 每次启动都换一个新 UUID 目录
```

`conf/zoo.cfg` 的 `dataDir` 被注释时，Flink 自带的 `FlinkZooKeeperQuorumPeer` 每次启动生成**随机 UUID 的 /tmp 子目录**。所以不只机器重启会丢，**单独重启 ZK 也一样丢**——这条最容易被误判成别的原因。`high-availability.storageDir`（S3）存的是作业图大对象，ZK 里存指针；指针没了 S3 上的图就没人引用。

修复：`zoo.cfg` 显式 `dataDir=<持久化绝对路径>`，建目录，然后**按顺序** `stop-cluster.sh` → `zookeeper.sh stop` → `zookeeper.sh start 1` → `start-cluster.sh`。验收看 ZK 日志 `Configuration:` 里的 dataDir，以及该目录下出现 `myid` + `version-2/`（`snapshot.0`、`log.1`）。改之前一定先把恢复点记下来——这次重启就会再丢一次作业定义。

### 从 checkpoint 逐作业恢复

1. **jid→chk 只能从 JM 日志反查**（集群重启后 `/jobs/overview` 里已经没有它们）：
   ```bash
   grep -a 'Completed checkpoint' $JM | sed -E 's/.*Completed checkpoint ([0-9]+) for job ([0-9a-f]{32}).*/\2 \1/' \
     | awk '{if($2>m[$1])m[$1]=$2} END{for(j in m) print j, "chk-"m[$1]}'
   ```
   落到文件存好，再按作业名（`Sync Ubs Database to Doris For FAT`）映射回 yml。
2. **提交前 boto3 head_object 验证 `_metadata` 存在**。路径写错时 `flink-cdc.sh` 不会报错退出，而是**起一个全新的初始作业重跑全量**——最坏的情况。OSS 必须 `botocore.config.Config(s3={'addressing_style':'virtual'})`，path-style 会 SecondLevelDomainForbidden。
3. `flink-cdc.sh "$Y/<name>.yml" -s "$S/<jid>/chk-<N>"`，yml 用绝对路径，别在变量里重复带 `.yml`。
4. **验收不能只看 RUNNING**：`GET /jobs/{J}/checkpoints` 的 `latest.restored.external_path` 必须等于提交时 `-s` 的那个 chk；为空说明 `-s` 没生效，作业在全量重跑。

作业刚起来时的 `counts.failed: 1` 多半是 INITIALIZING 阶段那次触发失败（`Failed to trigger checkpoint ...`），后续能 COMPLETED 就不用管。

### 批量恢复 N 个作业：先数作业，绝不「看不到进度就重提」

单个 `flink-cdc.sh` 提交要 15-60s，10 个作业必然超过一次前台调用的预算。批量脚本一定放后台跑，再另外轮询：

```bash
nohup bash /root/restore.sh > /root/restore.log 2>&1 &
pgrep -f restore.sh && tail -5 /root/restore.log   # 轮询用，不要在前台等
```

**前台 terminal 超时（420s）≠ 远端脚本停了。** 超时后第一件事是 `GET /jobs/overview` 数作业、比对作业名清单，**不是补提交**。同一条 yml 换个新 jid 再提一次 = 两个作业用同一段 `server-id` 连同一个源库 → 互相踢下线 → 两边都进 failover 空转。这是本 skill 开头「孤儿 blc 线程占用 server-id」的另一条触发路径，也是最容易自己造出来的一条。

**判据：`counts.restored` 持续增长 + `latest.restored.external_path` 指向该作业自己的 jid**（而非原件 jid）＝ 它在从自己的 checkpoint 反复重启。这不是恢复点坏了，是 server-id 冲突。JM 日志复核：

```bash
grep -a 'Restoring job <新jid> from Checkpoint' $JM | wc -l   # N 次 = 空转 N 轮
```

处置：`PATCH /jobs/{J}?mode=cancel` 掉多余那个（连同它刚生成的 checkpoint 目录一起视为垃圾），保留的让它跑满一个 checkpoint 周期（5 分钟）再验收。

**收尾验收的唯一标准：每个作业的 `restored.external_path` 都精确指回各自的原件 jid/chk。** 10 个作业里有一个指回自己的 jid，就说明还在这轮冲突里，不能说「全部恢复完成」。跑满一个 checkpoint 周期后再验收（`counts.completed` 较提交时 +1 以上、`failed=0`），别在提交后 30 秒就看结论。

## 交付形态：SQL 和连接信息一律贴正文

用户说「把 SQL 显示出来」「直接显示出来」时，要的是**能直接从聊天里复制走**的内容：全文贴 Markdown 代码块，文件放最后当附件。只给文件路径、或说「见某文件」等于没交付。同理连接信息（endpoint / 端口 / 账号 / 库名）也直接列在正文，别让人去翻 yml。

SQL 交付的固定形态：库前缀 + 每条语句独立 + 末尾附自检查询（常量表 `LEFT JOIN information_schema.columns`，`WHERE column_name IS NULL`，0 行即全部到位）。互相冲突的语句（如 `RENAME a→b` 与 `ADD COLUMN b`）必须显式标「二选一」，不能并列丢给用户。

**任何 DDL 上线前先建 `zz_` 临时表验一遍语法**，验完 DROP；生产表只执行已验证过的语句。`DROP` / `ALTER` 生产表一律等用户点头，助手只交 SQL。

## 传输脚本的坑

远端起进程的命令含反引号/`$`/嵌套引号时，`bash -c` 极易 `unexpected EOF`。统一走 base64：`echo <b64> | base64 -d > /tmp/x.py && python3 /tmp/x.py`

**脚本里内联过 S3 AK / 库密码的，用完必须删。** checkpoint 相关的探查脚本几乎都带 `aws_access_key_id=...` 明文，留在 `/tmp` 就是二次泄露。收尾固定做一次，并回扫确认：

```bash
rm -f /tmp/[a-z]*.sh /tmp/[a-z]*.py
grep -rl '<AK 前 8 位>' /tmp 2>/dev/null || echo "no key left in /tmp"
```

**扫描范围必须收窄**：`grep -r /root` 会撞上近 10GB 的 `log/`，直接 exit 124 超时；只扫 `/tmp` 和明确的脚本/配置文件路径。本机落盘的临时密码文件（`/tmp/.p<机号>`）同样在收尾时删掉未再使用的那些。
