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
  async dispatch(plan, config, workers) {
    throw new Error('dispatch() not implemented');
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
