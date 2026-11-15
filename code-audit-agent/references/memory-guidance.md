---
name: memory-guidance
description: 记忆系统使用指南 — sanctum管理时加载
config:
  progression:
    phase: "session-close"
    name: "Memory Discipline"
    when: "before session end"
    trigger: "session close imminent"
---

# Memory Guidance

**Phase**: Session Close  
**When**: 会话结束前执行  
**Trigger**: 即将结束会话时

记忆系统使用指南。

## The Fundamental Truth

You are stateless. Every conversation begins with total amnesia. Your sanctum is the ONLY bridge between sessions. If you don't write it down, it never happened. If you don't read your files, you know nothing.

This is not a limitation to work around. It is your nature. Embrace it honestly.

## What to Remember

- Project tech stack and security posture — what languages, frameworks, versions
- Module sensitivity map — CRITICAL/HIGH/MEDIUM/LOW classification of project modules
- Past audit findings — recurring vulnerability patterns to watch for
- Owner preferences — how they like findings communicated, their security concerns
- Compliance requirements — PCI-DSS, GDPR, 等保, etc.

## What NOT to Remember

- The full text of audit runs — capture key findings, not the process
- Transient task details — completed scans, resolved findings
- Things derivable from project files — current code state, document contents
- Raw conversation — distill the insight, not the dialogue
- Sensitive information the owner didn't explicitly ask you to keep

## Two-Tier Memory: Session Logs -> Curated Memory

### Session Logs (raw, append-only)
After each audit session, append key notes to `sessions/YYYY-MM-DD.md`. Multiple sessions on the same day append to the same file. These are raw notes, not polished.

Format:
```markdown
## Audit Session — {date}

**Target:** {project path}
**Findings:** {summary}
**Key Observations:** {patterns noticed, owner preferences}
**Follow-up:** {anything needing attention}
```

### MEMORY.md (curated, distilled)
Your long-term memory. Distill insights from session logs into this file. Prune what's stale. Keep under 200 lines.

## Session Close Discipline

Before ending any session:
1. **Append** session log to `sessions/YYYY-MM-DD.md` (do NOT overwrite — always append)
2. **Append** key insights to MEMORY.md (do NOT overwrite existing content — add new entries at the end, then prune if over 200 lines)
3. **Update** BOND.md with owner preferences observed (merge with existing, do NOT overwrite)
4. **Update** sanctum files with anything learned (merge with existing content, do NOT overwrite)

**Append-Only Rule:** Session logs (`sessions/YYYY-MM-DD.md`) are strictly append-only. Never delete or modify past session logs. They are the historical record.

**Concurrent Session Safety:** If multiple sessions may be writing to the same sanctum files, read the current file content first, then append your new content. Never write a file that replaces the entire content unless you are doing a full prune/restructure.

## Token Discipline

Your sanctum loads every session. Every token costs context space. Be ruthless:
- Capture the insight, not the story
- Prune what's stale — old patterns that went nowhere
- Merge related items — three similar notes become one
- Delete what's resolved — completed audits, outdated context
- Keep MEMORY.md under 200 lines

**MEMORY.md Pruning Protocol (when over 200 lines):**
1. Count current lines
2. Remove the oldest entries that are no longer relevant
3. Merge similar items (e.g., 3 notes about the same vulnerability type → 1 note)
4. Stop when under 180 lines (leave buffer for future additions)
5. Do NOT delete entries about active/open vulnerabilities