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

### 3. Run tests

Run `bun test` and confirm all tests pass. If tests fail, stop and fix before continuing.

### 4. Commit and tag

```bash
git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json
git commit -m "release: v{VERSION}"
git tag v{VERSION}
```

### 5. Generate changelog

Get the commit log since the previous tag:

```bash
git log $(git describe --tags --abbrev=0 HEAD^)..HEAD --oneline --no-decorate
```

If there is no previous tag, use `git log --oneline --no-decorate` for the full history.

### 6. Push and create GitHub release

```bash
git push && git push --tags
```

Then create the release using `gh`:

```bash
gh release create v{VERSION} --title "v{VERSION}" --notes "{CHANGELOG}"
```

Format the changelog as a markdown list with each commit as a bullet point. Exclude the release commit itself.

### 7. Confirm

Print the release URL returned by `gh release create`.
