# 自建 MCP server 的 SDK / 传输 / 鉴权坑

适用于用 Python `mcp` SDK 的 FastMCP 自己写 MCP server（把内部能力开放给别的 agent）。
所有结论都在 ssh-ops server 上实测过。

## 1. 版本：先 pin `mcp<2`

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python "mcp<2" psycopg2-binary
```

`mcp>=2.0` 把 `FastMCP` 改名成 `MCPServer`（`from mcp.server.mcpserver import MCPServer`），
`from mcp.server.fastmcp import FastMCP` 直接抛 `ModuleNotFoundError` 并附迁移提示。
不 pin 版本就会拿最新版然后 import 失败。验证过的可用版本：1.30.0。

用 venv 的 python 跑 server，别指望系统 python（`/usr/bin/python3` 常有 psycopg2 但没有 mcp）。

## 2. 局域网访问 421 Misdirected Request

现象：`127.0.0.1` 正常，换成 `http://192.168.x.x:port/mcp` 立刻 `421`。

原因：FastMCP 默认开了 DNS-rebinding 防护，`allowed_hosts=["127.0.0.1:*", "localhost:*", "[::1]:*"]`，
Host 头不匹配就 421。

修法（构造时传，别在启动参数里找）：

```python
from mcp.server.transport_security import TransportSecuritySettings

mcp = FastMCP("name", instructions="...",
              transport_security=TransportSecuritySettings(
                  enable_dns_rebinding_protection=False))
```

关掉它等于放弃 Host 头校验，所以必须用 Bearer token 补上身份校验，且默认只监听 127.0.0.1。

## 3. Bearer 鉴权：包 ASGI，不要用 Starlette 中间件

```python
class BearerGate:                     # 纯 ASGI wrapper
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        h = dict(scope.get("headers") or [])
        auth = h.get(b"authorization", b"").decode()
        tok = auth[7:] if auth.lower().startswith("bearer ") else h.get(b"x-api-key", b"").decode()
        if tok != expected:
            body = b'{"error":"unauthorized"}'
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json"),
                                    (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)

app = BearerGate(mcp.streamable_http_app())
uvicorn.run(app, host=host, port=port)
```

同样不要设 `mcp.settings.host/port` 再交给 `mcp.run(transport="streamable-http")` ——
把 ASGI app 直接交给 uvicorn，POST/GET/DELETE 三个方法才都被同一道闸拦住。

## 4. 怎么判断"真的能用"

curl 只能测鉴权码，测不了协议：

```bash
curl -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:PORT/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{}'                      # 401 = 鉴权生效（不是故障）
```

- 手搓 curl 必须带 `Accept: application/json, text/event-stream`，否则 406/4xx 会跟鉴权失败混在一起，看不出真因。
- 真正的验收用 MCP 客户端：`mcp.client.stdio.stdio_client` 或
  `mcp.client.streamable_http.streamablehttp_client` → `initialize()` → `list_tools()` → `call_tool()`。
  现成脚本：`scripts/mcp_smoke_test.py`。
- HTTP 客户端连接写法：`streamablehttp_client(url, headers={"Authorization": "Bearer <tok>"})`，
native 客户端配置里对应的就是 `headers:` 段。

## 5. 工具设计（给别的 agent 用时）

- 参数里**不要有**任何能查/传凭据的字段；凭据只在服务端进程内流转。
- 返回前统一脱敏函数（把密码串替换成 `***`），别指望调用方不看。
- 每次调用写审计日志（时间/目标/命令/返回码/耗时），文件 600。
- 工具数量少而正交（list / exec / read / tail / health / upload），文档字符串写清
  "参数怎么填 + 超时怎么算"，因为别的 agent 只读得到 schema。
- 危险操作做成显式开关参数（`allow_dangerous: bool = False`），默认拒绝并在 reason 里
  说明"确认影响面后带 allow_dangerous=true 重试"，比静默放行或静默失败都强。
- 输出要截断（如 20k 字符）并提示缩小范围，否则一次 `du /` 就能把对方上下文打满。
