---
name: sink-libraries
description: 危险Sink函数库 — if:java/if:python/if:nodejs/if:golang/if:frontend 时加载
config:
  progression:
    phase: "2A"
    name: "Sink Libraries"
    prev: "Phase 1"
    next: "taint analysis"
    when: "Phase 2A Sink-Driven Audit"
---

# Sink Libraries

**Phase**: 2A (Sink-Driven Audit)  
**Previous**: Phase 1 Reconnaissance  
**Next**: 污染追踪分析  
**When**: Phase 2A启动时按需加载

**⚠️ 重要提示**: Sink库仅标识**潜在**危险函数。**实际风险评估**需要结合Phase 3的可达性验证：
- 检查Sink方法是否被调用（死代码中的Sink无风险）
- 分析参数来源（用户可控 vs 系统生成 vs 配置值）
- 验证访问路径（公开API vs 管理后台 vs 内部服务）
- 确认权限要求（匿名/登录用户/管理员）

各语言危险 Sink 函数库。用于 Sink-Driven 审计阶段的污染追踪。

## Grep 模式速查表

| 语言 | Sink类别 | Grep模式 |
|------|---------|---------|
| Java | SQL注入 | `executeQuery\|executeUpdate\|createStatement\|prepareStatement` |
| Java | 命令注入 | `Runtime\.getRuntime\|ProcessBuilder\|GroovyShell` |
| Java | XSS | `getWriter\(\)\|print\|write\|out\.\(print\|write\)` |
| Java | 反序列化 | `ObjectInputStream\|XMLDecoder\|XStream\|readValue\|JSON\.parse` |
| Java | 文件操作 | `FileInputStream\|FileOutputStream\|new File\(\|RandomAccessFile` |
| Java | SSRF | `HttpClient\|OkHttpClient\|URLConnection\|RestTemplate\|WebClient` |
| Python | 命令注入 | `os\.system\|os\.popen\|subprocess\|eval\|exec\|compile` |
| Python | SQL注入 | `cursor\.execute\|connection\.execute\|Session\.execute` |
| Python | 反序列化 | `pickle\.load\|yaml\.load\|marshal\.load` |
| Python | 模板注入 | `render_template_string\|Template\(.*user` |
| Node.js | 命令注入 | `child_process\|exec\|eval\|new Function\|vm\.` |
| Node.js | SQL注入 | `connection\.query\|pool\.query\|mongoose\.find` |
| Node.js | 原型污染 | `merge\|clone\|JSON\.parse\|__proto__\|constructor\.prototype` |
| Go | SQL注入 | `db\.Query\|db\.QueryRow\|db\.Exec` |
| Go | 命令注入 | `exec\.Command\|os/exec\|syscall\.Exec` |
| Go | 模板注入 | `html/template\|text/template\.Execute` |
| 前端 | DOM-XSS | `innerHTML\|outerHTML\|insertAdjacentHTML\|document\.write` |
| 前端 | 命令执行 | `eval\|new Function\|setTimeout\|setInterval` |
| 前端 | URL跳转 | `location\.href\|location\.replace\|location\.assign\|window\.open` |
| PHP | SQL注入 | `DB::select\|DB::insert\|DB::statement\|query\|execute\|raw\|selectRaw` |
| PHP | 命令注入 | `exec\|shell_exec\|system\|passthru\|popen\|proc_open\|eval\|create_function` |
| PHP | 反序列化 | `unserialize\|session_decode\|var_export\|var_dump` |
| PHP | 文件操作 | `include\|require\|file_get_contents\|fopen\|readfile` |
| PHP | SSRF | `file_get_contents\|curl_init\|guzzle\|Http:` |
| C# | SQL注入 | `SqlCommand\|ExecuteSqlRaw\|FromSqlRaw\|ExecuteNonQuery` |
| C# | 命令注入 | `Process\.Start\|ProcessStartInfo` |
| C# | 反序列化 | `JavaScriptSerializer\|JsonConvert\.DeserializeObject\|BinaryFormatter` |
| C# | XSS | `Response\.Write\|Html\.Raw` |
| Rust | 命令注入 | `Command::new\|Command::arg\|Command::args\|spawn\|execute` |
| Rust | 反序列化 | `serde::de::Deserialize\|serde_json::from_str\|bincode::deserialize` |
| Rust | SSRF | `reqwest::get\|reqwest::Client\|ureq::get` |
| Rust | 文件操作 | `std::fs::read\|std::fs::write\|fs::read_to_string\|fs::write` |
| Kotlin | SQL注入 | `db\.rawQuery\|db\.execSQL\|ContentResolver\.query` |
| Kotlin | 命令注入 | `Runtime\.exec\|ProcessBuilder\|System\.exec` |
| Kotlin | 反序列化 | `ObjectInputStream\|JSON\.parseObject\|fastjson\|gson\.fromJson` |
| Kotlin | WebView | `loadUrl\|loadDataWithBaseURL\|evaluateJavascript\|addJavascriptInterface` |

## Java Sink库

### SQL注入危险 Sink
```
executeQuery(String sql)
executeUpdate(String sql)
execute(String sql)
createStatement().executeQuery(sql)
prepareStatement(sql)
Statement.execute(sql)
JDBC execute/ executeQuery/ executeUpdate
MyBatis selectList/selectOne/selectMap (当SQL含 ${} 时)
```

### 命令注入危险 Sink
```
Runtime.getRuntime().exec()
ProcessBuilder()
java.lang.ProcessBuilder
Groovy: GroovyShell().evaluate() (含用户输入时)
```

### 文件操作危险 Sink
```
FileInputStream/
FileOutputStream/
FileReader/
FileWriter/
new File()
RandomAccessFile()
Files.copy()
Files.move()
```

### 反射危险 Sink
```
Class.forName()
.getMethod()
.invoke()
Method.invoke()
Constructor.newInstance()
```

### XSS危险 Sink
```
ServletResponse.getWriter().write()
response.getWriter().print()
out.write()
out.print()
```

### 反序列化危险 Sink
```
ObjectInputStream.readObject()
XMLDecoder.readObject()
XStream.fromXML()
Jackson: ObjectMapper.readValue() (含外部输入)
FastJSON: JSON.parse()
```

### SSpEL注入危险 Sink
```
@Value("#{...}")
SpelExpressionParser
ExpressionParser.parseExpression()
```

## Python Sink库

### SQL注入危险 Sink
```
cursor.execute(sql)
cursor.executescript()
cursor.executemany()
connection.execute()
```

### 命令注入危险 Sink
```
os.system()
os.popen()
subprocess.Popen()
subprocess.call()
subprocess.run() (shell=True)
commands.getoutput()
commands.getstatusoutput()
eval()
exec()
```

### 文件操作危险 Sink
```
open()
file()
io.open()
codecs.open()
 shutil.copy()
shutil.move()
```

### XSS危险 Sink
```
django.http: HttpResponse() 含未转义用户输入
flask: render_template_string()
jinja2: Template() 含未转义用户输入
markupsafe: Markup() 不当使用
```

### 反序列化危险 Sink
```
pickle.load()
pickle.loads()
pickle.Unpickler
yaml.load() (不含 Loader)
marshal.load()
```

### 模板注入危险 Sink
```
django: render_template_string()
flask: render_template_string()
jinja2: Template() 含用户输入
```

## Node.js Sink库

### SQL注入危险 Sink
```
connection.query()
connection.execute()
pool.query()
pool.execute()
mongoose: Model.find() 含原生查询
Sequelize: sequelize.query() 含原生SQL
```

### 命令注入危险 Sink
```
child_process.exec()
child_process.execSync()
child_process.spawn()
child_process.spawnSync()
child_process.execFile()
eval()
new Function()
vm.runInContext()
vm.runInShell()
```

### 文件操作危险 Sink
```
fs.readFile()
fs.readFileSync()
fs.writeFile()
fs.writeFileSync()
fs.appendFile()
fs.appendFileSync()
fs.mkdir()
fs.rmdir()
fs.unlink()
```

### XSS危险 Sink
```
document.write()
document.writeln()
element.innerHTML
element.outerHTML
jQuery: .html()
jQuery: .append()
Vue: v-html
React: dangerouslySetInnerHTML
Angular: bypassSecurityTrustHtml
```

### 原型污染危险 Sink
```
merge()
clone()
deepcopy()
JSON.parse() (配合特殊键名)
lodash: _.merge()
lodash: _.cloneDeep()
```

### ReDoS危险 Sink
```
new RegExp() 含用户输入
Regexp() 构造函数含用户输入
```

## Go Sink库

### SQL注入危险 Sink
```
db.Query()
db.QueryRow()
db.Exec()
db.QueryContext()
rows.Next()
```

### 命令注入危险 Sink
```
os/exec: Command()
exec.Command()
exec.CommandContext()
shell: /bin/bash -c
syscall.Exec()
```

### 文件操作危险 Sink
```
os.Open()
os.Create()
os.ReadFile()
os.WriteFile()
ioutil.ReadFile()
ioutil.WriteFile()
io.Copy()
```

### 反射危险 Sink
```
reflect.ValueOf() 含用户输入
reflect.New()
reflect.MakeFunc()
```

### 模板注入危险 Sink
```
html/template: Template.Execute() 含用户输入
text/template: Template.Execute() 含用户输入
```

## 前端 Sink库

### DOM-XSS危险 Sink
```javascript
document.write()
document.writeln()
element.innerHTML
element.outerHTML
insertAdjacentHTML()
jQuery: .html()
jQuery: .append()
jQuery: .prepend()
jQuery: .after()
jQuery: .before()
Vue: v-html 指令
React: dangerouslySetInnerHTML
Angular: $sce.trustAsHtml()
Angular: bypassSecurityTrustHtml()
```

### 前端命令执行危险 Sink
```javascript
eval()
new Function()
setTimeout(userInput)
setInterval(userInput)
setImmediate()
execScript()
Function() 构造函数
```

### URL跳转危险 Sink
```javascript
window.location.href = userInput
location.href = userInput
location.replace(userInput)
location.assign(userInput)
window.open(userUrl)
history.pushState(userInput)
history.replaceState(userInput)
meta refresh: <meta http-equiv="refresh" content="0;url=userInput">
<a href="userInput">
```

## 框架特定 Sink

### MyBatis XML中的危险模式
```
${param}
${_parameter}
${obj.field}
${${innerParam}}
```

### Spring SpEL危险模式
```
@Value("#{expression}")
T(java.lang.Runtime)
T(java.lang.ProcessBuilder)
#this
```

### GraphQL危险模式
```
DataFetcher
getField().getName()
resolver 含用户参数
```

### Django ORM危险模式
```
Model.objects.raw()
Model.objects.extra()
QuerySet.extra()
```

### Flask危险模式
```
render_template_string()
render_template() (路径可控时)
```

## PHP Sink库

### SQL注入危险 Sink
```
DB::select()
DB::insert()
DB::statement()
DB::update()
DB::delete()
query()
execute()
raw()
selectRaw()
```

### 命令注入危险 Sink
```
exec()
shell_exec()
system()
passthru()
popen()
proc_open()
eval()
create_function()
` (反引号)
```

### 反序列化危险 Sink
```
unserialize()
session_decode()
var_export()
var_dump()
print_r()
```

### 文件操作危险 Sink
```
include()
include_once()
require()
require_once()
file_get_contents()
fopen()
readfile()
file()
glob()
```

## C# Sink库

### SQL注入危险 Sink
```
SqlCommand.ExecuteNonQuery()
SqlCommand.ExecuteReader()
SqlCommand.ExecuteScalar()
FromSqlRaw()
ExecuteSqlRaw()
Database.ExecuteSqlRaw()
```

### 命令注入危险 Sink
```
Process.Start()
ProcessStartInfo
Shell()
```

### 反序列化危险 Sink
```
JavaScriptSerializer.Deserialize()
JsonConvert.DeserializeObject()
Newtonsoft.Json.JsonSerializer
DataContractSerializer.ReadObject()
XmlSerializer.Deserialize()
BinaryFormatter.Deserialize()
```

### XSS危险 Sink
```
Response.Write()
Html.Raw()
@Html.Raw()
```

## Rust Sink库

### 命令注入危险 Sink
```
std::process::Command::new()
Command::arg()
Command::args()
std::process::Command::spawn()
```

### 反序列化危险 Sink
```
serde::de::Deserialize
serde_json::from_str()
bincode::deserialize()
ron::from_str()
```

### 文件操作危险 Sink
```
std::fs::read()
std::fs::write()
std::fs::File::open()
fs::read_to_string()
fs::write()
```

### SSRF危险 Sink
```
reqwest::get()
reqwest::Client::new()
ureq::get()
surf::client()
```

## Kotlin/Android Sink库

### SQL注入危险 Sink (Android)
```
SQLiteOpenHelper.rawQuery()
db.rawQuery()
db.execSQL()
ContentResolver.query()
Cursor.execute()
```

### 命令注入危险 Sink
```
Runtime.getRuntime().exec()
ProcessBuilder()
System.exec()
```

### 反序列化危险 Sink
```
ObjectInputStream.readObject()
XMLDecoder.readObject()
JSON.parseObject()
FastJSON.parse()
Gson.fromJson()
Jackson.ObjectMapper.readValue()
```

### WebView危险 Sink
```
WebView.loadUrl()
WebView.loadDataWithBaseURL()
WebView.evaluateJavascript()
addJavascriptInterface()
```

---

## 风险评估与上下文分析指南

### 常见误报场景与修正

#### 场景 1: 死代码中的 Sink
```java
// 发现 SQL 注入 Sink
public void dangerousMethod(String userInput) {
    stmt.execute("SELECT * FROM users WHERE id = '" + userInput + "'");
}

// 分析: dangerousMethod 未被任何代码调用
// 结论: DEAD_CODE - 不报告
```

#### 场景 2: 配置值 vs 用户输入
```java
@Value("${api.endpoint}")
private String endpoint;

public void callApi() {
    HttpUtils.post(endpoint, data);  // SSRF Sink
}

// 分析: endpoint 来自配置文件，非用户可控
// 结论: 信息级 (安全债务) - 非可远程利用的 SSRF
```

#### 场景 3: 内部调用链 vs 公开接口
```java
// Feign 客户端 (内部服务调用)
@FeignClient("internal-service")
public interface InternalService {
    @PostMapping("/process")
    void process(@RequestBody Data data);
}

// 对比: 公开 Controller
@RestController
public class PublicApi {
    @PostMapping("/public/process")
    public void process(@RequestBody String userInput) {
        // 同样调用 Sink
    }
}

// 分析: Feign 调用需先通过鉴权，且通常有网络隔离
// 结论: 根据入口点的公开性调整风险等级
```

#### 场景 4: 权限层级影响
```java
// 管理后台接口 (需 ADMIN 角色)
@PreAuthorize("hasRole('ADMIN')")
@PostMapping("/admin/create-table")
public void createTable(@RequestBody String tableName) {
    dbUtils.createTable(tableName);  // SQL 注入点
}

// 分析: 需管理员权限才能触发
// 结论: CRITICAL → HIGH (仍需修复，但利用难度增加)
```

### 风险等级动态调整矩阵

| Sink 严重程度 | 可达性 | 可控性 | 访问控制 | 最终等级 |
|--------------|--------|--------|---------|---------|
| CRITICAL | 已调用 | 用户输入 | 公开 | CRITICAL |
| CRITICAL | 已调用 | 用户输入 | 需登录 | HIGH |
| CRITICAL | 已调用 | 用户输入 | 需管理员 | MEDIUM |
| CRITICAL | 已调用 | 内部传递 | 公开 | MEDIUM |
| CRITICAL | 未调用 | - | - | 不报告 |
| HIGH | 已调用 | 配置值 | - | LOW |

### 分析检查清单

**每个 Sink 发现必须回答**:
- [ ] 该方法是否被实际调用？ (Grep 验证)
- [ ] 危险参数从哪里来？ (用户输入/配置/系统生成)
- [ ] 谁能触发这个代码路径？ (公开/登录/管理员)
- [ ] 是否需要其他前提条件？ (特定业务状态/网络位置)

---

## 基础设施暴露 Sink **[NEW]**

### SpringBoot Actuator 暴露
```
/actuator/env
/actuator/heapdump
/actuator/beans
/actuator/configprops
/actuator/loggers
/actuator/mappings
```

### Swagger/API 文档暴露
```
/v2/api-docs
/v3/api-docs
/swagger-ui.html
/swagger-resources
```

### 中间件暴露
```
/druid/index.html
/nacos/index.html
/admin/instances/
/actuator/
```

### JWT 无过期时间 Sink
```
Jwts.builder().setSubject(...).signWith(...).compact()  // 无 .setExpiration()
JwtBuilder.sign(...).compact()  // 无 .exp()
```

### 验证码不失效 Sink
```
session.getAttribute("code")  // 校验后未删除
redisTemplate.opsForValue().get("code:" + phone)  // 校验后未 delete
```

### 注销不失效 Sink
```
/logout  // 仅返回 200，未清理 Session/Token
redisTemplate.delete("user:session:" + userId)  // 未加入黑名单
```