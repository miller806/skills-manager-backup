#!/bin/bash
# Host health snapshot for a macOS host (Mac mini) — output is fed to a cron agent for judging.
# Sections are fixed-order and always print something so the agent never mistakes silence for health.
# The last section is a PRE-RENDERED report block: aligned columns + ▰▱ bars, ready to paste into
# a markdown code block. Keep the alignment ASCII-width based (no emoji inside the block), because
# terminals and Discord measure CJK glyphs as double-width and emoji as double-width too.
# Usage: bash macmini_health.sh
# Thresholds and how to read each metric: references/host-metrics-thresholds.md
export LC_ALL=C
PAGE=$(sysctl -n hw.pagesize 2>/dev/null || echo 16384)
TOTAL_MEM=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
MEM_GB=$((TOTAL_MEM/1024/1024/1024))
NCPU=$(sysctl -n hw.ncpu 2>/dev/null || echo 0)

# ▰▱ bar: bar <percent 0-100> [cells]  (ASCII-safe output, 10 cells default)
bar() {
  awk -v p="$1" -v w="${2:-10}" 'BEGIN{
    n=int((p+5)/10); if(n>w)n=w; if(n<0)n=0; s="";
    for(i=0;i<n;i++)s=s"▰"; for(i=n;i<w;i++)s=s"▱"; printf "%s", s
  }'
}

echo "===== HOST: $(hostname) ====="
echo "TIME: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "UPTIME:$(uptime | sed 's/.*up / /; s/,.*users.*load/ | load/')"
echo

# ---------- collect once, reuse everywhere ----------
MEMVALS=$(vm_stat | awk -v p="$PAGE" '
  /Pages free/                   {gsub(/\./,"",$3); free=$3}
  /Pages active/                 {gsub(/\./,"",$3); active=$3}
  /Pages inactive/               {gsub(/\./,"",$3); inactive=$3}
  /Pages wired down/             {gsub(/\./,"",$4); wired=$4}
  /Pages occupied by compressor/ {gsub(/\./,"",$5); comp=$5}
  END {
    used = (active + wired + comp) * p / 1073741824;
    printf "%.1f %.1f %.1f %.1f", used, free*p/1073741824, inactive*p/1073741824, comp*p/1073741824
  }')
read -r MEM_USED MEM_FREE MEM_INACTIVE MEM_COMP <<<"$MEMVALS"
[ -z "$MEM_USED" ] && MEM_USED=0
MEM_PCT=$(awk -v u="$MEM_USED" -v t="$MEM_GB" 'BEGIN{ if(t>0) printf "%.0f", u*100/t; else print "0" }')
# compressed is judged against the 6 GB alert threshold, shown as a fill of that budget
COMP_PCT=$(awk -v c="$MEM_COMP" 'BEGIN{ printf "%.0f", c*100/6 }')
SWAP_USED=$(sysctl -n vm.swapusage 2>/dev/null | sed 's/.*used = //; s/ free.*//; s/M$//')
[ -z "$SWAP_USED" ] && SWAP_USED=0
DISK_LINE=$(df -h /System/Volumes/Data 2>/dev/null | awk 'NR==2 {print $3" "$2" "$5}')
DISK_USED=$(echo "$DISK_LINE" | awk '{print $1}' | sed 's/Gi$/G/')
DISK_TOTAL=$(echo "$DISK_LINE" | awk '{print $2}' | sed 's/Gi$/G/')
DISK_CAP=$(echo "$DISK_LINE" | awk '{gsub(/%/,"",$3); print $3}')
[ -z "$DISK_CAP" ] && DISK_CAP=0
LOAD1=$(uptime | sed 's/.*load averages*: *//' | awk '{print $1}')
LOAD_PCT=$(awk -v l="$LOAD1" -v n="$NCPU" 'BEGIN{ if(n>0) printf "%.0f", l*100/n; else print "0" }')
FREE_PCT=$(memory_pressure 2>/dev/null | grep -i 'System-wide memory free percentage' | sed 's/.*: //')
# gateway liveness: under launchd the process argv carries no "hermes gateway run" literal
# (it is a wrapped python -c bootstrap), so pgrep on the argv can never match. Read the pid
# file instead and verify the pid is alive AND still a hermes process. No port fallback:
# 20128 is held by an unrelated next-server on this host, so probing it gives false "up".
GW_PID=""
GW_PIDFILE="$HOME/.hermes/gateway.pid"
if [ -f "$GW_PIDFILE" ]; then
  GW_FILE_PID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pid"])' "$GW_PIDFILE" 2>/dev/null)
  if [ -n "$GW_FILE_PID" ] && ps -p "$GW_FILE_PID" -o command= 2>/dev/null | grep -q "hermes"; then
    GW_PID="$GW_FILE_PID"
  fi
fi

echo "----- MEMORY -----"
echo "PHYS: ${MEM_GB} GB  (${NCPU} cores)"
echo "USED(active+wired+comp): ${MEM_USED} GB (${MEM_PCT}%)"
echo "FREE: ${MEM_FREE} GB  INACTIVE: ${MEM_INACTIVE} GB  COMPRESSED: ${MEM_COMP} GB"
echo "SWAP: $(sysctl -n vm.swapusage)"
echo "FREE_PCT: ${FREE_PCT:-no data}   # NOTE: this is FREE percent, not pressure"
echo

echo "----- DISK -----"
df -h / /System/Volumes/Data 2>/dev/null || echo "df failed"
echo

echo "----- TOP 5 CPU -----"
ps -Aceo pcpu,pmem,rss,comm -r | head -6 || echo "ps failed"
echo

echo "----- TOP 5 MEM -----"
ps -Aceo pcpu,pmem,rss,comm -m | head -6 || echo "ps failed"
echo

echo "----- THERMAL -----"
pmset -g therm 2>/dev/null | grep -Ei 'CPU_Speed_Limit|CPU_Scheduler_Limit' || echo "no thermal throttling (not a collection failure)"
echo

echo "----- DOCKER -----"
DOCKER_PS=""
if pgrep -qf "Docker Desktop|com.docker.backend"; then
  echo "daemon: running"
  DOCKER_PS=$(docker ps --format '{{.Names}}|{{.Status}}' 2>/dev/null)
  if [ -n "$DOCKER_PS" ]; then echo "$DOCKER_PS" | tr '|' '\t'; else echo "no containers"; fi
  echo "running: $(docker ps -q 2>/dev/null | wc -l | tr -d ' ') / all: $(docker ps -aq 2>/dev/null | wc -l | tr -d ' ')"
else
  echo "daemon: NOT running"
fi
echo

echo "----- SERVICES -----"
if [ -n "$GW_PID" ]; then echo "hermes gateway: up (pid $GW_PID)"; else echo "hermes gateway: DOWN"; fi
pgrep -q "browser_harness.daemon" && echo "browser harness: up" || echo "browser harness: down (on-demand, expected)"
echo

echo "----- LISTENING PORTS -----"
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {print $1, $9}' | sort -u | head -15 || echo "lsof failed"
echo

echo "----- RECENT CRASHES -----"
ls -lt ~/Library/Logs/DiagnosticReports/*.ips 2>/dev/null | head -3 | awk '{print $6, $7, $8, $9}' || echo "none"
echo

# ---------- history: one line per run, drives the trend block ----------
HIST_DIR="$HOME/.hermes/profiles/h-ops/data"
HIST="$HIST_DIR/macmini_health.tsv"
mkdir -p "$HIST_DIR" 2>/dev/null
printf '%s\t%s\t%s\t%s\t%s\n' "$(date '+%m-%d %H:%M')" "$MEM_USED" "$MEM_COMP" "${DISK_CAP}%" "$LOAD1" >>"$HIST" 2>/dev/null
echo "----- TREND (prev samples, oldest first) -----"
if [ -s "$HIST" ]; then
  tail -6 "$HIST" | awk -F'\t' '{printf "%-12s mem %-6s comp %-5s disk %-5s load %s\n", $1, $2, $3, $4, $5}'
else
  echo "no history yet"
fi
echo

# ---------- pre-rendered report block ----------
# Agent's job: paste the lines between the markers verbatim into ONE markdown code block,
# then add the one-line verdict above it and only the ⚠️ lines below it. No re-layout.
echo "----- REPORT BLOCK (paste verbatim, keeps alignment) -----"
HOST_SHORT=$(hostname | sed 's/\.local$//')
UP=$(uptime | sed 's/.*up //; s/,.*//' | sed 's/  */ /g')
printf '主机  %-20s %s\n' "$HOST_SHORT" "up $UP"
printf '内存  %s  %4s / %sG  %3s%%\n' "$(bar "$MEM_PCT")" "$MEM_USED" "$MEM_GB" "$MEM_PCT"
printf '磁盘  %s  %4s / %s  %3s%%\n' "$(bar "$DISK_CAP")" "$DISK_USED" "$DISK_TOTAL" "$DISK_CAP"
printf '负载  %s  %4s / %s 核  %3s%%\n' "$(bar "$LOAD_PCT")" "$LOAD1" "$NCPU" "$LOAD_PCT"
printf '压缩  %s  %4s / 6G 阈值 %3s%%\n' "$(bar "$COMP_PCT")" "$MEM_COMP" "$COMP_PCT"
if [ -n "$DOCKER_PS" ]; then
  echo "$DOCKER_PS" | awk -F'|' '{ n=$1; if (length(n) > 20) n = substr(n,1,19) "…"; printf "容器  %-20s %s\n", n, $2 }'
else
  printf '容器  %-20s %s\n' "docker" "daemon down"
fi
if [ -n "$GW_PID" ]; then printf '网关  %-20s %s\n' "hermes gateway" "up · pid $GW_PID"; else printf '网关  %-20s %s\n' "hermes gateway" "DOWN"; fi
echo "===== END ====="
