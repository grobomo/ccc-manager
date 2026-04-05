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

  async dispatch(plan, config) {
    // In full implementation, this distributes tasks to workers.
    // Returns aggregated result.
    return {
      planId: plan.spec.id,
      taskCount: plan.tasks.length,
      status: 'planned'
    };
  }
}
