#!/usr/bin/env node

// Test gh_auto script: finds publish.json, extracts account, builds correct commands.

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function run(cmd, opts = {}) {
  try {
    return { ok: true, out: execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 10000, shell: 'bash', ...opts }).toString().trim() };
  } catch (err) {
    return { ok: false, out: ((err.stdout?.toString() || '') + (err.stderr?.toString() || '')).trim() };
  }
}

async function main() {
  console.log('=== gh_auto Script Test ===\n');

  // 1. Script exists and is executable
  console.log('1. Script availability...');
  const which = run('which gh_auto');
  assert(which.ok, `gh_auto found in PATH: ${which.out}`);

  // 2. Help output
  console.log('\n2. Help output...');
  const help = run('gh_auto');
  assert(help.out.includes('publish.json'), 'Help mentions publish.json');

  // 3. Correct account detection for this project (grobomo)
  console.log('\n3. Account detection...');
  // gh_auto api user should return grobomo for this project
  const user = run('gh_auto api user --jq .login');
  assert(user.ok, 'gh_auto api user succeeded');
  assert(user.out === 'grobomo', `Detected account: ${user.out} (expected grobomo)`);

  // 4. Git push detection (gh_auto push → git push with token)
  // Can't actually push, but verify the command routes to git
  // Use --dry-run to test without side effects
  const dryPush = run('gh_auto push --dry-run 2>&1 || true');
  // If it tried git push, it'll mention "Everything up-to-date" or a git error, not "gh push"
  assert(!dryPush.out.includes('unknown command'), 'push routes to git, not gh');

  // 5. Hook enforcement test
  console.log('\n4. Hook module...');
  const hookPath = resolve(process.env.HOME || process.env.USERPROFILE, '.claude/hooks/run-modules/PreToolUse/gh-auto-gate.js');
  const hookMod = await import(`file://${hookPath.replace(/\\/g, '/')}`);
  const gate = hookMod.default;

  // Should block raw gh pr create
  const blocked = gate({ tool_name: 'Bash', tool_input: { command: 'gh pr create --title "test"' } });
  assert(blocked !== null, 'Blocks raw gh pr create');
  assert(blocked.decision === 'block', `Decision: ${blocked?.decision}`);
  assert(blocked.reason.includes('gh_auto'), 'Suggests gh_auto');

  // Should block raw git push
  const blockedPush = gate({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
  assert(blockedPush !== null, 'Blocks raw git push');

  // Should allow GH_TOKEN= prefix
  const allowed = gate({ tool_name: 'Bash', tool_input: { command: 'GH_TOKEN=$(gh auth token -u grobomo) gh pr create' } });
  assert(allowed === null, 'Allows GH_TOKEN= prefix');

  // Should allow gh_auto
  const allowedAuto = gate({ tool_name: 'Bash', tool_input: { command: 'gh_auto pr create --title "test"' } });
  assert(allowedAuto === null, 'Allows gh_auto');

  // Should allow gh auth commands
  const allowedAuth = gate({ tool_name: 'Bash', tool_input: { command: 'gh auth status' } });
  assert(allowedAuth === null, 'Allows gh auth commands');

  // Should ignore non-gh commands
  const ignored = gate({ tool_name: 'Bash', tool_input: { command: 'node test.js' } });
  assert(ignored === null, 'Ignores non-gh commands');

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
}

main().catch(err => {
  console.error('Test error:', err);
  setTimeout(() => process.exit(1), 100);
});
