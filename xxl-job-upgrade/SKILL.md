---
name: xxl-job-upgrade
description: Use when upgrading or debugging XXL-JOB admin/executor.
---

# XXL-JOB 版本升级

## 铁律

- **2.4.1 ↔ 3.5.0 协议双向不兼容，必须原子切换，不能灰度。**
  - 3.5.0 admin → 2.4.1 执行器：`invalid request, uri-mapping(/trigger) not found`（老执行器只暴露 `/run`）
  - 2.4.1 admin → 3.5.0 执行器：`invalid request, accessToken or appname is empty`（3.5.0 强制 token + appname 双 header）
- **admin 用官方镜像即可**：`image: xuxueli/xxl-job-admin:<version>`。只有「admin 侧也要禁 GLUE」时才需要自建定制镜像；纯 BEAN-only 的业务诉求靠执行器侧 `setGlueEnabled(false)` 就够。
- **只升 admin 一定全炸，且炸法有欺骗性**：2.4.1 执行器挂在 3.5.0 admin 下时，registry 表里**能看到心跳记录**（注册路径可能还通），但 `xxl_job_log` 里全部 `trigger_code=500`、`trigger_msg` = 「执行器地址为空」。看到「有心跳」就以为好了是本节最容易犯的误判。
- **回滚不是「镜像换回去」这么简单**：库结构一旦改成 3.5.0（`job_desc`→`name`、`title`→`name`、加 `token`/`access_token`、删 `i_app_name` 前的状态），退回 2.x 镜像后旧代码立刻 `Unknown column 't.job_desc' in 'field list'`，页面照常能开、登录也正常，但任务列表和调度全废。回滚顺序固定：**换回 compose 备份 → 执行反向 DDL（见「回滚」节）→ `docker restart` → 确认日志零 `Unknown column`**。
- **升级前必须先在副本库预演**：dump 生产结构 + 关键表数据（info/group/user/lock）到临时库 → 跑 DDL → 起测试容器指向它 → 手工 POST 注册跑通，再动生产。
- 3.x 无官方增量升级 SQL，`doc/db/` 只有全量建表脚本，ALTER 要自己推导。
- **密码明文必须 ≤20 字符**：登录页 `<input type="password" ... maxlength="20">` 会在浏览器端截断，SHA-256 自然对不上。curl/接口测试**测不出**这个问题（不走前端截断），只有页面登录失败，极易误判成哈希算错或路径错。所有账号统一按 20 位生成——细节见 `references/account-and-permission.md`。

## 上线前盘点：先定位 admin / 执行器 / 库，再动手

存量环境常同时存在多个 admin、多个库、多种执行器版本，还有「升到一半」的机器。逐机跑三条命令盘全：

```bash
# ① admin：容器名 + 镜像 tag + 状态
docker ps -a --format '{{.Names}}|{{.Image}}|{{.Status}}' | grep -i xxl
# ② 执行器：监听端口 + jar 内 core 版本（别信文件名，信 jar 里的条目）
ss -lntp | grep -E ':(8083|14000|12000|12100) '
for j in /udun/app/*.jar /udun/app/*/*.jar /opt/app/*/*.jar; do
  echo "$(basename $j)=$(unzip -l $j 2>/dev/null | grep -oE 'xxl-job-core-[0-9.]+' | head -1)"
done
# ③ 库归属：配置里的 admin 地址常写主机别名，必须查 /etc/hosts
grep -rls 'admin-addresses' /udun/conf /opt/app/conf | grep -vi bak
grep -iE 'xxl|mysql' /etc/hosts
# ④ 执行器指向哪个 admin：外部配置只查到一半，另一半硬编码在 jar 内
for j in /udun/app/*.jar /udun/app/*/*.jar /opt/app/*/*.jar; do [ -f "$j" ] || continue
  v=$(unzip -p "$j" BOOT-INF/classes/application-job.yml 2>/dev/null | grep -oE 'admin-addresses.{0,40}' | head -2)
  [ -n "$v" ] && echo "$(basename $j): $v"
done
```

- **`admin-addresses` 要外部配置和 jar 内两处都查**：只 `grep` 配置文件会以为某台执行器「没配」，实际写在 `BOOT-INF/classes/application-job.yml` 里。两处**同时存在且不一致**是常见的（jar 打磨机带的默认值 vs 部署时外挂的配置），Spring Boot 外部配置优先、跑起来是外部那个值，但改地址时只改一处会让下次换包被打回旧值。逐机列全再动手。

- **镜像 tag 不代表镜像内代码的版本**，路由探针更可信：`/xxl-job-admin/auth/login` 200 + `/toLogin` 404 = 3.x，老版反之。再配 `docker logs <admin> | grep 'Tomcat started'` 确认 context path。
- **`admin-addresses` 里的主机名（`ubs.xxl` / `ubs.mysql` / `udun3.xxl`）必须查 `/etc/hosts` 才知道落在哪台**——同名别名在不同环境指向不同 IP，按域名猜机器会连错库。
- **多实例环境里 MySQL root 密码各机不同**（同批次部署也可能不一样），别拿一台的密码套全部。从容器 env 直接取最可靠：`docker inspect <mysql容器> --format '{{range .Config.Env}}{{println .}}{{end}}' | grep MYSQL_ROOT_PASSWORD`。用错密码是 `Access denied for user 'root'@'localhost'`，容易误判成「库不在这台」。
- **切换顺序由「包到没到」决定**：admin 与执行器必须同窗口切，所以动手前先确认目标版本执行器 jar 已在机器上待命（`find / -maxdepth 4 -name '*.jar' -newermt <日期>` 能扫到）。包没到就只做「库预改 + 镜像预拉 + compose 备份」，不要真切。

## 3.5.0 实测踩坑（按坑人程度排序）

1. **全局 token 静默失效**：admin 3.5.0 完全不读 `--xxl.job.accessToken`（`application.properties` 里已无此键，代码无人读）。写上去不报错但无效。鉴权改为「请求头 token vs 数据库 `xxl_job_group.access_token`」逐条比对（`OpenApiController` 约 62–64 行）。**必须** `UPDATE xxl_job_group SET access_token='<执行器真实token>' WHERE app_name='<app>'`，不填就全部 `accessToken or appname invalid`。
2. **官方 DDL 脚本硬编码库名**：`doc/db/tables_xxl_job.sql` 开头就是 `CREATE DATABASE IF NOT EXISTS xxl_job` + `USE xxl_job`，会**忽略你给的库名直接写进 `xxl_job`**——在测试机上等于覆盖生产库结构。导到别的库必须先替换：`sed 's/`xxl_job`/新库名/g'`。
3. **注册请求体结构变了**：3.5.0 是单对象 `{"registryGroup":"EXECUTOR","registryKey":...,"registryValue":...}`，2.4.1 是 `{"registryList":[{...}]}`。传旧格式返回 `{"code":500,"msg":"Illegal Argument."}`。执行器 core 会自动处理，但手工验证注册时要写对。
4. **token 真值来源**：执行器的生效 token 在**外部配置**（如 `/opt/app/conf/<app>/common.yml`），不是 jar 内 `application-job.yml`——后者常是残留旧值，用它会返回 `The access token is wrong.`。
5. **时区**：官方镜像有 tzdata 但 `date` 默认 UTC，必须 `-e TZ=Asia/Shanghai`。不传时 JDBC 的 `serverTimezone` 仍能把库里的时间转对，但日志时间戳差 8 小时，排障易误判。
6. **context-path 静默失效**：官方镜像把参数塞在一个 `PARAMS` 环境变量里传（`PARAMS=--a=b --c=d`），少写 `--server.servlet.context-path`，容器**照常启动、页面照常能开**，但路径全落在根下。⚠️ **老镜像（2.3.1/2.4.1）把 `/xxl-job-admin` 烤进了镜像，`PARAMS` 里不写也有；3.5.0 官方镜像默认是 `/`**——所以「升级前没配 context-path 也跑得好好的」不代表升级后也一样，换镜像时必须回头检查 `.env` 里的 `PARAMS`，否则执行器打 `/xxl-job-admin/api/registry` 直接 404（`No mapping for POST /xxl-job-admin/api/registry`）。⚠️ **`PARAMS` 里 `--spring.datasource.password` 的值可能就以 `&` 结尾**——那个 `&` 是密码的一部分，不是分隔符。任何改写 `PARAMS` 的脚本都必须从备份原样取出密码段再拼参数，并在写回后校验长度/哈希与备份一致；误删直接 `Access denied for user 'root'@'<docker-gw>'`，而容器照样能起来，症状像密码配错。唯一可靠的确认方式：
   ```bash
   docker logs <admin> 2>&1 | grep "Tomcat started"
   # 期望 with context path '/xxl-job-admin'；打出 '/' 就是没生效
   ```
   症状可能延迟暴露（执行器注册/回调 404 才炸），所以启动后第一件事就查这行。
7. **collation 别抄 `utf8mb4_0900_ai_ci`**：那是 MySQL 8.0 专属，**MySQL 5.7 的 `information_schema.collations` 里根本没有**，建表直接 `Unknown collation`。5.7 用 `utf8mb4_general_ci` 或 `utf8mb4_unicode_ci`（官方脚本建库用后者）。升级前先 `SELECT version()`。
8. **DROP log 表前先查有没有视图**：老库里可能有引用 `xxl_job_log` 的自定义视图（如 `error_log`）。表一删视图就坏，此时**整库 `mysqldump` 会直接报错退出**，备份环节炸掉。对策：备份改逐表 dump 兜底，重建表后 `DROP VIEW` + 重建视图。
9. **admin 修好 ≠ 调度恢复**：结构修完、能登录能看列表，任务仍可能全部失败，日志刷 `xxl-job trigger error, please check if the executor is running`。这是执行器没起/端口不通/`xxl_job_group.access_token` 为空，与 admin 无关——别在 admin 上继续折腾。修完 admin 必须单独验执行器连得通。
10. **尽量别为了迁就执行器的 admin 地址去加 context-path**：执行器配置写 `http://host:8083/xxl-job-admin` 时，优先**改执行器**（`admin-addresses` 去掉 `/xxl-job-admin` 后缀）。加前缀会让 admin 全部入口变更（登录页、执行器配置、别人手里的链接全得跟着改），还要动 `PARAMS`（有炸密码的风险）。执行器是廉价可改的一端，admin 是共享的一端。
    **例外（实测可行）**：执行器不归你管、或执行器数量多到来不及时，给 admin 补 `--server.servlet.context-path=/xxl-job-admin` 同样能打通——`Tomcat started ... with context path '/xxl-job-admin'` + `PageNotFound=0` + 执行器地址能解析即成功。这是升级窗口内保住注册通道的唯一低成本手段，代价只是 admin 入口带前缀。
    两种形态都成立，但**多实例环境必须统一成一种**：升级后常出现「一部分 admin 在 `/`、一部分在 `/xxl-job-admin`」，同一个执行器换台 admin 就得改地址。决策表、逐机切换步骤、执行器侧要同步改的清单见 `references/admin-context-path.md`。用户问「URL 里怎么还有 xxl-job-admin」时先回答「这是显式配置的前缀，不是升级残留」，再让他二选一——别默认它坏了。
11. **「升到一半」的机器先判断停在哪一步**：常见残留是「`xxl_job_user` 已加 `token`、密码已是 64 位 SHA-256，但 `xxl_job_group` 还是 `title`、没 `access_token`」或「库已改成 3.5.0 结构、镜像还停在旧 tag」。逐表比对列与索引再定续做点：
    ```sql
    select table_name, group_concat(concat(column_name,':',column_type))
      from information_schema.columns where table_schema='xxl_job' group by table_name;
    select table_name,index_name,non_unique from information_schema.statistics
      where table_schema='xxl_job' group by 1,2,3;
    ```
    续做顺序固定为「先补齐库结构 → 紧接着换镜像」，中间不留空档。
12. **改完库必须同一步换镜像**：把 `xxl_job_info.job_desc` 改成 `name` 后，仍在跑旧代码的 admin 立刻全站 500，日志 `BadSqlGrammarException: Unknown column 't.job_desc' in 'field list'`。这不是 DDL 写错，是版本错配——先在 `docker images | grep xxl` 里找现成的目标版本 tag，常能省一次 pull。
13. **触发报 `Read timed out` 先查 jar 有没有在运行中被换掉**：进程启动后再覆盖 jar（发版传到一半、`scp` 还在写），运行中进程的文件句柄指向旧 inode，之后每次动态加载 JobHandler 都抛 `java.io.UncheckedIOException: java.io.EOFException` at `JarUrlClassLoader.definePackage` → admin 侧只看到触发超时。判据：
    ```bash
    ps -o lstart= -p <pid>; stat -c '%y' /path/app.jar
    # jar mtime 晚于进程启动时间 = 文件在运行中被替换，必须重启
    unzip -t /path/app.jar | tail -2   # cannot find zipfile directory = 传输未完成
    ```
    发版必须等文件写完（大小停在同一个值）再启动，别在传输中途 `pm2 start`。

## DDL（日志可丢版，实测 1 秒）

```sql
ALTER TABLE xxl_job_group
  CHANGE COLUMN `title` `name` VARCHAR(64) NOT NULL COMMENT '执行器名称',
  ADD COLUMN `access_token` VARCHAR(255) DEFAULT NULL COMMENT '执行器AccessToken',
  ADD UNIQUE KEY `i_app_name` (`app_name`);
ALTER TABLE xxl_job_info CHANGE COLUMN `job_desc` `name` VARCHAR(255) NOT NULL COMMENT '任务名称';
ALTER TABLE xxl_job_registry MODIFY COLUMN `id` BIGINT NOT NULL AUTO_INCREMENT;
-- 2.4.1 起点的库必须再走这两步：老库 i_g_k_v 是普通索引(non_unique=1)，3.5.0 要求 UNIQUE
ALTER TABLE xxl_job_registry DROP INDEX `i_g_k_v`;
ALTER TABLE xxl_job_registry ADD UNIQUE KEY `i_g_k_v` (`registry_group`,`registry_key`,`registry_value`) USING BTREE;
DROP TABLE xxl_job_log;      -- 按 3.5.0 结构重建（省掉 RENAME INDEX）
TRUNCATE xxl_job_log_report;
UPDATE xxl_job_group SET access_token='<token>' WHERE app_name='<app>';
```

- 历史日志可丢时，直接 DROP 重建 log 表最快：现网索引是 `I_trigger_time` 大写，MySQL 索引名大小写不敏感，`CREATE INDEX i_xxx` 会报 `Duplicate key name`，DROP 重建可规避；不能丢数据则必须 `ALTER TABLE ... RENAME INDEX I_xxx TO i_xxx`。
- **先清 log 再备份，否则备份环节自己先卡住**：`xxl_job_log` 千万行级时整库 `mysqldump` 会到 2.5 GB / 几分钟，而 3.5.0 本来就要 DROP 重建这张表。顺序：`TRUNCATE xxl_job_log; TRUNCATE xxl_job_log_report;` → 再备份，且只取「全量结构 + 小表数据」：
  ```bash
  M='docker exec <mysql容器> mysqldump -uroot -p<pw> --single-transaction'
  $M --routines --events --no-data xxl_job > schema.sql
  $M --no-create-info --ignore-table=xxl_job.xxl_job_log \
     --ignore-table=xxl_job.xxl_job_log_report \
     --ignore-table=xxl_job.xxl_job_registry xxl_job > data.sql
  ```
  `xxl_job_registry` 只忽略 data、保留结构——它是执行器心跳快照，重启几十秒即重写。
- **长跑 dump 别当它失败了**：SSH 侧超时被杀时远端 `mysqldump` 仍在写（文件还在涨）。先 `ps -ef | grep [m]ysqldump` 确认，需要中止再 `pkill`，不要直接重跑一份。
- 上面的 DDL 只覆盖 **3.4.x → 3.5.0**。若起点是 **2.4.1 或版本不明的存量库**，这段不够，见下一节，否则 admin 起来登录就 500。
- `xxl_job_logglue` / `xxl_job_lock` 两版结构逐列一致，无需改；`xxl_job_log_report` 列与 `i_trigger_day` 两版一致，但 3.5.0 要求该索引是 **UNIQUE**（老库若为非唯一索引需先确认 `trigger_day` 无重复再改）。**`xxl_job_user` 不是「无需改」——见下节。**

## 2.4.1 起点的库：上面那段 DDL 会漏 3 处

**这是最容易翻车的地方**：拿 3.4.x 的经验升级 2.4.1 存量库，结构改完 admin 能启动，但登录直接 500。三处漏项：

| 漏项 | 症状 | 2.4.1 实际 → 3.5.0 应为 |
|---|---|---|
| `xxl_job_user` 缺 `token` 列、`password` 只有 `varchar(50)` | `Unknown column 't.token' in 'field list'`（mapper SQL 里写死了 t.token） | 加 `token VARCHAR(100)`；`password` 改 `VARCHAR(100)` |
| `password` 内容是 MD5（32 字符） | 补完 token 列**照样**登录失败：`{"code":500,"msg":"账号或密码错误"}` | 必须重算 `SHA2('<明文>', 256)` |
| `xxl_job_info.executor_param` 是 `varchar(512)` | 任务参数超 512 字符时插入/更新失败 | `MODIFY COLUMN executor_param TEXT` |

```sql
ALTER TABLE xxl_job_user
  ADD COLUMN `token` VARCHAR(100) DEFAULT NULL COMMENT '登录token' AFTER `password`,
  MODIFY COLUMN `password` VARCHAR(100) NOT NULL COMMENT '密码加密信息';
ALTER TABLE xxl_job_info MODIFY COLUMN `executor_param` TEXT DEFAULT NULL COMMENT '任务参数';
UPDATE xxl_job_user SET password = SHA2('<明文密码>', 256) WHERE username = '<user>';
```

**只补 token 列不够**——这是本次最大的认知坑：2.4.1 存 MD5，3.5.0 校验 SHA-256，两个值永不相等，且长度都不同（32 vs 64），`varchar(50)` 也装不下 64 位。

> **`xxl_job_registry.i_g_k_v` 也在这三处之外的第 4 处**：2.4.1 是普通索引，3.5.0 是 UNIQUE。直接 `ADD UNIQUE KEY i_g_k_v` 报 `Error 1061 Duplicate key name`，必须先 `DROP INDEX` 再建（有心跳残留先 TRUNCATE）。**只做 `MODIFY id BIGINT AUTO_INCREMENT` 而漏掉唯一化不会报任何错**——admin 能起、任务能调度，表结构与 3.5.0 却对不上，只有查 `information_schema.statistics` 的 `non_unique` 才发现（应为 0）。

**3.5.0 哈希细节（反编译容器内 `xxl-tool-*.jar` 的 `Sha256Tool` 字节码确认）**：`sha256(String)` → `sha256(str.getBytes(UTF_8), null)`，即 **纯 SHA-256(UTF-8 明文字节)，无盐、不迭代、小写 hex**。所以能直接用 SQL `SHA2(x,256)` 生成，不需要写 Java 工具。

> `Sha256Tool` 另有 `sha256(String, String)` 带 salt 的重载，但登录路径用的是单参数版本——**别看到类里有 salt 字段就去找盐值**。拿不准时用实测排除：MD5 值登录失败 + 手算 `SHA2(明文,256)` 登录成功，就证明无盐。

## 执行器侧改造（2.4.1 → 3.5.0）

- 业务 Job 代码**零改动**：注解路径仍是 `com.xxl.job.core.handler.annotation.XxlJob`，属性不变。全 fat-jar 嵌套 lib 常量池扫描可证（要解开 `BOOT-INF/lib/*.jar` 逐层扫，只扫外层会漏）。
- pom 升 `xxl-job-core` 到目标版本；内部 starter 加 `setGlueEnabled(false)` 需与 core 升级**同批**（2.4.1 无此 setter，先加会编译失败）。
- **groovy 不能 exclude**：`GlueFactory` 无条件 `import groovy.lang.GroovyClassLoader`，exclude 会 NoClassDefFoundError。有 Spring Boot BOM 时跟随 BOM 版本即可。
- **netty 别手工升 4.2**：3.5.0 用到的 netty API 与 2.4.1 完全一致，跟随 Boot BOM 4.1.x。看到 jar 里 `netty-all-4.1.114` 与 22 个 `netty-*-4.1.122` 并存不要慌——`netty-all` 那个版本 0 个 class（纯 META-INF 聚合壳），`versions.properties` 按模块名存 key 互不覆盖。
- 12 个工具类移入 `util/deprecated/`、`biz/` → `openapi/` 包移动、`IJobHandler.execute(String)` 注释、`getJobLogFileName` → `getLogFileName`。升级前先 grep 业务代码是否用到。

## 发布顺序

```
提前：执行器改 pom + 打 jar 上传待命（不覆盖不重启）；admin 侧 docker pull + DDL 备好
窗口（2–3 分钟）：停 admin → 跑 DDL → 起 admin → 停执行器 → 换 jar → 起执行器 → 验 registry 和任务触发
```

- 用 PM2 管执行器时：`pm2 restart` **不会**重读 json 配置，换 jar 后必须 `pm2 delete` + `pm2 start`。
- 回滚前提：TRUNCATE/DROP 过的日志不可恢复，施工前要确认可接受。

## 验证清单

```bash
# 登录页：3.5.0 是 /auth/login（GET 页面）；表单提交走 POST /auth/doLogin。
# POST 到 /auth/login 会回登录页 HTML 而不是 JSON，看着像「密码错」，其实是端点选错。
# 成功 {"code":200,"msg":"Success"}，失败 {"code":500,"msg":"账号或密码错误"}
# 2.4.1 的 /toLogin 已移除，返回 404 不代表服务坏了
curl -s -o /dev/null -w '%{http_code}\n' http://<admin>:<port>/xxl-job-admin/auth/login   # 200
# 登录：密码含 % + ^ 等字符必须 --data-urlencode，直接 -d "password=xx%yy" 会被 Tomcat
# 当 percent-encoding 解码（% 吃掉、+ 变空格）→ 一直返回「账号或密码错误」，极易误判成密码错
curl -s -X POST http://<admin>:<port>/xxl-job-admin/auth/doLogin \
  --data-urlencode 'userName=admin' --data-urlencode 'password=<明文>'   # 200
# 分页接口：3.5.0 是 offset/pagesize，不是 3.4.x 的 start/length；且 jobinfo/pageList 的
# jobGroup/triggerStatus/name/executorHandler/author 全必填，缺任一直接 400（看着像服务坏了，其实只是参数不对）
curl -s -b /tmp/ck -X POST "http://<admin>:<port>/jobinfo/pageList?offset=0&pagesize=3&jobGroup=0&triggerStatus=-1&name=&executorHandler=&author="
# 注册（3.5.0 单对象格式 + 双 header）
curl -s -X POST http://<admin>:<port>/xxl-job-admin/api/registry \
  -H "XXL-JOB-ACCESS-TOKEN: $TOKEN" -H "XXL-JOB-APPNAME: <app>" \
  -H 'Content-Type: application/json' \
  -d '{"registryGroup":"EXECUTOR","registryKey":"<app>","registryValue":"http://<ip>:14000/"}'
```

反例也要跑：错 token / 不存在的 appname 都应返回 `accessToken or appname invalid`，否则说明鉴权没生效。

账号核验用**等值比较**，别只看 `length(password)`——64 位只说明是 SHA-256，不等于就是你要的那个哈希：

```sql
select id, username, role, password='<目标hex>' from xxl_job_user;
```

## 改文档/改配置前先验原文（凭据行尤其）

含密码、哈希、token 的行在工具输出里可能被显示层替换成 `***` 或折行，**看起来像文档被写坏**（例：`password = SHA2(...)` 被看成 `password = ***...`）。动手「修复」前必须逐字节核对原文：

```python
line = open(p).read().split("\n")[i]
print(repr(line[28:60]), line[28:60].encode())   # repr + bytes 一起看
```

判据：`assert old in s and s.count(old)==1` 在前，`repr`/`hex(ord(...))` 逐位比对在旁。**没落到字节级就别改**——误报一次 SHA-256 生成语句会让后续所有升级照抄一份坏 SQL。

**上一轮（或压缩前的上下文摘要）给的「文档有 3 处问题」不是事实，是待验的假设。** 重新读原文、`repr` 比对通过才算数；发现是误报时在第一句就说「更正，我上一条判断错了」再给真正的问题，别把误报混在改动清单里蒙过去。同一处凭据行被误判过两次，说明靠肉眼看折行输出不可靠——凡是输出里含 `***` 或跨行断开的 SQL，一律先 `repr` 再下结论。

## 参考

- `references/account-and-permission.md` — 账号创建/提权 SQL、密码生成、`role=0` 的实际局限、交付纪律。
- `references/admin-context-path.md` — 统一到根 `/` 还是 `/xxl-job-admin` 的决策表、逐机切换命令、执行器侧同步清单与验证探针。

完整升级文档：Obsidian `Knowledge/DevOps/Docker/XXL-JOB-执行器从241升级到350.md`，BEAN-only 收敛：`XXL-JOB-升级到344并收敛为BEAN-only.md`。
