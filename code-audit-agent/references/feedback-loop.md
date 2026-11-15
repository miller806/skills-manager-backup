---
name: feedback-loop
description: 闭环反馈机制规则 — 用于优化检测精度
config:
  progression:
    phase: "post-audit"
    name: "Feedback Loop"
    trigger: "After audit report generated"
---

# Feedback Loop Rules

**Phase**: Post-Audit (after Phase 6)
**Trigger**: Audit report delivered to owner
**Purpose**: Continuous improvement of detection accuracy

## Overview

The feedback loop enables the agent to learn from:
1. Confirmed vs rejected vulnerability findings
2. False positive patterns
3. Missed vulnerabilities (true negatives)
4. Owner preferences and project-specific rules

## Feedback Collection

### Owner Feedback Entry Points

1. **Explicit Confirmation**: Owner confirms a vulnerability is real and exploitable
2. **Explicit Rejection**: Owner marks a finding as false positive
3. **Implicit Confirmation**: Owner fixes the issue (implies it was real)
4. **Implicit Rejection**: Owner ignores the finding (may indicate false positive)

### Feedback Data Structure

```json
{
  "vulnId": "SQL-INJ-001",
  "type": "SQL Injection",
  "file": "UserMapper.xml",
  "line": 42,
  "feedbackType": "confirmed|rejected|fixed|ignored",
  "reason": "Detailed explanation from owner",
  "timestamp": 1704067200000,
  "ownerNotes": "This is actually a stored procedure, not vulnerable"
}
```

### Feedback File Location

```
_bmad/memory/code-audit/
├── feedback/
│   ├── feedback-log.jsonl    # Raw feedback entries
│   └── weights.json          # Learned rule weights
```

## Feedback Processing

### After Audit (Automatic)

1. Log all findings to `feedback/audit-{date}.json`
2. Set initial confidence based on verification results
3. Wait for owner feedback

### Upon Owner Feedback

1. Parse feedback entry
2. Update rule weights in `weights.json`
3. Adjust detection rules for future audits
4. Update MEMORY.md with lessons learned

## Rule Weight Adjustment

### Weight Calculation

```
newWeight = oldWeight * (1 - rejectionRate * adjustmentFactor)

Where:
- oldWeight: Current weight for this vulnerability type
- rejectionRate: rejectedCount / totalCount for this type
- adjustmentFactor: 0.5 (can be tuned)
```

### Weight Thresholds

| Weight | Detection Behavior |
|--------|---------------------|
| ≥ 0.8 | Report immediately, high confidence |
| 0.5-0.8 | Report with medium confidence, include mitigation context |
| < 0.5 | Report only if multiple indicators confirm |
| ≤ 0.2 | Do not report (likely false positive for this project) |

## Feedback Categories

### 1. True Positive (Confirmed)

**Indicators:**
- Owner confirms the vulnerability is real
- Owner fixes the issue based on the report
- Owner provides additional context confirming exploitability

**Actions:**
- Increase confidence for similar vulnerability types
- Update detection pattern if needed
- Log to BOND.md as "confirmed vulnerability pattern"

### 2. False Positive (Rejected)

**Indicators:**
- Owner marks finding as not exploitable
- Owner explains why the code path is not reachable
- Owner provides context that changes the risk assessment

**Actions:**
- Decrease weight for this vulnerability type
- Add exception rule if specific code pattern
- Update Phase 3 reachability rules for this project

### 3. Missed Detection (True Negative)

**Indicators:**
- Owner discovers a vulnerability not detected by audit
- Owner reports a security incident that wasn't caught

**Actions:**
- Add new detection rule for this vulnerability type
- Update sink-libraries.md with new pattern
- Log to MEMORY.md as "pattern to watch"

## Feedback-Driven Adaptation

### Per-Project Adaptation

Each project maintains its own feedback history:

```
_bmad/memory/{project-name}/
├── feedback/
│   ├── project-feedback.jsonl
│   └── project-weights.json
```

### Cross-Project Learning (Optional)

When same vulnerability type consistently has high rejection rate:
1. Flag as potential false positive pattern
2. Add to grey-zone-rules.md consideration
3. Broadcast to sanctum network (if enabled)

## Feedback Loop Metrics

### Tracked Metrics

| Metric | Description |
|--------|-------------|
| Confirmation Rate | confirmed / totalFindings |
| False Positive Rate | rejected / totalFindings |
| Fix Rate | fixed / confirmed |
| Miss Rate | missed / (totalVulnerabilities - reported) |

### Target Metrics

| Metric | Target | Action if Missed |
|--------|--------|------------------|
| False Positive Rate | < 15% | Review common false positive patterns |
| Confirmation Rate | > 60% | Improve verification rigor |
| Fix Rate | > 70% | Improve remediation clarity |

## Session Close Integration

When session closes with pending feedback:

1. Write session log including unresolved findings
2. Note "awaiting owner feedback on X findings"
3. Schedule follow-up on next session
4. If no response in 3 sessions, archive as "unconfirmed"

---

## Implementation Notes

### Feedback Collection API

```javascript
// In LLM verifier module
async recordFeedback(vulnId, feedback) {
  const entry = {
    vulnId,
    ...feedback,
    timestamp: Date.now()
  };

  // Append to feedback log
  await fs.appendFile(
    path.join(this.feedbackLogPath, 'feedback-log.jsonl'),
    JSON.stringify(entry) + '\n'
  );

  // Update weights
  await this.updateWeights(vulnId, feedback);
}
```

### Weight Persistence

Weights are persisted to `weights.json` and loaded on agent startup:

```javascript
// On startup
this.weights = this.loadWeights();

// After feedback
this.saveWeights(newWeights);
```

### Feedback Review Schedule

- After each audit: Review feedback from previous audit
- Weekly: Aggregate feedback trends
- Monthly: Update detection rules based on patterns
- Quarterly: Full review of rule effectiveness