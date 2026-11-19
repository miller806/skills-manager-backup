# APISIX 升级（含版本兼容性核对）

## 准备（只读，全部做在变更之前）

```bash
D=/root/evidence-$(date +%Y%m%d)/pre-upgrade; mkdir -p $D

# 1) etcd 快照（最重要，etcd 是唯一事实来源）
docker exec etcd etcdctl --endpoints=127.0.0.1:2379 snapshot save /tmp/apisix-etcd.db
docker cp etcd:/tmp/apisix-etcd.db $D/apisix-etcd.db

# 2) 逐类导出，用于升级后逐条 diff（$NEW 是现行 admin_key）
for r in routes upstreams consumers ssls global_rules services plugin_metadata; do
  apisix_admin_get "$r" > "$D/$r.json"   # 即 GET 9180/apisix/admin/<r> 带 X-API-KEY 头
done

# 3) 整目录备份 compose（回滚时直接 cp 回来）
cp -a /opt/docker/compose/apisix /opt/docker/compose/apisix-backup-$(date +%Y%m%d)

# 4) 记录当前镜像 tag 与实际引用到的插件（决定兼容性风险面）
docker inspect apisix --format '{{.Config.Image}}'
docker exec etcd etcdctl --endpoints=127.0.0.1:2379 get /apisix --prefix --print-value-only
```

第 4 步输出的插件清单是兼容性核对的输入：CHANGELOG 的 breaking change 只对**实际启用/实际引用**的插件
有影响，对着全量插件列表逐条比对只会制造假风险。

## 兼容性核对

拿 CHANGELOG 原文，不要凭印象。`docs/en/latest/upgrade-guide.md` 在 master 上已不存在（404），
用仓库根的 `CHANGELOG.md`：按 `## <version>` 切段，**只抽含 `:warning:` 的行**——那才是 breaking change。
核对结论写成「命中的 / 不命中的」两组，命中的逐条给处置，不命中的一句带过。

## 跨版本已知 breaking change（3.13 → 3.20）

| 变更 | 起始版本 | 会打到谁 |
|---|---|---|
| `mcp-bridge` 插件移除 | 3.20 | 启用了它 |
| `wolf-rbac` 的 `header_prefix` 行为改变 | 3.20 | 启用了 wolf-rbac |
| `oas-validator` / `keycloak` 调整 | 3.20 | 启用了这两个 |
| `openid-connect` / `jwt-auth` 签名与 claims 校验收紧 | 3.16+ | 用了 OIDC/JWT 鉴权 |
| `basic-auth` 拒绝空密码 | 3.19 | basic-auth + 存在空密码 consumer |
| `jwe-decrypt` / `forward-auth` 参数调整 | 3.20 | 启用了这两个 |
| schema 校验接口需要 admin 凭证 | 3.17 | 有脚本匿名调它 |
| websocket 指标新增 `request_type` 标签 | 3.19 | 开了 `enable_websocket`（改变指标基数） |
| `batch-requests` 请求上限 | 3.19 | 启用了 batch-requests |

只挂 Host 匹配 + `key-auth` / `consumer-restriction` / `prometheus` 的网关，上述全部不命中——本编队就是
这种情况，所以 3.13→3.20 属低风险升级，但**仍必须按下面的窗口与回滚预案执行**。

镜像 tag 变体：`apache/apisix` 提供 `-debian` / `-ubuntu` / `-redhat` 三种，本编队统一 `-ubuntu`。
换基础镜像是换整套系统库，别顺手换。

## 拉镜像（本链路上真正的卡点）

判定顺序：

1. 宿主机 `docker.service.d` 里有没有 proxy drop-in；有的话**先验证那台代理机还活着**。
   回 `401` = 通（registry 正常要求凭证，属正常响应），连不上/超时 = 不可用。
2. 代理不可用时判设备是否真的死了：`ip neigh` 显示 REACHABLE 只说明二层在，
   要用 `nc -z -w2 <ip> <port>` 看端口。**当纯 NAT 用的设备会 ARP 可达但所有 TCP 端口关闭**。
3. 再看宿主机能否直连 registry（绕开代理 `--noproxy '*'` 试）；不通就只剩下面两条路。

**A. 反向端口转发（最快，零残留）**——在能上网的 Mac / 跳板机上已有本地代理时：

```bash
# 在能上网的一端执行，把宿主机的 10808 映射回本机代理；生命周期 = SSH 连接
ssh -R 10808:127.0.0.1:10808 root@<目标宿主机>
```

宿主机侧只给这一次 `docker pull` 指定代理，**不改任何配置文件**，断线自动失效。

**B. 搬运（最稳）**——宿主机完全不出网时，在能上网的机器上按 registry API 取 manifest → 逐层下载
blob → `docker load` → `docker save` → scp → 宿主机 `docker load`。先探一条 layer 的速度
（`>1MB/s` 就够，镜像通常 <400MB），再决定走这条。

注意 macOS 上 docker 若配了 `http.docker.internal` 代理，显式代理变量可能与之冲突导致 `docker pull`
卡住无输出；**先用普通 HTTP 客户端判断是网络问题还是 CLI 问题**，不要在同一条路上反复重试
（同一命令重复超时 2 次就换路，别凑第三次）。

## 执行与回滚

```bash
cd /opt/docker/compose/apisix
# 1) 改 tag（<old> → <new>）
docker compose up -d apisix            # 中断 30–60s
# 2) 验证：admin 可读、各 Host 的 9080 状态码与升级前一致、consumer 的 key-auth 仍能通过
# 3) 回滚：tag 改回 <old>，旧镜像仍在本地，再 up -d 一条命令退回去
```

升级后必核三项：admin 接口用新 key 可读、各 Host 的 9080 状态码与升级前一致、consumer 的 key-auth 仍能通过。
