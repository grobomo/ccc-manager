# Git Branch Safety

- ALWAYS run `git branch --show-current` before committing via Bash
- `git reset --soft HEAD~N` can move past the branch point and land you on main
- If you need to squash commits on a feature branch, use `git rebase` not `git reset`
- After any branch switch or reset, verify the branch name before next operation
- The PreToolUse gate only blocks Edit/Write on main, NOT `git commit` via Bash
- Use `git branch -f main origin/main` (from another branch) to fix accidental main commits
