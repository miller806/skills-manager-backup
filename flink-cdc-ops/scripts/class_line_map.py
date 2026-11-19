#!/usr/bin/env python3
"""列出 Java class 里每个方法的行号区间，用于核对日志栈帧行号是否属于当前 jar 的那个 build。

场景：日志里 `SomeClass.foo(SomeClass.java:32)`，但当前 jar 的 foo 只有 48..112 行 ——
说明那一刻加载的是另一个版本的 class，而不是「容错/判定逻辑没生效」。

用法:
  python3 class_line_map.py <jar> io/cregis/cdc/TolerantMetadataApplier.class
  python3 class_line_map.py <jar> io/cregis/cdc/TolerantMetadataApplier.class --line 32
  python3 class_line_map.py /abs/path/SomeClass.class
"""
import struct
import sys
import zipfile


def parse_class(b):
    i = 8
    cnt = struct.unpack('>H', b[i:i + 2])[0]
    i += 2
    cp, n = {}, 1
    while n < cnt:
        t = b[i]
        i += 1
        if t == 1:
            ln = struct.unpack('>H', b[i:i + 2])[0]
            i += 2
            cp[n] = b[i:i + ln].decode('utf-8', 'replace')
            i += ln
        elif t in (7, 8, 16, 19, 20):
            i += 2
        elif t == 15:
            i += 3
        elif t in (3, 4, 9, 10, 11, 12, 17, 18):
            i += 4
        elif t in (5, 6):
            i += 8
            n += 1
        else:
            raise ValueError('bad constant pool tag %d' % t)
        n += 1
    i += 6  # access_flags, this_class, super_class
    ic = struct.unpack('>H', b[i:i + 2])[0]
    i += 2 + ic * 2

    def skip_attrs(p):
        c = struct.unpack('>H', b[p:p + 2])[0]
        p += 2
        for _ in range(c):
            p += 2
            ln = struct.unpack('>I', b[p:p + 4])[0]
            p += 4 + ln
        return p

    fc = struct.unpack('>H', b[i:i + 2])[0]
    i += 2
    for _ in range(fc):
        i += 6
        i = skip_attrs(i)
    mc = struct.unpack('>H', b[i:i + 2])[0]
    i += 2
    out = {}
    for _ in range(mc):
        _acc, ni, di = struct.unpack('>HHH', b[i:i + 6])
        i += 6
        name, desc = cp[ni], cp[di]
        ac = struct.unpack('>H', b[i:i + 2])[0]
        i += 2
        code = None
        for _ in range(ac):
            ani = struct.unpack('>H', b[i:i + 2])[0]
            alen = struct.unpack('>I', b[i + 2:i + 6])[0]
            if cp[ani] == 'Code':
                code = b[i + 6:i + 6 + alen]
            i += 6 + alen
        if not code:
            continue
        p = 0
        struct.unpack('>HH', code[p:p + 4])
        p += 4
        cl = struct.unpack('>I', code[p:p + 4])[0]
        p += 4 + cl                       # 跳过字节码本体
        etn = struct.unpack('>H', code[p:p + 2])[0]
        p += 2 + etn * 8                  # 跳到属性表
        ac2 = struct.unpack('>H', code[p:p + 2])[0]
        p += 2
        lines = set()
        for _ in range(ac2):
            ani = struct.unpack('>H', code[p:p + 2])[0]
            alen = struct.unpack('>I', code[p + 2:p + 6])[0]
            if cp[ani] == 'LineNumberTable':
                q = p + 6
                k = struct.unpack('>H', code[q:q + 2])[0]
                q += 2
                for _ in range(k):
                    _sp, li = struct.unpack('>HH', code[q:q + 4])
                    q += 4
                    lines.add(li)
            p += 6 + alen
        out[(name, desc)] = lines
    return out


def load(target):
    if target.endswith('.jar') or '.jar' in target:
        pass
    if zipfile.is_zipfile(target):
        raise SystemExit('请把 jar 和 class 分开传：class_line_map.py <jar> <class>')
    with open(target, 'rb') as f:
        return f.read()


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    want = None
    if '--line' in sys.argv:
        want = int(sys.argv[sys.argv.index('--line') + 1])
        args = [a for a in args if a != str(want)]
    if len(args) == 1:
        data = load(args[0])
        label = args[0]
    elif len(args) >= 2:
        with zipfile.ZipFile(args[0]) as z:
            data = z.read(args[1])
        label = '%s :: %s' % (args[0].split('/')[-1], args[1])
    else:
        raise SystemExit(__doc__)

    methods = parse_class(data)
    print('=' * 70)
    print(label)
    print('=' * 70)
    all_lines = sorted({l for ls in methods.values() for l in ls})
    if all_lines:
        print('行号总范围: %d..%d' % (all_lines[0], all_lines[-1]))
    for (name, desc), ls in sorted(methods.items(), key=lambda kv: (kv[1] and min(kv[1]) or 0)):
        if not ls:
            print('  %-45s (无行号表)' % name)
        else:
            print('  %-45s %4d..%-4d' % (name, min(ls), max(ls)))
    if want is not None:
        print('-' * 70)
        hit = [n for (n, _d), ls in methods.items() if want in ls]
        if hit:
            print('第 %d 行 ∈ %s' % (want, ', '.join(hit)))
        else:
            print('第 %d 行在本 class 里不存在 → 日志栈帧来自另一个 build' % want)
            near = [l for l in all_lines if abs(l - want) <= 6]
            if near:
                print('  附近存在: %s' % near)


if __name__ == '__main__':
    main()
