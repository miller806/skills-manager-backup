---
name: obsidian
description: "Work with Obsidian vaults (plain Markdown notes) and automate via obsidian-cli."
description_zh: "Obsidian 知识库管理与自动化"
description_en: "Manage and automate Obsidian vaults"
version: 1.0.0
homepage: https://help.obsidian.md
metadata: {"clawdbot":{"emoji":"💎","requires":{"bins":["obsidian-cli"]},"install":[{"id":"brew","kind":"brew","formula":"yakitrak/yakitrak/obsidian-cli","bins":["obsidian-cli"],"label":"Install obsidian-cli (brew)"}]}}
---

# Obsidian

Obsidian vault = a normal folder on disk.

## Install the CLI (once)

The upstream project was renamed: `yakitrak/obsidian-cli` → `Yakitrak/notesmd-cli`, and the binary it builds is `notesmd-cli`.

```bash
# macOS / Linux via Homebrew
y brew install yakitrak/yakitrak/obsidian-cli

# Any platform via Go (works on Windows; binary lands in $(go env GOPATH)/bin)
go install github.com/Yakitrak/notesmd-cli@latest
```

Either way the CLI must be invocable as `obsidian-cli`. With the Go route the binary is `notesmd-cli`, so also provide an `obsidian-cli` copy on PATH (on Windows: `copy notesmd-cli.exe obsidian-cli.exe` in `%GOPATH%\bin`).

Verify: `obsidian-cli --version` and `obsidian-cli list-vaults`.

Vault structure (typical)
- Notes: `*.md` (plain text Markdown; edit with any editor)
- Config: `.obsidian/` (workspace + plugin settings; usually don’t touch from scripts)
- Canvases: `*.canvas` (JSON)
- Attachments: whatever folder you chose in Obsidian settings (images/PDFs/etc.)

## Find the active vault(s)

Obsidian desktop tracks vaults here (source of truth):
- macOS: `~/Library/Application Support/obsidian/obsidian.json`
- Windows: `%APPDATA%\obsidian\obsidian.json`

`obsidian-cli` resolves vaults from that file; vault name is typically the **folder name** (path suffix).

Fast “what vault is active / where are the notes?”
- Registered vaults: `obsidian-cli list-vaults`
- Default vault only: `obsidian-cli list-vaults --default`
- Default vault path only: `obsidian-cli list-vaults --default --path-only`
- Otherwise, read the `obsidian.json` above and use the vault entry with `"open": true`.

Notes
- Multiple vaults common (iCloud vs `~/Documents`, work/personal, etc.). Don’t guess; read config.
- Avoid writing hardcoded vault paths into scripts; prefer reading the config or using `list-vaults --default`.

## obsidian-cli quick start

Pick a default vault (once):
- `obsidian-cli set-default-vault "<vault-folder-name>"`
- `obsidian-cli list-vaults --default` / `obsidian-cli list-vaults --default --path-only`

Search — **read this before calling `search`**
- `obsidian-cli search` is now an **interactive fuzzy finder (TUI)** and takes no query argument. In an agent / non-TTY shell it prints `unknown command "<query>"` or waits for keys and hangs. Do not use it from a script.
- Note content: `obsidian-cli search-content "query" --no-interactive` (add `--format json` for parsing, `--page-size 100` for more hits).
- Note names / paths: `obsidian-cli list "<folder>"` and filter, or `obsidian-cli open "<note name>"` when you know the name.

Read
- `obsidian-cli print "path/note"`

Create
- `obsidian-cli create "Folder/New note" --content "..." --open`
- Requires Obsidian URI handler (`obsidian://…`) working (Obsidian installed).
- Avoid creating notes under “hidden” dot-folders (e.g. `.something/...`) via URI; Obsidian may refuse.

Move/rename (safe refactor)
- `obsidian-cli move "old/path/note" "new/path/note"`
- Updates `[[wikilinks]]` and common Markdown links across the vault (this is the main win vs `mv`).

Delete
- `obsidian-cli delete "path/note"`

Prefer direct edits when appropriate: open the `.md` file and change it; Obsidian will pick it up.
