// BridgeInput — polls a directory for .json task files.
// Used by rone-teams-poller to send SELF_REPAIR tasks via PVC/git bridge.
// Processed files move to done/ subdirectory.

import { readdirSync, readFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Input } from '../base.js';

export class BridgeInput extends Input {
  constructor(name, config) {
    super(name, config);
    this.path = config.path;
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
        tasks.push(data);

        // Move to done/
        const doneDir = join(this.path, 'done');
        if (!existsSync(doneDir)) mkdirSync(doneDir, { recursive: true });
        renameSync(filePath, join(doneDir, file));
      } catch (err) {
        console.error(`[bridge] Failed to read ${file}: ${err.message}`);
      }
    }

    return tasks;
  }
}
