# preset / 技能库巡检 SQL 与分析片段

库：`~/.skills-manager/skills-manager.db`（只读查询即可，写操作一律走 CLI，避免与 app 抢写）。

## 库规模

```sql
SELECT 'skills',COUNT(*) FROM skills
UNION ALL SELECT 'presets',COUNT(*) FROM scenarios
UNION ALL SELECT 'tags',COUNT(DISTINCT tag) FROM skill_tags
UNION ALL SELECT 'targets',COUNT(*) FROM skill_targets
UNION ALL SELECT 'projects',COUNT(*) FROM projects;
```

## preset 清单（名称/描述/排序/成员数）

```sql
SELECT sc.sort_order, sc.name, sc.description, COUNT(ss.skill_id) AS n
FROM scenarios sc LEFT JOIN scenario_skills ss ON ss.scenario_id = sc.id
GROUP BY sc.id ORDER BY sc.sort_order;
```

## 每个 preset 具体包含哪些技能

```sql
SELECT s.name, s.source_type, s.status
FROM scenario_skills ss
JOIN skills s ON s.id = ss.skill_id
JOIN scenarios sc ON sc.id = ss.scenario_id
WHERE sc.name = 'S·开发流程'
ORDER BY s.name;
```

## 一键全量视图（技能 → preset + 部署）

```sql
SELECT s.name, s.enabled, s.source_type,
       group_concat(sc.name, ',') AS presets
FROM skills s
LEFT JOIN scenario_skills ss ON ss.skill_id = s.id
LEFT JOIN scenarios sc ON sc.id = ss.scenario_id
GROUP BY s.id ORDER BY s.name;
```

## 治理缺口

```sql
-- 没有任何 preset 的技能
SELECT name FROM skills WHERE id NOT IN (SELECT skill_id FROM scenario_skills);
-- 没有任何 tag 的技能
SELECT name FROM skills WHERE id NOT IN (SELECT skill_id FROM skill_tags);
-- 跨多个 preset 共享的技能（有意为之，报告时标明即可）
SELECT s.name, COUNT(*) c, group_concat(sc.name,'|')
FROM scenario_skills ss JOIN skills s ON s.id=ss.skill_id JOIN scenarios sc ON sc.id=ss.scenario_id
GROUP BY s.id HAVING c>1;
-- tag 分布
SELECT tag, COUNT(*), group_concat(s.name,',') FROM skill_tags st JOIN skills s ON s.id=st.skill_id GROUP BY tag;
```

## 部署现状（真实生效的东西）

```sql
SELECT tool, COUNT(*), group_concat(DISTINCT mode) FROM skill_targets GROUP BY tool;
SELECT s.name, t.tool, t.mode, t.status FROM skill_targets t JOIN skills s ON s.id=t.skill_id ORDER BY s.name;
```

若部署数 = 某几个 preset 成员数之和，说明生效的是这几个 preset（加法式部署），而不是 `presets current` 报的那个。

## 库目录 vs DB 行是否一致（发现孤儿/丢失）

```bash
cd ~/.skills-manager/skills
comm -13 <(sqlite3 ~/.skills-manager/skills-manager.db "SELECT name FROM skills ORDER BY name") \
         <(ls -d */ | tr -d '/' | grep -v '^\.' | sort)   # 有目录无 DB 行
comm -23 <(sqlite3 ~/.skills-manager/skills-manager.db "SELECT name FROM skills ORDER BY name") \
         <(ls -d */ | tr -d '/' | grep -v '^\.' | sort)   # 有 DB 行无目录
```

两边都空 = 干净。

## JSON 镜像 vs DB 漂移检查

对 `.skills-manager/scenarios/*.json` 逐个比对 `name | description | sort_order` 与 `scenarios` 表同名行；出现不一致说明有人手改过单边，以 DB 为准、用 `presets update` 回写再让 app 重新导出。

## 注意

- `audit_log.ts` 是微秒/毫秒混存的坏数据，`datetime(ts/1000,'unixepoch')` 会算出 1970 年 —— 该表只能看 action/skill_name/detail，别看时间。
- `settings` 里凭据是 `enc:v1:...` 加密串（proxy_url、git_backup_remote_url），不要试图解密或打印全文。
