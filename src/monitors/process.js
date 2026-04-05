// ProcessMonitor — runs a shell command, reports issue if exit code != 0.
// Generic health check: "can this command succeed?"

import { Monitor } from '../base.js';
import { execCommand } from './exec-helper.js';

export class ProcessMonitor extends Monitor {
  constructor(name, config) {
    super(name, config);
    this.command = config.command;
    if (!this.command) throw new Error('ProcessMonitor requires config.command');
  }

  async check() {
    const result = execCommand(this.command, this.config.timeout || 30000);
    if (result.success) return [];
    return [{
      severity: 'high',
      summary: `Command failed: ${result.cmdPreview}`,
      details: {
        exitCode: result.exitCode,
        stderr: result.stderr,
        command: this.command
      }
    }];
  }
}
