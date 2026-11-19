# 多机 Linux 巡检脚本（daily_inspect.py）的经验

本机 profile 脚本：`~/.hermes/profiles/h-ops/scripts/daily_inspect.py`，数据源是 PG CMDB
`ssh_servers_nonprod`（status='active'），并发 5 台 SSH 采集。

## 一条铁律：报告在脚本里渲染，cron 只负责粘贴

v1 只吐原始 JSON（`mem_line`/`disk_line` 是 `free -h`/`df -h` 的整行文本），cron 每跑一次就要
临时写一段 Python 解析 + 排版。结果是：每天输出格式都不一样、解析错一次就报错、agent 花大量
上下文在格式化上。

v2 把「采集 → 判定 → 渲染」全放进脚本，产出 `/tmp/daily_inspect_report.txt`，cron prompt 只写
「read_file 那个文件，原样放进代码块，不要增删」。改脚本比改 prompt 可靠。

## 认证分支：CMDB 里 key 认证的私钥存在 password 字段

`auth_method='key'` 的记录，`key_path` 是 NULL，PEM 全文（约 3.2KB）塞在 `password` 字段里。
只用 `sshpass` 必然失败，且 stderr 只有 `no output`，看起来像网络不通 —— 误判方向。

正确做法：

```python
if auth == "key":
    if "PRIVATE KEY" in secret:      # PEM 在 password 字段
        写临时文件 0600，用完 os.unlink
    else:                             # 指向外部密钥文件
        keyfile = os.path.expanduser(key_path)
    cmd = ["ssh", ..., "-i", keyfile, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes"]
else:
    cmd = ["sshpass", "-e"] + base_cmd
```

`IdentitiesOnly=yes` 必加，否则本机 ssh-agent 里的 key 会被拿去试，报错指向错误的 key。
临时文件必须 `mkstemp` + `chmod 600`，`finally` 里删；测过「临时私钥无残留」。

## 错误分类，别让网络故障烧满重试次数

`no output` 这个 stderr 毫无信息量，要自己分词：

| 关键字 | 分类 | 处理 |
|---|---|---|
| `permission denied` / `authentication` | auth | 重试 3 次（可能 sshd/PAM 忙） |
| `banner` / `kex_exchange` / `connection closed` / `timed out` | network | **只重试 2 次**，握手不通重试没意义 |
| `refused` | refused | 重试 2 次 |

7 台握手超时的机器，v1 要烧 7×3×25s ≈ 8 分钟；只重试 2 次后整轮 40~100s。
报告里「不可达」按原因归类，`auth=` 和「尝试 2 次」都要打出来，看报告的人能立刻分诊。

## 指标解析：读 /proc，不要切 free -h

`free -h` 的列顺序在 procps 版本间不同（有无 `available` 列），按位置切会算错。

```bash
awk '/^MemTotal:/{t=$2}/^MemFree:/{f=$2}/^MemAvailable:/{a=$2}/^Buffers:/{b=$2}/^Cached:/{c=$2}
     END{printf "%d %d %d %d %d\n", t, f, a, b, c}' /proc/meminfo
```

**单位是 kB**，Python 侧要 ×1024；老内核没有 `MemAvailable` 时退化成 `Cached+Buffers`。
内存占用率用 `(total-available)/total`，不用 `used`（后者含 buff/cache）。

Uptime 秒数用 `/proc/uptime`，不要解析 `uptime -p` 的英文（`1 week, 2 days` 还得自己乘）；
`uptime -s` 只用来显示重启时间点。

## 磁盘：必须排除这三类挂载

`df -P -B1 -x tmpfs -x devtmpfs -x overlay -x squashfs` 之后还要在 Python 里过滤：

- `/var/lib/kubelet/pods/...` —— pod 的 emptyDir / NFS 挂载，路径能长到 100+ 字符，
  直接按「最满挂载」报会污染表格（srv-52/srv-82 实测）
- `/boot`、`/boot/efi` —— 长期 25% 上下但和业务无关，报出来是噪音
- `/run/*`、`/snap/*`

按 `used/size` 自己算百分比（`df` 的 Use% 会向上取整，80.4% 显示成 81%），
全部挂载点排序后取最满的那个作为该机「磁盘」列。

## 深挖（告警主机二次采集）

只有触发告警的机器才跑第二条 SSH：

- 内存告警 → `ps -eo rss=,pmem=,comm= | sort -rn | head -6`，报告里写成
  `java2202M(28.6%) java1976M(25.7%)`，一眼看出是不是 JVM 堆没设上限
- 磁盘告警 → `timeout 20 du -x -d1 -B1 <最满挂载>`，注意**必须包 `timeout`**：
  挂载点下有网络存储/NFS 时 `du` 会挂住，v1 没加 timeout 时深挖全部超时失败

深挖并发 2（不是 5）：深挖本身是重活，并发高了反而全超时。

## 报告格式（用户偏好）

```
CMDB active 27 台 → 可达 20 / 不可达 7
告警 5 台（🔴1 / ⚠️4）

【总览】 IP 主机 核 load 内存 磁盘 业务 状态   ← 一行一台，业务列取自 CMDB.business
【不可达】 按原因归类，每行 host/name/env/auth/尝试次数
【告警明细】 每台 3~5 行：标题行(主机+IP+业务) / 指标 / top进程 / 挂载占用
```

- 总览顺序固定：内网按 IP 数值在前，公网在后。**不要按严重度重排** —— 每天位置一致才能
  逐日对比
- 业务名超 24 字符截断加 `~`，主机名同理；中文是双宽字符，超过就错位
- 代码块内不放 emoji（`⚠️🔴` 会破坏对齐），只放在状态列之后或块外
- 统计尾巴写「采集耗时 Xs」和不可达机器的处置建议
