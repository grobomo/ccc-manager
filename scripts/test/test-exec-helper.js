#!/usr/bin/env node

// Tests for exec-helper.js — shared command execution for monitors.

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== exec-helper tests ===\n');

  const { execCommand } = await import('../../src/monitors/exec-helper.js');

  // 1. Basic functionality
  console.log('1. Basic functionality...');
  assert(typeof execCommand === 'function', 'execCommand is a function');

  // 2. Successful command
  console.log('2. Successful command...');
  const ok = execCommand('node -e "process.exit(0)"', 5000);
  assert(ok.success === true, 'success is true for exit 0');
  assert(typeof ok.cmdPreview === 'string', 'cmdPreview is a string');

  // 3. Failed command
  console.log('3. Failed command...');
  const fail = execCommand('node -e "process.exit(1)"', 5000);
  assert(fail.success === false, 'success is false for exit 1');
  assert(fail.exitCode === 1, 'exitCode is 1');
  assert(typeof fail.stderr === 'string', 'stderr is a string');
  assert(typeof fail.cmdPreview === 'string', 'cmdPreview present on failure');

  // 4. Command with stderr output
  console.log('4. Command with stderr...');
  const withErr = execCommand('node -e "process.stderr.write(\'oops\'); process.exit(2)"', 5000);
  assert(withErr.success === false, 'success is false');
  assert(withErr.exitCode === 2, 'exitCode is 2');
  assert(withErr.stderr.includes('oops'), 'stderr captured');

  // 5. Long command truncation
  console.log('5. Long command truncation...');
  const longCmd = 'echo ' + 'x'.repeat(200);
  const longResult = execCommand(longCmd, 5000);
  assert(longResult.cmdPreview.length <= 80, 'cmdPreview truncated to <= 80 chars');
  assert(longResult.cmdPreview.endsWith('...'), 'cmdPreview ends with ...');

  // 6. Short command not truncated
  console.log('6. Short command not truncated...');
  const shortCmd = 'echo hello';
  const shortResult = execCommand(shortCmd, 5000);
  assert(shortResult.cmdPreview === shortCmd, 'short command not truncated');

  // 7. Exactly 80 chars not truncated
  console.log('7. Boundary: exactly 80 chars...');
  const cmd80 = 'x'.repeat(80);
  const res80 = execCommand(cmd80, 5000);
  assert(res80.cmdPreview === cmd80, '80-char command not truncated');

  // 8. 81 chars IS truncated
  const cmd81 = 'x'.repeat(81);
  const res81 = execCommand(cmd81, 5000);
  assert(res81.cmdPreview.length === 80, '81-char command truncated to 80');
  assert(res81.cmdPreview.endsWith('...'), 'truncated with ...');

  // 9. Stderr truncation (over 500 chars)
  console.log('9. Stderr truncation...');
  const bigStderr = execCommand(`node -e "process.stderr.write('e'.repeat(1000)); process.exit(1)"`, 5000);
  assert(bigStderr.stderr.length <= 500, 'stderr truncated to <= 500 chars');

  // 10. Default timeout
  console.log('10. Default timeout parameter...');
  const defTimeout = execCommand('node -e "process.exit(0)"');
  assert(defTimeout.success === true, 'works with default timeout');

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
}

main().then(() => {
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 50);
});
