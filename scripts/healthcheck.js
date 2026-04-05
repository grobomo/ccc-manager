#!/usr/bin/env node

// Healthcheck script — probe a running CCC Manager instance.
// Usage: node scripts/healthcheck.js [host:port]
// Default: localhost:8080
// Exit 0 = healthy, 1 = unhealthy, 2 = unreachable

import { request } from 'node:http';

const target = process.argv[2] || 'localhost:8080';
const [host, port] = target.includes(':') ? [target.split(':')[0], parseInt(target.split(':')[1])] : [target, 8080];

const endpoints = ['/healthz', '/readyz', '/metrics'];
const results = {};
let failures = 0;

function probe(path) {
  return new Promise((resolve) => {
    const req = request({ host, port, path, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve({ status: res.statusCode, data });
        } catch {
          // Prometheus text format (metrics)
          resolve({ status: res.statusCode, data: body.trim() });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 0, error: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.end();
  });
}

async function run() {
  console.log(`Probing CCC Manager at ${host}:${port}\n`);

  for (const ep of endpoints) {
    const result = await probe(ep);
    results[ep] = result;

    if (result.error || result.status === 0) {
      console.log(`  ${ep}  UNREACHABLE  ${result.error || 'no response'}`);
      failures++;
    } else if (result.status >= 200 && result.status < 300) {
      if (ep === '/metrics' && typeof result.data === 'string') {
        // Parse Prometheus metrics for summary
        const lines = result.data.split('\n').filter(l => l && !l.startsWith('#'));
        const metrics = {};
        for (const line of lines) {
          const [name, value] = line.split(' ');
          if (name && value) metrics[name] = parseFloat(value);
        }
        console.log(`  ${ep}    OK         cycles=${metrics.ccc_cycles_total ?? '?'} issues=${metrics.ccc_issues_total ?? '?'} fixes=${metrics.ccc_fixes_total ?? '?'} queue=${metrics.ccc_queue_length ?? '?'} uptime=${metrics.ccc_uptime_seconds ?? '?'}s`);
      } else {
        const summary = typeof result.data === 'object' ? JSON.stringify(result.data) : result.data;
        console.log(`  ${ep}  OK         ${summary}`);
      }
    } else {
      console.log(`  ${ep}  UNHEALTHY  HTTP ${result.status} — ${JSON.stringify(result.data)}`);
      failures++;
    }
  }

  console.log('');
  if (failures === endpoints.length) {
    console.log('RESULT: UNREACHABLE — manager is not running or not reachable');
    process.exit(2);
  } else if (failures > 0) {
    console.log(`RESULT: DEGRADED — ${failures}/${endpoints.length} endpoints failed`);
    process.exit(1);
  } else {
    console.log('RESULT: HEALTHY — all endpoints responding');
    process.exit(0);
  }
}

run();
