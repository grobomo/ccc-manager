// K8sWorker — dispatch tasks via kubectl exec.
// Configurable namespace, pod, container.

import { execSync } from 'node:child_process';
import { Worker } from './base.js';

export class K8sWorker extends Worker {
  constructor(config) {
    super(config);
    this.namespace = config.namespace || 'default';
    this.pod = config.pod;
    this.container = config.container;
    this.kubectlPath = config.kubectlPath || 'kubectl';
  }

  _buildCommand(task) {
    const parts = [this.kubectlPath, 'exec'];
    if (this.namespace) parts.push('-n', this.namespace);
    if (this.container) parts.push('-c', this.container);
    parts.push(this.pod, '--', task.command);
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
        timeout: this.config.timeout || 120000
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
