// Test: Task sharding - parallel dispatch with dependencies

import assert from "node:assert";
import { Dispatcher } from "../../src/base.js";

let passed = 0, failed = 0;

async function asyncTest(name, fn) {
  try { await fn(); console.log("  PASS: " + name); passed++; }
  catch (err) { console.error("  FAIL: " + name + ": " + err.message); failed++; }
}

function createMockWorker(delay = 10) {
  const log = [];
  return {
    log,
    execute: async (task) => {
      const start = Date.now();
      log.push({ taskId: task.id, start });
      await new Promise(r => setTimeout(r, delay));
      log.push({ taskId: task.id, end: Date.now() });
      return { success: true, output: "done: " + task.id };
    }
  };
}

function createFailWorker() {
  return {
    execute: async (task) => {
      if (task.shouldFail) return { success: false, error: "intentional failure" };
      return { success: true, output: "done: " + task.id };
    }
  };
}

const dispatcher = new Dispatcher({});

console.log("1. Sequential dispatch...");
await asyncTest("Sequential executes all tasks in order", async () => {
  const worker = createMockWorker(5);
  const plan = {
    spec: { id: "test-1" },
    tasks: [
      { id: "T1", summary: "First" },
      { id: "T2", summary: "Second" },
      { id: "T3", summary: "Third" },
    ]
  };
  const result = await dispatcher.dispatch(plan, { dispatcher: { parallel: false } }, { default: worker });
  assert.equal(result.taskCount, 3);
  assert.equal(result.status, "completed");
  assert.equal(result.results.length, 3);
  assert.equal(result.results[0].taskId, "T1");
  assert.equal(result.results[2].taskId, "T3");
});

await asyncTest("Sequential with no worker returns skipped", async () => {
  const plan = { spec: { id: "test-2" }, tasks: [{ id: "T1", summary: "Test" }] };
  const result = await dispatcher.dispatch(plan, {}, {});
  assert.equal(result.results[0].skipped, true);
});

console.log("2. Parallel dispatch...");
await asyncTest("Parallel runs independent tasks concurrently", async () => {
  const worker = createMockWorker(50);
  const plan = {
    spec: { id: "test-3" },
    tasks: [
      { id: "T1", summary: "A" },
      { id: "T2", summary: "B" },
      { id: "T3", summary: "C" },
    ]
  };
  const start = Date.now();
  const result = await dispatcher.dispatch(plan, { dispatcher: { parallel: true } }, { default: worker });
  const elapsed = Date.now() - start;
  assert.equal(result.status, "completed");
  assert.equal(result.taskCount, 3);
  assert(elapsed < 120, "Expected <120ms, got " + elapsed + "ms");
});

console.log("3. Dependency ordering...");
await asyncTest("Tasks with dependsOn wait for dependencies", async () => {
  const worker = createMockWorker(10);
  const plan = {
    spec: { id: "test-4" },
    tasks: [
      { id: "T1", summary: "First" },
      { id: "T2", summary: "Second", dependsOn: ["T1"] },
      { id: "T3", summary: "Third", dependsOn: ["T2"] },
    ]
  };
  const result = await dispatcher.dispatch(plan, { dispatcher: { parallel: true } }, { default: worker });
  assert.equal(result.status, "completed");
  const starts = {};
  const ends = {};
  for (const entry of worker.log) {
    if (entry.start !== undefined) starts[entry.taskId] = entry.start;
    if (entry.end !== undefined) ends[entry.taskId] = entry.end;
  }
  assert(ends["T1"] <= starts["T2"], "T1 should finish before T2 starts");
  assert(ends["T2"] <= starts["T3"], "T2 should finish before T3 starts");
});

await asyncTest("Diamond dependency: T2||T3 after T1, T4 after both", async () => {
  const worker = createMockWorker(50);
  const plan = {
    spec: { id: "test-5" },
    tasks: [
      { id: "T1", summary: "Root" },
      { id: "T2", summary: "Left", dependsOn: ["T1"] },
      { id: "T3", summary: "Right", dependsOn: ["T1"] },
      { id: "T4", summary: "Join", dependsOn: ["T2", "T3"] },
    ]
  };
  const start = Date.now();
  const result = await dispatcher.dispatch(plan, { dispatcher: { parallel: true } }, { default: worker });
  const elapsed = Date.now() - start;
  assert.equal(result.status, "completed");
  assert(elapsed < 250, "Expected <250ms (3 batches), got " + elapsed + "ms");
});

console.log("4. Per-task worker selection...");
await asyncTest("Tasks can specify different workers", async () => {
  const workerA = createMockWorker(5);
  const workerB = createMockWorker(5);
  const plan = {
    spec: { id: "test-6" },
    tasks: [
      { id: "T1", summary: "Use A", worker: "a" },
      { id: "T2", summary: "Use B", worker: "b" },
    ]
  };
  const result = await dispatcher.dispatch(plan, {}, { a: workerA, b: workerB });
  assert.equal(result.status, "completed");
  assert(workerA.log.length > 0, "Worker A was used");
  assert(workerB.log.length > 0, "Worker B was used");
});

console.log("5. Failure handling...");
await asyncTest("Partial failure returns partial status", async () => {
  const worker = createFailWorker();
  const plan = {
    spec: { id: "test-7" },
    tasks: [
      { id: "T1", summary: "Pass" },
      { id: "T2", summary: "Fail", shouldFail: true },
    ]
  };
  const result = await dispatcher.dispatch(plan, {}, { default: worker });
  assert.equal(result.status, "partial");
  assert.equal(result.results[0].success, true);
  assert.equal(result.results[1].success, false);
});

console.log("6. Circular dependency fallback...");
await asyncTest("Circular dependencies fall through to sequential", async () => {
  const worker = createMockWorker(5);
  const plan = {
    spec: { id: "test-8" },
    tasks: [
      { id: "T1", summary: "A", dependsOn: ["T2"] },
      { id: "T2", summary: "B", dependsOn: ["T1"] },
    ]
  };
  const result = await dispatcher.dispatch(plan, { dispatcher: { parallel: true } }, { default: worker });
  assert.equal(result.status, "completed");
  assert.equal(result.taskCount, 2);
});

console.log("7. Edge cases...");
await asyncTest("Empty task list returns completed", async () => {
  const plan = { spec: { id: "test-9" }, tasks: [] };
  const result = await dispatcher.dispatch(plan, {}, {});
  assert.equal(result.status, "completed");
  assert.equal(result.taskCount, 0);
});

await asyncTest("Result order matches task order", async () => {
  const worker = createMockWorker(5);
  const plan = {
    spec: { id: "test-10" },
    tasks: [
      { id: "T3", summary: "Third" },
      { id: "T1", summary: "First" },
      { id: "T2", summary: "Second" },
    ]
  };
  const result = await dispatcher.dispatch(plan, {}, { default: worker });
  assert.equal(result.results[0].taskId, "T3");
  assert.equal(result.results[1].taskId, "T1");
  assert.equal(result.results[2].taskId, "T2");
});

console.log("\n=== Results: " + passed + " passed, " + failed + " failed ===");
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
