#!/usr/bin/env node

// E2E test: bridge input, alert input, process monitor, auto-registration.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== CCC Manager Input Sources Test ===\n');

  // Setup temp dirs
  const tmpDir = resolve(ROOT, 'state', '_test_inputs');
  const bridgeDir = resolve(tmpDir, 'bridge');
  const doneDir = resolve(bridgeDir, 'done');
  const stateDir = resolve(tmpDir, 'state');
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(bridgeDir, { recursive: true });

  // 1. Test BridgeInput
  console.log('1. Testing BridgeInput...');
  const { BridgeInput } = await import('../../src/inputs/bridge.js');
  assert(typeof BridgeInput === 'function', 'BridgeInput exported');

  // Write a task file
  const taskData = { id: 'repair-001', type: 'SELF_REPAIR', summary: 'Pod crash loop', details: { pod: 'poller-0' } };
  writeFileSync(resolve(bridgeDir, 'task-001.json'), JSON.stringify(taskData));

  const bridge = new BridgeInput('bridge', { path: bridgeDir });
  const tasks = await bridge.poll();
  assert(tasks.length === 1, `Bridge found 1 task (got ${tasks.length})`);
  assert(tasks[0].id === 'repair-001', `Task id: ${tasks[0]?.id}`);
  assert(tasks[0].type === 'SELF_REPAIR', `Task type: ${tasks[0]?.type}`);

  // Verify file moved to done/
  assert(existsSync(doneDir), 'done/ directory created');
  assert(readdirSync(doneDir).length === 1, 'Task file moved to done/');
  assert(!existsSync(resolve(bridgeDir, 'task-001.json')), 'Original file removed');

  // Poll again — should be empty
  const tasks2 = await bridge.poll();
  assert(tasks2.length === 0, 'Second poll returns empty');

  // 1b. Test BridgeInput with rone-bridge format (completedDir + normalization)
  console.log('\n1b. Testing rone-bridge format...');
  const roneBridgeDir = resolve(tmpDir, 'rone-bridge');
  const roneCompletedDir = resolve(tmpDir, 'rone-completed');
  mkdirSync(roneBridgeDir, { recursive: true });

  const roneTask = {
    request_id: 'req-abc123',
    classification: 'SELF_REPAIR',
    text: 'The hex IDs are still showing in output',
    sender: 'user@example.com',
    timestamp: '2026-04-05T12:00:00Z'
  };
  writeFileSync(resolve(roneBridgeDir, 'req-abc123.json'), JSON.stringify(roneTask));

  const roneBridge = new BridgeInput('rone', { path: roneBridgeDir, completedDir: roneCompletedDir });
  const roneTasks = await roneBridge.poll();
  assert(roneTasks.length === 1, `Rone bridge found 1 task (got ${roneTasks.length})`);
  assert(roneTasks[0].id === 'req-abc123', `Normalized id: ${roneTasks[0]?.id}`);
  assert(roneTasks[0].type === 'SELF_REPAIR', `Normalized type: ${roneTasks[0]?.type}`);
  assert(roneTasks[0].summary === 'The hex IDs are still showing in output', `Normalized summary: ${roneTasks[0]?.summary}`);

  // File moved to completedDir, not done/
  assert(existsSync(roneCompletedDir), 'completedDir created');
  assert(readdirSync(roneCompletedDir).includes('req-abc123.json'), 'File in completedDir');
  assert(!existsSync(resolve(roneBridgeDir, 'done')), 'No done/ dir when completedDir set');

  // 1c. Test writeResult
  console.log('\n1c. Testing writeResult...');
  roneBridge.writeResult('req-abc123', { status: 'fixed', reply: 'Hex IDs removed' });
  const resultFile = resolve(roneCompletedDir, 'req-abc123.json');
  assert(existsSync(resultFile), 'Result file written');

  // 2. Test AlertInput
  console.log('\n2. Testing AlertInput...');
  const { AlertInput } = await import('../../src/inputs/alert.js');
  assert(typeof AlertInput === 'function', 'AlertInput exported');

  const alertInput = new AlertInput('alerts', {});
  alertInput.push({ id: 'alert-1', severity: 'high', summary: 'OOM detected' });
  alertInput.push({ id: 'alert-2', severity: 'low', summary: 'Slow response' });

  const alerts = await alertInput.poll();
  assert(alerts.length === 2, `AlertInput drained 2 alerts (got ${alerts.length})`);

  const alerts2 = await alertInput.poll();
  assert(alerts2.length === 0, 'AlertInput empty after drain');

  // 3. Test ProcessMonitor
  console.log('\n3. Testing ProcessMonitor...');
  const { ProcessMonitor } = await import('../../src/monitors/process.js');
  assert(typeof ProcessMonitor === 'function', 'ProcessMonitor exported');

  // Successful command
  const okMonitor = new ProcessMonitor('ok-check', { command: 'node -e "process.exit(0)"' });
  const okIssues = await okMonitor.check();
  assert(okIssues.length === 0, 'Successful command = no issues');

  // Failing command
  const failMonitor = new ProcessMonitor('fail-check', { command: 'node -e "process.exit(1)"' });
  const failIssues = await failMonitor.check();
  assert(failIssues.length === 1, 'Failed command = 1 issue');
  assert(failIssues[0].severity === 'high', `Issue severity: ${failIssues[0]?.severity}`);

  // 4. Test auto-registration
  console.log('\n4. Testing auto-registration...');
  const { Registry } = await import('../../src/registry.js');
  const { registerBuiltins } = await import('../../src/builtins.js');
  const reg = new Registry();
  registerBuiltins(reg);

  assert(reg.getInput('bridge') === BridgeInput, 'BridgeInput registered as "bridge"');
  assert(reg.getInput('alert') === AlertInput, 'AlertInput registered as "alert"');
  assert(reg.getMonitor('process') === ProcessMonitor, 'ProcessMonitor registered as "process"');

  // Cleanup
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
