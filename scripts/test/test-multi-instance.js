#!/usr/bin/env node

// Test: Multi-instance support — isolated state, instance-labeled metrics, shared health.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${port}${path}`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function main() {
  console.log('=== Multi-Instance Support Test ===\n');

  const tmpDir = resolve(ROOT, 'state', '_test_multi');
  const stateRoot = resolve(ROOT, 'state');

  // Clean
  if (existsSync(stateRoot)) rmSync(stateRoot, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  // Create two test configs
  const configA = resolve(tmpDir, 'alpha.yaml');
  const configB = resolve(tmpDir, 'beta.yaml');
  writeFileSync(configA, `name: alpha
interval: 60000
healthPort: 0
dispatcher:
  type: shtd
`);
  writeFileSync(configB, `name: beta
interval: 60000
healthPort: 0
dispatcher:
  type: shtd
`);

  const { Manager, MultiManager } = await import('../../src/index.js');

  // ---- T130: Per-instance state isolation ----
  console.log('1. Per-instance state isolation...');
  {
    const mgrA = new Manager(configA);
    const mgrB = new Manager(configB);
    await mgrA.init();
    await mgrB.init();

    assert(mgrA.instanceName === 'alpha', 'Manager A instance name is alpha');
    assert(mgrB.instanceName === 'beta', 'Manager B instance name is beta');

    // State dirs should be different
    assert(mgrA.state.dir !== mgrB.state.dir, 'State dirs are isolated');
    assert(mgrA.state.dir.includes('alpha'), 'Alpha state dir contains "alpha"');
    assert(mgrB.state.dir.includes('beta'), 'Beta state dir contains "beta"');

    // Enqueue in A, should not appear in B
    mgrA.state.enqueue({ id: 'alpha-task-1', summary: 'Task for alpha' });
    assert(mgrA.state.queue.length === 1, 'Alpha has 1 queued task');
    assert(mgrB.state.queue.length === 0, 'Beta has 0 queued tasks');

    // State persists to separate files
    assert(existsSync(resolve(mgrA.state.dir, 'queue.json')), 'Alpha queue.json exists');
    assert(!existsSync(resolve(mgrB.state.dir, 'queue.json')), 'Beta queue.json does not exist yet');

    mgrB.state.enqueue({ id: 'beta-task-1', summary: 'Task for beta' });
    assert(existsSync(resolve(mgrB.state.dir, 'queue.json')), 'Beta queue.json exists after enqueue');

    // Verify file contents are separate
    const alphaQueue = JSON.parse(readFileSync(resolve(mgrA.state.dir, 'queue.json'), 'utf-8'));
    const betaQueue = JSON.parse(readFileSync(resolve(mgrB.state.dir, 'queue.json'), 'utf-8'));
    assert(alphaQueue.length === 1 && alphaQueue[0].id === 'alpha-task-1', 'Alpha queue file has correct task');
    assert(betaQueue.length === 1 && betaQueue[0].id === 'beta-task-1', 'Beta queue file has correct task');
  }

  // ---- T131: Instance-labeled Prometheus metrics ----
  console.log('\n2. Instance-labeled Prometheus metrics...');
  {
    const mgr = new Manager(configA);
    await mgr.init();
    mgr.state.metrics.cycles = 10;
    mgr.state.metrics.issues = 5;

    const lines = mgr.prometheusLines();
    assert(lines.some(l => l.includes('{instance="alpha"}')), 'Lines include instance label');
    assert(lines.some(l => l.includes('ccc_cycles_total{instance="alpha"} 10')), 'Cycles line has correct value');
    assert(lines.some(l => l.includes('ccc_issues_total{instance="alpha"} 5')), 'Issues line has correct value');
  }

  // ---- T132 + T133: MultiManager with shared health endpoint ----
  console.log('\n3. MultiManager with shared health endpoint...');
  {
    // Clean state again
    if (existsSync(stateRoot)) rmSync(stateRoot, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(configA, `name: alpha
interval: 60000
healthPort: 0
dispatcher:
  type: shtd
`);
    writeFileSync(configB, `name: beta
interval: 60000
healthPort: 0
dispatcher:
  type: shtd
`);

    const healthPort = 19200 + Math.floor(Math.random() * 100);
    const multi = new MultiManager([configA, configB], { healthPort });
    assert(multi.managers.length === 2, 'MultiManager has 2 instances');

    await multi.start();

    // Wait for health server to bind
    await new Promise(r => setTimeout(r, 200));

    // Test /healthz
    const health = await httpGet(healthPort, '/healthz');
    assert(health.status === 200, '/healthz returns 200');
    const healthBody = JSON.parse(health.body);
    assert(healthBody.status === 'ok', 'Overall status is ok');
    assert(healthBody.instances.length === 2, 'Two instances reported');
    assert(healthBody.instances.some(i => i.instance === 'alpha'), 'Alpha in health response');
    assert(healthBody.instances.some(i => i.instance === 'beta'), 'Beta in health response');

    // Test /readyz
    const ready = await httpGet(healthPort, '/readyz');
    assert(ready.status === 200, '/readyz returns 200');
    const readyBody = JSON.parse(ready.body);
    assert(readyBody.instances.length === 2, 'Two instances in readyz');

    // Test /metrics (Prometheus format)
    const metrics = await httpGet(healthPort, '/metrics');
    assert(metrics.status === 200, '/metrics returns 200');
    assert(metrics.headers['content-type'].includes('text/plain'), 'Prometheus content type');
    assert(metrics.body.includes('{instance="alpha"}'), 'Alpha metrics present');
    assert(metrics.body.includes('{instance="beta"}'), 'Beta metrics present');
    // Should have TYPE headers only once
    const typeCount = (metrics.body.match(/# TYPE ccc_cycles_total/g) || []).length;
    assert(typeCount === 1, 'TYPE headers appear once (not duplicated per instance)');

    // Test /metrics JSON format
    const jsonMetrics = await new Promise((resolve, reject) => {
      const req = http.get(`http://localhost:${healthPort}/metrics`, { headers: { Accept: 'application/json' } }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      });
      req.on('error', reject);
    });
    const jsonBody = JSON.parse(jsonMetrics.body);
    assert(jsonBody.alpha !== undefined, 'JSON metrics has alpha key');
    assert(jsonBody.beta !== undefined, 'JSON metrics has beta key');

    // Test 404
    const notFound = await httpGet(healthPort, '/unknown');
    assert(notFound.status === 404, 'Unknown path returns 404');

    // Stop
    await multi.stop();
    assert(!multi.managers[0].running, 'Alpha stopped');
    assert(!multi.managers[1].running, 'Beta stopped');
  }

  // ---- Single instance backward compatibility ----
  console.log('\n4. Single instance backward compat...');
  {
    if (existsSync(stateRoot)) rmSync(stateRoot, { recursive: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(configA, `name: alpha
interval: 60000
healthPort: 0
dispatcher:
  type: shtd
`);

    const mgr = new Manager(configA);
    await mgr.start();
    await new Promise(r => setTimeout(r, 200));

    // Single instance still gets its own health server
    const addr = mgr.healthServer.address();
    assert(addr && addr.port > 0, 'Single instance has own health server');

    const health = await httpGet(addr.port, '/healthz');
    assert(health.status === 200, 'Single instance /healthz works');
    const body = JSON.parse(health.body);
    assert(body.instance === 'alpha', 'Single instance reports its name');

    await mgr.stop();
  }

  // Cleanup
  if (existsSync(stateRoot)) rmSync(stateRoot, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 50);
}

main().catch(err => {
  console.error(err);
  setTimeout(() => process.exit(1), 50);
});
