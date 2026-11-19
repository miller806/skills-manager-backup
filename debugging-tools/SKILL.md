---
name: debugging-tools
description: "Debugger tool reference: pdb, debugpy, node inspect, CDP, and Hermes TUI debugging."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [debugging, python, nodejs, debugpy, pdb, cdp, tui, breakpoints]
    related_skills: [systematic-debugging]
---

# Debugger Tools Reference

Umbrella skill for language-specific and platform-specific debugger tooling. For the debugging methodology (root cause before fixing), load `systematic-debugging`.

---

## Python Debugging (pdb + debugpy)

### Three tools, pick by situation

| Tool | When |
|---|---|
| **`breakpoint()` + pdb** | Local, interactive, simplest. Add in source, run normally, get REPL. |
| **`python -m pdb`** | Launch script under pdb with no source edits. |
| **`debugpy`** | Remote / headless / attach to already-running process. DAP protocol. |

**Start with `breakpoint()`.** It's the cheapest thing that works.

### Quick pdb reference

| Command | Action |
|---|---|
| `n` | step over | `s` | step into | `c` | continue |
| `r` | return from function | `w` | where (stack) | `a` | print args |
| `p expr` | print expression | `pp expr` | pretty-print | `l` | list source |
| `b file:line` | set breakpoint | `cl N` | clear breakpoint |
| `interact` | drop into full Python REPL | `q` | quit |

### Debugging pytest tests
```bash
python -m pytest tests/foo.py::test_bar --pdb -p no:xdist
```
**Never use pdb under xdist** — it silently hangs.

### Remote debug with debugpy
```python
import debugpy
debugpy.listen(("127.0.0.1", 5678))
debugpy.wait_for_client()
debugpy.breakpoint()
```

Or no source edit: `python -m debugpy --listen 127.0.0.1:5678 --wait-for-client script.py`

**Alternative: `remote-pdb`** — cleanest for terminal agents:
```python
from remote_pdb import set_trace
set_trace(host="127.0.0.1", port=4444)
# Then: nc 127.0.0.1 4444 → get (Pdb) prompt
```

### Pitfalls
- `PYTHONBREAKPOINT=0` disables all `breakpoint()` calls
- pdb under xdist silently does nothing — always use `-p no:xdist`
- `breakpoint()` in CI hangs — never commit it
- `debugpy.listen` only blocks if you also call `wait_for_client()`
- For asyncio, `await` inside pdb needs Python 3.13+ or `interact` mode

---

## Node.js Debugging (node inspect + CDP)

### Two tools, pick one

- **`node inspect`** — built-in, zero install, CLI REPL. Best for quick poking.
- **CDP via `chrome-remote-interface`** — scriptable, best for automation.

**Prefer `node inspect` first.**

### Quick reference
```bash
node inspect path/to/script.js        # Launch paused on first line
node --inspect-brk script.js          # Listen AND pause on first line
node inspect -p <pid>                 # Attach to running process
```

**debug> REPL:**
| Command | Action |
|---|---|
| `c` | continue | `n` | step over | `s` | step into | `o` | step out |
| `sb('file.js', 42)` | set breakpoint | `cb('file.js', 42)` | clear |
| `repl` | drop into REPL | `bt` | backtrace |

### Debugging Hermes ui-tui
```bash
cd ui-tui && npm run build
node --inspect-brk dist/entry.js
# In another terminal: node inspect -p <pid>
```

### Pitfalls
- Wrong line numbers in TS source — breakpoints hit emitted JS, not `.ts`
- `--inspect` vs `--inspect-brk` — without `-brk`, script races past breakpoints
- Port collisions (default 9229) — use `--inspect=0` for random port
- Child processes need `NODE_OPTIONS='--inspect-brk'` to inherit

---

## Hermes TUI Slash Commands Debugging

When a slash command misbehaves (missing from autocomplete, works in CLI but not TUI), the bug is almost always one layer out of sync.

### Architecture
```
Python backend (hermes_cli/commands.py)  ← canonical COMMAND_REGISTRY
       ↓
TUI gateway (tui_gateway/server.py)      ← slash.exec / command.dispatch
       ↓
TUI frontend (ui-tui/src/app/slash/)     ← local handlers + fallthrough
```

### Common issues
1. **Command in TUI but not autocomplete** → missing from `COMMAND_REGISTRY` in `hermes_cli/commands.py`
2. **Command in autocomplete but doesn't work** → check `tui_gateway/server.py` and `ui-tui/src/app/createSlashHandler.ts`
3. **Behavior differs CLI vs TUI** → different implementations in `cli.py::process_command` vs TUI local handler
4. **Config persists but doesn't apply live** → must also patch nanostore state (`patchUiState(...)`)

### Fix pattern
1. Add `CommandDef` to `COMMAND_REGISTRY` in `hermes_cli/commands.py`
2. Pick `cli_only=True` vs gateway availability carefully
3. Ensure `subcommands` matches TUI tab-completion
4. Add handler in `cli.py::process_command()` (Python side) and/or `gateway/run.py`
5. Rebuild TUI: `npm --prefix ui-tui run build`

### Deeper debugging
- **Python side:** use `python-debugpy` skill (break inside `_SlashWorker.exec`)
- **Ink side:** use `node-inspect-debugger` skill (break in `app.tsx` slash dispatch)
