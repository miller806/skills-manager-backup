---
name: springboot-security
description: SpringBoot 安全专项规则 — 检测 Actuator/Druid/Nacos/Spring Boot Admin 等基础设施暴露
config:
  progression:
    phase: "2B"
    name: "SpringBoot Infrastructure Security"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "pom.xml/build.gradle with spring-boot detected"
    when: "if: java (spring-boot)"
---

# SpringBoot 基础设施安全规则

**Phase:** 2B (Control-Driven Audit)  
**Trigger:** `if: java` 检测到 SpringBoot 项目时加载  
**来源：** 历史报告中 Actuator/Druid/Nacos 高频暴露的实战经验

---

## 一、SpringBoot Actuator 未授权访问

### 1.1 检测目标

Actuator 暴露的敏感端点包括：
- `/actuator/env` — 环境变量、数据库密码、API Key
- `/actuator/heapdump` — JVM 堆转储，可提取数据库密码
- `/actuator/beans` — 所有 Bean 定义
- `/actuator/configprops` — 配置属性
- `/actuator/loggers` — 日志配置
- `/actuator/mappings` — 路由映射

### 1.2 历史案例

| 项目 | 端点 | 危害 |
|------|------|------|
| Pacstrust 后台 | `/api/admin/actuator/` | 监控端点暴露 |
| Pacstrust 中台 | `/api/member/actuator/` | 监控端点暴露 |
| Cregis | `/actuator/heapdump` | heapdump 泄露数据库密码 |
| Cregis | `/druid/index.html` | Druid 监控暴露 |
| Cregis | `/admin/instances/...` | Spring Boot Admin 未授权 |

### 1.3 检测模式（Grep）

**配置文件检测：**
```
management\.endpoints\.web\.exposure\.include.*\*
management\.endpoint\.heapdump\.enabled.*true
management\.endpoints\.web\.base-path
```

**Spring Security 配置检测：**
```
@EnableWebSecurity
WebSecurityConfigurerAdapter
SecurityFilterChain
authorizeHttpRequests
.antMatchers.*actuator
.requestMatchers.*actuator
```

**代码检测：**
```
@EnableWebSecurity(?!.*EndpointHandlerMapping|EndpointMvcAdapter|/actuator)
.antMatchers\s*\(\s*["']/actuator
```

### 1.4 检测步骤

1. 检查 `application.yml/properties` 中 `management.endpoints.web.exposure.include`
2. 如果包含 `*` 或 `env,heapdump,beans,configprops`，检查 Spring Security 配置
3. 检查 Spring Security 是否有 `.requestMatchers("/actuator/**").hasRole("ADMIN")`
4. 如果没有，判定为 Actuator 未授权访问漏洞

### 1.5 修复方案

```yaml
# application.yml — 仅暴露必要端点
management:
  endpoints:
    web:
      exposure:
        include: health,info  # 不要使用 *
      base-path: /actuator
  endpoint:
    health:
      show-details: when-authorized
    env:
      show-values: when-authorized  # 隐藏敏感环境变量
```

```java
// Spring Security 配置
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/actuator/**").hasRole("ADMIN")
            .requestMatchers("/actuator/health", "/actuator/info").permitAll()
            // ... 其他配置
        )
        .csrf(csrf -> csrf.ignoringRequestMatchers("/actuator/**"));
    return http.build();
}
```

---

## 二、Druid 监控暴露

### 2.1 检测目标

Druid 是阿里巴巴开源的数据库连接池，其监控页面 (`/druid/index.html`) 可展示：
- 数据库连接信息
- SQL 执行统计
- 慢 SQL 日志（含完整 SQL 语句和参数）

### 2.2 历史案例

| 项目 | 路径 | 危害 |
|------|------|------|
| Cregis | `/druid/index.html` | 可获取数据库信息和 SQL 执行日志 |

### 2.3 检测模式（Grep）

```
DruidStatViewServlet|StatViewServlet|druid.*stat|/druid/
DruidDataSource.*password
@Bean.*statViewServlet
```

### 2.4 检测步骤

1. 搜索 `DruidStatViewServlet` 或 `stat-view-servlet` 配置
2. 检查是否设置 `loginUsername` / `loginPassword`
3. 检查是否限制 `allow` IP 白名单
4. 检查 Spring Security 是否拦截 `/druid/**`

### 2.5 修复方案

```java
@Bean
public ServletRegistrationBean<StatViewServlet> druidStatViewServlet() {
    ServletRegistrationBean<StatViewServlet> bean = new ServletRegistrationBean<>(new StatViewServlet(), "/druid/*");
    bean.addInitParameter("loginUsername", "admin");
    bean.addInitParameter("loginPassword", "strong_password_here");  // 强密码
    bean.addInitParameter("allow", "127.0.0.1,10.0.0.0/8");  // 仅允许内网
    return bean;
}
```

---

## 三、Nacos 未授权访问

### 3.1 检测目标

Nacos 是配置中心和服务注册中心，未授权可访问：
- 所有服务配置（含数据库密码、API Key）
- 服务注册列表（内网拓扑）
- 命名空间配置

### 3.2 历史案例

| 项目 | 路径 | 危害 |
|------|------|------|
| Cregis | `112.28.138.245:8848/nacos/index.html` | 直接读取/修改所有配置 |

### 3.3 检测模式（Grep）

```
nacos.*server-addr|NacosConfigService|nacos-config
nacos\.core\.auth\.enabled
nacos.*discovery|spring-cloud-starter-alibaba-nacos
```

**配置文件检测：**
```
nacos.core.auth.enabled=false
nacos.core.auth.enabled=true  # 检查是否有密码配置
nacos.core.auth.system.type
```

### 3.4 检测步骤

1. 检查 `nacos.core.auth.enabled` 是否为 `true`
2. 检查 `nacos.core.auth.plugin.nacos.token.secret.key` 是否设置复杂密钥
3. 检查 Nacos 端口（8848）是否暴露公网
4. 检查 Nacos 控制台是否需要登录

### 3.5 修复方案

```properties
# application.properties (Nacos)
nacos.core.auth.enabled=true
nacos.core.auth.plugin.nacos.token.secret.key=YourStrongSecretKeyAtLeast32CharactersLong
nacos.core.auth.system.type=nacos
```

```yaml
# 防火墙/安全组：限制 Nacos 端口仅内网访问
# 8848/tcp 仅允许 10.0.0.0/8
```

---

## 四、Spring Boot Admin 未授权

### 4.1 检测目标

Spring Boot Admin 提供应用管理界面，未授权可直接进入：
- 应用实例列表
- 环境变量
- 日志配置
- 线程 Dump
- Heap Dump

### 4.2 历史案例

| 项目 | 路径 | 危害 |
|------|------|------|
| Cregis | `/admin/instances/09bcddb15ea8/details` | 直接进入管理界面，无需认证 |

### 4.3 检测模式（Grep）

```
spring-boot-admin|de.codecentric:spring-boot-admin|admin-server
@EnableAdminServer
```

### 4.4 修复方案

```yaml
# application.yml
spring:
  security:
    user:
      name: admin
      password: strong_password

management:
  endpoints:
    web:
      exposure:
        include: health,info
```

```java
@Bean
public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
    http.authorizeHttpRequests(auth -> auth
        .requestMatchers("/admin/**").authenticated()
        .anyRequest().permitAll()
    ).formLogin(Customizer.withDefaults());
    return http.build();
}
```

---

## 五、Apache SeaTunnel / 日志聚合系统暴露

### 5.1 历史案例

| 项目 | 系统 | 路径 | 危害 |
|------|------|------|------|
| Cregis | Apache SeaTunnel | `otter.cregis.dev/#/overview` | 集群拓扑/作业配置泄露 |
| Cregis | Apache SeaTunnel 日志目录 | `otter.cregis.dev/log/` | 目录遍历下载作业日志 |
| Cregis | Loki 日志聚合 | `112.28.138.245:30100/config/` | OSS 配置泄露，日志可写入 |

### 5.2 检测模式（Grep）

```
loki.*endpoint|loki.*push|grafana-loki
sea-tunnel|seatunnel|ApacheSeaTunnel
30100|8080.*ui/clusters
```

### 5.3 修复方案

- 所有日志聚合系统（Loki/ELK/Grafana）限制内网访问
- 目录浏览禁用（Nginx `autoindex off;`）
- 配置认证机制

---

## 六、JWT 安全配置

### 6.1 JWT 无过期时间

**检测模式（Grep）：**
```
Jwts\.builder\(\)(?!.*setExpiration)
\.signWith\((?!.*setExpiration)
JwtBuilder.*compact\(\)(?!.*exp)
```

**检测步骤：**
1. 搜索 JWT 生成代码（`Jwts.builder()`）
2. 检查是否调用 `setExpiration()`
3. 检查过期时间是否合理

### 6.2 JWT 算法混淆（none 算法）

**检测模式（Grep）：**
```
\.setAllowedClockSkewSeconds|algorithm.*none|Algorithm\.none()
```

### 6.3 JWT 密钥硬编码

**检测模式（Grep）：**
```
\.signWith\(\s*["']|secret.*=\s*["'][^"']{8,}["']
jwt.*secret.*=.*["']|jwtSecret
```

### 6.4 修复方案

```java
// 正确示例
Jwts.builder()
    .setSubject(user.getUsername())
    .setIssuedAt(new Date())
    .setExpiration(new Date(System.currentTimeMillis() + 3600000)) // 1小时
    .signWith(secretKey, SignatureAlgorithm.HS256)
    .compact();
```

---

## 七、自检清单

- [ ] Actuator 端点是否仅暴露 `health,info`
- [ ] Actuator 是否配置 Spring Security 拦截
- [ ] heapdump 是否禁用或限制访问
- [ ] Druid 是否设置登录密码和 IP 白名单
- [ ] Nacos 是否开启认证且设置强密钥
- [ ] Nacos 端口是否限制内网访问
- [ ] Spring Boot Admin 是否配置认证
- [ ] 日志系统（Loki/ELK）是否暴露公网
- [ ] SeaTunnel/数据集成工具是否限制访问
- [ ] JWT 是否设置合理过期时间
- [ ] JWT 密钥是否使用环境变量/密钥管理
- [ ] JWT 验证是否检查过期状态
