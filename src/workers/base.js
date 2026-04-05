// Worker base class — interface for task execution.
// Subclasses: LocalWorker, K8sWorker, EC2Worker.

export class Worker {
  constructor(config) {
    this.config = config;
  }

  // Execute a task. Returns { success, output, error }
  async execute(task) {
    throw new Error('execute() not implemented');
  }

  // Check status of a running task
  async status(taskId) {
    return { status: 'unknown' };
  }

  // Cancel a running task
  async cancel(taskId) {
    throw new Error('cancel() not implemented');
  }
}
