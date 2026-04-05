# Spec 008: gh_auto — Automatic GitHub Account Switching

## Problem
`gh auth switch` is broken with Enterprise Managed User (EMU) accounts. Even after switching, the API still uses the EMU token. Every `gh` and `git push` command in grobomo repos must manually wrap with `GH_TOKEN=$(gh auth token -u grobomo)`. This is error-prone and easy to forget.

## Solution
1. **`gh_auto` script** — wrapper that reads `.github/publish.json`, extracts the correct account, sets `GH_TOKEN`, and forwards to `gh` or `git`. Drop-in replacement.
2. **PreToolUse hook module** — blocks raw `gh` and `git push` commands that don't use `gh_auto` or `GH_TOKEN`, with an override for known-safe contexts.

## Usage
```bash
gh_auto push origin main          # reads publish.json → sets GH_TOKEN → git push
gh_auto repo create ...           # reads publish.json → sets GH_TOKEN → gh repo create
gh_auto pr create --title "..."   # same
```

## Design
- Script walks up from cwd to find `.github/publish.json`
- Extracts `github_account` field
- Calls `gh auth token -u <account>` to get the token
- Sets `GH_TOKEN` env var
- If first arg is a git command (push, pull, fetch), runs `git` with the token
- Otherwise runs `gh` with the token
- Falls back to default account if no publish.json found
