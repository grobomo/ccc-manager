// Registry — maps type names to component classes.

export class Registry {
  constructor() {
    this._monitors = new Map();
    this._inputs = new Map();
    this._dispatchers = new Map();
    this._verifiers = new Map();
    this._workers = new Map();
  }

  registerMonitor(type, cls) { this._monitors.set(type, cls); }
  registerInput(type, cls) { this._inputs.set(type, cls); }
  registerDispatcher(type, cls) { this._dispatchers.set(type, cls); }
  registerVerifier(type, cls) { this._verifiers.set(type, cls); }
  registerWorker(type, cls) { this._workers.set(type, cls); }

  getMonitor(type) { return this._monitors.get(type) || null; }
  getInput(type) { return this._inputs.get(type) || null; }
  getDispatcher(type) { return this._dispatchers.get(type) || null; }
  getVerifier(type) { return this._verifiers.get(type) || null; }
  getWorker(type) { return this._workers.get(type) || null; }

  listMonitors() { return [...this._monitors.keys()]; }
  listInputs() { return [...this._inputs.keys()]; }
  listDispatchers() { return [...this._dispatchers.keys()]; }
  listVerifiers() { return [...this._verifiers.keys()]; }
  listWorkers() { return [...this._workers.keys()]; }
}
