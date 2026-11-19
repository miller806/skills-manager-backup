# Lark / lark-cli 用户授权的有效期与滚动续期

## 令牌生命周期（飞书服务端下发，客户端不可配）

| 令牌 | 有效期 | 能否改 |
|---|---|---|
| `user_access_token` | 2 小时 | 不能 |
| `refresh_token` | 7 天左右（实测 granted→refreshExpiresAt = 7.5 天） | 不能 |
| 硬上限 | 授权满 365 天后必须人工重新扫码 | 不能 |

`lark-cli auth status` 的 `identities.user.expiresAt` / `refreshExpiresAt` / `grantedAt` 三个字段就是这三个数。

## 关键机制：refresh_token 是一次性、可滚动的

每次刷新都会下发**新的** refresh_token 和**新的 7 天窗口**，旧的立即失效。所以：

- 只要 7 天内发生过一次刷新，窗口就一直往后滚 → 用户永远不用再扫码（直到 365 天）。
- 反过来，如果 7 天内一次都没调用过 user API，窗口自然过期 → 刷新时报 **20037** → 只能人工重新扫码。这就是"授权又掉了"的真实原因，不是 CLI 的 bug。

## 状态语义（别把 needs_refresh 当失效）

```
status=ready           access token 有效
status=needs_refresh   access token 过期了，下次 user API 调用会自动换 —— 不算故障
                       --verify 会在服务端校验后顺带刷新，返回 verified=true
refresh 窗口过期        刷新报 20037，这才是真的需要人工介入
```

判据用 **`refreshExpiresAt` 剩余天数**，不要用 `status != ready`。

## 巡检脚本的正确写法

`~/.hermes/profiles/h-ops/scripts/check_lark_auth.py`（cron `3c0ad9e23b58`，每 720 分钟一次，`no_agent` 静默模式）的做法：

1. 先跑 `lark-cli auth status --json --verify` —— 主动走服务端，token 过期时顺带刷新，**让窗口滚动**（这是"续期"的实际实现）。失败再退回不带 `--verify` 的调用。
2. `status` 不在 `{ready, needs_refresh}` 或 `available == false` → 报授权不可用。
3. `refreshExpiresAt` 剩余 < 2 天 → 报"即将到期"，附重新授权命令。
4. 其余静默（exit 0，零字节输出），避免刷屏。

验证方法：造一个假 `lark-cli` shim 放 PATH 前面，分别返回 healthy / near_expiry / dead 三种 JSON，跑三遍确认只有后两种有输出。**不要**为了测报警去真机上改 token。

## 重新授权流程

```bash
lark-cli auth login --domain all --no-wait --json   # 取 verification_url + device_code
lark-cli auth qrcode '<verification_url>' --output lark_auth.png
# → 先 URL 后二维码，结束本轮；用户扫码完成后回来告知
lark-cli auth login --device-code '<device_code>' --json   # 由 agent 亲自收尾
```

- device_code **存本地文件**（chmod 600），不落聊天记录；用完删掉。
- `--domain all` 是**增量授权**，不会丢掉已有 scope。
- 授权完成后**必须实测一次真实 user API**（如 `lark-cli drive files list --as user` 返回 `ok: true`），只看 status 不算验收。
- 想缩短/放宽单次时长做不到 —— 别答应用户"把有效期改长"，只能改成滚动续期。
