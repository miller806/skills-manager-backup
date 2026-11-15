---
name: audit-execution
description: 审计执行流程规范 — 触发审计时加载
config:
  progression:
    - phase: "0"
      name: "Initialization"
      next: "Phase 1: Reconnaissance"
      trigger: "触发词匹配"
    - phase: "1"
      name: "Reconnaissance"
      next: "Phase 2: Parallel Audit"
      trigger: "项目画像完成"
    - phase: "2"
      name: "Parallel Audit"
      substages: ["2A", "2B", "2C", "2E", "2M", "2F", "2J", "2D"]
      next: "Phase 3: Static Verification"
      trigger: "所有轨道审计完成"
    - phase: "3"
      name: "Static Verification"
      next: "Phase 4: Grey Zone Quantification"
      trigger: "五重验证通过"
    - phase: "4"
      name: "Grey Zone Quantification"
      next: "Phase 5: Dynamic Risk Rating"
      trigger: "灰色地带评分完成"
    - phase: "5"
      name: "Dynamic Risk Rating"
      next: "Phase 6: Structured Output"
      trigger: "风险定级完成"
    - phase: "6"
      name: "Structured Output"
      next: "END"
      trigger: "报告写入完成"
---

# Audit Execution Flow

**流程概述**: Phase 0 (初始化) → Phase 1 (侦察 + 组件识别) → Phase 2 (分组件审计) → Phase 2J (联合审计) → Phase 3 (静态验证) → Phase 4 (灰区量化) → Phase 5 (风险定级) → Phase 6 (结构化输出)

## Trigger Detection

当检测到以下触发词时，自动进入审计模式：
- `/audit`
- `审计`
- `代码审计`
- `安全检查`
- `check security`
- `audit this`

**[NEXT: Phase 0]** 触发词匹配后，首先执行Phase 0初始化。

## Phase 0: Initialization

首先，读取 `SKILL.md` 规则文件，然后按顺序完成以下初始化步骤：

**语言规则加载（扩展版）：**
- `if: java` → 加载 `references/java.md`
- `if: python` → 加载 `references/python.md`
- `if: nodejs` → 加载 `references/node.md`
- `if: golang` → 加载 `references/go.md`
- `if: php` → 加载 `references/php.md` **[NEW]**
- `if: csharp` → 加载 `references/csharp.md` **[NEW]**
- `if: rust` → 加载 `references/rust.md` **[NEW]**
- `if: kotlin` → 加载 `references/kotlin.md` **[NEW]**
- `if: frontend` → 加载 `references/frontend.md`
- `if: api` → 加载 `references/api-security.md` **[NEW]**

**真实漏洞模式库加载 [NEW]：**
- 加载 `references/real-world-patterns.md` — 基于 18 份历史渗透测试报告归纳的高频漏洞模式
- 加载 `references/business-logic-patterns.md` — 业务逻辑漏洞专项规则
- `if: java (spring-boot)` → 加载 `references/springboot-security.md` — SpringBoot 基础设施安全

**执行模式检测：**
- 检测编译环境（mvn/gradle/node/python/go/php/dotnet/cargo）
- 检测网络访问能力
- 特殊场景降级（CI环境变量 → static）
- 设置执行模式标志（hybrid/static/full）

**[NEXT: Phase 1]** 一旦Phase 0完成（配置加载、语言规则选择、执行模式检测），立即进入Phase 1侦察阶段。

## Phase 1: Reconnaissance + Component Identification

接下来，执行项目侦察，按顺序完成以下步骤：

### 1.1 技术栈指纹识别（根据指纹文件存在性判断）：

**后端组件识别：**
- `pom.xml` / `build.gradle` → 后端-Java
- `package.json` → 后端-Node.js
- `go.mod` → 后端-Go
- `requirements.txt` / `pyproject.toml` → 后端-Python
- `composer.json` → 后端-PHP
- `*.csproj` / `*.sln` → 后端-C#
- `Cargo.toml` → 后端-Rust
- `build.gradle.kts` / `AndroidManifest.xml` → 后端-Kotlin/Android

**前端组件识别：**
- `vue.config.js` / `.vue文件` → 前端-Vue.js
- `next.config.js` / `.tsx文件` → 前端-React
- `angular.json` / `src/app/` → 前端-Angular
- 小程序指纹文件 → 前端-微信/支付宝/字节小程序
- `index.html` + jquery → 前端-jQuery/原生H5
- `uni-app` 配置 → 前端-跨端框架

**API/中间件组件识别：**
- `openapi.yaml` / `openapi.json` → API-OpenAPI
- `graphql` / `typeDefs` → API-GraphQL
- `grpc` / `*.proto` → API-gRPC

**客户端组件识别：**
- `AndroidManifest.xml` + `src/main/java` → 客户端-Android
- `*.xcodeproj` / `*.swift` → 客户端-iOS
- `React Native` 项目结构 → 客户端-RN

### 1.2 组件目录结构分析

使用 Glob 工具分析项目目录结构，识别：
- 各组件的源代码目录（如 `src/`, `client/`, `server/`, `app/`）
- 共享代码目录（如 `common/`, `shared/`, `packages/`）
- 配置文件目录（如 `config/`, `resources/`）

### 1.3 组件关系映射

分析组件间依赖关系：
- 前端如何与后端通信（REST/GraphQL/WebSocket/gRPC）
- 共享代码的使用情况
- API接口定义位置（是否在共享仓库）
- 认证/鉴权代码的共享方式

### 1.4 业务上下文收集：
- 部署环境识别（prod/dev/test）
- 接口分类（公开/认证/管理）
- 数据敏感度识别
- 框架版本识别

### 1.5 模块敏感度自动分级（CRITICAL/HIGH/MEDIUM/LOW）

### 1.6 输出项目组件报告

生成项目组件清单，格式如下：

```markdown
## 项目组件清单

| 组件名称 | 类型 | 技术栈 | 源代码目录 | 风险等级 | 备注 |
|---------|------|--------|-----------|---------|------|
| backend-api | 后端 | Java/Spring | server/ | CRITICAL | 核心API服务 |
| frontend-web | 前端 | Vue.js | client/web/ | HIGH | Web管理后台 |
| mobile-app | 客户端 | React Native | client/mobile/ | MEDIUM | 移动应用 |
| shared-libs | 共享 | TypeScript | packages/shared/ | HIGH | 被多个组件引用 |
```

**[NEXT: Phase 2]** 完成组件识别后，进入Phase 2分组件审计阶段。

## Phase 2: Component-Level Audit (分组件审计)

对每个识别出的组件分别执行审计。审计顺序：
1. **后端组件** → 执行 2A(Sink-Driven) + 2B(Control-Driven) + 2C(Logic-Driven)
2. **前端组件** → 执行 2E(Frontend Security)
3. **客户端组件** → 执行移动端专项审计
4. **API组件** → 执行 API安全专项审计

每个组件的审计完全独立，使用对应语言的规则文件。

### Phase 2A: Component Sink-Driven Audit

按组件执行 Sink 驱动审计：

**后端组件 Sink 检测：**
- `if: java` → 执行 Java Sink 检测 + `references/java.md`
- `if: python` → 执行 Python Sink 检测 + `references/python.md`
- `if: nodejs` → 执行 Node.js Sink 检测 + `references/node.md`
- `if: golang` → 执行 Go Sink 检测 + `references/go.md`
- `if: php` → 执行 PHP Sink 检测 + `references/php.md`
- `if: csharp` → 执行 C# Sink 检测 + `references/csharp.md`
- `if: rust` → 执行 Rust Sink 检测 + `references/rust.md`
- `if: kotlin` → 执行 Kotlin Sink 检测 + `references/kotlin.md`

**前端组件 Sink 检测：**
- `if: frontend-vue` → Vue.js 专项检测
- `if: frontend-react` → React 专项检测
- `if: frontend-angular` → Angular 专项检测
- `if: frontend-miniapp` → 小程序专项检测

**执行步骤：**
1. 仅扫描该组件的源代码目录
2. 构建污染三元组（来源/路径/净化历史）
3. 执行净化函数绕过检测
4. 识别隐蔽调用链（反射/字符串混淆/框架黑盒）
5. 输出 CONFIRMED / FALSE_POSITIVE / UNCONFIRMED / **COMPONENT_SCOPE**

### Phase 2B: Component Control-Driven Audit

按组件执行控制流审计：

- 通用：硬编码密钥、调试模式、CORS、认证缺失、TLS配置
- 各组件使用对应的语言专项规则

### Phase 2C: Component Logic-Driven Audit

按组件执行业务逻辑审计：

- 水平越权（IDOR）
- 垂直越权
- 金融/金额逻辑
- 并发安全
- 状态机/流程逻辑
- 重放攻击与幂等性

### Phase 2E: Component Frontend Security Audit

前端专项检测：

- DOM-XSS
- 前端命令执行
- URL跳转漏洞
- 本地存储敏感信息泄露
- 前端鉴权绕过
- 敏感信息硬编码
- CORS配置
- OAuth安全配置

### Phase 2M: Mobile Client Audit (客户端专项)

移动端专项检测：

- Android: Intent劫持、SharedPreferences安全、WebView安全
- iOS: Keychain安全、ATS配置、URL Scheme安全
- React Native: JSBundle安全、本地存储安全

### Phase 2F: API Security Audit (API专项)

API专项检测：

- REST API: 参数注入、认证绕过、速率限制
- GraphQL: Introspection暴露、Query复杂度、Batch查询
- gRPC: 认证配置、Authorization

### Phase 2A: 全局 Sink 驱动审计执行步骤

**执行步骤：**
1. 全局搜索每个 Sink 函数（使用语言对应的 grep 模式）
2. 对每个命中点读取上下文（±30行）
3. 构建污染三元组（来源/路径/净化历史）
4. 执行净化函数绕过检测
5. 识别隐蔽调用链（反射/字符串混淆/框架黑盒）
6. 输出 CONFIRMED / FALSE_POSITIVE / UNCONFIRMED

详见 `references/sink-libraries.md` 和 `references/sanitization-rules.md`

**每个组件审计完成后，汇总该组件的发现，不做跨组件关联。**

**[NEXT: Phase 2J]** 所有组件审计完成后，进入Phase 2J联合审计阶段。

## Phase 2J: Joint Audit (联合审计)

所有组件独立审计完成后，执行跨组件联合审计。结合整个项目上下文，验证和调整每个组件的发现。

### 2J.1 跨组件数据流追踪

**目标：** 验证组件间的数据流是否引入新的安全风险

**分析场景：**

| 跨组件场景 | 风险类型 | 联合验证点 |
|-----------|---------|-----------|
| 前端 → 后端 API | 参数注入、认证绕过 | 后端接收的参数是否在组件边界被净化？ |
| 客户端 → 后端 API | API 安全、Token 处理 | 客户端存储的凭证是否安全？后端是否验证来源？ |
| 后端 → 后端（微服务） | 内部调用、信任边界 | 服务间调用是否有额外的认证？ |
| 共享代码被多组件使用 | 漏洞放大 | 共享库的问题是否影响所有使用它的组件？ |
| 前端存储敏感数据 | 信息泄露 | localStorage/cookie 中的数据是否加密？ |

### 2J.2 组件边界风险重新评估

**对以下类型的发现进行跨组件验证：**

1. **前端发现的后端影响**
   - 前端XSS → 是否能获取后端API的认证Token？
   - 前端敏感数据泄露 → Token是否可用于后端API？
   - 前端鉴权绕过 → 是否能影响后端数据？

2. **后端发现的前端放大**
   - 后端SQL注入 → 是否能获取前端存储的敏感数据？
   - 后端认证缺陷 → 是否影响前端用户的会话安全？
   - 后端配置泄露 → 是否有前端相关的敏感配置？

3. **客户端发现的影响范围**
   - 客户端证书泄露 → 是否可用于伪造后端请求？
   - 客户端SSL绕过 → 是否能中间人攻击后端API？
   - 客户端数据篡改 → 后端是否校验客户端数据完整性？

### 2J.3 联合风险评分调整

基于跨组件分析，调整风险等级：

| 跨组件场景 | 原始等级 | 调整后等级 | 调整理由 |
|-----------|---------|-----------|---------|
| 前端XSS + 后端Token泄漏 | HIGH | CRITICAL | XSS可直接获取后端Token |
| 前端明文存储 + 后端无校验 | MEDIUM | HIGH | 客户端数据可被篡改后提交 |
| 后端SQL注入 + 前端无防护 | HIGH | CRITICAL | 数据可通过前端界面批量获取 |
| 微服务调用链 + 缺乏相互认证 | MEDIUM | HIGH | 横向移动风险增加 |

### 2J.4 攻击路径完整性验证

**验证完整攻击链是否可行：**

```
[前端漏洞] → [获取认证Token] → [使用Token调用后端API] → [数据外泄]
```

如果攻击链的每一步都能成功，则提升整体风险等级。

### 2J.5 输出联合审计报告

```markdown
## 联合审计发现

### 跨组件高风险组合
| 发现组合 | 涉及组件 | 关联风险 | 整体评级 |
|---------|---------|---------|---------|
| 前端XSS + 后端Token泄漏 | frontend-web, backend-api | XSS可直接获取API Token | CRITICAL |

### 组件边界风险调整
| 组件 | 原始发现数 | 调整后 | 调整原因 |
|-----|-----------|-------|---------|
| frontend-web | 3 | 5 | 发现影响backend-api的新路径 |
| backend-api | 5 | 4 | 部分发现被前端边界降低风险 |
```

**[NEXT: Phase 2D]** 联合审计完成后，进入Phase 2D动态验证（如适用）。

## Phase 2D: Dynamic Verification (Hybrid Mode Only)

`if: hybrid` 时执行，对灰色条目进行动态验证：

- 备份文件动态探测（HTTP访问验证）
- CORS实际验证（OPTIONS预检请求）
- 条件编译验证（生产参数编译）
- 反射调用链验证
- 未授权访问验证
- **【新增】未授权接口验证**: 对疑似未授权的接口（无 `@PreAuthorize`/`@Secured` 的 API），在 Hybrid 模式下尝试匿名访问，确认是否真的无需认证
- **【新增】JWT 过期验证**: 对疑似无过期时间的 JWT，验证其 payload 中是否包含 `exp` claim（解码后检查）
- **【新增】注销 Token 失效验证**: 登录 → 注销 → 使用原 Token 重放请求，确认是否仍可用
- **【新增】Actuator/Swagger/Nacos 暴露验证**: 尝试访问 `/actuator/env`、`/v3/api-docs`、`/nacos/index.html`，确认是否真的未授权
- **【新增】SSRF 内网探测验证**: 对疑似 SSRF 点，尝试访问 `http://127.0.0.1:8080` 或 `http://169.254.169.254/latest/meta-data/`，确认是否可访问内网
- **【新增】验证码一次性验证**: 获取验证码 → 使用一次 → 再次提交同一验证码，确认是否仍可验证通过
- **【新增】负数金额绕过验证**: 对前端有限制但后端未校验的数值参数，尝试传入负数/小数，确认后端是否拦截
- **【新增】邮箱轰炸验证**: 尝试在邮箱前后加空格提交，确认是否可绕过格式校验和频率限制

详见 `references/grey-zone-rules.md`

**Phase 2 Token 上限控制 [NEW]：**
- Phase 2 五轨并行审计时，每个轨道最多读取 **50 个文件**（Grep 命中后 Read 的前 50 个）
- 每个文件的读取范围不超过 **±30 行上下文**
- 如果 Grep 命中超过 50 个文件，按以下优先级排序读取：Controller > Service > DAO/Mapper > Config > 其他
- 总计 Phase 2 读取文件数不超过 **250 个文件**（5 轨道 × 50 文件）
- 如果达到上限仍未完成审计，输出 "Phase 2 完成（已读取 N/250 文件，剩余候选未验证）" 并进入 Phase 3

**[NEXT: Phase 3]** 所有Phase 2组件审计 + Phase 2J联合审计 + Phase 2D动态验证完成后，汇总所有发现并进入Phase 3静态验证。

## Phase 3: Static Verification

接下来，对所有发现的潜在漏洞执行五重防误报过滤器：

1. **文件存在性验证** - 确认文件确实存在于项目中
2. **代码真实性验证** - 逐字符比对，防止幻觉
3. **可达性验证** - 关键步骤，分析代码是否实际可达
4. **纯静态补偿逻辑验证** - 检查是否有配置层面的安全补偿
5. **污染链回溯验证** - 验证数据来源和净化历史

**强制追溯深度 [NEW]：**
- 每个 Sink 点的调用链必须向上追溯**至少 5 层**，或已到达 Controller/入口点（以先满足者为准）
- 仅追溯 2-3 层即停止 → **必须继续追溯**，不得提前结束

**净化匹配精确度 [NEW]：**
- 对每个净化函数命中点（如 `PreparedStatement`、`#{}`、`HtmlUtils.htmlEscape()`），必须用 Read 工具读取命中代码的 **±30 行上下文**
- 确认净化函数确实在数据传递路径上被调用，不是注释中的代码、不是不同上下文中的同名方法、不是条件分支中永远不满足的路径

**全项目范围补偿搜索 [NEW]：**
- 补偿逻辑检测（Filter/Interceptor/Middleware/网关防护）必须在**全项目范围内**搜索，不仅限于当前模块
- 搜索范围：所有 `*Filter*`、`*Interceptor*`、`*Middleware*`、`WebSecurityConfig*`、`SecurityFilterChain*`、网关配置文件、Nginx 配置
- **禁止**仅搜索当前模块或当前包的补偿机制

**逐字符比对防止 LLM 偷懒 [NEW]：**
- 对每个拟报告的漏洞，必须将 Read 工具返回的实际代码与候选漏洞进行**逐字符比对**
- 确认危险代码（如 `stmt.execute("SELECT..." + userInput)`）逐字符存在于代码中
- 如果 Read 输出与预期不符（如代码已被重构、参数名不同、实际是注释中的代码）→ **不报告**
- **Grep 仅用于定位候选代码，真正的验证必须通过 Read 读取实际代码**


**误报过滤器增强 **[NEW]**：**
- 加载 `engine/false-positive-filter.js`
- 检查净化函数使用（#{}、PreparedStatement等）
- 检查参数来源（配置项、系统生成）
- 检查常量模式（硬编码前缀）
- 标记并降级已净化漏洞

**可利用性评估 **[NEW]**：**
- 加载 `engine/exploitability-checker.js`
- 计算可达性评分（HTTP入口30分/内部调用5分）
- 计算认证要求（公开25分/需管理员5分）
- 计算网络位置（公网20分/内网5分）
- 计算参数可控性（用户输入15分/配置0分）
- 生成攻击场景模拟

**CVSS评分计算：**
- 加载 `engine/cvss-scorer.js`
- 计算每个漏洞的CVSS v3.1基础评分
- 生成CVSS向量字符串
- 用于最终风险评级

**攻击路径分析（可选）：**
- 启用 `--attack-path` → 加载 `engine/attack-path.js`
- 识别攻击入口点
- 追踪攻击链（初始访问→权限提升→横向移动→目标达成）
- 生成攻击路径图（DOT格式）

### Phase 3A: 可达性验证 (Critical)

**目标**: 确认 Sink 点是否实际可达，避免报告死代码中的"漏洞"

**验证步骤**:

#### 1. 方法调用链分析
```
Sink方法 (如: DBUtils.createByberCardsBill)
  ↑ 被谁调用? (Grep: DBUtils\.createByberCardsBill)
    ↑ 调用者又被谁调用?
      ↑ 最终到达 Controller/入口?
```

**强制追溯深度 [NEW]：**
- 每个 Sink 点的调用链必须向上追溯**至少 5 层**，或已到达 Controller/入口点（以先满足者为准）
- 仅追溯 2-3 层即停止 → **必须继续追溯**，不得以"看起来已经够了"为由提前结束
- 如果追溯 5 层仍未到达 Controller/入口点 → 标记为 UNCONFIRMED，**不输出到报告**

**规则**:
- 如果 Sink 方法**没有任何调用** → 标记为 `DEAD_CODE` (不报告)
- 如果 Sink 方法**仅被测试代码调用** → 标记为 `TEST_ONLY` (降级为 Low)
- 如果 Sink 方法**可达但需要特定权限** → 标记为 `AUTH_REQUIRED` (根据权限调整等级)

#### 2. 数据来源分析

**关键问题**: 危险参数是否可被外部输入控制?

```
外部输入 (HTTP Request/消息队列/文件上传)
  ↓
Controller/Listener 参数
  ↓
Service 层处理
  ↓
Sink 点执行
```

**分析检查项**:
- [ ] 参数是否有 `@RequestBody`/`@RequestParam`/`@PathVariable` 注解?
- [ ] 参数是否经过白名单校验/正则验证?
- [ ] 参数是否来自数据库/缓存等内部数据源?
- [ ] 参数是否被硬编码/配置值?

**判定规则**:
| 来源类型 | 可控性 | 风险调整 |
|---------|--------|---------|
| `@RequestBody`/`@RequestParam` | 高 | 保持原等级 |
| 内部 Service 调用 (Feign/内部API) | 中 | 降1级 (需确认调用方是否可控) |
| 数据库/缓存查询结果 | 低 | 降2级 |
| 配置项 (`@Value`) | 极低 | 降级为 Low/Informational |
| 硬编码常量 | 无 | 不报告 |

#### 3. 接口访问控制分析

**检查入口方法**:
- [ ] 是否有 `@PreAuthorize`/`@Secured`/`@RolesAllowed`?
- [ ] 是否有自定义注解 (如 `@PermissionCheck`)?
- [ ] 是否位于 `admin/` 包下?
- [ ] 是否有 API 网关/鉴权拦截?

**权限调整规则**:
- 公开接口 (无认证) → 保持原等级
- 需要登录 → 降1级
- 需要管理员权限 → 降1级 (仍需修复，但利用难度增加)

### Phase 3B: 上下文分析

**目标**: 理解代码的实际运行环境，避免脱离上下文的误判

**分析维度**:

1. **网络可达性**
   - 内网服务 (如 Feign 调用) vs 公网暴露
   - 微服务内部调用 vs 网关暴露

2. **数据流向**
   ```
   用户输入 → 直接传递 → Sink 点 (高风险)
   用户输入 → 数据库存储 → 查询 → Sink 点 (中风险)
   系统生成 → Sink 点 (低风险)
   ```

3. **框架保护**
   - Spring Security 是否启用?
   - API 网关是否有 WAF?
   - 参数是否有框架级校验?

### Phase 3C: 误报修正案例

**案例 1: HttpClient SSRF 误报**
```
原始判定: HttpUtils.getJson() 存在 SSRF (HIGH)
分析过程:
  1. 方法调用链: getJson() 未被任何代码调用
  2. 实际使用的 postJson() 的 URL 来自 @Value 配置
  3. 配置值非用户可控
修正结果: 降级为 LOW (安全债务 - 使用已弃用API)
```

**案例 2: SQL注入风险评估调整**
```
原始判定: DBUtils.createByberCardsBill() 存在 SQL注入 (CRITICAL)
分析过程:
  1. 方法确实被调用 (ByberServiceImpl.createMerchantBillTable)
  2. 参数 merchantId 通过 Feign 从 admin 服务传入
  3. 检查调用方: 位于管理员后台，需特定权限开通服务
  4. merchantId 通常由系统生成，但理论上可构造恶意值
修正结果: 降级为 MEDIUM (利用需管理员权限)
```

**[NEXT: Phase 3D]** 完成Phase 3五重静态验证和可达性分析后，进入Phase 3D漏洞分类与定级。

### Phase 3D: 漏洞分类与定级

**目标**: 区分漏洞类型，避免混淆代码漏洞和配置问题

#### 漏洞分类标准

| 类型 | 定义 | 示例 | 修复责任 |
|------|------|------|---------|
| **代码漏洞** | 代码实现层面的安全缺陷 | SQL注入、XSS、越权、反序列化 | 开发团队 |
| **配置问题** | 部署配置不当导致的安全问题 | 明文密码、默认凭证、调试模式 | 运维/DevOps |
| **架构问题** | 系统设计层面的安全缺陷 | 缺乏限流、单点故障、明文传输 | 架构师 |
| **安全债务** | 使用已弃用/不安全的API但不构成直接漏洞 | 使用DefaultHttpClient、过时加密算法 | 开发团队 |

#### 风险等级动态调整矩阵

**基础等级确定后，根据以下条件调整**:

| 调整条件 | 调整规则 | 示例 |
|---------|---------|------|
| 死代码 (无调用) | 不报告 | 未使用的工具方法包含SQL拼接 |
| 仅测试代码调用 | 降2级 | 测试类中的硬编码密码 |
| 需管理员权限 | 降1级 | 管理后台的SQL注入 |
| 配置项参数 | 降1-2级 | URL来自@Value配置 |
| 多层内部调用 | 降1级 | Feign→Service→Sink |
| 公开接口+敏感操作 | 升1级 | 匿名用户可访问的资金操作 |

**最终等级映射**:
```
调整后分数 ≥ 9  → CRITICAL
调整后分数 7-8  → HIGH
调整后分数 4-6  → MEDIUM
调整后分数 1-3  → LOW
调整后分数 0    → INFORMATIONAL / 不报告
```

**[NEXT: Phase 3E]** 完成Phase 3D分类定级后，进入Phase 3E跨项目确认。**只有通过此阶段的漏洞才会被输出到最终报告。**

### Phase 3E: Cross-Project Confirmation (跨项目确认)

**核心原则：单文件命中 ≠ 漏洞。必须在整个项目范围内验证完整攻击链成立。**

#### 3E.1 入口点验证 (Entry Point Verification)

对每个候选漏洞，必须在项目中找到**实际可访问的入口点**：

```
入口点类型          验证方法                              判定标准
──────────────────────────────────────────────────────────────────
HTTP Controller    Grep 路由注解 + 确认未被中间件拦截     路由可被外部请求到达
消息队列消费者      Grep @RabbitListener/@KafkaListener   队列存在且消费消息含用户数据
gRPC 端点          Grep @GrpcService + .proto 定义        服务已注册且端口暴露
WebSocket 处理器    Grep @MessageMapping / onMessage      连接可被外部建立
定时任务            Grep @Scheduled + 参数来源             参数不可被外部控制 → 不报告
内部方法            向上追踪至任意外部入口                  追踪不到 → 标记 DEAD_CODE
```

**规则：** 如果找不到任何外部入口点（HTTP/MQ/RPC/WS），该发现**不输出**。

#### 3E.2 数据流全链验证 (Full Data Flow Chain)

从入口点到 Sink 点，逐段验证数据传递：

```
步骤 1: 入口参数接收
  → 检查注解 (@RequestBody/@RequestParam/@PathVariable)
  → 确认参数名与 Sink 参数名可关联

步骤 2: 层间传递
  → Controller → Service: 确认方法调用关系（Grep 方法名）
  → Service → DAO/Util: 确认参数未被替换或净化

步骤 3: 污染链完整性
  → 每一步都要确认数据确实传递了，不是"看起来像"
  → 如果发现中间有参数校验/类型转换/白名单过滤 → 重新评估
```

**验证方法：** 对链路上的每个方法调用，使用 Grep 确认调用关系真实存在。如果某一步的调用关系不明确（例如通过反射/动态代理），标记为 UNCONFIRMED 并**不输出**。

#### 3E.3 补偿机制排查 (Compensation Check)

在确认数据流可达后，**必须在整个项目范围内搜索安全补偿**：

| 补偿类型 | 全局搜索内容 | 判定 |
|---------|------------|------|
| 全局过滤器 | `Filter`/`Interceptor`/`Middleware` 中的安全处理 | 存在则降级 |
| 全局中间件 | CORS/Sanitize/Auth 中间件配置 | 存在则降级 |
| 网关层防护 | WAF 规则、API 网关配置 | 存在则降级 |
| 数据库层防护 | 预编译语句、ORM 自动转义 | 使用则不报告 |
| 框架级保护 | Spring Security 配置、JWT 验证中间件 | 启用则降级 |
| 输入校验注解 | `@Valid`/`@Validated` + DTO 校验规则 | 存在则降级 |
| 输出转义 | 全局 XSS 过滤器、CSP Header | 存在则降级 |

**关键规则：**
1. 补偿机制必须在**该项目中实际存在并启用**，不能假设"可能用了"。搜索项目配置文件和代码确认。
2. **【全项目范围搜索】**: 补偿搜索必须覆盖**整个项目**，不仅限于当前模块或当前包。具体搜索范围：
   - 所有 `*Filter*.java`、`*Interceptor*.java`、`*Middleware*.js/ts` 文件
   - 所有 `WebSecurityConfig*`、`SecurityFilterChain*`、`SecurityConfig*` 文件
   - 网关配置文件（如 Nginx `nginx.conf`、API Gateway 配置）
   - 应用配置文件（`application.yml/properties`、`web.xml`）
3. **【净化函数 ±30 行确认】**: 对每个净化函数命中点，必须用 Read 工具读取命中代码的 **±30 行上下文**，确认净化函数确实在数据传递路径上被调用，不是注释中的代码、不是不同上下文中的同名方法
4. **【禁止模块内搜索】**: 仅搜索当前模块/当前包的补偿机制 → **判定为未完成**，必须扩大至全项目范围

#### 3E.4 最终确认清单 (Final Confirmation Checklist)

每个候选漏洞必须通过以下**全部 6 项**才能输出到报告：

```
[ ] 1. 入口点确认：存在可外部访问的入口 (Controller/MQ/RPC/WS)
[ ] 2. 调用链确认：从入口到 Sink 的每一步调用关系已 Grep 验证
[ ] 3. 数据流确认：用户输入确实可以传递到 Sink 参数
[ ] 4. 参数可控：Sink 的危险参数来自外部输入，非配置/常量/系统生成
[ ] 5. 无补偿确认：项目中不存在全局过滤器/中间件/网关拦截该攻击
[ ] 6. 无净化确认：数据传递路径上不存在有效的净化/校验函数
```

**判定规则：**
- **6 项全部通过** → 输出到报告，保持原始评级
- **5-6 项通过** → 输出到报告，但降级 1 级，标注条件性
- **≤4 项通过** → **不输出**，从报告中剔除

#### 3E.4a 强制 Read 验证（Mandatory Read-before-report）**[NEW]**

**核心规则：** 对每个拟报告的漏洞，agent 必须用 `Read` 工具实际读取以下三段代码，**不得仅凭 Grep 文件名或函数名就报告漏洞**：

| 必须读取 | 读取范围 | 验证目的 |
|---------|---------|---------|
| **(a) Sink 点代码** | 危险函数调用所在方法（±30行上下文） | 确认危险代码真实存在、未被注释或条件分支保护 |
| **(b) 入口点代码** | Controller/API 端点方法（±30行上下文） | 确认入口点确实可被外部访问、有/无认证注解 |
| **(c) 至少一个中间节点** | 调用链上的 Service/DAO 方法（±30行上下文） | 确认数据确实在层间传递、参数未被替换或净化 |

**违反此规则的发现必须从报告中剔除。** 如果因代码无法读取（文件不存在、路径错误）导致无法完成三段读取，该发现**不输出**。

**读取检查要点：**
- Sink 点代码：确认危险函数确实被执行（不是注释、不是条件分支中永远不满足的路径）
- 入口点代码：确认路由注解存在（`@GetMapping`、`@PostMapping` 等）、认证注解存在或缺失
- 中间节点代码：确认参数从 Controller 到 Service 到 DAO 的传递路径完整，每一步的参数名和类型匹配

**示例：**
```
发现: SQL注入在 ByberAccountMapper.xml:16
必须执行:
  1. Read: ByberAccountMapper.xml ±5行（Sink 点）
  2. Read: ByberAccoutController.punchUp() 方法体（入口点）
  3. Read: ByberServiceImpl.punchUpAsset() 方法体（中间节点）
  4. Read: ByberAccountServiceImpl.updateAccount() 方法体（中间节点）

仅 Grep 到函数名 → 不报告
```

#### 3E.4b Phase 3E 强制执行规则（Enforcement）**[NEW]**

**核心：六项确认清单不是建议，是强制闸门。以下规则必须严格执行，不得跳过任何一项。**

**逐项确认规则：**
对每个候选漏洞，**必须**逐一完成以下 6 项确认，每一项都需要**实际的 Read 工具调用**作为证据：

1. **入口点确认** → 必须有 Read 工具读取的 Controller/API 端点代码（±30行），证明路由注解存在
2. **调用链确认** → 必须有 Grep 结果验证每一步调用关系，**至少追溯 5 层或到达入口点**（以先满足者为准）
3. **数据流确认** → 必须有 Read 工具读取的中间节点代码，证明参数在层间传递未被替换
4. **参数可控** → 必须有 Read 工具读取的入口点方法签名，证明参数来自 `@RequestBody`/`@RequestParam`/`@PathVariable`，而非 `@Value`/配置/常量
5. **无补偿确认** → 必须有**全项目范围** Grep 搜索 `*Filter*`、`*Interceptor*`、`*Middleware*`、`WebSecurityConfig*` 的结果，确认不存在全局防护
6. **无净化确认** → 必须有 Read 工具读取的净化函数命中代码（±30行），确认净化函数确实作用于该数据路径

**跳过禁止规则：**
- **不得**因为"Grep 到了 Filter 类"就认为补偿存在 → 必须 Read 确认 Filter 覆盖当前路径
- **不得**因为"看到 #{}/PreparedStatement"就认为净化存在 → 必须 Read 确认净化作用于当前参数
- **不得**因为"追溯 3 层没找到调用者"就停止 → 必须继续追溯到 5 层或入口点
- **不得**因为"看起来像"就下结论 → 必须逐字符比对 Read 输出的实际代码
- **不得**因为"时间不够/Token 不够"就跳过某项确认 → 跳过 = 从报告中剔除该发现

**判定执行：**
- 6 项全部通过（每项都有 Read/Grep 证据） → 输出到报告
- 5-6 项通过 → 输出到报告，但降级 1 级，标注条件性
- ≤4 项通过 → **直接丢弃，不输出到报告**（无论该漏洞看起来多严重）

#### 3E.5 特殊场景处理

**场景 A: 多模块项目中的跨模块调用**
```
前端模块 → 网关模块 → 业务模块 → 数据层
```
验证时必须追踪到**最外层入口**（通常是 Controller），不能因为业务模块中有危险代码就报告，如果入口被网关拦截则不报告。

**场景 B: 共享库/公共模块中的危险代码**
```
common-utils/ (被多个服务引用)
  └── SqlHelper.java (含 SQL 拼接)
```
- 搜索项目中哪些服务引用了该公共模块
- 对每个引用方，验证其入口 → 公共模块 → Sink 的完整链路
- 只有至少一个引用方的链路完整时，才报告（标注受影响的多个服务）
- 如果没有任何引用方有可达链路 → **不报告**

**场景 C: 条件编译/环境依赖**
```java
if (devMode) {
    // 危险操作: 执行用户输入的命令
}
```
- 检查 `devMode` 的来源：环境变量？配置文件？编译参数？
- 如果生产环境不可能触发 → **不报告**（或标注为配置风险而非代码漏洞）

**场景 D: 子域名越权（多租户平台）[NEW]**
```
用户A子域名: t-abc.cregis.dev → 接口未校验 Host 与用户绑定关系
用户B子域名: t-xyz.cregis.dev → 替换子域名可访问用户A数据
```
- 检查是否使用子域名隔离用户数据
- 检查接口是否校验请求 Host 与当前用户的绑定关系
- 验证：替换子域名后使用原 Token 访问接口，检查是否返回他人数据

**场景 E: 审批越权 [NEW]**
```
POST /sign/rejectSingle {"recordId": 123} → 任意用户遍历 ID 即可驳回他人审批
```
- 审批接口是否校验"当前用户是否为该记录的审批人"
- 验证：使用非审批人 Token 调用审批接口，检查是否成功

**[NEXT: Phase 4]** Phase 3E 跨项目确认完成后，仅保留通过确认的漏洞，进入Phase 4灰色地带量化评分。对未通过确认的条目直接丢弃，不再进入后续阶段。

## Phase 4: Grey Zone Quantification

然后，对 Phase 3E 确认通过的**灰色地带条目**（置信度较低或条件触发的发现）进行风险量化评分：

```
风险得分 = 基础风险分 × 触发概率系数 × 业务影响系数
```

**攻击链分析增强（可选）：**
- 启用 `--attack-chain` → 使用 `engine/attack-path.js` 进行攻击链分析
- 将灰色发现按攻击链分类
- 评估每个灰色条目的攻击路径贡献

分流处理：
- ≥15分 → 升级为正式漏洞
- 5-14分 → 中风险灰色（详细展示）
- <5分 → 低风险灰色（批量附录）

详见 `references/grey-zone-rules.md`

**[NEXT: Phase 5]** 完成Phase 4灰色地带评分后，进入Phase 5动态风险定级，结合业务上下文进行最终等级调整。

## Phase 5: Dynamic Risk Rating

执行业务上下文感知的风险定级，基于以下因素综合评估：

### 5.1 风险计算公式

```
最终风险分 = 基础风险分 × 可达性系数 × 访问控制系数 × 数据敏感度系数 × 业务影响系数
```

**CVSS v3.1评分增强：**
- 使用 `engine/cvss-scorer.js` 计算标准化CVSS评分
- 生成CVSS向量字符串（AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H）
- 映射到1-10分数和CRITICAL/HIGH/MEDIUM/LOW评级

### 5.2 等级映射表

| 分数范围 | 等级 | 修复时限 | 说明 |
|---------|------|---------|------|
| ≥ 9.0 | **CRITICAL** | 24小时 | 可远程利用，影响核心业务 |
| 7.0-8.9 | **HIGH** | 1周 | 利用有条件，但影响严重 |
| 4.0-6.9 | **MEDIUM** | 1月 | 需要特定条件才能利用 |
| 1.0-3.9 | **LOW** | 下一版本 | 影响有限，利用困难 |
| < 1.0 | **INFO** | 可选 | 安全债务，建议改进 |

### 5.3 红队攻击视角（可选）

**红队攻击视角：**
- 从攻击者角度评估每个漏洞
- 识别攻击链和横向移动路径
- 评估持久化潜力
- 攻击路径图由 `engine/attack-path.js` 生成

### 5.4 特殊调整规则

**升级规则** (满足任一即升1级):
- 金融行业 + 资金操作
- 医疗行业 + 患者数据
- 公开API + 无需认证
- 批量数据泄露风险

**降级规则** (满足任一即降1级):
- 需物理设备访问
- 需内部网络访问
- 需已认证管理员权限
- 利用链超过3个步骤

**[NEXT: Phase 6]** 完成Phase 5最终风险定级后，进入Phase 6结构化输出，生成审计报告。

---

## Phase 6: Structured Output

最后，执行结构化输出，完成审计流程，生成标准化审计报告。

### 6.1 按端分组输出策略

**核心原则：每个端一份独立报告，仅包含该端的漏洞发现。**

**安全范围过滤 **[NEW]**：** 在生成报告前，对所有候选发现执行安全范围过滤：
- **仅报告安全漏洞**：条目必须可被攻击者利用来破坏机密性（Confidentiality）、完整性（Integrity）或可用性（Availability）
- **不报告功能性 bug**：N+1 查询、空指针异常、逻辑错误、边界条件未处理、算法效率低
- **不报告性能问题**：慢查询、高 CPU、内存占用、GC 频率，除非可被利用为 DoS 攻击向量
- **不报告代码质量问题**：未使用的 import、代码风格、命名不规范、代码重复、硬编码魔法数字、缺少注释
- **不报告架构问题**：微服务拆分不当、模块耦合度高、依赖版本过旧（除非已知有 CVE），除非有直接安全影响

```
{项目名}_V{版本号}_{端}_audit_report.md
├── myapp_V1.0.0_java_audit_report.md      # Java端报告（仅Java漏洞）
├── myapp_V1.0.0_web_audit_report.md       # Web端报告（仅Web漏洞）
├── myapp_V1.0.0_android_audit_report.md   # Android端报告（仅Android漏洞）
└── myapp_V1.0.0_api_audit_report.md       # API端报告
```

**报告生成规则：**
1. 按端分组：审计发现的漏洞按所属端（java/web/android/nodejs/python/golang/php/csharp/rust/kotlin/api/config）分类
2. 每端一份报告：有至少 1 个发现的端生成独立报告，无发现不生成
3. 不生成汇总报告：仅输出各端独立报告
4. 跨端漏洞：在每个相关端报告中完整描述

### 6.2 漏洞去重合并

**去重判定条件：**
- 相同文件路径 + 行号（±5行范围）
- 相同 CWE 编号 + 相同 Sink 方法
- 相同根本原因

**去重处理规则：**
| 优先级 | 来源 | 处理方式 |
|-------|------|---------|
| 1 | 后端端（java/python/nodejs等） | 以后端端报告为准 |
| 2 | 前端端（web） | 以前端端报告为准 |
| 3 | API 端 | API 报告独立存在 |
| 4 | 配置文件端（config） | 在各端报告中标注 |

**跨端漏洞处理：**
- web 端 XSS + java 端 Token 泄露 → 在两个端报告中各完整描述一条
- 共享库漏洞 → 各受影响端标注受影响，修复指向共享库

### 6.3 报告结构（扩展版）

```
audit_report.md
├── 1. 执行摘要
│   ├── 审计概况
│   ├── 关键风险统计（扩展：含CVSS评分、置信度分布）
│   └── 整体风险评级（含安全评分卡）
├── 2. 高危漏洞详情 (CRITICAL/HIGH)
│   └── 每个漏洞按模板输出（含CVSS向量、攻击链）
├── 3. 中危漏洞详情 (MEDIUM)
│   └── 每个漏洞按简化模板输出
├── 4. 低危问题详情 (LOW/INFO)
│   └── 批量或简化输出
├── 5. 修复建议汇总
│   ├── P0 (立即修复)
│   ├── P1 (短期修复)
│   └── P2 (长期改进)
├── 6. 审计方法论
│   ├── 审计流程说明
│   ├── 改进点说明 (vs 传统审计)
│   └── 局限性说明
├── 7. 攻击路径分析（可选）
│   ├── 关键攻击链
│   └── 攻击路径图（DOT格式）
├── 8. 合规差距分析（可选）
│   ├── PCI-DSS 4.0
│   ├── GDPR
│   ├── 等保 2.0
│   └── SOC 2
└── 9. 附录
    ├── 受影文件清单
    ├── 参考规范
    └── 多维度度量指标
```

### 6.2 漏洞报告模板（扩展版）

#### 严重漏洞模板 (CRITICAL/HIGH)

```markdown
### [等级] 漏洞标题 (CWE-XXX)

**位置**: `文件路径:行号`

**漏洞类型**: 代码漏洞 / 配置问题 / 架构问题 / 安全债务

**代码片段**:
```java
// 问题代码 (精简展示，突出关键点)
```

**可达性分析**:
```
调用链:
HTTP POST /api/xxx  [@RequestBody DTO]
  ↓ Controller.method() [公开/需登录/需管理员]
  ↓ Service.method()
  ↓ Sink.method(${参数})  [注入点]

参数来源: @RequestBody / @RequestParam / @Value / 系统生成
访问控制: 公开接口 / 需登录 / 需管理员 / 内网访问
数据流向: 用户输入 → 直接传递 / 经过处理 / 来自配置
```

**风险分析**:
- 影响范围: 说明受影响的功能模块
- 攻击场景: 具体描述如何利用
- 利用条件: 列出所有前提条件
- 业务影响: 对业务的具体影响

**修复建议** **[ENHANCED]**:
```java
// 修复代码 (由 remediation-templates.js 根据漏洞类型和技术栈生成)

// Before: 原始漏洞代码
String sql = "SELECT * FROM users WHERE id = " + userId;

// After: 安全的修复代码
String sql = "SELECT * FROM users WHERE id = ?";
PreparedStatement stmt = connection.prepareStatement(sql);
stmt.setLong(1, userId);
ResultSet rs = stmt.executeQuery();
```

**修复说明**:
- 问题原因: ${} 直接拼接 SQL，用户输入可直接注入
- 修复原理: 使用 ? 占位符和 PreparedStatement 参数绑定
- 所需导入: java.sql.PreparedStatement
- 影响范围: 仅修改当前方法，无API变更
```
```

**CVSS v3.1评分** **[NEW]**:
```
向量: AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H
基础评分: 9.8 (CRITICAL)
```

**可利用性评估** **[NEW]**:
```
可利用性评分: 85/100 (HIGH)
- 可达性: 30/30 (HTTP入口，直接访问)
- 认证要求: 25/25 (无需认证)
- 网络位置: 20/20 (公网暴露)
- 参数可控性: 15/15 (用户输入直接可控)
- 前置条件: 5/10 (无特殊条件)

攻击场景:
1. [数据提取] UNION SELECT 提取用户数据 (Likelihood: HIGH)
2. [认证绕过] OR 1=1 绕过登录 (Likelihood: MEDIUM)

预计利用时间: < 1 hour
```

**误报检查** **[NEW]**:
```
- [x] 净化函数: 未发现
- [x] 安全来源: 用户输入 (@RequestBody) - 可控
- [x] 死代码检查: 有调用者 (OrderController.createOrder)
- [ ] 常量模式: 不适用

结论: 确认为漏洞 (False Positive: NO)
```

**PoC验证** **[NEW]**:
```bash
# SQL注入 PoC (curl)
curl -X POST "http://target/api/order" \
  -H "Content-Type: application/json" \
  -d '{"amount": "'\'' UNION SELECT username,password FROM users--"}'
```

**攻击链分析** **[NEW]**:
```
[Entry Point] HTTP POST /api/xxx
  ↓ SQL Injection (Confidence: HIGH)
[Impact] Database Access
  ↓ via: Weak input validation
[Objective] User data exfiltration
```

**风险评级说明**:
原始等级: X
调整后等级: Y
调整理由: (如: 利用需管理员权限/参数来自配置等)
```

#### 中危漏洞模板 (MEDIUM)

```markdown
### [MEDIUM] 漏洞标题 (CWE-XXX)

**位置**: `文件路径:行号`

**漏洞类型**: 代码漏洞 / 配置问题

**问题描述**: 简要描述问题

**可达性分析**:
- 调用链: Controller → Service → Sink
- 访问控制: 需管理员/需登录
- 利用条件: 需要XX权限

**修复建议**:
```java
// 修复代码或配置
```
```

#### 低危/信息级模板 (LOW/INFO)

```markdown
### [LOW] 问题标题

**位置**: `文件路径:行号`

**问题**: 一句话描述

**建议**: 一句话建议
```

### 6.3 报告输出检查清单

**生成报告前必须检查**:
- [ ] 每个漏洞都有完整的调用链分析
- [ ] 每个漏洞都说明了访问控制要求
- [ ] 每个漏洞都有明确的修复代码
- [ ] 风险等级调整都有明确理由
- [ ] 代码漏洞和配置问题已分类
- [ ] 死代码/不可达漏洞已剔除
- [ ] 每个漏洞已通过 Phase 3E 跨项目确认（6项确认清单全部通过）
- [ ] 不存在仅基于单文件/单函数就报告的漏洞
- [ ] 对共享库漏洞已验证至少一个引用方有完整攻击链

**[END]** Phase 6完成后，审计流程结束。执行最终自检清单，确保报告已写入，会话日志已更新。

---

### 6.4 Agent内置增强功能 **[NEW]**

**Phase 3 增强（误报过滤 + 可利用性评估）：**

```javascript
// 集成到 Phase 3 静态验证
const fpFilter = require('./engine/false-positive-filter');
const exploitChecker = require('./engine/exploitability-checker');

// 对每个漏洞执行
for (const vuln of vulnerabilities) {
  // 1. 误报过滤
  const fpResult = fpFilter.check(vuln);
  if (fpResult.isFalsePositive) {
    vuln.severity = fpResult.adjustedSeverity;
    vuln.falsePositiveReason = fpResult.reasons;
  }
  
  // 2. 可利用性评估
  vuln.exploitability = exploitChecker.calculate(vuln);
}
```

**Phase 6 增强（修复建议 + PoC生成）：**

```javascript
// 集成到 Phase 6 报告生成
const remediation = require('./engine/remediation-templates');
const pocGen = require('./engine/poc-generator');

// 对每个漏洞执行
for (const vuln of vulnerabilities) {
  // 1. 生成上下文感知修复建议
  vuln.remediation = remediation.generate(vuln, vuln.language);
  
  // 2. 为高危漏洞生成 PoC
  if (vuln.severity === 'CRITICAL' || vuln.severity === 'HIGH') {
    vuln.pocs = pocGen.generateAll(vuln);
  }
}
```

**功能对比：**

| 功能 | 原方案（外部工具） | Agent内置方案 | 优势 |
|------|------------------|--------------|------|
| **误报过滤** | LLM API调用 | 正则规则匹配 | 毫秒级，无API依赖 |
| **可利用性** | DAST实际测试 | 静态评分算法 | 无需运行时环境 |
| **修复建议** | LLM生成 | 模板匹配 | 确定性输出，可维护 |
| **PoC生成** | sqlmap/nuclei | 模板输出代码 | 安全，可审计 |

---

## Phase 2C 增强: Logic-Driven Audit 详细指南

### 业务逻辑审计检查清单

#### 1. 金融逻辑审计

**检查项**:
- [ ] 金额计算是否使用 BigDecimal (避免 float/double)
- [ ] 金额是否有上限/下限校验
- [ ] 汇率计算是否有精度控制
- [ ] 手续费计算是否精确
- [ ] 退款/冲正逻辑是否幂等
- [ ] 并发场景下余额是否准确

**常见漏洞模式**:
```java
// 问题: 使用浮点数计算金额
double amount = 0.1 + 0.2;  // 精度丢失

// 问题: 金额未校验
public void transfer(BigDecimal amount) {
    // 缺少 amount > 0 和 amount <= MAX 校验
}

// 问题: 汇率未校验合理性
BigDecimal rate = getRate();  // 可能为0或负数
BigDecimal result = amount.divide(rate);  // 除以0错误
```

#### 2. 并发安全审计

**检查项**:
- [ ] 分布式锁是否正确释放 (try-finally)
- [ ] 锁超时时间是否合理
- [ ] 重试机制是否有限制
- [ ] 数据库乐观锁是否使用
- [ ] 敏感操作是否幂等

**常见漏洞模式**:
```java
// 问题: 锁不在 finally 中释放
if (lock) {
    doBusiness();  // 异常时锁不释放
    redisTemplate.delete(key);
}

// 问题: 递归重试无限制
if (!lock) {
    Thread.sleep(50);
    punchUpAsset();  // 栈溢出风险
}
```

#### 3. 状态机审计

**检查项**:
- [ ] 状态转换是否合法
- [ ] 是否检查前置状态
- [ ] 终态是否可修改
- [ ] 并发修改状态是否安全

#### 4. IDOR (不安全的直接对象引用)

**检查项**:
- [ ] 查询是否限制用户权限范围
- [ ] 修改操作是否校验所有权
- [ ] 导出功能是否限制数据范围

**常见漏洞模式**:
```java
// 问题: 未限制查询范围
public Order getOrder(Long orderId) {
    return orderService.getById(orderId);  // 可查询任意订单
}

// 安全: 限制当前用户数据
public Order getOrder(Long orderId) {
    return orderService.getByIdAndUserId(orderId, getCurrentUserId());
}
```

---

## Self-Check Lists

每个阶段执行后必须执行自检清单。详见 `references/self-check.md`