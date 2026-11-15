/**
 * Remediation Templates
 *
 * Context-aware remediation code generation based on vulnerability type
 * and technology stack. Uses pattern matching instead of LLM generation.
 */

class RemediationTemplates {
  constructor() {
    // Template library organized by language and vulnerability type
    this.templates = {
      java: this.initJavaTemplates(),
      python: this.initPythonTemplates(),
      nodejs: this.initNodeTemplates(),
      golang: this.initGoTemplates(),
      vue: this.initVueTemplates(),
      react: this.initReactTemplates(),
      angular: this.initAngularTemplates()
    };
  }

  /**
   * Initialize Java remediation templates
   */
  initJavaTemplates() {
    return {
      sql_injection: {
        name: 'SQL Injection',
        patterns: [
          {
            id: 'mybatis_dollar',
            detect: /\$\{([^}]+)\}/,
            name: 'MyBatis ${} interpolation',
            description: '将 MyBatis ${} 替换为 #{} 参数化查询',
            before: (match) => `SELECT * FROM users WHERE id = ${match[0]}`,
            after: (match) => `SELECT * FROM users WHERE id = #{${match[1]}}`,
            explanation: '${} 直接拼接SQL文本，#{} 使用预编译语句参数，自动转义特殊字符',
            code: (match) => ({
              before: `SELECT * FROM users WHERE id = \${${match[1]}}`,
              after: `SELECT * FROM users WHERE id = #{${match[1]}}`
            })
          },
          {
            id: 'string_concat',
            detect: /"[^"]*"\s*\+\s*\w+/, // 检测字符串拼接模式
            name: 'String concatenation',
            description: '使用 PreparedStatement 替代字符串拼接',
            code: () => ({
              before: `String sql = "SELECT * FROM users WHERE id = " + userId;
Statement stmt = connection.createStatement();
ResultSet rs = stmt.executeQuery(sql);`,
              after: `String sql = "SELECT * FROM users WHERE id = ?";
PreparedStatement stmt = connection.prepareStatement(sql);
stmt.setLong(1, userId);
ResultSet rs = stmt.executeQuery();`
            }),
            explanation: '使用 ? 占位符和参数绑定，防止SQL注入攻击',
            imports: ['java.sql.PreparedStatement']
          },
          {
            id: 'string_format',
            detect: /String\.format\s*\(\s*"[^"]*%s/,
            name: 'String.format SQL',
            description: '将 String.format 替换为参数化查询',
            code: () => ({
              before: `String sql = String.format("SELECT * FROM users WHERE name = '%s'", userName);
stmt.executeQuery(sql);`,
              after: `String sql = "SELECT * FROM users WHERE name = ?";
PreparedStatement stmt = connection.prepareStatement(sql);
stmt.setString(1, userName);
stmt.executeQuery();`
            }),
            explanation: 'String.format 只是格式化字符串，不能防止注入',
            imports: ['java.sql.PreparedStatement']
          }
        ]
      },
      xss: {
        name: 'XSS (Cross-Site Scripting)',
        patterns: [
          {
            id: 'writer_print',
            detect: /getWriter\(\)\.(print|write)\s*\(/,
            name: 'ServletWriter output',
            description: '使用 HTML 转义函数处理输出',
            code: () => ({
              before: `response.getWriter().print(userInput);`,
              after: `response.getWriter().print(HtmlUtils.htmlEscape(userInput));`
            }),
            explanation: 'HtmlUtils.htmlEscape 将特殊字符转换为HTML实体，防止脚本执行',
            imports: ['org.springframework.web.util.HtmlUtils']
          },
          {
            id: 'model_attribute',
            detect: /model\.(addAttribute|put)\s*\([^,]+,\s*[^)]+\)/,
            name: 'Spring Model attribute',
            description: '在模板中自动转义 (Thymeleaf/Spring默认安全)',
            code: () => ({
              before: `model.addAttribute("content", userContent);
// In template: <div th:utext="${content}">`,
              after: `model.addAttribute("content", userContent);
// In template: <div th:text="${content}">  <!-- Use th:text not th:utext -->`
            }),
            explanation: 'th:text 自动HTML转义，th:utext 不转义 (危险)'
          },
          {
            id: 'json_response',
            detect: /@ResponseBody|ResponseEntity/,
            name: 'JSON response',
            description: '确保返回JSON时Content-Type正确',
            code: () => ({
              before: `return userInput;  // Direct string return`,
              after: `return ResponseEntity.ok()
    .contentType(MediaType.APPLICATION_JSON)
    .body(Map.of("data", userInput));`
            }),
            explanation: '返回JSON时设置正确的Content-Type，避免浏览器解释为HTML',
            imports: ['org.springframework.http.ResponseEntity', 'org.springframework.http.MediaType']
          }
        ]
      },
      hardcoded_secret: {
        name: 'Hardcoded Secret',
        patterns: [
          {
            id: 'static_field',
            detect: /private\s+static\s+final\s+String\s+\w*(KEY|SECRET|PASSWORD|TOKEN)\w*\s*=\s*["'][^"']+["']/i,
            name: 'Static secret field',
            description: '将硬编码密钥移至配置文件',
            code: (match) => {
              const fieldName = match[0].match(/\w+(KEY|SECRET|PASSWORD|TOKEN)\w*/i)[0];
              return {
                before: `private static final String ${fieldName} = "sk-1234567890abcdef";`,
                after: `@Value("${'${'}app.${fieldName.toLowerCase()}}")
private String ${fieldName.toLowerCase()};`,
                config: `app:
  ${fieldName.toLowerCase()}: \${${fieldName.toUpperCase()}:default_value}`
              };
            },
            explanation: '使用 @Value 从配置文件或环境变量注入，密钥不硬编码在代码中',
            imports: ['org.springframework.beans.factory.annotation.Value']
          },
          {
            id: 'application_yml',
            detect: /(api\.key|secret|password)\s*:\s*["'][^"']+["']/i,
            name: 'Plaintext in config',
            description: '使用环境变量或密钥管理服务',
            code: () => ({
              before: `api:
  key: sk-live-1234567890abcdef`,
              after: `api:
  key: \${API_KEY:}`  // 从环境变量读取`
            }),
            explanation: '使用 Spring 的 ${} 语法从环境变量读取，配置文件不存明文密钥'
          }
        ]
      },
      weak_crypto: {
        name: 'Weak Cryptography',
        patterns: [
          {
            id: 'aes_ecb',
            detect: /AES\/ECB|Cipher\.getInstance\s*\(\s*["']AES\/ECB/i,
            name: 'AES ECB mode',
            description: '使用 AES/GCM 替代 AES/ECB',
            code: () => ({
              before: `Cipher cipher = Cipher.getInstance("AES/ECB/PKCS5Padding");
cipher.init(Cipher.ENCRYPT_MODE, key);`,
              after: `Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, iv));
cipher.updateAAD(associatedData);`
            }),
            explanation: 'ECB模式不安全（相同明文→相同密文），GCM提供认证加密',
            imports: ['javax.crypto.Cipher', 'javax.crypto.spec.GCMParameterSpec']
          },
          {
            id: 'md5_sha1',
            detect: /MessageDigest\.getInstance\s*\(\s*["'](MD5|SHA1)["']/i,
            name: 'Weak hash algorithm',
            description: '使用 SHA-256 或更高',
            code: (match) => ({
              before: `MessageDigest md = MessageDigest.getInstance("${match[1]}");`,
              after: `MessageDigest md = MessageDigest.getInstance("SHA-256");`
            }),
            explanation: 'MD5和SHA-1已被破解，使用SHA-256或更强的哈希算法'
          }
        ]
      },

      jwt_no_expiry: {
        name: 'JWT No Expiration',
        patterns: [
          {
            id: 'jwt_builder_no_exp',
            detect: /Jwts\.builder\(\)(?!.*setExpiration)/,
            name: 'JWT builder without expiration',
            description: '为 JWT 令牌设置过期时间',
            code: () => ({
              before: `Jwts.builder()
    .setSubject(username)
    .signWith(key, SignatureAlgorithm.HS256)
    .compact();`,
              after: `Jwts.builder()
    .setSubject(username)
    .setIssuedAt(new Date())
    .setExpiration(new Date(System.currentTimeMillis() + 3600000)) // 1小时
    .signWith(key, SignatureAlgorithm.HS256)
    .compact();`
            }),
            explanation: 'JWT 无过期时间会导致令牌永久有效，一旦泄露可被长期利用',
            imports: ['java.util.Date', 'io.jsonwebtoken.Jwts']
          }
        ]
      },

      logout_no_invalidation: {
        name: 'Logout Token Invalidation',
        patterns: [
          {
            id: 'logout_no_blacklist',
            detect: /logout.*\{|@PostMapping.*logout/,
            name: 'Logout without token invalidation',
            description: '注销时将 Token 加入黑名单或更新版本号',
            code: () => ({
              before: `@PostMapping("/logout")
public Result logout() {
    return Result.success();
}`,
              after: `@PostMapping("/logout")
public Result logout(@RequestHeader("Authorization") String token,
                     HttpServletRequest request) {
    Long userId = SecurityUtils.getCurrentUserId();
    String blacklistKey = "token:blacklist:" + extractJti(token);
    long ttl = getRemainingTtl(token);
    redisTemplate.opsForValue().set(blacklistKey, "1", ttl, TimeUnit.SECONDS);
    // 或更新 Token 版本号
    redisTemplate.opsForValue().set("token:version:" + userId, System.currentTimeMillis());
    return Result.success();
}`
            }),
            explanation: '注销不清理 Token 会导致已注销会话仍可被利用',
            imports: ['java.util.concurrent.TimeUnit']
          }
        ]
      },

      idor: {
        name: 'Insecure Direct Object Reference (IDOR)',
        patterns: [
          {
            id: 'missing_owner_check',
            detect: /getById\(|selectById\(|findById\(|WHERE\s+id\s*=\s*#/,
            name: 'Missing ownership check',
            description: '增加数据归属权校验',
            code: () => ({
              before: `@Select("SELECT * FROM payee WHERE payee_id = #{payeeId}")
Payee getPayee(@Param("payeeId") Long payeeId);`,
              after: `@Select("SELECT * FROM payee WHERE payee_id = #{payeeId} AND merchant_id = #{merchantId}")
Payee getPayee(@Param("payeeId") Long payeeId, @Param("merchantId") Long merchantId);`
            }),
            explanation: '仅按 ID 查询会导致水平越权，必须增加用户/商户归属校验'
          }
        ]
      },

      negative_amount: {
        name: 'Negative Amount Validation',
        patterns: [
          {
            id: 'missing_positive_check',
            detect: /@RequestParam.*amount|@RequestParam.*sort|@RequestParam.*count/,
            name: 'Missing positive value validation',
            description: '对数值型参数增加范围校验',
            code: () => ({
              before: `public void setSort(@RequestParam Integer sort) {
    config.setSort(sort);
}`,
              after: `public void setSort(@RequestParam Integer sort) {
    if (sort == null || sort < 0) {
        throw new BusinessException("排序值必须为非负整数");
    }
    config.setSort(sort);
}

// 金额参数
@NotNull(message = "金额不能为空")
@DecimalMin(value = "0.01", message = "金额必须大于0")
@Digits(integer = 10, fraction = 2, message = "金额精度错误")
private BigDecimal amount;`
            }),
            explanation: '负数金额可绕过前端限制导致业务逻辑混乱',
            imports: ['javax.validation.constraints.DecimalMin']
          }
        ]
      },

      email_bombing: {
        name: 'Email/SMS Bombing Prevention',
        patterns: [
          {
            id: 'missing_email_validation',
            detect: /sendEmail|sendSms|sendCode|发送邮件/,
            name: 'Missing email validation and rate limiting',
            description: '增加邮箱 trim、去重、频率限制和归属权校验',
            code: () => ({
              before: `public void sendEmail(String email) {
    emailService.send(email);
}`,
              after: `public void sendEmail(String email) {
    // 1. 统一清理前后+中间所有空格
    email = email.trim().replaceAll("\\\\s+", "").toLowerCase();
    // 2. 格式校验
    if (!Pattern.matches("^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$", email)) {
        throw new BusinessException("邮箱格式错误");
    }
    // 3. 频率限制
    String rateKey = "email:rate:" + email;
    Long count = redisTemplate.opsForValue().increment(rateKey);
    if (count == 1) redisTemplate.expire(rateKey, 1, TimeUnit.HOURS);
    if (count > 5) throw new BusinessException("发送过于频繁");
    emailService.send(email);
}`
            }),
            explanation: '邮箱轰炸可占满邮件通道，空格绕过可突破格式校验',
            imports: ['java.util.regex.Pattern']
          }
        ]
      }
    };
  }

  /**
   * Initialize Python remediation templates
   */
  initPythonTemplates() {
    return {
      sql_injection: {
        name: 'SQL Injection',
        patterns: [
          {
            id: 'string_concat',
            detect: /f["'].*\{.*\}.*["']/, // f-string
            name: 'f-string SQL',
            description: '使用参数化查询替代 f-string',
            code: () => ({
              before: `cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")`,
              after: `cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))`
            }),
            explanation: 'f-string直接拼接，使用 %s 占位符和参数元组'
          },
          {
            id: 'django_orm',
            detect: /\.raw\s*\(/,
            name: 'Django raw SQL',
            description: '使用 Django ORM 替代 raw SQL',
            code: () => ({
              before: `User.objects.raw(f"SELECT * FROM users WHERE id = {user_id}")`,
              after: `User.objects.filter(id=user_id)`
            }),
            explanation: 'Django ORM 自动参数化，避免直接写SQL'
          }
        ]
      },
      command_injection: {
        name: 'Command Injection',
        patterns: [
          {
            id: 'os_system',
            detect: /os\.system\s*\(/,
            name: 'os.system call',
            description: '使用 subprocess 数组参数',
            code: () => ({
              before: `os.system(f"ping {host}")`,
              after: `subprocess.run(["ping", "-c", "4", host], capture_output=True)`
            }),
            explanation: '使用数组参数而非字符串，避免shell注入'
          },
          {
            id: 'subprocess_shell',
            detect: /subprocess\.(run|call|Popen).*shell\s*=\s*True/,
            name: 'subprocess with shell=True',
            description: '移除 shell=True 使用数组参数',
            code: () => ({
              before: `subprocess.run(command, shell=True)`,
              after: `subprocess.run(command.split(), shell=False)  # command is list`
            }),
            explanation: 'shell=True 允许shell注入，使用列表参数更安全'
          }
        ]
      }
    };
  }

  /**
   * Initialize Node.js remediation templates
   */
  initNodeTemplates() {
    return {
      sql_injection: {
        name: 'SQL Injection',
        patterns: [
          {
            id: 'mysql_query',
            detect: /connection\.query\s*\(\s*["'].*\$\{/,
            name: 'Template literal SQL',
            description: '使用 ? 占位符',
            code: () => ({
              before: `connection.query(\`SELECT * FROM users WHERE id = \${userId}\`, callback)`,
              after: `connection.query('SELECT * FROM users WHERE id = ?', [userId], callback)`
            }),
            explanation: '使用 ? 占位符和参数数组，自动转义特殊字符'
          }
        ]
      },
      xss: {
        name: 'XSS',
        patterns: [
          {
            id: 'express_send',
            detect: /res\.send\s*\(\s*[^)]*\+/, // 检测拼接
            name: 'Express response',
            description: '使用模板引擎或转义',
            code: () => ({
              before: `res.send('<div>' + userInput + '</div>');`,
              after: `const escapeHtml = require('escape-html');
res.send('<div>' + escapeHtml(userInput) + '</div>');`
            }),
            explanation: '使用 escape-html 库转义HTML特殊字符'
          }
        ]
      }
    };
  }

  /**
   * Initialize Go remediation templates
   */
  initGoTemplates() {
    return {
      sql_injection: {
        name: 'SQL Injection',
        patterns: [
          {
            id: 'fmt_sprintf',
            detect: /fmt\.Sprintf\s*\(\s*["'][^"']*%s/,
            name: 'fmt.Sprintf SQL',
            description: '使用 db.Query 参数化',
            code: () => ({
              before: `query := fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", userId)
rows, err := db.Query(query)`,
              after: `rows, err := db.Query("SELECT * FROM users WHERE id = ?", userId)`
            }),
            explanation: 'Go sql 包自动参数化 ? 占位符'
          }
        ]
      }
    };
  }

  /**
   * Initialize Vue.js remediation templates
   */
  initVueTemplates() {
    return {
      dom_xss: {
        name: 'DOM XSS',
        patterns: [
          {
            id: 'v_html',
            detect: /v-html\s*=\s*["'][^"']+["']/,
            name: 'v-html directive',
            description: '使用 {{ }} 插值替代 v-html',
            code: (match) => ({
              before: `<div v-html="userContent"></div>`,
              after: `<div>{{ userContent }}</div>`
            }),
            explanation: '{{ }} 自动HTML转义，v-html 直接渲染HTML (危险)'
          },
          {
            id: 'inner_html',
            detect: /\.innerHTML\s*=/,
            name: 'innerHTML assignment',
            description: '使用 textContent 替代',
            code: () => ({
              before: `element.innerHTML = userInput;`,
              after: `element.textContent = userInput;  // Safe, no HTML parsing`
            }),
            explanation: 'textContent 不解析HTML，自动转义特殊字符'
          }
        ]
      }
    };
  }

  /**
   * Initialize React remediation templates
   */
  initReactTemplates() {
    return {
      dom_xss: {
        name: 'XSS',
        patterns: [
          {
            id: 'dangerously_set_inner_html',
            detect: /dangerouslySetInnerHTML/,
            name: 'dangerouslySetInnerHTML',
            description: '避免使用或使用 DOMPurify 净化',
            code: () => ({
              before: `<div dangerouslySetInnerHTML={{ __html: userContent }} />`,
              after: `import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(userContent) }} />`
            }),
            explanation: 'DOMPurify 移除危险HTML标签和属性'
          }
        ]
      }
    };
  }

  /**
   * Initialize Angular remediation templates
   */
  initAngularTemplates() {
    return {
      dom_xss: {
        name: 'XSS',
        patterns: [
          {
            id: 'bypass_security_trust_html',
            detect: /bypassSecurityTrustHtml/,
            name: 'Bypass security',
            description: '移除 bypassSecurityTrustHtml 使用安全绑定',
            code: () => ({
              before: `<div [innerHTML]="sanitizer.bypassSecurityTrustHtml(content)">`,
              after: `<div>{{ content }}</div>  <!-- Angular auto-escapes -->`
            }),
            explanation: 'Angular 自动转义插值，bypassSecurityTrustHtml 绕过保护'
          }
        ]
      }
    };
  }

  /**
   * Match remediation template for a vulnerability
   * @param {Object} vuln - Vulnerability object
   * @param {string} language - Programming language
   * @returns {Object|null} Matched template or null
   */
  match(vuln, language) {
    const langTemplates = this.templates[language];
    if (!langTemplates) {
      return null;
    }

    const vulnTemplates = langTemplates[vuln.type];
    if (!vulnTemplates) {
      return null;
    }

    const code = vuln.codeSnippet || vuln.sinkCode || '';

    // Try to match patterns
    for (const pattern of vulnTemplates.patterns) {
      const match = code.match(pattern.detect);
      if (match) {
        return {
          type: vuln.type,
          language: language,
          patternId: pattern.id,
          patternName: pattern.name,
          description: pattern.description,
          explanation: pattern.explanation,
          code: pattern.code(match),
          imports: pattern.imports || [],
          config: pattern.code(match).config || null
        };
      }
    }

    return null;
  }

  /**
   * Generate remediation for vulnerability
   * @param {Object} vuln - Vulnerability object
   * @param {string} language - Programming language
   * @returns {Object} Remediation object
   */
  generate(vuln, language) {
    // Try template matching first
    const template = this.match(vuln, language);

    if (template) {
      return {
        source: 'template_match',
        confidence: 'HIGH',
        ...template
      };
    }

    // Fallback to generic remediation
    return this.generateGenericRemediation(vuln, language);
  }

  /**
   * Generate generic remediation when no template matches
   */
  generateGenericRemediation(vuln, language) {
    const genericRemediations = {
      sql_injection: {
        description: '使用参数化查询（PreparedStatement）替代字符串拼接',
        explanation: '参数化查询将SQL代码和数据分离，自动转义特殊字符，防止注入攻击',
        recommendation: '1. 使用 ? 占位符\n2. 使用 PreparedStatement.setXXX() 绑定参数\n3. 避免字符串拼接构建SQL'
      },
      xss: {
        description: '对所有用户输入进行HTML转义后再输出',
        explanation: 'HTML转义将 < > & " 等特殊字符转换为实体编码，防止浏览器解析为HTML/JS',
        recommendation: '1. 使用模板引擎的自动转义功能\n2. 或显式调用 HTML escape 函数\n3. 避免使用危险API（innerHTML, v-html等）'
      },
      command_injection: {
        description: '使用数组参数替代字符串命令',
        explanation: '数组参数避免shell解析，防止命令注入',
        recommendation: '1. 使用 execFile 替代 exec\n2. 或传递数组参数给 subprocess\n3. 验证/白名单允许命令'
      },
      hardcoded_secret: {
        description: '将密钥移至配置文件或环境变量',
        explanation: '硬编码密钥可被源码泄露暴露，应从外部安全存储读取',
        recommendation: '1. 使用 @Value 或配置类注入\n2. 使用环境变量存储密钥\n3. 生产环境使用密钥管理服务（KMS/Vault）'
      },
      weak_crypto: {
        description: '使用强加密算法',
        explanation: '弱算法（MD5/SHA1/ECB）已被破解，应使用现代安全算法',
        recommendation: '1. 使用 SHA-256 替代 MD5/SHA1\n2. 使用 AES-GCM 替代 AES-ECB\n3. 使用安全的随机数生成器'
      },
      jwt_no_expiry: {
        description: '为 JWT 令牌设置过期时间（建议 ≤ 2 小时）',
        explanation: 'JWT 无过期时间会导致令牌永久有效，一旦泄露可被长期利用',
        recommendation: '1. 调用 setExpiration() 设置过期时间\n2. 设置合理的过期时长\n3. 配合 refresh token 机制'
      },
      idor: {
        description: '增加数据归属权校验（WHERE user_id = current_user_id）',
        explanation: '水平越权的核心问题是仅按 ID 查询而未校验数据归属，需增加用户/商户归属条件',
        recommendation: '1. 查询时增加 user_id/merchant_id 过滤\n2. 操作时校验数据是否属于当前用户\n3. 使用不可预测的 ID（如 UUID）替代自增 ID'
      },
      negative_amount: {
        description: '对数值型参数增加范围校验（>0、上限、整数/小数）',
        explanation: '前端限制可被轻松绕过，后端必须重新校验所有数值参数',
        recommendation: '1. 使用 @DecimalMin/@Max 注解校验\n2. 手动校验金额 > 0\n3. 设置合理上限阈值'
      },
      email_bombing: {
        description: '增加邮箱 trim 处理、格式校验、频率限制和归属权校验',
        explanation: '空格可绕过格式校验，无限发送可占满邮件通道',
        recommendation: '1. email.trim().toLowerCase()\n2. 正则格式校验\n3. Redis 频率限制（同邮箱 N 次/小时）\n4. 归属权校验（仅可操作自己的邮箱）'
      },
      unauthorized_access: {
        description: '为接口添加强制身份认证与 Token 校验',
        explanation: '未授权接口可被匿名访问，泄露系统架构或敏感数据',
        recommendation: '1. 添加 @PreAuthorize 注解\n2. 配置 Spring Security 拦截\n3. 敏感接口仅允许内网/指定 IP 访问'
      }
    };

    const generic = genericRemediations[vuln.type] || {
      description: '审查并修复安全问题',
      explanation: '此漏洞类型需要针对性修复',
      recommendation: '参考 CWE 文档和 OWASP 指南进行修复'
    };

    return {
      source: 'generic',
      confidence: 'MEDIUM',
      type: vuln.type,
      language: language,
      description: generic.description,
      explanation: generic.explanation,
      recommendation: generic.recommendation
    };
  }

  /**
   * Get all available templates for a language
   */
  getTemplatesForLanguage(language) {
    return this.templates[language] || {};
  }

  /**
   * Add custom template
   */
  addCustomTemplate(language, vulnType, template) {
    if (!this.templates[language]) {
      this.templates[language] = {};
    }
    if (!this.templates[language][vulnType]) {
      this.templates[language][vulnType] = { patterns: [] };
    }
    this.templates[language][vulnType].patterns.push(template);
  }
}

// Export
export function createRemediationTemplates() {
  return new RemediationTemplates();
}

export default RemediationTemplates;
