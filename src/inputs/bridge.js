// BridgeInput — polls a directory for .json task files.
// Used by rone-teams-poller to send SELF_REPAIR tasks via PVC/git bridge.
// Processed files move to done/ (or completedDir if configured).

import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, watch } from 'node:fs';
import { join, basename } from 'node:path';
import { Input } from '../base.js';
import { createLogger } from '../logger.js';

export class BridgeInput extends Input {
  constructor(name, config) {
    super(name, config);
    this.path = config.path;
    this.completedDir = config.completedDir || null;
    this.log = createLogger(`bridge:${name}`);
    this._watcher = null;
    this._debounce = null;
    if (!this.path) throw new Error('BridgeInput requires config.path');
  }

  _readFile(file) {
    const filePath = join(this.path, file);
    const data = JSON.parse(readFileSync(filePath, 'utf-8'));

    // Normalize rone-bridge format to task format
    if (data.text && !data.summary) {
      data.summary = data.text.slice(0, 200);
    }
    if (data.classification && !data.type) {
      data.type = data.classification;
    }
    if (!data.id) {
      data.id = data.request_id || basename(file, '.json');
    }

    // Move to done/ (or completedDir)
    const doneDir = this.completedDir || join(this.path, 'done');
    if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });
    renameSync(filePath, join(doneDir, file));

    return data;
  }

  async poll() {
    if (!existsSync(this.path)) return [];

    const files = readdirSync(this.path).filter(f => f.endsWith('.json'));
    const tasks = [];

    for (const file of files) {
      try {
        tasks.push(this._readFile(file));
      } catch (err) {
        this.log.error('Failed to read file', { file, error: err.message });
      }
    }

    return tasks;
  }

  // Event-driven mode: watch directory for new .json files, invoke callback instantly
  async listen(callback) {
    if (!existsSync(this.path)) mkdirSync(this.path, { recursive: true });

    try {
      this._watcher = watch(this.path, (eventType, filename) => {
        if (!filename || !filename.endsWith('.json')) return;
        // Debounce: editors/writers may trigger multiple events per file
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => {
          const filePath = join(this.path, filename);
          if (!existsSync(filePath)) return; // Already processed or deleted
          try {
            const task = this._readFile(filename);
            callback(task);
          } catch (err) {
            this.log.error('Watch handler error', { file: filename, error: err.message });
          }
        }, 100);
      });
      this._watcher.on('error', () => {}); // Ignore watch errors (dir removed, etc.)
      this.log.info('Watching bridge directory', { path: this.path });
    } catch {
      this.log.warn('Could not watch bridge directory — falling back to poll mode');
    }
  }

  async stop() {
    if (this._watcher) {
      this._watcher.close();
      this._watcher = null;
    }
    clearTimeout(this._debounce);
  }

  // Write a result back to completedDir for upstream consumption
  writeResult(requestId, result) {
    if (!this.completedDir) return;
    if (!existsSync(this.completedDir)) mkdirSync(this.completedDir, { recursive: true });
    const outPath = join(this.completedDir, `${requestId}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
  }
}
