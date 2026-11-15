---
name: nodejs-rules
description: Node.js后端专项安全规则 — if:nodejs 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "Node.js Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "package.json detected"
    when: "if: nodejs"
---

# Node.js Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)  
**Previous**: Phase 1 Reconnaissance  
**Next**: Phase 3 Static Verification  
**Trigger**: `if: nodejs` 检测到package.json时加载

Node.js后端专项安全规则。

## 技术栈指纹

指纹文件：`package.json`

## 控制流审计补充

### Express 框架检测
```
Grep: express, Express
检查: helmet 中间件配置
检查: CORS 配置
检查: cookie-session 配置
```

### JWT 检测
```
Grep: jsonwebtoken, jwt
检查: jwt.verify() 是否有签名验证
检查: 算法 HS256 vs RS256
```

### 数据库安全检测
```
Grep: mysql, mongodb, pg, sequelize, mongoose
检查: 是否使用参数化查询
检查: SQL 拼接情况
```

### 认证检测
```
Grep: passport, auth, bcrypt, jsonwebtoken
检查: 密码哈希算法 (bcrypt vs md5)
检查: session 配置
```

## Node.js 特有漏洞模式

### 命令注入检测
```
Grep: child_process.exec, child_process.execSync, eval
检查: 参数是否来自用户输入
检查: shell 选项使用
```

### 原型污染检测
```
Grep: merge, clone, JSON.parse
检查: __proto__, constructor, prototype
```

### 路径遍历检测
```
Grep: fs.readFile, fs.readFileSync, path.join
检查: 用户输入是否进入路径构造
```

###模板注入检测
```
Grep: ejs, pug, handlebars, template
检查: 用户输入是否进入模板渲染
```

## Node.js 净化函数

| 净化函数 | 能防御 | 不能防御 |
|---------|--------|---------|
| mysql2.escape() | SQL注入 | — |
| mongoose.Query | SQL注入 | — |
| validator.escape() | XSS | — |
| helmet | 多种头部安全 | — |

## 已知高危依赖

| 依赖 | 高危版本 | 风险 |
|------|---------|------|
| express < 4.17 | 多个 RCE | 路径遍历/注入 |
| jsonwebtoken < 9.0 | CVE-2022-23529 | RCE |
| lodash < 4.17.21 | CVE-2021-23337 | 原型污染 |
| serialize-javascript < 3.1 | XSS | 反序列化 |