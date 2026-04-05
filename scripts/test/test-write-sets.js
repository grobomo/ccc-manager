#!/usr/bin/env node

// Tests for write set validation and fleet coordinator.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log('  PASS: ' + msg); }
  else { failed++; console.error('  FAIL: ' + msg); }
}

async function main() {
  console.log('=== Write Sets & Fleet Coordination Test ===');

  const { validateWriteSets, analyzeWriteSets, patternsOverlap, writeSetsOverlap }
    = await import('../../src/dispatcher/write-sets.js');

  console.log('\n1a. Pattern overlap...');
  assert(patternsOverlap('src/index.js', 'src/index.js'), 'Exact match overlaps');
  assert(!patternsOverlap('src/index.js', 'src/config.js'), 'Different files no overlap');
  assert(patternsOverlap('src/inputs/*.js', 'src/inputs/webhook.js'), 'Glob matches specific');
  assert(!patternsOverlap('src/inputs/*.js', 'src/monitors/log.js'), 'Glob no match other dir');
  assert(patternsOverlap('src/**/*.js', 'src/inputs/webhook.js'), 'Double glob matches nested');

  console.log('\n1b. Write set overlap...');
  assert(writeSetsOverlap(['src/index.js'], ['src/index.js']), 'Same file overlaps');
  assert(!writeSetsOverlap(['src/index.js'], ['src/config.js']), 'Different files no overlap');
  assert(!writeSetsOverlap([], ['src/index.js']), 'Empty set no overlap');
  assert(!writeSetsOverlap(null, ['src/index.js']), 'Null set no overlap');

  console.log('\n1c. Validate - no overlap...');
  const plan1 = { spec: { id: 'p1' }, tasks: [
    { id: 'T1', writeSet: ['src/index.js'] },
    { id: 'T2', writeSet: ['src/config.js'] },
    { id: 'T3', writeSet: ['src/fleet.js'] },
  ]};
  const r1 = validateWriteSets(plan1);
  assert(r1.tasks[0].dependsOn.length === 0, 'T1 no deps');
  assert(r1.tasks[1].dependsOn.length === 0, 'T2 no deps');
  assert(r1.tasks[2].dependsOn.length === 0, 'T3 no deps');

  console.log('\n1d. Validate - with overlap...');
  const plan2 = { spec: { id: 'p2' }, tasks: [
    { id: 'T1', writeSet: ['src/index.js'] },
    { id: 'T2', writeSet: ['src/index.js', 'src/config.js'] },
    { id: 'T3', writeSet: ['src/fleet.js'] },
  ]};
  const r2 = validateWriteSets(plan2);
  assert(r2.tasks[1].dependsOn.includes('T1'), 'T2 depends on T1 (shared index.js)');
  assert(r2.tasks[2].dependsOn.length === 0, 'T3 no deps');

  console.log('\n1e. Chain overlap...');
  const plan3 = { spec: { id: 'p3' }, tasks: [
    { id: 'T1', writeSet: ['package.json'] },
    { id: 'T2', writeSet: ['package.json', 'CHANGELOG.md'] },
    { id: 'T3', writeSet: ['CHANGELOG.md'] },
  ]};
  const r3 = validateWriteSets(plan3);
  assert(r3.tasks[1].dependsOn.includes('T1'), 'T2 depends on T1');
  assert(r3.tasks[2].dependsOn.includes('T2'), 'T3 depends on T2');

  console.log('\n1f. Analyze...');
  const a = analyzeWriteSets(plan2);
  assert(a.overlaps.length === 1, '1 overlap');
  assert(a.maxParallel === 2, 'Max parallel = 2');

  console.log('\n1g. Edge cases...');
  assert(validateWriteSets(null) === null, 'Null plan passes through');
  assert(validateWriteSets({ spec: {}, tasks: [] }).tasks.length === 0, 'Empty tasks ok');

  console.log('\n1h. Backward compat...');
  const plan4 = { spec: { id: 'p4' }, tasks: [{ id: 'T1' }, { id: 'T2' }] };
  const r4 = validateWriteSets(plan4);
  assert(r4.tasks[0].dependsOn.length === 0, 'No writeSets = no deps');

  // --- Fleet ---
  console.log('\n2. Fleet Coordinator...');
  const { FleetCoordinator } = await import('../../src/fleet.js');

  const tmpDir = resolve(ROOT, 'state', '_test_fleet');
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  console.log('\n2a. Heartbeat + discovery...');
  const fA = new FleetCoordinator({ stateDir: tmpDir, workerId: 'alpha', staleThreshold: 500 });
  const fB = new FleetCoordinator({ stateDir: tmpDir, workerId: 'beta', staleThreshold: 500 });

  fA.heartbeat({ currentTasks: ['T171', 'T175'] });
  fB.heartbeat({ currentTasks: ['T172'] });

  assert(fA.peers().length === 1, 'A sees 1 peer');
  assert(fA.peers()[0].workerId === 'beta', 'Peer is beta');
  assert(fB.peers().length === 1, 'B sees 1 peer');

  console.log('\n2b. Task ownership...');
  assert(fA.isTaskOwnedByPeer('T172') === 'beta', 'A sees T172 owned by beta');
  assert(fA.isTaskOwnedByPeer('T171') === null, 'Own task not peer-owned');
  assert(fA.isTaskOwnedByPeer('T999') === null, 'Unknown task = null');

  console.log('\n2c. Include self...');
  assert(fA.peers({ includeSelf: true }).length === 2, 'See self + peer');

  console.log('\n2d. Status...');
  const s = fA.status();
  assert(s.totalPeers === 2, 'Total = 2');
  assert(s.active === 2, 'Active = 2');

  console.log('\n2e. Stale detection...');
  const bp = resolve(tmpDir, 'fleet', 'beta.json');
  const bd = JSON.parse(readFileSync(bp, 'utf-8'));
  bd.lastHeartbeat = Date.now() - 1000;
  writeFileSync(bp, JSON.stringify(bd));
  assert(fA.staleWorkers().length === 1, '1 stale worker');

  console.log('\n2f. Prune stale...');
  assert(fA.pruneStale() === 1, 'Pruned 1');

  console.log('\n2g. Deregister...');
  fA.deregister();
  assert(fA.status().totalPeers === 0, 'Empty after deregister');

  console.log('\n2h. Error handling...');
  let threw = false;
  try { new FleetCoordinator({ stateDir: tmpDir }); } catch { threw = true; }
  assert(threw, 'Throws without workerId');

  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

  console.log('\n=== Results: ' + passed + ' passed, ' + failed + ' failed ===');
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
}

main().catch(err => {
  console.error('Test error:', err);
  setTimeout(() => process.exit(1), 100);
});
