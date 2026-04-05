// Base classes for CCC Manager components.
// Each component type (Monitor, Input, Dispatcher, Verifier) extends these.

export class Monitor {
  constructor(name, config) {
    this.name = name;
    this.config = config;
    this.interval = config.interval || 60000;
  }

  // Returns array of issues: [{ id, severity, summary, details }]
  async check() {
    throw new Error(`${this.name}: check() not implemented`);
  }
}

export class Input {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  // Returns array of tasks: [{ id, source, type, payload }]
  async poll() {
    throw new Error(`${this.name}: poll() not implemented`);
  }

  // Optional: start a persistent listener (SSH server, webhook, etc.)
  async listen(callback) {
    // Default: no-op (use poll-based instead)
  }

  async stop() {
    // Cleanup
  }
}

export class Dispatcher {
  constructor(config) {
    this.config = config;
  }

  // Analyze an issue/task → produce a plan with SHTD spec + task list
  async analyze(issue) {
    throw new Error('analyze() not implemented');
  }

  // Execute plan tasks via workers. Returns aggregated result.
  // Default implementation iterates plan.tasks and calls worker.execute().
  // Override only if custom dispatch logic is needed.
  async dispatch(plan, config, workers = {}) {
    const results = [];
    const workerName = config.dispatcher?.worker || 'default';
    const worker = workers[workerName] || Object.values(workers)[0];

    for (const task of plan.tasks) {
      if (worker) {
        try {
          const result = await worker.execute(task);
          results.push({ taskId: task.id, ...result });
        } catch (err) {
          results.push({ taskId: task.id, success: false, error: err.message });
        }
      } else {
        results.push({ taskId: task.id, success: true, output: 'No worker configured', skipped: true });
      }
    }

    const allSuccess = results.every(r => r.success);
    return {
      planId: plan.spec.id,
      taskCount: plan.tasks.length,
      aiGenerated: plan.spec.aiGenerated ?? false,
      status: allSuccess ? 'completed' : 'partial',
      results
    };
  }
}

export class Notifier {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  async notify(task, result) {
    throw new Error(`${this.name}: notify() not implemented`);
  }
}

export class Verifier {
  constructor(name, config) {
    this.name = name;
    this.config = config;
  }

  // Verify that a fix was applied correctly. Returns { passed, details }
  async verify(task, result) {
    throw new Error(`${this.name}: verify() not implemented`);
  }
}
