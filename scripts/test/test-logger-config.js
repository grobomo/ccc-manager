#!/usr/bin/env node

// Tests for logger and config validation.

import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { createLogger } from '../../src/logger.js';
import { validateConfig, loadConfig } from '../../src/config.js';

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

// Cleanup
if (existsSync(TMP)) rmSync(TMP, { recursive: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
