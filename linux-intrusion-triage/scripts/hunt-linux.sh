#!/bin/bash
# ============================================================
# hunt-linux.sh — Linux 主机入侵排查（单文件，纯只读，不改系统）
#
# 直接在目标机器上跑，不需要任何本地驱动：
#   scp hunt-linux.sh root@<host>:/tmp/
#   ssh root@<host> 'bash /tmp/hunt-linux.sh'
#
# 用法:
#   bash hunt-linux.sh                     # 全量，输出到 ./hunt_<host>_<时间>/
#   bash hunt-linux.sh --days 7            # 只看最近 7 天变更
#   bash hunt-linux.sh --ioc-prefix 'evil*'     # 额外按文件名找同族样本
#   bash hunt-linux.sh --out /root/ir        # 指定输出目录
#   bash hunt-linux.sh --no-pack           # 只出报告，不打包取证
#
# 产出（都在输出目录里）:
#   report.html        静态网页报告（单文件、离线可开、无外部依赖；优先看这个）
#   report.txt         完整报告，### SECTION 可切分
#   summary.txt        CRITICAL 摘要（先看这个）
#   samples.tgz        可疑文件原件 + 元数据快照
#   samples_manifest.txt  取证包 sha256 清单（保管链）
#
# 设计原则: 只读；不写系统路径；每项有 timeout；判定靠形态特征不写死样本名
# ============================================================
set -uo pipefail
export LC_ALL=C
umask 077

SCRIPT_VERSION="1.0"

# ---------------- 参数 ----------------
DAYS=30; IOC_NAME=""; OUT=""; DO_PACK=1; HTML_ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --days) DAYS=$2; shift 2;;
    --ioc-prefix) IOC_NAME=$2; shift 2;;
    --out) OUT=$2; shift 2;;
    --no-pack) DO_PACK=0; shift;;
    --html-only) HTML_ONLY=$2; shift 2;;
    -h|--help) sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "未知参数: $1（--help 看用法）"; exit 1;;
  esac
done

HOSTN=$(hostname 2>/dev/null || echo unknown)
TS=$(date +%Y%m%d_%H%M%S)
[ -n "$OUT" ] || OUT="./hunt_${HOSTN}_${TS}"
mkdir -p "$OUT" || { echo "无法创建输出目录 $OUT"; exit 1; }
OUT=$(cd "$OUT" && pwd)
REPORT="$OUT/report.txt"
SUMMARY="$OUT/summary.txt"
PACK="$OUT/samples.tgz"

# ---------------- 兼容层 ----------------
if command -v timeout >/dev/null 2>&1; then T=$(command -v timeout)
elif [ -x /usr/bin/timeout ]; then T=/usr/bin/timeout
elif command -v gtimeout >/dev/null 2>&1; then T=$(command -v gtimeout)
else T=""; fi
tt(){ if [ -n "$T" ]; then $T 25 "$@" 2>/dev/null; else "$@" 2>/dev/null; fi; }
tt5(){ if [ -n "$T" ]; then $T 5 "$@" 2>/dev/null; else "$@" 2>/dev/null; fi; }

sec(){ echo; echo "### SECTION: $*"; }
note(){ echo "[NOTE] $*"; }
hint(){ echo "  ↳ $*"; }

# ---------- 自排除（脚本自身及其 tee/ssh 管道会命中 /tmp 运行特征） ----------
SELF=$$
SELF_PATH=$(readlink -f "$0" 2>/dev/null || echo "$0")
# 排除整个进程树：自身 + 所有祖先（ssh/bash/tee/终端）+ 所有后代
ps_no_self(){
  tt ps -eo user,pid,ppid,etime,args 2>/dev/null | awk -v s="$SELF" '
    { line[NR]=$0; pid[NR]=$2; pp[NR]=$3 }
    END{
      for(i=1;i<=NR;i++) par[pid[i]]=pp[i]
      for(i=1;i<=NR;i++){
        p=pp[i]; d=0
        while(d<60 && p!="" && p!="0" && p!="1"){
          if(p==s){ drop[i]=1; break }
          p=par[p]; d++
        }
      }
      for(i=1;i<=NR;i++) if(!drop[i] && line[i] !~ /hunt-linux\.sh/) print line[i]
    }'
}
# 临时目录里的可执行文件/脚本（统一口径：明细与计数共用，且排除脚本自身）
tmp_exec(){
  tt find /tmp /dev/shm /var/tmp -maxdepth 3 -type f \( -perm -u+x -o -name '*.sh' \) 2>/dev/null \
    | grep -vxF "$SELF_PATH" | grep -v 'hunt-linux\.sh'
}

# 判断某文件是不是「本工具自己的产物」，不是样本
# 关键：不能只看 $OUT（本次输出目录）。同机上历次采集的 out2/ 、hunt_*/ 目录
#       里同样有 report.html，其内联 CSS 夹着 oast.live 等正则原文 → 会被判成 OOB 载荷。
is_artifact(){
  local f=$1 d
  [ "$f" = "$SELF_PATH" ] && return 0
  case "$f" in hunt-linux.sh|*/hunt-linux.sh) return 0;; esac
  case "${f##*/}" in
    report.html|report.txt|summary.txt|samples_manifest.txt|run*.log) return 0;;
  esac
  d=$(dirname "$f")
  # 同目录有取证清单/报告 → 是本工具的产出目录（任意一次采集）
  if [ -f "$d/samples_manifest.txt" ] || { [ -f "$d/report.txt" ] && [ -f "$d/report.html" ]; }; then
    return 0
  fi
  # 报告正文/网页都带这几个标记（网页版标记可能出现在 100KB 之后）
  tt head -c 120000 "$f" 2>/dev/null | grep -qiE '### SECTION:|LINUX HOST INTRUSION TRIAGE|Linux Intrusion Triage' && return 0
  return 1
}

# 内容特征扫描（排除脚本自身与本次输出目录，否则会把 report.txt 自己算成命中）
ioc_scan(){
  tt grep -rlE "$IOC_CONTENT" "$@" 2>/dev/null | while read -r f; do
    is_artifact "$f" && continue
    echo "$f"
  done
}
# 按内容特征列命中文件（排除脚本自身、输出目录、以及本脚本自己产出的报告/终端落盘）
cscan(){
  _pat=$1; shift
  tt grep -rlE "$_pat" "$@" 2>/dev/null | while read -r f; do
    is_artifact "$f" && continue
    echo "$f"
  done
}
WS_PAT='Runtime\.getRuntime\(\)\.exec|ProcessBuilder\.start|Runtime\.getRuntime\(\)|<%@ *page|eval\(\$_POST|passthru\(|shell_exec\(|exec cmd='
# 已删除仍运行的二进制：只有在临时/业务路径才算强特征；/usr /lib 下多为 apt 升级残留
del_exe_susp(){
  tt ls -l /proc/*/exe 2>/dev/null | grep -i deleted \
    | grep -E -- '-> /(tmp|dev/shm|var/tmp|root|home|web|opt|data|srv)/' || true
}
del_exe_benign(){
  tt ls -l /proc/*/exe 2>/dev/null | grep -i deleted \
    | grep -vE -- '-> /(tmp|dev/shm|var/tmp|root|home|web|opt|data|srv)/' || true
}
# 非包管理的动态库变更（真正可疑的库劫持）
# 带 JNI 导出符号的 .so 是业务自研 SDK（nm -D 能看到 Java_*_ 入口）→ 直接判定为业务库，
# 不进 WARN。库劫持的典型特征是被别人 dlopen/预加载，而不是自己导出 JNI 入口。
so_unowned(){
  tt find /lib /lib64 /usr/lib /usr/lib64 /usr/local/lib -xdev -name '*.so*' -newermt "$SINCE" 2>/dev/null \
    | while read -r f; do
        case "$f" in
          /usr/lib/modules/*|/lib/modules/*)
            # 内核包构建产物（modules.softdep / vdso*.so / modules.*.bin），dpkg 有意不登记
            continue;;
        esac
        dpkg -S "$f" >/dev/null 2>&1 && continue
        _jni=$(tt nm -D --defined-only "$f" 2>/dev/null | grep -c ' Java_[A-Za-z0-9_]*_')
        if [ "${_jni:-0}" -gt 3 ]; then
          echo "  [已定性] $f  JNI 导出 ${_jni} 个 → 业务自研 SDK，非库劫持" >&2
          continue
        fi
        echo "$f"
      done | head -10
}

SINCE=$(date -d "$DAYS days ago" +%Y-%m-%dT%H:%M:%S 2>/dev/null \
     || date -v-${DAYS}d +%Y-%m-%dT%H:%M:%S 2>/dev/null || echo "1970-01-01T00:00:00")
SINCE_LOG=$(date -d "$DAYS days ago" +%Y-%m-%d 2>/dev/null || date -v-${DAYS}d +%Y-%m-%d)

# ---------- 判定特征（形态，不写死样本名） ----------
# 1) 配置目录里伪装成图片/文档的文件（正常 /etc 不会有 .png/.jpg）
FAKE_IMG='.*\.(png|jpg|jpeg|gif|bmp|ico|webp|svg)$'
# 2) 内容特征: OOB 回连 / 反弹 shell / 下载执行
IOC_CONTENT='oast\.live|oast\.pro|oastify|burpcollaborator|interactsh|\.ngrok\.io|/dev/tcp/|nc -e|ncat -e|bash -i >&|socat.*exec|base64 -d.*\|\s*(ba)?sh'
# 3) 挖矿特征
MINER='xmrig|minerd|cpuminer|kinsing|kdevtmpfsi|kthreaddi|sysupdate|dbused|masscan|zgrab'

# ============================================================
# 静态网页报告渲染（纯 awk，无 python/jq 依赖；单文件离线可开）
# 用法: 主流程结束后自动调用；也可单独重渲染已有报告:
#   bash hunt-linux.sh --html-only /path/to/report.txt
# ============================================================
render_html(){
  local R="$1" H="$2"
  [ -f "$R" ] || { echo "找不到报告: $R" >&2; return 1; }
  local CRIT WARN NSEC GEN
  CRIT=$(sed -n '/### SECTION: 13. SUMMARY/,/### DONE/p' "$R" 2>/dev/null | grep -c '^  \[CRITICAL\]')
  WARN=$(sed -n '/### SECTION: 13. SUMMARY/,/### DONE/p' "$R" 2>/dev/null | grep -c '^  \[WARN\]')
  NSEC=$(grep -c '^### SECTION:' "$R" 2>/dev/null)
  GEN=$(date '+%F %T %Z')

  awk -v crit="${CRIT:-0}" -v warn="${WARN:-0}" -v nsec="${NSEC:-0}" -v gen="$GEN" \
      -v host="$HOSTN" -v ver="$SCRIPT_VERSION" -v days="$DAYS" -v outdir="$OUT" '
function esc(s){ gsub(/&/,"\\&amp;",s); gsub(/</,"\\&lt;",s); gsub(/>/,"\\&gt;",s); return s }
BEGIN{ n=0; sess=0; login=0; topsrc=""; insess=0; inlogin=0; pre=0 }

# ---------- pass 1: 收集目录与关键计数 ----------
FNR==NR {
  if ($0 ~ /^### SECTION: /) {
    t=substr($0,14); n++; d=index(t,". ")
    if (d>0) { secno[n]=substr(t,1,d-1); secti[n]=substr(t,d+2) }
    else { secno[n]="--"; secti[n]=t }
  }
  if ($0 ~ /^--- 成功登录 用户\/来源 聚合/) { inlogin=1; next }
  if (inlogin) {
    if ($0 ~ /^---/ || $0 ~ /^[[:space:]]*$/) { inlogin=0 }
    else if ($0 ~ /^[[:space:]]*[0-9]+ for .* from /) {
      v=$0; sub(/^[[:space:]]*/,"",v); sub(/[[:space:]].*/,"",v); login+=v
      w=$0; sub(/.* from /,"",w); sub(/[[:space:]].*/,"",w)
      if (!(w in seenip)) { seenip[w]=1; nip++ }
    }
  }
  if ($0 ~ /^  当前在线会话来源/) { insess=1; next }
  if (insess) { if ($0 ~ /^[[:space:]]*$/) insess=0; else if ($0 ~ /pts/) sess++ }
  next
}

# ---------- pass 2: 输出 HTML ----------
NR>FNR && FNR==1 {
  verdict = (crit+0>0) ? "命中强特征" : "未发现入侵"
  vcls = (crit+0>0) ? "crit" : "ok"
  vtxt = (crit+0>0) ? "需立即按应急响应流程处置，先摘 hook 再删样本" : "未命中已知强特征；账户 / 登录 / 持久化 / 落地文件 各节均已完成采集"
  print "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
  print "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
  print "<title>入侵排查报告 · " host "</title><style>"
  print ":root{--bg:#0b0f14;--pan:#111820;--pan2:#0e141b;--ln:#1f2b38;--tx:#d6e1ec;--dim:#7b8fa3;--ok:#3ddc97;--wn:#ffb84d;--cr:#ff5d5d;--in:#5aa9ff;--mo:\"SF Mono\",ui-monospace,Menlo,Consolas,monospace}"
  print "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.65 -apple-system,\"PingFang SC\",\"Helvetica Neue\",sans-serif}"
  print ".wrap{max-width:1060px;margin:0 auto;padding:36px 26px 56px}"
  print "header{border-bottom:1px solid var(--ln);padding-bottom:20px;margin-bottom:22px}"
  print ".eyebrow{font:600 11px/1 var(--mo);letter-spacing:.18em;color:var(--dim);text-transform:uppercase}"
  print "h1{margin:10px 0 4px;font-size:25px;font-weight:650;letter-spacing:-.01em}h1 .ip{font-family:var(--mo);color:var(--in);font-weight:500}"
  print ".sub{color:var(--dim);font-size:12.5px;font-family:var(--mo)}"
  print ".vd{display:flex;align-items:center;gap:14px;margin-top:18px;border-radius:8px;padding:13px 17px;border:1px solid}"
  print ".vd.ok{background:linear-gradient(90deg,rgba(61,220,151,.13),rgba(61,220,151,.02));border-color:rgba(61,220,151,.35);border-left:3px solid var(--ok)}"
  print ".vd.crit{background:linear-gradient(90deg,rgba(255,93,93,.14),rgba(255,93,93,.02));border-color:rgba(255,93,93,.4);border-left:3px solid var(--cr)}"
  print ".vd .bd{font:700 13px/1 var(--mo);letter-spacing:.06em;padding:7px 12px;border-radius:5px;white-space:nowrap;color:#062d1d;background:var(--ok)}"
  print ".vd.crit .bd{color:#2d0606;background:var(--cr)}"
  print ".vd .tx{font-size:13.5px}.vd .tx b{color:var(--ok)}.vd.crit .tx b{color:var(--cr)}"
  print ".st{display:grid;grid-template-columns:repeat(5,1fr);gap:11px;margin:22px 0 26px}"
  print ".sc{background:var(--pan);border:1px solid var(--ln);border-radius:8px;padding:13px 13px 11px}"
  print ".sc .k{font:600 10px/1 var(--mo);letter-spacing:.1em;color:var(--dim);text-transform:uppercase}"
  print ".sc .v{font:600 19px/1.3 var(--mo);margin-top:7px}.sc .n{font-size:10.5px;color:var(--dim);margin-top:2px}"
  print ".v.ok{color:var(--ok)}.v.wn{color:var(--wn)}.v.cr{color:var(--cr)}.v.in{color:var(--in)}"
  print ".toc{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 26px}"
  print ".toc a{font:11px/1 var(--mo);color:var(--dim);text-decoration:none;border:1px solid var(--ln);border-radius:20px;padding:6px 10px;background:var(--pan2)}"
  print ".toc a:hover{color:var(--tx);border-color:#2d3f52}"
  print "section{margin:0 0 26px;scroll-margin-top:14px}"
  print "h2{display:flex;align-items:baseline;gap:9px;margin:0 0 10px;font-size:14.5px;font-weight:650;padding-bottom:8px;border-bottom:1px solid var(--ln)}"
  print "h2 .no{font:600 11px/1 var(--mo);color:var(--dim)}h2 .tg{margin-left:auto;font:600 10px/1 var(--mo);letter-spacing:.08em;padding:4px 8px;border-radius:4px}"
  print ".tg.pass{color:var(--ok);background:rgba(61,220,151,.12);border:1px solid rgba(61,220,151,.3)}"
  print ".tg.attn{color:var(--wn);background:rgba(255,184,77,.12);border:1px solid rgba(255,184,77,.3)}"
  print ".tg.bad{color:var(--cr);background:rgba(255,93,93,.12);border:1px solid rgba(255,93,93,.3)}"
  print ".tg.inf{color:var(--in);background:rgba(90,169,255,.1);border:1px solid rgba(90,169,255,.28)}"
  print "pre{margin:0;background:var(--pan2);border:1px solid var(--ln);border-radius:8px;padding:14px 16px;overflow-x:auto;font:12.5px/1.8 var(--mo);color:#c2d1e0;white-space:pre;tab-size:4}"
  print "pre .l{display:block}.l.cr{color:var(--cr);font-weight:600}.l.wn{color:var(--wn)}.l.inf{color:#8fb8e0}.l.hd{color:#eaf2fa;font-weight:600}"
  print "footer{margin-top:38px;padding-top:16px;border-top:1px solid var(--ln);color:var(--dim);font-size:11px;font-family:var(--mo);display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px}"
  print "@media print{body{background:#fff;color:#111}.sc,pre{background:#f7f9fb;border-color:#dde3ea}pre,.sc .v{-webkit-print-color-adjust:exact;print-color-adjust:exact}}"
  print "@media(max-width:720px){.st{grid-template-columns:repeat(2,1fr)}}"
  print "</style></head><body><div class=\"wrap\">"
  print "<header><div class=\"eyebrow\">Linux Intrusion Triage · Read-only Assessment · v" ver "</div>"
  print "<h1>主机入侵排查 <span class=\"ip\">" host "</span></h1>"
  print "<div class=\"sub\">window " days "d · " nsec " sections · generated " gen "</div>"
  print "<div class=\"vd " vcls "\"><span class=\"bd\">" verdict "</span><span class=\"tx\">CRITICAL <b>" crit "</b> · WARN <b>" warn "</b> · " vtxt "</span></div></header>"
  print "<div class=\"st\">"
  printf "<div class=\"sc\"><div class=\"k\">强特征命中</div><div class=\"v %s\">%s</div><div class=\"n\">CRITICAL</div></div>\n", (crit+0>0?"cr":"ok"), crit
  printf "<div class=\"sc\"><div class=\"k\">需人工复核</div><div class=\"v %s\">%s</div><div class=\"n\">WARN</div></div>\n", (warn+0>0?"wn":"ok"), warn
  printf "<div class=\"sc\"><div class=\"k\">成功登录</div><div class=\"v in\">%s</div><div class=\"n\">auth.log* 含轮转</div></div>\n", (login>0?login:"0")
  printf "<div class=\"sc\"><div class=\"k\">登录来源</div><div class=\"v %s\">%s</div><div class=\"n\">独立源 IP</div></div>\n", (nip>1?"wn":"ok"), (nip>0?nip:"0")
  printf "<div class=\"sc\"><div class=\"k\">在线会话</div><div class=\"v %s\">%s</div><div class=\"n\">当前 pts 会话</div></div>\n", (sess>3?"wn":"ok"), sess
  print "</div><div class=\"toc\">"
  for (i=1;i<=n;i++) printf "<a href=\"#s%d\">%s. %s</a>", i, secno[i], secti[i]
  print "</div>"
}

NR>FNR {
  if ($0 ~ /^### SECTION: /) {
    if (pre) { print "</pre></section>"; pre=0 }
    t=substr($0,14); d=index(t,". ")
    if (d>0) { no=substr(t,1,d-1); ti=substr(t,d+2) } else { no="--"; ti=t }
    tgc="inf"; tgt="采集"
    if (ti ~ /SUMMARY/) { if (crit+0>0) { tgc="bad"; tgt="需复核" } else { tgc="pass"; tgt="全部通过" } }
    else if (ti ~ /EVIDENCE/) { tgc="attn"; tgt="取证包" }
    printf "<section id=\"s%d\"><h2><span class=\"no\">%s</span>%s<span class=\"tg %s\">%s</span></h2><pre>", ++k, esc(no), esc(ti), tgc, tgt
    pre=1; next
  }
  if (!pre) next
  line=$0
  if (line ~ /^### DONE/) { print "<span class=\"l inf\">" esc(line) "</span>"; next }
  c=""
  if (line ~ /\[CRITICAL\]/) c="cr"
  else if (line ~ /\[WARN\]/) c="wn"
  else if (line ~ /\[NOTE\]|\[INFO\]|\[REVIEW\]|↳/) c="inf"
  else if (line ~ /^  (CRITICAL|WARN) 计数|^  → /) c="hd"
  if (c!="" && line!="") printf "<span class=\"l %s\">%s</span>\n", c, esc(line)
  else if (line=="") print ""
  else print esc(line)
}

END{
  if (pre) print "</pre></section>"
  printf "<footer><span>hunt-linux.sh v%s · %s sections · window %sd</span><span>%s · %s</span></footer>\n", ver, nsec, days, host, gen
  print "</div></body></html>"
}' "$R" "$R" > "$H"

  local SZ; SZ=$(stat -c %s "$H" 2>/dev/null || stat -f %z "$H" 2>/dev/null)
  SZ=$(( ${SZ:-0} / 1024 ))K
  echo "  ✓ 网页报告: $H  ${SZ}"
}

main() {
echo "=============================================================="
echo " LINUX HOST INTRUSION TRIAGE  v$SCRIPT_VERSION"
echo " host     : $HOSTN"
echo " date     : $(date '+%F %T %Z')"
echo " window   : ${DAYS}d  (since ${SINCE})"
echo " identity : uid=$(id -u) user=$(id -un)  kernel=$(uname -r)"
echo " output   : $OUT"
echo " 判定原则 : 只读采集；按形态特征判定，不依赖具体样本名"
echo "=============================================================="
[ "$(id -u)" = "0" ] || note "非 root：/etc/shadow、/root、全盘 find 会缺失，强烈建议 root 或 sudo"

# ================= 1. 身份与基线 =================
sec "1. IDENTITY"
uname -a; echo; uptime
grep -E '^(PRETTY_NAME|VERSION)=' /etc/os-release 2>/dev/null
echo "--- 虚拟化/容器"
tt systemd-detect-virt
[ -f /.dockerenv ] && echo "  /.dockerenv 存在 → 容器"
echo "--- 网卡地址"
ip -4 addr show 2>/dev/null | grep -oE 'inet [0-9.]+/[0-9]+' | head -10
echo "--- 云元数据（判断是否云主机 + 实例归属）"
tok=$(tt5 curl -s -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 60')
if [ -n "${tok:-}" ]; then
  for k in instance-id instance-type placement/region public-ipv4 security-groups; do
    printf '  %-22s %s\n' "$k" "$(tt5 curl -s -H "X-aws-ec2-metadata-token: $tok" http://169.254.169.254/latest/meta-data/$k)"
  done
else
  note "非 AWS 或无 IMDS"
fi
echo "--- 时区/时间漂移（日志对时间要用）"
timedatectl 2>/dev/null | grep -E 'Time zone|synchronized' || date

# ================= 2. 账户 =================
sec "2. ACCOUNTS"
echo "--- UID 0 账户（应只有 root）"
tt awk -F: '$3==0{print "  "$1" uid=0 shell="$7}' /etc/passwd
echo "--- 可登录账户"
tt awk -F: '$7!~/nologin|false|sync|shutdown|halt/{print "  "$1" uid="$3" "$7}' /etc/passwd
echo "--- UID>=1000"
tt awk -F: '$3>=1000 && $3<65534{print "  "$1" uid="$3" home="$6" "$7}' /etc/passwd
echo "--- 空密码账户"
e=$(tt awk -F: '($2==""){print "  EMPTY PASSWORD: "$1}' /etc/shadow)
[ -n "$e" ] && echo "$e" || echo "  无 ✔"
echo "--- sudo 配置（非注释，看有没有 NOPASSWD 后门）"
tt grep -rhE '^[^#].*(NOPASSWD|ALL=\(ALL)' /etc/sudoers /etc/sudoers.d/ 2>/dev/null | sed 's/^/  /' | head -15
echo "--- 账户数据库改动时间"
tt stat -c '  %n  mtime=%y' /etc/passwd /etc/shadow /etc/group /etc/sudoers 2>/dev/null
echo "--- 近 ${DAYS}d 新建 home 目录"
tt find /home /root -maxdepth 1 -type d -newermt "$SINCE" -printf '  %TY-%Tm-%Td %p\n'
echo "--- nobody/daemon 类账户是否有可用 shell（提权后门）"
tt awk -F: '($3<1000 && $7!~/nologin|false|sync|shutdown|halt/){print "  "$1" uid="$3" "$7}' /etc/passwd

# ================= 3. SSH 后门 =================
sec "3. SSH KEYS / SSHD"
for d in /root/.ssh /home/*/.ssh; do
  [ -d "$d" ] || continue
  echo "--- $d"
  tt ls -la "$d" | sed 's/^/  /'
  if [ -f "$d/authorized_keys" ]; then
    echo "  keys=$(tt grep -c . "$d/authorized_keys")  mtime=$(tt stat -c %y "$d/authorized_keys" | cut -d. -f1)"
    echo "  --- 指纹"
    tt ssh-keygen -lf "$d/authorized_keys" | sed 's/^/    /'
    echo "  --- 注释字段（陌生 key 必须人工确认）"
    tt awk 'NF>2{print "    "$NF}' "$d/authorized_keys" | head -10
    echo "  --- 含命令前缀的 key（强制命令后门）"
    tt grep -E '^(command=|from=)' "$d/authorized_keys" | cut -c1-120 | sed 's/^/    /'
  fi
done
echo "--- 其他可能被忽略的 key 位置"
for f in /etc/ssh/authorized_keys /etc/ssh/authorized_keys.d/* /root/.ssh/rc; do
  [ -e "$f" ] && echo "  ⚠️ $f 存在 mtime=$(tt stat -c %y "$f" | cut -d. -f1)"
done
echo "--- sshd 有效配置"
tt sshd -T 2>/dev/null | grep -iE '^(permitrootlogin|passwordauthentication|pubkeyauthentication|permitempty|authorizedkeysfile|kbdinteractiveauthentication)' \
  || tt grep -rihE '^\s*(PermitRootLogin|PasswordAuthentication|AuthorizedKeysFile)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>/dev/null | sed 's/^/  /'
echo "--- sshd / ssh 二进制与配置改动时间"
tt stat -c '  %n mtime=%y' /usr/sbin/sshd /etc/ssh/sshd_config 2>/dev/null
echo "--- ssh 相关包完整性（被替换会显示）"
if command -v dpkg >/dev/null 2>&1; then
  tt dpkg -V openssh-server openssh-client 2>/dev/null | head -10
fi

# ================= 4. 登录审计 =================
sec "4. AUTH LOG"
ALOG=""
for f in /var/log/auth.log /var/log/secure; do [ -f "$f" ] && { ALOG=$f; break; }; done
if [ -n "$ALOG" ]; then
  echo "--- 日志文件: $ALOG （含轮转）"
  echo "--- 成功登录 用户/来源 聚合 top15"
  tt zgrep -h 'Accepted' "$ALOG"* 2>/dev/null | grep -oE 'for [^ ]+ from [0-9a-f.:]+' | sort | uniq -c | sort -rn | head -15 | sed 's/^/  /'
  echo "--- 失败密码 总数 / 独立来源数"
  echo "  total=$(tt zgrep -h 'Failed password' "$ALOG"* 2>/dev/null | wc -l)  srcs=$(tt zgrep -h 'Failed password' "$ALOG"* 2>/dev/null | grep -oE 'from [0-9a-f.:]+' | sort -u | wc -l)"
  echo "--- 失败来源 top10（是否存在爆破）"
  tt zgrep -h 'Failed password' "$ALOG"* 2>/dev/null | grep -oE 'from [0-9a-f.:]+' | sort | uniq -c | sort -rn | head -10 | sed 's/^/  /'
  echo "--- 无效用户尝试 top10"
  tt zgrep -h 'Invalid user' "$ALOG"* 2>/dev/null | grep -oE 'Invalid user [^ ]+' | sort | uniq -c | sort -rn | head -10 | sed 's/^/  /'
  echo "--- 账户变更 / sudo 执行（近 ${DAYS}d 尾部）"
  tt zgrep -hE 'useradd|groupadd|usermod|userdel|passwd changed|new user|COMMAND=' "$ALOG"* 2>/dev/null | tail -25 | sed 's/^/  /'
  echo "--- 近 ${DAYS}d 成功登录明细（尾部 15 条）"
  tt grep -h 'Accepted' "$ALOG" 2>/dev/null | tail -15 | sed 's/^/  /'
else
  note "无 auth.log/secure"
fi
echo "--- journalctl -u ssh（近 ${DAYS}d，退化路径）"
tt journalctl -u ssh -u sshd --since "$SINCE_LOG" --no-pager 2>/dev/null | grep -iE 'Accepted|Failed|session opened' | tail -15 | sed 's/^/  /'
echo "--- last（成功登录历史）"
tt last -a -F 2>/dev/null | head -15 | sed 's/^/  /'
echo "--- lastb（失败登录）条数: $(tt lastb 2>/dev/null | wc -l)"
echo "--- 当前在线会话"
tt who -a 2>/dev/null | sed 's/^/  /'
echo "--- wtmp/btmp 是否被清空（截断=毁证据）"
tt stat -c '  %n size=%s mtime=%y' /var/log/wtmp /var/log/btmp /var/log/lastlog 2>/dev/null

# ================= 5. 运行态 =================
sec "5. PROCESSES"
echo "--- CPU top15"
tt ps -eo user,pid,ppid,pcpu,pmem,etime,args --sort=-pcpu | head -16 | cut -c1-190 | sed 's/^/  /'
echo "--- 从 /tmp /dev/shm /var/tmp 运行（高危，已排除本脚本自身）"
r=$(ps_no_self | grep -E '(/tmp/|/dev/shm/|/var/tmp/)' | grep -v grep | cut -c1-170)
[ -n "$r" ] && echo "$r" | sed 's/^/  /' || echo "  无 ✔"
echo "--- 挖矿特征"
r=$(tt ps -eo pid,args | grep -iE "$MINER" | grep -v grep | cut -c1-160)
[ -n "$r" ] && echo "$r" | sed 's/^/  /' || echo "  无 ✔"
echo "--- OOB 回连进程（oast/interactsh/ngrok）"
r=$(tt ps -eo user,pid,etime,args | grep -E 'oast\.live|oast\.pro|interactsh|burpcollaborator|ngrok' | grep -v grep | cut -c1-170)
[ -n "$r" ] && echo "$r" | sed 's/^/  /' || echo "  无 ✔"
echo "--- shell -c 派生（可能是 webshell 触发；已排除本脚本自身与 GUI 运维客户端探针）"
ps_no_self | grep -E '\b(sh|bash|dash)\b -c' | grep -v grep \
  | grep -vE 'finalshell_separator|Xshell|MobaXterm|termius' | cut -c1-170 | head -10 | sed 's/^/  /'
echo "--- 父进程已死的孤儿进程（只报非系统路径/无 exe 的，系统 daemon 不算）"
r=$(tt ps -eo pid,ppid,etime,args 2>/dev/null | awk '$2==1 && $3 !~ /^0/ {print $1}' | while read -r p; do
      e=$(readlink /proc/"$p"/exe 2>/dev/null)
      if [ -z "$e" ] || echo "$e" | grep -qE '^/(tmp|dev/shm|var/tmp|root|home|web|opt|data|srv)/'; then
        printf '  %-8s %s %s\n' "$p" "${e:-<无 exe>}" "$(tr -d '\0' < /proc/$p/cmdline 2>/dev/null | cut -c1-90)"
      fi
    done | head -12)
[ -n "$r" ] && echo "$r" || echo "  无 ✔"
echo "--- 对外服务运行用户（root 跑 web/app = 高危）"
tt ps -eo user,pid,args | grep -E 'java .*-jar|node .*\.js|python.*\.py|nginx|httpd' | grep -v grep | awk '{print "  "$1" pid="$2" "$NF}' | head -12
echo "--- 已删除但仍运行 · 临时/业务路径（强特征）"
r=$(del_exe_susp | cut -c1-170 | head -10)
[ -n "$r" ] && echo "$r" | sed 's/^/  ⚠️ /' || echo "  无 ✔"
echo "--- 已删除但仍运行 · 系统路径（多为 apt 升级残留，仅备查）"
del_exe_benign | cut -c1-170 | head -6 | sed 's/^/  /'
echo "--- 近期变更的动态库 · 无包归属（库劫持）"
r=$(so_unowned)
[ -n "$r" ] && echo "$r" | sed 's/^/  ⚠️ /' || echo "  无 ✔（有变更但都属系统包）"

# ================= 6. 网络 =================
sec "6. NETWORK"
echo "--- 监听端口（非回环）"
tt ss -tulnp 2>/dev/null | awk 'NR==1 || ($5 !~ /^127\.|^::1|^\[::1\]/)' | sed 's/^/  /'
echo "--- 已建立连接（非内网对端）"
r=$(tt ss -tnp state established 2>/dev/null | grep -vE '127\.0\.0\.1|::1|172\.(1[6-9]|2[0-9]|3[01])\.|10\.|192\.168\.')
[ -n "$r" ] && echo "$r" | head -20 | sed 's/^/  /' || echo "  无 ✔"
echo "--- 连接数按对端 IP"
tt ss -tn state established 2>/dev/null | awk 'NR>1{print $4}' | cut -d: -f1 | sort | uniq -c | sort -rn | head -12 | sed 's/^/  /'
echo "--- iptables 规则头（看有没有内鬼转发/放行）"
tt iptables -S 2>/dev/null | head -15 | sed 's/^/  /'
echo "--- /etc/hosts 非标准条目（劫持）"
r=$(tt grep -vE '^\s*#|^\s*$|^127\.|^::1|localhost|ip6-' /etc/hosts)
[ -n "$r" ] && echo "$r" | sed 's/^/  /' || echo "  干净 ✔"
echo "--- DNS 配置"
tt grep -vE '^\s*#|^\s*$' /etc/resolv.conf 2>/dev/null | sed 's/^/  /' | head -6
echo "--- 路由表异常（流量转发）"
tt ip route 2>/dev/null | head -8 | sed 's/^/  /'
echo "--- 网络命名空间（隐藏进程手法）"
tt ip netns list 2>/dev/null | sed 's/^/  /'

# ================= 7. 持久化 - cron =================
sec "7. PERSISTENCE: CRON"
echo "--- 各用户 crontab"
for u in $(cut -d: -f1 /etc/passwd 2>/dev/null); do
  c=$(tt crontab -u "$u" -l 2>/dev/null)
  [ -n "$c" ] && { echo "  [$u]"; echo "$c" | sed 's/^/    /'; }
done
echo "--- /var/spool/cron 结构"
tt ls -laR /var/spool/cron 2>/dev/null | head -25 | sed 's/^/  /'
echo "--- crontabs 里被造成「目录」（攻击者用 mkdir 代替写文件 → cron 一律忽略）"
d=$(tt find /var/spool/cron/crontabs /var/spool/cron/atjobs /var/spool/cron/atspool -mindepth 1 -type d 2>/dev/null)
[ -n "$d" ] && echo "$d" | sed 's/^/  ⚠️ /' || echo "  无 ✔"
echo "--- /etc/crontab 非注释行"
tt grep -vE '^\s*#|^\s*$' /etc/crontab 2>/dev/null | sed 's/^/  /'
echo "--- /etc/cron.d 全览（⚠️ 文件名含点会被 cron 忽略）"
tt ls -la /etc/cron.d/ 2>/dev/null | sed 's/^/  /'
echo "--- /etc/cron.d 里的非普通文件"
d=$(tt find /etc/cron.d -mindepth 1 ! -type f 2>/dev/null)
[ -n "$d" ] && echo "$d" | sed 's/^/  ⚠️ /' || echo "  无 ✔"
echo "--- cron 目录里含外连命令的文件（只报无包归属的；系统自带脚本跳过）"
r=$(for f in $(tt grep -rlE 'curl|wget|/dev/tcp|base64 -d' /etc/cron.d/ /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly /var/spool/cron/crontabs 2>/dev/null); do
      dpkg -S "$f" >/dev/null 2>&1 || rpm -qf "$f" >/dev/null 2>&1 || echo "  ⚠️ $f"
    done | head -10)
[ -n "$r" ] && echo "$r" || echo "  无 ✔"
echo "--- cron 实际加载报错（NOT A REGULAR FILE = 被拒绝，非命中）"
tt grep -iE 'NOT A REGULAR FILE|WRONG FILE OWNER|bad minute|unknown user' /var/log/syslog /var/log/cron 2>/dev/null | tail -10 | sed 's/^/  /'
tt journalctl -u cron -u crond --since "$SINCE_LOG" --no-pager 2>/dev/null | grep -iE 'NOT A REGULAR|WRONG|error' | tail -10 | sed 's/^/  /'
echo "--- at 队列 / anacron"
tt ls -la /var/spool/cron/atjobs 2>/dev/null | head -5 | sed 's/^/  /'
tt ls -la /var/spool/at 2>/dev/null | head -5 | sed 's/^/  /'

# ================= 8. 持久化 - 配置钩子 =================
sec "8. PERSISTENCE: HOOKS"
echo "--- /etc 下近 ${DAYS}d 变更（排除正常噪音）"
tt find /etc -xdev -type f -newermt "$SINCE" \
  ! -name '*.swp' ! -name '*~' ! -name 'mtab*' ! -name 'adjtime' ! -name '*.lock' \
  -printf '  %TY-%Tm-%Td %TH:%TM %10s %p\n' 2>/dev/null | sort | head -60
echo "--- 近 ${DAYS}d 新增的「目录」（伪装成文件名的目录 = 攻击者 mkdir 手法）"
tt find /etc /tmp /var/tmp /usr/local -xdev -maxdepth 3 -type d -newermt "$SINCE" \
  ! -path /etc ! -path /tmp ! -path /var/tmp ! -path /usr/local ! -path "$OUT" ! -path "$OUT/*" \
  -printf '  %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort | head -30
echo "--- 配置目录里伪装成图片的文件（强特征）"
for d in /etc /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/bash_completion.d /etc/profile.d \
         /etc/apt/apt.conf.d /etc/logrotate.d /etc/network/interfaces.d \
         /etc/dhcp/dhclient-enter-hooks.d /etc/dhcp/dhclient-exit-hooks.d \
         /etc/initramfs-tools/conf.d /etc/initramfs-tools/scripts /etc/ld.so.conf.d \
         /etc/sysctl.d /etc/security/limits.d /usr/local/bin /usr/local/sbin; do
  [ -e "$d" ] || continue
  r=$(tt find "$d" -maxdepth 2 -regextype posix-extended -regex "$FAKE_IMG" 2>/dev/null)
  [ -n "$r" ] && { echo "  [$d]"; echo "$r" | sed 's/^/    ⚠️ /'; }
done
echo "--- 上述文件的真实内容（图片还是脚本）"
tt find /etc -xdev -regextype posix-extended -regex "$FAKE_IMG" -type f 2>/dev/null | head -60 | while read -r f; do
  printf '  %-56s | %s\n' "$f" "$(head -c 60 "$f" 2>/dev/null | tr -d '\0\n' )"
done
echo "--- 关键钩子目录当前内容"
for d in /etc/bash_completion.d /etc/profile.d /etc/apt/apt.conf.d /etc/logrotate.d /etc/network/interfaces.d; do
  [ -d "$d" ] && { echo "  [$d]"; tt ls -la "$d" 2>/dev/null | tail -n +2 | head -20 | sed 's/^/    /'; }
done
echo "--- 登录即执行的加载链（最危险的一环）"
tt grep -rnE 'bash_completion\.d|^\. |^source ' /etc/profile /etc/bash.bashrc /etc/profile.d/*.sh /root/.bashrc /root/.profile /home/*/.bashrc /home/*/.profile 2>/dev/null \
  | grep -viE 'usr/share/bash-completion|XDG|resolv' | cut -c1-180 | head -20 | sed 's/^/  /'
echo "--- 用户级 rc 文件里的可疑加载"
tt grep -rlnE 'curl|wget|/tmp/|base64|eval ' /root/.bashrc /root/.profile /root/.bash_profile /home/*/.bashrc /home/*/.profile /home/*/.bash_profile 2>/dev/null | sed 's/^/  /' | head -10
echo "--- 用户级 bash_completion.d（比 /etc 更隐蔽）"
for d in /root/.bash_completion.d /home/*/.bash_completion.d /usr/share/bash-completion/completions; do
  [ -d "$d" ] || continue
  r=$(tt find "$d" -maxdepth 1 -newermt "$SINCE" 2>/dev/null)
  [ -n "$r" ] && { echo "  [$d]"; echo "$r" | sed 's/^/    ⚠️ /'; }
done
echo "--- ld.so.preload（用户态 rootkit）"
if [ -f /etc/ld.so.preload ]; then echo "  ⚠️ 存在: $(cat /etc/ld.so.preload)"; else echo "  无 ✔"; fi
echo "--- PAM 后门（只认能执行命令的 pam_exec/pam_python；pam_permit 是系统自带，不算）"
tt grep -rnE '^[[:space:]]*[^#].*pam_(exec|python|script)\.so' /etc/pam.d/ 2>/dev/null | cut -c1-200 | sed 's/^/  ⚠️ /' | head -5
echo "--- 近期变动的动态库（库劫持）"
tt find /lib /lib64 /usr/lib /usr/lib64 /usr/local/lib -xdev -name '*.so*' -newermt "$SINCE" -printf '  %TY-%Tm-%Td %p\n' 2>/dev/null | head -10
echo "--- initramfs 钩子"
tt grep -rlE 'curl|wget|/dev/tcp|base64' /etc/initramfs-tools/ /etc/dracut.conf.d/ 2>/dev/null | sed 's/^/  ⚠️ /' | head -10

# ================= 9. 持久化 - systemd =================
sec "9. PERSISTENCE: SYSTEMD"
echo "--- 近 ${DAYS}d 新增/修改的 unit"
tt find /etc/systemd/system /usr/lib/systemd/system /run/systemd/system -maxdepth 2 -newermt "$SINCE" -printf '  %TY-%Tm-%Td %TH:%TM %p\n' 2>/dev/null | sort | head -30
echo "--- ExecStart 指向 /tmp 或 shell（强特征；系统自带 unit 标 [pkg] 备查）"
for f in $(tt grep -rlE 'ExecStart=.*(/tmp/|/dev/shm|/var/tmp|/bin/sh -c|bash -c)' /etc/systemd/system /usr/lib/systemd/system 2>/dev/null | head -15); do
  if dpkg -S "$f" >/dev/null 2>&1 || rpm -qf "$f" >/dev/null 2>&1; then
    echo "  [pkg] $f"
  else
    echo "  ⚠️ $f"
  fi
done
echo "--- 已启用单元"
tt systemctl list-unit-files --state=enabled --no-pager 2>/dev/null | head -30 | sed 's/^/  /'
echo "--- timers"
tt systemctl list-timers --all --no-pager 2>/dev/null | head -12 | sed 's/^/  /'
echo "--- 用户级 systemd（systemctl --user）"
tt ls -la /home/*/.config/systemd/user /root/.config/systemd/user 2>/dev/null | head -15 | sed 's/^/  /'
echo "--- 服务启动方式异常（手动启动 = 重启即失守）"
hint "systemctl is-enabled 全部为 enabled 才算持久；手动 start 的服务重启后消失，需记录"

# ================= 10. 落地文件与 IOC =================
sec "10. ARTIFACTS / IOC"
echo "--- /tmp /dev/shm /var/tmp 可执行文件与脚本"
tmp_exec | while read -r f; do tt stat -c '  %y %10s %U %n' "$f" 2>/dev/null; done | sort | head -25
echo "--- 按内容特征扫（OOB 回连 / 反弹 shell / 下载执行）"
# 时间窗内优先；时间窗外的只计数不逐条列（避免历史扫描残留淹没现场）
r=$(ioc_scan /etc /tmp /var/tmp /dev/shm /usr/local/bin /usr/local/sbin /root /home)
if [ -n "$r" ]; then
  inwin=$(echo "$r" | while read -r f; do [ -n "$(find "$f" -newermt "$SINCE" 2>/dev/null)" ] && echo "$f"; done)
  old=$(echo "$r" | wc -l | tr -d ' ')
  echo "$inwin" | head -25 | sed 's/^/  ⚠️ /'
  inwin_n=$(echo "$inwin" | grep -c . )
  [ "$inwin_n" -lt "$old" ] && echo "  [NOTE] 另有 $((old-inwin_n)) 个同特征文件早于 ${DAYS}d 窗口（历史扫描残留，未逐条列出）"
  [ "$inwin_n" -eq 0 ] && echo "  [NOTE] 命中文件全部早于 ${DAYS}d 窗口 → 历史遗留，非近期活动"
else
  echo "  无命中 ✔"
fi
echo "--- PID/UID 标记型产物（采集脚本的痕迹: *-exec-* *-uid-* *-who-*）"
d=$(tt find /tmp /var/tmp /dev/shm /root /home -maxdepth 3 \( -name '*-exec-*' -o -name '*-uid-*' -o -name '*-who-*' -o -name '*-bashcomp*' \) 2>/dev/null | head -30)
[ -n "$d" ] && echo "$d" | sed 's/^/  ⚠️ /' || echo "  无 ✔"
echo "--- 全盘按名前缀找同族样本"
if [ -n "$IOC_NAME" ]; then
  tt find / -xdev -maxdepth 4 -name "$IOC_NAME" 2>/dev/null | head -40 | sed 's/^/  /'
else
  note "未指定 --ioc-prefix（如 'evil*'），跳过按名聚类"
fi
echo "--- 近 7d 在 /var/log 生成的非标准日志"
tt find /var/log -maxdepth 1 -type f -newermt "$(date -d '7 days ago' +%Y-%m-%d 2>/dev/null || date -v-7d +%Y-%m-%d)" -printf '  %TY-%Tm-%Td %TH:%TM %10s %p\n' 2>/dev/null \
  | grep -vE 'auth\.log|secure|syslog|messages|kern\.log|dpkg\.log|wtmp|btmp|lastlog|alternatives|\.gz|faillog|sysstat|cloud-init' | sort | head -25
echo "--- bash_history 可疑命令"
for h in /root/.bash_history /home/*/.bash_history; do
  [ -f "$h" ] || continue
  out=$(tt grep -nE 'curl|wget|chmod \+x|base64 -d|/dev/tcp|nc -|history -c|rm -rf /var/log|unset HIST|sh -i' "$h")
  [ -n "$out" ] && { echo "  [$h] mtime=$(tt stat -c %y "$h" | cut -d. -f1)"; echo "$out" | tail -15 | sed 's/^/    /'; }
done
echo "--- 历史被清空的迹象（size=0 或 mtime 早于登录）"
tt stat -c '  %n size=%s mtime=%y' /root/.bash_history 2>/dev/null

# ================= 11. Web / 应用层 =================
sec "11. WEB / APPLICATION"
echo "--- web 根目录与上传目录"
for d in /var/www /web /static /app /data /opt/app; do
  [ -d "$d" ] && { echo "  [$d] $(tt ls -ld "$d" | awk '{print $1,$3,$4}')"; tt ls -la "$d" 2>/dev/null | head -12 | sed 's/^/    /'; }
done
echo "--- webshell 内容特征（jsp/php/jspx/aspx）"
r=$(cscan "$WS_PAT" /var/www /web /opt /data /tmp/upload /tmp /var/tmp /dev/shm 2>/dev/null | head -15)
[ -n "$r" ] && echo "$r" | sed 's/^/  ⚠️ /' || echo "  无命中 ✔"
echo "--- 上传目录统计"
for d in /tmp/upload /var/www/upload /opt/app/upload /data/upload /opt/app/tmp; do
  [ -d "$d" ] && {
    echo "  [$d] count=$(tt find "$d" -maxdepth 1 2>/dev/null | wc -l) size=$(tt du -sh "$d" 2>/dev/null | awk '{print $1}')"
    tt ls -la --time-style=+%F_%H:%M "$d" 2>/dev/null | awk 'NR>3' | sort -k6 | sed -n '1p;$p' | sed 's/^/    最早\/最晚 /'
  }
done
echo "--- 上传目录里 OOB 探测样本的性质（区分「探测/扫描」与「真实执行代码」）"
for d in /tmp/upload /var/www/upload /opt/app/upload /data/upload; do
  [ -d "$d" ] || continue
  tot=$(tt find "$d" -maxdepth 2 -type f 2>/dev/null | wc -l | tr -d ' ')
  oob=$(tt grep -rlE "$IOC_CONTENT" "$d" 2>/dev/null | wc -l | tr -d ' ')
  real=$(cscan "$WS_PAT" "$d" | wc -l | tr -d ' ')
  days=$(tt find "$d" -maxdepth 1 -type f 2>/dev/null | head -400 | xargs -r stat -c %y 2>/dev/null | cut -d' ' -f1 | sort -u | wc -l | tr -d ' ')
  echo "  [$d] 总文件=$tot 命中OOB=$oob 含真实执行代码=$real 涉及天数=$days"
  if [ "$real" = "0" ] && [ "$oob" -gt 0 ]; then
    echo "    ↳ OOB 全是探测型载荷（XXE/SVG/SSI/XInclude），无真实命令执行代码 → 多为扫描/渗透测试遗留，非本次入侵"
  elif [ "$real" -gt 0 ]; then
    echo "    ⚠️ 存在真实可执行代码，按 webshell 处置"
  fi
done
echo "--- 上传目录里的穿越/注入型文件名（强特征）"
tt find /tmp/upload /var/www /web /data /opt -maxdepth 4 -type f \
  \( -name '*%2f*' -o -name '*..*' -o -name '*sleep*' -o -name '*jndi*' -o -name '*${*' -o -name '*.jsp.*' -o -name '*shell*' -o -name '*passwd*' -o -name '*canary*' \) \
  -printf '  %TY-%Tm-%Td %TH:%TM %8s %p\n' 2>/dev/null | sort | head -30
echo "--- 应用日志里的攻击特征"
for f in $(tt find /opt/app/log /var/log /data -maxdepth 5 -name '*error*.log' -newermt "$SINCE" 2>/dev/null | head -8); do
  n=$(tt grep -aici 'jndi:' "$f")
  [ "${n:-0}" -gt 0 ] && echo "  ⚠️ $f  jndi命中=$n"
done
echo "--- 应用进程运行用户（root 跑 web = 一旦 RCE 直接全盘可控）"
tt ps -eo user,pid,args | grep -E 'java .*-jar|node .*server|python .*app' | grep -v grep | awk '{print "  "$1" pid="$2" "$NF}' | head -10

# ================= 12. 完整性 =================
sec "12. INTEGRITY"
echo "--- 关键二进制 mtime"
tt stat -c '  %n mtime=%y' /usr/bin/ssh /usr/bin/curl /usr/bin/wget /bin/bash /usr/sbin/sshd \
  /usr/bin/crontab /usr/bin/systemctl /usr/bin/sudo /usr/bin/passwd 2>/dev/null
echo "--- 近 ${DAYS}d 变更的 SUID 文件"
tt find / -xdev -perm -4000 -type f -newermt "$SINCE" -printf '  %TY-%Tm-%Td %p\n' 2>/dev/null | head -10
echo "--- SUID 全量（非标准路径人工看）"
tt find / -xdev -perm -4000 -type f 2>/dev/null | head -40 | sed 's/^/  /'
echo "--- 世界可写目录里的可执行文件"
tt find /tmp /var/tmp /dev/shm -maxdepth 2 -perm -o+w -type f -printf '  %p\n' 2>/dev/null | head -10
echo "--- 关键文件哈希（留存基线，便于比对）"
tt sha256sum /etc/passwd /etc/shadow /etc/group /etc/sudoers /etc/ssh/sshd_config \
  /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys 2>/dev/null | sed 's/^/  /'
echo "--- 包完整性抽查（核心 5 个包，全量很慢）"
if command -v dpkg >/dev/null 2>&1; then
  # 只报二进制/库的篡改；文档、man、locale 的 md5 差异在容器/裁剪系统里普遍存在，全是噪音
  tt dpkg -V coreutils openssh-server openssh-client sudo bash 2>/dev/null \
    | grep -E '(/bin/|/sbin/|/lib/|/usr/lib/)' | grep -vE '/doc/|/man/|/locale/' | head -15 | sed 's/^/  ⚠️ /'
  note "全量: dpkg -V | head -40（慢，按需；注意 /doc /man 的差异多为噪音）"
elif command -v rpm >/dev/null 2>&1; then
  tt rpm -Va --nomtime --nosize --nofiledigest 2>/dev/null | grep -vE '^\.' | head -15 | sed 's/^/  ⚠️ /'
fi

# ================= 13. 汇总 =================
sec "13. SUMMARY"
crit=0; warn=0
chk(){ if [ -n "${2:-}" ]; then crit=$((crit+1)); echo "  [CRITICAL] $1"; echo "$2" | head -6 | sed 's/^/      /'; fi; }
wr(){ if [ -n "${2:-}" ]; then warn=$((warn+1)); echo "  [WARN] $1"; echo "$2" | head -4 | sed 's/^/      /'; fi; }

chk "配置目录存在伪装成图片的文件" \
  "$(tt find /etc -xdev -regextype posix-extended -regex "$FAKE_IMG" -type f 2>/dev/null | head -5)"
_oob_all=$(ioc_scan /etc /tmp /var/tmp /dev/shm)
_oob_in=$(echo "$_oob_all" | while read -r f; do [ -n "$f" ] && [ -n "$(find "$f" -newermt "$SINCE" 2>/dev/null)" ] && echo "$f"; done)
_oob_n=$(echo "$_oob_all" | grep -c . )
_oob_in_n=$(echo "$_oob_in" | grep -c . )
_exec_n=$(cscan "$WS_PAT" /etc /tmp /var/tmp /dev/shm /root /home | wc -l | tr -d ' ')
_shell_n=$(cscan '/dev/tcp/|bash -i >&|nc -e|ncat -e|socat.*exec' /etc /tmp /var/tmp /dev/shm /root /home | wc -l | tr -d ' ')
if [ "${_oob_in_n:-0}" -gt 0 ]; then
  crit=$((crit+1)); echo "  [CRITICAL] 时间窗内存在 OOB 回连载荷（${_oob_in_n} 个）"
  echo "$_oob_in" | head -6 | sed 's/^/      /'
else
  [ "${_oob_n:-0}" -gt 0 ] && echo "  [INFO] 有 ${_oob_n} 个 OOB 特征文件，但全部早于 ${DAYS}d 窗口 → 历史扫描残留，非近期活动"
fi
[ "${_oob_n:-0}" -gt 0 ] && [ "${_oob_in_n:-0}" -gt 0 ] && [ "${_oob_n}" -gt "${_oob_in_n}" ] \
  && echo "  [INFO] 另有 $((_oob_n-_oob_in_n)) 个同特征文件早于 ${DAYS}d 窗口（历史扫描残留，未计入 CRITICAL）"
if [ "${_oob_n:-0}" -gt 0 ]; then
  if [ "${_exec_n:-0}" = "0" ] && [ "${_shell_n:-0}" = "0" ]; then
    echo "      ↳ 判读: 仅探测型载荷（XXE/SVG/SSI/XInclude/OAST），无 webshell 代码、无反弹 shell → 扫描器或渗透测试遗留"
  else
    echo "      ⚠️ 判读: 同时发现 webshell 代码 ${_exec_n} 个 / 反弹 shell ${_shell_n} 个 → 按真实入侵处置"
  fi
fi
chk "有进程从 /tmp · /dev/shm · /var/tmp 运行" \
  "$(ps_no_self | grep -E '(/tmp/|/dev/shm/|/var/tmp/)' | grep -v grep | head -3)"
chk "存在 oast/interactsh 回连进程" \
  "$(tt ps -eo user,pid,args | grep -E 'oast\.live|oast\.pro|interactsh' | grep -v grep | head -3)"
wr "cron.d / crontabs 里存在非普通文件（目录插入手法；cron 会报 NOT A REGULAR FILE 并忽略，未生效）" \
  "$(tt find /etc/cron.d /var/spool/cron/crontabs -mindepth 1 ! -type f 2>/dev/null | head -5)"
chk "ld.so.preload 存在（用户态 rootkit）" \
  "$(tt cat /etc/ld.so.preload 2>/dev/null)"
chk "有已删除但仍运行的二进制（临时/业务路径）" \
  "$(del_exe_susp | head -3)"
chk "systemd ExecStart 指向 /tmp 或 shell" \
  "$(for f in $(tt grep -rlE 'ExecStart=.*(/tmp/|/dev/shm|/var/tmp)' /etc/systemd/system /usr/lib/systemd/system 2>/dev/null); do
       dpkg -S "$f" >/dev/null 2>&1 || rpm -qf "$f" >/dev/null 2>&1 || echo "$f"; done | head -3)"
chk "存在 webshell / 命令执行代码" \
  "$(cscan "$WS_PAT" /var/www /web /opt /data /tmp /var/tmp /dev/shm /root /home 2>/dev/null | head -3)"
wr "临时目录存在可执行文件" \
  "$(tt find /tmp /var/tmp /dev/shm -maxdepth 2 -type f -perm -u+x 2>/dev/null | head -4)"
wr "存在 shell -c 派生进程（需判断是否 webshell 触发）" \
  "$(ps_no_self | grep -E '\b(sh|bash|dash)\b -c' | grep -v grep \
       | grep -vE 'finalshell_separator|Xshell|MobaXterm|termius' | head -4)"
wr "存在近期变更且无包归属的动态库（库劫持）" \
  "$(so_unowned | head -3)"

echo
echo "  [REVIEW] authorized_keys 注释字段（陌生 key 需人工确认）"
for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do
  [ -f "$f" ] || continue
  echo "      $f  mtime=$(tt stat -c %y "$f" 2>/dev/null | cut -d. -f1)"
  tt awk 'NF>2{print "        "$NF}' "$f" | head -5
done
echo
echo "  当前在线会话来源（是否为运维出口，人工确认）"
tt who 2>/dev/null | awk '{print "      "$1" "$2" "$5}' | head -10
echo
echo "  CRITICAL 计数: $crit    WARN: $warn"
if [ "$crit" -eq 0 ]; then
  echo "  → 未命中已知强特征；仍需人工核验第 4（登录来源）/ 7（cron）/ 10（落地文件）节"
else
  echo "  → 命中强特征，按应急响应流程处理；先摘 hook 再删样本，最后重启验证"
fi
echo
echo "### DONE $(date '+%F %T')"
}

# --html-only: 只把已有 report.txt 重新渲染成网页，不采集
if [ -n "$HTML_ONLY" ]; then
  R=$(cd "$(dirname "$HTML_ONLY")" 2>/dev/null && pwd)/$(basename "$HTML_ONLY") 2>/dev/null || R="$HTML_ONLY"
  [ -f "$R" ] || { echo "找不到 report.txt: $HTML_ONLY"; exit 1; }
  # 从报告头部回收 host / window
  HOSTN=$(sed -n 's/^ host     : //p' "$R" 2>/dev/null | head -1); [ -n "$HOSTN" ] || HOSTN=unknown
  _d=$(sed -n 's/^ window   : \([0-9]*\)d.*/\1/p' "$R" 2>/dev/null | head -1); [ -n "$_d" ] && DAYS=$_d
  OUT=$(dirname "$R")
  render_html "$R" "${R%.txt}.html"
  exit $?
fi

main 2>&1 | tee "$REPORT"

# 立刻出网页版（与 txt 同目录，同名 .html）
render_html "$REPORT" "${REPORT%.txt}.html"

# ============================================================
# 14. 取证包（只收可疑原件，不含正常系统包文件）
# ============================================================
if [ "$DO_PACK" = "1" ]; then
  echo
  echo "### SECTION: 14. EVIDENCE PACK"
  L="$OUT/.list.$$"; M="$OUT/.meta.$$"
  : > "$L"; : > "$M"

  # 1) /etc 下伪装成图片的文件
  find /etc -xdev -regextype posix-extended -regex "$FAKE_IMG" -type f 2>/dev/null >> "$L"
  # 2) 钩子目录里「无包归属 且 时间窗内有改动」的文件
  #    注: dpkg -S 对 conffile(如 20auto-upgrades) 也查不到, 故必须叠加 mtime 过滤,
  #        否则会把全部系统默认配置打包进来
  for d in /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/bash_completion.d /etc/profile.d \
           /etc/apt/apt.conf.d /etc/logrotate.d /etc/network/interfaces.d \
           /etc/dhcp/dhclient-enter-hooks.d /etc/dhcp/dhclient-exit-hooks.d \
           /etc/initramfs-tools/conf.d /etc/initramfs-tools/scripts /etc/sudoers.d /usr/local/bin; do
    [ -d "$d" ] || continue
    find "$d" -maxdepth 1 -type f -newermt "$SINCE" 2>/dev/null | while read -r f; do
      dpkg -S "$f" >/dev/null 2>&1 || echo "$f" >> "$L"
    done
  done
  # 3) 钩子目录里被造成的「目录」（cron 手法；排除 crontabs/atjobs/atspool 这类系统目录本身）
  for d in /etc/cron.d /var/spool/cron/crontabs /etc/bash_completion.d /etc/logrotate.d; do
    [ -d "$d" ] || continue
    find "$d" -mindepth 1 -type d 2>/dev/null >> "$L"
  done
  # 4) 内容命中 IOC 的文件（只收时间窗内的；窗外历史扫描残留只留清单不留原件）
  for f in $(ioc_scan /etc /tmp /var/tmp /dev/shm /usr/local/bin /usr/local/sbin); do
    [ -n "$(find "$f" -newermt "$SINCE" 2>/dev/null)" ] && echo "$f" >> "$L"
  done
  # 5) 临时目录里的可执行文件 / 脚本（排除脚本自身、本报告、以及本工具历次产出目录）
  find /tmp /var/tmp /dev/shm -maxdepth 2 -type f \( -perm -u+x -o -name '*.sh' -o -name '*-exec-*' -o -name '*-uid-*' -o -name '*-who-*' \) 2>/dev/null \
    | grep -vxF "$SELF_PATH" | grep -v 'hunt-linux\.sh' | grep -v "^${OUT}/" | while read -r f; do
        is_artifact "$f" || echo "$f"
      done >> "$L"
  # 6) 指定前缀
  [ -n "$IOC_NAME" ] && find / -xdev -maxdepth 4 -name "$IOC_NAME" 2>/dev/null >> "$L"

  # 元数据快照（不入 samples，单独一份便于阅读）
  {
    echo "===== EVIDENCE META  $(date '+%F %T') ====="
    echo "== host"; hostname; uname -a
    echo "== stat 关键文件"; stat /etc/passwd /etc/shadow /etc/group /etc/sudoers \
        /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys 2>/dev/null
    echo "== /etc/cron.d"; ls -la /etc/cron.d 2>/dev/null
    echo "== /etc/bash_completion.d"; ls -la /etc/bash_completion.d 2>/dev/null
    echo "== cron 报错"; grep -iE 'NOT A REGULAR FILE|WRONG' /var/log/syslog 2>/dev/null | tail -50
    echo "== auth.log 尾"; tail -400 /var/log/auth.log 2>/dev/null || tail -400 /var/log/secure 2>/dev/null
    echo "== listeners"; ss -tulnp 2>/dev/null
    echo "== ps 全量"; ps -eo user,pid,ppid,etime,args 2>/dev/null
    echo "== who"; who -a 2>/dev/null
    echo "== last"; last -a -F 2>/dev/null | head -60
  } > "$M" 2>/dev/null

  # 空目录（攻击者的 mkdir 手法）只留名字做证据，不进采样清单
  sort -u "$L" 2>/dev/null | grep -vE '^$|^/proc/|^/sys/' \
    | grep -vxF "$SELF_PATH" | grep -v 'hunt-linux\.sh' | grep -v "^${OUT}" \
    | while read -r f; do [ -d "$f" ] && continue; echo "$f"; done | head -400 > "$L.u"
  N=$(wc -l < "$L.u" 2>/dev/null | tr -d ' ')

  # sha256 清单（保管链，取证要用）
  MAN="$OUT/samples_manifest.txt"
  {
    echo "===== SAMPLES MANIFEST  $(date '+%F %T')  host=$HOSTN ====="
    echo "# sha256  size  mtime  path"
    while read -r f; do
      [ -f "$f" ] || continue
      printf '%s  %10s  %s  %s\n' "$(sha256sum "$f" 2>/dev/null | awk '{print $1}')" \
        "$(stat -c %s "$f" 2>/dev/null)" "$(stat -c %y "$f" 2>/dev/null | cut -d. -f1)" "$f"
    done < "$L.u"
  } > "$MAN" 2>/dev/null

  tar czf "$PACK" -T "$L.u" "$M" 2>/dev/null
  RC=$?

  SZ=$(du -h "$PACK" 2>/dev/null | awk '{print $1}')
  echo "  清单条数 : ${N:-0}（上限 400）"
  echo "  取证包   : $PACK  ${SZ:-0}  rc=$RC"
  echo "  哈希清单 : $MAN"
  _hist=$(ioc_scan /etc /tmp /var/tmp /dev/shm 2>/dev/null | while read -r f; do
            [ -n "$(find "$f" -newermt "$SINCE" 2>/dev/null)" ] || echo "$f"; done | wc -l | tr -d ' ')
  [ "${_hist:-0}" -gt 0 ] && echo "  [NOTE] 另有 ${_hist} 个 OOB 特征文件在 ${DAYS}d 窗口之外未打包（历史扫描残留）；需要时加大 --days 复扫纳入"
  if [ "${N:-0}" = "400" ]; then
    echo "  ⚠️ 已达 400 条上限，可能有遗漏；用 --ioc-prefix 缩小范围后再补采"
  fi
  rm -f "$L" "$L.u" "$M"

  # 摘要
  {
    echo "===== $HOSTN 入侵排查摘要  $(date '+%F %T') ====="
    echo
    sed -n '/### SECTION: 13. SUMMARY/,/### DONE/p' "$REPORT" 2>/dev/null
    echo
    echo "--- 关键计数"
    printf '  /etc 伪装图片 文件     : %s\n' "$(find /etc -xdev -regextype posix-extended -regex "$FAKE_IMG" -type f 2>/dev/null | wc -l | tr -d ' ')"
    printf '  /etc 伪装图片 目录     : %s\n' "$(find /etc -xdev -regextype posix-extended -regex "$FAKE_IMG" -type d 2>/dev/null | wc -l | tr -d ' ')"
    printf '  临时目录可执行文件     : %s\n' "$(tmp_exec | wc -l | tr -d ' ')"
    printf '  取证包样本数           : %s\n' "${N:-0}"
    printf '  在线会话数             : %s\n' "$(who 2>/dev/null | wc -l | tr -d ' ')"
    printf '  成功登录来源数         : %s\n' "$(zgrep -h 'Accepted' /var/log/auth.log* /var/log/secure* 2>/dev/null | grep -oE 'from [0-9a-f.:]+' | sort -u | wc -l | tr -d ' ')"
    echo
    echo "--- 成功登录来源 top5"
    zgrep -h 'Accepted' /var/log/auth.log* /var/log/secure* 2>/dev/null | grep -oE 'for [^ ]+ from [0-9a-f.:]+' | sort | uniq -c | sort -rn | head -5 | sed 's/^/  /'
    echo
    echo "--- 可疑文件（去重前 30）"
    find /etc -xdev -regextype posix-extended -regex "$FAKE_IMG" -type f 2>/dev/null | sort | head -30 | sed 's/^/  /'
    echo
    echo "--- 报告全文: $REPORT"
    echo "--- 取证包  : $PACK"
  } > "$SUMMARY" 2>/dev/null

  echo
  echo "=============================================================="
  echo " 产出目录: $OUT"
  ls -la "$OUT" 2>/dev/null | sed 's/^/   /'
  echo "=============================================================="
  echo " 下一步:"
  echo "   0) 看网页    open $OUT/report.html   （或 scp 回本地双击打开）"
  echo "   1) 读摘要    less $SUMMARY"
  echo "   2) 跳读全文  grep -n '### SECTION' $REPORT"
  echo "   3) 看样本    tar tzf $PACK"
  echo "   4) 保管链    sha256sum -c $MAN 2>/dev/null || cat $MAN"
fi

echo
echo "### COMPLETE $(date '+%F %T')"
