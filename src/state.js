// State persistence — queue, history, metrics.
// Writes to state/ directory (gitignored).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

// Priority levels (lower number = higher priority)
export const PRIORITY_ORDER = { critical: 0, high: 1, normal: 2, low: 3 };

export class State {
  constructor(stateDir, options = {}) {
    this.dir = stateDir;
    this.dedupWindow = options.dedupWindow ?? 3600000; // Default 1 hour
    this.maxHistory = options.maxHistory ?? 1000; // Default 1000 entries
    this.claimTimeout = options.claimTimeout ?? 600000; // Default 10 minutes
    this.workerId = options.workerId ?? null;
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
    task.priority = task.priority || 'normal';
    this.queue.push(task);
    this._save('queue.json', this.queue);
    return task;
  }

  dequeue() {
    // Priority-aware: pick highest-priority queued task (critical > high > normal > low)
    const queued = this.queue.filter(t => t.status === 'queued');
    if (queued.length === 0) return null;

    queued.sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? PRIORITY_ORDER.normal;
      const pb = PRIORITY_ORDER[b.priority] ?? PRIORITY_ORDER.normal;
      if (pa !== pb) return pa - pb;
      return (a.enqueuedAt || 0) - (b.enqueuedAt || 0); // FIFO within same priority
    });

    // Skip tasks claimed by other workers
    for (const task of queued) {
      const claimedBy = this.isClaimed(task.id);
      if (claimedBy) continue; // Another worker has this task
      if (!this.claim(task.id)) continue; // Couldn't claim (race condition)
      task.status = 'in_progress';
      task.startedAt = Date.now();
      task.claimedBy = this.workerId || undefined;
      this._save('queue.json', this.queue);
      return task;
    }
    return null; // All queued tasks are claimed by other workers
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

  // --- Task Claims (multi-worker coordination) ---

  _claimsDir() {
    const dir = join(this.dir, 'claims');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  _claimPath(taskId) {
    const safeId = String(taskId).replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this._claimsDir(), `${safeId}.json`);
  }

  // Atomically claim a task for a worker. Returns true if claimed, false if already claimed.
  claim(taskId, workerId) {
    workerId = workerId || this.workerId;
    if (!workerId) return true; // No worker ID = single-worker mode, always succeeds
    const p = this._claimPath(taskId);
    // Check existing claim
    if (existsSync(p)) {
      try {
        const existing = JSON.parse(readFileSync(p, 'utf-8'));
        // Same worker reclaiming? Allow it.
        if (existing.workerId === workerId) return true;
        // Different worker — check if expired
        if (Date.now() - existing.claimedAt < this.claimTimeout) return false;
        // Expired — fall through to overwrite
      } catch { /* corrupted claim file — overwrite */ }
    }
    writeFileSync(p, JSON.stringify({ workerId, taskId, claimedAt: Date.now() }));
    return true;
  }

  // Release a claim. Only the owning worker (or expired claims) can release.
  release(taskId, workerId) {
    workerId = workerId || this.workerId;
    const p = this._claimPath(taskId);
    if (!existsSync(p)) return true;
    try {
      const existing = JSON.parse(readFileSync(p, 'utf-8'));
      if (workerId && existing.workerId !== workerId) return false;
    } catch { /* corrupted — safe to delete */ }
    try { unlinkSync(p); } catch { /* already gone */ }
    return true;
  }

  // Check if a task is claimed by another worker. Returns claiming workerId or null.
  isClaimed(taskId, workerId) {
    workerId = workerId || this.workerId;
    const p = this._claimPath(taskId);
    if (!existsSync(p)) return null;
    try {
      const existing = JSON.parse(readFileSync(p, 'utf-8'));
      // Expired claims don't count
      if (Date.now() - existing.claimedAt >= this.claimTimeout) return null;
      // Same worker's own claim doesn't block
      if (workerId && existing.workerId === workerId) return null;
      return existing.workerId;
    } catch { return null; }
  }

  // Clean up expired claims
  pruneExpiredClaims() {
    const dir = this._claimsDir();
    if (!existsSync(dir)) return 0;
    let pruned = 0;
    for (const file of readdirSync(dir)) {
      const p = join(dir, file);
      try {
        const claim = JSON.parse(readFileSync(p, 'utf-8'));
        if (Date.now() - claim.claimedAt >= this.claimTimeout) {
          unlinkSync(p);
          pruned++;
        }
      } catch { try { unlinkSync(p); pruned++; } catch { /* ignore */ } }
    }
    return pruned;
  }

  recordCycle() {
    this.metrics.cycles++;
    this.metrics.lastCycle = Date.now();
    this._save('metrics.json', this.metrics);
  }
}
