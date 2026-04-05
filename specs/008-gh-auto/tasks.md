# Tasks: 008 gh_auto

- [x] T036: Create gh_auto script — reads publish.json, sets GH_TOKEN, forwards to gh/git
- [x] T037: Create PreToolUse hook module — blocks raw gh/git push without gh_auto or GH_TOKEN
- [x] T038: Test script with grobomo and tmemu repos
- [x] T039: Install script to ~/bin (already in PATH)

**Checkpoint**: `node scripts/test/test-gh-auto.js` — verifies script finds publish.json, extracts account, builds correct command
