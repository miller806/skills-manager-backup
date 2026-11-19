---
name: kanban
description: "Hermes Kanban multi-agent collaboration: orchestrator decomposition, worker pitfalls, and Codex lane conventions."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
environments: [kanban]
metadata:
  hermes:
    tags: [kanban, multi-agent, orchestration, workflow, pitfalls, codex-lane]
    related_skills: [hermes-agent, coding-agents]
---

# Kanban — Multi-Agent Collaboration

Umbrella skill for all Hermes Kanban workflows. Covers orchestrator decomposition, worker pitfalls, handoff shapes, and the Codex lane convention.

---

## Orchestrator: Decomposition Playbook

**Core rule:** Route, don't execute. Decompose multi-lane requests, assign to profiles, link dependencies.

### Step 0: Discover available profiles
```bash
hermes profile list
```
**Never invent profile names** — the dispatcher silently drops unknown assignees; cards just sit in `ready` forever.

### When to use the board
Create Kanban tasks when: multiple specialists needed, work should survive crash/restart, human-in-the-loop expected, parallel lanes possible, audit trail matters, or review/iteration expected. Otherwise use `delegate_task`.

### Anti-temptation rules
- **Do not execute the work yourself.**
- **Split multi-lane requests before creating cards.** Independent lanes → parallel cards.
- **Use `parents=[...]` for true dependencies.** Don't create dependent work as independent ready cards.
- **Decompose, route, and summarize — that's the whole job.**

### Decomposition playbook
1. Understand the goal, ask clarifying questions if ambiguous
2. Sketch the task graph — extract lanes, map to profiles, decide independent vs gated
3. Create tasks and link — create parents first, capture ids, include in child `parents` list
4. Complete your own task with summary of what you created
5. Report back to user in plain prose

### Common patterns
- **Fan-out + fan-in:** N research cards (no parents) → one synthesis card (all as parents)
- **Pipeline with gates:** `planner → implementer → reviewer` with parent links
- **Same-profile queue:** N tasks, same profile, no dependencies — dispatcher serializes
- **Human-in-the-loop:** Any task can `kanban_block()` to wait for input

### Goal-mode cards (persistent workers)
For open-ended cards where one turn rarely finishes:
```python
kanban_create(title="...", body="...", assignee="<profile>", goal_mode=True, goal_max_turns=15)
```
An auxiliary judge evaluates after each turn. Write the body as explicit acceptance criteria.

### Recovering stuck workers
1. **Reclaim** — abort running worker, reset to `ready`
2. **Reassign** — switch to different profile
3. **Change profile model** — edit config, then reclaim

---

## Worker: Pitfalls and Edge Cases

The lifecycle (6 steps: orient → work → heartbeat → block/complete) is auto-injected as `KANBAN_GUIDANCE`. This skill covers deeper detail.

### Workspace handling
| Kind | What it is | How to work |
|---|---|---|
| `scratch` | Fresh tmp dir, yours alone | Read/write freely; GC'd when archived |
| `dir:<path>` | Shared persistent directory | Other runs read what you write |
| `worktree` | Git worktree at resolved path | If no `.git`, run `git worktree add` first |

### Good handoff shapes
```python
# Coding task
kanban_complete(
    summary="shipped rate limiter — token bucket, 14 tests pass",
    metadata={"changed_files": ["rate_limiter.py"], "tests_run": 14, "tests_passed": 14}
)

# Needs human review (block instead of complete)
kanban_comment(body=json.dumps({"changed_files": [...], "diff_path": "..."}))
kanban_block(reason="review-required: needs eyes on X before merging")
```

### Claiming cards you created
Only list ids captured from successful `kanban_create` return values. Never invent ids.

### Block reasons that get answered fast
Bad: `"stuck"`. Good: one sentence naming the specific decision needed.

### Do NOT
- Call `delegate_task` as substitute for `kanban_create`
- Call `clarify` — you're headless. Use `kanban_comment` + `kanban_block` instead
- Modify files outside `$HERMES_KANBAN_WORKSPACE`
- Complete a task you didn't actually finish

### Retry diagnostics
- `outcome: "timed_out"` — previous hit max_runtime; chunk the work
- `outcome: "crashed"` — OOM; reduce memory footprint
- `outcome: "spawn_failed"` — profile config issue; block and ask human
- `outcome: "blocked"` — previous blocked; check unblock comment in thread

---

## Codex Lane Convention

When a Kanban worker uses Codex CLI as an isolated implementation lane.

### Ownership rules
1. **Hermes owns the Kanban lifecycle** — Codex never calls kanban tools
2. **Hermes owns final acceptance** — treat Codex commits as untrusted patches
3. **Hermes owns test execution** — repeat verification from Hermes
4. **Hermes owns safety** — reject if Codex changes safety boundaries
5. **Hermes owns cleanup** — kill stuck processes, remove worktrees

### Required worktree pattern
```bash
TASK_ID="${HERMES_KANBAN_TASK:-t_manual}"
SAFE_TASK="$(printf '%s' "$TASK_ID" | tr -cd '[:alnum:]_-')"
BRANCH="codex/${SAFE_TASK}/$(date -u +%Y%m%d%H%M%S)"
WORKTREE="/tmp/${SAFE_TASK}-codex-lane"
git worktree add -b "$BRANCH" "$WORKTREE" "$BASE"
```

### Mode selection
- **`codex exec --full-auto`** — bounded one-shot edits
- **Codex `/goal`** — broader multi-step work with durable objective tracking
- **Never `--yolo`** for safety-sensitive repos

### Reconciliation checklist
- [ ] `git status --short` shows only expected files
- [ ] `git diff` reviewed by Hermes
- [ ] No secrets/credentials included
- [ ] Hermes ran canonical tests independently
- [ ] `kanban_complete.metadata.codex_lane` follows schema
- [ ] Temporary processes/worktrees cleaned up

### Metadata schema
```json
{
  "codex_lane": {
    "used": true,
    "mode": "exec|goal|skipped",
    "result": "accepted|rejected|partial|timed_out",
    "rejected_reason": "...",
    "tests_run": [{"command": "...", "exit_code": 0, "owner": "hermes"}]
  }
}
```

The Codex lane prompt template is available at `templates/pmb-codex-lane-prompt.md`.
