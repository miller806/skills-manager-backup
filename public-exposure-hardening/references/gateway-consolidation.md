# 多端口 → 单 443 网关收敛

## 目标形态

```
公网 ──► 只留 80/443（或源站只放行 CDN 网段）
              │
              ▼
  边缘 nginx（主 + 备 / keepalived VIP）  TLS 终止 · 限流 · IP 白名单 · 拦扫描
              │ 按 Host 路由（不再用端口区分服务）
      ┌───────┼────────────┬──────────────┐
      ▼       ▼            ▼              ▼
   静态站点  API 网关     Jenkins/管理面   内部服务
            (APISIX)     独立 host + 白名单  仅内网
```

核心动作：**一个端口一个服务 → 一个域名一个服务**。原 `listen 81/82/83/84/9099/9199` 收敛后只绑 `127.0.0.1` 或不再监听。

## 边缘 http 块

```nginx
server_tokens off;
limit_req_zone  $binary_remote_addr zone=gw:20m rate=30r/s;
limit_conn_zone $binary_remote_addr zone=conn:10m;
limit_req_status 429;
limit_conn_status 429;

# 扫描特征直接 444：不回包，不给指纹
map $request_uri $bad_bot {
    default 0;
    ~*\.(env|git|svn|DS_Store)        1;
    ~*/(wp-login|phpmyadmin|actuator)  1;
    ~*/(\.\./|etc/passwd)             1;
}

# 管理面来源白名单（内网段 + 办公/VPN 出口）
geo $admin_src {
    default 0;
    192.168.2.0/24 1;
    # <办公出口>/32 1;
}
```

## 默认入口 + 80 跳转

```nginx
server {
    listen 443 ssl http2 default_server;
    server_name _;
    ssl_certificate     /path/ssl/fullchain.pem;
    ssl_certificate_key /path/ssl/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    if ($bad_bot) { return 444; }

    limit_req  zone=gw burst=60 nodelay;
    limit_conn conn 30;
    client_max_body_size 50m;

    access_log /path/logs/gateway.log;
    error_log  /path/logs/gateway-error.log warn;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer-when-downgrade always;
}
server { listen 80 default_server; server_name _; return 301 https://$host$request_uri; }
```

## 业务 host（示例：原 82 口反代到内网网关）

```nginx
upstream svc_gw { server 192.168.2.40:10000; keepalive 32; }

server {
    listen 443 ssl http2;
    server_name ubs.example.cc;          # 具体域名，别再用 *.example.cc 泛匹配
    ssl_certificate     /path/ssl/fullchain.pem;
    ssl_certificate_key /path/ssl/key.pem;

    location / {
        proxy_pass http://svc_gw;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }
    location /ws/ {
        proxy_pass http://192.168.2.40:11000/;
        proxy_http_version 1.1;
        proxy_read_timeout 300s;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
    # 接口文档只对内网可见
    location ~ ^/(doc\.html|swagger-ui|v3/api-docs|webjars/) {
        if ($admin_src = 0) { return 404; }
        proxy_pass http://svc_gw;
    }
}
```

## 管理面（Jenkins / Nacos / Dashboard）

```nginx
server {
    listen 443 ssl http2;
    server_name jenkins.example.cc;
    ssl_certificate     /path/ssl/fullchain.pem;
    ssl_certificate_key /path/ssl/key.pem;

    allow 192.168.2.0/24;
    # allow <办公出口>/32;
    deny all;

    auth_basic           "Jenkins";
    auth_basic_user_file /path/conf/htpasswd;    # htpasswd -c 生成

    location / {
        proxy_pass http://192.168.2.213:8081;     # 后端另绑 127.0.0.1 或只授边缘机
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }
}
```

## API 鉴权放网关层（APISIX 片段）

```bash
curl -X PUT "http://127.0.0.1:9180/apisix/admin/routes/<id>" \
  -H "X-API-KEY: <新随机AdminKey>" -H 'Content-Type: application/json' -d '{
  "name":"<name>","uri":"/*","host":"<内部域名>",
  "plugins":{
    "key-auth":{"header":"apikey"},
    "consumer-restriction":{"whitelist":["<consumer>"]},
    "limit-count":{"count":600,"time_window":60,"key_type":"var","key":"remote_addr","rejected_code":429,"policy":"local"},
    "ip-restriction":{"blacklist":[]}
  },
  "upstream":{"type":"roundrobin","scheme":"http","pass_host":"pass","nodes":{"192.168.2.117:80":1}}
}'
```

配套三件，缺一条网关层就是摆设：Admin Key 换随机值；Admin/Dashboard/etcd/Redis/DB 端口绑 `127.0.0.1`；删掉 demo 路由和免鉴权直通路由。

## 切换前必查

1. `grep -rn 'listen '` 和 `grep -rn 'server_name'` 全量过一遍 —— 合并到 443 时重复 listen 与 `*.domain` 泛匹配会互相抢路由，`nginx -t` 不报语义冲突。
2. 出 host → upstream 映射表，标出冲突项，先改配置到旁路目录 dry-run（`nginx -t -c /path/conf-new/nginx.conf`），确认无误再 reload。
3. 单入口 = 单点，备份机 / VIP 必须先就位。
4. 证书来源决定策略：Cloudflare Origin CA（issuer=CloudFlare, Inc.，SAN 只有内部域名）说明源站在 CF 后面，优先做「源站只放行 CF 网段」，比换证书更快见效。
