---
name: frontend-rules
description: 前端安全专项规则 — if:frontend 时加载
config:
  progression:
    phase: "2E"
    name: "Frontend Security Audit"
    prev: "Phase 2C"
    next: "Phase 3"
    trigger: "frontend技术栈检测"
    when: "if: frontend detected"
---

# Frontend Security Rules

**Phase**: 2E (Parallel Audit Track)  
**Previous**: Phase 2C Logic-Driven Audit  
**Next**: Phase 3 Static Verification  
**Trigger**: `if: frontend` 检测到前端技术栈时加载

前端安全专项规则（v4.1增强版）。覆盖 Vue.js / React / Angular / 小程序 / 原生 H5 / TypeScript 等前端技术栈。

## 技术栈指纹

| 指纹文件 | 技术栈 | 加载规则 |
|---------|--------|---------|
| `vue.config.js` / `pages/` / `.vue文件` | Vue.js | if: frontend-vue |
| `next.config.js` / `pages/` / `.tsx文件` | Next.js (React) | if: frontend-react |
| `angular.json` / `src/app/` | Angular | if: frontend-angular |
| `weapp/` / `miniprogram/` | 微信小程序 | if: frontend-weapp |
| `pages/` + `*.wxml` / `*.wxss` | 支付宝小程序 | if: frontend-alipay |
| `app.json` + `*.ttml` / `*.ttss` | 字节小程序 | if: frontend-douyin |
| `project.config.json` + `*.qml` | QQ小程序 | if: frontend-qq |
| `src/App.vue` / `src/main.js` + uni-app配置 | uni-app（H5跨端） | if: frontend-uniapp |
| `index.html` + `jquery` | jQuery / 原生H5 | if: frontend-jquery |
| `tsconfig.json` + `.tsx` / `.ts` | TypeScript | if: frontend-ts |

## 前端 Sink-Driven 审计

### DOM-XSS 检测

**目标：** 发现 DOM 型 XSS 漏洞

检测模式（Grep）：

#### Vue.js
```
v-html\s*=
\.innerHTML\s*=
\$refs\..*\.innerHTML
```

#### React
```
dangerouslySetInnerHTML
innerHTML\s*=
\.html\(
```

#### Angular
```
\$sce\.trustAsHtml
bypassSecurityTrustHtml
DomSanitizer
\[innerHTML\]
```

#### jQuery
```
\.html\(
\.append\(
\.prepend\(
\.after\(
\.before\(
\.wrap\(
```

#### 原生 JS
```
innerHTML\s*=
outerHTML\s*=
insertAdjacentHTML\(
document\.write\(
document\.writeln\(
\.outerHTML\s*=
```

**污染来源追踪：**

| 来源 | 风险级别 | 检测模式 |
|------|---------|---------|
| URL 参数 | 高 | `location.search`, `location.hash`, `URLSearchParams` |
| URL 路径 | 高 | `location.pathname` |
| Referrer | 中 | `document.referrer` |
| Cookie | 中 | `document.cookie` |
| Storage | 中 | `localStorage.getItem()`, `sessionStorage.getItem()` |
| postMessage | 高 | `window.addEventListener('message')` |
| fetch/axios 响应 | 低 | （假设已净化） |

**分析规则：**
- 用户输入（URL参数/表单）→ 危险 Sink → CONFIRMED DOM-XSS
- 需检查是否经过 `textContent` / `encodeURIComponent` / `DOMPurify` 净化
- 净化不充分（只处理部分字符）→ 标记为漏洞

### 前端命令执行检测

**目标：** 发现前端远程代码执行

检测模式（Grep）：
```
eval\(
new Function\(
setTimeout\(\s*\w+\s*,\s*\w+
setInterval\(\s*\w+\s*,\s*\w+
setImmediate\(
execScript\(
Function\(

// Also check for dynamic code patterns
\(0,eval\)
\(1,eval\)
```

**分析规则：**
- 参数来自用户输入 → 前端RCE（High）
- 参数来自后端API → 检查后端是否净化
- 参数是硬编码 → 标记为潜在风险

### URL跳转漏洞检测

**目标：** 发现钓鱼和重定向漏洞

检测模式（Grep）：
```
window\.location\.href\s*=
location\.href\s*=
location\.replace\(
location\.assign\(
window\.open\(
history\.pushState\(
history\.replaceState\(
meta.*refresh.*url
<a[^>]+href\s*=\s*["']
```

**白名单检测：**
```
\.startsWith\(
\.hostname\s*===\?
\.host\s*===\?
whitelist
allowedDomains
isTrustedUrl
isTrustedDomain
```

**分析规则：**
- 若跳转目标来自用户输入且无白名单验证 → URL跳转漏洞
- 若白名单仅使用 `startsWith` 检查 → 可能被绕过（`trusted.com.attacker.com`）
- 严格域名比较（`===`）而非 `startsWith` → 安全

### WebSocket 安全检测

**目标：** 发现 WebSocket 安全问题

检测模式（Grep）：
```
new WebSocket\(
ws://
wss://
WebSocket
```

**分析规则：**
- 使用 `ws://`（非加密）→ Medium
- 检查 Origin 头是否验证
- 检查是否使用子协议

## 前端 Control-Driven 审计

### 本地存储敏感信息泄露

**目标：** 发现敏感数据在前端存储的泄露

检测模式（Grep）：
```
localStorage\.setItem\(
localStorage\["[^\"]+"\]\s*=
sessionStorage\.setItem\(
sessionStorage\["[^\"]+"\]\s*=
wx\.setStorage\(
my\.setStorage\(
tt\.setStorage\(
Taro\.setStorage\(
uni\.setStorage\(
```

**敏感信息关键词：**
```
token
access_token
refresh_token
id_token
password
pwd
passwd
secret
api_key
apiKey
appid
appsecret
userInfo
profile
sessionId
jsessionid
sid
auth
credential
private_key
privateKey
```

**分析规则：**
- 明文存储敏感信息 → Medium/High
- 若使用加密（`CryptoJS.AES`）→ 评估密钥管理
- 若使用 HttpOnly cookie 存储 session → 安全

### 前端鉴权绕过检测

**目标：** 发现前端权限控制绕过

#### 路由守卫检测（Grep）
```
beforeEach\(
beforeEnter\(
NavigationGuard
onBeforeRouteLeave
useRouter\(\)\.beforeEach
RouteGuard
router\.beforeResolve
```

#### 条件渲染检测（Grep）
```
v-if\s*=\s*["']?isAdmin
v-if\s*=\s*["']?hasPermission
v-if\s*=\s*["']?role
\{[^}]*&&\s*<[^>]*Admin
\{[^}]*&&\s*<[^>]* Privileged
\{\s*user\.role\s*===\s*['"]admin['"]
```

#### 隐藏元素检测（Grep）
```
display\s*:\s*none
visibility\s*:\s*hidden
type\s*=\s*["']hidden["']
opacity\s*:\s*0
```

**分析规则：**
- 仅前端路由守卫判断 → 高风险（可被 curl 直接调用 API 绕过）
- 需配合后端 token 验证 → 安全
- 隐藏的管理员按钮 → 检查是否调用敏感 API

### 敏感信息硬编码检测

**目标：** 发现前端硬编码的密钥和凭据

检测模式（Grep）：
```
api_key\s*[=:]\s*["'][^"']{8,}["']
apiKey\s*[=:]\s*["'][^"']{8,}["']
secret\s*[=:]\s*["'][^"']{8,}["']
password\s*[=:]\s*["'][^"']{4,}["']
token\s*[=:]\s*["'][^"']{16,}["']
access_token\s*[=:]\s*["'][^"']{16,}["']
AWS_ACCESS_KEY
AWS_SECRET_KEY
GOOGLE_API_KEY
STRIPE_KEY
STRIPE_SECRET
paypal_key
paypal_secret
map_key
mapAppId
```

**排除规则：**
- 值为 `""` → 排除
- 值为 `${...}` 环境变量引用 → 排除
- 值为 `process.env.XXX` → 排除
- 仅在注释中 → 进入灰色地带

**分析规则：**
- 硬编码密钥任何人可见 → Critical
- 地图API Key / 支付Key 泄露 → 可导致资源被盗用 → High

### CORS前端配置检测

**目标：** 发现 CORS 配置错误

检测模式（Grep）：
```
Access-Control-Allow-Origin
allow-origin
withCredentials\s*:\s*true
xhr\.withCredentials
axios\.defaults\.withCredentials
fetch\(\s*\{[^}]*credentials\s*:\s*['"]include['"]
```

**分析规则：**
- `AllowAll (*) + credentials:true` → Critical
- `AllowAll (*)` 无 credentials → High
- 从环境变量读取 Origin → 检查后端是否验证白名单

### OAuth / 第三方登录检测

**目标：** 发现 OAuth 实现漏洞

检测模式（Grep）：
```
redirect_uri
callback_url
oauth/
OAuth
authorization_url
access_token
refresh_token
```

**分析规则：**
- 回调 URL 是否验证白名单
- Token 是否通过 URL 参数传递（Referer 头会泄露）
- 是否使用 state 参数防止 CSRF

## 前端 Logic-Driven 审计

### 前端越权检测

**目标：** 发现前端权限绕过

#### URL 参数篡改检测（Grep）
```
/api/[a-z]+/\{?\d+\}?
/api/[a-z]+/\d+
\?userId=
\?id=
\?orderId=
\?admin=
```

#### 变量权限判断检测（Grep）
```
if\s*\(\s*user\.role\s*===?\s*['"]admin['"]
if\s*\(\s*user\.isAdmin
if\s*\(\s*user\.permission
if\s*\(\s*hasRole\(
if\s*\(\s*can\(
```

**分析规则：**
- 纯前端判断可被 curl/Postman 绕过
- 需配合后端权限验证

### 前端金额篡改检测

**目标：** 发现前端价格/数量篡改

检测模式（Grep）：
```
price\s*\*\s*quantity
total\s*=\s*price\s*
amount\s*=\s*count\s*
discount\s*=
fee\s*=
 subtotal
grandTotal
```

**分析规则：**
- 前端计算金额，后端未重新验证 → High（价格篡改）
- 后端重新查询价格 → 安全
- 检查数量是否有合法性验证（负数、超大值）

### CSRF 漏洞检测

**目标：** 发现跨站请求伪造

检测模式（Grep）：
```
fetch\(
axios\(
XMLHttpRequest
```

**分析规则：**
- 检查是否使用 SameSite cookie
- 检查是否自定义 CSRF token
- 检查是否验证 Origin/Referer 头

## 小程序专项审计

### 微信小程序检测

**目标：** 发现微信小程序安全问题

检测模式（Grep）：
```
wx\.setStorage\(
wx\.getStorage\(
wx\.request\(
wx\.login\(
wx\.getUserInfo\(
appid\s*=
appsecret\s*=
```

**分析规则：**
- `appid`/`appsecret` 硬编码 → Critical
- `request` 需配置合法域名白名单
- `setStorage` 不应存储敏感信息（明文）

### 支付宝小程序检测

**目标：** 发现支付宝小程序安全问题

检测模式（Grep）：
```
my\.httpRequest\(
my\.setStorage\(
my\.getStorage\(
my\.login\(
appid\s*=
```

### 字节小程序检测

**目标：** 发现字节小程序安全问题

检测模式（Grep）：
```
tt\.request\(
tt\.setStorage\(
tt\.login\(
tt\.getUserInfo\(
```

## TypeScript 特有检测

### 类型断言滥用

**目标：** 发现类型安全绕过

检测模式（Grep）：
```
\.as\s*
\<[A-Z][a-z]+\>
any\)
```

### any 类型使用

**目标：** 发现类型安全弱点

检测模式（Grep）：
```
:\s*any
as\s+any
Object\s*
```

## 污染追踪规则（前端特定）

### 前端污染来源判断

| 来源 | 风险级别 | 说明 |
|------|---------|------|
| `location.search` | 高 | URL参数，用户完全可控 |
| `location.hash` | 高 | URL hash，用户完全可控 |
| 表单输入 | 高 | 用户输入 |
| `postMessage` 数据 | 高 | 外部传入，未验证 |
| `localStorage` | 中 | 用户本地数据，可能被篡改 |
| 后端API响应 | 低 | 假设已净化 |

### 净化函数识别

| 净化函数 | 能防御 | 说明 |
|---------|--------|------|
| `textContent` | DOM-XSS | 最安全 |
| `innerText` | DOM-XSS | 安全但不防 protocol 级 |
| `encodeURIComponent` | URL-XSS | 只防URL参数 |
| `DOMPurify.sanitize()` | HTML-XSS | 需确认配置 |
| `validator.escape()` | XSS | 基本转义 |

### Vue 3 响应式数据追踪

**目标：** 追踪 Vue 3 中用户输入到 Sink 的数据流

检测模式（Grep）：
```
ref\(
reactive\(
computed\(
watch\(
watchEffect\(
```

**分析规则：**
- 检查 ref/reactive 的数据来源
- 追踪用户输入 → data → template → innerHTML 的完整路径

---

## 前端校验绕过检测 **[NEW]**

**目标：** 发现前端有限制但后端未校验的漏洞模式

### 负数/小数参数绕过

**基于历史真实案例：** Pacstrust(sort 负数)、Udun(金额负数)、Cregis(数量小数)

检测模式（Grep）：
```
min\s*=\s*["']0|max\s*=\s*["']
disabled|readonly|type\s*=\s*["']number
<input.*pattern|<input.*step=
```

**分析规则：**
- 前端有 `min="0"` 限制，后端未校验 `> 0`
- 前端有 `disabled` 限制，后端未校验参数范围
- 前端计算金额 `price * quantity`，后端直接使用

### 返回包依赖绕过

**基于历史真实案例：** CSPN 密码验证绕过（篡改 `isPassed` 字段）

检测模式（Grep）：
```
isPassed|verifySuccess|\.data\.success|\.data\.passed
response\.data\.|res\.data\.
```

**分析规则：**
- 前端根据 `response.data.isPassed` 判断操作结果
- 关键操作不依赖服务端直接执行，而是等待前端判断
- 篡改返回包状态字段即可绕过

### Token 本地存储检测

**基于历史真实案例：** Pacstrust Token 无过期时间

检测模式（Grep）：
```
localStorage\.setItem.*token|localStorage\["token"\]
sessionStorage\.setItem.*token
```

**分析规则：**
- Token 存储在 `localStorage` 中
- 前端无过期时间检查逻辑
- Token 注销后不清理

### 金额前端计算检测

**基于历史真实案例：** Cregis 购买数量篡改（200$ 买到 500 万额度）

检测模式（Grep）：
```
price\s*\*\s*quantity|total\s*=.*price
amount.*=.*calculate|应付|实付
```

**分析规则：**
- 前端计算 `price * quantity = total`
- 前端将计算后的 `total` 传递给后端
- 后端未重新查询价格并计算

### 敏感信息前端泄露

**基于历史真实案例：** Pacstrust 前端 JS 文件泄露密码

检测模式（Grep）：
```
password.*:.*['"][^"']{4,}['"]|secret.*:.*['"][^"']{8,}['"]
api_key.*:.*['"][^"']{8,}['"]|token.*:.*['"][^"']{16,}['"]
```

**分析规则：**
- 扫描所有 JS/TS 文件中的密码、密钥、API Key
- 检查是否为硬编码
- 检查是否可通过前端源码获取