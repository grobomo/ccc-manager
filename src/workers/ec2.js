// EC2Worker — dispatch tasks via SSH or AWS SSM.
// method: 'ssh' (default), 'ssm', or 'local' (for testing).

import { execSync } from 'node:child_process';
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

  _buildCommand(task) {
    if (this.method === 'local') {
      return task.command;
    }
    if (this.method === 'ssm') {
      return `aws ssm send-command --instance-ids ${this.instanceId} --document-name AWS-RunShellScript --parameters commands="${task.command}" --output text`;
    }
    // SSH
    const parts = ['ssh', '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=10'];
    if (this.keyFile) parts.push('-i', this.keyFile);
    parts.push(`${this.user}@${this.host}`, JSON.stringify(task.command));
    return parts.join(' ');
  }

  async execute(task) {
    if (!task.command) {
      return { success: true, output: 'No command (investigation task)', taskId: task.id };
    }

    const cmd = this._buildCommand(task);
    try {
      const output = execSync(cmd, {
        stdio: 'pipe',
        timeout: this.config.timeout || 120000,
        shell: true
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
