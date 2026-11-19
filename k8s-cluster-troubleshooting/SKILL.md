---
name: k8s-cluster-troubleshooting
category: devops
description: Use when a k8s cluster is slow or the control plane flaps.
platforms: [linux, macos]
---

# K8s 集群排障

## 核心路由

磁盘/内存/etcd 的抖动，表象永远在上一层。固定按这条链往下走，不要从最外层报错的地方开始猜：

```text
业务表象（某个面板/接口慢）
  ↓ 第 1 步：先证明源站是快的
控制面（组件成批重启、kubectl 超时）
  ↓ 第 2-3 步：归并重启时间窗 + apiserver 报错
etcd（提交延迟）
  ↓ 第 4 步：三节点一起测
节点资源（内存 direct reclaim / IO）
  ↓ 第 5-6 步：pgscan_direct + limits 超卖比
真正的资源大户（某个 Pod 在持续膨胀）
  ↓ 第 7 步：进那个组件里找
```

多组件在**同一时间窗**一起抖，几乎必然是共享依赖（etcd / apiserver）被拖慢，而不是各自独立故障。

## 1. 先证明源站是快的

从**集群节点上**测，绕开本地 DNS / 代理 / CDN：

```bash
curl -s -o /dev/null -m 20 \
  -w 'ttfb=%{time_starttransfer}s total=%{time_total}s code=%{http_code}\n' \
  http://<node-ip>:<nodeport>/
```

直连毫秒级、走域名十几秒 → 问题在链路或控制面，不在应用。本机 curl 不作数：本地 DNS 被 fake-ip（`198.18.0.0/16`）劫持、出口 IP 命中 CDN WAF，都会让结论完全跑偏。**必须以节点侧实测为准。**

## 2. 盘控制面重启分布

```bash
kubectl -n kube-system get pod \
  -o custom-columns='NAME:.metadata.name,RESTARTS:.status.containerStatuses[0].restartCount,NODE:.spec.nodeName' \
  --no-headers | sort -k2 -rn | head -20
```

判据：重启次数是否在**同一分钟窗口**集中爆发。是 → 共享依赖抖动。

## 3. 把 apiserver 报错归并到具体 etcd 节点

```bash
kubectl -n kube-system logs kube-apiserver-<node> --since=2h 2>&1 \
  | grep -oE 'Addr: ?"[0-9.]+:2379"' | sort | uniq -c | sort -rn
```

controller-manager 侧对应的是 `Failed to update lock: etcdserver: request timed out` 与 `Client.Timeout exceeded while awaiting headers`。归并到单一 `Addr` 就把嫌疑锁定到一台机器的 etcd。

## 4. 三节点 etcd 延迟一起测

```bash
for n in <node1> <node2> <node3>; do
  echo -n "$n "
  ssh $n 'C=/etc/ssl/etcd/ssl; etcdctl --endpoints=https://127.0.0.1:2379 \
    --cacert=$C/ca.pem --cert=$C/admin-node1.pem --key=$C/admin-node1-key.pem \
    endpoint health'
done
```

**只测一台等于没测**，关键是横向对比。健康集群三节点都在 10ms 量级；出现一台 200ms+ 而其余个位数就是它。证书路径按部署形态找，见 `references/etcd-and-control-plane.md`。

## 5. 内存压力：看 pgscan_direct，不看 OOM

```bash
ssh <node> 'free -m; cat /proc/vmstat | grep -E "pgscan_direct|pgsteal_direct"; \
  cat /proc/sys/vm/swappiness; swapon --show; cat /proc/pressure/memory'
```

- **没有 OOMKilled ≠ 内存健康。** 只要没饿死到 OOM killer 阈值，内核就一直在做 direct reclaim。
- `pgscan_direct` / `pgsteal_direct` 是**同步回收**路径：申请内存的进程必须自己扫 LRU、等脏页回写，拿不到就阻塞。亿级以上计数说明长期饥荒。
- `swappiness=0` 且无 swap 最糟——无处可换出，只能反复扫文件页。
- PSI `full avg300 > 20%` 说明已经在明显卡顿。

细节与换算见 `references/node-memory-pressure.md`。

## 6. 统计 limits 超卖比

```bash
for n in $(kubectl get node -o name | cut -d/ -f2); do
  echo -n "$n  "
  kubectl describe node $n | awk '/Allocated resources/,/ephemeral/' \
    | grep -E '^  memory' | awk '{print "req="$2" lim="$4}'
 done
```

`limits 之和 / 物理内存`：<100% 正常，100~120% 可接受，**>150% 就是在赌运气**。超卖本身不报错，只在负载真上量时以 direct reclaim 的形式爆炸。

## 7. 找真正的资源大户

```bash
kubectl top pod -A --sort-by=memory | head -20
ssh <node> 'ps -eo rss,comm --sort=-rss | head -10'
```

节点侧 `ps` 的 RSS 比 `kubectl top` 更接近实际（后者是采样 + 含 page cache 口径差异）。定位到具体 Pod 后**不要只加 limit**，先判断它属于哪种膨胀——见 `references/loki-object-storage.md` 的「缓存型 vs 阻塞型」。

## 改动纪律（用户明确要求）

**一次只改一项，改完立刻实测，再改下一项。** 内存问题多因一果，批量改会让你彻底失去归因能力。每项固定盯三个指标：

1. 目标节点 `free -m` 的 `available`
2. 该节点 etcd `endpoint health` 的 `took`
3. 业务首屏 `ttfb`

控制面已经降级时，所有 kubectl 命令加超时，避免自己卡死：

```bash
kubectl ... --request-timeout=25s    # 或 timeout 30 kubectl ...
```

## 常见误判

- **Operator 托管的工作负载只改 CR，或只改底层资源。** operator 自身 CrashLoopBackOff 时 CR 无人 reconcile；反过来只改底层对象，operator 恢复后立刻按旧 CR 回滚。**两边都改，保持一致。**
- **`kubectl set image` 修 Helm 管理的镜像。** 下次 `helm upgrade` 静默回滚。必须回落 values（`--reuse-values --set <comp>.image.tag=X`）并用 `helm get values` 验证 tag 真写进了 release。
- **chart 的 `appVersion` 不等于实际跑的镜像 tag。** `helm show values <chart> --version <ver> | grep -nE '^\s*(repository|tag):'` 看真实默认值，别信 appVersion。
- **`kubectl rollout restart` 报了 Success 但 Pod 的 `startedAt` 没变。** StatefulSet 用 `podManagementPolicy: Parallel` 且某个 Pod readiness 一直不过时，`currentRevision != updateRevision`，滚动卡死。直接删那个 Pod 让它按新 revision 重建。
- **所有副本都在同一节点。** 先查 `affinity`，有 `requiredDuringScheduling...` 的组件不能简单 migrate Pod，只能靠改 limits 或给别的组件加反亲和。
- **distroless 镜像没法 `exec -- sh`。** 不是权限问题，是镜像里没有 shell。改用 `kubectl top`、节点侧 cgroup `memory.current`、`ps -eo rss`。

## 参考

- `references/etcd-and-control-plane.md` — 部署形态识别、证书路径、etcd 深度指标、Raft 判读
- `references/node-memory-pressure.md` — direct reclaim 判据、超卖换算、cgroup 取数
- `references/loki-object-storage.md` — 日志栈落盘失败、S3 兼容存储与 AWS SDK v2 的坑、凭据探针

## 相关

- [[K8s探针误杀引发级联故障]] — 另一种「表象在应用、根因在 infra」的级联故障，判据是 `exitCode=0`
