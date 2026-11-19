#!/usr/bin/env python3
"""通用 MCP server 冒烟测试（stdio 或 http+token）。

用法:
  # stdio: 拉起一个本地 MCP server 进程
  python mcp_smoke_test.py stdio .venv/bin/python server.py

  # http: 连已有端点（token 可省略）
  python mcp_smoke_test.py http http://127.0.0.1:8765/mcp <token>

  # 指定要真实调用的工具（可选）
  python mcp_smoke_test.py stdio .venv/bin/python server.py \
      --tool ssh_run --args '{"server":"101","command":"hostname"}'

需要执行它的解释器里装了 mcp(<2) 客户端依赖。
"""
import argparse
import asyncio
import json
import os
import sys

from mcp import ClientSession


def parse():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["stdio", "http"])
    ap.add_argument("target", nargs="+", help="stdio: command + args | http: url")
    ap.add_argument("--token", default=os.environ.get("MCP_TOKEN", ""))
    ap.add_argument("--tool", default="")
    ap.add_argument("--args", dest="tool_args", default="{}")
    return ap.parse_args()


async def run(session, tool, tool_args):
    await session.initialize()
    tools = await session.list_tools()
    print(f"== tools ({len(tools.tools)}) ==")
    for t in tools.tools:
        print(f"  {t.name}: {(t.description or '').splitlines()[0][:90]}")
    if tool:
        print(f"\n== call {tool} {tool_args} ==")
        res = await session.call_tool(tool, tool_args)
        for c in res.content:
            print(getattr(c, "text", c)[:4000])


async def main():
    a = parse()
    tool_args = json.loads(a.tool_args)
    if a.mode == "stdio":
        from mcp import StdioServerParameters
        from mcp.client.stdio import stdio_client
        cmd, *rest = a.target
        params = StdioServerParameters(command=cmd, args=rest, env=dict(os.environ))
        async with stdio_client(params) as (r, w):
            async with ClientSession(r, w) as s:
                await run(s, a.tool, tool_args)
    else:
        from mcp.client.streamable_http import streamablehttp_client
        url = a.target[0]
        headers = {"Authorization": f"Bearer {a.token}"} if a.token else {}
        async with streamablehttp_client(url, headers=headers) as (r, w, _):
            async with ClientSession(r, w) as s:
                await run(s, a.tool, tool_args)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:  # noqa: BLE001 - 冒烟脚本，错误要一眼看到
        print(f"FAILED: {type(e).__name__}: {e}", file=sys.stderr)
        sys.exit(1)
