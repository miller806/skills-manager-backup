---
name: go-rules
description: Go专项安全规则 — if:golang 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "Go Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "go.mod detected"
    when: "if: golang"
---

# Go Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)  
**Previous**: Phase 1 Reconnaissance  
**Next**: Phase 3 Static Verification  
**Trigger**: `if: golang` 检测到go.mod时加载

Go专项安全规则。

## 技术栈指纹

指纹文件：`go.mod`

## 控制流审计补充

### Gin 框架检测
```
Grep: github.com/gin-gonic/gin
检查: r.Use(middleware())
检查: gin.Default() vs gin.New()
```

### Echo 框架检测
```
Grep: github.com/labstack/echo
检查: e.Use(middleware)
检查: TLS 配置
```

### 数据库安全检测
```
Grep: database/sql, go-sql-driver
检查: 是否使用参数化查询 (?, $1)
检查: password 是否在 DSN 中硬编码
```

### JWT 检测
```
Grep: github.com/golang-jwt, golang-jwt
检查: jwt.Parse() 是否有签名验证
检查: 密钥来源
```

## Go 特有漏洞模式

### 命令注入检测
```
Grep: os/exec, exec.Command, syscall.Exec
检查: 命令参数是否来自用户输入
检查: shell=True 使用情况
```

### 模板注入检测
```
Grep: html/template, text/template
检查: user input 是否进入模板渲染
```

### 路径遍历检测
```
Grep: os.Open, os.Create, ioutil.ReadFile
检查: 用户输入是否进入路径构造
```

### SQL注入检测
```
Grep: db.Query(), db.Exec(), row.Next()
检查: 是否使用参数化查询
检查: query string 是否拼接用户输入
```

## Go 净化函数

| 净化函数 | 能防御 | 不能防御 |
|---------|--------|---------|
| database/sql 参数化 | SQL注入 | — |
| html/template | XSS | — |
| strconv.Quote() | 字符串转义 | 特定攻击 |

## 已知高危版本

| 框架 | 高危版本 | 风险 |
|------|---------|------|
| Go < 1.18 | 多个 RCE | stdlib 漏洞 |
| Gin < 1.7.7 | CVE-2021-3129 | 模板注入RCE |