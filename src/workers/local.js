// LocalWorker — executes tasks via child_process.
// Used for dev/test and single-node deployments.

import { execSync } from 'node:child_process';
import { Worker } from './base.js';

export class LocalWorker extends Worker {
  constructor(config) {
    super(config);
  }

  async execute(task) {
    if (!task.command) {
      return { success: true, output: 'No command specified (investigation task)', taskId: task.id };
    }

    try {
      const output = execSync(task.command, {
        stdio: 'pipe',
        timeout: this.config.timeout || 120000,
        shell: this.config.shell !== false
      }).toString();

      return { success: true, output, taskId: task.id };
    } catch (err) {
      return {
        success: false,
        output: err.stdout?.toString() || '',
        error: err.stderr?.toString() || err.message,
        exitCode: err.status,
        taskId: task.id
      };
    }
  }
}
