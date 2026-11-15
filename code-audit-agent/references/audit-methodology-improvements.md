# 审计方法改进对比

## 问题背景

在审计 Pacstrust 项目时，发现两个关键问题导致原始审计报告不够准确：

1. **SSRF 误报**: 将未使用的 HTTP 客户端代码标记为 SSRF 高危漏洞
2. **SQL注入等级过高**: 未考虑管理员权限限制，直接判定为 CRITICAL

## 原始审计方法 vs 改进后方法

### 案例 1: HttpUtils.java 的 SSRF 误报

**原始审计流程**:
```
1. Grep 发现 HttpUtils.getJson() 使用 DefaultHttpClient.execute()
2. 检查: URL 参数来自方法参数 → 用户可控
3. 判定: SSRF (HIGH)
4. 报告写入
```

**问题**: 未验证方法是否被调用

---

**改进后审计流程**:
```
1. Grep 发现 HttpUtils.getJson() 使用 DefaultHttpClient.execute()
2. 可达性分析:
   - Grep "HttpUtils.getJson" → 无调用
   - Grep "HttpUtils\.getJson" → 无调用
   - 结论: 死代码，方法未被使用
3. 实际使用分析:
   - 发现 HttpUtils.postJson() 被 ByberServiceImpl.getPrice() 调用
   - 追溯 URL 来源: @Value("${byber.price.url}") 配置项
   - 结论: URL 非用户可控
4. 判定: 安全债务 (LOW) - 使用已弃用 API
5. 报告写入 + 上下文说明
```

**关键改进**: 
- ✅ 方法调用链验证
- ✅ 实际使用 vs 发现点分离
- ✅ 参数来源追踪到配置项

---

### 案例 2: DBUtils.java SQL 注入等级调整

**原始审计流程**:
```
1. Grep 发现 executeUpdate("CREATE TABLE " + tableName)
2. 检查: tableName 由 tabName + merchantId 拼接
3. 检查: merchantId 来自方法参数
4. 判定: SQL注入 (CRITICAL) - 用户可控
5. 报告写入
```

**问题**: 未分析完整调用链和访问控制

---

**改进后审计流程**:
```
1. Grep 发现 executeUpdate("CREATE TABLE " + tableName)
2. 方法调用链分析:
   createByberCardsBill()
   ↑ createMerchantBillTable()
     ↑ initCardsAccount()
       ↑ ByberAccoutController.initCardsAccount() [HTTP POST]
   ↑ ByberAccountFeignService.initCardsAccount() [Feign 调用]
     ↑ ByberMerchantsController.updateMerchantServerStatus()
3. 入口点分析:
   - Controller 路径: /admin/updateMerchantServerStatus
   - 权限检查: @PreAuthorize? 无显式注解
   - 包路径: .../admin/... 暗示管理员功能
   - 业务逻辑: 开通卡服务，属管理员操作
4. 可控性分析:
   - merchantId 从 HTTP RequestBody 传入
   - 但接口非公开，需通过管理员后台
   - merchantId 通常由系统生成，格式受限
5. 风险降级:
   - 原始: CRITICAL (假设任意用户可利用)
   - 调整后: MEDIUM (利用需管理员权限)
6. 报告写入 + 详细分析说明
```

**关键改进**:
- ✅ 完整调用链追溯
- ✅ 入口点访问控制分析
- ✅ 实际利用场景评估
- ✅ 风险等级动态调整

---

## 改进后的审计检查清单

### Phase 3: Static Verification 增强

#### 新增: 可达性验证 (Reachability Analysis)

**每个 Sink 发现必须执行**:

```
□ 方法调用验证
  └─ Grep: "ClassName.methodName" - 是否被调用?
  └─ Grep: "\.methodName(" - 检查继承/接口调用
  └─ 结论: DEAD_CODE / TEST_ONLY / PRODUCTION

□ 调用链追溯
  └─ 向上追溯直到 Controller/Listener/定时任务
  └─ 记录完整调用路径
  └─ 识别入口点类型 (HTTP/消息队列/内部调用)

□ 参数来源分析
  └─ 危险参数从哪来?
     ├─ @RequestBody / @RequestParam / @PathVariable → 用户输入
     ├─ @Value / 配置类 → 配置项 (不可控)
     ├─ 数据库查询 → 内部数据 (需进一步追踪)
     ├─ 系统生成 (UUID/时间戳等) → 不可控
     └─ 硬编码 → 不可控

□ 访问控制评估
  └─ 是否有 @PreAuthorize / @Secured?
  └─ 是否在 admin/ 包路径?
  └─ 是否有网关/API鉴权?
  └─ 评估: 公开 / 需登录 / 需管理员

□ 风险等级调整
  └─ 根据以上分析调整严重性
  └─ 记录调整理由
```

---

## 风险等级调整规则

### 基础等级 → 调整后等级

| 漏洞类型 | 基础等级 | 可达性条件 | 调整后等级 | 理由 |
|---------|---------|-----------|-----------|------|
| SQL注入 | CRITICAL | 死代码 (无调用) | 不报告 | 无法利用 |
| SQL注入 | CRITICAL | 仅测试代码调用 | LOW | 非生产路径 |
| SQL注入 | CRITICAL | 需管理员权限 | HIGH | 利用门槛高 |
| SQL注入 | CRITICAL | 配置项参数 | MEDIUM | 需配置注入 |
| SSRF | HIGH | URL 配置项 | LOW | 非用户可控 |
| SSRF | HIGH | 死代码 | 不报告 | 无法利用 |
| 硬编码密钥 | HIGH | 测试代码 | LOW | 非生产环境 |
| 硬编码密钥 | HIGH | 生产配置 | HIGH | 保持原等级 |

---

## 实施建议

### 1. 工具层改进

**Grep 扩展**:
```bash
# 查找 Sink 点后，必须查找调用方
grep -r "SinkClass\.sinkMethod" --include="*.java"
grep -r "\.sinkMethod(" --include="*.java"
```

**IDE 辅助**:
- 使用 "Find Usages" 验证方法调用
- 检查注解和权限配置

### 2. 流程层改进

**审计报告模板增加**:
```markdown
### [风险等级] 漏洞名称

**位置**: `file:line`

**代码**:
```java
// 漏洞代码
```

**可达性分析**:
- 调用链: `ClassA.methodA()` → `ClassB.methodB()` → `Sink.method()`
- 入口点: `Controller.endpoint()` [HTTP POST /api/xxx]
- 访问控制: 公开/需登录/需管理员
- 参数来源: @RequestBody / @Value / 系统生成

**风险降级/升级理由**:
原始等级 X，调整为 Y，因为 ...

**修复建议**:
```java
// 修复代码
```
```

### 3. 验证层改进

**人工复核检查项**:
- [ ] 方法调用链是否完整?
- [ ] 入口点是否已识别?
- [ ] 权限要求是否已评估?
- [ ] 参数来源是否已追踪?
- [ ] 风险等级是否合理?

---

## 总结

### 核心理念转变

**旧**: 发现危险代码模式 → 报告漏洞
**新**: 发现危险代码模式 → 验证可达性 → 分析上下文 → 准确报告

### 关键收益

1. **减少误报**: 避免报告死代码中的"漏洞"
2. **准确分级**: 基于实际利用难度调整严重性
3. **节省资源**: 开发团队聚焦真正可修复的问题
4. **提高信任**: 准确的报告提升安全团队可信度

### 未来改进方向

1. **自动化调用链分析**: 使用 IDE 辅助功能
2. **权限建模**: 建立接口权限数据库
3. **历史漏洞学习**: 基于历史误报优化规则
