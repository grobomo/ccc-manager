// SQSDispatcher — distribute work units via AWS SQS queues.
//
// Uses two queues:
//   taskQueue  — dispatcher sends work units here; workers consume
//   resultQueue — workers send results here; dispatcher consumes
//
// Flow:
//   1. analyze() produces a plan (same as SHTD/Claude)
//   2. dispatch() shards plan.tasks via Sharder, sends each unit to taskQueue
//   3. Waits for results on resultQueue (with timeout)
//   4. Returns aggregated results
//
// Config:
//   taskQueueUrl:   SQS URL for outgoing tasks (required)
//   resultQueueUrl: SQS URL for incoming results (required)
//   region:         AWS region (optional)
//   timeout:        Max wait for all results in ms (default: 300000 = 5min)
//   pollInterval:   Result poll interval in ms (default: 2000)

import { execFileSync } from 'node:child_process';
import { Dispatcher } from '../base.js';
import { Sharder, aggregateResults } from './sharder.js';
import { createLogger } from '../logger.js';

export class SQSDispatcher extends Dispatcher {
  constructor(config) {
    super(config);
    this.taskQueueUrl = config.taskQueueUrl;
    this.resultQueueUrl = config.resultQueueUrl;
    this.region = config.region || undefined;
    this.timeout = config.timeout || 300000;
    this.pollInterval = config.pollInterval || 2000;
    this.sharder = config.sharder ? new Sharder(config.sharder) : null;
    this.log = createLogger('sqs-dispatcher');

    if (!this.taskQueueUrl) throw new Error('SQSDispatcher requires config.taskQueueUrl');
    if (!this.resultQueueUrl) throw new Error('SQSDispatcher requires config.resultQueueUrl');
  }

  _awsExec(subcommand, queueUrl, extra = []) {
    const args = ['sqs', subcommand, '--queue-url', queueUrl, '--output', 'json'];
    if (this.region) args.push('--region', this.region);
    const raw = execFileSync('aws', args.concat(extra), { stdio: 'pipe', timeout: 30000 }).toString();
    return raw.trim() ? JSON.parse(raw) : null;
  }

  _sendMessage(queueUrl, body) {
    return this._awsExec('send-message', queueUrl, ['--message-body', JSON.stringify(body)]);
  }

  _receiveMessages(queueUrl, maxMessages = 10, waitTime = 5) {
    const result = this._awsExec('receive-message', queueUrl, [
      '--max-number-of-messages', String(maxMessages),
      '--wait-time-seconds', String(waitTime),
    ]);
    return result?.Messages || [];
  }

  _deleteMessage(queueUrl, receiptHandle) {
    this._awsExec('delete-message', queueUrl, ['--receipt-handle', receiptHandle]);
  }

  async analyze(issue) {
    // Same as SHTD — produce a basic plan
    const specId = `sqs-${Date.now()}`;
    const tasks = [{
      id: `${specId}-T001`,
      type: 'investigate',
      summary: `Investigate: ${issue.summary}`,
      command: null,
      issue
    }];

    return {
      spec: { id: specId, title: `Fix: ${issue.summary}`, severity: issue.severity, createdAt: Date.now() },
      tasks,
      branch: `fix/${specId}`,
      issue
    };
  }

  // Override dispatch to use SQS queues instead of direct worker execution
  async dispatch(plan, config, workers = {}) {
    let units;

    // Shard tasks if sharder is configured
    if (this.sharder && plan.tasks.length > 0) {
      units = [];
      for (const task of plan.tasks) {
        units.push(...this.sharder.shard(task, config.workerCount || 1));
      }
    } else {
      // No sharding — send tasks as-is
      units = plan.tasks.map((t, i) => ({
        unitId: t.id,
        taskId: t.id,
        summary: t.summary,
        command: t.command,
        dimensions: {},
        workerIndex: 0,
      }));
    }

    // Send all units to the task queue
    const sentIds = new Set();
    for (const unit of units) {
      const message = {
        unitId: unit.unitId,
        taskId: unit.taskId,
        planId: plan.spec.id,
        summary: unit.summary,
        command: unit.command,
        dimensions: unit.dimensions,
      };
      try {
        this._sendMessage(this.taskQueueUrl, message);
        sentIds.add(unit.unitId);
        this.log.info('Sent to SQS', { unitId: unit.unitId });
      } catch (err) {
        this.log.error('SQS send failed', { unitId: unit.unitId, error: err.message });
      }
    }

    // Wait for results from the result queue
    const results = [];
    const deadline = Date.now() + this.timeout;
    const collected = new Set();

    while (collected.size < sentIds.size && Date.now() < deadline) {
      try {
        const messages = this._receiveMessages(this.resultQueueUrl, 10, Math.min(5, Math.ceil((deadline - Date.now()) / 1000)));

        for (const msg of messages) {
          let body;
          try { body = JSON.parse(msg.Body); } catch { continue; }

          if (body.unitId && sentIds.has(body.unitId) && !collected.has(body.unitId)) {
            collected.add(body.unitId);
            results.push({
              unitId: body.unitId,
              taskId: body.taskId,
              success: body.success ?? false,
              output: body.output || '',
              error: body.error || undefined,
            });
            // Delete processed result message
            try { this._deleteMessage(this.resultQueueUrl, msg.ReceiptHandle); } catch { /* best effort */ }
          }
        }
      } catch (err) {
        this.log.error('Result poll failed', { error: err.message });
        // Brief pause before retry
        await new Promise(r => setTimeout(r, this.pollInterval));
      }
    }

    // Mark unsent/uncollected units as failed
    for (const unit of units) {
      if (!collected.has(unit.unitId)) {
        results.push({
          unitId: unit.unitId,
          taskId: unit.taskId,
          success: false,
          error: sentIds.has(unit.unitId) ? 'Timeout waiting for result' : 'Failed to send to SQS',
        });
      }
    }

    const agg = aggregateResults(results);
    return {
      planId: plan.spec.id,
      taskCount: plan.tasks.length,
      unitCount: units.length,
      status: agg.status,
      results: agg.results,
    };
  }
}
