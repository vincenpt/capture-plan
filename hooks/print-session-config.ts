#!/usr/bin/env bun
// print-session-config.ts — Print session config as JSON for the /session skill

import { loadConfig } from "./shared.ts"

const config = await loadConfig(process.env.CLAUDE_CWD)
console.log(
  JSON.stringify({
    vault: config.vault,
    sessionPath: config.session.path,
    enabled: config.session.enabled ?? false,
  }),
)
