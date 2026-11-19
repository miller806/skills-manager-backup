# APISIX 指标接观测（2026-11 实测于 192.168.2.100 / apisix 3.13.0-ubuntu）

## 关键结论：9091 读不到 → privileged agent 起不来

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
