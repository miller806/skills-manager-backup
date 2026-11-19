#!/usr/bin/env python3
"""按 TM 日志重建 Flink CDC 快照阶段每个 split 的耗时，并仿真不同 parallelism 的总时长。

只读日志，不改任何状态。

用法:
  python3 split_durations.py /opt/native/flink-1.20.1/log/flink-root-taskexecutor-1-*.log \
      --since '2026-10-18 20:41' --filter 8.222.227.110 --parallelism 1 2 4 6 8

注意:
  - --filter 必填：session 集群的 TM 日志混着所有作业，不按源库 IP 或库前缀收窄，
    统计结果会被别的 pipeline 污染。
  - --since 用日志里时间前缀比较（'YYYY-MM-DD HH:MM'），避免跨日期行混入。
"""
import argparse
import heapq
import re
import sys
from collections import defaultdict
from datetime import datetime

RE_START = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+.*Exporting data from split '([^']+)'")
RE_FIN = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+.*Finished exporting (\d+) records for split '([^']+)'")
RE_CONN = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+.*Connected to MySQL binlog")
RE_STOP = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d),\d+.*Stopped reading binlog after")

FMT = '%Y-%m-%d %H:%M:%S'


def ts(s):
    return datetime.strptime(s, FMT).timestamp()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('log')
    ap.add_argument('--since', default=None, help="只统计该时间之后，格式 'YYYY-MM-DD HH:MM'")
    ap.add_argument('--filter', default=None, help='只保留含该子串的行（源库 IP 或库名前缀）')
    ap.add_argument('--parallelism', nargs='+', type=int, default=[1, 2, 3, 4, 5, 6, 8])
    ap.add_argument('--top', type=int, default=15)
    a = ap.parse_args()

    starts, durs, conns = {}, [], []
    open_conn = None

    with open(a.log, errors='ignore') as f:
        for ln in f:
            if a.since and ln[:16] < a.since:
                continue
            if a.filter and a.filter not in ln:
                continue

            m = RE_START.match(ln)
            if m:
                starts[m.group(2)] = m.group(1)
                continue
            m = RE_FIN.match(ln)
            if m and m.group(3) in starts:
                durs.append((ts(m.group(1)) - ts(starts.pop(m.group(3))), int(m.group(2)), m.group(3)))
                continue
            m = RE_CONN.match(ln)
            if m:
                open_conn = m.group(1)
                continue
            m = RE_STOP.match(ln)
            if m and open_conn:
                conns.append(ts(m.group(1)) - ts(open_conn))
                open_conn = None

    if not durs:
        print('没有配对成功的 split。检查 --since / --filter 是否把全部行过滤掉了。')
        return 1

    total_s = sum(d for d, _, _ in durs)
    total_n = sum(n for _, n, _ in durs)

    print('=== 概览 ===')
    print('  完成 split   : %d' % len(durs))
    print('  读数据总耗时 : %d 秒 (%.1f 分钟)' % (total_s, total_s / 60))
    print('  导出记录     : %d' % total_n)
    print('  平均每 split : %.1f 秒' % (total_s / len(durs)))
    print('  整体吞吐     : %.0f 行/秒' % (total_n / max(total_s, 1)))

    if starts:
        print()
        print('=== 未完成（疑似正在处理 / 悬挂）===')
        for s, t in starts.items():
            print('  %-46s 起始 %s' % (s, t))

    print()
    print('=== 最慢 %d 个 split ===' % a.top)
    for d, n, s in sorted(durs, reverse=True)[:a.top]:
        print('  %5ds  %-44s %7d  %5.0f 行/s' % (d, s[:44], n, n / max(d, 1)))

    print()
    print('=== 按表大小分组（吞吐是否同量级 → 判断瓶颈在链路还是单表）===')
    buckets = defaultdict(list)
    for d, n, _ in durs:
        if n >= 8000:
            k = '>=8000 条'
        elif n >= 2000:
            k = '2000-8000'
        elif n >= 100:
            k = '100-2000'
        else:
            k = '<100 条'
        buckets[k].append((d, n))
    for k in ['>=8000 条', '2000-8000', '100-2000', '<100 条']:
        v = buckets.get(k)
        if not v:
            continue
        sec = sum(x[0] for x in v)
        cnt = sum(x[1] for x in v)
        print('  %-12s %2d 个  %6.0f 秒合计  平均 %6.1f 秒/个  %5.0f 行/s'
              % (k, len(v), sec, sec / len(v), cnt / max(sec, 1)))

    if conns:
        print()
        print('=== 逐 split 的 binlog 重连开销 ===')
        print('  %d 次  平均 %.1f 秒  合计 %.0f 秒 (占读数据 %.0f%%)'
              % (len(conns), sum(conns) / len(conns), sum(conns),
                 100 * sum(conns) / max(total_s, 1)))

    print()
    print('=== parallelism 仿真（最大堆贪心，上限=最长单 split）===')
    longest = max(d for d, _, _ in durs)
    base = None
    for p in a.parallelism:
        h = [0.0] * p
        for d in sorted((d for d, _, _ in durs), reverse=True):
            heapq.heappush(h, heapq.heappop(h) + d)
        t = max(h)
        if base is None:
            base = t
        print('  p=%-2d  %6.0f 秒 (%5.1f 分)  %.2fx  %s'
              % (p, t, t / 60, base / t, '← 已触天花板' if abs(t - longest) < 0.01 else ''))
    print('  最长单 split: %d 秒  → 超过它的 parallelism 无收益' % longest)
    print()
    print('  提醒: p 不能超过该 pipeline 的 server-id 段宽度；链路带宽受限时实际加速约为理论值一半。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
