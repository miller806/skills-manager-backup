# 目标端列缺失 / 类型漂移：比对、补列、重灌

适用：CDC 作业 RUNNING、checkpoint 正常、行数也对得上，但某些字段**全空或全是默认值**；或者用户拿源库升级脚本问「Doris 这边要不要删表重建」。

## 一、先判症状：行数对但字段空 = 目标端列不存在

容错 jar 的 `TargetSchemaLookup` 只取**目标端**表的列清单去构造写入语句。源端多出来的列**不会被写、不会报错、不会告警**，直接静默丢弃。

```
源端 20 列 / 目标端 17 列  →  插 96 万行全部成功  →  3 个字段恒为 NULL 或 DEFAULT
```

所以「数据同步没报错」「行数一致」**都不能证明 schema 对齐**。用户在业务侧发现字段空才来问的时候，别再去查 checkpoint、位点、队列——直接做下面的列比对。

## 二、全库列比对（这是唯一可靠的判据）

不要只看用户给的 DDL 脚本涉及的那几十张表：脚本之外的历史欠账（从没同步过的列）一样要算。**全库比，不要抽样。**

源端：直连 MySQL 查 `information_schema.columns`。目标端：Doris 走 8080 REST（模板见 SKILL.md「Doris REST 直查」）。

```sql
SELECT table_name, column_name, column_type, is_nullable, column_default, ordinal_position
FROM information_schema.columns WHERE table_schema = '<库>' ORDER BY table_name, ordinal_position;
```

两边按 `table_name + column_name` 做集合运算，输出三类：

```
源有目标无   → 缺列（本文件主题）
目标有源无   → 多余列；若 NOT NULL 且无 DEFAULT，会**阻塞写入**，要优先处理
类型族不一致 → ADD COLUMN 修不了，见第五节
```

先确认表是一一对应的（`udun` 96 表 ↔ Doris `udun_` 前缀 96 表），再做列比对；表数量对不上说明路由或白名单本身有问题，不是列的问题。

## 三、Doris 的类型映射与 DDL 硬约束（全部实测）

```
① varchar(N) 在 Doris 按【字节】计，MySQL 按【字符】计
   utf8mb4 下 MySQL varchar(N) → Doris 必须 VARCHAR(N*3)
   照抄源端长度 → 中文/emoji 存不下，写入时报长度超限或截断

② 对已有数据的表 ADD COLUMN ... NOT NULL 必须带 DEFAULT
   缺 DEFAULT 直接失败：{"code":1,"msg":"Error"}
   源端 NOT NULL 但无默认值的列，统一补 DEFAULT ''（或 0，按语义）

③ Doris 不支持 MySQL 的 CHANGE COLUMN
   ALTER TABLE ... CHANGE ...  →  no viable alternative at input '... CHANGE'(line 1, pos 44)
   必须拆成 RENAME COLUMN（改名）/ MODIFY COLUMN（改类型）/ ADD COLUMN（加列）

④ ALTER TABLE ... ADD COLUMN 的 AFTER 可以用，但没有「链式位置」语义
   一次 ALTER 里多个 ADD COLUMN，第一个带 AFTER 就够了，后面的顺序按语句顺序追加
   参照列存在才写 AFTER；参照列不存在时省略 AFTER（放末尾），否则整句失败
```

**任何 DDL 上线前先在临时表验一遍**：

```sql
CREATE TABLE ods_xxx.zz_t1 (id INT) UNIQUE KEY(id) DISTRIBUTED BY HASH(id) BUCKETS 1 PROPERTIES('replication_num'='1');
INSERT INTO ods_xxx.zz_t1 VALUES (1);          -- 造一条数据，才能复现 NOT NULL 报错
ALTER TABLE ods_xxx.zz_t1 ADD COLUMN c1 VARCHAR(384) NOT NULL;   -- 期望失败
DROP TABLE ods_xxx.zz_t1;
```

用 `zz_` / `tmp_` 前缀，测完立刻 DROP。**绝不拿生产表做语法试探**——Doris 的 ALTER 失败也可能把表卡进 `SCHEMA_CHANGE` 状态，后续 ALTER 全被拒（`state(SCHEMA_CHANGE) is not NORMAL`）。

## 四、修表结构的时机：抢在快照轮到你之前

`initial` 全量快照是**按表排队**的。对还没轮到快照的表先 `ADD COLUMN`，快照写入时就能一次填对，**不需要重灌**；已经跑完的表只能事后重灌。

```bash
# 查进度：已完成 vs 还在队列
grep -a "Finished exporting .* for split" $TM | grep -o "for split '[^']*'" | sort -u
```

给用户排优先级用这个分界：

```
还在队列 → 现在加列，零成本
已跑完   → 加列 + 重灌该表（UNIQUE KEY 表用单表 repair 任务重跑一次全量，幂等不产生重复行）
```

## 五、补列 vs 删表重建：怎么选

```
全是「源有目标无」的列           → ADD COLUMN 就够，别删表
有列类型族变化（longtext→varchar、float→double、varchar→bigint）
                                 → ADD COLUMN 修不了。要么 MODIFY COLUMN（Doris 对改变类型族限制很严，先临时表验），
                                   要么 DROP + 重建，后者必须让用户拍板
目标端多出的 NOT NULL 无默认值列  → 删列或补默认值，否则写入被阻塞
```

`UNIQUE KEY` 模型的表补列、改列都不会改变 key 语义，是最安全的一类；`DUPLICATE KEY` / `AGGREGATE KEY` 表动列前先 `SHOW CREATE TABLE` 确认 key 列有没有被卷进去。

删表重建的代价必须量化后再交给用户：会重跑多少张表、当前快照进度会归零、期间源库变更同步不到。**DROP 生产表永远等用户明确点头**，助手只交 SQL。

## 六、`CREATE TABLE IF NOT EXISTS` 只建表，不改已有表

跑 `initial` 全量时日志里能看到大量 `CREATE TABLE IF NOT EXISTS`，很容易误以为「作业会自动对齐 schema」。实测：

```
CREATE TABLE IF NOT EXISTS   66 次（每张表发一遍，已存在则跳过）
ALTER TABLE                   0 次
SchemaChangeEvent             0 次
```

对已存在的旧表**零帮助**。只有 Doris 里原本不存在的表会被真正建出来（看 `information_schema.tables.create_time` 能区分：新建的是当天时间戳，其余还是几个月前）。`schema.change.behavior: evolve` 也只对**运行中收到的 DDL 事件**生效，不会回头补历史欠账。

## 七、交付物形态

给用户的补列 SQL 必须是**可直接整段粘贴执行**的：

- 汇总成一份 `.sql` 文件，同时把全文贴在聊天里（用户要的是复制，不是路径）
- 每个 `ALTER TABLE` 一条语句、表名加库前缀，别用变量/循环
- 末尾附一段自检 SQL：把「表名 + 列名」列成常量表 `LEFT JOIN information_schema.columns`，`WHERE c.column_name IS NULL`，跑完 0 行 = 全部到位
- 需要配合的 RENAME/MODIFY 单独标注「与某条 ADD 冲突，二选一」，别让用户两条都执行
