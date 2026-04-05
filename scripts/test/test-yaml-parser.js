#!/usr/bin/env node

// Tests for YAML parser edge cases — quoted strings, colons in values,
// object lists, nested structures, type coercion.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const TMP = resolve(ROOT, '.test-tmp-yaml');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

function writeYaml(name, content) {
  const p = resolve(TMP, `${name}.yaml`);
  writeFileSync(p, content);
  return p;
}

async function main() {
  console.log('=== CCC Manager YAML Parser Test ===\n');

  // Setup
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });

  const { loadConfig } = await import('../../src/config.js');

  // 1. Quoted strings
  console.log('1. Quoted strings...');
  const p1 = writeYaml('quoted', `
name: "hello world"
label: 'single quoted'
port: "8080"
`);
  const c1 = loadConfig(p1);
  assert(c1.name === 'hello world', `Double quoted: "${c1.name}"`);
  assert(c1.label === 'single quoted', `Single quoted: "${c1.label}"`);
  assert(c1.port === '8080', `Quoted number stays string: "${c1.port}" (type=${typeof c1.port})`);

  // 2. Colons in values (URLs, time stamps)
  console.log('\n2. Colons in values...');
  const p2 = writeYaml('colons', `
name: test
url: http://example.com:8080/path
time: "12:30:00"
`);
  const c2 = loadConfig(p2);
  assert(c2.url === 'http://example.com:8080/path', `URL with port: ${c2.url}`);
  assert(c2.time === '12:30:00', `Quoted time: ${c2.time}`);

  // 3. Simple scalar lists
  console.log('\n3. Simple scalar lists...');
  const p3 = writeYaml('lists', `
name: test
tags:
  - alpha
  - beta
  - gamma
count: 5
`);
  const c3 = loadConfig(p3);
  assert(Array.isArray(c3.tags), 'tags is array');
  assert(c3.tags.length === 3, `3 items: ${c3.tags.length}`);
  assert(c3.tags[0] === 'alpha', `First item: ${c3.tags[0]}`);
  assert(c3.tags[2] === 'gamma', `Last item: ${c3.tags[2]}`);
  assert(c3.count === 5, `Scalar after list: ${c3.count}`);

  // 4. Object lists (list items with key:value pairs)
  console.log('\n4. Object lists...');
  const p4 = writeYaml('objlist', `
name: test
workers:
  - name: local
    type: local
    concurrency: 2
  - name: remote
    type: k8s
    namespace: prod
`);
  const c4 = loadConfig(p4);
  assert(Array.isArray(c4.workers), 'workers is array');
  assert(c4.workers.length === 2, `2 workers: ${c4.workers.length}`);
  assert(c4.workers[0].name === 'local', `First worker name: ${c4.workers[0].name}`);
  assert(c4.workers[0].type === 'local', `First worker type: ${c4.workers[0].type}`);
  assert(c4.workers[0].concurrency === 2, `First worker concurrency: ${c4.workers[0].concurrency}`);
  assert(c4.workers[1].namespace === 'prod', `Second worker namespace: ${c4.workers[1].namespace}`);

  // 5. Deeply nested objects
  console.log('\n5. Deeply nested objects...');
  const p5 = writeYaml('nested', `
name: deep
level1:
  level2:
    level3:
      value: found
    sibling: here
`);
  const c5 = loadConfig(p5);
  assert(c5.level1?.level2?.level3?.value === 'found', `3-deep nesting: ${c5.level1?.level2?.level3?.value}`);
  assert(c5.level1?.level2?.sibling === 'here', `Sibling at level2: ${c5.level1?.level2?.sibling}`);

  // 6. Boolean and null coercion
  console.log('\n6. Type coercion...');
  const p6 = writeYaml('types', `
name: types
enabled: true
disabled: false
empty: null
count: 42
ratio: 3.14
`);
  const c6 = loadConfig(p6);
  assert(c6.enabled === true, `true boolean`);
  assert(c6.disabled === false, `false boolean`);
  assert(c6.empty === null, `null value`);
  assert(c6.count === 42, `integer: ${c6.count}`);
  assert(c6.ratio === 3.14, `float: ${c6.ratio}`);

  // 7. Comments and blank lines
  console.log('\n7. Comments and blank lines...');
  const p7 = writeYaml('comments', `
# This is a comment
name: test

# Another comment
interval: 5000

# Trailing comment
`);
  const c7 = loadConfig(p7);
  assert(c7.name === 'test', `Name after comment: ${c7.name}`);
  assert(c7.interval === 5000, `Value after blank line: ${c7.interval}`);

  // 8. Empty nested objects
  console.log('\n8. Edge cases...');
  const p8 = writeYaml('edge', `
name: edge
monitors:
dispatcher:
  type: shtd
`);
  const c8 = loadConfig(p8);
  assert(typeof c8.monitors === 'object', `Empty section is object`);
  assert(c8.dispatcher?.type === 'shtd', `Section after empty: ${c8.dispatcher?.type}`);

  // 9. Existing configs still parse correctly
  console.log('\n9. Regression: existing configs...');
  const ce = loadConfig(resolve(ROOT, 'config', 'example.yaml'));
  assert(ce.name === 'example', `example.yaml name: ${ce.name}`);
  assert(ce.interval === 60000, `example.yaml interval: ${ce.interval}`);

  const cr = loadConfig(resolve(ROOT, 'config', 'rone-teams-poller.yaml'));
  assert(cr.name === 'rone-teams-poller', `rone config name: ${cr.name}`);
  assert(cr.monitors?.['pod-health']?.type === 'process', `rone monitor type: ${cr.monitors?.['pod-health']?.type}`);

  // Cleanup
  rmSync(TMP, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test error:', err);
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  process.exit(1);
});
