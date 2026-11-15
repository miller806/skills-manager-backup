/**
 * False Positive Filter
 *
 * Automatically filters false positives based on static code patterns
 * without requiring external AST/LLM tools.
 */

class FalsePositiveFilter {
  constructor() {
    // Sanitization patterns by vulnerability type
    this.sanitizationPatterns = {
      sql_injection: {
        patterns: [
          { regex: /PreparedStatement.*set\w+\s*\(/, desc: 'PreparedStatement parameter binding' },
          { regex: /#{\w+}/, desc: 'MyBatis #{} parameterization' },
          { regex: /\$\d+/, desc: 'PostgreSQL $n parameterization' },
          { regex: /@Param\s*\(\s*["'][^"']+["']\s*\)/, desc: 'MyBatis @Param annotation' },
          { regex: /escapeString|escapeSql|sanitizeSql|sqlEscape/i, desc: 'SQL escape function' },
          { regex: /\.createCriteria\(\)/, desc: 'Criteria API (safe)' },
          { regex: /Query\.setParameter\s*\(/, desc: 'JPA setParameter' },
          { regex: /\.eq\s*\(|\.like\s*\(|\.in\s*\(/, desc: 'CriteriaBuilder methods' }
        ],
        message: 'Uses parameterized query or sanitization'
      },
      xss: {
        patterns: [
          { regex: /encodeURIComponent\s*\(/, desc: 'URL encoding' },
          { regex: /HtmlUtils\.htmlEscape|HtmlUtils\.htmlEscapeHex/i, desc: 'Spring HTML escape' },
          { regex: /StringEscapeUtils\.escapeHtml/i, desc: 'Apache Commons HTML escape' },
          { regex: /DOMPurify|sanitizeHtml|escapeHtml/i, desc: 'HTML sanitization library' },
          { regex: /\.textContent\s*=|\.innerText\s*=/, desc: 'Safe text assignment' },
          { regex: /th:text|th:utext/, desc: 'Thymeleaf auto-escaping' },
          { regex: /\{\{[^}]+\}\}/, desc: 'Vue/React auto-escape interpolation' }
        ],
        message: 'Uses HTML escaping or safe output method'
      },
      command_injection: {
        patterns: [
          { regex: /validateCommand|sanitizeCommand|commandValidate/i, desc: 'Command validation' },
          { regex: /['"][a-zA-Z0-9_-]+['"]\s*\+/, desc: 'Hardcoded command prefix' },
          { regex: /ProcessBuilder\s*\(\s*Arrays\.asList/, desc: 'ProcessBuilder with list (safe)' },
          { regex: /execFile\s*\(|execFileSync\s*\(/, desc: 'Node.js execFile (safe)' }
        ],
        message: 'Uses command validation or safe execution method'
      },
      ssrf: {
        patterns: [
          { regex: /@Value\s*\(\s*["'][^"']*url["']/, desc: 'URL from configuration' },
          { regex: /allow(ed)?Host(s)?|whiteList|urlWhiteList/i, desc: 'URL whitelist validation' },
          { regex: /startsWith\s*\(\s*["']https?:\/\//, desc: 'Protocol validation' },
          { regex: /inetAddress\.isSiteLocalAddress\(\)/, desc: 'Private IP check' }
        ],
        message: 'Uses URL whitelist or configuration source'
      },
      path_traversal: {
        patterns: [
          { regex: /getCanonicalPath\s*\(\)|getAbsolutePath\s*\(\)/, desc: 'Canonical path check' },
          { regex: /File\s*\(\s*[^,]+,\s*[^)]+\)/, desc: 'Safe File constructor' },
          { regex: /replace\s*\.\./, desc: 'Dot-dot removal' },
          { regex: /normalize\s*\(/, desc: 'Path normalization' }
        ],
        message: 'Uses path canonicalization'
      }
    };

    // Safe parameter sources that are not user-controllable
    this.safeSources = {
      config: {
        patterns: [
          { regex: /@Value\s*\(\s*["']\$?\{[^}]+\}/, desc: '@Value configuration' },
          { regex: /@ConfigurationProperties/, desc: 'ConfigurationProperties class' },
          { regex: /config\.get\w+\(|config\.\w+/, desc: 'Config object property' },
          { regex: /properties\.get\w+\(|properties\.\w+/, desc: 'Properties object' },
          { regex: /environment\.get\w+\(|env\.get\w+\(/, desc: 'Environment variable' },
          { regex: /application\.yml|application\.properties/, desc: 'Configuration file' }
        ],
        message: 'Parameter from configuration (non-user-controllable)'
      },
      system: {
        patterns: [
          { regex: /UUID\.randomUUID\s*\(\)/, desc: 'UUID generation' },
          { regex: /System\.currentTimeMillis\s*\(\)/, desc: 'Timestamp' },
          { regex: /new\s+Date\s*\(\s*\)/, desc: 'Current date' },
          { regex: /LocalDate(Time)?\.now\s*\(\)/, desc: 'Java 8 date/time' },
          { regex: /Instant\.now\s*\(\)/, desc: 'Java 8 instant' },
          { regex: /SecureRandom|ThreadLocalRandom/, desc: 'Secure random' }
        ],
        message: 'Parameter system-generated (non-user-controllable)'
      },
      internal: {
        patterns: [
          { regex: /\.hashCode\s*\(\)/, desc: 'Hash code' },
          { regex: /\.length\s*\(\)|\.size\s*\(\)|\.length$/, desc: 'Length/size property' },
          { regex: /StringUtils\.(isEmpty|isBlank|isNotEmpty)/, desc: 'StringUtils validation' },
          { regex: /Objects\.(isNull|nonNull|requireNonNull)/, desc: 'Objects validation' },
          { regex: /CollectionUtils\./, desc: 'CollectionUtils methods' }
        ],
        message: 'Parameter is internal calculation result'
      }
    };

    // Constant patterns (safe because they're not user input)
    this.constantPatterns = {
      patterns: [
        { regex: /"[^"]*"\s*\+\s*\w+\s*\+\s*"[^"]*"/, desc: 'String with constant prefix/suffix' },
        { regex: /^\s*["'][^"']+["']\s*\+\s*\w+/, desc: 'Starts with constant' },
        { regex: /String\.format\s*\(\s*["'][^"']+["']/, desc: 'String.format with constant template' },
        { regex: /MessageFormat\.format\s*\(\s*["']/, desc: 'MessageFormat with constant' }
      ]
    };

    // JWT/Token security patterns (based on real-world findings) **[NEW]**
    this.tokenSecurityPatterns = {
      jwt_expiry: {
        patterns: [
          { regex: /\.setExpiration\s*\(/, desc: 'JWT expiration set' },
          { regex: /\.exp\s*\(\s*new\s+Date/, desc: 'JWT exp claim set' },
          { regex: /\.setExpiration\s*\(\s*new\s+Date\s*\(\s*System\.currentTimeMillis\(\)\s*\+\s*[1-9]/, desc: 'JWT with reasonable expiry' }
        ],
        message: 'JWT has expiration configured'
      },
      token_blacklist: {
        patterns: [
          { regex: /redisTemplate.*delete.*token|blacklist.*token/, desc: 'Token blacklist mechanism' },
          { regex: /token.*version|TokenVersion|tokenVersion/, desc: 'Token version control' }
        ],
        message: 'Token invalidation mechanism present'
      },
      code_verification: {
        patterns: [
          { regex: /redisTemplate\.delete.*code|session\.removeAttribute.*code/, desc: 'Verification code deleted after use' },
          { regex: /isPassed|verifySuccess/, desc: 'Server-side verification (check if result is used)' }
        ],
        message: 'Verification code has lifecycle management'
      }
    };
  }

  /**
   * Check if vulnerability is a false positive
   * @param {Object} vuln - Vulnerability object
   * @returns {Object} False positive check result
   */
  check(vuln) {
    const results = {
      isFalsePositive: false,
      reasons: [],
      confidence: 'HIGH',
      originalSeverity: vuln.severity,
      adjustedSeverity: vuln.severity
    };

    // 1. Check sanitization
    const sanitizationCheck = this.checkSanitization(vuln);
    if (sanitizationCheck.found) {
      results.isFalsePositive = true;
      results.reasons.push(sanitizationCheck);
    }

    // 2. Check safe parameter sources
    const sourceCheck = this.checkSafeSource(vuln);
    if (sourceCheck.found) {
      results.isFalsePositive = true;
      results.reasons.push(sourceCheck);
    }

    // 3. Check if code contains constants
    const constantCheck = this.checkConstantPattern(vuln);
    if (constantCheck.found) {
      results.isFalsePositive = true;
      results.reasons.push(constantCheck);
    }

    // 4. Dead code check (if callChain info available)
    if (vuln.callChain && vuln.callChain.length === 0) {
      results.isFalsePositive = true;
      results.reasons.push({
        type: 'dead_code',
        found: true,
        description: 'Method has no callers (dead code)',
        recommendation: 'Remove unused code or mark as INFO'
      });
      results.adjustedSeverity = 'INFO';
    }

    // 5. JWT/Token security check **[NEW]** (based on real-world findings)
    const tokenSecurityCheck = this.checkTokenSecurity(vuln);
    if (tokenSecurityCheck.found) {
      results.isFalsePositive = true;
      results.reasons.push(tokenSecurityCheck);
    }

    // Adjust severity if it's a false positive
    if (results.isFalsePositive) {
      results.adjustedSeverity = this.calculateAdjustedSeverity(vuln, results.reasons);
    }

    return results;
  }

  /**
   * Check for sanitization patterns
   */
  checkSanitization(vuln) {
    const vulnType = vuln.type;
    const code = vuln.codeSnippet || vuln.sinkCode || '';

    const sanitization = this.sanitizationPatterns[vulnType];
    if (!sanitization) {
      return { found: false };
    }

    for (const pattern of sanitization.patterns) {
      if (pattern.regex.test(code)) {
        return {
          type: 'sanitization',
          found: true,
          description: pattern.desc,
          message: sanitization.message,
          matchedPattern: pattern.regex.toString()
        };
      }
    }

    return { found: false };
  }

  /**
   * Check if parameter comes from safe source
   */
  checkSafeSource(vuln) {
    const paramFlow = vuln.paramFlow || vuln.dataFlow || '';
    const code = vuln.codeSnippet || '';
    const combined = paramFlow + ' ' + code;

    for (const [category, config] of Object.entries(this.safeSources)) {
      for (const pattern of config.patterns) {
        if (pattern.regex.test(combined)) {
          return {
            type: 'safe_source',
            found: true,
            category: category,
            description: pattern.desc,
            message: config.message
          };
        }
      }
    }

    return { found: false };
  }

  /**
   * Check for constant patterns (safe)
   */
  checkConstantPattern(vuln) {
    const code = vuln.codeSnippet || vuln.sinkCode || '';

    for (const pattern of this.constantPatterns.patterns) {
      if (pattern.regex.test(code)) {
        return {
          type: 'constant_pattern',
          found: true,
          description: pattern.desc,
          message: 'Uses constant values (limited user control)',
          recommendation: 'MEDIUM or LOW based on context'
        };
      }
    }

    return { found: false };
  }

  /**
   * Check JWT/Token security patterns **[NEW]**
   * Based on real-world findings: JWT without expiry, logout without invalidation, etc.
   */
  checkTokenSecurity(vuln) {
    const vulnType = vuln.type;
    const code = vuln.codeSnippet || vuln.sinkCode || '';
    const dataFlow = vuln.dataFlow || '';
    const combined = code + ' ' + dataFlow;

    // Only check for JWT/Token related vulnerabilities
    if (!/jwt|token|Token|JWT|authorization|Authorization/.test(combined)) {
      return { found: false };
    }

    // Check JWT expiry patterns
    if (/jwt.*expir|no.*expir|without.*expir/i.test(vulnType) || /jwt.*expir|no.*expir/i.test(combined)) {
      for (const pattern of this.tokenSecurityPatterns.jwt_expiry.patterns) {
        if (pattern.regex.test(combined)) {
          return {
            type: 'token_security',
            category: 'jwt_expiry',
            found: true,
            description: pattern.desc,
            message: this.tokenSecurityPatterns.jwt_expiry.message
          };
        }
      }
    }

    // Check token blacklist patterns
    if (/logout|signout|注销|invalidate/.test(combined)) {
      for (const pattern of this.tokenSecurityPatterns.token_blacklist.patterns) {
        if (pattern.regex.test(combined)) {
          return {
            type: 'token_security',
            category: 'token_blacklist',
            found: true,
            description: pattern.desc,
            message: this.tokenSecurityPatterns.token_blacklist.message
          };
        }
      }
    }

    // Check verification code lifecycle
    if (/验证码|code.*verify|captcha|checkCode/.test(combined)) {
      for (const pattern of this.tokenSecurityPatterns.code_verification.patterns) {
        if (pattern.regex.test(combined)) {
          return {
            type: 'token_security',
            category: 'code_verification',
            found: true,
            description: pattern.desc,
            message: this.tokenSecurityPatterns.code_verification.message
          };
        }
      }
    }

    return { found: false };
  }

  /**
   * Calculate adjusted severity based on false positive reasons
   */
  calculateAdjustedSeverity(vuln, reasons) {
    const severityOrder = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
    const originalIndex = severityOrder.indexOf(vuln.severity);

    let adjustment = 0;

    for (const reason of reasons) {
      switch (reason.type) {
        case 'sanitization':
          // Proper sanitization reduces severity significantly
          adjustment += 2;
          break;
        case 'safe_source':
          // Safe source depends on category
          if (reason.category === 'config') adjustment += 2;
          else if (reason.category === 'system') adjustment += 3;
          else adjustment += 1;
          break;
        case 'constant_pattern':
          adjustment += 1;
          break;
        case 'dead_code':
          return 'INFO';
      }
    }

    const newIndex = Math.min(originalIndex + adjustment, severityOrder.length - 1);
    return severityOrder[newIndex];
  }

  /**
   * Batch check multiple vulnerabilities
   */
  checkBatch(vulns) {
    return vulns.map(vuln => ({
      ...vuln,
      falsePositiveCheck: this.check(vuln)
    }));
  }

  /**
   * Filter out confirmed false positives
   */
  filter(vulns, confidenceThreshold = 'HIGH') {
    const checked = this.checkBatch(vulns);

    return checked.filter(v => {
      const fp = v.falsePositiveCheck;

      // Keep if not false positive
      if (!fp.isFalsePositive) return true;

      // Keep if confidence is not high enough
      if (fp.confidence !== confidenceThreshold) return true;

      // Keep if adjusted severity is not INFO
      if (fp.adjustedSeverity !== 'INFO') return true;

      // Filter out this false positive
      return false;
    });
  }

  /**
   * Generate false positive statistics
   */
  getStatistics(vulns) {
    const checked = this.checkBatch(vulns);
    const stats = {
      total: vulns.length,
      falsePositives: 0,
      byType: {},
      byReason: {}
    };

    for (const v of checked) {
      const fp = v.falsePositiveCheck;

      if (fp.isFalsePositive) {
        stats.falsePositives++;

        // Count by vulnerability type
        stats.byType[v.type] = (stats.byType[v.type] || 0) + 1;

        // Count by reason
        for (const reason of fp.reasons) {
          const reasonKey = `${reason.type}${reason.category ? ':' + reason.category : ''}`;
          stats.byReason[reasonKey] = (stats.byReason[reasonKey] || 0) + 1;
        }
      }
    }

    stats.falsePositiveRate = ((stats.falsePositives / stats.total) * 100).toFixed(2) + '%';

    return stats;
  }
}

// Export for use in other modules
export function createFalsePositiveFilter() {
  return new FalsePositiveFilter();
}

export default FalsePositiveFilter;
