// ProcessMonitor — runs a shell command, reports issue if exit code != 0.
// Generic health check: "can this command succeed?"

import { execSync } from 'node:child_process';
import { Monitor } from '../base.js';

export class ProcessMonitor extends Monitor {
  constructor(name, config) {
    super(name, config);
    this.command = config.command;
    if (!this.command) throw new Error('ProcessMonitor requires config.command');
  }

  async check() {
    try {
      execSync(this.command, { stdio: 'pipe', timeout: this.config.timeout || 30000 });
      return [];
    } catch (err) {
      return [{
        severity: 'high',
        summary: `Command failed: ${this.command}`,
        details: {
          exitCode: err.status,
          stderr: err.stderr?.toString().slice(0, 500) || '',
          command: this.command
        }
      }];
    }
  }
}
