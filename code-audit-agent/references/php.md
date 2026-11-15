---
name: php-rules
description: PHP专项安全规则 — if:php 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "PHP Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "composer.json detected"
    when: "if: php"
---

# PHP Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)
**Previous**: Phase 1 Reconnaissance
**Next**: Phase 3 Static Verification
**Trigger**: `if: php` 检测到 composer.json 或 *.php 文件时加载

PHP专项安全规则。增强对PHP生态中常见漏洞模式的检测能力。

## 技术栈指纹

指纹文件：`composer.json`、`wp-config.php` (WordPress)、`Laravel.php` (Laravel)

## 控制流审计补充

### SQL注入检测

**目标：** 发现 SQL 注入漏洞

检测模式（Grep）：
```
DB::select()
DB::insert()
DB::statement()
DB::update()
DB::delete()
query()
execute()
raw()
selectRaw()
```

**Laravel Query Builder:**
```php
// 危险：直接拼接
DB::table('users')->where('id', $id)->first();

// 安全：使用参数绑定
DB::table('users')->where('id', '=', $id)->first();
```

**分析规则：**
- `DB::raw()` 含字符串拼接 → SQL注入
- `DB::select()` 参数来自用户输入 → 需参数化
- Eloquent ORM 使用 `where()` 自动参数化 → 安全

### 命令注入检测

**目标：** 发现远程代码执行漏洞

检测模式（Grep）：
```
exec\(
passthru\(
shell_exec\(
system\(
popen\(
proc_open\(
`.*\$  // 反引号
\$_\[  // $_
eval\(
create_function\(
```

**Laravel特定:**
```php
// 危险：用户输入进入命令
Artisan::call($command);  // 若 $command 来自用户输入

// 危险：Shell字符串拼接
shell_exec("ping -c 4 " . $ip);
```

### 反序列化检测

**目标：** 发现反序列化RCE漏洞

检测模式（Grep）：
```
unserialize\(
session_decode\(
var_export\(
var_dump\(
print_r\(
```

**WordPress/PHP特定:**
```php
// 危险：反序列化用户输入
unserialize($_COOKIE['data']);

// 安全：使用 JSON 代替
json_decode($_COOKIE['data']);
```

### 文件操作检测

**目标：** 发现本地文件包含/读取漏洞

检测模式（Grep）：
```
include\(
include_once\(
require\(
require_once\(
file_get_contents\(
fopen\(
readfile\(
file\(
glob\(
```

**路径遍历检测:**
```php
// 危险：用户输入进入文件路径
include("pages/" . $_GET['page']);

// 安全：白名单验证
$allowed = ['home', 'about', 'contact'];
$page = in_array($_GET['page'], $allowed) ? $_GET['page'] : 'home';
include("pages/" . $page . ".php");
```

### SSRF检测

**目标：** 发现服务器端请求伪造漏洞

检测模式（Grep）：
```
file_get_contents\(
curl_init\(
curl_setopt\(
guzzle\(
Http\:
fopen\(
```

**分析规则：**
- URL 来自用户输入且无白名单验证 → SSRF
- 检查是否限制允许协议（禁止 `file://`, `dict://`, `gopher://`）

### XSS检测

**目标：** 发现跨站脚本漏洞

检测模式（Grep）：
```
echo\s+\$_
print\s+\$_
print_r\s+\$
var_dump\s+\$
printf\s+.*%s
die\s+.*
exit\s+.*
```

**Laravel Blade:**
```php
// 危险：未转义输出
{{ $user->name }}

// 安全：自动转义
{!! $user->name !!}  // 仅在确认安全时使用
```

### Laravel特定检测

#### CSRF保护检测

检测模式（Grep）：
```
@csrf
csrf_field\(\)
csrf_token\(\)
_verifyCsrfToken
```

**分析规则：**
- 表单无 `@csrf` 且无 CSRF 中间件 → CSRF 漏洞
- API 需检查是否使用 `VerifyCsrfToken` 中间件

#### Mass Assignment检测

检测模式（Grep）：
```
$fillable
$guarded
create\(
update\(
fill\(
```

**分析规则：**
- 模型无 `$fillable`/`$guarded` 且使用 `create()` → Mass Assignment
- 应明确指定可批量赋值的字段

#### Auth检测

检测模式（Grep）：
```
Auth::check\(\)
Auth::user\(\)
Auth::id\(\)
gate\
policy\
```

**分析规则：**
- 需检查策略类是否正确定义
- 需检查 `can()` 权限判断

### WordPress特定检测

#### 插件/主题漏洞检测

检测模式（Grep）：
```
add_action\(
add_filter\(
wp_verify_nonce
sanitize_
esc_html
esc_attr
esc_url
```

**分析规则：**
- `sanitize_*` 函数缺失 → 输入验证问题
- `esc_html`/`esc_attr` 缺失 → XSS风险

### PHP危险函数汇总

| 函数类别 | 危险函数 | 风险 |
|---------|---------|------|
| 命令执行 | `exec`, `shell_exec`, `system`, `passthru`, `popen`, `proc_open`, `` ` `` | RCE |
| 代码执行 | `eval`, `assert`, `create_function`, `call_user_func` | RCE |
| 反序列化 | `unserialize`, `session_decode` | RCE |
| 文件操作 | `include`, `require`, `file_get_contents`, `fopen`, `readfile` | LFI/SSRF |
| 动态评估 | `preg_replace` (e修饰符), `mb_ereg_replace` | RCE |

---

## 污染追踪规则（PHP特定）

### 变量污染状态判断

| 来源类型 | 标记 | 风险级别 |
|---------|------|---------|
| `$_GET` / `$_POST` / `$_REQUEST` | TAINTED-用户输入 | 高 |
| `$_COOKIE` | TAINTED-用户输入 | 中 |
| `$_FILES` | TAINTED-用户输入 | 高 |
| `file_get_contents("php://input")` | TAINTED-用户输入 | 高 |
| 数据库查询结果 | TAINTED-数据库 | 中 |
| Redis/缓存读取 | TAINTED-缓存 | 中 |
| `$_SESSION` | TAINTED-会话 | 中 |
| 硬编码常量 | CLEAN | 低 |
| `env()` / `getenv()` | TAINTED-配置 | 中 |

### 净化函数识别

| 净化函数 | 能防御 | 说明 |
|---------|--------|------|
| `mysqli_real_escape_string` | SQL注入 | 需配合参数化查询 |
| `htmlspecialchars` | XSS | 需确认 ENT_QUOTES 参数 |
| `strip_tags` | XSS | 不够充分，需配合其他净化 |
| `filter_var($var, FILTER_SANITIZE_...)` | 多种注入 | 取决于过滤器类型 |
| `addslashes` | SQL注入 | 不足，应使用参数化 |

### 追踪终止条件

- 追踪到 PDO 预处理语句 → 净化成功，终止
- 追踪到 `htmlspecialchars($var, ENT_QUOTES)` → XSS 净化成功
- 追踪超过7层 → 标记为 UNCONFIRMED

---

## 已知高危版本清单

| 框架 | 高危版本 | 风险 | CVE |
|------|---------|------|------|
| Laravel < 8.0 | 认证绕过 | CVE-2021-3129 | RCE |
| WordPress < 5.8 | 多种RCE/XSS | 核心漏洞 | 定期披露 |
| phpMyAdmin < 5.1 | RCE | CVE-2021-43289 | RCE |
| Drupal < 9.2 | RCE | CVE-2021-32819 | RCE |
| ThinkPHP < 6.0 | RCE | 已知利用 | RCE |

---

## Symfony特定检测

### 参数转换器检测

检测模式（Grep）：
```
ParamConverter
@ParamConverter
request->get
```

### 安全配置检测

检测模式（Grep）：
```
access_control
ROLE_
IS_AUTHENTICATED
 VoterInterface
```

---

## 文件上传安全检测

**目标：** 发现文件上传漏洞

检测模式（Grep）：
```
move_uploaded_file
copy\(
file_put_contents.*\$_
is_uploaded_file
\$_FILES
```

**分析规则：**
- 文件类型验证是否完整（Content-Type + Extension + Magic Number）
- 文件大小是否限制
- 存储路径是否可预测
- 文件名是否被用户控制（路径遍历风险）

---

## 敏感文件检测

**目标：** 发现敏感信息泄露

检测模式（Grep）：
```
\.env
database\.php.*password
mysql.*password
redis.*password
secret
apikey
api_key
```

**分析规则：**
- `.env` 文件是否在 webroot 可访问
- 配置文件中密码是否为加密存储
- 第三方服务凭据是否硬编码