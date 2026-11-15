---
name: business-logic-patterns
description: 业务逻辑漏洞模式 — 基于历史报告中高频出现的业务逻辑漏洞归纳的检测规则
config:
  progression:
    phase: "2C"
    name: "Business Logic Vulnerability Patterns"
    prev: "Phase 2B Control-Driven"
    next: "Phase 3 Static Verification"
    trigger: "loaded during Phase 2C Logic-Driven Audit"
    when: "always loaded as reference"
---

# 业务逻辑漏洞模式

**Phase:** 2C (Logic-Driven Audit)  
**来源：** 18 份历史渗透测试报告中归纳的业务逻辑漏洞模式  
**适用：** 所有后端语言（Java/Python/Node.js/Go/PHP/C#/Rust/Kotlin）

---

## 一、金额数值逻辑漏洞

### 1.1 负数金额绕过

**出现频次：** 极高频（5 个项目均有发现）

| 项目 | 漏洞位置 | 参数名 |
|------|---------|--------|
| Pacstrust | 付款方排序 | `sort` |
| Udun | 硬件钱包数量 | 负数可少付款 |
| Udun | 手续费倍数配置 | `riseMultiple=-999999999999` |
| Cregis | 钱包扩容数量 | `addValue=1.1`（小数） |
| Cregis | 提币额度/子地址个数 | 200$ 买到 500 万额度 |
| AurumVault | 钱包发送金额 | 负数 |
| CSPN | 密码验证绕过 | `isPassed` 字段篡改 |

**检测模式（Grep）：**
```
# 数值型参数后端校验检测
@RequestParam.*amount|@RequestParam.*price|@RequestParam.*fee|@RequestParam.*count
@RequestParam.*sort|@RequestParam.*quantity|@RequestParam.*number
amount|price|fee|sort|count|quantity|number|multiple|addValue|riseMultiple
\.multiply\(|\.add\(|\.subtract\(|\.divide\(
compareTo|\.compareTo\(BigDecimal\.ZERO
```

**检测步骤：**
1. 搜索所有 Controller 中的数值型参数（`@RequestParam Integer` / `@RequestParam Long` / `@RequestParam BigDecimal`）
2. 对每个数值型参数，检查其后是否有 `> 0` 校验
3. 检查是否有上限校验（`<= MAX_VALUE`）
4. 检查是否为整数类型（防止小数传入）
5. 检查涉及金额的参数是否使用 `BigDecimal`（而非 `float`/`double`）

**修复方案：**
```java
// 参数校验注解方式
public class CreateOrderReq {
    @NotNull(message = "数量不能为空")
    @Min(value = 1, message = "数量必须为正整数")
    @Max(value = 9999, message = "数量超出上限")
    private Integer quantity;

    @NotNull(message = "金额不能为空")
    @DecimalMin(value = "0.01", message = "金额必须大于0")
    @Digits(integer = 10, fraction = 2, message = "金额精度错误")
    private BigDecimal amount;
}

// 手动校验方式
public void setSort(@RequestParam Integer sort) {
    if (sort == null || sort < 0) {
        throw new BusinessException("排序值必须为非负整数");
    }
    config.setSort(sort);
}
```

---

### 1.2 精度绕过 — 存储精度 vs 显示精度不一致

**真实案例：** AurumVault 后台理财产品。将 `9.99` 改为 `9.991`，服务端比较 `9.991 > 9.99` 通过，但存储/展示仅保留两位小数。

**检测模式（Grep）：**
```
setScale\(2|RoundingMode|precision|精度
\.compareTo\(BigDecimal|compareTo\(
```

**检测步骤：**
1. 搜索所有涉及金额比较的代码
2. 检查比较逻辑使用的精度
3. 检查存储/展示使用的精度
4. 检查唯一性校验使用的精度
5. 比较精度 ≠ 存储精度 → 漏洞

**修复方案：**
```java
// 接收参数后立即统一精度（关键：在入口统一）
public ProductResp addProduct(@RequestBody ProductReq req) {
    BigDecimal totalAmount = req.getTotalAmount().setScale(2, RoundingMode.HALF_UP);
    BigDecimal minAmount = req.getMinAmount().setScale(2, RoundingMode.HALF_UP);
    // 后续所有操作均使用此统一精度的值
    if (totalAmount.compareTo(minAmount) < 0) {
        throw new BusinessException("总额度不能小于起购额度");
    }
    // 使用统一精度的值进行唯一性校验
    if (productMapper.countByAmount(totalAmount) > 0) {
        throw new BusinessException("产品金额已存在");
    }
}
```

---

### 1.3 前端计算金额

**真实案例：** Cregis 购买提币额度，前端计算价格后传递给后端，后端直接使用前端传递的金额。

**检测步骤：**
1. 搜索订单创建/支付相关接口
2. 检查前端是否传递计算后的金额（`totalAmount`、`payAmount`）
3. 检查后端是否重新查询单价并计算总价
4. 如果后端直接使用前端金额 → 漏洞

**修复方案：**
```java
// Before: 信任前端金额
public Order createOrder(@RequestBody OrderReq req) {
    Order order = new Order();
    order.setTotalAmount(req.getTotalAmount()); // 直接使用前端金额，危险
}

// After: 后端重新计算
public Order createOrder(@RequestBody OrderReq req) {
    Product product = productMapper.selectById(req.getProductId());
    BigDecimal unitPrice = product.getPrice();
    BigDecimal totalAmount = unitPrice.multiply(BigDecimal.valueOf(req.getQuantity()))
        .setScale(2, RoundingMode.HALF_UP);
    Order order = new Order();
    order.setTotalAmount(totalAmount); // 使用后端计算金额
}
```

---

## 二、参数篡改漏洞

### 2.1 购买数量篡改

**真实案例：** Cregis 提币额度/子地址个数。原本 200$ 购买的额度，抓包改为远超实际支付价值的数值。

**检测模式（Grep）：**
```
addValue|quota|limit|额度|子地址|capacity
upgrade|扩容|subscription|订阅
```

**检测步骤：**
1. 搜索付费升级/扩容/订阅相关接口
2. 检查购买数量是否与支付金额强绑定
3. 检查是否可修改数量获取超出支付价值的资源
4. 检查是否设置最大上限阈值

**修复方案：**
```java
// 价格与数量映射校验
public SubscriptionResp upgrade(@RequestBody UpgradeReq req) {
    // 1. 根据支付金额计算可购买的资源量
    BigDecimal price = pricingService.getPrice(req.getResourceType(), req.getQuantity());
    if (req.getPayAmount().compareTo(price) < 0) {
        throw new BusinessException("支付金额不足");
    }
    // 2. 设置上限
    if (req.getQuantity() > MAX_QUANTITY) {
        throw new BusinessException("数量超出上限");
    }
    // 3. 后端计算资源量，不使用前端传入的资源量
    int actualQuantity = pricingService.calculateQuantity(req.getPayAmount());
    subscriptionService.addQuota(currentUserId, actualQuantity);
}
```

---

### 2.2 手续费/倍数配置篡改

**真实案例：** Udun `/app/fee/setting`。`riseMultiple=-999999999999`，`startTime="asdas"`，`endTime="qwdqwq''"`

**检测模式（Grep）：**
```
fee.*setting|手续费|multiple|riseMultiple
startTime|endTime|生效时间|过期时间
```

**检测步骤：**
1. 搜索配置类接口（费率、倍数、时间等）
2. 检查所有参数是否有格式/范围/逻辑校验
3. 检查数值型参数是否限制合理范围
4. 检查时间型参数是否验证格式和逻辑（endTime > startTime）
5. 检查签名验证是否可被绕过

---

## 三、竞争条件漏洞

### 3.1 并发创建同名资源

**真实案例：** Cregis WaaS 项目创建。快速重复发包可创建多个名称完全相同的项目。

**特征：**
- `SELECT COUNT WHERE name = X` 后 `INSERT`，非原子操作
- 无数据库 `UNIQUE` 约束

**检测模式（Grep）：**
```
SELECT.*COUNT.*WHERE.*name|checkName|checkUnique|名称.*已存在|name.*exist
@Transactional
```

**检测步骤：**
1. 搜索名称/编号唯一性校验逻辑
2. 检查是否为"先查后插"模式（SELECT 后 INSERT）
3. 检查数据库是否有 `UNIQUE` 约束
4. 检查是否在事务中执行
5. 检查是否使用分布式锁

**修复方案：**
```java
// 方案1: 数据库唯一索引（推荐）
ALTER TABLE project ADD UNIQUE KEY uk_name_merchant (name, merchant_id);

// 方案2: 分布式锁
public void createProject(String name) {
    String lockKey = "project:name:" + name;
    try {
        if (!redisLock.tryLock(lockKey, 5, TimeUnit.SECONDS)) {
            throw new BusinessException("项目创建中，请稍候");
        }
        // 在锁保护下再次检查
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

## 四、密码验证绕过

### 4.1 篡改返回包绕过

**真实案例：** CSPN `/account/password/onlineCheck`。前端依赖返回包 `isPassed` 字段，改为 `1` 即可绕过密码验证。

**特征：**
- 前端根据 `response.data.isPassed` / `response.data.success` 判断验证结果
- 服务端仅返回验证状态，不直接执行操作
- 关键操作（取消汇款、转账等）在前端判断通过后执行

**检测模式（Grep）：**
```
isPassed|verifySuccess|passwordCheck|onlineCheck|密码.*验证|密码.*校验
response\.data\.isPassed|res\.data\.success|\.data\.passed
```

**检测步骤：**
1. 搜索密码验证相关接口和前端代码
2. 检查前端是否依赖返回包状态字段判断操作权限
3. 检查关键操作是否在服务端重新验证密码
4. 检查是否存在"前端说通过就通过"的逻辑

**修复方案：**
```java
// Before: 仅返回验证状态，由前端决定是否执行
@PostMapping("/onlineCheck")
public Result checkPassword(@RequestBody PasswordCheckReq req) {
    boolean passed = passwordService.verify(req.getUserId(), req.getPassword());
    return Result.success(Map.of("isPassed", passed)); // 危险
}
// 前端: if (res.data.isPassed) { cancelOrder(); }

// After: 服务端直接执行操作
@PostMapping("/cancelOrder")
public Result cancelOrder(@RequestBody CancelOrderReq req) {
    boolean passed = passwordService.verify(currentUserId, req.getPassword());
    if (!passed) {
        return Result.error("密码错误");
    }
    remitService.cancelOrder(req.getOrderId()); // 服务端执行
    return Result.success();
}
```

---

## 五、邮箱/短信轰炸

### 5.1 空格绕过

**真实案例：**
- Udun：邮箱后加空格可绕过限制
- AurumVault：邮箱前加空格可绕过校验

**检测模式（Grep）：**
```
sendEmail|sendSms|sendCode|发送邮件|发送验证码
trim\s*\(|\.trim\(\)|StringUtils\.trim
```

**检测步骤：**
1. 搜索邮件/短信发送逻辑
2. 检查是否对邮箱/手机号做 `trim()` 处理
3. 检查是否有频率限制（同 IP / 同邮箱 / 同时间段最大发送次数）
4. 检查是否校验邮箱/手机号归属权

**修复方案：**
```java
public void sendEmail(String email) {
    // 1. 统一清理前后+中间所有空格
    email = email.trim().replaceAll("\\s+", "").toLowerCase();
    // 2. 格式校验
    if (!Pattern.matches("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$", email)) {
        throw new BusinessException("邮箱格式错误");
    }
    // 3. 频率限制
    String rateKey = "email:rate:" + email;
    Long count = redisTemplate.opsForValue().increment(rateKey);
    if (count == 1) redisTemplate.expire(rateKey, 1, TimeUnit.HOURS);
    if (count > 5) throw new BusinessException("发送过于频繁");
    // 4. 归属权校验（可选）
    emailService.send(email);
}
```

### 5.2 邮箱去重缺失

**真实案例：** Cregis 通知设置。同一邮箱可被多次添加并重复接收短信。

**检测步骤：**
1. 搜索添加邮箱/通知成员的接口
2. 检查是否有 `SELECT COUNT WHERE email = ?` 去重
3. 检查邮箱数量是否有限制

---

## 六、状态字段越权

### 6.1 状态字段白名单缺失

**真实案例：** AurumVault 后台理财产品状态。`status` 字段可改为 `-128~127` 任意整数。

**检测模式（Grep）：**
```
setStatus|status.*=|updateStatus|状态
```

**检测步骤：**
1. 搜索状态修改接口
2. 检查 `status` 字段是否有白名单校验
3. 检查是否仅允许系统预定义的状态值

**修复方案：**
```java
public void updateProductStatus(@RequestParam Long productId, @RequestParam Integer status) {
    // 白名单校验
    if (!List.of(0, 1, 2).contains(status)) { // 0=下架, 1=上架, 2=待审核
        throw new BusinessException("非法状态值");
    }
    productMapper.updateStatus(productId, status);
}
```

---

## 七、自检清单

执行 Phase 2C 时逐项检查：

- [ ] 所有数值型参数是否校验范围（>0、上限、整数/小数）
- [ ] 金额是否在后端重新计算（不信任前端传递的金额）
- [ ] 导出接口是否按用户/角色过滤数据
- [ ] 审批接口是否校验审批人权限
- [ ] 唯一性校验是否原子（唯一索引 / 分布式锁）
- [ ] 邮箱/短信发送是否限流 + trim + 去重
- [ ] 密码验证接口是否直接执行操作（不返回状态让前端判断）
- [ ] 状态字段是否有白名单校验
- [ ] 时间参数是否验证格式和逻辑
- [ ] 购买数量/资源配额是否与支付金额强绑定
- [ ] BigDecimal 比较与存储是否使用统一精度
