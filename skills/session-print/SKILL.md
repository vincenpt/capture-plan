---
name: session-print
description: Display current session details including ID, duration, turn counts, token usage, and tool stats.
---

# Session Details

Display current session statistics and activity breakdown.

## Procedure

### 1. Run the session printer

```bash
CLAUDE_CWD="$PWD" bun ${CLAUDE_PLUGIN_ROOT}/hooks/print-session.ts
```

Parse the JSON output.

### 2. Check for errors

If `error` is not null, display a warning with the error message and stop.

### 3. Display session info

Render a markdown table:

| Field | Value |
|-------|-------|

Include these rows:
- **Session** — `session.shortId` (the full `session.id` in parentheses)
- **Project** — `session.project`
- **Model** — `session.model`
- **CC Version** — `session.ccVersion`
- **Source** — `session.source`
- **Started** — `session.started` formatted as a human-readable local time
- **Duration** — `session.durationHuman`
- **Context Cap** — `session.contextCap` formatted with thousands separators, or `(auto)` if null
- **Session Capture** — `session.sessionEnabled` as ON/OFF

### 4. Display activity counts

Render a markdown table:

| Metric | Count |
|--------|-------|

Include:
- **Prompts** — `events.prompts`
- **Plan Mode Entries** — `events.planEntries`
- **Compactions** — `events.compactions`
- **Subagent Launches** — `events.subagentLaunches`

If `transcript` is not null, also include:
- **Total Turns** — number of entries in `transcript.tools`
- **Total Tool Calls** — `transcript.totalToolCalls`
- **Total Errors** — `transcript.totalErrors`
- **Subagents (transcript)** — `transcript.subagentCount`

### 5. Display token usage

Skip this section if `transcript` is null.

Render a markdown table:

| Token Type | Count |
|------------|-------|

- **Input** — `transcript.tokens.input`
- **Output** — `transcript.tokens.output`
- **Cache Read** — `transcript.tokens.cacheRead`
- **Cache Create** — `transcript.tokens.cacheCreate`
- **Total** — `transcript.tokens.total`
- **Peak Turn Context** — `transcript.peakTurnContext`

Format all numbers with thousands separators.

### 6. Display top tools

Skip this section if `transcript` is null or `transcript.tools` is empty.

Render a markdown table of the top 10 tools sorted by calls:

| Tool | Calls | Errors |
|------|-------|--------|

### 7. Display MCP servers

Skip this section if `transcript` is null or `transcript.mcpServers` is empty.

Render a markdown table:

| Server | Tools | Calls |
|--------|-------|-------|

Show the count of tools per server in the Tools column and list tool names in parentheses.
