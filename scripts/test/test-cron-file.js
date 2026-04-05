#!/usr/bin/env node

// Tests for CronMonitor and FileNotifier.

import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { CronMonitor, parseCron, matchesCron } from '../../src/monitors/cron.js';
import { FileNotifier } from '../../src/notifiers/file.js';
import { Registry } from '../../src/registry.js';
import { registerBuiltins } from '../../src/builtins.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const tmpDir = resolve(ROOT, 'state', '_test_cron_file');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}: ${err.message}`);
    failed++;
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err) {
    console.error(`  FAIL: ${name}: ${err.message}`);
    failed++;
  }
}

// Clean
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
mkdirSync(tmpDir, { recursive: true });

// --- Cron parsing ---
console.log('1. Cron expression parsing...');

test('Parse every minute', () => {
  const f = parseCron('* * * * *');
  assert.equal(f.minute, null); // null = match all
  assert.equal(f.hour, null);
});

test('Parse every 5 minutes', () => {
  const f = parseCron('*/5 * * * *');
  assert.ok(f.minute.has(0));
  assert.ok(f.minute.has(5));
  assert.ok(f.minute.has(55));
  assert.ok(!f.minute.has(3));
});

test('Parse specific values', () => {
  const f = parseCron('0 9 * * 1');
  assert.ok(f.minute.has(0));
  assert.equal(f.minute.size, 1);
  assert.ok(f.hour.has(9));
  assert.ok(f.dayOfWeek.has(1));
});

test('Parse comma-separated', () => {
  const f = parseCron('0,30 * * * *');
  assert.ok(f.minute.has(0));
  assert.ok(f.minute.has(30));
  assert.equal(f.minute.size, 2);
});

test('Parse range', () => {
  const f = parseCron('* 9-17 * * *');
  assert.ok(f.hour.has(9));
  assert.ok(f.hour.has(13));
  assert.ok(f.hour.has(17));
  assert.ok(!f.hour.has(8));
  assert.ok(!f.hour.has(18));
});

test('Invalid cron throws', () => {
  assert.throws(() => parseCron('* *'), /5 fields/);
});

// --- Cron matching ---
console.log('2. Cron schedule matching...');

test('Match every minute', () => {
  const f = parseCron('* * * * *');
  assert.ok(matchesCron(new Date(), f));
});

test('Match specific minute', () => {
  const f = parseCron('30 * * * *');
  const at30 = new Date(2026, 3, 5, 10, 30, 0);
  const at31 = new Date(2026, 3, 5, 10, 31, 0);
  assert.ok(matchesCron(at30, f));
  assert.ok(!matchesCron(at31, f));
});

test('Match day of week', () => {
  const f = parseCron('* * * * 1'); // Monday
  const monday = new Date(2026, 3, 6); // April 6, 2026 = Monday
  const tuesday = new Date(2026, 3, 7);
  assert.ok(matchesCron(monday, f));
  assert.ok(!matchesCron(tuesday, f));
});

test('Match every 15 minutes at hour 9', () => {
  const f = parseCron('*/15 9 * * *');
  const match = new Date(2026, 3, 5, 9, 0, 0);
  const noMatch = new Date(2026, 3, 5, 10, 0, 0);
  assert.ok(matchesCron(match, f));
  assert.ok(!matchesCron(noMatch, f));
});

// --- CronMonitor ---
console.log('3. CronMonitor...');

test('CronMonitor constructor', () => {
  const m = new CronMonitor('test', { command: 'echo hi', schedule: '*/5 * * * *' });
  assert.equal(m.command, 'echo hi');
  assert.equal(m.schedule, '*/5 * * * *');
});

test('CronMonitor requires command', () => {
  assert.throws(() => new CronMonitor('test', { schedule: '* * * * *' }), /requires config.command/);
});

await testAsync('CronMonitor skips when schedule does not match', async () => {
  // Use a schedule that won't match current time (minute 99 doesn't exist, use a minute that's not now)
  const now = new Date();
  const otherMinute = (now.getMinutes() + 30) % 60;
  const m = new CronMonitor('test', { command: 'node -e "process.exit(1)"', schedule: `${otherMinute} * * * *` });
  const issues = await m.check();
  assert.equal(issues.length, 0);
});

await testAsync('CronMonitor runs when schedule matches', async () => {
  // Use * * * * * — always matches
  const m = new CronMonitor('test', { command: 'node -e "process.exit(1)"', schedule: '* * * * *' });
  const issues = await m.check();
  assert.equal(issues.length, 1);
  assert.ok(issues[0].summary.startsWith('Cron check failed'));
});

await testAsync('CronMonitor deduplicates within same minute', async () => {
  const m = new CronMonitor('test', { command: 'node -e "process.exit(1)"', schedule: '* * * * *' });
  await m.check(); // First run
  const issues = await m.check(); // Second run same minute
  assert.equal(issues.length, 0); // Should be skipped
});

await testAsync('CronMonitor succeeding command returns no issues', async () => {
  const m = new CronMonitor('test', { command: 'node -e "process.exit(0)"', schedule: '* * * * *' });
  const issues = await m.check();
  assert.equal(issues.length, 0);
});

// --- FileNotifier ---
console.log('4. FileNotifier...');

test('FileNotifier constructor', () => {
  const n = new FileNotifier('test', { dir: tmpDir });
  assert.equal(n.dir, tmpDir);
  assert.equal(n.prefix, 'result');
});

test('FileNotifier requires dir', () => {
  assert.throws(() => new FileNotifier('test', {}), /requires config.dir/);
});

await testAsync('FileNotifier writes result file', async () => {
  const outDir = resolve(tmpDir, 'results');
  const n = new FileNotifier('test', { dir: outDir });
  const result = await n.notify(
    { id: 'task-42', source: 'monitor:test', summary: 'Pod crashed' },
    { passed: true, details: 'Fixed by restart' }
  );
  assert.equal(result.sent, true);
  assert.ok(existsSync(result.path));
  const data = JSON.parse(readFileSync(result.path, 'utf-8'));
  assert.equal(data.taskId, 'task-42');
  assert.equal(data.status, 'fixed');
  assert.equal(data.passed, true);
  assert.equal(data.details, 'Fixed by restart');
  assert.ok(data.completedAt);
});

await testAsync('FileNotifier writes failure result', async () => {
  const outDir = resolve(tmpDir, 'results');
  const n = new FileNotifier('test', { dir: outDir, prefix: 'fail' });
  const result = await n.notify(
    { id: 'task-99', source: 'input:bridge', summary: 'OOM' },
    { passed: false, details: 'OOM killed' }
  );
  assert.equal(result.sent, true);
  const data = JSON.parse(readFileSync(result.path, 'utf-8'));
  assert.equal(data.status, 'failed');
  assert.equal(data.passed, false);
});

await testAsync('FileNotifier creates dir if missing', async () => {
  const newDir = resolve(tmpDir, 'new-output');
  assert.ok(!existsSync(newDir));
  const n = new FileNotifier('test', { dir: newDir });
  await n.notify({ id: 'x' }, { passed: true, details: 'ok' });
  assert.ok(existsSync(newDir));
  const files = readdirSync(newDir);
  assert.equal(files.length, 1);
});

await testAsync('FileNotifier sanitizes path traversal in task.id', async () => {
  const outDir = resolve(tmpDir, 'safe-output');
  const n = new FileNotifier('test', { dir: outDir });
  const result = await n.notify(
    { id: '../../../etc/passwd', source: 'test', summary: 'Malicious' },
    { passed: true, details: 'ok' }
  );
  assert.equal(result.sent, true);
  // File must be inside outDir, not escaped via ../
  assert.ok(result.path.startsWith(outDir), `File stays in output dir: ${result.path}`);
  assert.ok(!result.path.includes('..'), 'No .. in path');
  assert.ok(existsSync(result.path));
});

// --- Registration ---
console.log('5. Registration...');

test('CronMonitor registered as "cron"', () => {
  const r = new Registry();
  registerBuiltins(r);
  assert.ok(r.getMonitor('cron'));
});

test('FileNotifier registered as "file"', () => {
  const r = new Registry();
  registerBuiltins(r);
  assert.ok(r.getNotifier('file'));
});

// Cleanup
if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
