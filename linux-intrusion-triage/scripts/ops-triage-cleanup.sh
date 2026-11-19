#!/bin/bash
# ops-triage-cleanup.sh — 清理 /tmp 下的「排查残留」（自己的脚本 / 采集报告 / 解包物）
# 用法: bash ops-triage-cleanup.sh plan    # 只列清单，不删（必跑这道）
#       bash ops-triage-cleanup.sh apply   # 真删
# 约定: 报告目录先 cp -a 进 /root/evidence-<date>/tmp-residue/ 再 apply。
#       系统项(arthas/cls/tomcat/hsperfdata/pg_wal_backup/aliyun/socket/lock)不在模式表里，永远不会被命中。
MODE="${1:-plan}"
PATTERNS=(
  'ioc*.sh' 'hunt*.sh' 'ir2' 'ir2.log' 'triage*' 'j2*.sh' 'n*.sh' 'nssh'
  'cj*.sh' 'deep*.sh' 'out1.log' 'o_[0-9]*' 'uo.b' 'v.txt' 'p.json' 'pm2j.json'
  'xxl_cookie.txt' 'dev_cookie*.txt' 'jobinfo.html' 'ji.json' 'f.txt' 'ck*.txt'
  '*187*.sh' '*187*.sql' 'q187*' 'fix187*' 'live.sh' 'ev.sh' 'expr.sh' 'vb.sh'
  'ip.sh' 'tok.sql' 'runq*' 'q_*' 'pg[0-9]*.sh' 'pwt*.sh' 'src*.sh' 'f[0-9]*.sh'
  'pre187*' 'inspect*' 'apply*' 'backup*' 'create_*' 'verify*' 'update_pwd*'
  'diag_*' 'dis*.sh' 'dryrun*' 'dump*' 'e2e*' 'fix_ctxpath*' 'rm_ctxpath*'
  'final*' 'recheck.sh' 'iocscan.sh' 'xxlchk' 'jl' 'jz*' 'jarchk' 'jx' 'hunt*out*'
)
LIST=/tmp/ops-triage-list.txt
: > "$LIST"
for p in "${PATTERNS[@]}"; do
  find /tmp -maxdepth 1 -name "$p" -print 2>/dev/null >> "$LIST"
done
sort -u "$LIST" -o "$LIST"

# 安全检查: 取证目录 / 本工具自身 / socket / lock / /tmp 本身 一律剔除
grep -vE '/evidence-|/ops-triage-|\.lock$|\.sock$|^/tmp/$' "$LIST" > "${LIST}.safe"

echo "=== 待删清单 ($(wc -l < "${LIST}.safe") 项)"
cat "${LIST}.safe"
echo "=== 被安全检查剔除的:"
comm -23 "$LIST" "${LIST}.safe"
echo "=== 总大小"
du -ch $(tr '\n' ' ' < "${LIST}.safe") 2>/dev/null | tail -1
echo "=== 大目录复核（>10M 的必须确认是解包物/日志，不是业务数据）"
du -sh $(tr '\n' ' ' < "${LIST}.safe") 2>/dev/null | sort -h | tail -5

if [ "$MODE" != "apply" ]; then echo "=== PLAN ONLY (未删除)"; exit 0; fi
xargs -r rm -rf < "${LIST}.safe"
echo "=== 删除后剩余非系统项（root 文件会报 Operation not permitted → 需 sudo -n rm -rf 补一轮）:"
ls -A /tmp | grep -vE 'tomcat|hsperfdata|\.X11-unix|\.ICE-unix|\.Test-unix|\.font-unix|\.XIM-unix|systemd-private|\.sock|\.lock|^[Aa]liyun|java_pid'
