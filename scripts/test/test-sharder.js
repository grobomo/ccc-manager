// Test: Sharder — task sharding, parallel dispatch, result aggregation

import { Sharder, parallelDispatch, aggregateResults } from '../../src/dispatcher/sharder.js';

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Mock worker
class MockWorker {
  constructor(shouldFail = false) { this.shouldFail = shouldFail; this.executed = []; }
  async execute(task) {
    this.executed.push(task);
    if (this.shouldFail) return { success: false, error: 'mock failure', taskId: task.id };
    return { success: true, output: `done:${task.id}`, taskId: task.id };
  }
}

async function main() {
  console.log('=== Sharder Test ===\n');

  // 1. No dimensions — single unit
  console.log('1. No dimensions...');
  {
    const s = new Sharder();
    const units = s.shard({ id: 'T001', summary: 'test' });
    assert(units.length === 1, 'Single unit produced');
    assert(units[0].unitId === 'T001-U001', 'Unit ID format');
    assert(units[0].taskId === 'T001', 'Task ID preserved');
    assert(units[0].workerIndex === 0, 'Worker index 0');
  }

  // 2. Array dimensions — cartesian
  console.log('\n2. Cartesian product...');
  {
    const s = new Sharder({
      strategy: 'cartesian',
      dimensions: {
        source: ['email', 'endpoint', 'network'],
        analysis: ['threat', 'compliance']
      }
    });
    const units = s.shard({ id: 'T002', summary: 'analyze' });
    assert(units.length === 6, `3×2 = 6 units (got ${units.length})`);
    assert(units[0].dimensions.source === 'email', 'First unit source=email');
    assert(units[0].dimensions.analysis === 'threat', 'First unit analysis=threat');
    assert(units[5].dimensions.source === 'network', 'Last unit source=network');
    assert(units[5].dimensions.analysis === 'compliance', 'Last unit analysis=compliance');
  }

  // 3. Range dimensions
  console.log('\n3. Range dimensions...');
  {
    const s = new Sharder({
      dimensions: {
        timeRange: { start: 0, end: 100, step: 25 }
      }
    });
    const units = s.shard({ id: 'T003', summary: 'scan' });
    assert(units.length === 4, `4 time ranges (got ${units.length})`);
    assert(deepEqual(units[0].dimensions.timeRange, { start: 0, end: 25 }), 'First range 0-25');
    assert(deepEqual(units[3].dimensions.timeRange, { start: 75, end: 100 }), 'Last range 75-100');
  }

  // 4. Worker index round-robin
  console.log('\n4. Worker assignment...');
  {
    const s = new Sharder({ dimensions: { item: ['a', 'b', 'c', 'd', 'e'] } });
    const units = s.shard({ id: 'T004', summary: 'process' }, 3);
    assert(units[0].workerIndex === 0, 'Unit 1 → worker 0');
    assert(units[1].workerIndex === 1, 'Unit 2 → worker 1');
    assert(units[2].workerIndex === 2, 'Unit 3 → worker 2');
    assert(units[3].workerIndex === 0, 'Unit 4 → worker 0 (wrap)');
    assert(units[4].workerIndex === 1, 'Unit 5 → worker 1 (wrap)');
  }

  // 5. Chunk strategy
  console.log('\n5. Chunk strategy...');
  {
    const s = new Sharder({
      strategy: 'chunk',
      dimensions: { item: ['a', 'b', 'c', 'd', 'e', 'f'] }
    });
    const units = s.shard({ id: 'T005', summary: 'chunk' }, 3);
    assert(units.length === 3, `3 chunks (got ${units.length})`);
    assert(deepEqual(units[0].dimensions.item, ['a', 'b']), 'Chunk 1: [a,b]');
    assert(deepEqual(units[1].dimensions.item, ['c', 'd']), 'Chunk 2: [c,d]');
    assert(deepEqual(units[2].dimensions.item, ['e', 'f']), 'Chunk 3: [e,f]');
  }

  // 6. Max units safety cap
  console.log('\n6. Safety cap...');
  {
    const s = new Sharder({
      maxUnits: 5,
      dimensions: { a: [1, 2, 3], b: [4, 5, 6] }
    });
    const units = s.shard({ id: 'T006', summary: 'cap' });
    assert(units.length === 5, `Capped to 5 (got ${units.length})`);
  }

  // 7. Task-level dimension override
  console.log('\n7. Task dimension override...');
  {
    const s = new Sharder({ dimensions: { a: [1, 2] } });
    const units = s.shard({ id: 'T007', summary: 'override', dimensions: { x: ['p', 'q', 'r'] } });
    assert(units.length === 3, 'Uses task dimensions, not constructor');
    assert(units[0].dimensions.x === 'p', 'First dim from task');
  }

  // 8. Parallel dispatch
  console.log('\n8. Parallel dispatch...');
  {
    const worker = new MockWorker();
    const units = [
      { unitId: 'U001', taskId: 'T', summary: 'test', workerIndex: 0, dimensions: {} },
      { unitId: 'U002', taskId: 'T', summary: 'test', workerIndex: 0, dimensions: {} },
    ];
    const results = await parallelDispatch(units, { w1: worker });
    assert(results.length === 2, '2 results');
    assert(results[0].success === true, 'First success');
    assert(results[1].success === true, 'Second success');
    assert(worker.executed.length === 2, 'Worker executed 2 tasks');
  }

  // 9. Parallel dispatch with concurrency limit
  console.log('\n9. Concurrency limit...');
  {
    const worker = new MockWorker();
    const units = Array.from({ length: 6 }, (_, i) => ({
      unitId: `U${i}`, taskId: 'T', summary: 'test', workerIndex: 0, dimensions: {}
    }));
    const results = await parallelDispatch(units, { w1: worker }, { concurrency: 2 });
    assert(results.length === 6, '6 results');
    assert(worker.executed.length === 6, 'All 6 executed');
  }

  // 10. Parallel dispatch — no workers
  console.log('\n10. No workers...');
  {
    const units = [{ unitId: 'U001', taskId: 'T', summary: 'test', workerIndex: 0, dimensions: {} }];
    const results = await parallelDispatch(units, {});
    assert(results.length === 1, '1 result');
    assert(results[0].skipped === true, 'Skipped');
  }

  // 11. Parallel dispatch — multiple workers
  console.log('\n11. Multiple workers...');
  {
    const w1 = new MockWorker();
    const w2 = new MockWorker();
    const units = [
      { unitId: 'U001', taskId: 'T', summary: 'a', workerIndex: 0, dimensions: {} },
      { unitId: 'U002', taskId: 'T', summary: 'b', workerIndex: 1, dimensions: {} },
      { unitId: 'U003', taskId: 'T', summary: 'c', workerIndex: 0, dimensions: {} },
    ];
    const results = await parallelDispatch(units, { w1, w2 });
    assert(w1.executed.length === 2, 'Worker 1 got 2 tasks');
    assert(w2.executed.length === 1, 'Worker 2 got 1 task');
  }

  // 12. Parallel dispatch with buildCommand
  console.log('\n12. buildCommand...');
  {
    const worker = new MockWorker();
    const units = [
      { unitId: 'U001', taskId: 'T', summary: 'scan', workerIndex: 0, dimensions: { source: 'email' } },
    ];
    const results = await parallelDispatch(units, { w1: worker }, {
      buildCommand: unit => `analyze --source ${unit.dimensions.source}`
    });
    assert(worker.executed[0].command === 'analyze --source email', 'Command built from dimensions');
  }

  // 13. Aggregate results — all success
  console.log('\n13. Aggregate — all success...');
  {
    const results = [
      { unitId: 'U001', success: true, output: 'ok' },
      { unitId: 'U002', success: true, output: 'ok' },
    ];
    const agg = aggregateResults(results);
    assert(agg.total === 2, 'Total 2');
    assert(agg.succeeded === 2, 'Succeeded 2');
    assert(agg.failed === 0, 'Failed 0');
    assert(agg.status === 'completed', 'Status completed');
  }

  // 14. Aggregate results — partial failure
  console.log('\n14. Aggregate — partial...');
  {
    const results = [
      { unitId: 'U001', success: true, output: 'ok' },
      { unitId: 'U002', success: false, error: 'fail' },
    ];
    const agg = aggregateResults(results);
    assert(agg.status === 'partial', 'Status partial');
    assert(agg.succeeded === 1, 'Succeeded 1');
    assert(agg.failed === 1, 'Failed 1');
  }

  // 15. Aggregate results — all failed
  console.log('\n15. Aggregate — all failed...');
  {
    const results = [
      { unitId: 'U001', success: false, error: 'fail' },
    ];
    const agg = aggregateResults(results);
    assert(agg.status === 'failed', 'Status failed');
  }

  // 16. Aggregate with custom merge
  console.log('\n16. Custom merge...');
  {
    const results = [
      { unitId: 'U001', success: true, output: '3' },
      { unitId: 'U002', success: true, output: '5' },
    ];
    const agg = aggregateResults(results, {
      merge: (succeeded) => succeeded.reduce((sum, r) => sum + parseInt(r.output), 0)
    });
    assert(agg.merged === 8, 'Merged sum = 8');
  }

  // 17. EP incident response use case
  console.log('\n17. EP incident response sharding...');
  {
    const s = new Sharder({ strategy: 'cartesian' });
    const units = s.shard({
      id: 'incident-2026-001',
      summary: 'Analyze security incident',
      dimensions: {
        timeRange: { start: 0, end: 24, step: 8 },
        dataSource: ['email', 'endpoint', 'network'],
        analysisType: ['ioc-extraction', 'lateral-movement', 'data-exfil']
      }
    }, 4);
    // 3 time ranges × 3 sources × 3 analysis types = 27 units
    assert(units.length === 27, `27 work units (got ${units.length})`);
    assert(units[0].unitId === 'incident-2026-001-U001', 'Unit ID format');
    assert(units[26].workerIndex === 2, 'Last unit worker index wraps (26 % 4 = 2)');
  }

  // 18. Range with non-even step
  console.log('\n18. Non-even range step...');
  {
    const s = new Sharder({ dimensions: { t: { start: 0, end: 10, step: 3 } } });
    const units = s.shard({ id: 'T018', summary: 'test' });
    assert(units.length === 4, `4 ranges: 0-3, 3-6, 6-9, 9-10 (got ${units.length})`);
    assert(deepEqual(units[3].dimensions.t, { start: 9, end: 10 }), 'Last range capped at end');
  }

  // 19. Parallel dispatch — worker failure
  console.log('\n19. Worker failure...');
  {
    const worker = new MockWorker(true);
    const units = [{ unitId: 'U001', taskId: 'T', summary: 'fail', workerIndex: 0, dimensions: {} }];
    const results = await parallelDispatch(units, { w1: worker });
    assert(results[0].success === false, 'Failure propagated');
    assert(results[0].error === 'mock failure', 'Error message preserved');
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 50);
}

main();
