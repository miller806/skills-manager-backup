---
name: agent-skill-library-ops
description: Use when maintaining the skills-manager library or presets.
---

# Agent 技能库维护（skills-manager）

管理本机 skills-manager 的集中技能库、preset（旧的 "scenario"）划分、tag、以及向各 agent 目录的部署。用户说「维护 skills-manager / 调整 preset / 收编技能 / 打 tag / 这个技能该归哪」时走这里。

## 先认路（一次看清，别猜）

```
应用      /Applications/skills-manager.app  (GUI，长驻，持有锁)
CLI       ~/.skills-manager/bin/skills-manager-cli  (与 app 同版本；存在 .version 戳才可信，
          戳在无 bin 或 bin 无戳 = BRIDGE_BROKEN，让用户开一次 app 重发布，别去找别的副本)
集中库    ~/.skills-manager/skills/        ← 就是一个 git 仓库，remote 为 GitHub 备份仓库；
          app 每次改动自动 commit "auto backup"（Author: skills-manager）
数据库    ~/.skills-manager/skills-manager.db  (WAL；.db-wal 涨到几 MB 属正常，不是故障)
JSON 镜像 ~/.skills-manager/skills/.skills-manager/{scenarios,skills,scenario-skills}/
          preset 元数据与技能归属的 git 可版本化副本，schema_version=1
锁        ~/.skills-manager/.skills-manager.lock  内含 pid / operation / start_time
无关      ~/skills/  是早期遗留空目录（只有 find-skills + .skills_store_lock.json），不是库
```

## 巡检顺序（全部只读，一律加 `--json`）

```bash
SM=~/.skills-manager/bin/skills-manager-cli
$SM --json repo status                 # 库路径、技能/preset 数
$SM --json presets list                # 名称/描述/图标/skill_count
$SM --json agents list                 # 已装 agent、skills_dir、enabled
$SM --json skills list                 # 每个技能的 tags / preset_ids / deployed_to / source_type
cd ~/.skills-manager/skills && git status --short && git log --oneline -15   # 有无未提交/未推送
```

再补三张只有 SQL 能一次问清的视图（查询语句见 `references/preset-audit-queries.md`）：preset→技能明细、无 preset / 无 tag 的技能、库目录与 DB 行是否一一对应、每个 agent 实际部署了多少目标。

最后核对锁：`cat ~/.skills-manager/.skills-manager.lock` —— app 在跑（`operation=check skill update` 等）时不要做写操作。

## 三个状态必须分开说（最大的坑）

| 状态 | 看什么 | 别拿它当 |
|---|---|---|
| 库里有没有 | `skills` 表 / `skills list` | 不等于 agent 能用 |
| preset 成员 | `scenario_skills` / `preset_ids` | 只是组织，**不动任何 agent 目录** |
| 部署 | `skill_targets` 表 / `deployed_to` / `skills status` | 这才是 agent 真能看到的 |

- `presets current` 返回的是**旧独占模型**的 active preset，**不代表真实部署**。真实部署是加法式：多个 preset 同时生效。判断「现在生效的是什么」要数 `skill_targets`（例如 17 个目标 = 开发流程 14 + 技能管理 3），不要照抄 `presets current`。
- 改 `presets add-skill/remove-skill` 之后必须再 `presets deploy` / `skills deploy --agent` 才会落到 agent 目录；反过来 `presets deploy/undeploy` 不改成员。
- 部署模式是 **symlink**（agent 目录里指向集中库），所以集中库里的改动立即对所有 agent 生效；agent 目录里非 symlink 的同名目录是「散装技能」，不受管理，也不在 `deployed_to` 里。

## 新装技能后的收尾三件套（`skills install` 之后必做）

新装进库只等于「库里有没有」，agent 里什么都还看不到。按顺序补齐：

```bash
SM=~/.skills-manager/bin/skills-manager-cli
$SM --json skills tag add <name> <tag>            # 1. 打 tag（同一上游一个 tag，如 awesome-copilot / superpowers）
$SM --json presets add-skill "S·<域>" <name>      # 2. 归 preset（不加就永远不被 deploy）
$SM --json skills deploy <name> --agent claude_code --dry-run   # 3. 先 dry-run 再真 deploy，逐 agent 做
```

- 部署目标默认跟同 preset 的其他成员对齐（例：S·开发流程 全是 claude_code/codex/pi 三个），别只部署一个。
- deploy 前查 `ls -la <agent>/skills | grep <name>`**有没有同名真目录**——有会报 `TARGET_CONFLICT`，要先按 adopt 章节的办法处理。
- ⚠️ **`presets add-skill` 会重排该 preset 全体成员的 `sort_order`**，`git status` 里因此出现十几条 `scenario-skills/*.json` 改动，diff 只有 `sort_order` 变化——这是正常副作用，不是 JSON/DB 漂移，别去修。
- 顺手看下 preset 描述是否还概括得住新成员（`presets update <ref> --description ...`），描述要名词短语串接、不带「用于」。

## 「我不需要了」的两种意思 —— 拆 preset ≠ 停止部署（常见误判）

用户说「X 在大部分情况下我不需要」时，先分清他要哪个：

| 诉求 | 动作 | 效果 |
|---|---|---|
| 只是不想让它混在别的 preset 里 | `presets remove-skill` + `presets create/add-skill` | 只改组织，**agent 目录里的 symlink 一个不少** |
| 真的不想让 agent 看到 | 上面的 + `skills undeploy <names...> --agent <a>` | 删 symlink 与 `skill_targets` 行 |

- 拆 preset 而没 undeploy，用户下次用会发现技能还在，等于没做。本次教训：13 个 superpowers 从 `S·开发流程` 拆到新 preset 后仍全量部署在 claude_code/codex/pi，补跑 undeploy 才真生效。
- `presets undeploy <preset>` 是「清掉该 preset 已部署的 pair」，同样不动成员；要留着成员以备将来再部署，用 `skills undeploy` 逐个技能更可控。
- 删前先 `--dry-run` 看 pairs 数；删后回查 agent 目录残留条数，别只看返回 ok。
- 库里的技能内容**不删**，只去掉部署——用户临时想用时一条 `skills deploy` 就回来。

## preset 的 sort_order 不能通过 CLI 改

`presets create` 新 preset 的 `sort_order` 恒为 **999**（哨兵值），而 `presets create/update` 都没有 `--sort-order`/`reorder`/`set-order` 子命令（报 `unrecognized subcommand`）。排序只能由 GUI 的 `reorder_presets` 命令做。**不要为这个去手改 sqlite `scenarios.sort_order` 或镜像 JSON**（会漂移）；报告里提一句「排序请在 app 里拖动」即可。

## 判断「要不要更新」——只用 `skills update`，别用 `check`

`skills check` 在本机对**所有**来源（git 与 skillssh 都算）恒返回 `update_status=unknown`：它只读库里的 `remote_revision` 字段，而这个字段从来没人填，所以永远比不出结果。加 `--force`、挂代理、看日志都一样，日志里连一次网络请求都不会出现。别在这条路上浪费时间自建 `git ls-remote` 比对——`update` 本来就做了这件事。

```bash
export HTTPS_PROXY=http://127.0.0.1:10808 HTTP_PROXY=http://127.0.0.1:10808   # Clash Verge 的 mixed-port
SM=~/.skills-manager/bin/skills-manager-cli
$SM --json skills update --all          # 真连远端；55 个技能约 4-6 分钟
tail -3 ~/Library/Logs/com.agentskills.desktop/skills-manager.log   # TLS 失败(-9806) = 没走代理
```

- 走代理是**必须**的：没有 `HTTPS_PROXY` 时 Git 源会直接 TLS 握手失败，被记成 `unknown` + `last_check_error`。CLI 自己不会读 Clash 的系统代理设置。
- 一次 `update --all` 是**写操作**（会改库内文件与 `source_revision`），跑之前先打快照：`tar czf ~/skills-manager-backups/pre-update-$(date +%Y%m%d-%H%M%S).tar.gz skills-manager.db* skills`。
- 跑完看 `SELECT update_status, COUNT(*) FROM skills GROUP BY update_status;` 应该是全 `up_to_date`。
- `refreshed:false` 且无 `error` = 已是最新；`refreshed:true` = 这次真拉取了新内容。

### `Path ... does not exist in the repository` 的修法

这是 `source_subpath` 里存了 **Windows 反斜杠**（`cli\assets\skills\brand`，早年从 Windows 录入）。仓库里目录好好的，只是路径分隔符不对。用 `set-source` 就地改，它会保留 id / tag / preset 归属 / 部署关系：

```bash
$SM --json skills set-source <name> --git-url <repo> --subpath "cli/assets/skills/brand" --dry-run   # 先看 content_changed
$SM --json skills set-source <name> --git-url <repo> --subpath "cli/assets/skills/brand"           # content_changed=false 才能直接做
$SM --json skills check <name>                                                                     # 确认转 up_to_date
```

- 不带 `--force` 时 `content_changed=true` 会被拒（正常，是保护）。拒绝时先按下面的安全审查比对差异，确认无恶意再 `--force`。
- `--force` 会整目录从上游覆盖**且没有 held_back_removals 保护**，只在「已亲自比对过差异」后用。它会顺带把上游的可执行位带过来，`git status` 里出现 `old mode 100644 / new mode 100755` 属正常。
- 一次能查出所有反斜杠行：`SELECT name, source_subpath FROM skills WHERE source_subpath LIKE '%\\%';`

## 更新前的安全审查（必做，不可跳）

任何 `skills update` / `set-source --force` 应用新内容之前，先扫一遍**上游将带进来的那份代码**（不是库里旧的）。完整脚本与判读标准见 `references/update-security-review.md`。

核心三条：
1. **先比对再更新**：逐文件比对上游 clone 与库内副本，列出新增/删除/改动文件，人工看 diff——不看的更新不叫审查。
2. **高危模式**：`curl|bash`、`base64 -d|sh`、`/dev/tcp/`、`nc -e`、`security find-password`、硬编码 `sk-`/`ghp_`/`AKIA` 密钥、`ignore previous instructions` 式提示注入。命中任一即停手报告。
3. **误报要判读，不要直接判死**：本项目已确认的良性命中——`baoyu-post-to-wechat` 的 `api.telegram.org`（`TELEGRAM_BOT_TOKEN` 显式配置才触发的登录二维码推送）、`~/.ssh/id_ed25519`（远程发布配置项，注释示例）、`baoyu-wechat-summary` 的 `sudo`（全是排障文档，技能正文明确「绝不替用户跑 sudo」）。判读结论要写进报告。

## preset 命名与描述规范（本用户已定型，沿用）

- **类型前缀**：`S·` = 场景可交付（做出来的东西能交出去）、`T·` = 工具对接（外部平台/CLI）、`M·` = 元技能（管理技能体系本身）。
- **名称**：中文名词短语，2–4 字意群，不加动词（`界面设计` 而不是 `App UI 设计`；`内容发布` 不是 `内容加工与发布`）。
- **描述**：一串短名词短语用顿号/箭头串起来，直接写「包含什么」，**不要**「用来…」「用于…」「主动维护…时用：」这类前置说明。
- `sort_order` 按 S→T→M 顺排，0 起连续；不要留 999 之类的哨兵值。
- 同一技能允许挂在多个 preset（例：`design`/`brand`/`design-system` 同挂界面设计+文档演示+宣传图），这是有意为之，不是重复。

## 改库的正确路径

0. **想动 git 历史先在沙箱演练，且先 `git remote set-url`**：`git clone ~/.skills-manager/skills /tmp/x` 出来的副本，`origin` 指向的是**本机真库**而不是 GitHub。在副本里 `git push` 会把分支推进真库（分支名照样建出来），而不是推到远端。演练前必须：
   ```bash
   git bundle create /tmp/repo.bundle --all        # 快照，避免依赖网络
   git clone /tmp/repo.bundle /tmp/work && cd /tmp/work
   git remote set-url origin git@github.com:miller806/skills-manager-backup.git
   ```
   或干脆用 `--bare` 副本当演练远端（`git clone --bare src fixed.git`），全程离线、更安全。
1. 成员/命名/描述：`presets update <ref> --name/--description/--icon`、`presets add-skill/remove-skill`、`skills tag add/set/rename`。
2. **绝不直接手改** `~/.skills-manager/skills/.skills-manager/scenarios/*.json` 或 sqlite 表：JSON 是 DB 导出的镜像，单边改会让两边漂移（下次 app 写回时被覆盖或产生冲突）。要核对就用脚本逐字段对比 JSON 与 `scenarios` 表。
3. 批量前先 `--dry-run`；`--force` 永不代用户加（尤其 `set-source --force` 会整目录替换，且没有 held_back_removals 保护）。
4. 人工改动想留痕时，commit message 用 `<域>: <做了什么>` 风格（如 `presets: fold X into Y`、`tags: mark Z overlap`），与 app 的 `auto backup` 区分开。
5. 收尾：`git status` 干净 + `git log origin/main -1` 与本地 HEAD 一致，才算同步完；app 之外不要自己 push 到别的分支。

## 已知遗留，每次报告时提一句

- `agents list` 里 `hermes` 的 skills_dir 固定指向 `~/.hermes/skills`（default profile）；本 profile（h-ops）用的是 `~/.hermes/profiles/h-ops/skills`，要纳入管理必须 `agents add-custom` 单独加，别 enable 内置项。
- agent 目录里的非 symlink 目录（`~/.claude/skills` 常见几十个：ego-browser、kimi-webbridge、各类 lark-*）是未托管散装技能，属于「要 `skills adopt` 收编还是保持私有」的待决议项，**不要自作主张批量 adopt**；adopt 后是 `local` 源，`update` 失效，需再接 `skills set-source`。
- 升级/回滚前的库快照在 `~/skills-manager-backups/`。

## 收编未托管技能（`skills adopt`）——先把目录体系看清楚

`~/.claude/skills` 里 50 个条目里只有少量是真正自由的：

```
symlink → ~/.skills-manager/skills/xxx     已托管，不要动
symlink → ~/.agents/skills/xxx            他工具托管，**不能 adopt**
真目录                                     可收编候选
```

- **`~/.agents/skills/` 是整个分发体系的上游**：52 个技能 + `.skill-lock.json`（记录每个技能的 `source`/`sourceType`/`sourceUrl`）。其中 28 个 lark-* 来自 `open.feishu.cn/.../.well-known/agent-skills/*.tar.gz`（lark-cli 安装），22 个来自 `jimliu/baoyu-skills`、`vercel-labs/skills`。
- **lark-* 和 ego-browser 永远不收编**：它们的升级链在 lark-cli `/ ego-lite 手里，收编后在 `~/.claude/skills` 会产生双份，两边各自更新就会冲突。
- **`agent-reach` 也不收编**：它的 SKILL.md 是模板渲染产物（上游 `agent_reach/skill/SKILL.md` 带 `{{VERSION}}`，由 `agent-reach install` 写入真实版本号），且它自带 `agent-reach skill --install` 管理注册。直接接 git 源会拿到未渲染的模板。它自己的升级用 `agent-reach check-update`（pipx 装，`pipx upgrade agent-reach`）。

### 收编 h-ops（多 profile）整批散装技能（已跑通，照这个顺序）

1. `agents add-custom hermes-h-ops --path ~/.hermes/profiles/h-ops/skills --name "Hermes (h-ops)"` —— 内置 `hermes` 指向 default profile，别 enable 它。
2. **逐个技能目录 adopt**（`skills adopt <单个技能目录>`）：整批 adopt agent 根目录不可行——h-ops 技能在分类子目录里（`devops/x`），且会把 symlink 一起收进来。遍历时用 `os.walk` 递归找 SKILL.md，过滤 `islink`。
3. adopt 返回的 `name` 可能被改写（`audiocraft` → `audiocraft-audio-generation`、`segment-anything` → `segment-anything-model`），后续操作按返回名。
4. 按域新建 preset（`presets create` + `add-skill`），别硬塞进已有的。daemon/知识类本地技能可以只入库不归 preset。
5. **`skills undeploy --agent` 不删真目录**：对真目录它返回 `changed_pairs:0` 且静默成功，因此写不进 `skill_targets`，`deploy` 也等于没做。必须手动换链：
   ```bash
   mv <真目录> ~/.hermes/profiles/<p>/skills/.archive/symlink-backup-<date>/
   ln -s ~/.skills-manager/skills/<name> <原路径>
   $SM --json skills deploy <name> --agent <p>
   ```
   最后回查：`find <agent>/skills -type l -lname '*.skills-manager/skills/*' | wc -l` 与 `skill_targets` 行数对得上，且没有残留的真目录。

### 收编流程

```bash
$SM --json skills adopt ~/.claude/skills --dry-run     # 列候选：但包含 symlink！
```

上面这个命令的 `candidates` **会把软链目录也当成 ready**，必须自己用 `os.path.islink` 过滤。真正可收编的只有真目录。

收编后的两个坑，按顺序走：

1. **adopt 默认 `source_type=local`，`update` 永久失效**。有公开仓库的立即接源（`content_changed=false` 才能不 `--force`）：
   `$SM --json skills set-source <name> --git-url <repo> --subpath "<子路径或空串>"`
2. **原真目录会阻挡部署**（`TARGET_CONFLICT: is not managed by Skills Manager`）。确认中央库与原目录内容一致后：备份原目录 → `rm -rf` → `ln -s <централ路径> <agent路径>` → 再 `skills deploy <name> --agent <tool>`，才能写上 `skill_targets`。

收尾：`git add` 新增的技能目录与 `.skills-manager/skills/<uuid>.json` 镜像，commit message 用 `skills: adopt ...`。

### 本机已定型的收编结论（2026-11，h-ops）

- **Hermes 封装的技能一律不收编，与哪个 profile 无关（用户硬标准）**。判定「Hermes 生态」要看五条，命中任一即排除：① 技能名在 `~/.agents/.skill-lock.json`（lark-cli / baoyu-skills / vercel 装的都在这，全 profile 共用）；② 在任一 profile 的 `.bundled_manifest`；③ SKILL.md 的 `author: Hermes Agent`；④ `version:` + `metadata.hermes`；⑤ **frontmatter 无 `author` + 带 `metadata.requires`（如 `bins: ["lark-cli"]`）或 `metadata.openclaw`，且实体是 `.agents/skills/<name>` 的软链** —— `lark-*`（29 个）和 `baoyu-*`（22 个）就是这一类。
- ✅ **`lark-*` / `baoyu-*` 的处置已定（用户 2026-11 拍板「维持现状」）**：正本是 `~/.agents/skills/<name>`，由 lark-cli / baoyu-skills 统一更新；各 profile（`~/.hermes/skills`、`~/.hermes/profiles/*/skills`）与 `~/.claude/skills`、`~/.codex/skills`、`~/.pi/agent/skills` 里全是指向它的软链。这是**一份正本 + 处处软链**的结构，本身已被统一管理。**不要收进 skills-manager**，否则会出现 `.agents` 正本和库副本两个更新源，写了一份另一份不动。扫描弹窗里忽略它们即可。
- ⚠️ **别只看 `metadata.hermes` 判封装**：我们自己在 h-ops 写的运维技能（`ssh-ops-mcp`、`public-exposure-hardening`、`apisix-gateway-ops`…）也带 `metadata.hermes.tags`，但它们是真自己的东西，必须收。反过来 `baoyu-*` / `lark-*` 只带 `metadata.openclaw` 或 `metadata.requires`，不带 hermes —— 用 `metadata.hermes` 做唯一判据会两头都判错。
- ⚠️ **「作者不是 hermes」不构成收编理由**：`lark-*` / `baoyu-*` 的 frontmatter 根本没有 `author` 字段（只有 `version` + `metadata.requires`/`metadata.openclaw`），用作者判定会把它们全判成“该收”。要看的是**谁在维护这份文件**（`.agents` + 对应 CLI），不是有没有写过作者名。
- 2026-11 按此共撤出 49 个（13 个 h-ops 侧 hermes 封装 + 22 个 baoyu-* + 7 个 lark-* + kanban/ssh-ops-mcp/public-exposure-hardening/requesting-code-review/systematic-debugging/test-driven-development/find-skills/research-tools），库从 90 降到 42。
- **撤退顺序（实测踩过坑）：删库目录会让 agent 侧指向它的软链立刻悬空**，Hermes 直接不加载那个技能，而且这类断链在 `os.walk` 里表现为“技能消失”，很容易误判成别的问题。删库前先 `ls -l` 找出指向库的软链并改回真目录，删完必须扫一遍：`find <agent>/skills -type l ! -exec test -e {} \; -print`（应为空）。2026-11 就漏了两个（`public-exposure-hardening`、`ssh-ops-mcp`），事后补回。
- **分类子目录不需要为收编而拍平**：agent 目录可以是「分类目录 → 软链 → 库根」，Hermes 递归加载。
- 收编后**必须再 commit + push 一次**，否则别的机器与快照里没有这些技能目录（app 的 auto backup 有时不覆盖新目录）。

### 收编后再撤销（回滚成散装）的正确顺序

撤出时要**先还原真目录、再删库**，顺序反了会丢内容，且软链会悬空：

1. `skills undeploy <names> --agent claude_code|codex|pi`（hermes-h-ops 那条撤不掉真目录，忽略）。
2. 每个技能：`rm <agent 目录里的软链>` → `mv <备份目录的真目录> <原路径>`（备份按 `<分类>-<名>` 或 `sd-<名>` 命名，逐条核对别套错前缀）。备份目录可能被后来覆盖，移动前先 `ls` 确认。
3. 校验 `os.path.islink()` 为 False 且 `SKILL.md` 在 → 再 `skills remove <names> --yes`。
4. **删库后再扫一遍断链**（`find <agent>/skills -type l ! -exec test -e {} \; -print`）—— 漏还原的软链会在库目录消失后悬空，Hermes 直接不加载那个技能。
5. 顺手清理库部署时在 agent 目录根部多建的**同名顶层软链**（分类目录里已有一份，留着就是重复技能）。
6. 空 preset（成员被清空）用 `presets delete <name> --yes` 收掉。

## 远端可能被别的机器改过 —— **绝不用 git 命令合并/推送**

库是多机共用的：另一台机器会自动 `auto backup` + `sync: merge remote skill changes` 推到 `origin/main`。

**铁律：不要 `git pull` / `git merge` / `git rebase` 这个仓库，只用 `skills-manager-cli git pull|push|commit`。**

原因：app 的同步校验会扫 incoming 历史里的每一个 merge 提交，要求它带尾注 `Skills-Manager-Protocol: 2`（app 自己 sync 生成的 merge 才有）。用 `git pull --no-rebase` 手工合成的 merge 不带这个尾注，会**毒化共享历史**，导致其他所有设备同步时报：

```
sync blocked: an old skills-manager version performed a line-level merge on another device
— commit(s) <sha> (<device>, <time>). Upgrade that device and retry,
or use the recovery flow (a safety snapshot is taken first)
```

正确做法：

```bash
SM=~/.skills-manager/bin/skills-manager-cli
export HTTPS_PROXY=http://127.0.0.1:10808 HTTP_PROXY=http://127.0.0.1:10808
$SM --json git pull      # app 的 sync 逻辑，会自己生成带协议尾注的 merge
$SM --json git push
```

- 只有**内容**提交（`skills:`/`presets:`/`tags:` 这类）可以手工 `git commit` + `git push`，不涉及合并就无毒。
- `git push` 被拒时，**别**跑 `git pull`，改跑 `$SM git pull` 再重推。
- 检查历史里有没有毒 merge：
  ```bash
  cd ~/.skills-manager/skills && for c in $(git log --merges --format=%h); do
    printf "%s proto=%s %s\n" $c "$(git cat-file -p $c | grep -c Skills-Manager-Protocol)" "$(git log -1 --format=%s $c)"; done
  ```
  `proto=0` 的就是毒源（历史遗留的老提交可以不管，只有落在别人 fetch 范围内的才会报错）。
- **`reclone` 只能从 GUI 触发**：`skills-manager-cli git clone` 在已有仓库时会直接拒绝（`Skills directory is already a git repository`），CLI 也没有 `reclone` 子命令。app 内部的 `git_backup_reclone` 做的是「打快照 → 旧 `.git` 挪成 rescue 副本 → 重新 clone」三步，所以纯跑 `git clone` 复现不出来。
- **报错的 "Upgrade that device" 可能无路可走**：先查 `https://api.github.com/repos/xingkongliang/skills-manager/releases` 与本地 `--version`；已是最新版时这条建议无效，只能走重克隆或重写历史。
- 已毒化历史的完整处置流程（复现、验证内容零差异、重写 merge、force-push 与否的取舍）见 `references/git-sync-repair.md`。

推完必须核对 `git log -1` 与 `git log -1 origin/main` 同一个 hash 才算同步完。

- `$SM git pull` / `git push` 的返回体里 `ahead`/`behind` 就是当前差异计数，`upstream_health` 必须为 `healthy`；成功 push 后两者都归 0。
- 走 SSH remote（`git@github.com:...`）时**不必**设 `HTTPS_PROXY` 也能通；只有 skillssh 拉取内容才需要代理。

**重写/强制推送的唯一例外 —— `git reset --hard` 可以用**：把本地指针移到远端已有提交上不产生 merge 提交，因此不造毒；前提是先 `git rev-parse HEAD^{tree} origin/main^{tree}` 两边相同（内容零差异）。任何产生 merge 提交的命令依旧禁止。full 流程见 `references/git-sync-repair.md`。

## 报告格式（本用户偏好）

代码块 + 对齐列表，不用表格、不用图。分块：环境 → preset 现状（带 skill_count 与 active 标记）→ 库统计（来源/tag/孤立技能）→ 部署现状（每 agent 目标数）→ ⚠️ 待决议项单独列出（编号，一行一条）。待办的破坏性动作只给建议，等用户点名再做。
