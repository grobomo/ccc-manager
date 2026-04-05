#!/usr/bin/env node

// E2E integration test: bridge task file → claude dispatcher (fallback) → local worker → verifier.
// Simulates the real rone-teams-poller flow without needing claude CLI or K8s.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, writeFileSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== E2E Bridge → Claude Dispatcher → Worker Test ===\n');

  const tmpDir = resolve(ROOT, 'state', '_test_e2e_bridge');
  const bridgeDir = resolve(tmpDir, 'bridge', 'pending');
  const completedDir = resolve(tmpDir, 'bridge', 'completed');
  const stateDir = resolve(ROOT, 'state');
  const configPath = resolve(tmpDir, 'e2e-config.yaml');

  // Clean
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });
  mkdirSync(bridgeDir, { recursive: true });

  // Create config: bridge input + claude dispatcher (fallback) + local worker + verifier
  writeFileSync(configPath, [
    'name: e2e-bridge-test',
    'interval: 60000',
    'healthPort: 0',
    '',
    'inputs:',
    '  rone-bridge:',
    '    type: bridge',
    `    path: ${bridgeDir.replace(/\\/g, '/')}`,
    `    completedDir: ${completedDir.replace(/\\/g, '/')}`,
    '',
    'dispatcher:',
    '  type: claude',
    '  claudePath: nonexistent-claude-binary-e2e',
    '  timeout: 1000',
    '',
    'workers:',
    '  default:',
    '    type: local',
    '    timeout: 5000',
    '',
    'verifiers:',
    '  check:',
    '    type: test-suite',
    '    command: node -e "process.exit(0)"',
  ].join('\n'));

  // --- Test 1: RONE-style bridge task file (SELF_REPAIR format) ---
  console.log('1. Bridge task file with RONE format...');

  writeFileSync(resolve(bridgeDir, 'repair-rone-001.json'), JSON.stringify({
    request_id: 'rone-repair-001',
    classification: 'SELF_REPAIR',
    text: 'Pod teams-poller-0 is in CrashLoopBackOff, OOMKilled after processing large message batch',
    severity: 'high',
    details: {
      pod: 'teams-poller-0',
      namespace: 'hackathon-teams-poller',
      reason: 'OOMKilled'
    }
  }));

  // --- Test 2: Standard format task ---
  writeFileSync(resolve(bridgeDir, 'task-std-002.json'), JSON.stringify({
    id: 'std-task-002',
    type: 'fix',
    summary: 'Health check failing on /readyz endpoint',
    severity: 'medium',
    details: { command: 'node -e "process.exit(0)"' }
  }));

  // --- Test 3: Minimal task (just text, tests normalization) ---
  writeFileSync(resolve(bridgeDir, 'task-minimal-003.json'), JSON.stringify({
    text: 'Log volume spike detected'
  }));

  // Load manager
  console.log('\n2. Initializing Manager with claude dispatcher...');
  const { Manager } = await import('../../src/index.js');
  const manager = new Manager(configPath);
  await manager.init();

  assert(manager.dispatcher.constructor.name === 'ClaudeDispatcher', 'Claude dispatcher loaded');
  assert(manager.inputs.length === 1, 'Bridge input loaded');
  assert(Object.keys(manager.workers).length === 1, 'Local worker loaded');
  assert(manager.verifiers.length === 1, 'Verifier loaded');

  // Run cycle — should pick up all 3 bridge files
  console.log('\n3. Running cycle (picks up bridge files)...');
  await manager.runCycle();

  assert(manager.state.metrics.cycles === 1, 'Cycle completed');

  // Check bridge files were moved to completed
  console.log('\n4. Checking bridge file processing...');
  const pendingAfter = existsSync(bridgeDir) ? readdirSync(bridgeDir).filter(f => f.endsWith('.json')) : [];
  assert(pendingAfter.length === 0, `No files left in pending (got ${pendingAfter.length})`);

  const completedFiles = existsSync(completedDir) ? readdirSync(completedDir).filter(f => f.endsWith('.json')) : [];
  // Bridge moves to done/ subdir by default, or completedDir if configured
  const doneDir = resolve(bridgeDir, 'done');
  const doneFiles = existsSync(doneDir) ? readdirSync(doneDir).filter(f => f.endsWith('.json')) : [];
  const movedCount = completedFiles.length + doneFiles.length;
  assert(movedCount === 3, `All 3 files moved (${movedCount} in completed/done)`);

  // Check RONE format normalization (request_id → id, text → summary, classification → type)
  console.log('\n5. Checking RONE format normalization...');
  const roneTask = manager.state.history.find(h => h.id === 'rone-repair-001');
  assert(!!roneTask, 'RONE task found in history by request_id');

  // Check standard format task
  const stdTask = manager.state.history.find(h => h.id === 'std-task-002');
  assert(!!stdTask, 'Standard task found in history');

  // Check minimal task normalization
  const minimalTask = manager.state.history.find(h =>
    h.id && h.id !== 'rone-repair-001' && h.id !== 'std-task-002'
  );
  assert(!!minimalTask, 'Minimal task found in history');

  // All tasks should be processed (claude fallback → local worker → verifier passes)
  console.log('\n6. Checking all tasks completed...');
  assert(manager.state.history.length >= 3, `History has ${manager.state.history.length} entries (expected >= 3)`);

  const allFixed = manager.state.history.every(h => h.status === 'fixed');
  assert(allFixed, `All tasks verified as fixed`);

  // Check that claude dispatcher used fallback (no real claude binary)
  console.log('\n7. Checking dispatcher behavior...');
  assert(manager.state.queue.length === 0, 'Queue is empty (all processed)');

  // Dedup test: drop same task again, should be ignored
  console.log('\n8. Dedup test...');
  writeFileSync(resolve(bridgeDir, 'repair-rone-001.json'), JSON.stringify({
    request_id: 'rone-repair-001',
    classification: 'SELF_REPAIR',
    text: 'Same task again'
  }));
  await manager.runCycle();
  const historyCount = manager.state.history.filter(h => h.id === 'rone-repair-001').length;
  assert(historyCount === 1, `Dedup prevented duplicate (${historyCount} entries for rone-repair-001)`);
  assert(manager.state.metrics.cycles === 2, 'Second cycle completed');

  // State persistence check
  console.log('\n9. State persistence...');
  assert(existsSync(resolve(stateDir, 'queue.json')), 'queue.json persisted');
  assert(existsSync(resolve(stateDir, 'history.json')), 'history.json persisted');
  assert(existsSync(resolve(stateDir, 'metrics.json')), 'metrics.json persisted');

  const metricsFile = JSON.parse(readFileSync(resolve(stateDir, 'metrics.json'), 'utf-8'));
  assert(metricsFile.cycles === 2, `Metrics file shows 2 cycles`);

  // Cleanup
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
}

main().catch(err => {
  console.error('Test error:', err);
  setTimeout(() => process.exit(1), 100);
});
