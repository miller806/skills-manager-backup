---
name: api-security
description: API安全专项规则 — if:api 时加载
config:
  progression:
    phase: "2A/2B"
    name: "API Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "REST API / GraphQL / gRPC detected"
    when: "if: api"
---

# API Security Rules

**Phase**: 2A/2B (Sink-Driven & Control-Driven Audit)
**Previous**: Phase 1 Reconnaissance
**Next**: Phase 3 Static Verification
**Trigger**: `if: api` 检测到 REST/GraphQL/gRPC 技术栈

API专项安全规则。覆盖 REST API、GraphQL、gRPC 的常见漏洞模式。

## 技术栈指纹

| 指纹 | 技术栈 |
|------|--------|
| `openapi.yaml` / `openapi.json` | OpenAPI/Swagger |
| `api/` 路由目录 | REST API |
| `graphql` / `typeDefs` | GraphQL |
| `grpc` / `protobuf` | gRPC |
| `@RestController` | Spring REST |
| `[Route]` / `[ApiController]` | ASP.NET Core |
| `@api` (Flask) | Python REST |

---

## REST API 检测

### SQL注入 (API参数)

**目标：** 发现 API 参数中的 SQL 注入

检测模式（Grep）：
```
/api/.*\$
/api/.*\{\s*\}  // 路径参数
@RequestParam
@PathVariable
@QueryParam
req\.params
req\.query
request\.args
```

**分析规则：**
- 用户输入进入 SQL 查询 → SQL注入
- 需检查参数化查询使用

### 水平越权 (IDOR)

**目标：** 发现 API 资源访问控制缺陷

检测模式（Grep）：
```
/api/users/\{id\}
/api/orders/\{id\}
/api/\{resource\}/\{id\}
GET /api/.*/
PUT /api/.*/
DELETE /api/.*/
```

**分析规则：**
- API 直接使用用户提供的 ID → IDOR
- 需检查是否验证资源所有权

### Mass Assignment

**目标：** 发现批量赋值漏洞

检测模式（Grep）：
```
create\(
update\(
save\(
post\(
put\(
\$request->all\(\)
req\.body
request\.json
```

**分析规则：**
- 直接使用用户输入创建/更新对象 → Mass Assignment
- 需检查是否有字段白名单

### 缺少认证检测

**目标：** 发现未受保护的 API 端点

检测模式（Grep）：
```
@PostMapping.*without.*auth
@Anonymous
permitAll\(
authorize\(|authenticationScheme
```

**分析规则：**
- 敏感操作无认证注解 → 安全风险
- 需检查 `/api/` 下的认证覆盖

### 速率限制缺失

**目标：** 发现 API 限流配置缺陷

检测模式（Grep）：
```
@RateLimiter
@Throttle
rate_limit
max_requests
throttle
```

**分析规则：**
- API 无速率限制 → DoS/暴力破解风险
- 需检查全局限流配置

---

## GraphQL 检测

### Introspection 暴露

**目标：** 发现 GraphQL schema 泄露

检测模式（Grep）：
```
schema\.introspection
__schema
__type
 introspection
```

**分析规则：**
- 生产环境开启 introspection → 信息泄露
- 应禁用或限制访问

### Query Complexity

**目标：** 发现 GraphQL 查询复杂度漏洞

检测模式（Grep）：
```
queryComplexity
maxDepth
maxCost
```

**分析规则：**
- 无查询深度限制 → DoS 风险
- 嵌套查询可导致资源耗尽

### Batch Query (Batching Attack)

**目标：** 发现 GraphQL 批量查询风险

检测模式（Grep）：
```
query batch
query batching
ArrayQuery
```

**分析规则：**
- 允许批量查询 → 暴力破解风险
- 需配合速率限制

### Field-level 授权

**目标：** 发现字段级权限控制缺失

检测模式（Grep）：
```
@auth
hasRole\(
isAuthenticated
resolver.*auth
```

**分析规则：**
- 敏感字段无权限控制 → 数据泄露
- 需检查 resolver 级别的授权

### Injection (Query/Mutation)

**目标：** 发现 GraphQL 注入

检测模式（Grep）：
```
resolver\(
Query\(
Mutation\(
Subscription\(
```

**分析规则：**
- resolver 中使用用户输入 → 需参数化
- 检查 `context` 中的用户输入处理

---

## gRPC 检测

### 认证检测

**目标：** 发现 gRPC 认证配置缺陷

检测模式（Grep）：
```
grpc.credentials
credentials\.createSSL
credentials\.createInsecure
WithCallCredentials
CallCredentials
```

**分析规则：**
- 使用 `createInsecure()` → 明文传输
- 需使用 TLS 凭证

### Authorization 检测

**目标：** 发现 gRPC 授权缺陷

检测模式（Grep）：
```
checkCall
ServerInterceptor
authorization
permit\(
deny\(
```

**分析规则：**
- 需检查拦截器中的权限验证
- 检查每个 RPC 方法的授权

---

## OAuth 2.0 / OIDC 检测

### Redirect URI 验证

**目标：** 发现 OAuth 重定向 URI 验证缺陷

检测模式（Grep）：
```
redirect_uri
authorizationEndpoint
tokenEndpoint
```

**分析规则：**
- Redirect URI 未验证 → 授权码劫持
- 需验证 URI 在白名单中

### Token 泄露检测

**目标：** 发现 Token 处理缺陷

检测模式（Grep）：
```
access_token
refresh_token
id_token
bearer
Authorization.*Bearer
```

**分析规则：**
- Token 在 URL 中传递 → 日志泄露
- 需使用 `Authorization` 头

### Scope 验证

**目标：** 发现 OAuth Scope 控制缺陷

检测模式（Grep）：
```
scope=
scopes
requested_scope
```

**分析规则：**
- 未验证请求的 scope → 权限提升
- 需在服务端显式验证 scope

---

## JWT 检测

### Algorithm Confusion

**目标：** 发现 JWT 算法混淆漏洞

检测模式（Grep）：
```
jwt\.
JwtAuth
SecretKey
HS256
RS256
```

**分析规则：**
- 使用 `none` 算法 → Token 伪造
- 需使用 RS256 或 RS512

### Key Management

**目标：** 发现 JWT 密钥管理缺陷

检测模式（Grep）：
```
jwtSecret
jwt\.secret
JWT_SECRET
```

**分析规则：**
- JWT secret 硬编码 → Token 伪造
- 需使用环境变量或密钥管理服务

### Claims 验证

**目标：** 发现 JWT Claims 验证缺陷

检测模式（Grep）：
```
jwt\.verify
verify\(token
\.exp\(
\.iat\(
\.nbf\(
```

**分析规则：**
- Token 无过期验证 → 重放攻击
- 需验证 `exp`, `iat`, `nbf` claims

---

## API 安全配置检测

### CORS 配置

检测模式（Grep）：
```
Access-Control-Allow-Origin
AllowAll
origins\s*=\s*\[\]
credentials\s*:\s*true
```

**分析规则：**
- `AllowAll + credentials:true` → Critical
- 需配置明确的 Origin 白名单

### Rate Limiting

检测模式（Grep）：
```
rateLimit
maxRequests
throttle
@RateLimiter
```

**分析规则：**
- API 无速率限制 → DoS 风险
- 需配置全局和端点级别限流

### Input Validation

检测模式（Grep）：
```
@Valid
@NotNull
@NotBlank
@Size
validation
validate\(\)
```

**分析规则：**
- API 参数无验证 → 注入风险
- 需添加请求体验证

---

## 敏感 API 端点检测

### 管理接口暴露

检测模式（Grep）：
```
/admin
/management
/console
/actuator
/debug
```

**分析规则：**
- 管理接口公开 → 高风险
- 需限制内网访问或添加认证

### 敏感数据 API

检测模式（Grep）：
```
/api/users
/api/passwords
/api/keys
/api/secrets
/api/export
```

**分析规则：**
- 敏感端点需严格访问控制
- 需检查认证和授权

---

## GraphQL 特定 Sink

### 危险 Resolver 模式

```
// 危险：直接使用参数查询
Query.users(_, { filter }) {
  return db.query("SELECT * FROM users WHERE " + filter);
}

// 安全：参数化查询
Query.users(_, { filter }) {
  return db.query("SELECT * FROM users WHERE id = $1", [filter.id]);
}
```

### 嵌套查询 DoS

```
// 危险：无深度限制
query {
  user {
    posts {
      comments {
        author {
          posts { ... }  // 无限嵌套
        }
      }
    }
  }
}
```

---

## 未授权 API 检测 **[NEW]**

基于历史报告中高频出现的未授权访问问题（Pacstrust、Cregis、AurumVault、CSPN 均有发现）

### Swagger/API 文档未授权

检测模式（Grep）：
```
springfox|springdoc|swagger-ui|api-docs
@EnableSwagger2|@OpenAPIDefinition
/v2/api-docs|/v3/api-docs|/swagger-ui
```

**分析规则：**
- 检查生产环境是否禁用 Swagger
- 检查 `/v2/api-docs`、`/v3/api-docs`、`/swagger-ui.html` 是否需认证
- 历史案例：Udun 3 处、Cregis 2 处

### 权限树/角色接口未授权

检测模式（Grep）：
```
/portal/role|/role/findTree|/role/query|/role/new
PermissionTree|RoleTree|MenuTree|权限树
```

**分析规则：**
- `/portal/role/findTree`、`/portal/role/new/findTree` 等接口是否有 `@PreAuthorize`
- 历史案例：AurumVault 后台 `/api/admin/portal/role/new/findTree` 未授权可获取完整权限树

### 导出接口数据隔离检测

检测模式（Grep）：
```
export.*\(\)|导出|Excel|csv|download
getSysRemitExcel|getMerchantBillExcel|getOrderExcel
```

**分析规则：**
- 导出接口 SQL 是否强制包含当前用户 ID 过滤
- 不传筛选条件时是否返回全量数据
- 历史案例：CSPN 汇款记录导出 — 不添加筛选条件可导出全平台所有用户记录

### 审批类接口权限检测

检测模式（Grep）：
```
reject.*\(|approve.*\(|audit.*record|approval.*status
/sign/rejectSingle|/sign/approve|审批.*驳回|审批.*通过
```

**分析规则：**
- 审批接口是否校验当前用户的审批权限
- 是否校验"当前用户是否为该记录的审批人"
- 历史案例：Udun 审批驳回接口 — 任意用户遍历 ID 即可驳回他人审批

### 水平越权 API 检测增强

**分析规则：**
- 搜索所有包含 `*Id` 参数的接口（`userId`、`walletId`、`payeeId`、`fileId`、`roleId`、`orderId`）
- 对每个接口，检查 SQL 或 ORM 查询是否包含 `user_id` / `merchant_id` / `team_id` 过滤
- 检查修改/删除操作是否校验数据归属
- 检查 ID 是否可预测（自增 vs UUID）
- 历史案例：Pacstrust 中台（修改 userId 可重置任意用户权限）、Udun（修改 walletId 可查看任意钱包）

---

## API 安全污染追踪

### 变量污染状态判断

| 来源类型 | 标记 | 风险级别 |
|---------|------|---------|
| `@RequestParam` / `@QueryParam` | TAINTED-用户输入 | 高 |
| `@PathVariable` | TAINTED-用户输入 | 高 |
| `@RequestBody` | TAINTED-用户输入 | 高 |
| `req.params` (Express) | TAINTED-用户输入 | 高 |
| GraphQL `args` | TAINTED-用户输入 | 高 |
| gRPC Request body | TAINTED-用户输入 | 高 |
| 数据库查询结果 | TAINTED-数据库 | 中 |
| Redis/缓存 | TAINTED-缓存 | 中 |

### 净化函数识别

| 场景 | 净化函数 | 说明 |
|------|---------|------|
| SQL | Parameterized query | `?`, `$1`, `@param` |
| NoSQL | Input validation | Schema validation |
| GraphQL | Field authorization | `@auth` or resolver check |
| OS Command | Avoid shell execution | Use execFile |
| File Path | Path validation | Canonicalization + whitelist |

---

## 报告模板

### API 安全发现示例

```markdown
### [HIGH] GraphQL Introspection Enabled

**位置**: `graphql/schema.js`

**问题描述**: 生产环境 GraphQL introspection 端点 (`__schema`) 可被访问

**影响**: 攻击者可获取完整 API schema，发现隐藏端点和数据类型

**修复建议**:
```javascript
// 生产环境禁用 introspection
const schema = new GraphQLSchema({
  query: RootQuery,
  introspection: process.env.NODE_ENV !== 'production'
});
```

**修复优先级**: P1 (1周)
```