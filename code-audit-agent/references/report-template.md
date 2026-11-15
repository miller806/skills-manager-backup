---
name: report-template
description: 审计报告输出模板 — Phase 6 生成报告时加载
config:
  progression:
    phase: "6"
    name: "Report Template"
    prev: "Phase 5 Dynamic Risk Rating"
    next: "END"
    when: "Phase 6 Structured Output"
---

# 审计报告模板 v2.0 (改进版)

**Phase**: 6 (Final)  
**Previous**: Phase 5 Dynamic Risk Rating  
**Output**: `audit_report.md` in project root

上下文感知型审计报告模板。强调可达性分析、风险等级动态调整和修复代码示例。

---

## 报告输出规范

### 核心原则：按端分组输出

审计结束后，**必须按端分别输出报告**。每个端一份独立报告，仅包含该端的漏洞发现。

```
输入（审计发现）：
  CRITICAL: java端漏洞1, web端漏洞2, java端漏洞3
  HIGH: java端漏洞4, web端漏洞5, web端漏洞6
  MEDIUM: android端漏洞1, java端漏洞7

输出（分别生成）：
  项目名_V1.0.0_java_audit_report.md   → 仅含 java 端漏洞（3个）
  项目名_V1.0.0_web_audit_report.md    → 仅含 web 端漏洞（3个）
  项目名_V1.0.0_android_audit_report.md → 仅含 android 端漏洞（1个）
```

### 端的分类与映射

| 端标识 | 技术栈 | 报告后缀 |
|--------|--------|---------|
| java | Spring Boot / MyBatis / JDBC / Struts 等 | `_java_audit_report.md` |
| python | Django / Flask / FastAPI 等 | `_python_audit_report.md` |
| nodejs | Express / NestJS / Koa 等 | `_nodejs_audit_report.md` |
| golang | Gin / Echo / Beego 等 | `_golang_audit_report.md` |
| php | Laravel / ThinkPHP / Symfony 等 | `_php_audit_report.md` |
| csharp | ASP.NET Core / EF Core 等 | `_csharp_audit_report.md` |
| rust | Actix / Rocket / Warp 等 | `_rust_audit_report.md` |
| kotlin | Android / Spring Boot Kotlin 等 | `_kotlin_audit_report.md` |
| web | Vue / React / Angular / 小程序 / jQuery / uni-app | `_web_audit_report.md` |
| android | 原生 Android 客户端 | `_android_audit_report.md` |
| ios | iOS 客户端 | `_ios_audit_report.md` |
| api | REST API / GraphQL / gRPC（协议层独立漏洞） | `_api_audit_report.md` |
| config | 配置文件问题（通用，不属于单一端） | `_config_audit_report.md` |

### 报告拆分规则

1. **每个端一份报告**：如果某端有至少 1 个发现，就生成该端的独立报告
2. **报告内按等级分组**：每个端报告内，按 CRITICAL → HIGH → MEDIUM → LOW → INFO 顺序输出
3. **某端无漏洞不生成报告**：如果某端审计后无发现（0 个），不生成该端报告
4. **不生成汇总报告**：仅输出各端独立报告，不输出 combined 汇总报告
5. **跨端漏洞处理**：涉及多端的组合漏洞，在每个相关端报告中都完整描述

### 报告命名格式

```
{项目名}_V{版本号}_{端}_audit_report.md
```

- `{项目名}`: 项目目录名称（下划线替代空格）
- `{版本号}`: V1.0.0
- `{端}`: 上表中对应标识

**示例：**
```
myapp_V1.0.0_java_audit_report.md
myapp_V1.0.0_web_audit_report.md
myapp_V1.0.0_android_audit_report.md
```

---

### 按端分组输出结构

审计完成后，每个端报告内部结构如下：

```
{项目名}_V1.0.0_{端}_audit_report.md
├── 1. 执行摘要
│   ├── 审计概况（仅该端的技术栈信息）
│   ├── 关键风险统计（仅该端的漏洞数）
│   └── 整体风险评级（仅该端）
├── 2. 高危漏洞详情 (CRITICAL/HIGH)
│   └── 仅该端的 CRITICAL 和 HIGH 漏洞
├── 3. 中危漏洞详情 (MEDIUM)
│   └── 仅该端的 MEDIUM 漏洞
├── 4. 低危问题详情 (LOW/INFO)
│   └── 仅该端的 LOW 和 INFO 问题
├── 5. 修复建议汇总
│   ├── P0 (立即修复)
│   ├── P1 (优先修复)
│   └── P2 (长期改进)
└── 6. 附录
    └── 该端受影响文件清单
```

> 注：不生成 combined 汇总报告。所有发现分散在各端独立报告中，跨端漏洞在每个相关端报告中完整描述。

---

### 漏洞去重规则 **[NEW]**

#### 去重判定条件

两个漏洞满足以下条件时判定为同一漏洞（去重）：

| 去重维度 | 判定规则 |
|---------|---------|
| **文件路径** | 相同文件路径 |
| **行号** | 行号相同 或 ±5行范围内 |
| **漏洞类型** | 相同 CWE 编号 或相同漏洞模式 |
| **Sink 点** | 相同 Sink 方法调用 |
| **根因** | 相同根本原因（如都是 SQL 拼接，都是 XSS） |

#### 去重优先级

当多个端发现同一漏洞时：

| 优先级 | 来源 | 处理方式 |
|-------|------|---------|
| 1 | 后端端（java/python/nodejs等） | 以后端端报告为准 |
| 2 | 前端端（web） | 以前端端报告为准 |
| 3 | API 端 | API 端报告独立存在 |
| 4 | 配置文件端（config） | 在各端报告中标注 |

#### 跨端漏洞特殊处理

**情况A: 同一攻击链涉及多端**
```
示例: 前端 XSS → 窃取后端 Token → 调用后端 API

处理方式:
1. 在 web_audit_report 中报告 XSS 漏洞（完整描述）
2. 在 java_audit_report 中报告 Token 泄露漏洞（完整描述）
3. 跨端漏洞在每个端报告中完整描述，无需合并
```

**情况B: 共享库漏洞影响多端**
```
示例: 公共模块中的加密算法缺陷被 java 和 nodejs 端引用

处理方式:
1. 在 java_audit_report 中标注"受公共库影响"
2. 在 nodejs_audit_report 中标注"受公共库影响"
3. 修复建议指向公共库，不在各端重复
```

---

## 报告结构

---

## 模板 1: CRITICAL/HIGH 漏洞报告 (完整版)

### [🔴 CRITICAL / 🟠 HIGH] 漏洞标题 (CWE-XXX)

| 字段 | 内容 |
|------|------|
| **最终等级** | 🔴 Critical / 🟠 High |
| **漏洞类型** | 代码漏洞 / 配置问题 / 架构问题 / 安全债务 |
| **CWE编号** | CWE-XXX (如: CWE-89 SQL注入) |
| **文件路径** | `相对于项目根目录的路径` |
| **行号** | 第 N 行 |
| **置信度** | HIGH / MEDIUM / LOW |
| **所属端** | java / web / android / ios / nodejs / python / golang / php / csharp / rust / kotlin / api / config |
| **跨端关联** | 是否涉及多个端的数据流（如 web 端 XSS 窃取 java 端 Token） |

**代码片段**:
```java
// 来自 Read 工具的实际代码片段（±5行上下文）
// 在漏洞行添加注释：// ← 漏洞点
String sql = "SELECT * FROM users WHERE id = " + userId;  // ← SQL注入点
```

**可达性分析** (关键改进):
```
完整调用链:
============
HTTP POST /api/punchUp
  ↓ @RequestBody PunchUpRes punchUpRes [用户输入]
ByberAccoutController.punchUp(punchUpRes)
  ↓ punchUpRes.getAmount() → asset
ByberServiceImpl.punchUpAsset(punchUpRes, asset)
  ↓ asset → updateAccountRes.setAsset(asset)
ByberAccountServiceImpl.updateAccount(updateAccountRes)
  ↓ updateAccountRes.getAsset() → ${asset}
ByberAccountMapper.updateAccount(${asset})  // ← SQL注入点

参数来源: @RequestBody (用户可控) ✅
访问控制: 需登录用户 (JWT认证)
数据流向: 用户输入 → 直接传递 → Sink点 (高风险)
网络位置: 公网暴露
```

**风险分析**:
- **影响范围**: 资金账户余额修改功能
- **攻击场景**:
  1. 登录系统获取JWT Token
  2. 构造恶意请求，在amount字段注入SQL
  3. 执行任意SQL，可修改任意账户余额
- **利用条件**:
  - [x] 需要登录 (普通用户权限即可)
  - [ ] 不需要管理员权限
  - [ ] 不需要内网访问
- **业务影响**: 可导致资金损失、数据篡改

**跨端影响分析**:
```
端A (web) → 数据流 → 端B (java) → 影响
=========================================
web 端 XSS → 窃取 java 端 Token → 调用 java 端 API → CRITICAL
```

**风险评级说明** (上下文感知调整):
```
原始等级: CRITICAL
调整后等级: CRITICAL (保持)

评分计算:
基础风险分: 10 (SQL注入)
可达性系数: 1.0 (公开接口，需登录)
访问控制系数: 0.8 (需登录，但普通用户可利用)
数据敏感度系数: 1.2 (涉及资金)
业务影响系数: 1.2 (可导致资金损失)
最终得分: 10 × 1.0 × 0.8 × 1.2 × 1.2 = 11.52 → CRITICAL
```

**修复建议** (个性化，基于项目技术栈):

**方案 1: 参数化查询 (推荐)**
```java
// Before
<update id="updateAccount">
    UPDATE byber_account 
    SET asset = asset + ${asset}
    WHERE coin_type = #{coinType}
</update>

// After
<update id="updateAccount">
    UPDATE byber_account 
    SET asset = asset + #{asset}  // 使用 #{} 代替 ${}
    WHERE coin_type = #{coinType}
</update>
```

**方案 2: 输入校验 (防御性)**
```java
public void punchUp(PunchUpRes punchUpRes) {
    // 校验金额格式
    if (!isValidAmount(punchUpRes.getAmount())) {
        throw new CustomBusinessException(BusinessErrorCode.INVALID_AMOUNT);
    }
    // ... 业务逻辑
}

private boolean isValidAmount(BigDecimal amount) {
    return amount != null 
        && amount.compareTo(BigDecimal.ZERO) > 0
        && amount.compareTo(MAX_LIMIT) <= 0
        && amount.scale() <= 2;  // 最多2位小数
}
```

**修复原理**: 
- `#{}` 使用预编译语句，自动转义特殊字符
- 输入校验确保金额格式合法，拒绝恶意输入

**验证方式**:
- 尝试注入 `1 OR 1=1`，应被拒绝或无害化
- 检查生成的SQL日志，确认参数已正确转义

**修复优先级**: P0 (立即修复)  
**修复时限**: 24小时内  
**负责人**: 后端开发团队

---

## 模板 2: MEDIUM 漏洞报告 (简化版)

### [🟡 MEDIUM] 漏洞标题 (CWE-XXX)

| 字段 | 内容 |
|------|------|
| **漏洞类型** | 代码漏洞 / 配置问题 |
| **CWE编号** | CWE-XXX |
| **文件路径** | `path/to/File.java:line` |

**问题描述**: 一句话描述问题本质

**可达性分析**:
- 调用链: Controller → Service → Sink
- 访问控制: 需管理员权限
- 利用条件: 需要XX权限才能触发

**代码片段**:
```java
// 问题代码
```

**修复建议**:
```java
// 修复代码
```

**修复优先级**: P1 (优先修复)  
**修复时限**: 1周内

---

## 模板 3: LOW/INFO 问题报告 (极简版)

### [🔵 LOW / ⚪ INFO] 问题标题

**位置**: `File.java:line`

**问题**: 一句话描述

**建议**: 一句话建议

**修复优先级**: P2 (长期改进)

---

## 报告头部模板

```markdown
# 代码安全审计报告

| 项目 | 内容 |
|------|------|
| **审计目标** | <项目路径> |
| **版本号** | V1.0.0 (审计版本) |
| **报告类型** | {端}_audit_report (如: java_audit_report) |
| **技术栈** | Java, Spring Boot, MyBatis-Plus, Maven |
| **部署环境** | 生产/非生产/未知 |
| **数据敏感度** | 高敏感 (金融支付场景) |
| **审计方法** | 按端分组审计 + 跨端联合审计 (End-Level + Cross-End Joint Audit) |
| **审计模式** | Deep Mode (五轨并行: Sink + Control + Logic + Frontend + Dynamic + Joint) |
| **审计时间** | YYYY-MM-DD |
| **审计文件数** | XX 个源文件 (后端: XX, 前端: XX, 客户端: XX) |

### 项目组件清单 **[NEW]**

| 组件名称 | 类型 | 技术栈 | 源代码目录 | 发现数 | 风险等级 |
|---------|------|--------|-----------|-------|---------|
| backend-api | 后端 | Java/Spring | server/ | 12 | 🔴 CRITICAL |
| frontend-web | 前端 | Vue.js | client/web/ | 5 | 🟠 HIGH |
| mobile-app | 客户端 | React Native | client/mobile/ | 3 | 🟡 MEDIUM |

### 风险统计

| 风险等级 | 数量 | 代码漏洞 | 配置问题 | 架构问题 |
|---------|------|---------|---------|---------|
| 🔴 **CRITICAL** | X | X | X | - |
| 🟠 **HIGH** | X | X | X | - |
| 🟡 **MEDIUM** | X | X | X | - |
| 🔵 **LOW** | X | X | - | - |
| ⚪ **INFO** | X | - | - | X |

**整体风险评级**: 🔴 CRITICAL / 🟠 HIGH / 🟡 MEDIUM

> 本次审计采用改进的**上下文感知型审计方法**，重点验证漏洞的可达性和实际利用条件，避免死代码误报和过度评级。

### 关键发现摘要

#### 立即修复 (CRITICAL - 24小时内)
- [ ] **SQL注入** (`ByberAccountMapper.xml:16`): 影响资金账户操作，可导致任意余额修改
- [ ] **越权访问** (`OrderController.java:45`): 可查看任意用户订单

#### 优先修复 (HIGH - 1周内)
- [ ] **硬编码API密钥** (`application.yml:14`): CoinMarketCap API密钥泄露
- [ ] **不安全加密算法** (`AESUtil.java:88`): 使用ECB模式

#### 建议修复 (MEDIUM - 1月内)
- [ ] **并发安全问题** (`ByberAccoutController.java:189`): Redis锁释放不当
- [ ] **默认凭证** (16个模块): Nacos默认密码

### 审计方法说明

**改进的六阶段审计流程**:

1. **Phase 0: 初始化** - 技术栈识别，规则加载
2. **Phase 1: 侦察** - 项目画像，模块分级
3. **Phase 2: 并行审计** - 五轨同时进行
   - 2A: Sink-Driven (注入类漏洞)
   - 2B: Control-Driven (配置/认证)
   - 2C: Logic-Driven (业务逻辑/越权)
   - 2E: Frontend Security (前端安全)
   - 2D: Dynamic Verification (动态验证)
4. **Phase 3: 静态验证** ⭐ **关键改进**
   - 可达性验证 (避免死代码误报)
   - 调用链分析 (Controller → Sink)
   - 参数来源追踪 (用户输入/配置/系统生成)
   - 访问控制评估 (公开/登录/管理员)
5. **Phase 4: 灰区量化** - 风险评分计算
6. **Phase 5: 动态定级** - 上下文感知调整
7. **Phase 6: 结构化输出** - 生成标准化报告

**vs 传统审计的改进**:
- ✅ **可达性验证**: 验证方法是否被调用，避免死代码误报
- ✅ **调用链分析**: 完整追踪从Controller到Sink的路径
- ✅ **参数来源追踪**: 区分用户输入/配置值/系统生成
- ✅ **风险动态调整**: 根据访问控制、网络位置等调整等级
- ✅ **分类标准**: 区分代码漏洞、配置问题、架构问题
- ✅ **修复代码**: 提供基于项目技术栈的具体修复方案

**局限性说明**:
- 静态分析无法覆盖所有运行时场景
- Logic-Driven 发现的业务逻辑漏洞建议人工复核
- 部分漏洞可能需要特定的业务条件才能触发
- 联合审计依赖组件间依赖关系识别的准确性
- 跨端攻击链验证需要完整的数据流映射

**按端分组输出说明**:
- 每个端生成独立报告，仅包含该端的漏洞发现
- 跨端联合审计确保整体风险评估准确
- 跨端风险组合可能产生"1+1>2"的放大效应

## 免责声明

本报告由自动化代码审计 Agent 生成，所有漏洞发现均基于静态代码分析和业务逻辑推理。
部分漏洞可能需要特定的运行时条件才能被利用。
修复建议已基于项目实际技术栈定制，但仍建议开发者根据具体业务场景调整。

---
```

---

## 修复建议汇总模板

```markdown
## 修复建议汇总

### P0 - 立即修复 (24小时内)

| 序号 | 漏洞 | 文件 | 等级 | 修复复杂度 | 负责人 |
|-----|------|------|------|-----------|--------|
| 1 | SQL注入 | ByberAccountMapper.xml | 🔴 Critical | 低 | 后端团队 |
| 2 | 水平越权 | OrderController.java | 🔴 Critical | 中 | 后端团队 |

**修复代码示例**:

#### 1. SQL注入修复
```java
// Before: ${} 直接拼接
SET asset = asset + ${asset}

// After: #{} 参数化查询
SET asset = asset + #{asset}
```

### P1 - 优先修复 (1周内)

| 序号 | 漏洞 | 文件 | 等级 | 修复复杂度 | 负责人 |
|-----|------|------|------|-----------|--------|
| 3 | 硬编码密钥 | application.yml | 🟠 High | 低 | DevOps |
| 4 | 不安全加密 | AESUtil.java | 🟠 High | 中 | 后端团队 |

### P2 - 长期改进 (1月内)

| 序号 | 问题 | 文件 | 等级 | 建议措施 | 负责人 |
|-----|------|------|------|---------|--------|
| 5 | 并发安全 | ByberAccoutController.java | 🟡 Medium | 使用try-finally释放锁 | 后端团队 |
| 6 | 默认凭证 | 16个模块 | 🟡 Medium | 修改Nacos密码 | 运维团队 |

### 修复优先级矩阵

| 漏洞等级 | 影响范围 | 修复复杂度 | 优先级 | 时限 |
|---------|---------|-----------|--------|------|
| 🔴 Critical | 核心功能 | 低 | P0 | 24小时 |
| 🔴 Critical | 核心功能 | 高 | P0 | 48小时 |
| 🟠 High | 敏感数据 | 低 | P1 | 1周 |
| 🟠 High | 敏感数据 | 高 | P1 | 2周 |
| 🟡 Medium | 一般功能 | 低 | P2 | 1月 |
| 🟡 Medium | 一般功能 | 高 | P2 | 下版本 |
```

---

## 附录模板

```markdown
## 附录

### A. 受影响文件清单

#### 🔴 CRITICAL / 🟠 HIGH
```
source/java/pacstrust-merchant/byber-dao/src/main/resources/sqlmap/ByberAccountMapper.xml
source/java/pacstrust-merchant/byber-remit/src/main/java/.../OrderController.java
source/java/pacstrust-exchange-rate/src/main/resources/application.yml
source/java/pacstrust-cards/.../util/AESUtil.java
```

#### 🟡 MEDIUM
```
source/java/pacstrust-merchant/byber-account/src/main/java/.../ByberAccoutController.java
source/java/pacstrust-merchant/.../bootstrap.yml (16个模块)
```

### B. 参考规范

- OWASP Top 10 2021
- CWE/SANS Top 25 Most Dangerous Software Errors
- PCI DSS 4.0 (支付卡行业数据安全标准)
- 等保 2.0 (网络安全等级保护)
- Java 安全编码规范
- Spring Security 最佳实践

### C. 审计工具与方法

- **审计引擎**: code-audit-agent v2.0
- **审计方法**: 上下文感知型安全审计 (Context-Aware Security Audit)
- **核心改进**: Phase 3 可达性验证 + Phase 5 动态风险定级

### D. 灰色地带条目 (如需)

#### 中风险灰色 (需人工确认)
| 文件位置 | 场景类型 | 说明 |
|---------|---------|------|
| `XXX.java:123` | 条件编译 | 特定条件下可能触发 |

#### 低风险灰色 (批量附录)
| 文件位置 | 场景类型 |
|---------|---------|
| `XXX.java:456` | 备份文件 |
```

---

## 质量检查清单

生成报告前必须检查：

### 内容完整性
- [ ] 每个 CRITICAL/HIGH 漏洞都有完整调用链分析
- [ ] 每个漏洞都说明了参数来源 (@RequestBody/@Value/系统生成)
- [ ] 每个漏洞都说明了访问控制要求 (公开/登录/管理员)
- [ ] 每个漏洞都有明确的修复代码示例
- [ ] 每个漏洞都有修复优先级和时限
- [ ] 风险等级调整都有明确理由和评分计算

### 分类准确性
- [ ] 代码漏洞和配置问题已正确分类
- [ ] 死代码/不可达漏洞已剔除或标记
- [ ] 安全债务正确标记为 INFO

### 格式规范性
- [ ] 报告结构符合模板规范
- [ ] 代码片段使用正确的语法高亮
- [ ] 表格格式正确，无错位
- [ ] 风险等级使用统一颜色标识

### 质量目标
- [ ] CRITICAL/HIGH 漏洞无遗漏
- [ ] 无死代码误报
- [ ] 修复建议可执行
- [ ] 风险评级合理准确

### 安全范围边界 **[NEW]**
- [ ] 报告中不存在非安全类条目：N+1 查询、空指针异常、低效算法、未使用 import、代码风格、架构设计、内存泄漏（不可利用）、竞态条件（非安全相关）、代码重复、硬编码常量
- [ ] 每个报告的条目均可回答"攻击者如何利用此条目破坏机密性/完整性/可用性"，无法回答的条目已从报告中剔除
- [ ] 性能问题（慢查询、高 CPU、内存占用）仅在其可被利用为 DoS 攻击向量时才报告
- [ ] 功能性 bug（逻辑错误、边界条件未处理）仅在其可被利用为安全绕过时才报告

### 强制 Read 验证 **[NEW]**
- [ ] 每个报告的漏洞代码片段均来自 Read 工具读取的实际代码
- [ ] 每个漏洞都已读取 Sink 点代码（±30行）、入口点代码（±30行）、至少一个中间节点代码（±30行）
- [ ] 不存在仅凭 Grep 匹配到函数名就报告的漏洞
- [ ] 代码片段中的行号可追溯到 Read 工具的实际输出

### 修复建议技术栈匹配 **[NEW]**
- [ ] 每个漏洞的修复建议代码已与项目实际技术栈验证匹配：
  - 项目使用 Hibernate → 修复建议使用 Hibernate API，不使用 MyBatis
  - 项目使用 MyBatis → 修复建议使用 `#{}` 参数化，不使用 JDBC PreparedStatement
  - 项目使用 Kotlin → 修复建议使用 Kotlin 语法，不使用 Java
  - 项目使用 Spring Security 5.7+ → 修复建议使用 `SecurityFilterChain`，不使用 `WebSecurityConfigurerAdapter`
  - 项目使用 JWT v0.12+ → 修复建议使用新 API（`Jwts.builder().signWith(key)`），不使用旧 API（`signWith(key, alg)`）
- [ ] 修复建议中的 import 语句与项目实际依赖版本兼容
- [ ] 修复建议中的配置文件格式与项目实际使用的配置格式一致（YAML vs Properties vs XML）
- [ ] 如果修复模板无法匹配项目技术栈，输出"通用修复建议"（不含具体代码），而非错误的代码示例

### 端报告质量检查
- [ ] 每个有发现的端都有独立报告，仅含该端漏洞
- [ ] 无发现的端未生成报告
- [ ] 同一漏洞未在不同端报告中重复输出
- [ ] 跨端漏洞有交叉引用标注
- [ ] 报告命名符合 `{项目}_V{版本}_{端}_audit_report.md` 格式
