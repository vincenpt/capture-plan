---
description: "Run end-to-end roundtrip migration test. Asks which path (plan/journal), detects current scheme, lets you pick target scheme, then runs a full roundtrip with integrity verification."
---

# E2E Migration Test

Interactive roundtrip migration test with content integrity verification. Uses real Obsidian CLI and vault. Checks MD5 hashes, file counts, directory counts, and stationary file integrity.

## Procedure

### 1. Check dev mode

```bash
ls -la ~/.claude/plugins/cache/kriswill/capture-plan/
```

If the cache directory is a symlink, the test runs against local code (dev mode). If it's a regular directory, warn the user: "Note: dev mode is not active — this will test the installed (released) version, not local code. Run `/start-dev` first to test local changes."

### 2. Ask which path to migrate

Ask the user: **Which path do you want to test migration on?**
- `plan` — plan directories
- `journal` — journal files

### 3. Detect current scheme

Load the config and detect which date schemes are present via the Obsidian CLI.

```bash
bun -e "
import { loadConfig } from './hooks/lib/config.ts';
import { detectVaultSchemes } from './hooks/lib/migration.ts';
const config = await loadConfig();
const PATH_TYPE = 'PLACEHOLDER'; // replace with 'plan' or 'journal'
const configuredScheme = config[PATH_TYPE].date_scheme;
const detected = detectVaultSchemes(config[PATH_TYPE].path, config.vault);
console.log(JSON.stringify({ configuredScheme, detected: [...detected] }));
"
```

Replace `PLACEHOLDER` with the user's choice from step 2.

Report to the user: "Current configured scheme is **X**. Detected on disk: **Y**."

### 4. Ask target scheme

The four available schemes are: `calendar`, `compact`, `monthly`, `flat`.

Present the viable targets — all schemes **except** the current detected scheme(s). Ask the user: **Which target scheme do you want to test migration to?**

List the options as a numbered list.

### 5. Run the test

Run the e2e migration test, passing the user's choices:

```bash
bun hooks/e2e-migration-test.ts --path TYPE --from FROM_SCHEME --to TO_SCHEME
```

Replace `TYPE` with `plan` or `journal`, `FROM_SCHEME` with the detected scheme, and `TO_SCHEME` with the user's chosen target.

### 6. Report

Relay the structured pass/fail output to the user. If any checks failed, suggest investigating:
- `/tmp/capture-plan-debug.log`
- `/tmp/capture-done-debug.log`
