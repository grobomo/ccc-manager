#!/usr/bin/env node

// Demo: runs ccc-manager with a synthetic config that demonstrates the full
// monitor → dispatch → verify cycle in real time. No external dependencies.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEMO_DIR = resolve(ROOT, '.demo-tmp');
const BRIDGE_DIR = resolve(DEMO_DIR, 'bridge');
const STATE_DIR = resolve(ROOT, 'state');

// Clean previous runs
if (existsSync(DEMO_DIR)) rmSync(DEMO_DIR, { recursive: true });
if (existsSync(STATE_DIR)) rmSync(STATE_DIR, { recursive: true });
mkdirSync(BRIDGE_DIR, { recursive: true });

// Write demo config
const HEALTH_PORT = 18900;
const configPath = resolve(DEMO_DIR, 'demo.yaml');
writeFileSync(configPath, `
name: demo
interval: 5000
healthPort: ${HEALTH_PORT}

monitors:
  health-check:
    type: process
    command: node -e "Math.random() > 0.5 ? process.exit(1) : process.exit(0)"

inputs:
  tasks:
    type: bridge
    path: ${BRIDGE_DIR.replace(/\\/g, '/')}

dispatcher:
  type: shtd

verifiers:
  check:
    type: test-suite
    command: node -e "process.exit(0)"
`);

console.log('╔══════════════════════════════════════════════╗');
console.log('║      CCC Manager — Live Demo                ║');
console.log('╠══════════════════════════════════════════════╣');
console.log('║  Monitor: random health check (50% fail)    ║');
console.log('║  Input:   bridge directory (injecting tasks) ║');
console.log('║  Dispatch: SHTD pipeline                    ║');
console.log('║  Verify:  test-suite (always pass)          ║');
console.log(`║  Health:  http://localhost:${HEALTH_PORT}/healthz     ║`);
console.log('╚══════════════════════════════════════════════╝');
console.log('');

const { Manager } = await import('../src/index.js');
const manager = new Manager(configPath);

// Inject a bridge task after 2 seconds
setTimeout(() => {
  console.log('\n>> Injecting bridge task: SELF_REPAIR request...\n');
  writeFileSync(resolve(BRIDGE_DIR, 'demo-task-1.json'), JSON.stringify({
    id: 'demo-repair-1',
    type: 'SELF_REPAIR',
    summary: 'Fix hex IDs showing in chat output',
    text: 'The hex IDs are still there after the last deploy',
    classification: 'SELF_REPAIR'
  }, null, 2));
}, 2000);

// Inject another task after 8 seconds
setTimeout(() => {
  console.log('\n>> Injecting bridge task: REPLY request...\n');
  writeFileSync(resolve(BRIDGE_DIR, 'demo-task-2.json'), JSON.stringify({
    id: 'demo-reply-1',
    type: 'REPLY',
    summary: 'User asked: what is the pod status?',
    text: 'Hey coconut, what is the pod status?',
    classification: 'REPLY'
  }, null, 2));
}, 8000);

// Show metrics after 15 seconds
setTimeout(async () => {
  try {
    const res = await fetch(`http://127.0.0.1:${HEALTH_PORT}/metrics`);
    const metrics = await res.json();
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║              Metrics Snapshot                ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Cycles:  ${String(metrics.cycles).padEnd(34)}║`);
    console.log(`║  Issues:  ${String(metrics.issues).padEnd(34)}║`);
    console.log(`║  Fixes:   ${String(metrics.fixes).padEnd(34)}║`);
    console.log(`║  Failures:${String(metrics.failures).padEnd(34)}║`);
    console.log('╚══════════════════════════════════════════════╝');
  } catch { /* health server may not be ready */ }
}, 15000);

// Stop after 20 seconds
setTimeout(async () => {
  console.log('\n>> Stopping demo (graceful shutdown)...\n');
  await manager.stop();

  // Final state
  console.log('\n╔══════════════════════════════════════════════╗');
  console.log('║              Final State                     ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  Queue:   ${String(manager.state.queue.length).padEnd(34)}║`);
  console.log(`║  History: ${String(manager.state.history.length).padEnd(34)}║`);
  console.log(`║  Cycles:  ${String(manager.state.metrics.cycles).padEnd(34)}║`);
  console.log(`║  Fixes:   ${String(manager.state.metrics.fixes).padEnd(34)}║`);
  console.log('╚══════════════════════════════════════════════╝');

  // Cleanup
  rmSync(DEMO_DIR, { recursive: true });
  if (existsSync(STATE_DIR)) rmSync(STATE_DIR, { recursive: true });
  process.exit(0);
}, 20000);

// Handle Ctrl+C
process.on('SIGINT', async () => {
  await manager.stop();
  if (existsSync(DEMO_DIR)) rmSync(DEMO_DIR, { recursive: true });
  if (existsSync(STATE_DIR)) rmSync(STATE_DIR, { recursive: true });
  process.exit(0);
});

await manager.start();
