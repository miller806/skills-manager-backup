# Capabilities

## Overview

代码安全审计智能体，采用**五轨并行审计模型**（5-Track Parallel Audit），覆盖55+漏洞类型、5后端语言（Java/Python/Node.js/Go）、7前端框架（Vue/React/Angular/小程序/jQuery）。

**审计引擎架构**:
- **Sink-Driven Track**: 基于危险Sink函数的污染追踪（SQL注入、命令注入、XSS等）
- **Control-Driven Track**: 安全配置与权限控制缺陷检测
- **Logic-Driven Track**: 业务逻辑漏洞（IDOR、竞态条件、状态机绕过）
- **Frontend Security Track**: 前端安全专项（DOM-XSS、原型污染、本地存储泄露）
- **Dynamic Verification Track**: 灰区条目动态验证（Hybrid模式）

**执行模式**:
- **Static Mode**: 纯静态分析，适用于CI/无网络环境
- **Hybrid Mode**: 静态+动态验证，适用于完整安全评估

---

## Built-in Capabilities

### Core Audit Capability

| Code | Name | Description |
|------|------|-------------|
| audit-deep | Deep Code Audit | 执行完整的6阶段深度安全审计（Phase 0-6），输出结构化报告至 audit_report.md |

### Audit Sub-Tracks

| Code | Name | Description | Trigger Condition |
|------|------|-------------|-------------------|
| audit-sink | Sink-Driven Audit | 基于危险Sink库执行污染追踪，发现SQL注入、命令注入、XSS、反序列化等注入类漏洞 | Always |
| audit-control | Control-Driven Audit | 检测安全配置缺陷：硬编码密钥、调试模式、CORS配置、认证缺失、TLS配置 | Always |
| audit-logic | Logic-Driven Audit | 检测业务逻辑漏洞：水平/垂直越权（IDOR）、竞态条件、状态机绕过、金额精度问题 | Always |
| audit-frontend | Frontend Security Audit | 前端专项安全检测：DOM-XSS、eval/Function注入、原型污染、本地存储泄露、小程序安全 | `if: frontend` |
| audit-dynamic | Dynamic Verification | 对灰区条目执行动态验证：备份文件探测、CORS预检、条件编译验证、未授权访问测试 | `if: hybrid` |

### Output Capabilities

| Code | Name | Description |
|------|------|-------------|
| report-generate | Generate Audit Report | 将审计发现输出为结构化Markdown报告，包含漏洞详情、CWE映射、修复建议、灰色地带附录 |
| report-structured | Structured Output | 生成JSON/SARIF格式机器可读输出，支持CI流水线集成 |

---

## Language & Framework Coverage

### Backend Languages

| Language | Fingerprint | Coverage |
|----------|-------------|----------|
| Java | `pom.xml`, `build.gradle` | Spring Security, MyBatis, Hibernate, JDBC, JPA, Struts2 |
| Python | `requirements.txt`, `pyproject.toml` | Django, Flask, SQLAlchemy, FastAPI |
| Node.js | `package.json` | Express, NestJS, JWT, Mongoose, Sequelize |
| Go | `go.mod` | Gin, Echo, 标准库 database/sql |

### Frontend Frameworks

| Framework | Fingerprint |
|-----------|-------------|
| Vue.js | `vue.config.js`, `*.vue` |
| React/Next.js | `next.config.js`, `*.tsx` |
| Angular | `angular.json`, `src/app/` |
| Mini Programs | `app.json`, `*.wxml`, `*.ttml` |
| jQuery | `index.html` + jQuery patterns |

### Vulnerability Taxonomy (55+ Types)

**注入类**: SQL注入、命令注入、XSS（存储/反射/DOM）、代码注入、模板注入、SpEL注入
**认证与授权**: 认证绕过、垂直越权、水平越权（IDOR）、会话管理缺陷
**敏感数据**: 硬编码密钥、敏感信息泄露、不安全日志、配置泄露
**逻辑漏洞**: 竞态条件、状态机绕过、金额精度、业务逻辑绕过
**配置缺陷**: CORS配置、调试模式、TLS配置、不安全的HTTP方法
**前端漏洞**: DOM-XSS、原型污染、eval注入、URL跳转、本地存储泄露
**其他**: SSRF、XXE、路径遍历、反序列化、不安全文件上传

---

## Audit Workflow

```
Phase 0: Initialization      → 加载规则，检测技术栈，设置执行模式
Phase 1: Reconnaissance      → 文件枚举，指纹识别，业务上下文收集
Phase 2: Parallel Audit      → 五轨并行审计（2A/2B/2C/2E/2D）
  ├── 2A: Sink-Driven Audit
  ├── 2B: Control-Driven Audit
  ├── 2C: Logic-Driven Audit
  ├── 2E: Frontend Security Audit (if: frontend)
  └── 2D: Dynamic Verification (if: hybrid)
Phase 3: Static Verification → 五重防误报过滤
Phase 4: Grey Zone Quantification → 风险量化评分与分流
Phase 5: Dynamic Risk Rating → 业务上下文感知的最终定级
Phase 6: Structured Output   → 生成 audit_report.md
```

---

## Tools

Prefer crafting your own tools over depending on external ones. A script you wrote and saved is more reliable than an external API. Use the file system creatively.

### User-Provided Tools

| Type | Tool | Purpose |
|------|------|---------|
| MCP Server | Claude Code | File system access, web fetch, glob/search for codebase analysis |
| API | SonarQube | (If available) Static analysis results import for baseline comparison |

### Recommended Scripts

| Script | Purpose | Token Savings |
|--------|---------|---------------|
| sink-pattern-extractor.py | 预提取sink-libraries.md为JSON，预运行grep模式 | ~800 tokens/audit |
| grey-zone-calculator.py | 实现风险评分公式，消除LLM算术误差 | ~400 tokens/audit |
| audit-flow-preprocessor.py | 解析技术栈指纹，输出需加载的引用文件列表 | ~300 tokens/audit |

---

## Usage Examples

**Trigger Auto-Detection**:
```
User: "/audit" 或 "审计这个项目"
Agent: 自动检测技术栈 → 执行完整6阶段审计 → 输出 audit_report.md
```

**Scoped Audit**:
```
User: "只审计src/controllers目录的SQL注入"
Agent: 限制范围至指定路径 → 仅执行audit-sink轨道 → 聚焦SQL注入模式
```

**CI Integration**:
```
bash: code-audit-agent --headless --format=sarif --output=results.sarif
Exit codes: 0=clean, 1=findings found, 2=error
```

---

## Memory Integration

This agent uses a two-tier memory system:
- **Session Logs**: 每次审计的原始记录（`sessions/YYYY-MM-DD.md`）
- **Curated Memory**: 项目安全画像、历史漏洞模式、用户偏好（`MEMORY.md`，保持<200行）

在会话关闭时，加载 `references/memory-guidance.md` 执行记忆整理纪律。
