// FileNotifier — writes task results to disk as JSON files.
// Config: { dir, prefix }
// Useful for bridge-based workflows where upstream reads results from disk.

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Notifier } from '../base.js';

export class FileNotifier extends Notifier {
  constructor(name, config) {
    super(name, config);
    this.dir = config.dir;
    this.prefix = config.prefix || 'result';
    if (!this.dir) throw new Error('FileNotifier requires config.dir');
  }

  async notify(task, result) {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });

    const filename = `${this.prefix}-${task.id || Date.now()}.json`;
    const payload = {
      taskId: task.id,
      source: task.source,
      summary: task.summary,
      status: result.passed ? 'fixed' : 'failed',
      passed: result.passed,
      details: result.details,
      completedAt: new Date().toISOString()
    };

    const filePath = join(this.dir, filename);
    writeFileSync(filePath, JSON.stringify(payload, null, 2) + '\n');
    return { sent: true, path: filePath };
  }
}
