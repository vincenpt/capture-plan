---
name: release
description: Use when the user wants to release a new version of the capture-plan plugin. Bumps version numbers, commits, tags, pushes, and creates a GitHub release.
---

# Release

Automate version bumping and GitHub release creation for the capture-plan plugin.

## Arguments

The user provides a bump type as an argument: `major`, `minor`, or `patch`. Default to `patch` if not specified.

## Procedure

### 1. Determine new version

Read `package.json` to get the current version. Parse it as `major.minor.patch` and increment the appropriate segment:

- `patch`: `1.3.0` → `1.3.1`
- `minor`: `1.3.0` → `1.4.0`
- `major`: `1.3.0` → `2.0.0`

### 2. Update all version files

Update the version string in ALL of these files — missing any one will cause the plugin system to not detect the update:

| File | Fields to update |
|------|-----------------|
| `package.json` | `"version"` |
| `.claude-plugin/plugin.json` | `"version"` |
| `.claude-plugin/marketplace.json` | `"metadata"."version"` AND `"plugins"[0]."version"` (two occurrences) |

Use the Edit tool with `replace_all: true` for marketplace.json since both version fields should have the same value.

### 3. Generate changelog (before committing)

Generate the changelog **before** the release commit so it captures meaningful changes:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline --no-decorate
```

If there is no previous tag, use `git log --oneline --no-decorate` for the full history.

Format as a markdown bullet list. If the only commits are previous release commits (no feature/fix commits), use a single line: `Patch release — version bump only.`

### 4. Run tests

Run `bun test` and confirm all tests pass. If tests fail, stop and fix before continuing.

### 5. Commit and tag

GPG signing is enabled — tags require the `-m` flag or they fail with "no tag message?".

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "release: v{VERSION}"
git tag -m "v{VERSION}" v{VERSION}
```

### 6. Push and create GitHub release

```bash
git push && git push --tags
```

Then create the release using `gh` with the changelog from step 3:

```bash
gh release create v{VERSION} --title "v{VERSION}" --notes "{CHANGELOG}"
```

### 7. Update local marketplace cache

> **Workaround for CLI bug** ([anthropics/claude-code#37252](https://github.com/anthropics/claude-code/issues/37252)):
> `claude plugin update` reads versions from a local git clone without fetching from the remote first.

Pull the latest into the marketplace cache so `claude plugin update` detects the new version immediately:

```bash
if [ -d ~/.claude/plugins/marketplaces/capture-plan ]; then
  cd ~/.claude/plugins/marketplaces/capture-plan && git pull origin main
fi
```

Skip silently if the directory doesn't exist (e.g., plugin not installed locally).

### 8. Confirm

Print the release URL returned by `gh release create`.

Verify the marketplace cache is current:

```bash
cd ~/.claude/plugins/marketplaces/capture-plan && git log --oneline -1
```

Confirm the latest commit message matches `release: v{VERSION}`.
