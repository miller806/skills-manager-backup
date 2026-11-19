# 毒 merge 的处置：从复现到 force-push

场景：`skills-manager-cli git pull` 报

```
sync blocked: an old skills-manager version performed a line-level merge on another device
— commit(s) <sha> (<device>, <time>). Upgrade that device and retry,
or use the recovery flow (a safety snapshot is taken first)
```

## 1 先确认毒源，别急着重写

```bash
cd ~/.skills-manager/skills
git fetch origin
git rev-list --left-right --count HEAD...origin/main      # 先确认本地没领先/落后
git log -oneline -8; git log --oneline -3 origin/main
git reflog -12                                           # 找到 "pull --no-rebase ... Merge made by the 'ort' strategy"
```

判定：报错里点名的那个 sha 在**本地历史**里存在（`git merge-base --is-ancestor <sha> HEAD`）= 本机才是毒源，其他设备只是受害者。报错文案里的 device 名是「当初造毒的那台」，不等于你现在操作这台。

逐个 merge 查协议尾注：

```bash
for c in $(git log --merges --format=%h HEAD); do
  printf "%s proto=%s | %s | %s\n" $c "$(git cat-file -p $c | grep -c Skills-Manager-Protocol)" \
    "$(git log -1 --format='%ad' --date=short $c)" "$(git log -1 --format=%s $c)"
done
```

- `proto=1` = app 自己 sync 出来的，正常。
- `proto=0` = 手工 merge（`git pull --no-rebase`、`git merge`、GUI 合并），**这就是毒源**。
- 老历史里很早的 `proto=0` 可以不管（不在别人 fetch 范围内就不触发）；只要管**落在同步窗口内**的那个。

「Upgrade that device」通常无路可走：本机 `--version` 与 GitHub releases 最新版一致时这条建议无效。

## 2 证明那个 merge 是内容空操作

重写历史的合法性全押在这一步，必须逐 blob 核对，不能只看 `diff --stat`：

```bash
BAD=<proto=0 的 sha>
for p in $(git log -1 --format=%P $BAD); do echo "parent $p tree $(git rev-parse $p^{tree})"; done
echo "merge tree $(git rev-parse $BAD^{tree})"
git diff --numstat $(git log -1 --format=%P $BAD | cut -d" " -f1) $BAD | awk '$1!=0||$2!=0'   # 应无输出
git diff --raw $BAD^1 $BAD | grep -c '^:.*[.][.][.][.][.][.][.][.][.][.] ' || true              # 只有 mode 变化
```

若 merge tree 完全等于某个父的 tree，且 numstat 全 0，则丢掉它不影响任何内容——只丢掉一个「合并动作」。

## 3 沙箱重建历史（全程离线）

```bash
SB=~/.hermes/profiles/h-ops/cache/scratch/sm-forcepush; rm -rf $SB; mkdir -p $SB
cd ~/.skills-manager/skills && git bundle create ~/skills-manager-backups/pre-forcepush-$(date +%Y%m%d-%H%M%S).bundle --all
cd $SB && git clone --bare ~/.skills-manager/skills repo.git          # 自动 origin = 本机真库（别直接 push！）
# 前面手工重写好的历史放在一个 fixed.git 里（含 11dd8f3b 这类带 protocol 尾注的 merge），导入：
git -C repo.git fetch -q <fixed.git 路径> 'refs/heads/main:refs/heads/fixed'
cd $SB && git clone -q -b fixed repo.git work && cd work
# 把 fixed 之后真库新增的提交逐个重放（用 cherry-pick，不用 merge）
git cherry-pick <真库 HEAD 的 sha>
```

验收三条，缺一不可：

```bash
git rev-parse HEAD^{tree}                       # 必须等于真库 HEAD^{tree}
git diff --stat HEAD <真库HEAD>                 # 必须空
git log --merges ... | grep proto=0              # 只剩历史遗留的老 merge
```

重建带尾注的 merge 时，正文尾注必须是独立一行 `Skills-Manager-Protocol: 2`，不是 footer 拼在消息里。

## 4 模拟落后设备（证明别人能吃下新历史）

这里有个**反直觉的结论，实测过**：

| 设备本地状态 | 重写后 `skills-manager-cli git pull` |
|---|---|
| 停在毒 merge **之前**（如 436805c1） | ✅ 成功，`upstream_health=healthy`，自动 fast-forward |
| 停在旧 `origin/main` HEAD（本地历史里含毒 merge） | ❌ 仍报 `sync blocked: commit(s) <毒sha>` |

原因：重写后的新历史不含毒 merge，而停在旧 HEAD 的设备本地**仍带着**它，merge-base 落在毒 merge 之下，校验扫范围内又撞上。所以**只有 history 里含毒 merge 的设备需要重克隆**，落后但干净的设备 pull 就够。

沙箱复现：

```bash
cd $SB && git clone -q --bare work remote.git && git -C remote.git branch -M fixed main   # 假远端
cd $SB && git clone -q repo.git dev && cd dev && git checkout -q -B main <毒merge之前的sha>
git remote set-url origin $SB/remote.git && git fetch -q origin
~/.skills-manager/bin/skills-manager-cli --json git --skills-root $SB/dev pull
```

`--skills-root` 指向沙箱副本，这样 CLI 的校验逻辑只读沙箱，不碰真库。

## 5 真机执行（顺序不可换）

```bash
# a) 确认远端还停在旧 sha（防止别人刚推过）
cd $SB/work && GIT_SSH_COMMAND='ssh -o BatchMode=yes' git ls-remote github refs/heads/main
# b) 用 --force-with-lease 而不是 --force，钉死期望的旧 sha，别人抢先推就会被拒
git push --force-with-lease=refs/heads/main:<旧sha> github HEAD:refs/heads/main
# c) 真库 fetch 后先比 tree，再移指针
cd ~/.skills-manager/skills && export GIT_SSH_COMMAND='ssh -o BatchMode=yes'
git fetch origin                                                # 会显示 forced update
git rev-parse HEAD^{tree} origin/main^{tree}                    # 必须相同
git reset --hard origin/main
git branch -D <误建的救援分支>
```

**为什么这里可以用 `git reset --hard`**：它只是把本地指针移到远端已有提交上，**不产生 merge 提交**，所以不会造毒；前提是两边 tree 哈希相同（内容零差异，不丢工作区）。反过来任何会造 merge 提交的操作（`git pull`/`merge`/`rebase`）依然禁止。

## 6 收尾核验

```bash
SM=~/.skills-manager/bin/skills-manager-cli
git rev-parse HEAD; git rev-parse origin/main            # 同一个 sha
git status --short | wc -l                               # 0
git ls-remote origin | grep -v refs/tags/                # 只有 refs/heads/main，没有多余 refs/*
$SM --json git status                                    # upstream_health=healthy, ahead=behind=0
export HTTPS_PROXY=http://127.0.0.1:10808 HTTP_PROXY=http://127.0.0.1:10808
$SM --json git pull                                      # no-op，仍 healthy
```

`git push --all`/`--mirror` 会把 `refs/skills-manager/*` 同步 refs 也推上去，需要 `$SM git prune-sync-refs` 清掉——所以只推 `HEAD:refs/heads/main`。

## 保险位置

```
~/skills-manager-backups/pre-forcepush-<ts>.bundle       force-push 前全量（--all，含 tags）
~/skills-manager-backups/fixed-history-<ts>.bundle       重写后的历史
~/skills-manager-backups/git-before-reclone-<ts>.tar.gz  重克隆/重写前的 .git 全量
```

回滚：`git reset --hard <bundle 里的旧 sha>` + force-push 回去；tags 在 bundle 里一并存了，实测重写前后 17 个 tag 指向一致。
