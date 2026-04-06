#!/usr/bin/env bun
// set-session-enabled.ts — Set session.enabled in a TOML config file
// Usage: bun hooks/set-session-enabled.ts <scope> <enabled>
//   scope: "project" | "user"
//   enabled: "true" | "false"

import { homedir } from "node:os"
import { join } from "node:path"
import { setTomlValue } from "./shared.ts"

const [scope, enabledStr] = process.argv.slice(2)

if (!scope || !enabledStr) {
  console.error("Usage: set-session-enabled.ts <project|user> <true|false>")
  process.exit(1)
}

const enabled = enabledStr === "true"
const cwd = process.env.CLAUDE_CWD ?? process.cwd()

const targetPath =
  scope === "project"
    ? join(cwd, ".claude", "capture-plan.toml")
    : join(homedir(), ".config", "capture-plan", "config.toml")

setTomlValue(targetPath, "session", "enabled", enabled)

console.log(JSON.stringify({ scope, path: targetPath, enabled }))
