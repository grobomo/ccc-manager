// WebhookNotifier — posts task results to Teams/Slack webhook URLs.
// Config: { url, format: 'teams'|'slack'|'json' }

import { Notifier } from '../base.js';
import { createLogger } from '../logger.js';

export class WebhookNotifier extends Notifier {
  constructor(name, config) {
    super(name, config);
    this.url = config.url;
    if (!this.url) throw new Error('WebhookNotifier requires config.url');
    this.format = config.format || 'json';
    this.log = createLogger(`notify:${name}`);
  }

  async notify(task, result) {
    const body = this._formatPayload(task, result);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        this.log.error('HTTP error', { status: res.status });
      }
      return { sent: res.ok, status: res.status };
    } catch (err) {
      this.log.error('Error', { error: err.message });
      return { sent: false, error: err.message };
    }
  }

  _formatPayload(task, result) {
    const emoji = result.passed ? '\u2705' : '\u274c';
    const status = result.passed ? 'FIXED' : 'FAILED';
    const summary = `${emoji} [CCC] ${task.summary || task.id}: ${status}`;

    if (this.format === 'teams') {
      return {
        '@type': 'MessageCard',
        summary,
        themeColor: result.passed ? '00cc00' : 'cc0000',
        sections: [{
          activityTitle: summary,
          facts: [
            { name: 'Task', value: task.id },
            { name: 'Source', value: task.source || 'unknown' },
            { name: 'Status', value: status },
            { name: 'Details', value: result.details || '-' }
          ]
        }]
      };
    }

    if (this.format === 'slack') {
      return {
        text: summary,
        blocks: [{
          type: 'section',
          text: { type: 'mrkdwn', text: `*${summary}*\nTask: \`${task.id}\` | Source: ${task.source || 'unknown'}\n${result.details || ''}` }
        }]
      };
    }

    // Default: plain JSON
    return { task: task.id, source: task.source, status, passed: result.passed, details: result.details };
  }
}
