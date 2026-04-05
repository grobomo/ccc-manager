// BridgeInput — polls a directory for .json task files.
// Used by rone-teams-poller to send SELF_REPAIR tasks via PVC/git bridge.
// Processed files move to done/ (or completedDir if configured).

import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { Input } from '../base.js';
import { createLogger } from '../logger.js';

export class BridgeInput extends Input {
  constructor(name, config) {
    super(name, config);
    this.path = config.path;
    this.completedDir = config.completedDir || null;
    this.log = createLogger(`bridge:${name}`);
    if (!this.path) throw new Error('BridgeInput requires config.path');
  }

  async poll() {
    if (!existsSync(this.path)) return [];

    const files = readdirSync(this.path).filter(f => f.endsWith('.json'));
    const tasks = [];

    for (const file of files) {
      const filePath = join(this.path, file);
      try {
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

        tasks.push(data);

        // Move to done/ (or completedDir)
        const doneDir = this.completedDir || join(this.path, 'done');
        if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });
        renameSync(filePath, join(doneDir, file));
      } catch (err) {
        this.log.error('Failed to read file', { file, error: err.message });
      }
    }

    return tasks;
  }

  // Write a result back to completedDir for upstream consumption
  writeResult(requestId, result) {
    if (!this.completedDir) return;
    if (!existsSync(this.completedDir)) mkdirSync(this.completedDir, { recursive: true });
    const outPath = join(this.completedDir, `${requestId}.json`);
    writeFileSync(outPath, JSON.stringify(result, null, 2));
  }
}
