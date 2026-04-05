#!/usr/bin/env node

// Tests for logger and config validation.

import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createLogger } from '../../src/logger.js';
import { validateConfig, loadConfig, interpolateEnv } from '../../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const TMP = resolve(ROOT, 'state', '_test_logger_config');

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

// --- Logger ---
console.log('1. Logger...');

test('createLogger returns object with debug/info/warn/error', () => {
  const log = createLogger('test');
  assert.equal(typeof log.debug, 'function');
  assert.equal(typeof log.info, 'function');
  assert.equal(typeof log.warn, 'function');
  assert.equal(typeof log.error, 'function');
});

test('JSON mode emits valid JSON to stderr', () => {
  const log = createLogger('test-json', { json: true });
  const chunks = [];
  const origWrite = process.stderr.write;
  process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
  log.info('hello', { count: 42 });
  process.stderr.write = origWrite;

  const parsed = JSON.parse(chunks[0]);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.component, 'test-json');
  assert.equal(parsed.msg, 'hello');
  assert.equal(parsed.count, 42);
  assert.ok(parsed.ts); // ISO timestamp
});

test('Text mode emits human-readable to stdout', () => {
  const log = createLogger('test-text', { json: false });
  const chunks = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  log.info('started', { port: 8080 });
  process.stdout.write = origWrite;

  assert.ok(chunks[0].includes('[test-text]'));
  assert.ok(chunks[0].includes('started'));
  assert.ok(chunks[0].includes('port=8080'));
});

test('Level filtering works', () => {
  const log = createLogger('test-level', { json: true, level: 'warn' });
  const chunks = [];
  const origWrite = process.stderr.write;
  process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
  log.debug('should not appear');
  log.info('should not appear');
  log.warn('should appear');
  log.error('should appear');
  process.stderr.write = origWrite;

  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].includes('should appear'));
});

test('Warn/error go to stderr in text mode', () => {
  const log = createLogger('test-stderr', { json: false });
  const stderrChunks = [];
  const stdoutChunks = [];
  const origStderr = process.stderr.write;
  const origStdout = process.stdout.write;
  process.stderr.write = (chunk) => { stderrChunks.push(chunk); return true; };
  process.stdout.write = (chunk) => { stdoutChunks.push(chunk); return true; };
  log.info('info msg');
  log.error('error msg');
  process.stderr.write = origStderr;
  process.stdout.write = origStdout;

  assert.equal(stdoutChunks.length, 1);
  assert.ok(stdoutChunks[0].includes('info msg'));
  assert.equal(stderrChunks.length, 1);
  assert.ok(stderrChunks[0].includes('error msg'));
});

test('Empty data produces no extra output', () => {
  const log = createLogger('test-empty', { json: false });
  const chunks = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  log.info('clean');
  process.stdout.write = origWrite;

  assert.equal(chunks[0].trim(), '[test-empty] clean');
});

test('JSON mode filters undefined values from data', () => {
  const log = createLogger('test-json-undef', { json: true });
  const chunks = [];
  const origWrite = process.stderr.write;
  process.stderr.write = (chunk) => { chunks.push(chunk); return true; };
  log.info('task', { id: '123', retry: undefined, dryRun: undefined });
  process.stderr.write = origWrite;

  const parsed = JSON.parse(chunks[0]);
  assert.equal(parsed.id, '123');
  assert.ok(!('retry' in parsed), 'No retry key in JSON');
  assert.ok(!('dryRun' in parsed), 'No dryRun key in JSON');
});

test('Text mode filters undefined values from data', () => {
  const log = createLogger('test-undef', { json: false });
  const chunks = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  log.info('task', { id: '123', retry: undefined, dryRun: undefined });
  process.stdout.write = origWrite;

  assert.ok(chunks[0].includes('id=123'), 'Includes defined value');
  assert.ok(!chunks[0].includes('undefined'), 'No undefined in output');
  assert.ok(!chunks[0].includes('retry='), 'No retry key');
  assert.ok(!chunks[0].includes('dryRun='), 'No dryRun key');
});

test('Text mode: all-undefined data produces no extra', () => {
  const log = createLogger('test-all-undef', { json: false });
  const chunks = [];
  const origWrite = process.stdout.write;
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  log.info('clean', { a: undefined, b: undefined });
  process.stdout.write = origWrite;

  assert.equal(chunks[0].trim(), '[test-all-undef] clean');
});

// --- Exec helper ---
console.log('1b. Exec helper...');

import { execCommand } from '../../src/monitors/exec-helper.js';

test('execCommand success', () => {
  const result = execCommand('node -e "process.exit(0)"', 5000);
  assert.equal(result.success, true);
});

test('execCommand failure returns exitCode and stderr', () => {
  const result = execCommand('node -e "process.stderr.write(\'err\\n\');process.exit(1)"', 5000);
  assert.equal(result.success, false);
  assert.equal(result.exitCode, 1);
  assert.ok(result.stderr.includes('err'));
});

test('execCommand truncates long commands in preview', () => {
  const longCmd = 'echo ' + 'a'.repeat(200);
  const result = execCommand(longCmd, 5000);
  assert.ok(result.cmdPreview.length <= 80, `Preview too long: ${result.cmdPreview.length}`);
  assert.ok(result.cmdPreview.endsWith('...'));
});

test('execCommand short command preview is full command', () => {
  const result = execCommand('echo hi', 5000);
  assert.equal(result.cmdPreview, 'echo hi');
});

// --- Config validation ---
console.log('2. Config validation...');

test('Valid config passes', () => {
  const errors = validateConfig({ name: 'test', interval: 5000 });
  assert.equal(errors.length, 0);
});

test('Missing name fails', () => {
  const errors = validateConfig({ interval: 5000 });
  assert.ok(errors.some(e => e.includes('name')));
});

test('Invalid interval fails', () => {
  const errors = validateConfig({ name: 'test', interval: 500 });
  assert.ok(errors.some(e => e.includes('interval')));
});

test('Negative maxRetries fails', () => {
  const errors = validateConfig({ name: 'test', maxRetries: -1 });
  assert.ok(errors.some(e => e.includes('maxRetries')));
});

test('Invalid dedupWindow fails', () => {
  const errors = validateConfig({ name: 'test', dedupWindow: -100 });
  assert.ok(errors.some(e => e.includes('dedupWindow')));
});

test('Invalid maxHistory fails', () => {
  const errors = validateConfig({ name: 'test', maxHistory: 0 });
  assert.ok(errors.some(e => e.includes('maxHistory')));
});

test('Invalid logFormat fails', () => {
  const errors = validateConfig({ name: 'test', logFormat: 'xml' });
  assert.ok(errors.some(e => e.includes('logFormat')));
});

test('Valid logFormat json passes', () => {
  const errors = validateConfig({ name: 'test', logFormat: 'json' });
  assert.equal(errors.length, 0);
});

test('Component section with non-object entry fails', () => {
  const errors = validateConfig({ name: 'test', monitors: { bad: 'string' } });
  assert.ok(errors.some(e => e.includes('monitors.bad')));
});

test('Valid component section passes', () => {
  const errors = validateConfig({ name: 'test', monitors: { health: { type: 'process', command: 'echo ok' } } });
  assert.equal(errors.length, 0);
});

// --- loadConfig with validation ---
console.log('3. loadConfig with validation...');

if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });

test('loadConfig rejects invalid config', () => {
  const badPath = resolve(TMP, 'bad.yaml');
  writeFileSync(badPath, 'interval: 100\n');
  try {
    loadConfig(badPath);
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('validation failed'));
    assert.ok(err.message.includes('name'));
  }
});

test('loadConfig accepts valid config', () => {
  const goodPath = resolve(TMP, 'good.yaml');
  writeFileSync(goodPath, 'name: test\ninterval: 5000\n');
  const config = loadConfig(goodPath);
  assert.equal(config.name, 'test');
});

// --- CLI flags ---
console.log('4. CLI flags...');

import { execFileSync } from 'node:child_process';
const CLI = resolve(ROOT, 'src/index.js');

test('--help prints usage and exits 0', () => {
  const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf-8' });
  assert.ok(out.includes('Usage:'));
  assert.ok(out.includes('--validate'));
  assert.ok(out.includes('ccc-manager v'));
});

test('-h is alias for --help', () => {
  const out = execFileSync('node', [CLI, '-h'], { encoding: 'utf-8' });
  assert.ok(out.includes('Usage:'));
});

test('--version prints semver and exits 0', () => {
  const out = execFileSync('node', [CLI, '--version'], { encoding: 'utf-8' }).trim();
  assert.ok(/^\d+\.\d+\.\d+$/.test(out), `Got: ${out}`);
});

test('-v is alias for --version', () => {
  const out = execFileSync('node', [CLI, '-v'], { encoding: 'utf-8' }).trim();
  assert.ok(/^\d+\.\d+\.\d+$/.test(out));
});

test('--validate with valid config prints OK', () => {
  const out = execFileSync('node', [CLI, '--validate', resolve(ROOT, 'config/example.yaml')], { encoding: 'utf-8' });
  assert.ok(out.includes('OK'));
});

test('--validate with invalid config exits 1', () => {
  const badPath = resolve(TMP || ROOT, 'state', '_test_cli_bad.yaml');
  mkdirSync(dirname(badPath), { recursive: true });
  writeFileSync(badPath, 'interval: 100\n');
  try {
    execFileSync('node', [CLI, '--validate', badPath], { encoding: 'utf-8' });
    assert.fail('Should have exited with code 1');
  } catch (err) {
    assert.ok(err.status === 1);
    assert.ok(err.stderr.includes('validation failed') || err.stdout.includes('validation failed'));
  }
  rmSync(badPath, { force: true });
});

test('--list-components shows all component types', () => {
  const out = execFileSync('node', [CLI, '--list-components'], { encoding: 'utf-8' });
  assert.ok(out.includes('Monitors:'));
  assert.ok(out.includes('process'));
  assert.ok(out.includes('Inputs:'));
  assert.ok(out.includes('bridge'));
  assert.ok(out.includes('Workers:'));
  assert.ok(out.includes('k8s'));
});

test('--dry-run runs one cycle and exits', () => {
  const out = execFileSync('node', [CLI, '--dry-run', resolve(ROOT, 'config/example.yaml')], { encoding: 'utf-8' });
  assert.ok(out.includes('[dry-run]'), 'Output includes dry-run marker');
  assert.ok(out.includes('issues') || out.includes('Cycle complete'), 'Output includes cycle summary');
});

test('--status prints queue and metrics', () => {
  const out = execFileSync('node', [CLI, '--status', resolve(ROOT, 'config/example.yaml')], { encoding: 'utf-8' });
  assert.ok(out.includes('Queue:'), 'Output includes Queue');
  assert.ok(out.includes('Metrics:'), 'Output includes Metrics');
});

test('--status works without config arg', () => {
  const out = execFileSync('node', [CLI, '--status'], { encoding: 'utf-8' });
  assert.ok(out.includes('Queue:'), 'Output includes Queue');
  assert.ok(out.includes('Metrics:'), 'Output includes Metrics');
});

test('--help includes --dry-run and --status', () => {
  const out = execFileSync('node', [CLI, '--help'], { encoding: 'utf-8' });
  assert.ok(out.includes('--dry-run'), 'Help includes --dry-run');
  assert.ok(out.includes('--status'), 'Help includes --status');
});

test('No args prints usage and exits 1', () => {
  try {
    execFileSync('node', [CLI], { encoding: 'utf-8' });
    assert.fail('Should have exited with code 1');
  } catch (err) {
    assert.ok(err.status === 1);
    assert.ok(err.stderr.includes('Usage:'));
  }
});

// --- Env var interpolation ---
console.log('5. Env var interpolation...');

test('interpolateEnv resolves ${VAR} from process.env', () => {
  process.env._CCC_TEST_VAR = 'hello';
  assert.equal(interpolateEnv('${_CCC_TEST_VAR}'), 'hello');
  delete process.env._CCC_TEST_VAR;
});

test('interpolateEnv resolves ${VAR:-default} with env set', () => {
  process.env._CCC_TEST_VAR2 = 'real';
  assert.equal(interpolateEnv('${_CCC_TEST_VAR2:-fallback}'), 'real');
  delete process.env._CCC_TEST_VAR2;
});

test('interpolateEnv uses default when env var not set', () => {
  delete process.env._CCC_TEST_MISSING;
  assert.equal(interpolateEnv('${_CCC_TEST_MISSING:-my-default}'), 'my-default');
});

test('interpolateEnv leaves ${VAR} unresolved when not set and no default', () => {
  delete process.env._CCC_TEST_NOPE;
  assert.equal(interpolateEnv('${_CCC_TEST_NOPE}'), '${_CCC_TEST_NOPE}');
});

test('interpolateEnv handles multiple vars in one string', () => {
  process.env._CCC_A = 'foo';
  process.env._CCC_B = 'bar';
  assert.equal(interpolateEnv('${_CCC_A}/${_CCC_B}'), 'foo/bar');
  delete process.env._CCC_A;
  delete process.env._CCC_B;
});

test('interpolateEnv recurses into nested objects', () => {
  process.env._CCC_DEEP = 'deep-val';
  const result = interpolateEnv({ a: { b: { c: '${_CCC_DEEP}' } } });
  assert.equal(result.a.b.c, 'deep-val');
  delete process.env._CCC_DEEP;
});

test('interpolateEnv recurses into arrays', () => {
  process.env._CCC_ARR = 'item';
  const result = interpolateEnv(['${_CCC_ARR}', 'plain']);
  assert.deepEqual(result, ['item', 'plain']);
  delete process.env._CCC_ARR;
});

test('interpolateEnv passes through non-strings unchanged', () => {
  assert.equal(interpolateEnv(42), 42);
  assert.equal(interpolateEnv(true), true);
  assert.equal(interpolateEnv(null), null);
});

test('loadConfig resolves env vars in YAML', () => {
  process.env._CCC_TEST_NAME = 'env-project';
  const envPath = resolve(TMP, 'env.yaml');
  if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });
  writeFileSync(envPath, 'name: "${_CCC_TEST_NAME}"\ninterval: 5000\n');
  const config = loadConfig(envPath);
  assert.equal(config.name, 'env-project');
  delete process.env._CCC_TEST_NAME;
});

// Cleanup
if (existsSync(TMP)) rmSync(TMP, { recursive: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
