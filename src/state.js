// State persistence — queue, history, metrics.
// Writes to state/ directory (gitignored).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export class State {
  constructor(stateDir, options = {}) {
    this.dir = stateDir;
    this.dedupWindow = options.dedupWindow ?? 3600000; // Default 1 hour
    this.maxHistory = options.maxHistory ?? 1000; // Default 1000 entries
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    this.queue = this._load('queue.json', []);
    this.history = this._load('history.json', []);
    this.metrics = this._load('metrics.json', { started: Date.now(), cycles: 0, issues: 0, fixes: 0, failures: 0 });
  }

  _path(file) { return join(this.dir, file); }

  _load(file, fallback) {
    const p = this._path(file);
    if (!existsSync(p)) return fallback;
    try { return JSON.parse(readFileSync(p, 'utf-8')); }
    catch { return fallback; }
  }

  _save(file, data) {
    writeFileSync(this._path(file), JSON.stringify(data, null, 2) + '\n');
  }

  enqueue(task) {
    task.enqueuedAt = Date.now();
    task.status = 'queued';
    this.queue.push(task);
    this._save('queue.json', this.queue);
    return task;
  }

  dequeue() {
    const task = this.queue.find(t => t.status === 'queued');
    if (task) {
      task.status = 'in_progress';
      task.startedAt = Date.now();
      this._save('queue.json', this.queue);
    }
    return task || null;
  }

  complete(taskId, result) {
    const idx = this.queue.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    const task = this.queue.splice(idx, 1)[0];
    task.status = result.passed ? 'fixed' : 'failed';
    task.completedAt = Date.now();
    task.result = result;
    this.history.push(task);
    // Rotate history if over limit
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    if (result.passed) this.metrics.fixes++;
    else this.metrics.failures++;
    this._save('queue.json', this.queue);
    this._save('history.json', this.history);
    this._save('metrics.json', this.metrics);
    return task;
  }

  isDuplicate(id) {
    if (!id) return false;
    if (this.queue.some(t => t.id === id)) return true;
    // Check recent history within dedup window to avoid re-processing
    const cutoff = Date.now() - this.dedupWindow;
    return this.history.some(t => t.id === id && t.completedAt > cutoff);
  }

  recordCycle() {
    this.metrics.cycles++;
    this.metrics.lastCycle = Date.now();
    this._save('metrics.json', this.metrics);
  }
}
