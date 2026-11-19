# XXL-JOB 账号、密码与权限

## 建账号前先确认三件事

1. `xxl_job_user` 有 `token` 列（3.5.0 mapper 的 SELECT 写死 `t.token`）
2. `password` 列是 `VARCHAR(100)`（SHA-256 是 64 字符，`varchar(50)` 静默截断）
3. 明文密码 ≤ 20 字符（登录页 `maxlength="20"` 截断）

缺任一条都表现为「账号或密码错误」，与哈希算错无法区分。

## 生成密码与哈希

```bash
# 20 位强密码
python3 -c "import secrets,string;a=string.ascii_letters+string.digits+'!@#%^*-_=+';print(''.join(secrets.choice(a) for _ in range(20)))"
printf '%s' '<明文>' | sha256sum | cut -d' ' -f1      # 小写 hex，纯 SHA-256，无盐
```

SQL 等价：`SELECT SHA2('<明文>', 256);`

避开 `' " \ ` $ ;` 和 `&`——shell、heredoc、`.env` 各要一层转义，而长度正好用满 20 位时没有余量。

## 创建 / 提权 SQL

```sql
-- 管理员
INSERT INTO xxl_job_user (username, password, role, permission)
VALUES ('<user>', '<sha256小写hex>', 1, NULL)
ON DUPLICATE KEY UPDATE password=VALUES(password), role=VALUES(role), permission=VALUES(permission);

-- 受限用户：role=0 + permission 列执行器 id（逗号分隔，对应 xxl_job_group.id）
UPDATE xxl_job_user SET role=0, permission='3' WHERE username='<user>';
```

`role`：0=普通用户、1=管理员。`permission`：允许访问的执行器 ID 列表，NULL=不限制。

## role=0 在 3.5.0 上基本不可用（实测）

- `/jobgroup`、`/user` 整个 controller 挂 `@XxlSso(role=ADMIN)`，普通用户直连返回 `permission limit, current login-user does not have role:ADMIN`
- `IndexController` 只在 `hasRole(ADMIN)` 时才注入 `jobgroup` 菜单资源 → 普通用户**看不到执行器列表**
- `JobGroupPermissionUtil` 会按 `permission` 过滤，但前提是先能进菜单

即「给开发一个受限账号」在 3.5.0 上做不到细粒度：要么 `role=1`，要么接受看不到执行器管理。默认给管理员，别浪费时间调 `permission`。

## 验证（三条都要跑）

```bash
CK=/tmp/ck; rm -f $CK
curl -s -c $CK -X POST http://<admin>:<port>/auth/doLogin \
  --data-urlencode 'userName=<user>' --data-urlencode 'password=<明文>'    # {"code":200,...}
curl -s -b $CK "http://<admin>:<port>/jobgroup/pageList?offset=0&pagesize=20"
curl -s -b $CK "http://<admin>:<port>/jobinfo/pageList?offset=0&pagesize=5&jobGroup=<id>&triggerStatus=-1&name=&executorHandler=&author="
```

只测 `doLogin` 返回 200 不够：`role=0` 同样能登录成功，权限问题在下一个接口才暴露。curl 全过也不等于页面能登（`maxlength` 截断只发生在浏览器），交付前让用户实际登一次。

## 交付纪律

用户中途把需求改成「只给 SQL、不要入库」时，**先查库里实际状态并明确报告已经发生的写入**，再给回滚/改密选项（DELETE 该行，或 UPDATE 换成新哈希）。只贴一份 SQL 会让用户以为库没被动过，之后用旧密码登不上时分不清是配置问题还是被人改过。
