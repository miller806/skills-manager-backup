---
name: kotlin-rules
description: Kotlin/Android专项安全规则 — if:kotlin 时加载
config:
  progression:
    phase: "2A/2B/2C"
    name: "Kotlin Security Rules"
    prev: "Phase 1 Reconnaissance"
    next: "Phase 3 Static Verification"
    trigger: "build.gradle.kts or *.kt detected"
    when: "if: kotlin"
---

# Kotlin/Android Security Rules

**Phase**: 2A/2B/2C (Parallel Audit Tracks)
**Previous**: Phase 1 Reconnaissance
**Next**: Phase 3 Static Verification
**Trigger**: `if: kotlin` 检测到 build.gradle.kts 或 *.kt 文件时加载

Kotlin/Android专项安全规则。增强对Kotlin生态和Android应用中常见漏洞模式的检测能力。

## 技术栈指纹

指纹文件：`build.gradle.kts`、`build.gradle`、`settings.gradle.kts`、`AndroidManifest.xml`

## SQL注入检测（Android）

**目标：** 发现 SQL 注入漏洞

检测模式（Grep）：
```
SQLiteOpenHelper
db\.rawQuery
db\.execSQL
Cursor\.execute
ContentResolver\.query
```

**Room Database:**
```kotlin
// 安全：参数化查询
@Dao
interface UserDao {
    @Query("SELECT * FROM users WHERE id = :id")
    fun getUserById(id: Int): User
}

// 危险：字符串拼接
db.rawQuery("SELECT * FROM users WHERE id = " + userId, null)
```

---

## 命令注入检测

**目标：** 发现命令执行漏洞

检测模式（Grep）：
```
Runtime\.exec
ProcessBuilder
java\.lang\.Runtime
System\.exec
```

**分析规则：**
- `Runtime.getRuntime().exec()` 参数来自用户输入 → 命令注入
- Android 应避免使用 `Runtime.exec()`

---

## 反序列化检测

**目标：** 发现反序列化漏洞

检测模式（Grep）：
```
ObjectInputStream
XMLDecoder
JSON\.parseObject
Kryo
fastjson
gson\.fromJson
jackson\.ObjectMapper
ObjectMapper\(\)\.readValue
```

**分析规则：**
- `ObjectInputStream.readObject()` → 反序列化RCE
- FastJSON/Gson/Jackson 反序列化用户输入 → 风险

---

## XSS检测

**目标：** 发现跨站脚本漏洞

检测模式（Grep）：
```
webView\.loadDataWithBaseURL
webView\.loadUrl
evaluateJavascript
WebView\.settings
```

**WebView安全配置:**
```kotlin
// 危险：默认配置
WebViewSettings.javaScriptEnabled = true

// 安全：禁用JavaScript（除非必要）
WebViewSettings.javaScriptEnabled = false
WebViewSettings.domStorageEnabled = false
```

---

## Intent劫持检测

**目标：** 发现Activity/Service越权访问

检测模式（Grep）：
```
Intent\(context
startActivity
startService
bindService
getComponentName
getPackageName
```

**分析规则：**
- `Intent` 显式组件名可能引入安全风险
- 检查 `Intent.setComponent()` 使用

---

## 文件操作检测

**目标：** 发现文件操作漏洞

检测模式（Grep）：
```
openFileInput
openFileOutput
FileInputStream
FileOutputStream
getExternalFilesDir
getCacheDir
File\(.*userInput
```

**分析规则：**
- 用户输入进入文件路径 → 路径遍历
- 检查 `FileInputStream` 使用

---

## 敏感数据存储检测

**目标：** 发现敏感信息本地泄露

检测模式（Grep）：
```
SharedPreferences
getSharedPreferences
edit\.putString
Preferences\.put
File\.writeText
File\.writeBytes
```

**安全建议:**
```kotlin
// 危险：明文存储敏感信息
prefs.edit().putString("token", authToken).apply()

// 安全：使用加密SharedPreferences
val encryptedPrefs = EncryptedSharedPreferences.create(context, ...)
```

**EncryptedSharedPreferences:**
```kotlin
val masterKey = MasterKey.Builder(context)
    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
    .build()
val encryptedPrefs = EncryptedSharedPreferences.create(
    context,
    "secure_prefs",
    masterKey,
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
)
```

---

## 网络安全检测

**目标：** 发现网络安全配置缺陷

检测模式（Grep）：
```
usesCleartextTraffic
android:usesCleartextTraffic
networkSecurityConfig
NetworkSecurityPolicy
```

**分析规则：**
- `android:usesCleartextTraffic="true"` → 明文流量风险
- 应配置网络安全策略强制HTTPS

---

## 权限检测

**目标：** 发现权限配置缺陷

检测模式（Grep）：
```
@RequiresPermission
@UsesPermission
Manifest\.permission
checkSelfPermission
requestPermissions
```

**分析规则：**
- 敏感权限检查是否完整
- 运行时权限申请是否正确处理

---

## Deep Link检测

**目标：** 发现Deep Link安全漏洞

检测模式（Grep）：
```
intent-filter
android:scheme
android:host
data-filter
```

**分析规则：**
- Deep Link 是否有验证
- 是否限制可跳转的协议和域名

---

## WebView JavaScript接口检测

**目标：** 发现JavaScript接口暴露风险

检测模式（Grep）：
```
addJavascriptInterface
JavascriptInterface
WebView\.addJavascriptInterface
```

**分析规则：**
- `addJavascriptInterface` 暴露的接口是否可信
- Android 4.2 以下使用 `addJavascriptInterface` → RCE风险

---

## 加密相关检测

**目标：** 发现加密实现缺陷

检测模式（Grep）：
```
Cipher
KeyGenerator
SecretKey
AES\.ECB
DES\.ECB
Base64\.encode
```

**分析规则：**
- 使用 ECB 模式 → 加密不安全
- 密钥硬编码 → Critical
- 应使用 AES-GCM 等安全模式

---

## Kotlin Multiplatform (KMP) 检测

### 平台间数据传递

检测模式（Grep）：
```
expect\s+
actual\s+
@SharedImmutable
@ThreadLocal
```

### C Interop检测

检测模式（Grep）：
```
extern\s+
@JvmName
@JvmField
```

---

## Spring Boot with Kotlin检测

检测模式（Grep）：
```
@RestController
@GetMapping
@PostMapping
@RequestMapping
@GetMapping
@PutMapping
@DeleteMapping
```

---

## 数据库加密检测

**目标：** 发现数据库加密缺陷

检测模式（Grep）：
```
SQLCipher
android\.database\.sqlite
SQLiteDatabase\.openDatabase
realm\.executeTransaction
```

**分析规则：**
- 数据库文件是否加密
- SQLCipher 是否正确使用

---

## 污染追踪规则（Kotlin特定）

### 变量污染状态判断

| 来源类型 | 标记 | 风险级别 |
|---------|------|---------|
| `Intent.getStringExtra()` | TAINTED-用户输入 | 高 |
| `Bundle.getString()` | TAINTED-用户输入 | 高 |
| `SharedPreferences.getString()` | TAINTED-用户输入 | 中 |
| `savedInstanceState` | TAINTED-用户输入 | 高 |
| URL参数 | TAINTED-用户输入 | 高 |
| 数据库查询结果 | TAINTED-数据库 | 中 |
| 文件读取 | TAINTED-文件 | 中 |
| 硬编码常量 | CLEAN | 低 |

### 净化函数识别

| 净化函数 | 能防御 | 说明 |
|---------|--------|------|
| `URLEncoder.encode()` | URL注入 | 编码URL组件 |
| `Html.fromHtml()` | XSS | HTML转义（需配合过滤） |
| `TextUtils.isEmpty()` | 空值检查 | 基础验证 |
| `Base64.encodeToString()` | 数据泄露 | 编码非加密 |

### 追踪终止条件

- 追踪到 Room `@Query` 参数化 → SQL注入净化成功
- 追踪到 `Html.fromHtml()` + 内容过滤 → XSS净化成功
- 追踪超过7层 → 标记为 UNCONFIRMED

---

## 已知高危版本清单

| 库 | 高危版本 | 风险 | CVE |
|------|---------|------|------|
| OkHttp < 4.9.0 | SSRF/重定向 | CVE-2020-11097 | SSRF |
| Retrofit < 2.9.0 | SSRF | 已知 | SSRF |
| FastJSON < 1.2.83 | 反序列化RCE | CVE-2022-25845 | RCE |
| Gson < 2.8.9 | 反序列化RCE | CVE-2021-30545 | RCE |

---

## ProGuard/R8配置检测

**目标：** 发现代码混淆配置缺陷

检测模式（Grep）：
```
-keepattributes
-keepclassmembers
-keepclassmembers
-dontwarn
```

**分析规则：**
- 敏感类是否被混淆（安全依赖混淆，但凭证类不应混淆）
- `-dontwarn` 可能隐藏问题