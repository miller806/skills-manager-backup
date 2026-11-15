---
name: metrics
description: 多维度度量指标定义 — Phase 6报告增强时加载
config:
  progression:
    phase: "6"
    name: "Audit Metrics"
    prev: "Phase 5"
    next: "END"
    trigger: "Phase 6 Structured Output"
---

# Audit Metrics

**Phase**: Phase 6 (Structured Output)
**Previous**: Phase 5 Dynamic Risk Rating
**Purpose**: Define multi-dimensional metrics for audit quality and risk assessment

## Overview

Multi-dimensional metrics provide:
1. **Coverage metrics** - What percentage of codebase was audited?
2. **Quality metrics** - How accurate are the findings?
3. **Risk metrics** - What is the overall risk posture?
4. **Trend metrics** - How does this compare to previous audits?

## Coverage Metrics

### Code Coverage

| Metric | Formula | Target |
|--------|---------|--------|
| Lines Audited | Count of source files scanned | > 90% |
| Module Coverage | Modules with security review | > 80% |
| Language Coverage | Languages detected vs covered | 100% |
| Critical Module Coverage | CRITICAL/HIGH modules fully audited | 100% |

### Audit Scope

```markdown
### Coverage Statistics
| Category | Count | Coverage |
|----------|-------|----------|
| Source Files | 142 | 95% |
| Java Files | 89 | 100% |
| Config Files | 23 | 100% |
| Frontend Files | 30 | 87% |
```

## Quality Metrics

### Finding Quality

| Metric | Description | Target |
|--------|-------------|--------|
| Confirmation Rate | confirmed / totalFindings | > 60% |
| False Positive Rate | rejected / totalFindings | < 15% |
| Fix Rate | fixed / confirmedFindings | > 70% |
| Repeat Finding Rate | recurring / newFindings | < 30% |

### Confidence Distribution

```markdown
### Finding Confidence
| Confidence | Count | Percentage |
|------------|-------|------------|
| HIGH | 12 | 40% |
| MEDIUM | 15 | 50% |
| LOW | 3 | 10% |
```

## Risk Metrics

### Overall Risk Score

```
Risk Score = Σ(Vulnerability × Exploitability × Business Impact) / Normalization Factor

Components:
- Vulnerability: CVSS Base Score (0-10)
- Exploitability: Ease of exploitation (0.3-1.0)
- Business Impact: Data/Financial/Reputation (1.0-2.0)
```

### Risk Distribution

```markdown
### Risk Distribution
| Level | Count | Avg CVSS | Business Impact |
|-------|-------|----------|-----------------|
| CRITICAL | 2 | 9.5 | Critical |
| HIGH | 5 | 7.8 | High |
| MEDIUM | 8 | 5.2 | Medium |
| LOW | 12 | 3.1 | Low |
```

### Risk Accumulation

```
Risk Accumulation = Σ(Exposure × Vulnerability × Asset Value)

Exposure: Network exposure (0-1)
Vulnerability: Vulnerability severity (0-1)
Asset Value: Business criticality (1-10)
```

## Trend Metrics

### vs Previous Audit

```markdown
### Trend Analysis
| Metric | Previous | Current | Change |
|--------|----------|---------|--------|
| Total Findings | 35 | 27 | -23% |
| CRITICAL | 3 | 2 | -33% |
| HIGH | 8 | 5 | -38% |
| MEDIUM | 14 | 8 | -43% |
| FALSE Positive Rate | 18% | 12% | -6pts |
| Avg Time to Fix | 14 days | 10 days | -4 days |
```

### Velocity Metrics

| Metric | Description |
|--------|-------------|
| Finding Velocity | New findings per audit cycle |
| Fix Velocity | Findings remediated per sprint |
| Vulnerability Half-Life | Time for 50% of findings to be fixed |

## Remediation Metrics

### Remediation Timeline

```markdown
### Remediation Progress
| Priority | Open | In Progress | Fixed | Avg Days to Fix |
|----------|------|--------------|-------|-----------------|
| P0 | 2 | 0 | 0 | - |
| P1 | 3 | 1 | 1 | 5 |
| P2 | 5 | 2 | 1 | 14 |
| P3 | 8 | 3 | 2 | 30 |
```

### Remediation Efficiency

```
Remediation Efficiency = Fixed Count × Severity Weight / Effort

Severity Weight:
- CRITICAL: 4
- HIGH: 3
- MEDIUM: 2
- LOW: 1

Effort: Developer hours spent
```

## Compliance Metrics

### Compliance Status

```markdown
### Compliance Dashboard
| Framework | Requirements | Compliant | Gap | Risk |
|----------|--------------|-----------|-----|------|
| PCI-DSS 4.0 | 51 | 42 | 9 | HIGH |
| GDPR | 30 | 28 | 2 | MEDIUM |
| 等保 2.0 | 45 | 40 | 5 | MEDIUM |
```

### Compliance Coverage

```
Compliance Coverage = (Audited Requirements / Total Requirements) × 100%

Target: > 95% for all applicable frameworks
```

## Business Risk Metrics

### Data Exposure Risk

```markdown
### Data Exposure Assessment
| Data Type | Volume | Exposure | Risk Score |
|-----------|--------|----------|------------|
| User PII | 1M+ | 3 vulns | CRITICAL |
| Payment Data | 500K | 1 vuln | CRITICAL |
| Internal Docs | 10K | 2 vulns | HIGH |
```

### Financial Impact

```
Estimated Financial Impact = Σ(Finding × Likelihood × Impact)

Likelihood: Based on exploitability (0.1-1.0)
Impact: Based on data volume and sensitivity (1-10)

Output: $ value at risk
```

## Report Card Score

### Overall Security Score (0-100)

```
Security Score = 100 - Σ(Vulnerability × Weight) - Σ(Gap × ComplianceWeight)

Vulnerability scoring:
- CRITICAL: 25 points
- HIGH: 15 points
- MEDIUM: 5 points
- LOW: 1 point

Grades:
- A: 90-100 (Excellent)
- B: 80-89 (Good)
- C: 70-79 (Fair)
- D: 60-69 (Poor)
- F: <60 (Critical)
```

### Score Breakdown

```markdown
### Security Score Card
| Category | Score | Max | Grade |
|----------|-------|-----|-------|
| Access Control | 18 | 25 | B |
| Input Validation | 12 | 25 | D |
| Cryptography | 22 | 25 | A |
| Error Handling | 20 | 25 | A |
| Logging | 15 | 25 | C |
| **Overall** | **87** | **125** | **B** |
```

## Implementation

### Metrics Collection

```javascript
// Example: Metrics calculation
const metrics = {
  coverage: {
    filesAudited: 142,
    totalFiles: 150,
    coveragePercent: 94.7
  },
  quality: {
    totalFindings: 30,
    confirmed: 22,
    falsePositives: 4,
    unconfirmed: 4,
    confirmationRate: 73.3,
    falsePositiveRate: 13.3
  },
  risk: {
    critical: 2,
    high: 5,
    medium: 8,
    low: 12,
    avgCVSS: 5.8,
    overallRiskScore: 67.5
  },
  trend: {
    vsLastAudit: {
      totalChange: -23,
      criticalChange: -33,
      falsePositiveRateChange: -6
    }
  }
};
```

### Report Integration

All metrics should be included in the Phase 6 structured output:

```markdown
# Audit Report

## Metrics Summary

### 1. Coverage
| Metric | Value | Target | Status |
|--------|-------|-------|--------|
| Files Audited | 142/150 | >90% | ✅ PASS |

### 2. Quality
| Metric | Value | Target | Status |
|--------|-------|-------|--------|
| Confirmation Rate | 73% | >60% | ✅ PASS |
| False Positive Rate | 13% | <15% | ✅ PASS |

### 3. Risk
| Metric | Value | Assessment |
|--------|-------|------------|
| Overall Risk Score | 67.5 | MEDIUM |
| Security Grade | B | Good |
| CRITICAL Findings | 2 | Immediate Action |

### 4. Trends
| Metric | vs Last Audit | Trend |
|--------|---------------|-------|
| Total Findings | -23% | 📈 Improved |
| CRITICAL | -33% | 📈 Improved |
