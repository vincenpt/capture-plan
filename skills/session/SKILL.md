---
name: session
description: Toggle session document capture on or off. Use /session on, /session off, or /session to toggle.
---

# Session Toggle

Toggle the capture-session hook on or off. State is persisted in the TOML config cascade.

## Arguments

- `on` — enable session capture
- `off` — disable session capture
- *(no argument)* — toggle current state

## Procedure

### 1. Read current config

Run the config printer to discover current state:

```bash
CLAUDE_CWD="$PWD" bun ${CLAUDE_PLUGIN_ROOT}/hooks/print-session-config.ts
```

Parse the JSON output to get `enabled` (boolean).

### 2. Determine target state

- If the user passed `on` → target = `true`
- If the user passed `off` → target = `false`
- If no argument → invert current `enabled` value

### 3. Ask where to save

Ask the user:

> Where should session state be saved?
> 1. **Project-local** (`.claude/capture-plan.toml` in this repo)
> 2. **User-global** (`~/.config/capture-plan/config.toml`)

Wait for the user's answer before proceeding.

### 4. Apply state

Run the setter script with the chosen scope:

```bash
CLAUDE_CWD="$PWD" bun ${CLAUDE_PLUGIN_ROOT}/hooks/set-session-enabled.ts <scope> <target>
```

Where `<scope>` is `project` or `user`, and `<target>` is `true` or `false`.

### 5. Confirm

Tell the user:
- "Session capture is now **ON**." (if target is `true`)
- "Session capture is now **OFF**." (if target is `false`)
- Include which config file was updated.
- Note: the setting takes effect on the next session start (restart Claude Code).
