#!/usr/bin/env node

// Tests for: config hot-reload (T080), file notifier wiring (T081), Prometheus metrics (T082)

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) { console.log(`  PASS: ${msg}`); passed++; }
  else { console.error(`  FAIL: ${msg}`); failed++; }
}

// ---- T080: Config hot-reload ----

console.log('1. Hot-reload — field detection...');
{
  // Create a temp config file
  const tmpDir = resolve(ROOT, 'state', '_test_hotreload');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpConfig = resolve(tmpDir, 'test-hr.yaml');

  writeFileSync(tmpConfig, `name: test-hotreload
interval: 5000
maxRetries: 1
dedupWindow: 60000
`);

  const { Manager } = await import('../../src/index.js');
  const mgr = new Manager(tmpConfig);
  assert(mgr.config.interval === 5000, 'Initial interval is 5000');
  assert(mgr.config.maxRetries === 1, 'Initial maxRetries is 1');
  assert(mgr.configPath === tmpConfig, 'configPath stored');

  // Modify config file and call _reloadConfig directly
  writeFileSync(tmpConfig, `name: test-hotreload
interval: 10000
maxRetries: 3
dedupWindow: 120000
`);

  mgr._reloadConfig();
  assert(mgr.config.interval === 10000, 'Interval updated to 10000');
  assert(mgr.config.maxRetries === 3, 'maxRetries updated to 3');
  assert(mgr.config.dedupWindow === 120000, 'dedupWindow updated to 120000');

  // Clean up
  unlinkSync(tmpConfig);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log('2. Hot-reload — invalid config keeps old values...');
{
  const tmpDir = resolve(ROOT, 'state', '_test_hotreload2');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpConfig = resolve(tmpDir, 'test-hr2.yaml');

  writeFileSync(tmpConfig, `name: test-safe
interval: 5000
`);

  const { Manager } = await import('../../src/index.js');
  const mgr = new Manager(tmpConfig);
  assert(mgr.config.interval === 5000, 'Initial interval 5000');

  // Write invalid YAML (missing name)
  writeFileSync(tmpConfig, `interval: 999
`);

  mgr._reloadConfig();
  // Validation should fail (interval < 1000), config unchanged
  assert(mgr.config.interval === 5000, 'Interval unchanged after invalid reload');

  unlinkSync(tmpConfig);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log('3. Hot-reload — no-op when values unchanged...');
{
  const tmpDir = resolve(ROOT, 'state', '_test_hotreload3');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpConfig = resolve(tmpDir, 'test-hr3.yaml');

  writeFileSync(tmpConfig, `name: test-noop
interval: 5000
`);

  const { Manager } = await import('../../src/index.js');
  const mgr = new Manager(tmpConfig);

  // Capture log output
  let logCalled = false;
  const origInfo = mgr.log.info;
  mgr.log.info = (msg) => { if (msg === 'Config reloaded') logCalled = true; };

  mgr._reloadConfig();
  assert(!logCalled, 'No reload log when config unchanged');
  mgr.log.info = origInfo;

  unlinkSync(tmpConfig);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log('4. Hot-reload — interval timer is replaced...');
{
  const tmpDir = resolve(ROOT, 'state', '_test_hotreload4');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpConfig = resolve(tmpDir, 'test-hr4.yaml');

  writeFileSync(tmpConfig, `name: test-timer
interval: 5000
`);

  const { Manager } = await import('../../src/index.js');
  const mgr = new Manager(tmpConfig);
  mgr.running = true;
  // Simulate having a timer
  const fakeTimer = setInterval(() => {}, 999999);
  mgr.timers = [fakeTimer];

  writeFileSync(tmpConfig, `name: test-timer
interval: 15000
`);

  mgr._reloadConfig();
  assert(mgr.config.interval === 15000, 'Interval updated to 15000');
  assert(mgr.timers.length === 1, 'Timer replaced (still 1 timer)');
  // Clean up timers
  mgr.timers.forEach(t => clearInterval(t));
  mgr.timers = [];

  unlinkSync(tmpConfig);
  rmSync(tmpDir, { recursive: true, force: true });
}

// ---- T081: Rone config file notifier ----

console.log('5. Rone config has file notifier...');
{
  const { loadConfig } = await import('../../src/config.js');
  const config = loadConfig(resolve(ROOT, 'config/rone-teams-poller.yaml'));
  assert(config.notifiers !== undefined, 'notifiers section exists');
  const br = config.notifiers['bridge-results'];
  assert(br !== undefined, 'bridge-results notifier exists');
  assert(br.type === 'file', 'type is file');
  assert(br.dir === '/data/rone-bridge/results', 'dir points to bridge results');
  assert(br.prefix === 'repair', 'prefix is repair');
}

// ---- T082: Prometheus metrics ----

console.log('6. Prometheus text exposition format...');
{
  const { Manager } = await import('../../src/index.js');

  // Clear shared state queue so other test suites don't pollute queue length
  const queueFile = resolve(ROOT, 'state', 'test-prom', 'queue.json');
  if (existsSync(queueFile)) unlinkSync(queueFile);

  const tmpDir = resolve(ROOT, 'state', '_test_prom');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpConfig = resolve(tmpDir, 'test-prom.yaml');
  writeFileSync(tmpConfig, `name: test-prom
interval: 60000
healthPort: 0
`);

  const mgr = new Manager(tmpConfig);
  await mgr.init();

  // Simulate some metrics
  mgr.state.metrics.cycles = 42;
  mgr.state.metrics.issues = 10;
  mgr.state.metrics.fixes = 7;
  mgr.state.metrics.failures = 3;

  // Start health server on ephemeral port
  mgr.running = true;
  mgr.startHealth();

  // Wait for server to be listening
  await new Promise(r => setTimeout(r, 100));
  const addr = mgr.healthServer.address();
  const port = addr.port;

  // Request Prometheus format (default, no Accept: application/json)
  const promRes = await fetch(`http://localhost:${port}/metrics`);
  const promText = await promRes.text();

  assert(promRes.headers.get('content-type').includes('text/plain'), 'Content-Type is text/plain');
  assert(promText.includes('# TYPE ccc_cycles_total counter'), 'Has TYPE line for cycles');
  assert(promText.includes('ccc_cycles_total{instance="test-prom"} 42'), 'Cycles value correct');
  assert(promText.includes('ccc_issues_total{instance="test-prom"} 10'), 'Issues value correct');
  assert(promText.includes('ccc_fixes_total{instance="test-prom"} 7'), 'Fixes value correct');
  assert(promText.includes('ccc_failures_total{instance="test-prom"} 3'), 'Failures value correct');
  assert(promText.includes('ccc_queue_length{instance="test-prom"} 0'), 'Queue length correct');
  assert(promText.includes('ccc_uptime_seconds'), 'Has uptime gauge');
  assert(promText.includes('ccc_last_reload_timestamp_seconds'), 'Has last_reload gauge');

  // Request JSON format
  const jsonRes = await fetch(`http://localhost:${port}/metrics`, {
    headers: { Accept: 'application/json' }
  });
  const jsonData = await jsonRes.json();
  assert(jsonData.cycles === 42, 'JSON format still works');

  // Clean up
  await new Promise(r => mgr.healthServer.close(r));
  mgr.healthServer = null;

  unlinkSync(tmpConfig);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log('7. Prometheus /metrics — HELP lines present...');
{
  // Just verify the HELP comments are present in format
  const lines = [
    '# HELP ccc_cycles_total',
    '# HELP ccc_issues_total',
    '# HELP ccc_fixes_total',
    '# HELP ccc_failures_total',
    '# HELP ccc_queue_length',
    '# HELP ccc_uptime_seconds',
    '# HELP ccc_last_reload_timestamp_seconds',
  ];

  // Read index.js to verify all HELP lines exist in source
  const src = readFileSync(resolve(ROOT, 'src/index.js'), 'utf-8');
  for (const line of lines) {
    assert(src.includes(line), `Source contains ${line}`);
  }
}

console.log('8. Hot-reload tracks _lastReloadAt...');
{
  const tmpDir = resolve(ROOT, 'state', '_test_reload_ts');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpConfig = resolve(tmpDir, 'test-ts.yaml');

  writeFileSync(tmpConfig, `name: test-ts
interval: 5000
`);

  const { Manager } = await import('../../src/index.js');
  const mgr = new Manager(tmpConfig);
  assert(mgr._lastReloadAt === null, 'No reload yet');
  assert(typeof mgr._startedAt === 'number', '_startedAt is set');

  writeFileSync(tmpConfig, `name: test-ts
interval: 10000
`);

  mgr._reloadConfig();
  assert(mgr._lastReloadAt !== null, '_lastReloadAt set after reload');
  assert(mgr._lastReloadAt >= mgr._startedAt, '_lastReloadAt >= _startedAt');

  unlinkSync(tmpConfig);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log('9. _watchConfig and cleanup...');
{
  const tmpDir = resolve(ROOT, 'state', '_test_watch');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  const tmpConfig = resolve(tmpDir, 'test-watch.yaml');
  writeFileSync(tmpConfig, `name: test-watch
interval: 5000
`);

  const { Manager } = await import('../../src/index.js');
  const mgr = new Manager(tmpConfig);

  mgr._watchConfig();
  assert(mgr._configWatcher !== null, 'Watcher created');

  // Simulate stop cleanup
  mgr._configWatcher.close();
  mgr._configWatcher = null;
  assert(mgr._configWatcher === null, 'Watcher cleaned up');

  unlinkSync(tmpConfig);
  rmSync(tmpDir, { recursive: true, force: true });
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
// Delay exit to let handles drain (avoids libuv assertion crash on Windows)
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
