#!/usr/bin/env node

// Tests for K8sWorker, EC2Worker, LogMonitor, GitHubInput.
// Uses mock commands since real kubectl/ssh/gh aren't available in test.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== CCC Manager Workers & Extended Components Test ===\n');

  const tmpDir = resolve(ROOT, 'state', '_test_workers');
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
  mkdirSync(tmpDir, { recursive: true });

  // 1. K8sWorker
  console.log('1. Testing K8sWorker...');
  const { K8sWorker } = await import('../../src/workers/k8s.js');
  assert(typeof K8sWorker === 'function', 'K8sWorker exported');

  // Test command building (don't execute — no real kubectl)
  const k8s = new K8sWorker({
    namespace: 'test-ns',
    pod: 'test-pod',
    container: 'main'
  });

  const args = k8s._buildArgs({ command: 'echo hello' });
  assert(args.includes('-n') && args.includes('test-ns'), `Args include namespace`);
  assert(args.includes('test-pod'), 'Args include pod');
  assert(args.includes('-c') && args.includes('main'), 'Args include container');
  assert(args[0] === 'exec', 'Args start with exec (kubectl is the binary)');

  // Test no-command task
  const k8sNoCmd = await k8s.execute({ id: 'k8s-1' });
  assert(k8sNoCmd.success === true, 'K8sWorker no-command task succeeds');

  // Test that execution failure is caught (kubectl not available)
  const k8sFail = await k8s.execute({ id: 'k8s-2', command: 'echo test' });
  assert(k8sFail.success === false, 'K8sWorker reports failure when kubectl unavailable');

  // 2. EC2Worker
  console.log('\n2. Testing EC2Worker...');
  const { EC2Worker } = await import('../../src/workers/ec2.js');
  assert(typeof EC2Worker === 'function', 'EC2Worker exported');

  // Test SSH args building (no shell interpretation)
  const ec2ssh = new EC2Worker({
    host: '10.0.0.1',
    user: 'deploy',
    method: 'ssh',
    keyFile: '/path/to/key.pem'
  });
  const sshArgs = ec2ssh._buildArgs({ command: 'echo hello && whoami' });
  assert(sshArgs.cmd === 'ssh', 'SSH uses ssh binary');
  assert(sshArgs.args.includes('-i') && sshArgs.args.includes('/path/to/key.pem'), 'SSH includes key file');
  assert(sshArgs.args.includes('deploy@10.0.0.1'), 'SSH includes user@host');
  // Command should be passed as a single arg (no shell expansion locally)
  assert(sshArgs.args[sshArgs.args.length - 1] === 'echo hello && whoami', 'SSH command is single arg (no local shell)');

  // Test SSM args building
  const ec2ssm = new EC2Worker({
    instanceId: 'i-1234567890',
    method: 'ssm'
  });
  const ssmArgs = ec2ssm._buildArgs({ command: 'systemctl restart app' });
  assert(ssmArgs.cmd === 'aws', 'SSM uses aws binary');
  assert(ssmArgs.args.includes('--instance-ids') && ssmArgs.args.includes('i-1234567890'), 'SSM includes instance ID');
  const paramsIdx = ssmArgs.args.indexOf('--parameters');
  const paramsJson = JSON.parse(ssmArgs.args[paramsIdx + 1]);
  assert(Array.isArray(paramsJson.commands) && paramsJson.commands[0] === 'systemctl restart app', 'SSM parameters format correct');

  // Test with mock local execution
  const ec2 = new EC2Worker({
    host: 'localhost',
    user: 'test',
    method: 'local',  // Use local execution for test
    keyFile: '/dev/null'
  });

  const ec2Result = await ec2.execute({ id: 'ec2-1', command: 'node -e "console.log(\'done\')"' });
  assert(ec2Result.success === true, 'EC2Worker local execute succeeds');

  const ec2Fail = await ec2.execute({ id: 'ec2-2', command: 'node -e "process.exit(2)"' });
  assert(ec2Fail.success === false, 'EC2Worker reports failure');

  // 3. LogMonitor
  console.log('\n3. Testing LogMonitor...');
  const { LogMonitor } = await import('../../src/monitors/log.js');
  assert(typeof LogMonitor === 'function', 'LogMonitor exported');

  // Create a test log file with errors
  const logFile = resolve(tmpDir, 'test.log');
  writeFileSync(logFile, [
    '2026-04-05 INFO Starting up',
    '2026-04-05 ERROR Connection refused to database',
    '2026-04-05 INFO Processing request',
    '2026-04-05 ERROR OOM killed worker pid=1234',
    '2026-04-05 WARN Slow query 500ms'
  ].join('\n'));

  const logMon = new LogMonitor('log-check', {
    path: logFile,
    patterns: ['ERROR (.+)']
  });

  const logIssues = await logMon.check();
  assert(logIssues.length === 2, `LogMonitor found 2 errors (got ${logIssues.length})`);
  assert(logIssues[0].summary.includes('Connection refused'), `First error: ${logIssues[0]?.summary}`);
  assert(logIssues[1].summary.includes('OOM'), `Second error: ${logIssues[1]?.summary}`);

  // Second check with no new content returns empty (tracks offset)
  const logIssues2 = await logMon.check();
  assert(logIssues2.length === 0, 'No new errors on re-check');

  // Append new error
  writeFileSync(logFile, '\n2026-04-05 ERROR Disk full', { flag: 'a' });
  const logIssues3 = await logMon.check();
  assert(logIssues3.length === 1, 'New error detected after append');

  // 4. GitHubInput
  console.log('\n4. Testing GitHubInput...');
  const { GitHubInput } = await import('../../src/inputs/github.js');
  assert(typeof GitHubInput === 'function', 'GitHubInput exported');

  // Test parsing (don't actually call gh CLI)
  const ghInput = new GitHubInput('gh-issues', {
    repo: 'grobomo/ccc-manager',
    label: 'self-repair'
  });
  assert(ghInput.config.repo === 'grobomo/ccc-manager', 'GitHubInput config set');
  assert(ghInput.config.label === 'self-repair', 'GitHubInput label set');

  // Test _parseIssues with mock data
  const mockIssues = [
    { number: 1, title: 'Pod crashlooping', body: 'Fix the pod', labels: [{ name: 'self-repair' }] },
    { number: 2, title: 'OOM error', body: 'Increase memory', labels: [{ name: 'self-repair' }] }
  ];
  const parsed = ghInput._parseIssues(mockIssues);
  assert(parsed.length === 2, `Parsed 2 issues (got ${parsed.length})`);
  assert(parsed[0].id === 'github-1', `Issue id: ${parsed[0]?.id}`);
  assert(parsed[0].summary === 'Pod crashlooping', `Issue summary: ${parsed[0]?.summary}`);

  // 5. Registration
  console.log('\n5. Testing registration...');
  const { Registry } = await import('../../src/registry.js');
  const { registerBuiltins } = await import('../../src/builtins.js');
  const reg = new Registry();
  registerBuiltins(reg);

  assert(reg.getMonitor('log') !== null, 'LogMonitor registered as "log"');
  assert(reg.getInput('github') !== null, 'GitHubInput registered as "github"');

  // Cleanup
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
}

main().catch(err => {
  console.error('Test error:', err);
  setTimeout(() => process.exit(1), 100);
});
