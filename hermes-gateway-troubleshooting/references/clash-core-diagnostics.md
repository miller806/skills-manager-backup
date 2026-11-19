# Clash Verge / verge-mihomo 直查

service 模式的内核不监听 HTTP 控制端口，控制面走 **unix socket**：

```bash
S=/var/run/clash-verge-service/users/501/verge-mihomo.sock
curl -s --unix-socket "$S" http://localhost/version    # {"meta":true,"version":"v1.19.33"}
curl -s --unix-socket "$S" http://localhost/configs     # mode / tun.enable / dns / mixed-port
curl -s --unix-socket "$S" http://localhost/proxies     # 各组 + 当前选中 + 历史延迟
```

单节点实测延迟（组名/节点名是中文，需 URL 编码；`%F0%9F%94%B0%20%E9%80%89%E6%8B%A9%E8%8A%82%E7%82%B9` = `🔰 选择节点`）：

```bash
curl -s --max-time 12 --unix-socket "$S" \
  'http://localhost/proxies/<URLENC>/delay?timeout=5000&url=https%3A%2F%2Fwww.gstatic.com%2Fgenerate_204'
```

返回 `{"delay":36}` = 节点通；报错/超时 = 该节点线路坏。节点延迟正常但走 10808 出网仍 `000`，问题在本地 TUN/DNS 层；节点自己也失败，才是线路问题。

## 别被这两处误导

- **端口 9090 常被别的服务占用**（本机是 Tabby 的 Django），`/version` 返回 404 HTML 页不代表 clash 挂了——不要用它判断内核死活。
- **`lsof -nP -iTCP:10808 -sTCP:LISTEN` 可能看不到监听行**（service 模式内核由 root helper 拉起）。`nc -z` 能通即可；`lsof -i :10808` 里成片的 `CLOSE_WAIT` 是客户端残留连接，不是故障证据。

## 文件位置

| 路径 | 内容 |
|---|---|
| `~/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/verge.yaml` | GUI 设置：`enable_tun_mode` / `enable_system_proxy` / `enable_proxy_guard` / `verge_mixed_port` |
| `.../clash-verge.yaml` | 生成的内核配置：dns（fake-ip 段 `198.18.0.1/16`）、rules（搜 `discord` 看指向哪个组） |
| `.../logs/latest.log` | 只有订阅更新/配置校验/下发，**没有转发日志** |
| `.../service-logs/` | 常为空的旧目录，别指望里面有内核日志 |

`enable_proxy_guard: false` 意味着内核/节点异常不会自动切换或自愈，只能等下一次配置下发或人工处理——排查「为什么挂了 3 小时没人救」时先看这一项。

## 判定链

1. `nc -z 127.0.0.1 10808` → 端口在？
2. `curl -x http://127.0.0.1:10808 https://discord.com/api/v10/gateway` → 出网？（**唯一有效的出口判据**）
3. `--unix-socket .../configs` → mode=rule / tun.enable / mixed-port 是否如预期
4. `--unix-socket .../proxies` → `🔰 选择节点` 当前指向哪个节点 + 各节点实测延迟
5. `ps -o pid,%cpu,rss -p <mihomo pid>` → 进程在不在（RSS 几十 MB、CPU 接近 0 是正常的）

## 写解析代码的坑

`proxies` 返回 30KB+ JSON。先 `curl -o /tmp/px.json` 落盘，解析逻辑写成独立 .py 再跑；不要塞进 `execute_code` 的 f-string 里——嵌套字典字面量的 `{}` 会让 f-string 抛 `SyntaxError: f-string: valid expression required`。
