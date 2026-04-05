#!/usr/bin/env node

// E2E test: webhook notifier sends task results to HTTP endpoint.

import { createServer } from 'node:http';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

async function main() {
  console.log('=== CCC Manager Notifier Test ===\n');

  // 1. Test WebhookNotifier
  console.log('1. Testing WebhookNotifier...');
  const { WebhookNotifier } = await import('../../src/notifiers/webhook.js');
  assert(typeof WebhookNotifier === 'function', 'WebhookNotifier exported');

  // Spin up a mock server to receive notifications
  const received = [];
  const mockPort = 19500 + Math.floor(Math.random() * 1000);
  const mockServer = createServer((req, res) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise(r => mockServer.listen(mockPort, r));

  // 2. Test JSON format (default)
  console.log('\n2. Testing JSON format...');
  const jsonNotifier = new WebhookNotifier('json-hook', {
    url: `http://127.0.0.1:${mockPort}/notify`,
    format: 'json'
  });

  const task = { id: 'task-1', summary: 'Pod crashloop', source: 'monitor:pod-health' };
  const result1 = await jsonNotifier.notify(task, { passed: true, details: 'Restarted' });
  assert(result1.sent === true, 'JSON notify sent successfully');
  assert(received.length === 1, `Received ${received.length} notification(s)`);
  assert(received[0].task === 'task-1', `Task ID: ${received[0].task}`);
  assert(received[0].status === 'FIXED', `Status: ${received[0].status}`);
  assert(received[0].passed === true, 'passed: true');

  // 3. Test Teams format
  console.log('\n3. Testing Teams format...');
  const teamsNotifier = new WebhookNotifier('teams-hook', {
    url: `http://127.0.0.1:${mockPort}/teams`,
    format: 'teams'
  });

  await teamsNotifier.notify(task, { passed: false, details: 'OOM killed' });
  assert(received.length === 2, `Received ${received.length} notification(s)`);
  assert(received[1]['@type'] === 'MessageCard', 'Teams MessageCard format');
  assert(received[1].themeColor === 'cc0000', 'Red theme for failure');
  assert(received[1].sections[0].facts[0].value === 'task-1', 'Teams fact: task ID');

  // 4. Test Slack format
  console.log('\n4. Testing Slack format...');
  const slackNotifier = new WebhookNotifier('slack-hook', {
    url: `http://127.0.0.1:${mockPort}/slack`,
    format: 'slack'
  });

  await slackNotifier.notify(task, { passed: true, details: 'All good' });
  assert(received.length === 3, `Received ${received.length} notification(s)`);
  assert(received[2].blocks !== undefined, 'Slack blocks format');
  assert(received[2].text.includes('FIXED'), 'Slack text includes FIXED');

  // 5. Test error handling (bad URL)
  console.log('\n5. Testing error handling...');
  const badNotifier = new WebhookNotifier('bad-hook', {
    url: 'http://127.0.0.1:1/nope',
    format: 'json'
  });
  const badResult = await badNotifier.notify(task, { passed: true });
  assert(badResult.sent === false, 'Bad URL returns sent: false');
  assert(badResult.error !== undefined, `Error message: ${badResult.error?.substring(0, 40)}`);

  // 6. Test registration
  console.log('\n6. Testing registration...');
  const { Registry } = await import('../../src/registry.js');
  const { registerBuiltins } = await import('../../src/builtins.js');
  const reg = new Registry();
  registerBuiltins(reg);
  assert(reg.getNotifier('webhook') === WebhookNotifier, 'WebhookNotifier registered as "webhook"');

  await new Promise(r => mockServer.close(r));

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  // Delay exit to let fetch socket handles drain (avoids libuv assertion on Windows)
  setTimeout(() => process.exit(failed > 0 ? 1 : 0), 100);
}

main().catch(err => {
  console.error('Test error:', err);
  setTimeout(() => process.exit(1), 100);
});
