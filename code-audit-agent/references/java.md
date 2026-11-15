---
name: java-rules
description: Java专项安全规则 — if:java 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "Java Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "pom.xml/build.gradle detected"
    when: "if: java"
---

# Java Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)  
**Previous**: Phase 1 Reconnaissance  
**Next**: Phase 3 Static Verification  
**Trigger**: `if: java` 检测到pom.xml或build.gradle时加载

Java专项安全规则。增强对Java生态中常见漏洞模式的检测能力。

## 技术栈指纹

指纹文件：`pom.xml` 或 `build.gradle`

## 控制流审计补充

### Spring Security 配置检测

**目标：** 发现认证和授权配置缺陷

检测模式（Grep）：
```
@EnableWebSecurity
WebSecurityConfigurerAdapter
SecurityFilterChain
csrf\(\)\.disable\(\)
permitAll\(
antMatchers\(
requestMatchers\(
```

**分析规则：**
- 若 `csrf().disable()` 出现在非测试环境配置中 → High
- 若 `permitAll()` 包含敏感路径（/admin/, /api/user/delete）→ High
- 若未配置权限但有敏感操作 → Medium

### Spring Session 检测

**目标：** 发现会话安全配置缺陷

检测模式（Grep）：
```
@EnableRedisHttpSession
@EnableJdbcHttpSession
SpringSession
CookieSerializer
```

**分析规则：**
- 检查 cookie 是否有 `HttpOnly`、`Secure` 标志
- 若 session 配置缺失安全标志 → Medium

### MyBatis XML 检测

**目标：** 发现 SQL 注入漏洞

检测模式（Glob + Grep）：
```
Glob: **/*Mapper.xml
Grep: \$\{[^}]+\}
```

**分析规则：**
- `${param}` 直接拼接用户输入 → SQL注入
- `${_parameter}` 同上
- `${obj.field}` 追踪对象属性来源
- `${${innerParam}}` 双重解析，追踪内层 param
- 若参数来自用户输入且无参数化 → CONFIRMED漏洞

### JDBC 检测

**目标：** 发现 SQL 注入和连接安全问题

检测模式（Grep）：
```
DriverManager\.getConnection
DataSource\.getConnection
createStatement\(\)\.executeQuery
prepareStatement\(sql
```

**分析规则：**
- URL中含字符串拼接 → 检查是否为用户输入
- 是否使用连接池（ HikariCP/Druid）→ 安全
- 是否使用参数化查询 → 安全

### JPA/Hibernate 检测

**目标：** 发现 ORM 使用中的 SQL 注入

检测模式（Grep）：
```
EntityManager\.createQuery
EntityManager\.createNativeQuery
@Query\(value\s*=\s*"
Query\.getResultList
session\.createSQLQuery
```

**分析规则：**
- `@Query` 注解中 SQL 字符串是否含 `${}` 或 `+` 拼接
- `createNativeQuery` 是否直接拼接用户输入
- 是否使用参数绑定（`setParameter`）→ 安全

### 认证相关检测

**目标：** 发现认证和密码存储缺陷

检测模式（Grep）：
```
@PreAuthorize
@PostAuthorize
@Secured
@RolesAllowed
Authentication\.getPrincipal
SecurityContextHolder\.getContext
BCrypt\.encode
passwordEncoder
SESSIONID
JSESSIONID
```

**分析规则：**
- 密码是否使用 BCrypt/SCrypt 加密 → 未使用为 High
- session ID 生成是否包含安全随机数
- 权限注解是否完整覆盖敏感方法

## 已知高危版本清单

| 框架 | 高危版本 | 风险 | CVE |
|------|---------|------|-----|
| Spring < 5.3.18 | CVE-2022-22965 | Spring4Shell RCE | CVE-2022-22965 |
| Struts < 2.5.30 | CVE-2021-31805 | S2-062 OGNL注入 | CVE-2021-31805 |
| FastJSON < 1.2.83 | CVE-2022-25845 | 反序列化RCE | CVE-2022-25845 |
| Jackson < 2.13.0 | CVE-2022-42004 | 反序列化RCE | CVE-2022-42004 |
| Log4j < 2.17.0 | CVE-2021-44228 | Log4Shell RCE | CVE-2021-44228 |
| Shiro < 1.9.1 | CVE-2022-32532 | 绕过认证 | CVE-2022-32532 |
| Spring Security < 5.7 | 配置绕过风险 | 权限配置被忽略 | — |

## 文件上传安全检测

**目标：** 发现文件上传漏洞

检测模式（Grep）：
```
MultipartFile
FileItem
Part\.
uploadFile
getOriginalFilename
```

**分析规则：**
- 文件类型验证是否完整（Content-Type + Extension + Magic Number）
- 文件大小是否限制
- 存储路径是否可预测
- 文件名是否被用户控制（路径遍历风险）
- 是否使用 `getOriginalFilename()` 直接存入数据库/文件系统

## XML外部实体（XXE）检测

**目标：** 发现 XXE 漏洞

检测模式（Grep）：
```
DocumentBuilder
SAXParser
XMLInputFactory
XPathFactory
TransformerFactory
Validator
SchemaFactory
```

**分析规则：**
- 检查是否禁用外部实体：
  ```java
  // 安全配置示例
  dbf.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
  dbf.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
  dbf.setFeature("http://xml.org/sax/features/external-general-entities", false);
  ```
- 若缺失上述配置 → XXE 漏洞

## 路径遍历检测

**目标：** 发现路径遍历漏洞

检测模式（Grep）：
```
new File\(
FileInputStream\(
FileOutputStream\(
Paths\.get\(
Path\.resolve
getPath\(userInput
getAbsolutePath
getCanonicalPath
```

**分析规则：**
- 用户输入是否进入路径构造
- 是否使用 `getCanonicalPath()` 规范化路径
- 上传文件是否验证 父目录引用符 (`..`) 路径遍历

## SSRF检测

**目标：** 发现服务器端请求伪造漏洞

检测模式（Grep）：
```
HttpClient
OkHttpClient
URLConnection
RestTemplate
WebClient
HttpURLConnection
openConnection
```

**分析规则：**
- URL是否来自用户输入
- 是否有DNS rebinding 防护
- 是否限制了允许的协议（禁止 `file://`, `gopher://`, `jar://`）
- 是否有URL白名单验证

## 业务逻辑安全审计指南

### 1. 金融计算逻辑审计

**目标**: 发现资金计算精度问题和业务逻辑漏洞

**检测模式 (Grep)**:
```
double\s+\w+.*amount|float\s+\w+.*price|BigDecimal\..*divide\(.*,\s*\d+|\.multiply\(|\.add\(|\.subtract\(
```

**审计规则**:

| 检查项 | 风险等级 | 说明 |
|--------|---------|------|
| 使用 float/double 计算金额 | **HIGH** | 精度丢失可能导致资金损失 |
| BigDecimal 除法未指定精度 | **MEDIUM** | 可能抛出 ArithmeticException |
| 金额未做正负校验 | **MEDIUM** | 负数金额可能导致资金损失 |
| 金额未做上限校验 | **MEDIUM** | 超大金额可能导致溢出 |
| 汇率未做合理性校验 | **MEDIUM** | 0 或负数汇率导致计算错误 |

**示例分析**:
```java
// 问题代码: 使用浮点数
public double calculateFee(double amount) {
    return amount * 0.015;  // 精度问题
}

// 安全代码: 使用 BigDecimal
public BigDecimal calculateFee(BigDecimal amount) {
    return amount.multiply(new BigDecimal("0.015"))
                 .setScale(2, RoundingMode.HALF_UP);
}

// 问题代码: 未校验金额
public void transfer(BigDecimal amount) {
    // 缺少校验: amount > 0 && amount <= MAX_LIMIT
}

// 安全代码: 完整校验
public void transfer(BigDecimal amount) {
    if (amount == null || amount.compareTo(BigDecimal.ZERO) <= 0) {
        throw new IllegalArgumentException("Invalid amount");
    }
    if (amount.compareTo(MAX_TRANSFER_LIMIT) > 0) {
        throw new IllegalArgumentException("Amount exceeds limit");
    }
}
```

---

### 2. 并发安全审计

**目标**: 发现竞态条件和并发安全问题

**检测模式 (Grep)**:
```
setIfAbsent|tryLock|lock\(\)|synchronized|@Transactional|@Async|CompletableFuture
```

**审计规则**:

| 检查项 | 风险等级 | 说明 |
|--------|---------|------|
| 锁在 finally 外释放 | **HIGH** | 异常时锁不释放，导致死锁 |
| 递归调用无终止条件 | **MEDIUM** | 栈溢出风险 |
| 无幂等性保护 | **MEDIUM** | 重复提交导致重复处理 |
| 乐观锁缺失 | **MEDIUM** | 并发修改数据不一致 |
| 事务范围过大 | **LOW** | 性能问题，可能死锁 |

**示例分析**:
```java
// 问题代码: 锁不在 finally 中
Boolean lock = redisTemplate.opsForValue().setIfAbsent(key, "1", 60, TimeUnit.SECONDS);
if (lock) {
    doBusiness();  // 异常时锁不释放
    redisTemplate.delete(key);
}

// 安全代码: try-finally 确保释放
Boolean lock = redisTemplate.opsForValue().setIfAbsent(key, "1", 60, TimeUnit.SECONDS);
if (lock) {
    try {
        doBusiness();
    } finally {
        redisTemplate.delete(key);
    }
} else {
    throw new BusinessException("Operation in progress");
}

// 问题代码: 递归无限制
public void retry() {
    if (!tryLock()) {
        Thread.sleep(100);
        retry();  // 栈溢出
    }
}

// 安全代码: 限制重试次数
public void retry(int maxAttempts) {
    for (int i = 0; i < maxAttempts; i++) {
        if (tryLock()) {
            return;
        }
        Thread.sleep(100);
    }
    throw new BusinessException("Max retries exceeded");
}
```

---

### 3. 状态机与流程审计

**目标**: 发现状态流转漏洞

**检测模式 (Grep)**:
```
status.*=|setStatus\(|orderStatus|paymentStatus|\.equals.*STATUS|enum.*Status
```

**审计规则**:

| 检查项 | 风险等级 | 说明 |
|--------|---------|------|
| 状态转换未校验前置状态 | **HIGH** | 非法状态流转 |
| 终态可修改 | **MEDIUM** | 已完成订单被取消 |
| 并发修改状态 | **MEDIUM** | 竞态条件 |

**示例分析**:
```java
// 问题代码: 未校验前置状态
public void cancelOrder(Long orderId) {
    Order order = orderService.getById(orderId);
    order.setStatus("CANCELLED");  // 任意状态都可取消
    orderService.update(order);
}

// 安全代码: 校验前置状态
public void cancelOrder(Long orderId) {
    Order order = orderService.getById(orderId);
    if (!"PENDING".equals(order.getStatus())) {
        throw new BusinessException("Only pending orders can be cancelled");
    }
    order.setStatus("CANCELLED");
    orderService.update(order);
}
```

---

### 4. IDOR (不安全的直接对象引用)

**目标**: 发现水平越权漏洞

**检测模式 (Grep)**:
```
getById\(|selectById\(|findById\(|getOrder\(|getUser\(
```

**审计规则**:

| 检查项 | 风险等级 | 说明 |
|--------|---------|------|
| 查询未限制用户范围 | **HIGH** | 可访问任意用户数据 |
| 修改未校验所有权 | **HIGH** | 可修改他人数据 |
| 导出未限制范围 | **MEDIUM** | 批量数据泄露 |

**示例分析**:
```java
// 问题代码: 未限制查询范围
@PostMapping("/order/{orderId}")
public Order getOrder(@PathVariable Long orderId) {
    return orderService.getById(orderId);  // 可查询任意订单
}

// 安全代码: 限制当前用户
@PostMapping("/order/{orderId}")
public Order getOrder(@PathVariable Long orderId) {
    Long userId = SecurityUtils.getCurrentUserId();
    return orderService.getByIdAndUserId(orderId, userId);
}

// 问题代码: 管理接口未校验权限
@PostMapping("/admin/order/{orderId}")
public Order adminGetOrder(@PathVariable Long orderId) {
    return orderService.getById(orderId);  // 任何人可访问
}

// 安全代码: 添加权限控制
@PostMapping("/admin/order/{orderId}")
@PreAuthorize("hasRole('ADMIN')")
public Order adminGetOrder(@PathVariable Long orderId) {
    return orderService.getById(orderId);
}
```

---

### 5. 敏感数据审计

**目标**: 发现敏感数据处理不当

**检测模式 (Grep)**:
```
log\.(info|debug|warn|error).*(password|token|secret|cardNo|idCard|phone|email)|toString\(\)|JSON\.toJSONString
```

**审计规则**:

| 检查项 | 风险等级 | 说明 |
|--------|---------|------|
| 日志输出敏感信息 | **MEDIUM** | 敏感信息泄露到日志 |
| 返回对象包含敏感字段 | **HIGH** | 敏感信息返回给客户端 |
| 敏感字段未脱敏 | **MEDIUM** | 前端展示完整敏感信息 |

**示例分析**:
```java
// 问题代码: 日志输出敏感信息
log.info("User login: {}", user);  // 输出所有字段，包括密码

// 安全代码: 选择性输出
log.info("User login: userId={}", user.getId());

// 问题代码: 返回对象含敏感信息
public User getUser(Long id) {
    return userService.getById(id);  // 返回包含密码的对象
}

// 安全代码: 使用 DTO 脱敏
public UserDTO getUser(Long id) {
    User user = userService.getById(id);
    return convertToDTO(user);  // 密码等敏感字段不转换
}
```

---

## 敏感文件检测

**目标：** 发现敏感信息泄露

检测模式（Grep）：
```
\.properties
\.xml\s+\w+
\.yml
database\.password
db\.password
mysql\.password
redis\.password
secret\.key
api\.key
```

**分析规则：**
- 配置文件中的密码是否为加密存储
- 第三方服务凭据是否硬编码
- 私钥文件是否在webroot可访问目录

## JavaScript引擎检测（脚本执行）

**目标：** 发现代码执行漏洞

检测模式（Grep）：
```
Nashorn
Rhino
ScriptEngine
GroovyShell
GroovyClassLoader
javax.script
.evaluate\(
.compile\(
```

**分析规则：**
- 脚本来源是否可信
- 是否有沙箱隔离（ScriptEngineManager + Policy）
- 用户输入是否进入脚本编译/执行

## 反序列化漏洞检测

**目标：** 发现反序列化远程代码执行

检测模式（Grep）：
```
ObjectInputStream
XMLDecoder
XStream\.fromXML
JSON\.parseObject
ObjectMapper\.readValue
JSON\.toJavaObject
readObject\(
readResolve\(
```

**分析规则：**
- 是否使用带外部输入的反序列化
- 是否有签名验证（`ObjectInputStream` + `readFields`）
- 是否使用安全的替代方案（JSON/Protobuf）

## Struts2 检测

**目标：** 发现 Struts2 OGNL 注入

检测模式（Grep）：
```
struts
ActionSupport
ActionInvocation
ServletActionContext
getText\(
```

**分析规则：**
- 参数是否直接用于 OGNL 表达式
- 是否使用 `altSyntax` 关闭

## Spring Boot Actuator 检测

**目标：** 发现敏感端点暴露

检测模式（Grep）：
```
actuator
/actuator
/env
/heapdump
/threaddump
/metrics
/spring
```

**分析规则：**
- actuator 端点是否配置访问控制
- 敏感端点（env、heapdump）是否对外暴露
- `/health` 是否需要认证

## JWT 安全检测 **[NEW]**

**目标：** 发现 JWT 令牌管理缺陷（基于历史报告中 JWT 无过期时间、注销不失效等高频问题）

### JWT 过期时间检测

检测模式（Grep）：
```
Jwts\.builder\(\)
JwtBuilder
\.signWith\(.+\)\s*\.compact\(\)
createToken|generateToken|buildToken
```

**分析规则：**
- 搜索 JWT 生成代码
- 检查是否调用 `setExpiration()` 或 `.exp()`
- 检查过期时间是否合理（建议 ≤ 2 小时）
- **关键：** 无 `.setExpiration()` → JWT 永久有效（历史报告中 Pacstrust 后台/中台均有此问题）

### JWT 注销失效检测

检测模式（Grep）：
```
logout.*\{|/logout|signout|/signout
redisTemplate\.delete.*token|blacklist.*token
```

**分析规则：**
- 搜索 logout 接口
- 检查是否清理 Redis Session/Token 黑名单
- 检查是否有 Token 版本控制机制
- 检查再次登录时是否生成新 Token

### JWT 密钥硬编码检测

检测模式（Grep）：
```
\.signWith\(\s*["']|secret.*=\s*["'][^"']{8,}["']
jwt.*secret.*=.*["']|jwtSecret|JWT_SECRET
```

**分析规则：**
- JWT secret 是否硬编码在代码中
- 是否使用环境变量或密钥管理服务

## 验证码安全检测 **[NEW]**

**目标：** 发现验证码管理缺陷（基于历史报告中验证码消费后不失效问题）

检测模式（Grep）：
```
checkCode|verifyCode|validateCaptcha|captcha|验证码
session\.getAttribute.*code|redisTemplate.*get.*code
redisTemplate\.delete.*code|remove.*code
```

**分析规则：**
- 搜索验证码校验逻辑
- **关键：** 校验成功后是否删除验证码（AurumVault 验证码消费后不失效）
- 验证码有效期是否合理（建议 ≤ 5 分钟）
- 验证码是否仅一次有效

## 安全配置汇总检测 **[NEW]**

**分析规则：**
- 检查 `application.yml/properties` 中 Actuator 暴露配置
- 检查 Druid 是否设置登录密码和 IP 白名单
- 检查 Nacos `nacos.core.auth.enabled` 是否为 `true`
- 检查 Spring Boot Admin 是否配置认证
- 检查日志系统（Loki/ELK）是否暴露公网

详见 `references/springboot-security.md`

## 污染追踪规则（Java特定）

### 变量污染状态判断

| 来源类型 | 标记 | 风险级别 |
|---------|------|---------|
| HttpServletRequest 参数 | TAINTED-用户输入 | 高 |
| @RequestParam / @RequestBody | TAINTED-用户输入 | 高 |
| @PathVariable | TAINTED-用户输入 | 高 |
| 数据库读取的用户数据 | TAINTED-数据库 | 中 |
| @Value 配置 | TAINTED-配置 | 中 |
| Redis 缓存读取 | TAINTED-缓存 | 中 |
| 消息队列传入参数 | TAINTED-消息队列 | 高 |
| 硬编码常量 | CLEAN | 低 |
| 内部计算 | CLEAN | 低 |

### 追踪终止条件

- 追踪到 `PreparedStatement` 参数化 → 净化成功，终止
- 追踪到 `${` 在 MyBatis XML → 需检查参数来源
- 追踪到 `HtmlUtils.htmlEscape()` → XSS 净化成功
- 追踪超过7层 → 标记为 UNCONFIRMED