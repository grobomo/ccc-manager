#!/usr/bin/env node

// Tests for ClaudeDispatcher — prompt building, response parsing, fallback.
// Does NOT call real Claude CLI — tests the logic around it.

import { strict as assert } from 'node:assert';
import { ClaudeDispatcher } from '../../src/dispatcher/claude.js';

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

// --- Prompt building ---
console.log('1. Prompt building...');

test('Prompt includes issue summary', () => {
  const d = new ClaudeDispatcher({});
  const prompt = d._buildPrompt({ summary: 'Pod crash loop', severity: 'high' });
  assert.ok(prompt.includes('Pod crash loop'));
  assert.ok(prompt.includes('high'));
});

test('Prompt includes string details', () => {
  const d = new ClaudeDispatcher({});
  const prompt = d._buildPrompt({ summary: 'test', details: 'Error: OOM killed' });
  assert.ok(prompt.includes('Error: OOM killed'));
});

test('Prompt includes object details as JSON', () => {
  const d = new ClaudeDispatcher({});
  const prompt = d._buildPrompt({ summary: 'test', details: { command: 'npm test', exitCode: 1 } });
  assert.ok(prompt.includes('"command"'));
  assert.ok(prompt.includes('npm test'));
});

test('Prompt respects maxPromptLen', () => {
  const d = new ClaudeDispatcher({ maxPromptLen: 100 });
  const prompt = d._buildPrompt({ summary: 'A'.repeat(200) });
  assert.ok(prompt.length <= 100);
});

test('Prompt includes output format spec', () => {
  const d = new ClaudeDispatcher({});
  const prompt = d._buildPrompt({ summary: 'test' });
  assert.ok(prompt.includes('Required Output Format'));
  assert.ok(prompt.includes('"tasks"'));
});

// --- Response parsing ---
console.log('2. Response parsing...');

test('Parse clean JSON', () => {
  const d = new ClaudeDispatcher({});
  const result = d._parseResponse('{"title":"Fix OOM","tasks":[{"type":"fix","summary":"Increase memory","command":"kubectl set resources"}]}');
  assert.equal(result.title, 'Fix OOM');
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].type, 'fix');
});

test('Parse JSON with markdown fences', () => {
  const d = new ClaudeDispatcher({});
  const raw = '```json\n{"title":"Fix","tasks":[{"type":"investigate","summary":"Check logs","command":"kubectl logs pod"}]}\n```';
  const result = d._parseResponse(raw);
  assert.ok(result);
  assert.equal(result.tasks.length, 1);
});

test('Parse JSON with surrounding text', () => {
  const d = new ClaudeDispatcher({});
  const raw = 'Here is the plan:\n{"title":"Fix","tasks":[{"type":"fix","summary":"Restart","command":"kubectl rollout restart"}]}\nDone.';
  const result = d._parseResponse(raw);
  assert.ok(result);
  assert.equal(result.tasks[0].command, 'kubectl rollout restart');
});

test('Reject response with no tasks array', () => {
  const d = new ClaudeDispatcher({});
  const result = d._parseResponse('{"title":"Fix","steps":["one","two"]}');
  assert.equal(result, null);
});

test('Reject non-JSON response', () => {
  const d = new ClaudeDispatcher({});
  const result = d._parseResponse('I cannot help with that request.');
  assert.equal(result, null);
});

test('Reject empty response', () => {
  const d = new ClaudeDispatcher({});
  assert.equal(d._parseResponse(''), null);
  assert.equal(d._parseResponse('   '), null);
});

test('Parse multi-task plan', () => {
  const d = new ClaudeDispatcher({});
  const raw = JSON.stringify({
    title: 'Fix crash loop',
    tasks: [
      { type: 'investigate', summary: 'Check logs', command: 'kubectl logs pod' },
      { type: 'fix', summary: 'Increase memory', command: 'kubectl set resources' },
      { type: 'verify', summary: 'Confirm running', command: 'kubectl get pods' }
    ]
  });
  const result = d._parseResponse(raw);
  assert.equal(result.tasks.length, 3);
});

// --- Analyze (fallback path, no real Claude) ---
console.log('3. Analyze fallback (Claude unavailable)...');

await testAsync('Fallback produces investigate task', async () => {
  // Use a non-existent command so it fails immediately
  const d = new ClaudeDispatcher({ claudePath: 'nonexistent-claude-binary-xyz', timeout: 1000 });
  const plan = await d.analyze({ id: 'test-1', summary: 'Pod crash', severity: 'high' });
  assert.ok(plan.spec.id.startsWith('repair-'));
  assert.equal(plan.spec.aiGenerated, false);
  assert.equal(plan.tasks.length, 1);
  assert.equal(plan.tasks[0].type, 'investigate');
  assert.ok(plan.tasks[0].summary.includes('Pod crash'));
});

await testAsync('Fallback adds verify task when command present', async () => {
  const d = new ClaudeDispatcher({ claudePath: 'nonexistent-claude-binary-xyz', timeout: 1000 });
  const plan = await d.analyze({
    id: 'test-2',
    summary: 'Tests failing',
    details: { command: 'npm test' }
  });
  assert.equal(plan.spec.aiGenerated, false);
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[1].type, 'verify');
  assert.ok(plan.tasks[1].command.includes('npm test'));
});

// --- Dispatch ---
console.log('4. Dispatch...');

await testAsync('Dispatch with no workers returns skipped', async () => {
  const d = new ClaudeDispatcher({});
  const plan = {
    spec: { id: 'test', aiGenerated: true },
    tasks: [{ id: 't1', type: 'fix', summary: 'Fix it', command: 'echo fixed' }]
  };
  const result = await d.dispatch(plan, {}, {});
  assert.equal(result.status, 'completed');
  assert.equal(result.results[0].skipped, true);
  assert.equal(result.aiGenerated, true);
});

await testAsync('Dispatch calls worker execute', async () => {
  const d = new ClaudeDispatcher({});
  let called = false;
  const mockWorker = {
    execute: async (task) => { called = true; return { success: true, output: 'done' }; }
  };
  const plan = {
    spec: { id: 'test', aiGenerated: false },
    tasks: [{ id: 't1', type: 'fix', summary: 'Fix', command: 'echo hi' }]
  };
  const result = await d.dispatch(plan, {}, { default: mockWorker });
  assert.ok(called);
  assert.equal(result.status, 'completed');
});

await testAsync('Dispatch handles worker error', async () => {
  const d = new ClaudeDispatcher({});
  const mockWorker = {
    execute: async () => { throw new Error('worker died'); }
  };
  const plan = {
    spec: { id: 'test', aiGenerated: true },
    tasks: [{ id: 't1', type: 'fix', summary: 'Fix', command: 'echo hi' }]
  };
  const result = await d.dispatch(plan, {}, { default: mockWorker });
  assert.equal(result.status, 'partial');
  assert.equal(result.results[0].success, false);
});

// --- Constructor config ---
console.log('5. Constructor config...');

test('Default config values', () => {
  const d = new ClaudeDispatcher({});
  assert.equal(d.claudePath, 'claude');
  assert.equal(d.timeout, 60000);
  assert.equal(d.maxPromptLen, 4000);
  assert.equal(d.projectDir, '.');
});

test('Custom config values', () => {
  const d = new ClaudeDispatcher({
    claudePath: '/usr/local/bin/claude',
    timeout: 30000,
    maxPromptLen: 2000,
    projectDir: '/app',
    model: 'haiku'
  });
  assert.equal(d.claudePath, '/usr/local/bin/claude');
  assert.equal(d.timeout, 30000);
  assert.equal(d.maxPromptLen, 2000);
  assert.equal(d.projectDir, '/app');
  assert.equal(d.model, 'haiku');
});

// --- Summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
