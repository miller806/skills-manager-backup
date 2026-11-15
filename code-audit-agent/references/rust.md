---
name: rust-rules
description: Rust专项安全规则 — if:rust 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "Rust Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "Cargo.toml detected"
    when: "if: rust"
---

# Rust Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)
**Previous**: Phase 1 Reconnaissance
**Next**: Phase 3 Static Verification
**Trigger**: `if: rust` 检测到 Cargo.toml 或 src/*.rs 文件时加载

Rust专项安全规则。增强对Rust生态中常见漏洞模式的检测能力。

## 技术栈指纹

指纹文件：`Cargo.toml`、`Cargo.lock`、`src/main.rs`、`src/lib.rs`

## 命令注入检测

**目标：** 发现命令执行漏洞

检测模式（Grep）：
```
Command::new
Command::arg
Command::args
std::process::Command
process::Command
spawn\(
execute\(
```

**分析规则：**
- `Command::new()` 参数来自用户输入 → 命令注入
- 需检查 `std::process::Command` 使用方式

---

## 反序列化检测

**目标：** 发现反序列化漏洞

检测模式（Grep）：
```
serde::de::Deserialize
serde_json::from_str
bincode::deserialize
ron::from_str
MessagePack::unpack
cbor::from_slice
postcard::from_bytes
```

**分析规则：**
- `serde_json::from_str()` 含用户输入 → 需确保JSON可信
- 使用 `serde::Deserialize` 替代手动解析

---

## 文件操作检测

**目标：** 发现文件操作漏洞

检测模式（Grep）：
```
std::fs::read
std::fs::write
std::fs::File
fs::read_to_string
fs::write
fs::OpenOptions
Path::new
PathBuf
```

**分析规则：**
- 用户输入进入文件路径 → 路径遍历
- 需使用 `canonicalize()` 规范化路径

---

## SSRF检测

**目标：** 发现服务器端请求伪造漏洞

检测模式（Grep）：
```
reqwest::get
reqwest::Client
ureq::get
surf::Client
hyper::Client
warp::Client
```

**HTTP客户端库：**
- `reqwest` - 常用HTTP客户端
- `ureq` - 轻量级HTTP客户端
- `surf` - 异步HTTP客户端

**分析规则：**
- URL 来自用户输入且无白名单验证 → SSRF
- 检查是否限制允许协议

---

## SQL注入检测（使用sqlx或diesel）

**目标：** 发现 SQL 注入漏洞

检测模式（Grep）：
```
sqlx::query
sqlx::query_as
diesel::RunQuery
query\(
execute\(
```

**sqlx:**
```rust
// 安全：参数化查询
let row = sqlx::query("SELECT * FROM users WHERE id = $1", id)
    .fetch_one(&pool)
    .await?;

// 危险：字符串拼接
let query = format!("SELECT * FROM users WHERE id = {}", id);
```

---

## 错误处理检测

**目标：** 发现错误处理缺陷

检测模式（Grep）：
```
unwrap\(\)
expect\("
unwrap_err\(\)
\[unwrap\]
ok\(\)
err\(\)
```

**分析规则：**
- `unwrap()` 在生产代码 → panic风险
- 应使用 `?` 传播错误或 `match` 处理

---

## 密码存储检测

**目标：** 发现密码处理缺陷

检测模式（Grep）：
```
password\.hash
bcrypt
argon2
scrypt
PasswordHasher
```

**分析规则：**
- 明文密码 → Critical
- 应使用 bcrypt/argon2/scrypt 哈希

---

## Web框架特定检测

### Actix-web检测

检测模式（Grep）：
```
actix_web::
HttpServer
App::new
route\(
web::scope
web::Data
```

### Rocket检测

检测模式（Grep）：
```
#\[get\]
#\[post\]
#\[put\]
#\[delete\]
Route
rocket\(
```

### Warp检测

检测模式（Grep）：
```
warp::filter
warp::path
warp::get
warp::post
Filter
```

---

## 并发安全检测

**目标：** 发现并发问题

检测模式（Grep）：
```
Arc\(
Mutex\(
RwLock\(
unsafe\s+
std::sync
Channel
mpsc::
spawn\(
join\(
```

**分析规则：**
- `Arc<Mutex<T>>` 检查是否正确使用
- `unsafe` 块需仔细审查

---

## 输入验证检测

**目标：** 发现输入验证缺陷

检测模式（Grep）：
```
\.parse\(
trim\(\)
contains\(
starts_with\(
ends_with\(
is_empty\(
len\(\)
```

**分析规则：**
- 用户输入直接解析 → 类型混淆
- 需添加输入验证

---

## 敏感信息检测

**目标：** 发现敏感信息泄露

检测模式（Grep）：
```
api_key
apikey
secret
password
token
credential
PRIVATE_KEY
AWS_
```

---

## 污染追踪规则（Rust特定）

### 变量污染状态判断

| 来源类型 | 标记 | 风险级别 |
|---------|------|---------|
| `Request` / `HttpRequest` | TAINTED-用户输入 | 高 |
| URL参数 | TAINTED-用户输入 | 高 |
| 命令行参数 `env::args()` | TAINTED-用户输入 | 高 |
| 文件读取 | TAINTED-文件 | 中 |
| 数据库查询结果 | TAINTED-数据库 | 中 |
| 环境变量 `env::var()` | TAINTED-配置 | 中 |
| 硬编码常量 | CLEAN | 低 |

### 净化函数识别

| 净化函数 | 能防御 | 说明 |
|---------|--------|------|
| `sanitize` | SQL注入 | 使用参数化查询 |
| `urlencoding::encode` | URL注入 | 编码URL组件 |
| `html_escape` | XSS | 转义HTML特殊字符 |

### 追踪终止条件

- 追踪到 `sqlx::query` 参数化 → SQL注入净化成功
- 追踪到 `html_escape::encode` → XSS净化成功
- 追踪超过7层 → 标记为 UNCONFIRMED

---

## Web安全检测

### CORS检测

检测模式（Grep）：
```
Cors
cors
Access-Control-Allow-Origin
allowed_origins
```

### CSRF检测

检测模式（Grep）：
```
csrf
CsrfToken
same_site
SameSite
```

---

## 已知不安全的库

| 库 | 版本 | 风险 | 说明 |
|---|------|------|------|
| `serde_json` | < 1.0 | DoS | 大对象解析耗尽内存 |
| `reqwest` | < 0.9 | SSRF | 默认允许重定向 |

---

## crates.io 依赖安全

**目标：** 发现已知漏洞依赖

检测模式（Grep）：
```
cargo-audit
SecReq
```

**分析规则：**
- 使用 `cargo-audit` 检查依赖漏洞
- 检查 Cargo.lock 中的已知漏洞