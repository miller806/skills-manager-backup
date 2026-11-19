# 退役/卸载一个本机依赖（npm 全局包 / brew 包 / MCP 提供者）

适用：判断某软件「用不到了」，要从本机彻底清掉，并且不留会反复报警的残留。
和单纯 `npm uninstall -g` / `brew uninstall` 不是一回事 —— 包管理器只说包没了，不说引用没了。

## 第 0 步：先摸清角色，再决定要不要退役

不要因为「没见过它启动」就断定没用。逐项查：

```bash
# 1. 包在不在、装的什么版本
npm ls -g --depth=0 2>/dev/null | grep <name>
brew list --versions | grep <name>

# 2. 有没有进程在跑（包已删但进程仍存活是常态 —— 二进制被 unlink 后进程不死）
pgrep -fl <name>
ps ax -o pid=,ppid=,etime=,command= | grep <name> | grep -v grep

# 3. 有没有在监听端口
lsof -nP -iTCP -sTCP:LISTEN | grep <name>

# 4. 谁引用它：config / plist / cron / skill 全仓扫
grep -rn "<name>" ~/.hermes/config.yaml ~/.hermes/profiles/*/config.yaml \
     ~/Library/LaunchAgents/*.plist ~/.hermes/profiles/*/cron/jobs.json 2>/dev/null
grep -rln "<name>" ~/.hermes/profiles/*/skills/ 2>/dev/null

# 5. 它是不是某个工具的「二进制提供者」（MCP server 的 command 指向它的 bin/）
```

第 5 条最容易踩：一个看着「只是个网页界面」的包，可能是 7 个 profile 全部 `mcp_servers.*.command` 的来源。删它 = 换整条工具链，得让用户明确同意。

判断「是否真的没人用」的硬证据：数据目录 mtime。`~/.<name>/` 若几周无写入，且端口从未监听，才谈得上退役。

## 第 1 步：备份所有会被改的 config

```bash
BK=~/.hermes/profiles/h-ops/backups/<事情>-$(date +%Y%m%d_%H%M%S)
mkdir -p $BK
cp ~/.hermes/config.yaml $BK/config.yaml
for p in ~/.hermes/profiles/*/config.yaml; do
  n=$(echo "$p" | sed 's|.*/profiles/||; s|/config.yaml||')
  cp "$p" "$BK/profiles__${n}__config.yaml"
done
```

命名带上 profile 名，回滚时能一眼对上是哪个文件。

## 第 2 步：删 config 段落 —— 按缩进吞块，不要按行号

`sed -i '/行号,d'` 在多份 config 上行号各不相同，必翻车。用 Python 按 YAML 缩进结构吞块：匹配 `^(\s+)<key>:\s*$`，然后一直消费**比它更深缩进**的行（内部空行要向前看一行，若下一行仍更深则属于本块），最后把空掉的父键收敛成 `父键: {}`。

```python
import re
PAT = re.compile(r'^(\s+)%s:\s*$' % re.escape('ekko-studio-'))  # 或整个 key

def strip(lines, pred):
    out, i = [], 0
    while i < len(lines):
        m = pred(lines[i])
        if not m:
            out.append(lines[i]); i += 1; continue
        indent = len(m.group(1))
        i += 1
        while i < len(lines):
            ln = lines[i]
            if ln.strip() == '':
                j = i + 1
                while j < len(lines) and lines[j].strip() == '':
                    j += 1
                if j < len(lines) and len(lines[j]) - len(lines[j].lstrip()) > indent:
                    i += 1; continue
                break
            if len(ln) - len(ln.lstrip()) > indent:
                i += 1; continue
            break
    return out
```

删完立刻收敛空父键：`mcp_servers:` 后面直接跟下一个 top-level key 时改成 `mcp_servers: {}`。**不收敛会让 `yaml.safe_load` 得到 `None` 而不是 `{}`**，多数读取方按 dict 用会炸。

## 第 3 步：校验（三件套，缺一不可）

```bash
# a. 残留为零
grep -rn "<name>" ~/.hermes/config.yaml ~/.hermes/profiles/*/config.yaml | wc -l   # 期望 0

# b. 每份都能解析，且关键字段没被误删
/Users/miller/.hermes/hermes-agent/venv/bin/python - <<'PY'
import yaml, glob
for p in ['/Users/miller/.hermes/config.yaml'] + sorted(glob.glob('/Users/miller/.hermes/profiles/*/config.yaml')):
    d = yaml.safe_load(open(p))
    print(p.split('/.hermes/')[-1], len(d), d.get('model'), bool(d.get('cron')))
PY

# c. 结构对不对（`{}` 而不是空）
grep -n -A1 "^mcp_servers" ~/.hermes/config.yaml ~/.hermes/profiles/*/config.yaml
```

b 只 print 不 assert 等于没校验 —— 至少人工对比每条 profile 都输出了相同的 model/discord/cron 形状，条数也不该掉太多。

## 第 4 步：进程与监听收尾

- 已经死掉的（包被删后的残留进程）不用管；活着的先看它父进程是谁 —— 父进程是网关/launchd 的话，进程生命周期由它们管。
- 本机 gateway 跑着的 MCP 子进程，改完 config 后网关会自己 reconcile 并 kill（看 `gateway.log` 的 `MCP servers reconciled with config`），不需要手动 kill，更不要为它重启网关。
- 端口确认：`nc -z -G 2 127.0.0.1 <port>`（macOS 无 `timeout`）。

## 第 5 步：清掉巡检/监控里的残留（最容易漏）

包卸载了，但清单表里那行还在，每天 check 都会拿旧 installed 去比 registry 最新版，永远报一条假更新。

```sql
UPDATE public.software_watch
   SET enabled = false, note = COALESCE(note,'') || ' [已退役]'
 WHERE name = '<包名>';
```

- 用 `enabled=false`（从报告彻底消失），不要用 `policy='skip'`（仍然显示在表里）。
- `seed` 是 `ON CONFLICT DO NOTHING`，不会把它改回来。
- `software_watch_log` 的历史行保留作审计；先查有无外键再考虑删：
  `SELECT ... FROM pg_constraint WHERE contype='f' AND confrelid='public.software_watch'::regclass`。

## 第 6 步：告诉用户哪些依赖它的技能/能力一起失效了

卸载前先问清楚「谁在用它的端点/二进制」，卸载后主动列出失效清单，而不是只报「已卸载」。典型是技能里的 `curl http://127.0.0.1:<port>/...` 硬编码 —— 没有 fallback，端点没了技能就是死的。

## 反面模式

- 只跑 `npm uninstall -g` 就宣布完成（config 引用、巡检清单、僵尸进程全在）。
- 用 `sed` 按行号改 config；或在没备份的情况下改。
- 为了清理 MCP 子进程去重启网关（自断 Discord 30 秒，而且不必要）。
- 把「工具列表还能列出来」当成「服务可用」：MCP 的 `tools/list` 目录是烧在脚本里的，后端没起照样能列出，`call` 才报 `fetch failed`。判断可用性要真的 call 一次或直接探端口。
