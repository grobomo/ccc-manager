// WorktreeManager — git worktree isolation for parallel task execution.
// Each task gets its own working directory and branch. No file conflicts.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger } from '../logger.js';

export class WorktreeManager {
  constructor(options = {}) {
    this.repoRoot = resolve(options.repoRoot || '.');
    this.worktreeDir = options.worktreeDir || join(this.repoRoot, '.worktrees');
    this.branchPrefix = options.branchPrefix || 'fix';
    this.baseBranch = options.baseBranch || 'main';
    this.log = createLogger('worktree');
  }

  _sanitizeId(taskId) {
    return String(taskId).replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  _git(args, cwd) {
    return execFileSync('git', args, {
      cwd: cwd || this.repoRoot,
      stdio: 'pipe',
      timeout: 30000,
    }).toString().trim();
  }

  // Create an isolated worktree for a task. Returns { path, branch }.
  create(taskId) {
    const safeId = this._sanitizeId(taskId);
    const wtPath = join(this.worktreeDir, safeId);
    const branch = `${this.branchPrefix}/${safeId}`;

    if (existsSync(wtPath)) {
      this.log.info('Worktree already exists', { taskId, path: wtPath });
      return { path: wtPath, branch };
    }

    if (!existsSync(this.worktreeDir)) {
      mkdirSync(this.worktreeDir, { recursive: true });
    }

    try {
      this._git(['worktree', 'add', '-b', branch, wtPath, this.baseBranch]);
      this.log.info('Worktree created', { taskId, path: wtPath, branch });
      return { path: wtPath, branch };
    } catch (err) {
      // Branch might already exist (from a previous run)
      if (err.message?.includes('already exists')) {
        try {
          this._git(['worktree', 'add', wtPath, branch]);
          this.log.info('Worktree created (existing branch)', { taskId, path: wtPath, branch });
          return { path: wtPath, branch };
        } catch (err2) {
          this.log.error('Worktree create failed', { taskId, error: err2.message });
          throw err2;
        }
      }
      this.log.error('Worktree create failed', { taskId, error: err.message });
      throw err;
    }
  }

  // Remove a worktree and optionally delete its branch.
  destroy(taskId, { deleteBranch = false } = {}) {
    const safeId = this._sanitizeId(taskId);
    const wtPath = join(this.worktreeDir, safeId);
    const branch = `${this.branchPrefix}/${safeId}`;

    if (!existsSync(wtPath)) {
      this.log.info('Worktree already removed', { taskId });
      return;
    }

    try {
      this._git(['worktree', 'remove', '--force', wtPath]);
    } catch {
      try {
        rmSync(wtPath, { recursive: true, force: true });
        this._git(['worktree', 'prune']);
      } catch (err) {
        this.log.error('Worktree remove failed', { taskId, error: err.message });
      }
    }

    if (deleteBranch) {
      try { this._git(['branch', '-D', branch]); } catch { /* may not exist */ }
    }

    this.log.info('Worktree destroyed', { taskId });
  }

  // List all active worktrees managed by us.
  list() {
    try {
      const raw = this._git(['worktree', 'list', '--porcelain']);
      const worktrees = [];
      let current = {};

      for (const line of raw.split('\n')) {
        if (line.startsWith('worktree ')) {
          if (current.path) worktrees.push(current);
          current = { path: line.slice(9) };
        } else if (line.startsWith('HEAD ')) {
          current.head = line.slice(5);
        } else if (line.startsWith('branch ')) {
          current.branch = line.slice(7).replace('refs/heads/', '');
        } else if (line === '') {
          if (current.path) worktrees.push(current);
          current = {};
        }
      }
      if (current.path) worktrees.push(current);

      const prefix = this.worktreeDir.replace(/\\/g, '/');
      return worktrees
        .filter(w => w.path.replace(/\\/g, '/').startsWith(prefix))
        .map(w => ({
          taskId: w.path.replace(/\\/g, '/').split('/').pop(),
          path: w.path,
          branch: w.branch,
          head: w.head,
        }));
    } catch {
      return [];
    }
  }

  exists(taskId) {
    const safeId = this._sanitizeId(taskId);
    return existsSync(join(this.worktreeDir, safeId));
  }

  destroyAll() {
    for (const wt of this.list()) {
      this.destroy(wt.taskId);
    }
  }
}
