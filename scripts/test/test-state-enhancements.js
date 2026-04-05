#!/usr/bin/env node

// Tests for State enhancements: configurable dedup window, history rotation, plugin loader.

import { strict as assert } from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { State } from '../../src/state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const TEST_STATE_DIR = resolve(ROOT, 'state', '_test_enhancements');

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

function freshState(options = {}) {
  if (existsSync(TEST_STATE_DIR)) rmSync(TEST_STATE_DIR, { recursive: true });
  return new State(TEST_STATE_DIR, options);
}

// --- Configurable dedup window ---
console.log('1. Configurable dedup window...');

test('Default dedup window is 1 hour', () => {
  const state = freshState();
  assert.equal(state.dedupWindow, 3600000);
});

test('Custom dedup window', () => {
  const state = freshState({ dedupWindow: 5000 });
  assert.equal(state.dedupWindow, 5000);
});

test('Dedup respects custom window', () => {
  const state = freshState({ dedupWindow: 100 }); // 100ms
  state.enqueue({ id: 'dup-test', summary: 'test' });
  const task = state.dequeue();
  state.complete('dup-test', { passed: true });

  // Immediately after: should be duplicate
  assert.ok(state.isDuplicate('dup-test'));

  // Hack completedAt to simulate time passing beyond window
  state.history[0].completedAt = Date.now() - 200;
  assert.ok(!state.isDuplicate('dup-test'), 'Should not be duplicate after window expires');
});

test('Zero dedup window means no dedup from history', () => {
  const state = freshState({ dedupWindow: 0 });
  state.enqueue({ id: 'zero-test', summary: 'test' });
  const task = state.dequeue();
  state.complete('zero-test', { passed: true });

  // With window=0, cutoff is now, so nothing in history is recent enough
  assert.ok(!state.isDuplicate('zero-test'));
});

test('Queue-based dedup still works regardless of window', () => {
  const state = freshState({ dedupWindow: 0 });
  state.enqueue({ id: 'q-dup', summary: 'test' });
  // Still in queue — should be duplicate regardless of window
  assert.ok(state.isDuplicate('q-dup'));
});

// --- History rotation ---
console.log('2. History rotation...');

test('Default maxHistory is 1000', () => {
  const state = freshState();
  assert.equal(state.maxHistory, 1000);
});

test('Custom maxHistory', () => {
  const state = freshState({ maxHistory: 5 });
  assert.equal(state.maxHistory, 5);
});

test('History rotates when exceeding maxHistory', () => {
  const state = freshState({ maxHistory: 3 });

  // Add 5 tasks
  for (let i = 1; i <= 5; i++) {
    state.enqueue({ id: `rot-${i}`, summary: `task ${i}` });
    state.dequeue();
    state.complete(`rot-${i}`, { passed: true });
  }

  assert.equal(state.history.length, 3, `History should be capped at 3, got ${state.history.length}`);
  // Should keep the most recent 3
  assert.equal(state.history[0].id, 'rot-3');
  assert.equal(state.history[1].id, 'rot-4');
  assert.equal(state.history[2].id, 'rot-5');
});

test('History rotation preserves newest entries', () => {
  const state = freshState({ maxHistory: 2 });

  for (let i = 1; i <= 10; i++) {
    state.enqueue({ id: `keep-${i}`, summary: `task ${i}` });
    state.dequeue();
    state.complete(`keep-${i}`, { passed: i % 2 === 0 });
  }

  assert.equal(state.history.length, 2);
  assert.equal(state.history[0].id, 'keep-9');
  assert.equal(state.history[1].id, 'keep-10');
});

test('Metrics not affected by rotation', () => {
  const state = freshState({ maxHistory: 2 });

  for (let i = 1; i <= 5; i++) {
    state.enqueue({ id: `m-${i}`, summary: `task ${i}` });
    state.dequeue();
    state.complete(`m-${i}`, { passed: true });
  }

  assert.equal(state.metrics.fixes, 5, 'All 5 fixes counted despite rotation');
  assert.equal(state.history.length, 2, 'History capped at 2');
});

// --- Priority-aware dequeue ---
console.log('3. Priority-aware dequeue...');

test('Default priority is normal', () => {
  const state = freshState();
  const task = state.enqueue({ id: 'p-1', summary: 'test' });
  assert.equal(task.priority, 'normal');
});

test('Critical dequeued before normal', () => {
  const state = freshState();
  state.enqueue({ id: 'p-norm', summary: 'normal task' });
  state.enqueue({ id: 'p-crit', summary: 'critical task', priority: 'critical' });

  const first = state.dequeue();
  assert.equal(first.id, 'p-crit', 'Critical should be first');
  const second = state.dequeue();
  assert.equal(second.id, 'p-norm', 'Normal should be second');
});

test('Priority order: critical > high > normal > low', () => {
  const state = freshState();
  state.enqueue({ id: 'p-low', summary: 'low', priority: 'low' });
  state.enqueue({ id: 'p-high', summary: 'high', priority: 'high' });
  state.enqueue({ id: 'p-norm', summary: 'normal', priority: 'normal' });
  state.enqueue({ id: 'p-crit', summary: 'critical', priority: 'critical' });

  const order = [];
  let task;
  while ((task = state.dequeue())) order.push(task.id);
  assert.deepEqual(order, ['p-crit', 'p-high', 'p-norm', 'p-low']);
});

test('Same priority uses FIFO (enqueuedAt)', () => {
  const state = freshState();
  state.enqueue({ id: 'fifo-1', summary: 'first', priority: 'high' });
  state.enqueue({ id: 'fifo-2', summary: 'second', priority: 'high' });
  state.enqueue({ id: 'fifo-3', summary: 'third', priority: 'high' });

  const order = [];
  let task;
  while ((task = state.dequeue())) order.push(task.id);
  assert.deepEqual(order, ['fifo-1', 'fifo-2', 'fifo-3']);
});

test('Unknown priority treated as normal', () => {
  const state = freshState();
  state.enqueue({ id: 'unk-1', summary: 'unknown', priority: 'mystery' });
  state.enqueue({ id: 'unk-2', summary: 'high', priority: 'high' });

  const first = state.dequeue();
  assert.equal(first.id, 'unk-2', 'High before unknown');
});

test('In-progress tasks skipped during priority dequeue', () => {
  const state = freshState();
  state.enqueue({ id: 'skip-1', summary: 'first', priority: 'critical' });
  state.enqueue({ id: 'skip-2', summary: 'second', priority: 'low' });

  const first = state.dequeue(); // Takes critical
  assert.equal(first.id, 'skip-1');
  const second = state.dequeue(); // Should get low, not re-pick critical
  assert.equal(second.id, 'skip-2');
});

// --- Plugin loader (via Manager) ---
console.log('4. Plugin loader...');

test('Plugin path detection', () => {
  // Just test that the path-based type detection logic is correct
  const isPlugin = (type) => type.startsWith('./') || type.startsWith('/') || type.startsWith('../');
  assert.ok(isPlugin('./plugins/custom.js'));
  assert.ok(isPlugin('/absolute/path/plugin.js'));
  assert.ok(isPlugin('../sibling/plugin.js'));
  assert.ok(!isPlugin('process'));
  assert.ok(!isPlugin('bridge'));
  assert.ok(!isPlugin('shtd'));
});

// --- State persistence with new options ---
console.log('5. State persistence with options...');

test('State loads from disk with correct options', () => {
  const state1 = freshState({ dedupWindow: 5000, maxHistory: 50 });
  state1.enqueue({ id: 'persist-1', summary: 'test' });
  state1.dequeue();
  state1.complete('persist-1', { passed: true });

  // Create new state pointing to same dir
  const state2 = new State(TEST_STATE_DIR, { dedupWindow: 5000, maxHistory: 50 });
  assert.equal(state2.history.length, 1);
  assert.equal(state2.history[0].id, 'persist-1');
  assert.equal(state2.dedupWindow, 5000);
  assert.equal(state2.maxHistory, 50);
});

// Cleanup
if (existsSync(TEST_STATE_DIR)) rmSync(TEST_STATE_DIR, { recursive: true });

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
