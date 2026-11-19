# 读取宿主机指标：正确的口径与阈值

## macOS 内存（最易算错）

```bash
vm_stat | head -8
sysctl -n hw.pagesize hw.memsize
sysctl -n vm.swapusage
memory_pressure | grep -i 'free percentage'
```

- `Pages free` / `Pages active` / `Pages inactive` / `Pages wired down` / `Pages occupied by compressor` 都是**页数**，必须乘 `hw.pagesize`（Apple Silicon 通常 16384）才是字节。
- 有意义的已用量：`active + wired + compressor`。`inactive` 是仍在缓存里的可回收页，不算已用。
- `memory_pressure` 的 `System-wide memory free percentage` 是**空闲百分比**，不是压力百分比。压力大表现为：这条数字很低、`vm.swapusage` 的 used > 0、compressed 持续上涨。
- 报警口径（24GB 机器）：used > 20GB，或 compressed > 6GB，或 swap used > 0 且未回落。free 只剩几百 MB 属于正常缓存行为，不单独报警。

## 负载 / 热

```bash
uptime                     # load averages 1/5/15
sysctl -n hw.ncpu          # 核数，用来对比 load
pmset -g therm | grep -Ei 'CPU_Speed_Limit|CPU_Scheduler_Limit'
```

load 1min 长期 > 核数才算过载；`CPU_Speed_Limit < 100` = 正在热降频。无输出表示未限速，不是采集失败。

## 磁盘

BSD 的 `df` 参数和 Linux 不同，且 macOS 系统卷与数据卷分开：

```bash
df -h / /System/Volumes/Data
```

看 `/System/Volumes/Data` 的使用率（用户数据都在这里），> 85% 报警。`/` 永远很小，不代表可用空间。

## 进程与端口

```bash
ps -Aceo pcpu,pmem,rss,comm -r | head -6    # 按 CPU，RSS 单位 KB
ps -Aceo pcpu,pmem,rss,comm -m | head -6    # 按内存
lsof -nP -iTCP -sTCP:LISTEN                 # 谁在监听
ls -lt ~/Library/Logs/DiagnosticReports/*.ips | head -3   # 近期崩溃
```

## Docker 健康状态判定

```bash
docker ps --format '{{.Names}}\t{{.Status}}'
docker inspect <c> --format '{{json .Config.Healthcheck}}'
docker inspect <c> --format '{{json .State.Health}}'
docker exec <c> sh -c 'command -v wget || echo NO_WGET; command -v curl || echo NO_CURL'
```

`unhealthy` 的判定顺序：

1. 先看 healthcheck 的 `Test` 用的什么二进制，再确认镜像里有它。镜像缺该二进制时，每次探针都报 `exec: ... executable file not found in $PATH`，`FailingStreak` 一直涨但服务是好的。
2. 用应用真实端口直连验证：`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:<port>/<health-path>`。200 就说明是探针坏了，不是服务坏了。注意 healthcheck 的 path（如 `/health`）与根路径 `/` 都测一下。
3. 修法是把 healthcheck 换成镜像里存在的客户端（如 `curl -fsS`），compose 文件位置可从容器标签取：
   `docker inspect <c> --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}'`
4. 长期容器（`Up 12 days`）+ 正常端口 = 不告警；`Restarting` / 反复 `Exited` 才告警。`Created` 状态的残留容器不告警。

## 服务存活

- Hermes 自身：`pgrep -f 'hermes gateway run'`；按需启动的组件（如 browser harness）down 是正常态，写进 cron prompt 的“预期为 down”清单里，避免每轮误报。
- 机器上手动启的服务（如 `./sbin/nginx`）重启后不复活，巡检脚本只报状态，重启动作留人工确认。
