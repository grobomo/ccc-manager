// Base classes for CCC Manager components.
// Each component type (Monitor, Input, Dispatcher, Verifier) extends these.

import { validateWriteSets } from './dispatcher/write-sets.js';

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
  // Supports parallel execution: tasks without dependsOn run concurrently.
  // Tasks with dependsOn wait for their dependencies to complete first.
  // Each task can specify a worker via task.worker (falls back to config default).
  async dispatch(plan, config, workers = {}) {
    // Apply write set validation — adds dependsOn edges where file targets overlap
    plan = validateWriteSets(plan);

    const defaultWorkerName = config.dispatcher?.worker || 'default';
    const defaultWorker = workers[defaultWorkerName] || Object.values(workers)[0];
    const parallel = config.dispatcher?.parallel !== false; // default: true

    const resultMap = new Map(); // taskId → result
    const completed = new Set();

    async function executeTask(task) {
      const worker = (task.worker && workers[task.worker]) || defaultWorker;
      if (!worker) {
        return { taskId: task.id, success: true, output: 'No worker configured', skipped: true };
      }
      try {
        const result = await worker.execute(task);
        return { taskId: task.id, ...result };
      } catch (err) {
        return { taskId: task.id, success: false, error: err.message };
      }
    }

    // Group tasks: those with dependencies and those without
    const pending = [...plan.tasks];

    while (pending.length > 0) {
      // Find tasks ready to run (no unmet dependencies)
      const ready = pending.filter(t => {
        const deps = t.dependsOn || [];
        return deps.every(d => completed.has(d));
      });

      if (ready.length === 0 && pending.length > 0) {
        // Circular dependency or missing dependency — run remaining sequentially
        for (const t of pending) {
          const result = await executeTask(t);
          resultMap.set(t.id, result);
          completed.add(t.id);
        }
        break;
      }

      // Remove ready tasks from pending
      for (const t of ready) {
        pending.splice(pending.indexOf(t), 1);
      }

      // Execute ready tasks (parallel or sequential)
      if (parallel && ready.length > 1) {
        const results = await Promise.all(ready.map(t => executeTask(t)));
        for (let i = 0; i < ready.length; i++) {
          resultMap.set(ready[i].id, results[i]);
          completed.add(ready[i].id);
        }
      } else {
        for (const t of ready) {
          const result = await executeTask(t);
          resultMap.set(t.id, result);
          completed.add(t.id);
        }
      }
    }

    const results = plan.tasks.map(t => resultMap.get(t.id));
    const allSuccess = results.every(r => r?.success);
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
