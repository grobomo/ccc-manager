// Test: SQS Input + SQS Dispatcher (mock AWS CLI)

import { SQSInput } from '../../src/inputs/sqs.js';
import { SQSDispatcher } from '../../src/dispatcher/sqs.js';

let passed = 0, failed = 0;

function assert(condition, msg) {
  if (condition) { passed++; console.log(`  PASS: ${msg}`); }
  else { failed++; console.error(`  FAIL: ${msg}`); }
}

// 1. SQSInput construction
console.log('1. SQSInput construction...');
{
  const input = new SQSInput('test', { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/test' });
  assert(input.queueUrl === 'https://sqs.us-east-1.amazonaws.com/123/test', 'Queue URL set');
  assert(input.waitTime === 20, 'Default wait time');
  assert(input.maxMessages === 10, 'Default max messages');
  assert(input.visibilityTimeout === 300, 'Default visibility timeout');
}

{
  const input = new SQSInput('custom', {
    queueUrl: 'https://sqs.us-west-2.amazonaws.com/456/custom',
    region: 'us-west-2',
    waitTime: 5,
    maxMessages: 1,
    visibilityTimeout: 60,
  });
  assert(input.region === 'us-west-2', 'Custom region');
  assert(input.waitTime === 5, 'Custom wait time');
  assert(input.maxMessages === 1, 'Custom max messages');
  assert(input.visibilityTimeout === 60, 'Custom visibility timeout');
}

{
  let threw = false;
  try { new SQSInput('bad', {}); } catch (e) { threw = true; }
  assert(threw, 'Throws without queueUrl');
}

// 2. SQSInput AWS args
console.log('\n2. SQSInput AWS CLI args...');
{
  const input = new SQSInput('test', { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q' });
  const args = input._awsArgs('receive-message', ['--max-number-of-messages', '10']);
  assert(args[0] === 'sqs', 'Starts with sqs');
  assert(args[1] === 'receive-message', 'Subcommand');
  assert(args.includes('--queue-url'), 'Has queue-url');
  assert(args.includes('--output'), 'Has output');
  assert(args.includes('--max-number-of-messages'), 'Extra args included');
}

{
  const input = new SQSInput('test', { queueUrl: 'https://sqs.eu-west-1.amazonaws.com/123/q', region: 'eu-west-1' });
  const args = input._awsArgs('send-message');
  assert(args.includes('--region'), 'Region arg present when configured');
  assert(args.includes('eu-west-1'), 'Region value correct');
}

// 3. SQSInput listen/stop
console.log('\n3. SQSInput listen/stop...');
{
  const input = new SQSInput('test', { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123/q' });
  assert(input._listening === false, 'Not listening initially');
  assert(input._pollTimer === null, 'No timer initially');

  // Mock poll to avoid real AWS calls
  let pollCalled = 0;
  input.poll = async () => { pollCalled++; return []; };

  await input.listen(() => {});
  assert(input._listening === true, 'Listening after listen()');

  // Wait for one poll cycle
  await new Promise(r => setTimeout(r, 50));
  assert(pollCalled >= 1, 'Poll called at least once');

  await input.stop();
  assert(input._listening === false, 'Not listening after stop()');
}

// 4. SQSDispatcher construction
console.log('\n4. SQSDispatcher construction...');
{
  const d = new SQSDispatcher({
    taskQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/tasks',
    resultQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/results',
  });
  assert(d.taskQueueUrl.includes('tasks'), 'Task queue URL');
  assert(d.resultQueueUrl.includes('results'), 'Result queue URL');
  assert(d.timeout === 300000, 'Default timeout 5min');
  assert(d.pollInterval === 2000, 'Default poll interval');
}

{
  let threw = false;
  try { new SQSDispatcher({ resultQueueUrl: 'x' }); } catch { threw = true; }
  assert(threw, 'Throws without taskQueueUrl');
}

{
  let threw = false;
  try { new SQSDispatcher({ taskQueueUrl: 'x' }); } catch { threw = true; }
  assert(threw, 'Throws without resultQueueUrl');
}

// 5. SQSDispatcher analyze
console.log('\n5. SQSDispatcher analyze...');
{
  const d = new SQSDispatcher({
    taskQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/tasks',
    resultQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/results',
  });
  const plan = await d.analyze({ summary: 'Pod crash', severity: 'high' });
  assert(plan.spec.id.startsWith('sqs-'), 'Spec ID starts with sqs-');
  assert(plan.tasks.length === 1, 'One task');
  assert(plan.tasks[0].type === 'investigate', 'Task type is investigate');
  assert(plan.issue.summary === 'Pod crash', 'Issue preserved');
}

// 6. SQSDispatcher dispatch with mock SQS
console.log('\n6. SQSDispatcher mock dispatch...');
{
  const d = new SQSDispatcher({
    taskQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/tasks',
    resultQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/results',
    timeout: 500, // Short timeout for test
    pollInterval: 50,
  });

  // Mock SQS calls
  const sentMessages = [];
  d._sendMessage = (url, body) => {
    sentMessages.push({ url, body });
    return { MessageId: 'mock-' + body.unitId };
  };

  // Simulate results arriving
  let pollCount = 0;
  d._receiveMessages = (url) => {
    pollCount++;
    if (pollCount === 1) {
      return [{
        Body: JSON.stringify({ unitId: 'sqs-test-T001', taskId: 'sqs-test-T001', success: true, output: 'fixed' }),
        ReceiptHandle: 'rh1',
      }];
    }
    return [];
  };
  d._deleteMessage = () => {};

  const plan = {
    spec: { id: 'sqs-test' },
    tasks: [{ id: 'sqs-test-T001', summary: 'Fix pod' }]
  };

  const result = await d.dispatch(plan, {});
  assert(sentMessages.length === 1, 'Sent 1 message to task queue');
  assert(sentMessages[0].body.unitId === 'sqs-test-T001', 'Correct unit ID sent');
  assert(result.status === 'completed', 'Status completed');
  assert(result.results.length === 1, '1 result');
  assert(result.results[0].success === true, 'Result success');
}

// 7. SQSDispatcher with sharding
console.log('\n7. SQSDispatcher sharding...');
{
  const d = new SQSDispatcher({
    taskQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/tasks',
    resultQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/results',
    timeout: 500,
    sharder: { strategy: 'cartesian', dimensions: { source: ['email', 'endpoint'] } },
  });

  const sentMessages = [];
  d._sendMessage = (url, body) => { sentMessages.push(body); return {}; };

  // Return results for all units
  let resultBatch = 0;
  d._receiveMessages = () => {
    resultBatch++;
    if (resultBatch === 1) {
      return sentMessages.map((m, i) => ({
        Body: JSON.stringify({ unitId: m.unitId, taskId: m.taskId, success: true, output: `done-${i}` }),
        ReceiptHandle: `rh-${i}`,
      }));
    }
    return [];
  };
  d._deleteMessage = () => {};

  const plan = {
    spec: { id: 'shard-test' },
    tasks: [{ id: 'shard-test-T001', summary: 'Analyze incident' }]
  };

  const result = await d.dispatch(plan, { workerCount: 2 });
  assert(sentMessages.length === 2, `Sent 2 units (got ${sentMessages.length})`);
  assert(sentMessages[0].dimensions.source === 'email', 'First unit: email');
  assert(sentMessages[1].dimensions.source === 'endpoint', 'Second unit: endpoint');
  assert(result.status === 'completed', 'All completed');
  assert(result.unitCount === 2, 'Unit count in result');
}

// 8. SQSDispatcher timeout handling
console.log('\n8. SQS timeout...');
{
  const d = new SQSDispatcher({
    taskQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/tasks',
    resultQueueUrl: 'https://sqs.us-east-1.amazonaws.com/123/results',
    timeout: 100, // Very short
  });

  d._sendMessage = () => ({});
  d._receiveMessages = () => []; // Never return results
  d._deleteMessage = () => {};

  const plan = {
    spec: { id: 'timeout-test' },
    tasks: [{ id: 'timeout-T001', summary: 'Slow task' }]
  };

  const result = await d.dispatch(plan, {});
  assert(result.status === 'failed', 'Status failed on timeout');
  assert(result.results[0].error.includes('Timeout'), 'Error mentions timeout');
}

// 9. Registration
console.log('\n9. Registration...');
{
  const { Registry } = await import('../../src/registry.js');
  const { registerBuiltins } = await import('../../src/builtins.js');
  const reg = new Registry();
  registerBuiltins(reg);
  assert(reg.getInput('sqs') === SQSInput, 'SQS input registered');
  assert(reg.getDispatcher('sqs') === SQSDispatcher, 'SQS dispatcher registered');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 50);
