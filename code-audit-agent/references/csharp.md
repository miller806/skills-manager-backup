---
name: csharp-rules
description: C#/.NET Core专项安全规则 — if:csharp 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "C# Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "*.csproj detected"
    when: "if: csharp"
---

# C# Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)
**Previous**: Phase 1 Reconnaissance
**Next**: Phase 3 Static Verification
**Trigger**: `if: csharp` 检测到 *.csproj 或 *.sln 文件时加载

C#/.NET Core专项安全规则。增强对C#生态中常见漏洞模式的检测能力。

## 技术栈指纹

指纹文件：`*.csproj`、`*.sln`、`Program.cs`、`Startup.cs`

## SQL注入检测

**目标：** 发现 SQL 注入漏洞

检测模式（Grep）：
```
SqlCommand
SqlConnection
ExecuteScalar
ExecuteReader
ExecuteNonQuery
FromSqlRaw
ExecuteSqlRaw
Database.ExecuteSqlRaw
context.Database
```

**Entity Framework:**
```csharp
// 危险：字符串拼接
context.Database.ExecuteSqlRaw("SELECT * FROM Users WHERE Id = " + id);

// 安全：参数化查询
context.Database.ExecuteSqlRaw("SELECT * FROM Users WHERE Id = @id", new SqlParameter("@id", id));

// 安全：LINQ查询
var user = context.Users.Where(u => u.Id == id).FirstOrDefault();
```

**分析规则：**
- `FromSqlRaw` / `ExecuteSqlRaw` 含字符串拼接 → SQL注入
- `SqlCommand.CommandText` 直接赋值用户输入 → SQL注入

---

## 命令注入检测

**目标：** 发现命令执行漏洞

检测模式（Grep）：
```
Process\.Start
ProcessStartInfo
Shell\(
\.Execute\(
Runtime\.Invok
```

**分析规则：**
- `Process.Start()` 参数来自用户输入 → 命令注入
- 需检查 `UseShellExecute` 属性

---

## 反序列化检测

**目标：** 发现反序列化RCE漏洞

检测模式（Grep）：
```
JavaScriptSerializer
JsonConvert\.DeserializeObject
Newtonsoft\.Json
DataContractSerializer
XmlSerializer
BinaryFormatter
LosFormatter
ObjectStateFormatter
```

**分析规则：**
- `BinaryFormatter.Deserialize()` → 反序列化RCE
- `JavaScriptSerializer.Deserialize()` 含用户输入 → 风险
- 应使用 `System.Text.Json` 代替

---

## XSS检测

**目标：** 发现跨站脚本漏洞

检测模式（Grep）：
```
Response\.Write
Html\.Raw
@Html\.
@\.Raw
HttpUtility\.HtmlEncode
Server\.HtmlEncode
```

**ASP.NET Core:**
```csharp
// 危险：未转义输出
@Model.UserName

// 安全：自动转义
@Html.Encode(Model.UserName)

// 最佳：使用 Tag Builder
var tag = new TagBuilder("div");
tag.InnerHtml.Append(Model.UserName);
```

---

## 路径遍历检测

**目标：** 发现路径遍历漏洞

检测模式（Grep）：
```
File\.Open
File\.ReadAllText
File\.ReadAllBytes
Directory\.
Path\.
StreamReader
FileUpload
```

**分析规则：**
- 用户输入进入文件路径 → 路径遍历
- 需检查 `Path.GetFullPath()` 规范化后是否在允许目录内

---

## SSRF检测

**目标：** 发现服务器端请求伪造漏洞

检测模式（Grep）：
```
WebClient
HttpClient
HttpWebRequest
WebRequest
HttpClientHandler
ServicePointManager
```

**分析规则：**
- URL 来自用户输入且无白名单验证 → SSRF
- 检查是否限制允许协议（禁止 `file://`, `dict://`）

---

## 认证与授权检测

**目标：** 发现认证和授权配置缺陷

检测模式（Grep）：
```
\[Authorize\]
\[AllowAnonymous\]
AuthenticationMode
AddAuthentication
AddMvc\(\)
UseAuthentication
UseAuthorization
CookieSecureOption
CookieHttpOnly
```

**分析规则：**
- `[Authorize]` 缺失 → 公开接口可访问
- `CookieHttpOnly` 未设置 → XSS可窃取cookie
- `AuthenticationMode` 检查默认配置

### JWT检测

检测模式（Grep）：
```
JwtSecurityToken
AddJwtBearer
TokenValidationParameters
issuer
audience
secret
```

**分析规则：**
- JWT secret 硬编码 → Critical
- `ValidateIssuer` / `ValidateAudience` 检查配置

---

## 敏感数据检测

**目标：** 发现敏感信息泄露

检测模式（Grep）：
```
password\s*=\s*"
secret\s*=\s*"
api.?key\s*=\s*"
connection.?string
ConnectionString
private.?key
credentials
```

**分析规则：**
- 连接字符串含明文密码 → Critical
- 配置应使用 `UserSecrets` 或环境变量

---

## Entity Framework Core特定检测

### 投影查询检测

检测模式（Grep）：
```
Select\(.*new
FromSqlRaw
ExecuteSqlRawAsync
```

### 导航属性检测

检测模式（Grep）：
```
Include\(
ThenInclude\(
lazy.?loading
virtual\s+
```

---

## ASP.NET Core MVC检测

### 控制器检测

检测模式（Grep）：
```
Controller
\[HttpGet\]
\[HttpPost\]
\[HttpPut\]
\[HttpDelete\]
\[Route\]
IActionResult
AsyncController
```

### 模型绑定检测

检测模式（Grep）：
```
\[Bind\]
\[BindRequired\]
\[FromBody\]
\[FromQuery\]
\[FromRoute\]
```

**分析规则：**
- `[Bind]` 缺失 → Mass Assignment风险
- 敏感字段需添加 `[BindNever]` 或排除

---

## WCF (Windows Communication Foundation) 检测

检测模式（Grep）：
```
ServiceContract
OperationContract
\[ServiceContract\]
\[OperationContract\]
```

---

## 已知高危版本清单

| 框架 | 高危版本 | 风险 | CVE |
|------|---------|------|------|
| .NET Core < 3.1 | 多种RCE | CVE-2021-3129 | RCE |
| Newtonsoft.Json < 13.0 | 反序列化RCE | CVE-2021-41165 | RCE |
| System.Text.Encodings.Web < 4.7 | 拒绝服务 | CVE-2020-1147 | DoS |

---

## 污染追踪规则（C#特定）

### 变量污染状态判断

| 来源类型 | 标记 | 风险级别 |
|---------|------|---------|
| `Request.Query` / `Request.Form` | TAINTED-用户输入 | 高 |
| `Request.Body` | TAINTED-用户输入 | 高 |
| `RouteData` | TAINTED-用户输入 | 高 |
| 数据库查询结果 | TAINTED-数据库 | 中 |
| `Configuration` / `appsettings.json` | TAINTED-配置 | 中 |
| 硬编码常量 | CLEAN | 低 |

### 净化函数识别

| 净化函数 | 能防御 | 说明 |
|---------|--------|------|
| `SqlParameter` | SQL注入 | 参数化查询 |
| `Html.Encode()` / `HtmlString` | XSS | 需正确使用 |
| `Url.Encode()` | URL注入 | 编码URL组件 |
| `Path.GetFullPath()` | 路径遍历 | 规范化路径 |

### 追踪终止条件

- 追踪到 `SqlParameter` → SQL注入净化成功
- 追踪到 `Html.Encode()` → XSS净化成功
- 追踪超过7层 → 标记为 UNCONFIRMED

---

## 文件上传安全检测

检测模式（Grep）：
```
FileUpload
IFormFile
UploadAsync
```

**分析规则：**
- 文件类型验证是否完整（Content-Type + Extension + Magic Number）
- 文件大小是否限制
- 存储路径是否可预测

---

## 日志记录安全检测

检测模式（Grep）：
```
LogInformation.*password
LogDebug.*secret
Logger\.Log.*password
toString\(\)
JSON\.Serialize
```

**分析规则：**
- 日志输出敏感信息 → 信息泄露
- 应使用脱敏处理