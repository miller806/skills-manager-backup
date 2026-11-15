---
name: sanitization-rules
description: 净化函数能力库规则 — 阶段2A污染追踪时加载
config:
  progression:
    phase: "2A"
    name: "Sanitization Rules"
    prev: "sink detection"
    next: "taint tracking validation"
    when: "during Sink-Driven Audit"
---

# Sanitization Rules

**Phase**: 2A (Sink-Driven Audit)  
**When**: 污染追踪过程中动态加载  
**Purpose**: 判断净化函数是否充分，识别净化绕过模式

净化函数能力库。用于判断净化是否充分，以及识别净化绕过模式。

## Java 净化函数库

| 净化函数 | 能防御 | 不能防御 | 充分性条件 |
|---------|--------|---------|-----------|
| StringEscapeUtils.escapeSql() | 单引号注入 | 双引号注入、反斜杠注入 | 需配合参数化查询 |
| StringEscapeUtils.escapeHtml() | HTML内容XSS | JavaScript事件处理器XSS | 需使用textContent |
| StringEscapeUtils.escapeHtml4() | HTML内容XSS | URL编码XSS | 同上 |
| PreparedStatement.setString() | SQL注入 | 逻辑注入（如1=1） | 参数化查询足够 |
| PreparedStatement.setObject() | SQL注入 | — | 充分 |
| remove("%") | SQL模糊注入 | SQL拼接注入 | 仅限LIKE子句 |
| URLEncoder.encode() | URL参数注入 | — | 充分（URLContext） |
| HtmlUtils.htmlEscape() | XSS | — | 充分 |
| Spring HtmlUtils | XSS | — | 充分 |

## Python 净化函数库

| 净化函数 | 能防御 | 不能防御 |
|---------|--------|---------|
| bleach.clean() | HTML XSS | JS事件处理器XSS |
| markupsafe.escape() | Jinja2 XSS | 双重编码XSS |
| html.escape() | HTML XSS | — |
| cursor.mogrify() | SQL注入 | ORM注入 |
| psycopg2.extensions.AsIs | SQL注入 | — |
| sqlalchemy.text() | SQL注入 | — |

## JavaScript 净化函数库

| 净化函数 | 能防御 | 不能防御 |
|---------|--------|---------|
| textContent | DOM XSS | 反射型XSS |
| innerText | DOM XSS | 协议级XSS（javascript:）|
| encodeURIComponent() | URL XSS | — |
| DOMPurify.sanitize() | HTML XSS | — |
| validator.escape() | XSS | — |
| lodash.escape() | XSS | — |

## 净化绕过模式识别

### 模式1：净化不彻底
检查净化函数是否只处理了部分危险字符。
示例：只过滤单引号但未过滤双引号。
规则：存在已知未处理的危险字符 → 标记为漏洞

### 模式2：净化顺序错误
检查是否在危险操作之后才调用净化。
正确：净化 → 拼接
错误：拼接 → 净化
规则：拼接在净化之前 → 净化无效

### 模式3：双重编码绕过
检查是否只进行了一次解码。
危险场景：%3Cscript%3E → 一次解码 → <script> → 写入HTML
规则：单一解码路径且无二次解码 → 标记为可能绕过

### 模式4：净化上下文转移
检查净化后的参数是否被拼入不同上下文。
危险场景：escapeHtml(userInput) → safeInput → 拼入SQL（XSS转移到SQL）
规则：净化后参数跨上下文 → 标记为上下文转移漏洞

### 模式5：编码顺序错误
检查编码/解码顺序。
正确：用户输入 → 一次编码 → 存储 → 一次解码 → 使用
错误：用户输入 → 两次编码 → 一次解码 → 使用（第二次解码产生注入）
规则：编码链与解码链不匹配 → 可能绕过

## 框架特定净化

### MyBatis 净化
- 使用 `#{}` 而非 `${}` → 充分（参数化）
- 使用 `${}` → 未净化，需追踪参数来源
- 混合使用 `#{}` 和 `${}` → 检查非参数化部分

### Spring SpEL 净化
- `#{}` 内不使用 `T()` 表达式 → 相对安全
- `#{}` 内含 `T(java.lang.Runtime)` → 直接RCE
- 使用 `Projections.` → 净化已内置

### Django ORM 净化
- 使用 `.filter()` 参数化 → 充分
- 使用 `.raw()` 或 `.extra()` → 未净化，需检查参数

### Jinja2 净化
- `{{ user_input }}` → 自动转义（充分）
- `{{ user_input | safe }}` → 禁用转义（危险）
- `{% autoescape false %}` → 需人工确认

## 补偿逻辑识别

在 Control-Driven 阶段发现配置缺失时，额外检查是否存在代码层面的补偿：

### CORS补偿检测
- 若配置为 `AllowAll` → 搜索是否有手动 Origin 校验
- 若存在显式 Origin 校验（不含通配符）→ 降级为 Medium

### 认证补偿检测
- 若接口无认证注解 → 搜索函数内部是否有 session/token 检查
- 若函数第一行有显式检查 → 降级为 Informational

### 输入验证补偿
- 检查参数是否有白名单校验（如 switch-case 限制取值）
- 检查参数是否为硬编码常量（无外部输入）
- 若严格限制 → 降级或排除

## 真实世界绕过模式（基于历史漏洞）[NEW]

### 模式6：邮箱空格绕过
- **案例：** Udun/AurumVault — 邮箱前后加空格可绕过校验限制
- **检测：** 搜索邮箱处理逻辑是否调用 `trim()`
- **规则：** 缺少 `.trim()` → 可绕过格式校验和频率限制

### 模式7：返回包篡改绕过
- **案例：** CSPN — 篡改返回包 `isPassed` 字段为 `1` 即可绕过密码验证
- **检测：** 前端是否根据 `response.data.isPassed` / `response.data.success` 判断操作权限
- **规则：** 服务端返回验证状态让前端判断 → 可绕过

### 模式8：JSON 数组参数 SQL 注入
- **案例：** Udun — `coinTypeList` 数组中的 `coinType` 参数直接拼 SQL
- **检测：** JSON 数组参数中字符串类型字段直接进入 SQL 查询
- **规则：** JSON 参数未做类型强校验/转义 → 可注入

### 模式9：精度绕过
- **案例：** AurumVault — `9.991` vs `9.99` 显示精度 vs 存储精度不一致
- **检测：** 比较用全精度，存储/展示截断精度
- **规则：** 比较精度 ≠ 存储精度 → 可绕过唯一性校验

### 模式10：竞争条件绕过
- **案例：** Cregis — 并发创建同名 WaaS 项目
- **检测：** `SELECT COUNT WHERE name=X` 后 `INSERT`，无唯一索引
- **规则：** 非原子操作 + 无唯一约束 → 可创建重复资源