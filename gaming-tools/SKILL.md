---
name: gaming-tools
description: "Game server hosting (Minecraft modpacks) and headless emulator gameplay (Pokemon)."
version: 1.0.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [gaming, Minecraft, modpack, server, Pokemon, emulator, headless]
---

# Gaming Tools

Umbrella for game-related automation and server management.

---

## Minecraft Modpack Server

Host modded Minecraft servers using CurseForge or Modrinth modpacks.

**When to use:** User wants to set up a modded Minecraft server, install a modpack, or manage a server instance.

**Key steps:**
1. Choose modpack source (CurseForge or Modrinth)
2. Download modpack and server files
3. Configure server properties (memory, port, game rules)
4. Start server with appropriate JVM flags
5. Manage server lifecycle (start/stop/restart/backup)

---

## Pokemon Player

Play Pokemon via headless emulator + RAM reads.

**When to use:** User wants to automate Pokemon gameplay through an emulator.

**Key concepts:**
- Headless emulator runs the game without display
- RAM reads extract game state (party, items, map position)
- Automated input drives gameplay
