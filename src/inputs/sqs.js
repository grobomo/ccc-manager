// SQSInput — receive tasks from an AWS SQS queue.
// Uses AWS CLI (no npm dependencies). Requires 'aws' in PATH.
//
// Config:
//   queueUrl: SQS queue URL (required)
//   region: AWS region (optional, uses CLI default)
//   waitTime: Long-poll wait time in seconds (default: 20)
//   maxMessages: Max messages per poll (default: 10, max: 10)
//   visibilityTimeout: Seconds before redelivery (default: 300)

import { execFileSync } from 'node:child_process';
import { Input } from '../base.js';
import { createLogger } from '../logger.js';

export class SQSInput extends Input {
  constructor(name, config) {
    super(name, config);
    this.queueUrl = config.queueUrl;
    this.region = config.region || undefined;
    this.waitTime = config.waitTime ?? 20;
    this.maxMessages = config.maxMessages ?? 10;
    this.visibilityTimeout = config.visibilityTimeout ?? 300;
    this.log = createLogger(`sqs:${name}`);
    this._listening = false;
    this._pollTimer = null;
    if (!this.queueUrl) throw new Error('SQSInput requires config.queueUrl');
  }

  _awsArgs(subcommand, extra = []) {
    const args = ['sqs', subcommand, '--queue-url', this.queueUrl, '--output', 'json'];
    if (this.region) args.push('--region', this.region);
    return args.concat(extra);
  }

  _exec(subcommand, extra = []) {
    const args = this._awsArgs(subcommand, extra);
    const raw = execFileSync('aws', args, { stdio: 'pipe', timeout: 30000 }).toString();
    return raw.trim() ? JSON.parse(raw) : null;
  }

  async poll() {
    try {
      const result = this._exec('receive-message', [
        '--max-number-of-messages', String(this.maxMessages),
        '--wait-time-seconds', String(this.waitTime),
        '--visibility-timeout', String(this.visibilityTimeout),
      ]);

      const messages = result?.Messages || [];
      return messages.map(msg => {
        let body;
        try { body = JSON.parse(msg.Body); } catch { body = { summary: msg.Body }; }
        return {
          id: body.id || msg.MessageId,
          summary: body.summary || body.text || msg.Body?.slice(0, 200),
          type: body.type || body.classification || 'sqs-task',
          priority: body.priority || 'normal',
          payload: body,
          _sqsReceiptHandle: msg.ReceiptHandle,
          _sqsMessageId: msg.MessageId,
        };
      });
    } catch (err) {
      this.log.error('SQS poll failed', { error: err.message });
      return [];
    }
  }

  async listen(callback) {
    this._listening = true;
    const pollInterval = (this.waitTime + 1) * 1000; // Wait time + 1s buffer

    const doPoll = async () => {
      if (!this._listening) return;
      const tasks = await this.poll();
      for (const task of tasks) callback(task);
      if (this._listening) {
        this._pollTimer = setTimeout(doPoll, pollInterval);
      }
    };

    doPoll();
  }

  async stop() {
    this._listening = false;
    if (this._pollTimer) {
      clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  // Delete message after successful processing
  deleteMessage(receiptHandle) {
    try {
      this._exec('delete-message', ['--receipt-handle', receiptHandle]);
    } catch (err) {
      this.log.error('SQS delete failed', { error: err.message });
    }
  }

  // Send a message to the queue (used by SQS dispatcher to enqueue work)
  static sendMessage(queueUrl, body, options = {}) {
    const args = ['sqs', 'send-message', '--queue-url', queueUrl, '--message-body', JSON.stringify(body), '--output', 'json'];
    if (options.region) args.push('--region', options.region);
    if (options.groupId) args.push('--message-group-id', options.groupId);
    if (options.deduplicationId) args.push('--message-deduplication-id', options.deduplicationId);
    const raw = execFileSync('aws', args, { stdio: 'pipe', timeout: 10000 }).toString();
    return raw.trim() ? JSON.parse(raw) : null;
  }
}
