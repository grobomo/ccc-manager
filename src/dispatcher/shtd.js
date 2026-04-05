// SHTDDispatcher — analyzes issues and produces SHTD-compatible spec/task structures.
// The "brain" of the manager. Workers are the "hands."

import { Dispatcher } from '../base.js';

export class SHTDDispatcher extends Dispatcher {
  constructor(config) {
    super(config);
    this.projectDir = config.projectDir || '.';
  }

  async analyze(issue) {
    // Generate a spec structure from the issue.
    // In production, this would call claude -p to generate a real spec.
    // For now, creates a structured plan from issue metadata.
    const specId = `repair-${Date.now()}`;
    const tasks = [];

    // Every issue gets at least one task: investigate and fix
    tasks.push({
      id: `${specId}-T001`,
      type: 'investigate',
      summary: `Investigate: ${issue.summary}`,
      command: null, // Worker decides approach
      issue
    });

    // If the issue has a specific command that failed, add a verify task
    if (issue.details?.command) {
      tasks.push({
        id: `${specId}-T002`,
        type: 'verify',
        summary: `Verify fix: re-run ${issue.details.command}`,
        command: issue.details.command,
        issue
      });
    }

    return {
      spec: {
        id: specId,
        title: `Fix: ${issue.summary}`,
        severity: issue.severity,
        createdAt: Date.now()
      },
      tasks,
      branch: `fix/${specId}`,
      issue
    };
  }

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
      status: allSuccess ? 'completed' : 'partial',
      results
    };
  }
}
