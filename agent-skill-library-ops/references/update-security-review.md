# 技能更新前的安全审查

在 `skills update` / `skills set-source --force` 把上游新代码带进库之前用。目标：确认这次更新没有顺手引入后门，并把判断依据留存下来。

## 步骤 1：拿到上游那份内容

```python
import os, subprocess, shutil
SCRATCH = os.path.expanduser("~/.hermes/profiles/h-ops/cache/scratch")
REPOS   = os.path.join(SCRATCH, "upstream-repos")
os.makedirs(REPOS, exist_ok=True)

def sync_repo(url):                     # 已有则 fetch，使克隆最新HEAD
    d = os.path.join(REPOS, url.replace("https://github.com/", "").replace("/", "__"))
    if os.path.isdir(os.path.join(d, ".git")):
        subprocess.run(["git", "-C", d, "fetch", "--depth", "1", "origin"], timeout=180)
        subprocess.run(["git", "-C", d, "reset", "--hard", "FETCH_HEAD"])
    else:
        subprocess.run(["git", "clone", "--depth", "1", "--quiet", url, d], timeout=300)
    return d
```

私有/大仓偶尔 clone 失败，重试 2–3 次即可（超时或 TLS 抖动，不是技能问题）。

## 步骤 2：逐文件比对「库内 vs 上游HEAD」

不要只看 SKILL.md——真正的风险在 `scripts/`。按 relpath 建两个 dict，比出新增／删除／内容变化三组，然后对变化文件打 unified diff（`n=2`，只打印前 80 行）。

**注意 `content_changed` 的口径差异**：CLI 报的 `content_changed:true` 可能只来自 `content_hash` 历史字段，而磁盘上的文件逐字节相同（用 `shasum -a 256` 复核）。反过来也要小心：文件内容相同但**权限位**变了，git 会记成 `old mode 100644 / new mode 100755`。判读时以「文件内容 + 权限位」两条一起看。

## 步骤 3：模式扫描

对库里每个技能的**所有文件**（含 .md、.ts、.mjs、.py、.sh）跑正则，注意要跳过 `.git`。

| 模式 | 标签 | 严重度 |
|---|---|---|
| `curl … \| (ba)sh` / `wget … \| (ba)sh` | 远程下载即执行 | 9 |
| `base64 -d … \| sh` | 混淆后执行 | 10 |
| `nc -e` / `/dev/tcp/` / `bash -i >&` | 反弹 shell | 9 |
| `sk-[A-Za-z0-9]{24,}` / `ghp_…` / `AKIA[0-9A-Z]{16}` | 硬编码密钥 | 10 |
| `security find-(generic\|internet)-password` | 读钥匙串 | 8 |
| `\.ssh/id_rsa` / `\.aws/credentials` | 读本机凭据 | 8 |
| `ignore (all )?(previous\|prior) instructions` | 提示注入 | 8 |
| `rm -rf [~/]` | 危险删除 | 8 |
| `sudo` | 权限提升 | 4 |

严重度 ≥8 必须逐条人工判读后才放行；4 分的 `sudo` 通常只是排障文档。

## 步骤 4：外联域名盘点

对含可执行脚本的技能，抽出所有 `https?://host`，与常见外传/临时投递域名比对：`pastebin.com`、`transfer.sh`、`0x0.st`、`webhook.site`、`requestbin`、`ngrok.io`、`api.telegram.org`、`discord.com/api/webhooks`、`t.me`、`bit.ly`。

出现不等于恶意——要看**触发条件**。判读时回答：
- 域名是不是该技能声明的业务依赖？（如发微信文章就少不了微信域名）
- 触发是否需要用户显式配置 env（`TELEGRAM_BOT_TOKEN` 之类）？还是无条件静默发送？
- 发送内容是什么？（登录二维码给用户本人 = 合理；把 `process.env` 打包上传 = 恶意）

## 步骤 5：留痕

审查结论写进汇报，格式一行一条：技能名 → 命中 → 判读（良/可疑/恶意）→ 依据。可疑或恶意一律**不应用更新**，把 diff 贴给用户决定。

## 已确认的良性命中（不必每次重扫惊慌）

- `baoyu-post-to-wechat`：`api.telegram.org/sendPhoto` —— 仅在 `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` 都存在时，把登录二维码推给用户自己（`if (!botToken || !chatId) return;`）。
- `baoyu-post-to-wechat`：`~/.ssh/id_ed25519` —— 远程发布配置项与单测样例路径，注释状态，不是读取行为。
- `hyperframes-cli`：`~/.aws/credentials` —— 文档里列举「部署需要哪些凭据」，不是读取行为。
- `baoyu-wechat-summary`：全部 `sudo` 命中都在排障文档中，且正文明确写「绝不自动安装、绝不替用户跑 sudo」。
