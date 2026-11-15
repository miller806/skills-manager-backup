# Java 代码风格

以 UBS 多模块项目的稳定写法为缺省值；目标仓库、模块规则和实际配置始终优先。

## 基线与格式

- UBS 常见 `feign`、`service`、`server` 分层。根 POM 未强制 Checkstyle/Spotless，各模块 Java 版本、注入方式和依赖可能不同，使用新语法或 Lombok、Hutool、MapStruct、MyBatis、测试库前先核对目标模块。
- 使用 4 空格、同行左花括号、通常一个顶级类型。导入分组、换行和长表达式跟随邻近文件；删除本次造成的未使用导入，不整理未触及代码。
- 成员通常按常量、静态字段、依赖/实例字段、构造器、公开/`@Override` 方法、私有方法排列；不为排序扩大 diff。
- 保持编码和换行符。没有固定行宽时以可读性为准。
- Java 文件名与公开顶级类型一致，源码路径与 `package` 完全匹配；测试代码放对应测试源码集并尽量镜像被测包，配置、SQL、模板等资源沿用目标模块现有资源目录和命名。新建目录前先查同职责文件，不新增 `misc`、`common2`、`temp` 等兜底或近义目录。
- 新类沿用同模块近期同职责文件的注入方式；使用 `@RequiredArgsConstructor` 时依赖为 `final`。历史类不因局部修改迁移注入方式，单类不混用，也不用 `new` 或静态字段绕过 Spring。

## 命名

- 类型用 `UpperCamelCase`，方法/字段/参数/局部变量用 `lowerCamelCase`，常量用 `UPPER_SNAKE_CASE`，包名全小写。
- 沿用领域词汇、协议拼写、缩写和角色后缀：`Request`、`Response`、`DTO`、`VO`、`DO`、`Query`、`Controller`、`Feign`、`Service`、`ServiceImpl`、`Mapper`、`Mapstruct`、`Enum`。
- 方法名用动作表达结果；布尔名优先 `is/has/can/should`，不用 `flag`、`status1`、`data2`。
- 具名领域类型默认使用完整类名首字母小写：`TransactionBizSimpleDTO transactionBizSimpleDTO`、`PayApplyService payApplyService`，保留 `DTO` 等缩写大小写，不写 `transaction`、`dto`、`data`、`result` 或 `payApplyDto`。
- 同类型多实例在完整变量名前加角色，如 `sourceTransactionBizSimpleDTO`；集合追加 `List/Map`，如 `transactionBizSimpleDTOList`。
- 基础类型和通用容器按业务含义命名，如 `transactionHash`、`teamId`；公开字段仍服从外部契约。

## 枚举与有限值

- 新增状态、类型、模式、来源、渠道、阶段、动作等封闭值域时，必须定义或复用枚举，不新增散落字符串/数字常量或多个布尔字段表示状态。
- 先搜索现有领域枚举；跨模块契约使用的枚举放在调用方都能依赖的 `common` 或 `feign` 层，避免反向依赖实现层。
- 新枚举项一律全大写英文：`PENDING`、`ORDER_FAILURE`。历史写法可保留，但本次新增项仍遵守。
- 数据库、JSON 或外部协议值由枚举集中持有稳定 `code/value` 并提供惯用转换；内部方法优先收发枚举，边界集中转换，不散落魔法值。
- 比较枚举使用类型安全方式；比较持久化值时保持空安全。未知外部值需明确拒绝、兼容或映射 `UNKNOWN`，协议不保证时不直接 `Enum.valueOf`。
- 动态配置、租户字典和开放第三方值域不强行枚举化。
- 枚举化不得作为风格修改破坏既有 JSON、Feign、数据库类型或历史值；迁移契约时同步映射、兼容逻辑和测试。

## 分层与复用

- `feign` 放服务间接口和契约；Controller 只做入口、认证/校验衔接、转换和响应；Service 承载业务、事务和数据访问编排。
- DO 只用于持久化；对外使用 DTO/VO/Response。复杂转换复用模块已有 MapStruct，简单转换可显式赋值。
- 新增或调整配置前，先参考项目内同领域、同基础设施的已有服务，沿用其配置前缀、层级、字段名、属性类和读取方式，不新增散落读取；只复用依赖图中实际可访问的类型。
- 明确用于开发/测试环境且不含敏感信息的地址、端口、开关、超时或占位值，可以按现有服务方式提供默认值；只要生产环境有明确覆盖渠道，就不机械要求所有默认值外置，审查时也不把这类默认值直接判为问题。
- 密码、token、密钥、私钥、真实凭证、生产专用地址及租户/用户敏感标识不得作为代码或公共配置默认值；环境归属不明确或可能进入生产时，使用配置中心、环境变量或项目现有外部配置方案。
- 新增通用 Web、RPC、异常、数据、缓存、消息、任务、安全、通知、文件或工具能力前，查阅 [udun-starter-parent 复用指南](udun-starter-parent.md)。语义匹配时复用，不复制实现或再造近义工具。
- starter 缺失且能力有跨服务价值时，向用户说明缺口并建议沉淀；未经授权不扩大到 starter 仓库。领域专属逻辑仍留在业务模块。

## DTO、校验与接口

- 使用轻量、强类型的 Request/Response/DTO/VO；不新增 `Map<String, Object>`、裸 `Object`、`JSONObject`、DO 或无领域含义的 `CommonRequest/BaseDTO` 作为契约。
- 单个 ID 或稳定的一两个条件可直接传参；三个以上相关字段、组合校验、可选项或预期扩展时封装专用对象。参数名仍遵循完整类型命名。
- 入参按只读数据处理；补充内部字段、转换 DO 或构建下游请求时创建对应对象，不就地修改后继续传递或返回。
- 普通字段优先用 Spring Boot Bean Validation：Request/DTO 上使用模块已有 `jakarta.validation` 注解，嵌套对象加 `@Valid`；Controller/RPC 边界用 `@Valid`，分组或方法约束按模块使用 `@Validated`。
- 跨字段、数据库和业务状态校验放 Service；自定义校验注解只承载可复用且普通注解无法表达的规则，不在 Controller/Service 重复字段校验。
- 新增或修改 HTTP 接口时默认补齐项目既有 OpenAPI 3 文档：Controller 类使用 `@Tag`，接口方法使用 `@Operation`，路径、查询、请求头等非显然参数按需使用 `@Parameter`/`@Parameters`，对外 Request/Response/DTO/VO 及其字段使用 `@Schema`。
- 优先复用 `udun-starter-web-doc-openapi` 和 `io.swagger.v3.oas.annotations.*`，不引入 Swagger 2 或新的文档体系。摘要和描述应准确表达业务语义、必填性、枚举值、格式或单位；契约变化时同步更新，不写空描述或只复述 Java 名称。
- OpenAPI 功能默认关闭：使用 starter 的 `udun.doc.enabled` 开关并保持缺省值为 `false`，不得在公共或生产配置中默认开启；确需使用时只在对应开发、测试等环境显式设为 `true`。注解仍照常维护，不与运行期开关绑定。
- 会进入 OpenAPI 扫描的 RPC Controller 同样补文档；仅内部 Feign 声明不机械重复 Controller 注解，除非目标模块已有约定。历史接口可保留，不因无关需求批量补齐。
- 对外 Controller/Open API 使用 `com.udun.common.Result<T>` 和 `Result.ok(...)` 等现有工厂方法；无数据使用模块既有 `Result<Void>` 或 `Result<?>`，业务对象内不再嵌套通用成功/错误包装。
- 内部 Feign/RPC 通常直接返回 DTO、VO、`List<T>`、`PageData<T>`、基础包装类型或 `void`；RPC Controller 与 Feign 签名完全一致。历史 `Result<T>` 契约可保留，新接口不沿用。
- 集合无结果返回空集合；单对象缺失按既有契约返回空或抛业务异常；边界契约不用 `Optional`。
- `boolean/Boolean` 只表达稳定真假，失败抛业务异常；若需 ID、状态、原因或扩展字段则定义 Response。内部无返回命令可用 `void`，不创建仅含 `success` 的空壳。
- 分页复用项目结构。状态/类型字段遵循枚举规则，返回中不混用枚举名、code 和描述。
- `Serializable`、字段类型、必填/默认值、JSON 名称、空值和返回类型均属兼容契约；变更时同步检查 Feign、Controller、调用方、映射和契约测试。
- 金额用 `BigDecimal`；可空包装类型使用 `Boolean.TRUE.equals(value)`、`CONSTANT.equals(value)` 等空安全比较。工具库只在模块已有依赖时沿用。

接口形态示例：

```java
// 对外 Controller
public Result<MarketplacePayApplyResponse> createSwapOrder(
        @Valid @RequestBody SwapOrderApplyRequest swapOrderApplyRequest) {
    return Result.ok(swapOrderService.createSwapOrder(swapOrderApplyRequest));
}

// 内部 Feign/RPC
MarketplacePayApplyResponse createSwapOrder(
        @RequestBody SwapOrderApplyRequest swapOrderApplyRequest);
```

## 实现、持久化与事务

- 优先守卫式返回；方法保持单一职责，私有方法表达领域意图，中间变量说明业务含义，不使用 `temp/obj/result1`。
- 链式查询、builder 和转换保持单向且无隐藏副作用；不吞异常，也不把异常当正常分支。
- 沿用现有 Mapper、Service、Query/Update Wrapper 和事务边界；多次相关写操作常用 `@Transactional(rollbackFor = Exception.class)`，以目标模块为准。
- 风格修改不得改变并发、幂等、事务、重试、查询条件、`limit`、锁、唯一键或异常捕获语义。Java 字段改名时同步检查 SQL、数据库和 MapStruct 映射。

## 异常、日志与注释

- 可预期失败使用目标模块统一业务异常。UBS 优先复用领域错误码并抛 `new CommonException(PayErrorCode.P0033)`；新增错误码时同步 i18n，动态参数使用现有构造器，不拼接单语言文案。
- 新增或修改的业务异常不用 `IllegalStateException`、`IllegalArgumentException` 或裸 `RuntimeException`，也不把下游统一异常包成它们；跨服务时保留错误码和参数。JDK 运行时异常仅可表示纯进程内不变量且模块已有同类处理。
- 历史异常可保留；下游返回错误对象时按模块既有适配转换为统一业务异常。
- 使用 `@Slf4j` 参数化日志。新增或修改字段统一写 `name[{}]`，如 `log.info("处理完成, id[{}], name[{}]", id, name)`，不用 `name={}`、字符串拼接、`System.out` 或 `printStackTrace()`。
- 占位符与参数数量、顺序一致；异常对象放最后。记录必要业务标识，但不输出密码、token、密钥、完整凭证或无关敏感载荷；语言跟随模块。
- 注释解释原因、协议、状态转换和风险，不复述代码。公开契约、复杂状态机和关键不变量使用 Javadoc；行为变化同步更新注释，不留无上下文 TODO。

## 测试与交付

- 新测试以目标模块为准；UBS 通常使用 JUnit 5、Mockito、AssertJ，测试类为 `{ClassUnderTest}Test`，近期方法常用 `should...`。
- 每个测试覆盖一个可观察行为或契约，不断言私有实现；缺陷修复增加回归测试。
- 先运行最小相关模块测试，公共类型或跨模块契约变化再用 `-pl ... -am` 扩大范围。
- 提交前重点确认：文件/目录命名与存放位置；完整领域变量名；新有限值枚举及大写枚举项；Bean Validation；OpenAPI 文档；starter 复用；Controller/Feign 返回边界；统一异常与 `name[{}]` 日志；兼容性、事务、测试和无噪声 diff。
