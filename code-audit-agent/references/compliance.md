---
name: compliance
description: 合规差距分析规则 — PCI-DSS/GDPR/等保2.0
config:
  progression:
    phase: "6"
    name: "Compliance Gap Analysis"
    prev: "Phase 5"
    next: "END"
    trigger: "Phase 6 Structured Output"
---

# Compliance Gap Analysis

**Phase**: Phase 6 (Structured Output)
**Purpose**: Map vulnerabilities to compliance frameworks and identify gaps

## Supported Frameworks

| Framework | Domain | Version |
|-----------|--------|---------|
| PCI-DSS | Payment Card Industry | 4.0 |
| GDPR | European Privacy | EU 2016/679 |
| 等保 2.0 | China Cybersecurity | GB/T 22239-2019 |
| SOC 2 | Service Organizations | 2017 |
| HIPAA | Healthcare | US 1996 |

---

## PCI-DSS 4.0 Mapping

### Requirement 2: System Components Configuration

**Related Vulnerabilities:**
- Default credentials
- Unnecessary services
- Missing security patches
- Weak cryptographic settings

**Controls:**
```
2.2.1 – Single primary function per server
2.2.3 – Critical security patches installed
2.2.4 – Remove unnecessary functions
2.3 – Encrypt all transmitted data
```

### Requirement 6: Maintain Vulnerability Management

**Related Vulnerabilities:**
- SQL Injection
- XSS
- Command Injection
- Insecure deserialization

**Controls:**
```
6.2 – Remove all unnecessary and unused functions
6.3.3 – Man-in-the-Middle attacks
6.4 – Prevent common software vulnerabilities
6.5.1 – Injection attacks
6.5.2 – Buffer overflows
6.5.5 – Broken authentication
6.5.6 – Sensitive data exposure
```

### Requirement 8: User Identity Management

**Related Vulnerabilities:**
- Broken authentication
- Credential stuffing
- Missing MFA
- Session fixation

**Controls:**
```
8.2.3 – Minimum password complexity
8.3 – Multi-factor authentication
8.4 – Encrypt authentication data
8.5 – No shared accounts
```

### Gap Assessment Template

```markdown
### PCI-DSS Gap Assessment
| Requirement | Control | Finding | Gap | Severity |
|-------------|---------|---------|-----|----------|
| 6.5.1 | SQL Injection Prevention | ByberAccountMapper.xml:16 | Missing parameterized query | HIGH |
| 8.3 | MFA | AuthController.java | MFA not implemented | CRITICAL |
```

---

## GDPR Mapping

### Article 25: Data Protection by Design

**Related Vulnerabilities:**
- Missing input validation (PII exposure)
- Unencrypted personal data
- Excessive data collection

**Controls:**
```
- Minimize data collection
- Encrypt personal data
- Implement access controls
- Data retention policies
```

### Article 32: Security of Processing

**Related Vulnerabilities:**
- SQL Injection → Data breach
- Authentication weaknesses → Unauthorized access
- Missing encryption → Data exposure

**Controls:**
```
- Encryption of personal data
- Pseudonymization capability
- Ongoing confidentiality assurance
- Regular security testing
```

### Article 33: Breach Notification

**Related Vulnerabilities:**
- Any vulnerability leading to data breach
- Missing logging/monitoring
- Delayed detection

**Gap Assessment:**

```markdown
### GDPR Gap Assessment
| Article | Requirement | Finding | Gap | Risk |
|---------|-------------|---------|-----|------|
| Art. 32 | Encryption | SensitiveData.java | No encryption at rest | HIGH |
| Art. 32 | Access Control | UserController.java | IDOR vulnerability | CRITICAL |
| Art. 25 | Data Minimization | API returns full profile | Excessive data | MEDIUM |
```

---

## 等保 2.0 (GB/T 22239-2019)

### Security Protection Target (等级保护基本要求)

| Level | Description | Example |
|-------|-------------|---------|
| 第一级 | 一般系统 | Internal tools |
| 第二级 | 重要系统 | Business systems |
| 第三级 | 关键系统 | Financial, healthcare |
| 第四级 | 极端重要 | Defense, critical infrastructure |

### Classified Requirements (分类要求)

#### 1. 安全物理环境 (Physical Security)

**Related Controls:**
- Server room access control
- Environmental protection
- Equipment disposal

#### 2. 安全通信网络 (Network Security)

**Related Vulnerabilities:**
- Unencrypted transmission
- Missing network segmentation
- SSRF vulnerabilities

**Controls:**
```
- Network boundary defense
- Firewall configuration
- Encrypted communications (TLS 1.2+)
- Network monitoring
```

#### 3. 安全区域边界 (Perimeter Security)

**Related Vulnerabilities:**
- Open admin interfaces
- Missing WAF
- CORS misconfiguration

#### 4. 安全计算环境 (Computing Environment)

**Related Vulnerabilities:**
- All application-level vulnerabilities
- Weak authentication
- Missing input validation
- Insecure configuration

**Controls:**
```
- Secure baseline configuration
- Access control lists
- Intrusion detection
- Malware protection
```

#### 5. 安全管理中心 (Security Management)

**Related Controls:**
- Logging and monitoring
- Security incident management
- Change management

### Gap Assessment Template

```markdown
### 等保 2.0 Gap Assessment (第三级)
| 安全类 | 控制点 | 发现 | 差距 | 风险 |
|--------|--------|------|------|------|
| 网络安全 | 边界防护 | AdminController.java | 公开访问管理接口 | 高 |
| 主机安全 | 身份鉴别 | AuthController.java | 弱密码策略 | 中 |
| 应用安全 | 访问控制 | OrderController.java:45 | IDOR越权访问 | 高 |
| 数据安全 | 数据保护 | UserMapper.xml | 敏感数据未加密 | 高 |
```

---

## SOC 2 Trust Service Criteria

### Security (Common Criteria)

**Related Vulnerabilities:**
- All access control issues
- Authentication weaknesses
- Change management failures

### Availability

**Related Vulnerabilities:**
- DDoS susceptibility
- Missing failover
- Error handling issues

### Confidentiality

**Related Vulnerabilities:**
- Data exposure
- Encryption gaps
- Access control failures

### Processing Integrity

**Related Vulnerabilities:**
- Business logic flaws
- Calculation errors
- Data validation issues

### Privacy

**Related Vulnerabilities:**
- PII exposure
- Consent issues
- Data retention

```markdown
### SOC 2 Gap Assessment
| Criteria | Requirement | Finding | Impact |
|----------|-------------|---------|--------|
| Security | CC6.1 | SQL Injection | Data breach risk |
| Security | CC6.3 | Broken Auth | Unauthorized access |
| Confidentiality | CC9.1 | No encryption | PII exposure |
| Privacy | P3 | IDOR vulnerability | Privacy violation |
```

---

## Compliance Gap Scoring

### Compliance Score Formula

```
Compliance Score = (Total Controls - Gap Count) / Total Controls × 100

Risk-Adjusted Score = Compliance Score × Risk Weight

Risk Weight by Framework:
- PCI-DSS: 1.0 (mandatory)
- GDPR: 1.0 (legal requirement)
- 等保 2.0: 0.9 (regulatory)
- SOC 2: 0.8 (contractual)
```

### Gap Priority Matrix

| Gap Severity | PCI-DSS | GDPR | 等保 2.0 |
|--------------|---------|------|----------|
| CRITICAL | Immediate | 72 hours | Immediate |
| HIGH | 30 days | 7 days | 1 week |
| MEDIUM | 90 days | 30 days | 1 month |
| LOW | Next audit | Next audit | 3 months |

---

## Remediation Roadmap

### Phase 1: Immediate (0-30 days)

```markdown
### Critical Gaps
| ID | Framework | Requirement | Finding | Owner |
|----|-----------|-------------|---------|-------|
| G-001 | PCI-DSS | 8.3 | MFA Missing | Security Team |
| G-002 | GDPR | Art. 32 | IDOR Vulnerability | Dev Team |
```

### Phase 2: Short-term (30-90 days)

```markdown
### High Priority Gaps
| ID | Framework | Requirement | Finding | Owner |
|----|-----------|-------------|---------|-------|
| G-003 | 等保 2.0 | 访问控制 | Broken Auth | Dev Team |
| G-004 | PCI-DSS | 6.5.1 | SQL Injection | Dev Team |
```

### Phase 3: Medium-term (90-180 days)

```markdown
### Medium Priority Gaps
| ID | Framework | Requirement | Finding | Owner |
|----|-----------|-------------|---------|-------|
| G-005 | GDPR | Art. 25 | Data Minimization | Architecture |
| G-006 | SOC 2 | CC6.6 | Weak Encryption | DevOps |
```

---

## Report Integration

Compliance analysis should appear in Phase 6 report:

```markdown
## Compliance Gap Analysis

### Executive Summary
| Framework | Compliance Score | Risk Level | Critical Gaps |
|-----------|------------------|------------|---------------|
| PCI-DSS 4.0 | 82% | HIGH | 2 |
| GDPR | 78% | HIGH | 3 |
| 等保 2.0 (三级) | 85% | MEDIUM | 1 |
| SOC 2 | 88% | MEDIUM | 1 |

### Detailed Gap Analysis

#### PCI-DSS 4.0
| Req | Control | Status | Finding | Remediation |
|-----|---------|--------|---------|-------------|
| 6.5.1 | Injection Prevention | ❌ GAP | SQL Injection in ByberAccountMapper | Parameterize queries |
| 8.3 | MFA | ❌ GAP | MFA not implemented | Add TOTP |
```

### Compliance Attestation

```markdown
## Compliance Status

### Findings by Framework
- **PCI-DSS 4.0**: 9 gaps identified, 2 CRITICAL
- **GDPR**: 5 gaps identified, 1 CRITICAL
- **等保 2.0 (Level 3)**: 4 gaps identified, 1 CRITICAL

### Recommendations
1. Immediate: Remediate CRITICAL gaps (24-72 hours)
2. Short-term: Address HIGH gaps (30 days)
3. Medium-term: Address MEDIUM gaps (90 days)
4. Long-term: Address LOW gaps (next audit cycle)
```