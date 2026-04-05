// EC2Worker — dispatch tasks via SSH or AWS SSM.
// method: 'ssh' (default), 'ssm', or 'local' (for testing).

import { execFileSync, execSync } from 'node:child_process';
import { Worker } from './base.js';

export class EC2Worker extends Worker {
  constructor(config) {
    super(config);
    this.host = config.host;
    this.user = config.user || 'ec2-user';
    this.keyFile = config.keyFile;
    this.method = config.method || 'ssh';
    this.instanceId = config.instanceId; // For SSM
  }

  _buildArgs(task) {
    if (this.method === 'ssm') {
      return {
        cmd: 'aws',
        args: [
          'ssm', 'send-command',
          '--instance-ids', this.instanceId,
          '--document-name', 'AWS-RunShellScript',
          '--parameters', JSON.stringify({ commands: [task.command] }),
          '--output', 'text'
        ]
      };
    }
    // SSH — pass command as last arg; execFileSync avoids local shell interpretation
    const args = ['-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10'];
    if (this.keyFile) args.push('-i', this.keyFile);
    args.push(`${this.user}@${this.host}`, task.command);
    return { cmd: 'ssh', args };
  }

  async execute(task) {
    if (!task.command) {
      return { success: true, output: 'No command (investigation task)', taskId: task.id };
    }

    try {
      let output;
      if (this.method === 'local') {
        // Local mode: shell needed to interpret command strings
        output = execSync(task.command, {
          stdio: 'pipe',
          timeout: this.config.timeout || 120000,
          shell: true
        }).toString();
      } else {
        const { cmd, args } = this._buildArgs(task);
        output = execFileSync(cmd, args, {
          stdio: 'pipe',
          timeout: this.config.timeout || 120000
        }).toString();
      }
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
