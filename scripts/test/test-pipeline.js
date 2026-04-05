#!/usr/bin/env node

// Full pipeline E2E test: monitor → detect → enqueue → dispatch → execute → verify.
// Uses a self-contained config with a deliberately failing monitor to trigger the pipeline.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== CCC Manager Full Pipeline Test ===\n');

  const tmpDir = resolve(ROOT, 'state', '_test_pipeline');
  const bridgeDir = resolve(tmpDir, 'bridge');
  const stateDir = resolve(ROOT, 'state');
  const configPath = resolve(tmpDir, 'test-config.yaml');

  // Clean
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });
  mkdirSync(bridgeDir, { recursive: true });

  // Create test config with a failing monitor and bridge input
  writeFileSync(configPath, `
name: pipeline-test
interval: 5000

monitors:
  failing-check:
    type: process
    command: node -e "process.exit(1)"

inputs:
  bridge:
    type: bridge
    path: ${bridgeDir.replace(/\\/g, '/')}

dispatcher:
  type: shtd

verifiers:
  pass-check:
    type: test-suite
    command: node -e "process.exit(0)"
`);

  // Also drop a task file in the bridge
  writeFileSync(resolve(bridgeDir, 'repair-001.json'), JSON.stringify({
    id: 'bridge-task-1',
    type: 'SELF_REPAIR',
    summary: 'Test bridge task'
  }));

  // 1. Load config
  console.log('1. Loading test config...');
  const { loadConfig } = await import('../../src/config.js');
  const config = loadConfig(configPath);
  assert(config.name === 'pipeline-test', `Config loaded: ${config.name}`);

  // 2. Create and init manager
  console.log('\n2. Initializing Manager...');
  const { Manager } = await import('../../src/index.js');
  const manager = new Manager(configPath);
  await manager.init();
  assert(manager.monitors.length === 1, `Monitors: ${manager.monitors.length}`);
  assert(manager.inputs.length === 1, `Inputs: ${manager.inputs.length}`);
  assert(manager.dispatcher !== null, 'Dispatcher loaded');
  assert(manager.verifiers.length === 1, `Verifiers: ${manager.verifiers.length}`);

  // 3. Run one cycle
  console.log('\n3. Running cycle...');
  await manager.runCycle();

  // Monitor should have detected an issue + bridge task = 2 items processed
  assert(manager.state.metrics.cycles === 1, 'Cycle count = 1');
  assert(manager.state.metrics.issues >= 1, `Issues detected: ${manager.state.metrics.issues}`);
  assert(manager.state.history.length >= 1, `History entries: ${manager.state.history.length}`);

  // 4. Check state persistence
  console.log('\n4. Checking state files...');
  assert(existsSync(resolve(stateDir, 'queue.json')), 'queue.json exists');
  assert(existsSync(resolve(stateDir, 'history.json')), 'history.json exists');
  assert(existsSync(resolve(stateDir, 'metrics.json')), 'metrics.json exists');

  // 5. Verify bridge task was picked up
  console.log('\n5. Checking bridge task processing...');
  const bridgeProcessed = manager.state.history.some(h => h.id === 'bridge-task-1');
  assert(bridgeProcessed, 'Bridge task processed and in history');

  // 6. Verify monitor issue was processed
  const monitorProcessed = manager.state.history.some(h => h.source?.startsWith('monitor:'));
  assert(monitorProcessed, 'Monitor issue processed and in history');

  // 7. All tasks should be verified (pass-check always passes)
  const allFixed = manager.state.history.every(h => h.status === 'fixed');
  assert(allFixed, `All tasks verified as fixed (${manager.state.history.length} total)`);

  // 8. Load project configs
  console.log('\n6. Loading project configs...');
  const roneConfig = loadConfig(resolve(ROOT, 'config', 'rone-teams-poller.yaml'));
  assert(roneConfig.name === 'rone-teams-poller', 'rone-teams-poller config loads');

  const portableConfig = loadConfig(resolve(ROOT, 'config', 'claude-portable.yaml'));
  assert(portableConfig.name === 'claude-portable', 'claude-portable config loads');

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
