---
name: ssh-ops-mcp
description: "Use when running commands on CMDB servers via ssh-ops MCP."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [macos, linux]
metadata:
  hermes:
    tags: [MCP, SSH, DevOps, Security]
    related_skills: [native-mcp]
---

# ssh-ops MCP Server（凭据托管的服务器 SSH 能力）

把 CMDB 里的服务器 SSH 能力做成 MCP 工具给别人/别的 agent 用，调用方拿不到密码。

代码：`/Users/miller/mcp-servers/ssh-ops/`（server.py / ctl.sh / README.md / test_client.py）

## 何时用

- 用户要求"把服务器访问能力开放给其他 agent / 做成 MCP / 但不给密码"
- 要在 Claude Code / Codex / Cursor / 别的 Hermes profile 里操作这批 192.168.2.x 机器
- 需要给某个 agent 只读权限的服务器访问

## 架构要点（为什么不会泄密）

1. 凭据来源：PG 两张表 —— `hermes.ssh_servers_nonprod`（dev/fat，默认可用）、
   `hermes.ssh_servers_prod`（生产机，默认**根本不查**，要 `SSH_MCP_ENABLE_PROD=1`）。
   连接信息在 `~/.codebuddy/postgres-cli/credentials.json`（600，`test`/`hermes` 段）；日常查询用 `postgres-docker` 技能（`pg.py ping|query|tables`）。
   本机无 `psycopg2` 的系统 python 有，但 mcp 只在 venv 里 —— server 自己用 venv python 跑。
2. 密码传递：`sshpass -e` + `SSHPASS` 环境变量 → 不出现在命令行/`ps`。
3. 返回脱敏：`_redact()` 在每次返回前把密码串替换成 `***`。
4. 工具签名里没有任何接收密码的参数。
5. 审计：`audit.log`（600）记录 时间/机器/命令/rc/耗时。

## 生产/非生产分级（改表即生效）

分级**只认 `ssh_servers_prod` 表**，代码里不写机器名单（名单会与现实脱节）。

- 要把机器定为生产：`INSERT INTO ssh_servers_prod`（不要留在 nonprod 表）。
  完整录入流程（查重 / 事实采集 / 私钥复用 / 命名 / 公网 IP 与 per-host SSH 选项的坑）见
  `references/server-onboarding.md`。这类录入是低风险 CMDB 写，用户说「加到生产表」就直接连 PG 执行。
- 生产机行为：默认查不到 → 开 `SSH_MCP_ENABLE_PROD=1` 后可连，但危险命令
  **不可绕过**（`allow_dangerous` 无效），只能人工上机。
- 环境变量配置在 `run/env`（`ctl.sh` 启动时 source）。**改代码默认值没用** ——
  排查"改了不生效"先看这里。`SSH_MCP_PROTECTED_SERVERS` 默认空，仅作临时兜底。
- 改完 `server.py` 务必跑 `.venv/bin/python test_guard.py`（离线纯函数单测，
  exit 0 = 全过）。铁律：绝不拿真机验证破坏性命令的拦截逻辑。

## ⚠️ 铁律：绝不用破坏性命令做"验证"

**真实事故**：写拦截规则后，用 `ssh_run(server="101", command="reboot")` 验证"应该被拦"。
当时正则漏了 `reboot`，命令真执行了 → 生产机 101 重启，Flink JM/TM/ZK 全灭、8 个 CDC pipeline 停摆。

规则：
1. **验证拦截逻辑只跑纯函数 `_guard()`，绝不发到真机。** 测命令放行/拦截一律
   `.venv/bin/python -c "import server as S; S._guard('reboot', False)"`。
2. **任何 `ssh_run` 都当生产操作**，不做"试探性"调用。想确认某命令会不会被拦，
   先本地 `_guard` 判一次，看到 blocked 就够了，不需要让它"真的被拦一次"。
3. **新增/修改拦截规则时**，先本地跑正反例清单（应拦的 + 应放行的）全绿，再上服务。
4. 测试目标优先选无状态机器（如 srv-33），**101 / 90 / 31 这类跑 Flink、PM2 生产业务的机器
   一律不做功能测试对象**。
5. 服务默认以 `SSH_MCP_READ_ONLY=1` 起；需要写操作时显式改环境再重启，并当场改回来。

## 安全模型（2026-10 事故后重写，必须记住）

1. **默认只读**：`SSH_MCP_READ_ONLY` 未设时即为 `1`（只读）。写操作必须显式 `SSH_MCP_READ_ONLY=0` 重启。
2. **生产机硬保护**：`SSH_MCP_PROTECTED_SERVERS`（默认 `srv-90,srv-101,srv-31`）上的危险命令
   **`allow_dangerous=true` 也绕不过**。名字会归一化（`101`/`srv-101`/`192.168.2.101` 同一台）。
3. **危险命令检查先于一切**：`_guard()` 里先判 DANGEROUS 再判 READ_ONLY，顺序不能反。
4. **只读模式逐段校验**：命令先按 `; && ||` 切，再按 `|` 切，每段都必须是只读白名单命令；
   另拦 `>` `>>` 写文件与 `| tee/dd/cp/mv/rm/xargs …`。这样 `hostname; nproc` 放行，
   `df -h; reboot` / `ls | xargs rm` 被拦。
5. **`dry_run=True`**：只做安全校验 + 返回将要执行的命令，不连机器。拿不准副作用时先用它。
6. 默认监听 `127.0.0.1`（改 `run/env` 里 `SSH_MCP_HOST=0.0.0.0` 才对外开放）。

## 验证方式（唯一允许的方式）

修改任何拦截规则后，只跑离线单测：

```bash
cd ~/mcp-servers/ssh-ops && .venv/bin/python test_guard.py   # 77 项, 全部只调纯函数
```

**绝不能**为了“看它会不会被拦”而向任何机器下发命令。`test_guard.py` 只调用 `_guard()`，
不连网、不碰 SSH。

## 常用操作

```bash
cd /Users/miller/mcp-servers/ssh-ops
./ctl.sh start|stop|restart|status
./ctl.sh token            # 取 Bearer token (首次 start 自动生成到 run/env, 600)
.venv/bin/python test_client.py     # stdio 端到端自测
```

- stdio 接入（同机最安全）：`{"command": "<dir>/.venv/bin/python", "args": ["-E", "-P", "<dir>/server.py"]}`
  **`-E -P` 不可省。** 宿主 shell 里若存在 `PYTHONPATH`（Hermes/Claude Code 常注入自己的 site-packages），
  会被 venv 的 python 继承，`mcp`/`pydantic` 解析到外部 python3.14 的包，报
  `ImportError: cannot import name 'ArgsKwargs' from 'pydantic_core._pydantic_core'` —— 症状是
  server 秒退、客户端只看到 `Connection closed`。`-E` 忽略 PYTHONPATH/PYTHONHOME，`-P` 不把 cwd 加进 sys.path。
  同理，在 config 里写 `env.PYTHONPATH=""` 无效（进程仍继承父环境），只能靠解释器 flag。
- HTTP 接入：`http://<mac-ip>:8765/mcp` + `Authorization: Bearer <token>`
- 只读对外：`SSH_MCP_READ_ONLY=1 ./ctl.sh restart`（仅放行 ps/df/tail/journalctl/pm2 list/kubectl get 等）

配套：
- `references/running-commands.md` — 在 CMDB 机器上真跑命令/HTTP 请求：密码机 sshpass 路径、密钥机私钥路径、
  本机 TUN 代理劫持公网 IP 的诊断与“内网机器当跳板出网”配方
- `references/server-onboarding.md` — 新机器录入 CMDB（prod/nonprod 选表、查重、事实采集、私钥复用、公网 IP 解析坑）
- `references/mcp-server-sdk.md` — 自建 MCP server 的 SDK 版本 / 421 / 鉴权 / 工具设计深度笔记
- `references/gateway-distribution.md` — 经网关（MCPHub）分发：server 条目 JSON、Dashboard 字段、key 分权
- `scripts/mcp_smoke_test.py` — 通用冒烟：stdio 或 http+token 列工具并真实调一次
  （`python mcp_smoke_test.py http http://<ip>:8765/mcp <token> --tool ssh_run --args '{"server":"33","command":"hostname"}'`）

## 在那批机器上执行命令：先选路，别硬试

同一个 `ssh_run` 失败有三种完全不同的原因，**看返回形态几秒内就能分流**，不要对着同一台反复重试：

- `blocked: true` + `reason: …被拒绝的段: X` → 命令没进 `READONLY_ALLOW` 白名单，见下面三条。
- `exit_code: 78` + stderr 含 `凭据配置错误` → 私钥配置问题（`key_path` 文件不存在 / 权限过宽 / 非 PEM），
  按 stderr 提示修 CMDB 或文件权限，不用重试。
- `exit_code: 255` + stderr 含 `kex_exchange_identification` / `Connection closed` → TCP 通了但
  SSH banner 被对端或中间防火墙重置，**失败在认证之前**，私钥对错无关。最常见是本机落地 IP
  不在目标安全组白名单 —— 换 key 没用，先确认源 IP 放行。
- `exit_code: 255` + stderr 有 `timed out` / `refused` → 真的不通；先 `nc -G 3 -z <ip> <port>` 确认。

只读白名单（`SSH_MCP_READ_ONLY=1` 是默认态）的四个坑：

1. **分段不理解引号**：先按 `;` `&&` `||` 切，再按 `|` 切。`grep -iE 'ubs|udun|tron'` 会被切成 `grep -iE 'ubs` +
   `udun` + `tron'`，报「被拒绝的段: udun」。改用 `grep -e ubs -e udun -e tron`。
2. `ip -4 addr show` 不在白名单（正则只认 `ip a` / `ip r` 形式），用 `hostname -I` 或 `ifconfig`。
3. `curl` / `nc` / `timeout` 都不在白名单 → **只读模式下无法用 MCP 从远端发 HTTP 请求**。
   要发 HTTP 请求就用本地 `sshpass -e ssh <host> 'curl …'`（见 references/running-commands.md）。
4. `unzip -l` / `unzip -p` / `jar tf` / `tar -tzf` 这类**归档读取**也不在白名单（返回 `blocked: true`，
   理由里直接点名 `unzip -l …`）。要看 jar / 包内文件（`BOOT-INF/lib/xxl-job-core-2.4.1.jar`、
   `BOOT-INF/classes/application-*.yml` 这类）用本地 ssh：
   `ssh -i <key> root@<ip> 'unzip -l /opt/app/x.jar | grep -i <lib>'`，或 `unzip -o -q … -d /tmp/x` 后再 grep。

口径：用户说「帮我在这台执行 X」时，交付物是**命令的输出**，不是完整的网络取证。最多两轮探测就必须给出结论
（能跑 / 跑不了 + 原因 + 建议的替代路径），不要连发十几条工具调用还不吭声——沉默的深挖会被打断"你在干啥呀"。

## 分发给别人（经 MCPHub 等网关）

别人拿到的永远是**网关签发的 key**，不是 ssh-ops 的上游 token。四件事缺一不可：

1. **注册条目**：`type: "streamable-http"`（写 `http` 不认）、`url: "http://host.docker.internal:8765/mcp"`
   （容器里 `127.0.0.1` 指容器自己）、`headers.Authorization: "Bearer <token>"`。
   少 headers 就是 401，页面上表现为「加上了但连不上」。
2. **鉴权头名别撞车**：网关自身 `bearerAuthHeaderName` 可能被改成 `Auth`；客户端用那个头过网关、
   上游用 `Authorization` 过 ssh-ops，两个头都要填对。
3. **分权**：给对方 `mcphub_xxx` key，`accessType: "servers"` + `allowedServers: ["ssh-ops"]`。
   交付物只有：网关地址 + key + 工具清单。不给 token、不给机器清单、不给密码。
4. **验证**：`docker logs <容器> --tail 50 | grep -i <server-name>`，看 connect 成功且无 error。

网关监听不用为此改成 `0.0.0.0`：Docker Desktop 把 `host.docker.internal` 转发到宿主回环，
`127.0.0.1` 保持不动即可。

⚠️ **别抢在用户前面改网关配置。** 用户说「我要在页面上加」就只给字段值；预先写进去的同名条目会让
他点 Add 时报「已存在」。用户说「告诉我方法就行 / 不需要你自己连」→ 只输出可复制片段与回滚命令，
停手后不要再回头补做。

## 踩过的坑

- **`mcp>=2.0` 移除了 `FastMCP`**（改名 `MCPServer`）。`uv pip install mcp` 默认装 2.x 会 import 失败，
  必须 `uv pip install "mcp<2"`（当前验证版本 1.30.0）。
- **局域网访问返回 421 Misdirected Request**：FastMCP 默认 `allowed_hosts=["127.0.0.1:*","localhost:*"]`
  的 DNS-rebinding 防护。必须传
  `transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False)`，
  否则本机 IP 访问全挂（server.py 已内置）。
- **Bearer 中间件别用 Starlette `BaseHTTPMiddleware` + `add_middleware`**：stateless 下能过，
  但 streamable-http 的长连接/生命周期容易被拦或重复消费。用纯 ASGI wrapper 包
  `mcp.streamable_http_app()`，uvicorn 直接托管最稳（POST/GET/DELETE 全受控）。
- **危险命令拦截别用"匹配 `rm -rf` 字面量"**：简单正则既漏（`rm -fr`、`rm -r -f`）又误伤
  （`rm -rf /tmp/x`）。正确做法是解析 rm 参数判断是否递归，再判断目标是不是
  `/`、一级系统目录或其内容（`CRITICAL_DIRS`）。同时 `sed -n '1,5p'` 不能被误判。
- SSH 偶发 "Operation timed out" 而 ping 也不通 → 是那台机器网络/负载问题，不是 MCP 的问题；
  先 `nc -G 3 -z <ip> 22` 确认，再判断代码。
- 命令超时用 `SSH_MCP_MAX_TIMEOUT`（默认 300s）；`du` 全盘扫会打满默认 30s。

## 安全测试纪律（最重要，先读这条）

**验证拦截器是纯函数测试，永远不要把破坏性 payload 发给真机。**

拦截器的判定逻辑（`_guard` / `_rm_targets_critical`）是纯字符串函数，直接在当前进程里 import 调它即可：

```python
import server as S
for c in ["rm -rf /", "reboot", "systemctl stop docker", "rm -rf /tmp/x", "df -h"]:
    print("BLOCK" if S._guard(c, False) else "allow", c)
```

为什么不能用 `ssh_run(server="101", command="reboot")` 来"验证"：拦截器一旦有漏洞，那条命令就真的在目标机上执行了——黑名单天生不全，漏一个词就是一次真事故。这个类别的错误不可回滚（集群被打断、checkpoint 之外的进程状态全没）。

- 端到端连通性用**无害 payload**（`hostname`、`uptime`、`df -h`）验证，与拦截规则无关。
- 真要端到端验证一条破坏性命令的放行路径，用一次性/弃用机器，且先确认该机上没有任何服务。
- 宁可只做纯函数测试、不端到端测破坏性命令：拦截器的正确性靠覆盖清单，不靠打靶。
- 测试选机器时避开有状态服务的主机（跑 Flink/k8s/PM2 的机器重启后不一定自启，见下）。

## 黑名单天生不全：写规则要按"命令族"过一遍

一个 deny-list 的正确性完全取决于写的时候脑子里过了哪些命令。写/改 `DANGEROUS` 时逐族核对，缺一族的代价是拦截静默失效：

```
删目录   rm -rf / | /etc | /var ...（解析参数判递归 + 判目标层级，别匹配字面量）
文件系统 mkfs* / dd of=/dev/* / fdisk / wipefs
关机重启 shutdown | poweroff | halt | reboot | kexec | init 0 | init 6
网络     iptables -F / nft flush / ip link down / systemctl stop network
关键服务 systemctl stop|restart|mask sshd|network|docker|kubelet|firewalld
账户权限 userdel / groupdel / passwd / chpasswd / visudo / chmod -R 777
数据     DROP DATABASE|TABLE / TRUNCATE / truncate -s 0 /var/log/*
定时任务 crontab -r / > /etc/cron*
进程     kill -9 1 / pkill -9 <关键进程> / fork bomb
配置覆盖 > /etc/{passwd,shadow,fstab,sudoers,hosts} / git reset --hard
```

**推论：黑名单只能当第二道防线。** 真正拦得住的是白名单式只读模式（`SSH_MCP_READ_ONLY=1`）。给不受信任的 agent、或任何会碰生产机的实例，默认开只读；写权限单独开一个实例并只授权明确的机器。

## 验证清单（改完代码必跑）

1. `.venv/bin/python test_client.py` → 6 个工具都列出，`ssh_run` 返回真实 hostname
2. 拦截器：in-process 调 `_guard()`，覆盖上节命令族的**每条至少一例**，另测 3 条应放行的（`rm -rf /tmp/x`、`df -h`、`sed -n '1,5p' /etc/hosts`）——**不发真机**
3. HTTP：无 token / 错 token → 401；正确 token → 200
4. 局域网 IP 端点（非 127.0.0.1）能 initialize + call_tool
5. `grep -c <PG密码> audit.log` → 0
6. 改拦截规则后同步更新 `audit.log` 的关注点：确认没有 `dangerous:true` 的无意记录
