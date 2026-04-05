#!/usr/bin/env node

// Tests for task claim system (multi-worker coordination).

import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { State } from '../../src/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const TMP = resolve(ROOT, 'state', '_test_claims');

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

function freshState(opts = {}) {
  const dir = resolve(TMP, `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  return new State(dir, opts);
}

// --- Basic claim/release ---
console.log('1. Basic claim/release...');

test('claim succeeds with no existing claim', () => {
  const s = freshState({ workerId: 'worker-A' });
  assert.equal(s.claim('task-1'), true);
});

test('claim by same worker is idempotent', () => {
  const s = freshState({ workerId: 'worker-A' });
  assert.equal(s.claim('task-1'), true);
  assert.equal(s.claim('task-1'), true);
});

test('claim by different worker is rejected', () => {
  const s = freshState({ workerId: 'worker-A' });
  s.claim('task-1');
  // Simulate worker-B by calling claim with explicit workerId
  assert.equal(s.claim('task-1', 'worker-B'), false);
});

test('release allows another worker to claim', () => {
  const s = freshState({ workerId: 'worker-A' });
  s.claim('task-1');
  s.release('task-1');
  assert.equal(s.claim('task-1', 'worker-B'), true);
});

test('release by non-owner is rejected', () => {
  const s = freshState({ workerId: 'worker-A' });
  s.claim('task-1');
  assert.equal(s.release('task-1', 'worker-B'), false);
});

test('release of non-existent claim succeeds', () => {
  const s = freshState({ workerId: 'worker-A' });
  assert.equal(s.release('no-such-task'), true);
});

// --- isClaimed ---
console.log('2. isClaimed...');

test('isClaimed returns null for unclaimed task', () => {
  const s = freshState({ workerId: 'worker-A' });
  assert.equal(s.isClaimed('task-1'), null);
});

test('isClaimed returns null for own claim', () => {
  const s = freshState({ workerId: 'worker-A' });
  s.claim('task-1');
  assert.equal(s.isClaimed('task-1'), null);
});

test('isClaimed returns workerId for other worker claim', () => {
  const s = freshState({ workerId: 'worker-A' });
  s.claim('task-1');
  assert.equal(s.isClaimed('task-1', 'worker-B'), 'worker-A');
});

// --- Claim expiry ---
console.log('3. Claim expiry...');

test('expired claim allows new claim', () => {
  const s = freshState({ workerId: 'worker-A', claimTimeout: 1 }); // 1ms timeout
  s.claim('task-1');
  // Wait for expiry
  const start = Date.now();
  while (Date.now() - start < 5) {} // busy-wait 5ms
  assert.equal(s.claim('task-1', 'worker-B'), true);
});

test('expired claim not reported by isClaimed', () => {
  const s = freshState({ workerId: 'worker-A', claimTimeout: 1 });
  s.claim('task-1');
  const start = Date.now();
  while (Date.now() - start < 5) {}
  assert.equal(s.isClaimed('task-1', 'worker-B'), null);
});

test('pruneExpiredClaims removes stale claims', () => {
  const s = freshState({ workerId: 'worker-A', claimTimeout: 1 });
  s.claim('task-1');
  s.claim('task-2');
  const start = Date.now();
  while (Date.now() - start < 5) {}
  assert.equal(s.pruneExpiredClaims(), 2);
});

// --- Dequeue with claims ---
console.log('4. Dequeue respects claims...');

test('dequeue skips tasks claimed by other workers', () => {
  const s = freshState({ workerId: 'worker-B' });
  s.enqueue({ id: 'task-1', summary: 'first' });
  s.enqueue({ id: 'task-2', summary: 'second' });
  // Simulate worker-A claiming task-1
  s.claim('task-1', 'worker-A');
  const task = s.dequeue();
  assert.equal(task.id, 'task-2'); // Skipped task-1
});

test('dequeue returns null when all tasks claimed by others', () => {
  const s = freshState({ workerId: 'worker-B' });
  s.enqueue({ id: 'task-1', summary: 'first' });
  s.claim('task-1', 'worker-A');
  const task = s.dequeue();
  assert.equal(task, null);
});

test('dequeue claims task for current worker', () => {
  const s = freshState({ workerId: 'worker-A' });
  s.enqueue({ id: 'task-1', summary: 'first' });
  const task = s.dequeue();
  assert.equal(task.id, 'task-1');
  assert.equal(task.claimedBy, 'worker-A');
  // Another worker can't claim it now
  assert.equal(s.claim('task-1', 'worker-B'), false);
});

test('dequeue without workerId works like before (no claims)', () => {
  const s = freshState(); // no workerId
  s.enqueue({ id: 'task-1', summary: 'first' });
  const task = s.dequeue();
  assert.equal(task.id, 'task-1');
  assert.equal(task.claimedBy, undefined);
});

// --- Sanitization ---
console.log('5. Claim ID sanitization...');

test('claim sanitizes task IDs with special chars', () => {
  const s = freshState({ workerId: 'worker-A' });
  assert.equal(s.claim('../../etc/passwd'), true);
  assert.equal(s.claim('task with spaces'), true);
});

// Cleanup
if (existsSync(TMP)) rmSync(TMP, { recursive: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
