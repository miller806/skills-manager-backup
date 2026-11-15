# udun-starter-parent 复用指南

`G:\code\coding\udun-starter-parent` 是 Udun 的 Spring Boot Starter 集合；2.x 使用 Spring Boot 3、Jakarta 和 Java 17+。本页仅作检索索引，目标模块 POM、实际依赖版本和 starter 当前源码优先。

## 决策规则

1. 先查业务模块 POM、父 POM 和同类用法，确认兼容版本及已可用依赖；源码仓库存在某个类不等于业务模块可直接使用。
2. 再查对应 starter 的文档、POM、公开 API、测试/demo；冲突时以目标项目实际依赖版本的源码和行为为准。
3. 复用语义匹配的公开类型、Bean、注解、模板或自动配置，不复制源码或再造近义工具；优先最小叶子 starter，避免为单个工具引入聚合模块或重复声明传递依赖。
4. 使用前核对空值、异常、序列化、线程安全、事务和协议语义；不完全匹配时不硬套。只认目标项目可取得的已提交版本，未提交代码、demo 草稿和设计文档不算已发布契约。
5. 缺失能力若有跨服务价值，提示用户评估沉淀；未经授权不修改或发布 starter。领域专属规则留在业务项目。

## 能力索引

| 场景 | 优先检查 |
| --- | --- |
| 响应、异常、断言 | `udun-starter-common`：`Result<T>`、`ErrMsg`、`CommonException`、`BaseException`、`BaseDataException`、`UdunAssert`。业务异常使用 `Code` 重载，不新增已废弃的字符串重载；对外 Controller 用 `Result<T>`，内部 Feign/RPC 直接返回业务类型。 |
| Web、校验、i18n、分页 | `udun-starter-web-base`、`web-core`、`web-i18n`；分页看 `PageData<T>`，转换工具和基础 CRUD/MapStruct 看 `web-assembly`。仅在模块已有同类模式时套基础类。 |
| 文档、日志、限流、幂等、验签 | `web-doc-openapi`（`udun.doc.enabled`，默认 `false`）；`web-log` / `web-logback`；`web-limiter` 的 `@Limiter`；`web-idempotence` 的 `@Idempotence`；`web-sign` 的 `@Sign` / `SignService`。 |
| Web 辅助能力 | `web-captcha`、`web-oss`、`web-jwt`、`web-token`、`web-device-trust`、`web-ip`、`web-leaf`。Token 能力使用前特别确认当前分支和依赖版本。 |
| RPC / 微服务 | `cloud-rpc-core` 的 `@RpcApi/@OpenRpcApi`；异常、上下文、开放 RPC 分别看 `cloud-rpc-exception`、`cloud-rpc-request`、`cloud-rpc-open`；灰度和网关认证看 `cloud-nacos-gray`、`cloud-gateway-auth`。自建 Feign 拦截器或 `ErrorDecoder` 前先查这些模块。 |
| 数据与缓存 | `data-mybatis`（MyBatis-Plus、Druid、PageHelper、ID）、`data-redis`（`RedisService`/Redisson）、`data-mongodb`、`data-clickhouse`、`springboot-cache`、`cache-jetcache`。 |
| 消息、并发、任务 | `mq-kafka`、`mq-zeromq`；`concurrent-simple-tp`、`concurrent-dynamic-tp-*`；`job-xxl-executor`、`job-elastic`。 |
| 安全 | `safe-openapi`、`safe-password`、`safe-jasypt`、`safe-encrypt-field`、`safe-vault`，不在业务项目重复实现同类安全基础设施。 |
| 通知 | `notice-email`、`sms`、`webhook`、`lark`、`tg`、`google`、`gorush`、`jpush`。 |
| 文件、网络及其他 | Excel 用 `document-excel` 的 `ExcelUtil/ExcelResult`；IP 底层用 `ip-core/ip2region/geoip2`；Netty 用 `netty-core` 及 `heron/owl`；币价、汇率、TRON 资源用 `bt-coin-price/bt-fiat-price/bt-tronresource`。 |

Feign 与 RPC Controller 的参数、返回类型、状态码和异常协议必须一致；复用统一异常通道，不让每个调用方重复解析错误。

## 缺失封装提示

说明五项即可：现有 starter 的具体缺口；建议归属模块；不夹带业务规则的最小 API；依赖、配置、兼容与验证影响；本次先留在业务项目还是等待确认后沉淀。不要只说“建议封装一下”。
