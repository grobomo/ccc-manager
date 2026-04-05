#!/usr/bin/env node

// CCC Manager — main runtime.
// Loads project config, starts monitors and inputs, runs event loop.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { loadConfig } from './config.js';
import { State } from './state.js';
import { Registry } from './registry.js';
import { registerBuiltins } from './builtins.js';
import { createLogger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Hot-reloadable config fields (changed at runtime without restart)
const HOT_RELOAD_FIELDS = ['interval', 'maxRetries', 'dedupWindow', 'maxHistory', 'drainTimeout'];

export class Manager {
  constructor(configPath) {
    this.configPath = resolve(configPath);
    this.config = loadConfig(this.configPath);
    this.log = createLogger('manager', { json: this.config.logFormat === 'json' });
    this.state = new State(resolve(ROOT, 'state'), {
      dedupWindow: this.config.dedupWindow,
      maxHistory: this.config.maxHistory,
    });
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
    this._configWatcher = null;
    this._reloadDebounce = null;
    this._startedAt = Date.now();
    this._lastReloadAt = null;
  }

  async _initComponents(section, getter, target) {
    const entries = this.config[section];
    if (!entries) return;
    for (const [name, cfg] of Object.entries(entries)) {
      const type = cfg.type || name;
      let Cls = getter(type);

      // Plugin loader: if type is a file path, dynamically import it
      if (!Cls && (type.startsWith('./') || type.startsWith('/') || type.startsWith('../'))) {
        try {
          const mod = await import(resolve(ROOT, type));
          Cls = mod.default || Object.values(mod)[0];
          this.log.info('Loaded plugin', { plugin: type });
        } catch (err) {
          this.log.error('Failed to load plugin', { plugin: type, error: err.message });
        }
      }

      if (Cls) {
        if (Array.isArray(target)) target.push(new Cls(name, cfg));
        else target[name] = new Cls(cfg); // workers use object map, no name arg
      } else {
        this.log.warn('Unknown component type', { section, type: cfg.type || name });
      }
    }
  }

  async init() {
    registerBuiltins(this.registry);

    await this._initComponents('monitors', t => this.registry.getMonitor(t), this.monitors);
    await this._initComponents('inputs', t => this.registry.getInput(t), this.inputs);
    await this._initComponents('verifiers', t => this.registry.getVerifier(t), this.verifiers);
    await this._initComponents('workers', t => this.registry.getWorker(t), this.workers);
    await this._initComponents('notifiers', t => this.registry.getNotifier(t), this.notifiers);

    const dispType = this.config.dispatcher?.type || 'shtd';
    const DispatcherClass = this.registry.getDispatcher(dispType);
    if (DispatcherClass) {
      this.dispatcher = new DispatcherClass(this.config.dispatcher || {});
    }

    const workerCount = Object.keys(this.workers).length;
    this.log.info('Initialized', { monitors: this.monitors.length, inputs: this.inputs.length, verifiers: this.verifiers.length, workers: workerCount, notifiers: this.notifiers.length });
  }

  async _processTask(task) {
    const maxRetries = this.config.maxRetries ?? 0;
    task._retries = task._retries || 0;

    try {
      this.log.info('Processing task', { taskId: task.id, summary: task.summary, retry: task._retries > 0 ? `${task._retries}/${maxRetries}` : undefined, dryRun: this.dryRun || undefined });
      const plan = await this.dispatcher.analyze(task);

      if (this.dryRun) {
        this.log.info('[dry-run] Would dispatch', { taskId: task.id, tasks: plan.tasks?.length ?? 0 });
        this.state.complete(task.id, { passed: true, details: 'dry-run: skipped execution' });
        return;
      }

      const result = await this.dispatcher.dispatch(plan, this.config, this.workers);

      let verified = { passed: true, details: 'No verifier configured' };
      for (const verifier of this.verifiers) {
        verified = await verifier.verify(task, result);
        if (!verified.passed) break;
      }

      if (!verified.passed && task._retries < maxRetries) {
        task._retries++;
        this.log.warn('Task failed, retrying', { taskId: task.id, retry: `${task._retries}/${maxRetries}` });
        task.status = 'queued';
        this.state._save('queue.json', this.state.queue);
        return;
      }

      this.state.complete(task.id, verified);
      this.log.info(`Task ${verified.passed ? 'FIXED' : 'FAILED'}`, { taskId: task.id, passed: verified.passed });
      await this._notify(task, verified);
    } catch (err) {
      if (task._retries < maxRetries) {
        task._retries++;
        this.log.error('Task error, retrying', { taskId: task.id, error: err.message, retry: `${task._retries}/${maxRetries}` });
        task.status = 'queued';
        this.state._save('queue.json', this.state.queue);
        return;
      }
      this.log.error('Task error', { taskId: task.id, error: err.message });
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
        this.log.error('Notify error', { notifier: notifier.name, error: err.message });
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
            this.log.info('Issue detected', { monitor: monitor.name, issueId: issue.id, summary: issue.summary });
          }
        }
      } catch (err) {
        this.log.error('Monitor error', { monitor: monitor.name, error: err.message });
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
            this.log.info('Task received', { input: input.name, taskId: task.id, summary: task.summary || task.type });
          }
        }
      } catch (err) {
        this.log.error('Input error', { input: input.name, error: err.message });
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
        const m = this.state.metrics;
        const accept = req.headers.accept || '';
        if (accept.includes('application/json')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(m));
        } else {
          // Prometheus text exposition format
          const lines = [
            '# HELP ccc_cycles_total Total run cycles completed',
            '# TYPE ccc_cycles_total counter',
            `ccc_cycles_total ${m.cycles || 0}`,
            '# HELP ccc_issues_total Total issues detected',
            '# TYPE ccc_issues_total counter',
            `ccc_issues_total ${m.issues || 0}`,
            '# HELP ccc_fixes_total Total fixes applied',
            '# TYPE ccc_fixes_total counter',
            `ccc_fixes_total ${m.fixes || 0}`,
            '# HELP ccc_failures_total Total failures',
            '# TYPE ccc_failures_total counter',
            `ccc_failures_total ${m.failures || 0}`,
            '# HELP ccc_queue_length Current queue depth',
            '# TYPE ccc_queue_length gauge',
            `ccc_queue_length ${this.state.queue.length}`,
            '# HELP ccc_uptime_seconds Seconds since manager started',
            '# TYPE ccc_uptime_seconds gauge',
            `ccc_uptime_seconds ${Math.floor((Date.now() - this._startedAt) / 1000)}`,
            '# HELP ccc_last_reload_timestamp_seconds Unix timestamp of last config reload',
            '# TYPE ccc_last_reload_timestamp_seconds gauge',
            `ccc_last_reload_timestamp_seconds ${this._lastReloadAt ? Math.floor(this._lastReloadAt / 1000) : 0}`,
            '',
          ];
          res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
          res.end(lines.join('\n'));
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    this.healthServer.listen(port, () => {
      this.log.info('Health endpoint listening', { port, endpoints: ['/healthz', '/readyz', '/metrics'] });
    });
  }

  _reloadConfig() {
    try {
      const newConfig = loadConfig(this.configPath);
      const changes = {};
      for (const field of HOT_RELOAD_FIELDS) {
        if (newConfig[field] !== undefined && newConfig[field] !== this.config[field]) {
          changes[field] = { from: this.config[field], to: newConfig[field] };
          this.config[field] = newConfig[field];
        }
      }

      if (Object.keys(changes).length === 0) return;

      this._lastReloadAt = Date.now();
      this.log.info('Config reloaded', { changes });

      // Apply side effects
      if (changes.interval) {
        this.timers.forEach(t => clearInterval(t));
        this.timers = [];
        const timer = setInterval(() => {
          if (this.running) this.runCycle().catch(err => this.log.error('Cycle error', { error: err.message }));
        }, this.config.interval);
        this.timers.push(timer);
      }
      if (changes.dedupWindow) this.state.dedupWindow = this.config.dedupWindow;
      if (changes.maxHistory) this.state.maxHistory = this.config.maxHistory;
    } catch (err) {
      this.log.error('Config reload failed — keeping current config', { error: err.message });
    }
  }

  _watchConfig() {
    try {
      this._configWatcher = watch(this.configPath, (eventType) => {
        if (eventType !== 'change') return;
        // Debounce: editors often write multiple times
        clearTimeout(this._reloadDebounce);
        this._reloadDebounce = setTimeout(() => this._reloadConfig(), 500);
      });
      this._configWatcher.on('error', () => {}); // Ignore watch errors (file moved, etc.)
      this.log.info('Watching config for hot-reload', { path: this.configPath });
    } catch {
      this.log.warn('Could not watch config file — hot-reload disabled');
    }
  }

  async start() {
    await this.init();
    this.running = true;
    const interval = this.config.interval || 60000;
    this.log.info('Starting event loop', { interval });

    this.startHealth();
    this._watchConfig();

    await this.runCycle();
    const timer = setInterval(() => {
      if (this.running) this.runCycle().catch(err => this.log.error('Cycle error', { error: err.message }));
    }, interval);
    this.timers.push(timer);

    for (const input of this.inputs) {
      input.listen((task) => {
        task.source = `input:${input.name}`;
        task.id = task.id || `${input.name}-${Date.now()}`;
        if (!this.state.isDuplicate(task.id)) {
          this.state.enqueue(task);
          this.log.info('Task received (listen)', { input: input.name, taskId: task.id, summary: task.summary || task.type });
        }
      }).catch(err => this.log.error('Listen error', { input: input.name, error: err.message }));
    }
  }

  async stop() {
    if (!this.running) return;
    this.running = false;
    this.log.info('Shutting down — draining queue');
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
      this.log.debug('Draining task', { taskId: task.id, summary: task.summary });
      await this._processTask(task);
      drained++;
    }

    // Re-queue anything we couldn't drain in time
    const remaining = this.state.queue.length;
    if (remaining > 0) {
      this.log.warn('Tasks still queued — will resume on restart', { remaining });
    }
    if (drained > 0) {
      this.log.info('Drained tasks during shutdown', { drained });
    }

    // Close config watcher
    if (this._configWatcher) {
      this._configWatcher.close();
      this._configWatcher = null;
    }
    clearTimeout(this._reloadDebounce);

    // Close health server
    if (this.healthServer) {
      await new Promise(r => this.healthServer.close(r));
      this.healthServer = null;
    }
    this.log.info('Stopped');
  }
}

// CLI entry point
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter(a => a.startsWith('-')));
  const positional = args.filter(a => !a.startsWith('-'));

  if (flags.has('--help') || flags.has('-h')) {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    console.log(`ccc-manager v${pkg.version} — ${pkg.description}

Usage: ccc-manager <config.yaml> [options]

Options:
  --validate        Validate config and exit (no start)
  --dry-run         Init, run one cycle, print results, exit (no workers)
  --status          Print current queue/metrics from state/ and exit
  --list-components List available component types
  --version         Print version and exit
  --help            Show this help`);
    process.exit(0);
  }

  if (flags.has('--version') || flags.has('-v')) {
    const { readFileSync } = await import('node:fs');
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));
    console.log(pkg.version);
    process.exit(0);
  }

  if (flags.has('--list-components')) {
    const reg = new Registry();
    registerBuiltins(reg);
    const sections = [
      ['Monitors', reg.listMonitors()],
      ['Inputs', reg.listInputs()],
      ['Dispatchers', reg.listDispatchers()],
      ['Verifiers', reg.listVerifiers()],
      ['Workers', reg.listWorkers()],
      ['Notifiers', reg.listNotifiers()],
    ];
    for (const [label, types] of sections) {
      console.log(`${label}: ${types.join(', ')}`);
    }
    process.exit(0);
  }

  if (flags.has('--status')) {
    const { existsSync, readFileSync } = await import('node:fs');
    const stateDir = resolve(ROOT, 'state');
    const read = (f, fallback) => {
      const p = resolve(stateDir, f);
      if (!existsSync(p)) return fallback;
      try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return fallback; }
    };
    const queue = read('queue.json', []);
    const metrics = read('metrics.json', {});
    const history = read('history.json', []);
    console.log(`Queue: ${queue.length} tasks`);
    if (queue.length > 0) {
      for (const t of queue) console.log(`  [${t.status}] ${t.id} — ${t.summary || t.type || '(no summary)'}`);
    }
    console.log(`History: ${history.length} entries`);
    console.log(`Metrics: ${metrics.cycles ?? 0} cycles, ${metrics.issues ?? 0} issues, ${metrics.fixes ?? 0} fixes, ${metrics.failures ?? 0} failures`);
    if (metrics.lastCycle) console.log(`Last cycle: ${new Date(metrics.lastCycle).toISOString()}`);
    process.exit(0);
  }

  const configPath = positional[0];
  if (!configPath) {
    console.error('Usage: ccc-manager <config.yaml> [--validate] [--dry-run] [--status] [--list-components] [--version] [--help]');
    process.exit(1);
  }

  if (flags.has('--validate')) {
    try {
      loadConfig(resolve(configPath));
      console.log('Config OK');
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  if (flags.has('--dry-run')) {
    const manager = new Manager(resolve(configPath));
    manager.dryRun = true;
    await manager.init();
    console.log('[dry-run] Running one cycle (workers disabled)...');
    await manager.runCycle();
    const q = manager.state.queue;
    const m = manager.state.metrics;
    console.log(`[dry-run] Cycle complete: ${m.issues} issues, ${q.length} queued, ${m.fixes} fixes, ${m.failures} failures`);
    if (q.length > 0) {
      for (const t of q) console.log(`  [${t.status}] ${t.id} — ${t.summary || '(no summary)'}`);
    }
    process.exit(0);
  }

  const manager = new Manager(resolve(configPath));
  const shutdown = () => manager.stop().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // SIGHUP triggers config reload (K8s ConfigMap update pattern)
  if (process.platform !== 'win32') {
    process.on('SIGHUP', () => manager._reloadConfig());
  }
  manager.start().catch(err => {
    console.error(`[manager] Fatal: ${err.message}`);
    process.exit(1);
  });
}
