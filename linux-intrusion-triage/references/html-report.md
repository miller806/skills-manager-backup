# 内建静态网页报告（hunt-linux.sh 的 render_html）

交付物是脚本自己吐的 `report.html`，不是助手事后手绘的图。需求原话：「静态工具就可以输出静态网页」——所以渲染器必须在脚本里，且不能引入目标机上不存在的依赖。

## 硬约束

- **纯 awk**，不用 python/jq/ruby。目标机可能只有 busybox-ish 的精简环境，为了渲染去 `apt install` 是本末倒置。
- **单文件**：CSS 全部内联在 `<style>`，无 CDN、无外链字体/JS。内网机、断网环境双击就能开，能直接 Ctrl-P 存 PDF。
- **两种入口，同一渲染器**：
  - 采集结束时自动 `render_html "$REPORT" "${REPORT%.txt}.html"`；
  - `--html-only <report.txt>` 只重渲染不重采集（调样式、补渲染、给客户重出版本都走这条，不用再登机器）。
- **`--html-only` 的元信息从报告头回收**，不要新增参数：`sed -n 's/^ host     : //p'`、`sed -n 's/^ window   : \([0-9]*\)d.*/\1/p'`，输出目录取 `dirname`。

## 结构

两遍 awk，同一个文件读两次（`awk ... "$R" "$R"`，用 `FNR==NR` 分遍）：

1. 第一遍收集 `^### SECTION: ` 的标题、节数 `NSEC`，以及 `### SECTION: …SUMMARY` 段内 `^  \[CRITICAL\]` / `^  \[WARN\]` 的计数 `crit`/`warn`。
2. 第二遍输出 HTML：顶栏（host / 时间窗 / 版本）→ **verdict 块**（`crit==0` 时写「未发现入侵」，否则「疑似入侵」）→ 5 张统计卡 → TOC → 每节一个 `<section>`，正文整体 `<pre>` 包住。

变量全部用 `-v` 传入（`crit/warn/nsec/gen/host/ver/day/outdir`），不要在 awk 里读环境。正文转义只做 `& < >` 三字符的 `esc()`——报告是纯文本，不需要更重的处理。

## 统计卡：每个数字都要自带口径

| 卡片 | 取值 | 底注 |
|---|---|---|
| 强特征命中 | SUMMARY 段 `[CRITICAL]` 计数 | CRITICAL |
| 需人工复核 | SUMMARY 段 `[WARN]` 计数 | WARN |
| 成功登录 | `\`--- 成功登录 用户/来源 聚合\`` 段内以 `^[0-9]+ for .* from ` 开头的行的首列之和 | auth.log* 含轮转 |
| 登录来源 | 同一段内 `from <ip>` 去重计数 | 独立源 IP |
| 在线会话 | `who` 的 pts 行数 | 当前 pts 会话 |

解析聚合段时**只累加以数字开头的行**：整段 `login++` 会把标题行和空行算进去，得到 68 vs 实际 27 这种离谱数字。段结束条件要加 `$0 ~ /^---/`（SUMMARY 之外的下一个 `---` 小标题）。

数字与「当前 `auth.log` 条数」对不上不要紧，但必须在底注写明含 `.gz` 轮转；另开一个卡片去解释口径，比改数字诚实。

## 验收（改完渲染器必做）

```bash
bash -n scripts/hunt-linux.sh                                  # 语法
bash scripts/hunt-linux.sh --html-only <dir>/report.txt        # 渲染
```

然后用浏览器读 DOM 核对，不要靠肉眼盯长图：

```javascript
secs        = document.querySelectorAll('section').length          // 应等于报告里的 SECTION 数
stats       = [...document.querySelectorAll('.sc')].map(e=>e.innerText)
verdict     = document.querySelector('.vd').innerText              // crit==0 时应含「未发现入侵」
highlights  = document.querySelectorAll('.l.cr,.l.wn').length      // 汇总节高亮
overflow    = [...document.querySelectorAll('pre')].filter(e=>e.scrollWidth>e.clientWidth+2).length   // 应为 0
```

真机端到端：`scp` 上去 → 两端 `md5` 一致 → `nohup setsid bash hunt-linux.sh --days 30 --out /tmp/ir/outN` → 等 60~70s → 确认 5 个产物齐全（`report.html` 在列）→ 回读 SUMMARY 判级。**连跑两轮**，第二轮才验证得出自指误报。

## 显示体积

用 `stat -c %s`（macOS 回退 `stat -f %z`）再 `/1024`，不要 `du -h`：`du` 按磁盘块四舍五入，72KB 的文件会显示成 128K，汇报出去就是错的。
