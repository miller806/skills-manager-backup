# APISIX 指标接观测（2026-11 实测于 192.168.2.100）

## 修通 9091（2026-11-28 实修，apisix 3.20.0-ubuntu 生效）

根因**不是** privileged agent 起不来：3.20 里 `ps` 能看到 `privileged agent process`，
`/proc/1/status` Uid=636、`CapEff: 0` 也能跑。容器外 RST 的唯一原因是 metrics server 只绑 `127.0.0.1`。
**配置层一处搞定，不需要 privileged / cap_add / 改 nginx.conf 模板**：

```yaml
# apisix_conf/config.yaml 末尾
plugin_attr:
  prometheus:
    export_addr:
      ip: "0.0.0.0"
      port: 9091
```

`docker compose restart apisix`（~12s）→ 容器内 nginx.conf 自动渲染成 `listen 0.0.0.0:9091 reuseport;`
→ 宿主 `curl 127.0.0.1:9091/apisix/prometheus/metrics` 返回 200，约 130 行指标
（`apisix_http_*` / `apisix_nginx_*` / `apisix_etcd_*`，含 `process="privileged-agent"` 系列）。
默认值在容器内 `apisix/cli/config.lua` 的 `plugin_attr.prometheus`（export_addr.ip=127.0.0.1），排查以它为准。

⚠️ **别用 `nginx_config.main_configuration_snippet` 加 server 块覆盖**：该 snippet 渲染在 main context
（http 块之外），`server` 指令非法 → apisix 进 `Restarting` 循环，日志
`nginx: [emerg] "server" directive is not allowed here in .../nginx.conf:8`。
出这个状况立刻 `cp -a /root/config.yaml.bak-<ts> config.yaml && docker compose restart apisix` 回滚。

## 旧结论（3.13 时代）：9091 读不到 → privileged agent 起不来

`conf/nginx.conf` 里的 metrics server 是：

```
server {
    listen 127.0.0.1:9091 enable_process=privileged_agent;   # 只绑 loopback → 容器外一律 RST
    location / { content_by_lua_block { ... export_metrics() } }
}
```

- 9091 只监听容器内 127.0.0.1。宿主 `curl 127.0.0.1:9091` 必 RST（docker-proxy 能连上，但没有进程应答）。
- 即使容器内请求也空：master 以非 root(apisix/636) 跑，`/proc/1/status CapEff: 0000…`，同时没有
  `NET_BIND_SERVICE` → worker 无法 setuid 到 privileged agent，进程列表里看不到 `privileged agent process`。
- 判定命令（缺一不可）：
  `docker exec apisix ps -eo args | grep 'privileged agent'`、
  `docker exec apisix cat /proc/1/status | grep CapEff`、
  `docker exec apisix grep listen /usr/local/apisix/conf/nginx.conf | grep prometheus`
- 不要用 `kill -USR1 1`（nginx reload）当修复手段；它不会让 master 拿到 CAP_SETUID。修法：容器加
  cap（`cap_add: [NET_BIND_SERVICE, SETUID, SETGID, DAC_OVERRIDE]` 或 privileged）后重建，
  或改用 `node_listen` 旁的公开 metrics 端口（`apisix.enable_control: true` + 9080 的
  `/apisix/prometheus/metrics`，需在 config 里 `plugin_attr.prometheus.export_uri` 或全局 route）。
- `prometheus` 插件在 config 的 plugins 列表里≠在 export；**导出靠 9091/nginx**，跟 plugins 列表无关。

## 本编队观测面

```
VictoriaMetrics  http://127.0.0.1:8428  (192.168.2.100)   29769 series / job 只有 uat-alibaba-doris-fe
Nightingale 9.3  http://192.168.2.100:17000  (admin)
  mysql 容器 root:1234 → n9e_v6
  datasource：1=VictoriaMetrics(prometheus) → http://192.168.2.100:8428/ ，2=internal-loki → 184:30100/loki
  board(仪表盘) 已建 10 个：MySQL/Kafka/Redis/MongoDB/PostgreSQL/Doris/ClickHouse/JVM(Actuator)…
  board_payload 存的是 Grafana 风格 panel JSON（panels[] + layout），可仿写网关专属面板
  n9e 前端是 APISIX 后面的 devN9e 路由（host n9e.gateway.internal，key-auth）
```

现有 board 只能看后端；网关自己一条指标都没入 VM。想有网关面板＝先把 9091 修通 → 让 VM/categraf 抓 →
在 n9e 建 board（复制现有 payload 改 promQL/target）。
