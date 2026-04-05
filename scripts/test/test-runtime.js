#!/usr/bin/env node

// Tests for runtime features: graceful shutdown, health endpoint, drain queue.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const TMP = resolve(ROOT, '.test-tmp-runtime');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

async function main() {
  console.log('=== CCC Manager Runtime Test ===\n');

  // Setup
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  // Clean state
  const stateDir = resolve(ROOT, 'state');
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });

  // Write test config with a unique health port
  const healthPort = 18920 + Math.floor(Math.random() * 100);
  const configPath = resolve(TMP, 'test.yaml');
  writeFileSync(configPath, `
name: runtime-test
interval: 60000
healthPort: ${healthPort}
dispatcher:
  type: shtd
`);

  const { Manager } = await import('../../src/index.js');

  // 1. Start manager and verify health endpoint
  console.log('1. Health endpoint...');
  const manager = new Manager(configPath);
  await manager.start();

  // Give server a tick to bind
  await new Promise(r => setTimeout(r, 100));

  const liveness = await httpGet(healthPort, '/healthz');
  assert(liveness.status === 200, `GET /healthz → ${liveness.status}`);
  const liveBody = JSON.parse(liveness.body);
  assert(liveBody.status === 'ok', `Liveness status: ${liveBody.status}`);

  const readiness = await httpGet(healthPort, '/readyz');
  assert(readiness.status === 200, `GET /readyz → ${readiness.status}`);
  const readyBody = JSON.parse(readiness.body);
  assert(readyBody.status === 'ready', `Readiness status: ${readyBody.status}`);

  const metrics = await httpGet(healthPort, '/metrics');
  assert(metrics.status === 200, `GET /metrics → ${metrics.status}`);
  const metricsBody = JSON.parse(metrics.body);
  assert(typeof metricsBody.cycles === 'number', `Metrics has cycles: ${metricsBody.cycles}`);

  const notfound = await httpGet(healthPort, '/unknown');
  assert(notfound.status === 404, `GET /unknown → ${notfound.status}`);

  // 2. Graceful shutdown drains queue
  console.log('\n2. Graceful shutdown...');

  // Enqueue some tasks manually
  manager.state.enqueue({ id: 'drain-1', summary: 'Task to drain' });
  manager.state.enqueue({ id: 'drain-2', summary: 'Another task' });
  assert(manager.state.queue.length === 2, `Queue has 2 tasks before stop`);

  await manager.stop();

  assert(manager.running === false, 'Manager stopped');
  assert(manager.state.queue.length === 0, `Queue drained: ${manager.state.queue.length} remaining`);
  assert(manager.state.history.length >= 2, `History has drained tasks: ${manager.state.history.length}`);

  // Health server should be closed
  try {
    await httpGet(healthPort, '/healthz');
    failed++; console.error('  FAIL: Health server still responding');
  } catch {
    passed++; console.log('  PASS: Health server closed after stop');
  }

  // 3. Retry logic
  console.log('\n3. Retry logic...');

  // Clean state for retry test
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });

  const retryPort = healthPort + 50;
  const retryConfigPath = resolve(TMP, 'retry-test.yaml');
  writeFileSync(retryConfigPath, `
name: retry-test
interval: 60000
healthPort: ${retryPort}
maxRetries: 2
dispatcher:
  type: shtd
verifiers:
  always-fail:
    type: test-suite
    command: node -e "process.exit(1)"
`);

  const retryManager = new Manager(retryConfigPath);
  await retryManager.start();
  await new Promise(r => setTimeout(r, 100));

  // Enqueue a task that will always fail verification
  retryManager.state.enqueue({ id: 'retry-task', summary: 'Will fail verification' });
  assert(retryManager.state.queue.length === 1, 'Task enqueued for retry test');

  // Process it — should retry twice then finally fail
  let task = retryManager.state.dequeue();
  await retryManager._processTask(task);
  // After first failure, task should be re-queued
  assert(retryManager.state.queue.some(t => t.id === 'retry-task'), 'Task re-queued after first failure');
  assert(retryManager.state.queue.find(t => t.id === 'retry-task')._retries === 1, 'Retry count: 1');

  task = retryManager.state.dequeue();
  await retryManager._processTask(task);
  assert(retryManager.state.queue.some(t => t.id === 'retry-task'), 'Task re-queued after second failure');
  assert(retryManager.state.queue.find(t => t.id === 'retry-task')._retries === 2, 'Retry count: 2');

  task = retryManager.state.dequeue();
  await retryManager._processTask(task);
  // After max retries, task should be completed as failed
  assert(!retryManager.state.queue.some(t => t.id === 'retry-task'), 'Task removed from queue after max retries');
  const failedTask = retryManager.state.history.find(t => t.id === 'retry-task');
  assert(failedTask !== undefined, 'Failed task in history');
  assert(failedTask.status === 'failed', `Final status: ${failedTask?.status}`);

  await retryManager.stop();

  // 4. Double-stop is safe
  console.log('\n4. Double-stop safety...');
  await manager.stop(); // Should not throw
  assert(true, 'Double-stop did not throw');

  // Cleanup
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  if (existsSync(stateDir)) rmSync(stateDir, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  process.exit(1);
});
