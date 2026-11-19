# 9080 公网暴露排雷（2026-11-19 实测）

出口公网 IP = **112.28.138.245**（中国移动 AS9808，合肥）。路由器把 9080 映射到这个地址，
APISIX 的 access.log 里 host 字段直接是 `112.28.138.245:9080` → 确认外部确实能打进来。

## 实际在发生什么（access.log 实测）

```
179.199.199.45  (AS400619 AROSSCLOUD 香港，扫器)  约 25.5k 请求
  GET /ip /get /headers /cookies /anything ...      探 httpbin 桩路由
  GET /apisix/admin/{routes,consumers,upstreams,...}  探 Admin API
  状态码：404 25266 / 401 162 / 200 49 / 502 25 → admin 全部 404，未得手
192.168.2.91 / 8.222.x / 47.236.x / 172.30.163.166（阿里云内网搬过来的 categraf）
  POST /prometheus/v1/write, /v1/n9e/heartbeat, /loki/api/v1/push  正常业务
```

关键区分：**`/get` `/ip` `/headers` 命中的是 APISIX 自带 demo 路由（upstream 指向 httpbin.org）**，
不是我们的服务。扫器把 demo 打穿了（49 次 200），这是白送的探测面 → demo 路由必须删。

## 真正的风险面（按严重度排序）

1. `/*` + 空 plugins 的路由（dev-redis→nacos 8848、cregis-developer→117:80）= 整台后端裸奔；
   打穿任一条就等于把内网服务暴露到公网（且绕过后端自己的鉴权）。
2. admin_key 固定 32 位 hex 明文写在 config.yaml（`edd1c9…`），且 `allow_admin: 0.0.0.0/0`。
   现在扫器从 9080 打 admin 被 nginx 控制面拦成 404；但任何能访问 9180 的人（局域网、或路由器哪天多映射一个端口）
   可直接带着这个 key 改路由。**视为已泄露。**
3. 无 TLS：`curl` 走明文，key-auth 凭据、业务 token 全部明文过公网。
4. demo 路由 `/get` `/ip` `/headers` 指向公网 httpbin → 相当于公网 SSRF / 带外通道。
5. 端口映射数量不明（路由器侧看不到），需登录路由器核对全部映射，不只 9080。

## 处置顺序（低风险→高风险）

```bash
# 1) 删 demo 路由（立即，零风险）
for id in 1 getting-started-ip getting-started-headers; do
  curl -X DELETE "http://127.0.0.1:9180/apisix/admin/routes/$id" -H "X-API-KEY: $K"
done
# 2) 给 /* 路由补 key-auth（对可信调用方发 key；categraf 打 9080 的 n9e 写入也要一起配，会中断采集）
# 3) 把 categraf/loki 采集改到内网直连（不经 9080），然后 n9e/loki 路由也可以彻底去掉
# 4) 9180/9091/9000 不该出现在任何端口映射里；先核路由器，再改 allow_admin
# 5) 上 443 + 真证书，9080 只对内网；公网只留 443
```

排查命令（宿主）：`iptables -t nat -S DOCKER | grep dport`、`curl -s api.ipify.org`、
`docker exec apisix sh -c "tail -20000 access.log" | awk '{print $1}' | sort | uniq -c | sort -rn`。
不要把 access.log 直接 grep 正则（nginx 行有引号/转义），用 `sed -E` 先把请求行洗成 `路径 状态码` 再统计。
