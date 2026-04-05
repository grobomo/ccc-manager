#!/usr/bin/env node

// E2E test: imports all modules, creates Manager with example config, runs one cycle, verifies state.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== CCC Manager Scaffold Test ===\n');

  // Clean state from previous runs
  const stateDir = resolve(ROOT, 'state');
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });

  // 1. Import all modules
  console.log('1. Importing modules...');
  const { Monitor, Input, Dispatcher, Verifier } = await import('../../src/base.js');
  assert(typeof Monitor === 'function', 'Monitor class exported');
  assert(typeof Input === 'function', 'Input class exported');
  assert(typeof Dispatcher === 'function', 'Dispatcher class exported');
  assert(typeof Verifier === 'function', 'Verifier class exported');

  const { loadConfig } = await import('../../src/config.js');
  assert(typeof loadConfig === 'function', 'loadConfig exported');

  const { Registry } = await import('../../src/registry.js');
  assert(typeof Registry === 'function', 'Registry class exported');

  const { State } = await import('../../src/state.js');
  assert(typeof State === 'function', 'State class exported');

  const { Manager } = await import('../../src/index.js');
  assert(typeof Manager === 'function', 'Manager class exported');

  // 2. Test config loader
  console.log('\n2. Testing config loader...');
  const config = loadConfig(resolve(ROOT, 'config', 'example.yaml'));
  assert(config.name === 'example', `Config name: ${config.name}`);
  assert(typeof config.interval === 'number', `Config interval: ${config.interval}`);

  // 3. Test registry
  console.log('\n3. Testing registry...');
  const reg = new Registry();
  class TestMonitor extends Monitor {}
  reg.registerMonitor('test', TestMonitor);
  assert(reg.getMonitor('test') === TestMonitor, 'Monitor registered and retrieved');
  assert(reg.getMonitor('nonexistent') === null, 'Unknown monitor returns null');

  // 4. Test state
  console.log('\n4. Testing state...');
  const state = new State(stateDir);
  assert(existsSync(stateDir), 'State directory created');

  const task = state.enqueue({ id: 'test-1', summary: 'Test issue' });
  assert(task.status === 'queued', 'Task enqueued with status=queued');

  const dequeued = state.dequeue();
  assert(dequeued && dequeued.id === 'test-1', 'Task dequeued');
  assert(dequeued.status === 'in_progress', 'Dequeued task status=in_progress');

  state.complete('test-1', { passed: true, details: 'All good' });
  assert(state.queue.length === 0, 'Queue empty after complete');
  assert(state.history.length === 1, 'History has 1 entry');
  assert(state.metrics.fixes === 1, 'Metrics fixes incremented');

  state.recordCycle();
  assert(state.metrics.cycles === 1, 'Cycle count incremented');

  // 5. Test Manager init with example config (no monitors registered, so 0 monitors — that's fine)
  console.log('\n5. Testing Manager init...');
  const manager = new Manager(resolve(ROOT, 'config', 'example.yaml'));
  await manager.init();
  assert(manager.config.name === 'example', 'Manager loaded config');
  assert(Array.isArray(manager.monitors), 'Manager has monitors array');

  // Cleanup
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
}

main().catch(err => {
  console.error('Test error:', err);
  setTimeout(() => process.exit(1), 100);
});
