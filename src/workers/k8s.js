// K8sWorker — dispatch tasks via kubectl exec.
// Configurable namespace, pod, container.

import { execFileSync } from 'node:child_process';
import { Worker } from './base.js';

export class K8sWorker extends Worker {
  constructor(config) {
    super(config);
    this.namespace = config.namespace || 'default';
    this.pod = config.pod;
    this.container = config.container;
    this.kubectlPath = config.kubectlPath || 'kubectl';
  }

  _buildArgs(task) {
    const args = ['exec'];
    if (this.namespace) args.push('-n', this.namespace);
    if (this.container) args.push('-c', this.container);
    // execFileSync passes each arg directly — no local shell interpretation
    args.push(this.pod, '--', 'sh', '-c', task.command);
    return args;
  }

  async execute(task) {
    if (!task.command) {
      return { success: true, output: 'No command (investigation task)', taskId: task.id };
    }

    const args = this._buildArgs(task);
    try {
      const output = execFileSync(this.kubectlPath, args, {
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
