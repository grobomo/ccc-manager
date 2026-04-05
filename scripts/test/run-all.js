#!/usr/bin/env node

// Unified test runner — executes all test suites and reports totals.

import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDir = resolve(__dirname);

const suites = readdirSync(testDir)
  .filter(f => f.startsWith('test-') && f.endsWith('.js'))
  .sort();

let totalPassed = 0;
let totalFailed = 0;
let suitesRun = 0;
let suitesFailed = 0;

for (const suite of suites) {
  const suitePath = resolve(testDir, suite);
  try {
    const output = execSync(`node "${suitePath}"`, { stdio: 'pipe', timeout: 30000 }).toString();
    process.stdout.write(output);

    const match = output.match(/(\d+) passed, (\d+) failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
    suitesRun++;
  } catch (err) {
    const output = err.stdout?.toString() || '';
    process.stdout.write(output);
    process.stderr.write(err.stderr?.toString() || '');

    const match = output.match(/(\d+) passed, (\d+) failed/);
    if (match) {
      totalPassed += parseInt(match[1]);
      totalFailed += parseInt(match[2]);
    }
    suitesRun++;
    suitesFailed++;
  }
  console.log('');
}

console.log('='.repeat(50));
console.log(`TOTAL: ${suitesRun} suites, ${totalPassed} passed, ${totalFailed} failed`);
if (suitesFailed > 0) console.log(`  ${suitesFailed} suite(s) had failures`);
console.log('='.repeat(50));

process.exit(totalFailed > 0 ? 1 : 0);
