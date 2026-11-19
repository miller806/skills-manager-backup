# Tabby 配置同步：覆盖范围与语义

来源：`tabby-settings/src/services/configSync.service.ts`、`tabby-core/src/services/config.service.ts`。

## 上传/下载的是整份 config.yml

```ts
private async readConfigDataForSync () {
    const data = yaml.load(await this.platform.loadConfig()) as any
    delete data.configSync          // 只剔除同步设置自身，防递归
    return data
}
```

没有字段级过滤：`config.yml` 里有什么就传什么。

| 同步 | 不同步 |
|---|---|
| profiles（SSH/串口/Telnet/本地 shell：主机、端口、用户、启动命令、env、代理、跳板） | `configSync`（host/token/configID，防递归） |
| groups（分组结构与排序） | 会话内容：滚动历史、打开的标签页 |
| plugins（插件清单 + 各插件设置） | 本地文件：日志、插件缓存、下载物 |
| defaults（默认 shell、字体、滚动缓冲等） | |
| hotkeys / appearance / vault（可单独排除） | |

## OPTIONAL_CONFIG_PARTS：可保留本机值的三项

```ts
const OPTIONAL_CONFIG_PARTS = ['hotkeys', 'appearance', 'vault']
```

上传与下载都会检查 `config.store.configSync.parts[part]`：开关关掉时，用本机/远端的对应值填充，
即该部分不参与覆盖。实际用法：hotkeys 和 appearance 几乎总该排除（键位与屏幕各机不同）。

## autoSync：只下载，60s 轮询

```ts
if (this.isEnabled() && this.config.store.configSync.auto) {
    const cfg = await this.getConfig(this.config.store.configSync.configID)
    if (new Date(cfg.modified_at) > this.lastRemoteChange) { this.download() }
}
await new Promise(r => setTimeout(r, 60000))
```

关键推论：

- **没有自动上传路径**。本机改动要手动 `Upload` / `Upload as a new config`。
- **只比较 `modified_at`，不比对内容**，所以 `PATCH` 前移时间戳是唯一触发手段。
- **无三方合并**：`download()` 直接 `saveConfig(yaml.dump(data))` 整份写回，
  最后上传者赢；两台机器同时改，先改的那份会被覆盖丢掉。

## 加密模式（Vault）会改变存储形状

```ts
private async maybeEncryptConfig (store) {
    if (!store.encrypted) return store
    vault.config = { ...store }
    delete vault.config.vault
    delete vault.config.encrypted
    delete vault.config.configSync
    return { vault: await this.vault.encrypt(vault), encrypted: true, configSync: store.configSync }
}
```

开了加密后，服务端 `app_config.content` 里只剩 `{vault: <blob>, encrypted: true, configSync: …}`。

- 好处：服务器上的备份不含明文密码。
- 代价：密码短语只在本机 vault 里，**服务器没有、官方也没有**。短语丢失 = 这份备份永久报废。
  需要可移植的备份时不要开加密，或用 `Upload as a new config` 额外留一份未加密快照。

## 服务端落库位置

同步内容存 `app_config.content`（TEXT）。排查「到底传上去了什么」可直接查表，
但别从 `.env` 猜 mariadb root 密码（`DB_ROOT_PASSWORD` 是 compose 变量，容器内 `-p` 未必对得上）；
用 `docker exec tabby-web-db mariadb -uroot -p"$DB_ROOT_PASSWORD"` 前提是先确认变量名与镜像初始化参数一致，
更省事的办法是走 API：`GET /api/1/configs` 带 `Authorization: Bearer <config_sync_token>`。
