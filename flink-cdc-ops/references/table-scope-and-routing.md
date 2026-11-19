# 同步范围（tables）与落表路由（route）

判断「这条 pipeline 到底同步哪些表、落到哪个库的哪张表」，**读 yml 只是起点，证据在运行时日志**。

## 0. 铁律：点号语义与标准正则**完全相反**

CDC 3.6.0 对 `tables` / `source-table` 里的点号做了一次替换：**裸 `.` = 字面点（库表分隔符），`\.` = 正则的「任意字符」**。跟 Python 正则正好反过来。

直接证据在日志里（`TableIdRouter` 每次提交都打）：

```
yml 写的  source-table: (\.*).(\.*)
日志解析  Final standard RegExp table capture list: (.*)\.(.*)
          Expression after un-escaping dots as RegEx meta-character:
              (_dot_placeholder_*).(_dot_placeholder_*)
```

对照表：

```
yml 写法              实际正则           含义
ubs_\.*.\.*           ubs_.*\..*         ubs_ 开头任何库任何表       ✓ 全库
ubs_webhook\..*       ubs_webhook\..*    ubs_webhook 库任何表         ✓ 单库
ubs_webhook.\..*      ubs_webhook.\..*   ✗ 错，库里含点，匹配不到
ubs_webhook\\.\\.*    ✗ 两个反斜杠 = 字面反斜杠，discovery 直接失败
ubs_project.tproject_set                精确表名，裸点是对的        ✓
```

**两个反斜杠是纯语法错误，不是「更安全」。** 写 `\\.` 时 YAML 不报错，但枚举器启动即抛：

```
IllegalArgumentException: No matched tables found. Please verify:
1) The configured database(s) [[.*]] and table(s) [[ubs_webhook.\\.*]] exist;
2) The MySQL user has sufficient permissions to access them.
```

看到这条 `No matched tables found` 先查 `tables` 行的**字节级反斜杠个数**（`python3 -c "print([ord(c) for c in line])"`，92 = `\`），别去查权限或库名。

## 1. `tables` 正则：别用 python `re` 静态推断，要读日志里的解析结果

用 `re.fullmatch` 拿 yml 原文去匹表名会得到「只能匹配 `ubs_a.b` 这种单字符库名」的错误结论——因为漏了第 0 节的点号替换。**正确姿势是读日志里那行解析结果**：

```bash
grep -a 'Final standard RegExp table capture list' $JM | tail -1
```

## 2. 运行时确认同步范围

```bash
TM=$(ls -t $FLINK_HOME/log/flink-root-taskexecutor-*.log | head -1)

# a) 解析后的捕获规则（每条 pipeline 一行，含所有 yml 的）
grep -a 'Final standard RegExp table capture list' $TM | sed -E 's/.*list: //' | sort | uniq -c

# b) 实际发现的表全集（快照阶段才有）
grep -a "including table '" $TM | sed -E "s/.*including table '([^']+)'.*/\1/" | sort -u

# c) 当前 binlog 正在跟的库（作业运行期持续刷，最能代表「现在同步谁」）
grep -a 'Binlog offset for tables' $TM | tail -1 \
  | sed -E 's/.*tables \[//; s/\].*//' | tr ',' '\n' \
  | sed 's/^ *//; s/\..*//' | sort -u
```

⚠️ **一条 pipeline 的 `Binlog offset for tables [...]` 只列它自己和的一批表，不是全库**；连 `tail -20` 拿到的是不同 pipeline 的行。要判断「某个库有没有被某条 pipeline 覆盖」，必须对**同一条 pipeline 的多行**求并集，或直接看 (a) 的捕获规则——单行结论会漏。

## 3. `route` 段：占位符与最易踩的缩进坑

全库同步走通配：

```yaml
route:
  - source-table: (\.*).(\.*)
    sink-table: ods_uat.$1_$2
```

单表补数走精确名，**`source-table` 写全名 `库.表`，不要只写表名**，避免不同库同名表互相抢路由：

```yaml
route:
  - source-table: ubs_project.tproject_set
    sink-table: ods_uat.ubs_project_tproject_set
```

### 坑：缩进一错，路由静默失效

```yaml
route:

source-table: tproject_set          # ✗ 顶格 = 变成顶层键
  sink-table: ods_uat.xxx           # ✗ 缩进也不对
```

YAML 不会报错（`route: null` 合法），作业照常 RUNNING，**但路由没生效，数据落到默认的同名表**。整个链路里唯一的痕迹在 sink 日志的 stream load label 上：

```
_0_tproject_set_<uuid>              ← 裸表名 = 路由没效力
_0_ubs_project_tproject_set_<uuid>  ← 目标表名正确 = 路由生效
```

**验收：`grep -ao 'stream load started for _0_[a-z0-9_]*'`，看 label 里的表名是不是你期望的目标表名。** 不要用「作业 RUNNING + 有写入」判断路由正确。

提交前先本地解析一次：

```bash
python3 -c "import yaml;d=yaml.safe_load(open('<yml>'));print(d.get('route'))"
```

输出 `None` 或 `[{'source-table': ...}]` 缺 `sink-table` 就是错的。

## 4. 多环境共用一个 Doris：靠 route 区分，不靠 fenodes

dev / fat / uat 三条 pipeline 的 `fenodes` 可能**完全一样**（同一个 selectdb 集群实例），环境隔离全靠 route 的目标库前缀：

```
dev → ods_dev.$1_$2
fat → ods_fat.$1_$2
uat → ods_uat.$1_$2
```

后果：TM/JM 日志里看到 `ubs_project_tproject_set` 被写入，**分辨不出是哪个环境的作业**——表名相同。判定归属只能看 SchemaOperator 的归一化行：

```
Refreshed evolved schemas: {ods_fat.ubs_project_tproject_set=columns={...}}
                            ^^^^^^^ 这一段是唯一的环境标识
```

```bash
grep -a 'Refreshed evolved schemas' $TM | grep -o 'ods_[a-z]*\.[a-z0-9_]*' | sort | uniq -c
```

排查「这张表数据不对」时，先确认你说的是哪个 `ods_*` 库，再谈是谁写的。

## 5. 单表补数（repair）pipeline 的生命周期

补一张表的标准做法是**另起一条独立 pipeline**，不动主任务：

```yaml
source:
  type: mysql
  hostname: <与主任务同一源库>
  tables: <库>.<表>            # 精确全名
  server-id: <一段未被占用的号>  # 与主任务不冲突即可并存
  scan.startup.mode: initial     # 补历史必须 initial

sink:
  type: doris-tolerant
  fenodes: <同主任务>

route:
  - source-table: <库>.<表>
    sink-table: ods_<env>.<库>_<表>

pipeline:
  name: ... For <ENV> Repair
  parallelism: 1
  schema.change.behavior: evolve
```

### 5.1 bootstrap 建表 pipeline：目标端表不存在时的一次性任务

这个变体**与 repair 不同**：目的不是补数据，是让 Doris 把表建出来，随后就能 cancel。适合「新库/新表从未同步过，但 `evolve` 收到 DDL 就直接 failJob」的场景（详见主 SKILL.md 同名章节）。

与 repair 的三个差异：

```
① tables 写显式表名列表，别用通配
   ubs_webhook.webhook_config,ubs_webhook.webhook_operation_log,...
   理由：显式名在 discovery 阶段能准确命中，避开点号语义的歧义
② 不带 -s 提交
   理由：必须从空 schema 状态开始，CDC 才肯下发 CreateTableEvent；
         带 -s 会恢复 checkpoint 里的 schema，建表事件被判 redundant 丢掉
③ 建完立刻 cancel，不常驻
   理由：它会跟主任务抢 binlog 连接和 server-id 段
```

验收只能看这两行，缺一不可：

```
Successfully applied schema change event CreateTableE...
Finished exporting N records ... for split <表名>
```

然后才做第 2 步：从主任务的 checkpoint 恢复。**顺序反了就白做**，因为主任务一起来就又撞 `table not found`。

验收 Doris 侧（不要靠日志推断）：

```python
q("show tables like '%<keyword>%'")   # 期望 = 源库表数
```

再比一遍源库行数——源库本来空的表，Doris 建完 0 行是**正确**的，别当成没同步。

### 5.2 repair 作业的注意事项

要点：

- **`server-id` 必须和主任务不同段**，否则同一源库上直接复现 server-id 冲突。`grep -H 'server-id' yml/*/*.yml` 先看现有分配。
- **`scan.startup.mode: initial` 会重跑一次全量**。单表通常几十秒（千行级 7-8 秒），成本可接受，不必费劲找 checkpoint。
- **`initial` + 精确 `tables` 的组合默认不覆盖目标表**：CDC 会先 `CREATE TABLE IF NOT EXISTS` 再灌，已存在的表结构不会被重置。需要「先清空再灌」必须手工 `TRUNCATE` 或 `DROP`，CDC 不做。

### 补完之后：cancel ≠ 同步完成

repair 作业在跑快照 → 跟随 binlog，是**持续同步**的。一旦 `cancel`，源表后续的增删改**不再同步**，目标表就静止在 cancel 那一刻。

所以交付时要讲清楚两种模式的区别，别让用户以为「补过一次就永久对齐了」：

```
一次性补历史   跑完快照即可 cancel，但之后源端变更不会同步
常驻同步       保持 RUNNING，占固定 server-id 段，与主任务并存
```

判断「主任务会不会自己接手这张表」时，不要只看主任务 yml 的 `tables` 通配——按第 1 节的结论用运行时日志确认，两组证据都指向「不覆盖」才敢下结论。

### 回答「这个 yml 对吗」的方式

先做三件事再开口，不要凭读配置推断：

1. 拉现网同类 yml（`uat/ubs-mysql-to-doris.yml`、已有的 `*-repair.yml`）做逐段对照；
2. `python3 -c "import yaml;..."` 实际解析，看 `route` 等结构有没有被缩进搞坏；
3. 查该作业历史上跑过没有、`stream load label` 落的是哪张表。

历史里出现过的同名作业（`For UAT` / `For UAT11` / `For UAT Repair`）说明这个 yml 被反复用过，**先看它上次为什么被 cancel，再回答「能不能用」**。
