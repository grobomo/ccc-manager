#!/usr/bin/env node

// CCC Manager — main runtime.
// Loads project config, starts monitors and inputs, runs event loop.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { State } from './state.js';
import { Registry } from './registry.js';
import { registerBuiltins } from './builtins.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export class Manager {
  constructor(configPath) {
    this.config = loadConfig(configPath);
    this.state = new State(resolve(ROOT, 'state'));
    this.registry = new Registry();
    this.monitors = [];
    this.inputs = [];
    this.dispatcher = null;
    this.verifiers = [];
    this.workers = {};
    this.notifiers = [];
    this.running = false;
    this.timers = [];
    this.healthServer = null;
  }

  async init() {
    registerBuiltins(this.registry);

    if (this.config.monitors) {
      for (const [name, cfg] of Object.entries(this.config.monitors)) {
        const MonitorClass = this.registry.getMonitor(cfg.type || name);
        if (MonitorClass) {
          this.monitors.push(new MonitorClass(name, cfg));
        } else {
          console.warn(`[manager] Unknown monitor type: ${cfg.type || name}`);
        }
      }
    }

    if (this.config.inputs) {
      for (const [name, cfg] of Object.entries(this.config.inputs)) {
        const InputClass = this.registry.getInput(cfg.type || name);
        if (InputClass) {
          this.inputs.push(new InputClass(name, cfg));
        } else {
          console.warn(`[manager] Unknown input type: ${cfg.type || name}`);
        }
      }
    }

    const dispType = this.config.dispatcher?.type || 'shtd';
    const DispatcherClass = this.registry.getDispatcher(dispType);
    if (DispatcherClass) {
      this.dispatcher = new DispatcherClass(this.config.dispatcher || {});
    }

    if (this.config.verifiers) {
      for (const [name, cfg] of Object.entries(this.config.verifiers)) {
        const VerifierClass = this.registry.getVerifier(cfg.type || name);
        if (VerifierClass) {
          this.verifiers.push(new VerifierClass(name, cfg));
        } else {
          console.warn(`[manager] Unknown verifier type: ${cfg.type || name}`);
        }
      }
    }

    if (this.config.workers) {
      for (const [name, cfg] of Object.entries(this.config.workers)) {
        const WorkerClass = this.registry.getWorker(cfg.type || name);
        if (WorkerClass) {
          this.workers[name] = new WorkerClass(cfg);
        } else {
          console.warn(`[manager] Unknown worker type: ${cfg.type || name}`);
        }
      }
    }

    if (this.config.notifiers) {
      for (const [name, cfg] of Object.entries(this.config.notifiers)) {
        const NotifierClass = this.registry.getNotifier(cfg.type || name);
        if (NotifierClass) {
          this.notifiers.push(new NotifierClass(name, cfg));
        } else {
          console.warn(`[manager] Unknown notifier type: ${cfg.type || name}`);
        }
      }
    }

    const workerCount = Object.keys(this.workers).length;
    console.log(`[manager] Initialized: ${this.monitors.length} monitors, ${this.inputs.length} inputs, ${this.verifiers.length} verifiers, ${workerCount} workers, ${this.notifiers.length} notifiers`);
  }

  async _processTask(task) {
    const maxRetries = this.config.maxRetries ?? 0;
    task._retries = task._retries || 0;

    try {
      console.log(`[dispatcher] Processing: ${task.summary || task.id}${task._retries > 0 ? ` (retry ${task._retries}/${maxRetries})` : ''}`);
      const plan = await this.dispatcher.analyze(task);
      const result = await this.dispatcher.dispatch(plan, this.config, this.workers);

      let verified = { passed: true, details: 'No verifier configured' };
      for (const verifier of this.verifiers) {
        verified = await verifier.verify(task, result);
        if (!verified.passed) break;
      }

      if (!verified.passed && task._retries < maxRetries) {
        task._retries++;
        console.log(`[manager] Task ${task.id}: FAILED — retrying (${task._retries}/${maxRetries})`);
        task.status = 'queued';
        this.state._save('queue.json', this.state.queue);
        return;
      }

      this.state.complete(task.id, verified);
      console.log(`[manager] Task ${task.id}: ${verified.passed ? 'FIXED' : 'FAILED'}`);
      await this._notify(task, verified);
    } catch (err) {
      if (task._retries < maxRetries) {
        task._retries++;
        console.error(`[dispatcher] Error processing ${task.id}: ${err.message} — retrying (${task._retries}/${maxRetries})`);
        task.status = 'queued';
        this.state._save('queue.json', this.state.queue);
        return;
      }
      console.error(`[dispatcher] Error processing ${task.id}: ${err.message}`);
      const failResult = { passed: false, details: err.message };
      this.state.complete(task.id, failResult);
      await this._notify(task, failResult);
    }
  }

  async _notify(task, result) {
    for (const notifier of this.notifiers) {
      try {
        await notifier.notify(task, result);
      } catch (err) {
        console.error(`[notify:${notifier.name}] Error: ${err.message}`);
      }
    }
  }

  async runCycle() {
    for (const monitor of this.monitors) {
      try {
        const issues = await monitor.check();
        for (const issue of issues) {
          issue.source = `monitor:${monitor.name}`;
          issue.id = issue.id || `${monitor.name}-${Date.now()}`;
          if (!this.state.isDuplicate(issue.id)) {
            this.state.enqueue(issue);
            this.state.metrics.issues++;
            this.state._save('metrics.json', this.state.metrics);
            console.log(`[monitor:${monitor.name}] Issue detected: ${issue.summary}`);
          }
        }
      } catch (err) {
        console.error(`[monitor:${monitor.name}] Error: ${err.message}`);
      }
    }

    for (const input of this.inputs) {
      try {
        const tasks = await input.poll();
        for (const task of tasks) {
          task.source = `input:${input.name}`;
          task.id = task.id || `${input.name}-${Date.now()}`;
          if (!this.state.isDuplicate(task.id)) {
            this.state.enqueue(task);
            console.log(`[input:${input.name}] Task received: ${task.summary || task.type}`);
          }
        }
      } catch (err) {
        console.error(`[input:${input.name}] Error: ${err.message}`);
      }
    }

    if (this.dispatcher) {
      let task;
      while ((task = this.state.dequeue())) {
        await this._processTask(task);
      }
    }

    this.state.recordCycle();
  }

  startHealth() {
    const port = this.config.healthPort || 8080;
    this.healthServer = createServer((req, res) => {
      if (req.url === '/healthz' || req.url === '/livez') {
        res.writeHead(this.running ? 200 : 503);
        res.end(JSON.stringify({
          status: this.running ? 'ok' : 'stopping',
          uptime: process.uptime(),
        }));
      } else if (req.url === '/readyz') {
        const ready = this.running && this.dispatcher !== null;
        res.writeHead(ready ? 200 : 503);
        res.end(JSON.stringify({
          status: ready ? 'ready' : 'not_ready',
          queue: this.state.queue.length,
          cycles: this.state.metrics.cycles,
        }));
      } else if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.state.metrics));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    this.healthServer.listen(port, () => {
      console.log(`[health] Listening on :${port} (/healthz, /readyz, /metrics)`);
    });
  }

  async start() {
    await this.init();
    this.running = true;
    const interval = this.config.interval || 60000;
    console.log(`[manager] Starting event loop (${interval}ms interval)`);

    this.startHealth();

    await this.runCycle();
    const timer = setInterval(() => {
      if (this.running) this.runCycle().catch(err => console.error(`[manager] Cycle error: ${err.message}`));
    }, interval);
    this.timers.push(timer);

    for (const input of this.inputs) {
      input.listen((task) => {
        task.source = `input:${input.name}`;
        task.id = task.id || `${input.name}-${Date.now()}`;
        this.state.enqueue(task);
      }).catch(err => console.error(`[input:${input.name}] Listen error: ${err.message}`));
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    console.log('[manager] Shutting down — draining queue...');
    this.timers.forEach(t => clearInterval(t));
    this.timers = [];

    // Stop accepting new tasks
    for (const input of this.inputs) {
      await input.stop().catch(() => {});
    }

    // Drain remaining queued tasks (with timeout)
    const drainTimeout = this.config.drainTimeout || 30000;
    const deadline = Date.now() + drainTimeout;
    let drained = 0;

    while (this.state.queue.length > 0 && this.dispatcher && Date.now() < deadline) {
      const task = this.state.dequeue();
      if (!task) break;
      console.log(`[manager] Draining: ${task.summary || task.id}`);
      await this._processTask(task);
      drained++;
    }

    // Re-queue anything we couldn't drain in time
    const remaining = this.state.queue.length;
    if (remaining > 0) {
      console.log(`[manager] ${remaining} task(s) still queued — will resume on restart`);
    }
    if (drained > 0) {
      console.log(`[manager] Drained ${drained} task(s) during shutdown`);
    }

    // Close health server
    if (this.healthServer) {
      await new Promise(r => this.healthServer.close(r));
      this.healthServer = null;
    }
    console.log('[manager] Stopped');
  }
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const configPath = process.argv[2];
  if (!configPath) {
    console.error('Usage: node src/index.js <config.yaml>');
    process.exit(1);
  }
  const manager = new Manager(resolve(configPath));
  const shutdown = () => manager.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  manager.start().catch(err => {
    console.error(`[manager] Fatal: ${err.message}`);
    process.exit(1);
  });
}
