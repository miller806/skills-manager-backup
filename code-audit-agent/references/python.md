---
name: python-rules
description: Python专项安全规则 — if:python 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "Python Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "requirements.txt/pyproject.toml detected"
    when: "if: python"
---

# Python Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)  
**Previous**: Phase 1 Reconnaissance  
**Next**: Phase 3 Static Verification  
**Trigger**: `if: python` 检测到requirements.txt或pyproject.toml时加载

Python专项安全规则。

## 技术栈指纹

指纹文件：`requirements.txt`、`Pipfile`、`pyproject.toml`

## 控制流审计补充

### Django 安全检测
```
Grep: from django, import Django
检查: settings.py 中的 DEBUG, SECRET_KEY, ALLOWED_HOSTS
检查: MIDDLEWARE 中的 SecurityMiddleware
检查: csrf_exempt 使用情况
```

### Flask 安全检测
```
Grep: from flask, import Flask
检查: app.run(debug=True) 生产环境检测
检查: SECRET_KEY 是否硬编码
检查: SESSION_COOKIE_SECURE 配置
```

### SQLAlchemy 安全检测
```
Grep: sqlalchemy, Session, query
检查: 是否使用参数化查询
检查: session.execute() 中的 SQL 是否为字符串拼接
```

### 认证相关检测
```
Grep: login_required, @auth, Flask-Login, django.contrib.auth
检查: SESSIONID 生成是否安全
检查: 密码存储是否使用 hashlib/pbkdf2/bcrypt
```

## Python 特有漏洞模式

### 代码注入检测
```
Grep: eval(), exec(), compile(), input()
检查: 参数是否来自用户输入
```

### 路径遍历检测
```
Grep: open(), os.path.join(), pathlib
检查: 用户输入是否进入路径构造
```

### YAML 反序列化检测
```
Grep: yaml.load(), yaml.unsafe_load()
检查: 是否使用 Loader=yaml.SafeLoader
```

### 模板注入检测
```
Grep: render_template_string(), Jinja2
检查: 模板字符串是否来自用户输入
```

## 已知高危依赖

| 依赖 | 高危版本 | 风险 |
|------|---------|------|
| Django < 3.2 | CVE-2021-44420 | RCE via django.util.http |
| Flask < 2.0 | CVE-2021-23393 | 模板注入 |
| SQLAlchemy < 1.4 | 潜在注入风险 | 参数化查询绕过 |
| PyYAML < 5.4 | CVE-2020-14343 | YAML反序列化RCE |

## Python 净化函数库

| 净化函数 | 能防御 | 不能防御 |
|---------|--------|---------|
| bleach.clean() | HTML XSS | JS事件处理器XSS |
| markupsafe.escape() | Jinja2 XSS | 双重编码XSS |
| html.escape() | HTML XSS | — |
| flask.escape() | XSS | — |
| sqlalchemy.text() | SQL注入 | — |