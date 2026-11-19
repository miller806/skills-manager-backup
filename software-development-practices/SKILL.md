---
name: software-development-practices
description: "Use when following disciplined software development: TDD, systematic debugging, code spikes, pre-commit review, or parallel cleanup. Covers the full development lifecycle."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [development, methodology, testing, debugging, code-review, tdd, spike, refactor, quality]
    related_skills: [plan, subagent-driven-development]
---

# Software Development Practices

Disciplined development practices that prevent bugs, reduce rework, and improve code quality. These skills are designed to be used together — TDD for new code, systematic-debugging for issues, code-review before commit, spike for feasibility, simplify-code for cleanup.

## When to Use This Skill

- **New feature or bug fix**: Start with `test-driven-development`
- **Debugging an issue**: Use `systematic-debugging`
- **Validating feasibility before building**: Use `spike`
- **Before committing code**: Use `requesting-code-review`
- **After a task**: Use `simplify-code` for cleanup

---

## Systematic Debugging

**4-phase root cause debugging: understand bugs before fixing.**

### The Iron Law

```
NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST
```

### The Four Phases

**Phase 1: Root Cause Investigation**
- Read error messages carefully — they often contain the exact solution
- Reproduce consistently: what are the exact steps?
- Check recent changes: git diff, commits, new deps
- In multi-component systems: add diagnostic instrumentation at each boundary before proposing fixes
- Trace data flow upstream to find the true source

**Phase 2: Pattern Analysis**
- Find similar working code in the same codebase
- Compare against reference implementations
- Identify every difference, however small

**Phase 3: Hypothesis and Testing**
- Form ONE clear hypothesis: "X is the root cause because Y"
- Make the smallest possible change to test
- If ≥3 fixes have failed: question the architecture, not the code

**Phase 4: Implementation**
- Create a failing test case before fixing
- Fix ONE thing at a time
- Verify: run the regression test

### Red Flags — STOP

- "Quick fix for now, investigate later"
- "Just try changing X and see if it works"
- "Add multiple changes, run tests"
- "One more fix attempt" (after already trying 2+)
- Each fix reveals a new problem in a different place

**If 3+ fixes failed:** Question the architecture — discuss with the user before attempting more fixes.

---

## Test-Driven Development (TDD)

**Write the test first. Watch it fail. Write minimal code to pass.**

### The Iron Law

```
NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
```

### Red-Green-Refactor Cycle

**RED — Write Failing Test**
- One minimal test showing what should happen
- Clear descriptive name ("and" in name? Split it)
- Real code, not mocks (unless truly unavoidable)

**GREEN — Minimal Code**
- Simplest code to pass the test. Nothing more.
- Cheating is OK: hardcode, copy-paste, skip edge cases

**REFACTOR — Clean Up**
- Remove duplication, improve names, extract helpers
- Keep tests green throughout

### Why Order Matters

- Tests written after code pass immediately → proves nothing
- Test-first forces you to see the test fail → proves it tests something real
- "I'll write tests after" → tests-after = "what does this do?" not "what should this do?"

### Common Rationalizations (All False)

| Excuse | Reality |
|--------|---------|
| "Too simple to test" | Simple code breaks. Test takes 30 seconds. |
| "I'll test after" | Tests passing immediately prove nothing. |
| "Deleting X hours is wasteful" | Sunk cost. Keeping unverified code is technical debt. |
| "TDD will slow me down" | TDD faster than debugging. |

---

## Spike

**Throwaway experiments to validate an idea before building.**

### When to Use

Trigger when user says: "let me try this", "I want to see if X works", "spike this out", "before I commit to Y", "quick prototype of Z", "is this even possible?", "compare A vs B".

### When NOT to Use

- The answer is knowable from docs — just do research
- The work is production path — use the `plan` skill
- The idea is already validated — jump straight to implementation

### The Method

```
decompose → research → build → verdict
   ↑__________________________________↓
              iterate on findings
```

1. **Decompose**: Break into 2-5 independent feasibility questions
2. **Align**: Present spike table, ask user for order
3. **Research**: Brief + surface approaches + pick one
4. **Build**: One directory per spike, bias toward interactive output
5. **Verdict**: VALIDATED / PARTIAL / INVALIDATED with evidence

### Output Structure

```
spikes/
├── 001-websocket-streaming/
│   ├── README.md
│   └── main.py
├── 002a-pdf-parse-pdfjs/
└── 002b-pdf-parse-camelot/
```

Each README closes with a verdict table.

---

## Pre-Commit Code Review

**Automated verification pipeline before code lands.**

### The Core Principle

> No agent should verify its own work. Fresh context finds what you miss.

### The Pipeline

**Step 1 — Get the diff**
```bash
git diff --cached  # staged changes
git diff HEAD~1 HEAD  # last commit
```

**Step 2 — Static security scan** (scan added lines only)
```bash
# Hardcoded secrets
git diff --cached | grep "^+" | grep -iE "(api_key|secret|password|token)\s*=\s*['\"][^'\"]{6,}['\"]"
# Shell injection
git diff --cached | grep "^+" | grep -E "os\.system\(|subprocess.*shell=True"
# Dangerous eval/exec
git diff --cached | grep "^+" | grep -E "\beval\(|\bexec\("
# SQL injection
git diff --cached | grep "^+" | grep -E "execute\(f\"|\.format\(.*SELECT"
```

**Step 3 — Baseline tests and linting**
- Detect project language, run appropriate tools
- Compare failure count BEFORE changes (stash, run, pop)
- Only NEW failures block the commit

**Step 4 — Independent reviewer subagent** (via delegate_task)
- Reviewer gets ONLY diff + scan results, no shared context
- Security concerns or logic errors → FAIL

**Step 5 — Auto-fix loop** (max 2 cycles)
- Fix-only agent addresses reported issues
- Re-run full verification cycle

**Step 6 — Commit**
```bash
git add -A && git commit -m "[verified] <description>"
```

---

## Simplify Code

**Parallel 3-agent cleanup of recent code changes.**

### When to Use

Trigger when user says: "simplify", "simplify my changes", "review my code", "clean up my changes".

### The Method

**Phase 1 — Identify changes**
```bash
git diff              # default: uncommitted changes
git diff --staged     # staged changes
git diff HEAD~1       # last commit
```

**Phase 2 — Launch three reviewers in parallel** (via delegate_task batch)

- **Reviewer 1 — Code Reuse**: Finds duplicate functionality already in the codebase
- **Reviewer 2 — Code Quality**: Finds redundant state, parameter sprawl, copy-paste variation, leaky abstractions
- **Reviewer 3 — Efficiency**: Finds unnecessary work, missed concurrency, hot-path bloat, TOCTOU anti-patterns

Each reviewer gets the COMPLETE diff + repo path. They search, not guess.

**Phase 3 — Aggregate and apply**
1. Merge findings, deduplicate
2. Discard false positives
3. Resolve conflicts (correctness > stated focus > readability > micro-perf)
4. Apply surviving fixes with `patch` / `write_file`
5. Verify: run targeted tests + linter

### Pitfalls

- Don't fan out wider than 3 reviewers
- Give the WHOLE diff to each reviewer
- Apply ≠ rewrite — scope edits to what the diff touched
- Large diffs (>2000 lines) should be scoped first

---

## Integration

These skills compose across the development lifecycle:

```
spike → validate feasibility
         ↓
plan → define what to build
         ↓
TDD → write tests first
         ↓
implement → pass tests
         ↓
code-review → verify quality
         ↓
simplify → cleanup
         ↓
git commit
```

Debugging: `systematic-debugging` at any point when issues arise.
