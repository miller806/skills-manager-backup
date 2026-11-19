# CMDB 服务器录入（ssh_servers_prod / ssh_servers_nonprod）

何时用：用户说「把 X 加到生产表 / 加到编队 / CMDB 里加一台机器」。
这类写入是**低风险 CMDB 元数据操作，用户要的是直接落库**——不要走 MCP 工具、不要先问确认，
直接连 PG 执行，做完报一条结果行。

## 表怎么选

- 生产 → `hermes.ssh_servers_prod`，`environment='pro'` 是列默认值。
- dev/fat → `hermes.ssh_servers_nonprod`，`environment` 取 `dev` / `fat` / `dev,fat`。
- **一台机器只在一张表里。** 进 prod 表后 ssh-ops 默认完全查不到（不是拦命令，是拿不到凭据），
  要 `SSH_MCP_ENABLE_PROD=1` 才可连，且危险命令硬拦。反过来，生产机留在 nonprod 表 = 绕过了整套隔离。

## 录入顺序

1. **直连 PG**：`~/.codebuddy/postgres-cli/credentials.json` 的 `hermes` 段，或
   `~/.hermes/shared-skills/postgres-docker/scripts/pg.py`。写库用系统 `/usr/bin/python3`（有 psycopg2）。
2. **两张表都查重**（`name` 有唯一索引，`host` 没有）：
   `select id,name,host from ssh_servers_prod where name=%s or host=%s`，nonprod 再查一遍。
3. **采集真实事实再写 description，不要照抄别人的行或凭印象填**：
   ```bash
   hostnamectl | grep -E 'Static hostname|Operating System'
   nproc; free -g | awk '/Mem:/{print $2}'; df -h / | tail -1
   `ip -4 addr show | grep -oE '172\.[0-9.]+'    # 云主机内网 IP → private_ip 列
   pm2 list        # 谁在这台机上跑什么，也要写进 description
   ss -tlnp | awk 'NR>1{print $4}' | sort -u
   ```
   告警：`df -h /` 只看根分区，数据盘要另看；`free -g` 取 `Mem:` 行第二列 = 总内存 GB。
4. **私钥复用，不要新生成**：`auth_method='key'`、`key_path` 存**本机私钥文件绝对路径**、
   `password` 列 **NULL**。私钥落在 `~/.ssh/id_rsa_fleet_<sha256前12位>`（0600），
   同一把 key 的多台机器共用同一个文件、只是多行 `key_path` 指向它。
   写前 `ssh-keygen -lf <文件> -E sha256` 指纹自检，确认与已有行同一把。
   ⚠️ **绝不把私钥文本写进 `password` 列**：那是历史遗留的畸形数据（曾把 3246 字节 PEM
   塞进 password，导致 `_ssh()` 把 PEM 当密码喂给 sshpass、所有 key 机器 100% 登录失败）。
   现在 `_ssh()` 按 `auth_method` 分支走 `ssh -i <key_path>`，`password` 只放密码。
   录入后当场用 `ssh_run` + `hostname` 验一次再报"已录好"。
5. **命名 `prod-<公网IP前3段>`**，与存量对齐（`prod-102.3` / `prod-18.139.136` / `prod-54.251.230`）。
   `host` 存**外网/连接地址**（连接一律走它），内网地址写进 `private_ip` 列（见下一条）。
6. **`private_ip` 必填（2026-11 起）**：两张表都有 `private_ip varchar(64)`，含义是内网地址。
   - 云主机：`host`=公网 IP，`private_ip`=内网 IP，**必须两个都录**。
   - 纯内网机（192.168.2.x）：两列填**同一个值**，不要编造公网 IP。
   - 采集（只读，别猜）：AWS `curl -s http://169.254.169.254/latest/meta-data/local-ipv4`；
     阿里云 `curl -s http://100.100.100.200/latest/meta-data/private-ipv4`；兜底 `hostname -I`
     （取第一个非 docker/br- 网段地址）与 `ip route | grep kernel` 的 src 交叉验证。
   - 拿不到就留 NULL 并在 `description` 写「内网IP待核实」，**不要凭历史会话猜**（猜的必须一并标待核实）。
7. **`host_type`**：云主机（EC2 等）`cloud`；ESXi 虚机 `vm` 且要填 `physical_host`。
8. 复核只 select 元数据列 + `length(password)`；`pg.py query "select *"` 会把密码列大幅脱敏，
   但自己写脚本时别 select password 再 print。

## 坑

- **`pg.py` 会拦 `ALTER TABLE` / `DROP`**（报「高危语句被拒绝」）。要改表结构就拆脚本：
  去掉 SQL 文件里的 `-- 注释掉的 DROP COLUMN`（连注释里的关键字也会命中），并加 `--force`。
- **`key_path` 拼写**：存量 prod 表曾有 4 行写成 `~/.ssh/iid_ed25519_new`（多一个 `i`，实盘不存在），
  症状是 MCP 返回 `exit_code 78 凭据配置错误`。录入时 `ls` 一下 key 文件再写绝对路径。
- **`_resolve()` 只认 `192.168.2.x` 和裸数字末段。** 传公网 IP（如 `54.251.230.202`）不匹配前两条正则，
  会退化成按 **name** 查 → 报「服务器不存在」。公网机只能按 name 调 `ssh_run`（`prod-54.251.230`）。
  要支持按公网 IP 查，得改 `_resolve()` 加一条 IPv4 正则分支，别以为是条目没写进去。
- **`_ssh()` / `_scp()` 不带任何 per-host ssh 选项**。需要 `-o BindInterface=en1`（绑源 IP 出网卡）、
  跳板、非默认 IdentityFile 的机器，录进表也连不通。录入时就说明，并明确是「改 server.py 按 host 加选项」
  还是「只当 CMDB 记录、手工上机」。`server.py` 现有调用固定为
  `sshpass -e ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=10 -o ServerAliveInterval=15 -p <port>`。
- 改 `server.py` 加选项时：`BindInterface` 只在 macOS 客户端有效（Linux 客户端不认该选项，
  会直接报 `Bad configuration option`）。别假设别的机器也能跑同一份配置。
