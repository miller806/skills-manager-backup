# 后台会话 → 宿主机 root：通道枚举

用户的现象是「接口都删了/包也换了，账号只能进系统，怎么拿到 root 的」。
这句话的前提是「后台账号只能改数据」。多数自研后台都不是——它们自带能把权限抬到 root 的部件。
排查顺序：**先证伪「只能改数据」，再谈漏洞**。

## 四条通道，按命中概率排序

| # | 通道 | 一行判据 | 落地物特征 |
|---|---|---|---|
| 1 | 应用自身是内网转发器 | 字节码里有 `proxy*` + `copyRequestHeaders` + `executeAsync` | 目标地址在 DB 配置表里 |
| 2 | 内网管理端未授权（xxl-job 执行器 `/run`） | `curl -X POST :<port>/run -d '{}'` 返回 `The access token is wrong.` | 不落 webshell，痕迹只在执行器日志 |
| 3 | JDBC 危险连接参数 | create/update 数据源时 `socketFactory` / `autoDeserialize` / `queryInterceptors` / `allowLoadLocalInfile` | 需真实异常栈支撑，否则只是「填过」 |
| 4 | 容器逃逸 / SSH 账号侧 | `find /var/lib/docker/overlay2 -path '*diff/tmp*'`、`authorized_keys`、`/etc/passwd` mtime | 直接落盘 |

通道 1+2 组合起来是最隐蔽的一种：**外部只发 HTTP，网络流量完全干净**，防火墙、入向白名单、`ss` 全看不出问题。

## 通道 1：确认应用是不是任意内网 HTTP 代理

后台常有「应用市场 / 第三方接入 / 开放平台」模块。这类模块为了实现网关转发，会内置一个**对任意 target 发起请求并把响应原样回吐**的控制器。

```bash
J=<jdk>/bin/javap
C=<解压目录>/com/**/controller/gateway/**/*Controller.class
$J -p "$C" | head -25                      # 先看方法名
$J -c -p "$C" | grep -E 'invoke|ldc' | head -40   # 再看常量与方法调用
```

定性要素（四个都要有，缺一个就不是任意转发）：

- target 来自**数据库配置**（`getGatewayApiTarget(appCode)` 之类），不是代码里的固定 URL ⇒ 改一行 DB 就能改目标
- `buildTargetUrl(appCode, target, suffix, request)` 把**原始 path 后缀**拼上去 ⇒ 任意路径都能透传
- `copyRequestHeaders(req, httpRequest)` 且 `shouldSkipRequestHeader` 只跳过 `Host` / `Content-Length` / `Accept-Encoding` ⇒ 任意 header（含内部鉴权 header）都能带过去
- body 用 `InputStreamResource(req.getInputStream())` 原样透传，`executeAsync()` 同步等结果并写回 `resp.getOutputStream()` ⇒ 任意 method + 任意 body + 读到响应

同时确认**进程属主**：`ps -o pid,user,args -p <pid>`。属主 root ⇒ 通道 2/3 都直接等于 root。

## 通道 2：把转发器接到执行器上

xxl-job 执行器的 `/run` 是任务下发执行接口，token 正确即按 glue 脚本以**执行器身份**起子进程。

```bash
ss -lntp | grep -E ':1200[01]'                       # 端口 → pid
ps -o pid,ppid,user,lstart,args -p <pid>             # 谁在跑、什么时间起的、属主
unzip -l <app>.jar | grep -i xxl-job                 # 依赖里有 xxl-job-core
unzip -p <app>.jar BOOT-INF/lib/xxl-job-core-*.jar | strings | grep -i GlueTypeEnum   # 支持 GLUE
curl -s -m 6 -X POST http://127.0.0.1:<port>/run -d '{}'      # 判据
```

判读：

- `{"code":500,"msg":"The access token is wrong."}` ⇒ **是执行器**（鉴权失败，路由存在）。这是最有力的身份证明，比端口猜测可靠。
- 404 / 空响应 ⇒ 不是这个服务，别继续往下推断。
- 只读探活即可；`-d '{}'` 不会执行任务，也不要伪造 token 去真跑。

## 取证：三个不可伪造的锚点

1. **`stat` 三列并排**，`Modify` 与 `Change` 年份不一致就是被改过时间戳：
   ```
   stat /usr/bin/<payload> | grep -E 'Modify|Change|Birth'
   ```
   `Modify 2019-… / Change 当天` ⇒ 用 `cp -p` 或 `touch -r` 保留了 mtime 直接落盘。**mtime 可伪造，ctime 不可伪造**，把 ctime 当落盘时刻。
2. **同 endpoint 的耗时基线**：把当天该路径的全部请求 duration 排出来，一发异常、其余同量级，异常那发就是执行窗口。
   ```
   grep -a '<path>' <access.log> | sed -E 's/.*:([0-9:]{8})[^]]*\].*" ([0-9.]+)".*/\1 \2/'
   ```
3. **上一级目录的 ctime**：payload 落到 `/usr/bin/x` 时，`/usr/local/bin`、`/usr/bin` 目录本身的 ctime 会在同一秒变动；用 `find /usr/bin /usr/local/bin /root /tmp -maxdepth 1 -newerct '<窗口>' ! -newerct '<窗口>'` 把「作者在同一秒还碰了哪些目录」一起框出来。

## 汇报口径

- 一条链写成一跳一行：拿会话 → 改配置 → 借转发 → 执行 → 持久化。每行都要能指回本节的一条证据。
- 明确写「外部打不到这个端口」：这是回应用户「怎么进来的」的关键——攻击者全程只发 HTTP，没有任何入向连接。
- 明确列出**被证伪的候选通道**（例如 JDBC `socketFactory` payload 无异常栈支撑时），并说明为何撤回。只报成立的链、不撤回旧结论，会让用户以为两条都真。
- 最后一行给「还缺的那一环」和取它需要的具体命令，不要用「需进一步排查」结尾。
