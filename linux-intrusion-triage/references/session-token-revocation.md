# 会话层凭据吊销（删账号之后的第二步）

**核心规则：删数据库账号、改口令、删接口，都不会让已签发的会话 token 失效。** 只要 token 库里的 key 还在且 TTL 未到，攻击者拿旧 token 继续调业务接口一律成功——用户看到的现象就是「接口都删了，怎么还能进」。

## 判定：攻击者是不是「持证上岗」

三条同时成立即可定性，不必再猜别的入口：

1. 日志里攻击 IP 在你处置**之后**仍在打业务接口，且返回 200；
2. 请求携带固定 token（32/36 位 hex / uuid），跨小时、跨天复用；
3. 在 token 库里查得到同名 key，`TTL > 0`。

反过来，如果接口路径在包里根本不存在（搜类名 + `@RequestMapping` 字面量两层、**包含 `BOOT-INF/lib` 下全部依赖 jar**），那 200 只可能是异常包装或 SPA 兜底，与「漏洞未修」无关。

## 定位 token 库

先读框架配置再动手，别猜存储位置：

```
grep -nE 'redis|sa-token|token-name|token-prefix|timeout|jwt|session|cache' /path/to/app.yml
# sa-token: token-name Authorization / token-prefix Bearer / timeout 86400 → token 存在 redis
```

yaml 取密码（`redis:` 段缩进不固定，`sed -n '<行号>,<行号>p'` 会失手）：

```
PW=$(awk '/^  redis:/{f=1} f&&/password:/{gsub(/.*password:[ ]*/,"");gsub(/\r/,"");print;exit}' app.yml)
```

机上没有 `redis-cli` 时手搓 RESP 即可（python3 一定优先于装包）：

```python
def cmd(sock,*args):
    out=b"*%d\r\n"%len(args)
    for a in args:
        a=a.encode() if isinstance(a,str) else a
        out+=b"$%d\r\n%s\r\n"%(len(a),a)
    sock.sendall(out); return sock.recv(500000)
cmd(s,"AUTH",pw); cmd(s,"SELECT","1")
```

## 枚举与判读

- 先 `DBSIZE`；DB 大小可控时 `KEYS *` 比 `SCAN` 省事，取回后按 `:` 前的前缀做 `Counter.most_common()`，一张分类表就能定位可疑前缀。
- 高危前缀特征：`*Auth:*`、`*token*`、`*session*`、`*login*`、`*user*`、`*permission*`。
- `TTL` 读法：`-1` = 永不过期（最危险）、`-2` = 不存在、`>0` = 剩余秒数。
- 值里通常含类型名（如 `com.xxx.TempAccessAuth`）、userId、ip、terminalId。**ip/terminalId 为空说明是程序内部签发、并非该用户真实登录**，不能据此把账号点名定性，只能在汇报里写「来源待反查」。
- `is-share: true` / `is-concurrent: true` 的框架会在**每次使用后刷新 TTL**，所以「等它自然过期」在攻击者活跃期间永远等不到，必须显式 `DEL`。

## 处置顺序

1. `cp -a` 备份库文件；redis 侧把所有命中 key 的 `key/value/ttl` 导出成 json 留证。
2. **先分清自家与攻击者的**：只有能对上攻击账号 / 攻击 IP / 异常签发时间的才删。批量删之前把 key 列表交给用户确认——顺手清空会把正在办公的正常用户一起踢下线。
3. `DEL <key>`，再 `TTL` 复核为 `-2`。
4. **验收口径是重放**：用旧 token 打一次攻击者用过的接口，必须 401 / 未授权。只报「已删除 N 个 key」不算完成。
5. 逐个 `SELECT <n>` 看 `DBSIZE`：多站点常共用一台 redis 但分库，只清一个库会漏掉同源的其它应用 token。

## 同类持久凭据清单（一并吊销）

- oauth2 的 `access_token` **和** `refresh_token` 两张表：只删 access_token，refresh_token 能换出新的。
- remember-me / 长期 session 表、`shiro`/`spring-session` 的 redis 前缀。
- 应用内 API key、机器人 webhook、回调令牌（常以明文存在业务表里，改配置后要重启进程才生效）。
- 数据库账号口令：改口令后**旧连接不会断**，要 `pg_terminate_backend` / `KILL` 掉会话。
