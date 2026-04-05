// LogMonitor — watch a log file for error patterns.
// Tracks read offset to only report new matches.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { Monitor } from '../base.js';

export class LogMonitor extends Monitor {
  constructor(name, config) {
    super(name, config);
    this.path = config.path;
    this.patterns = (config.patterns || ['ERROR']).map(p => new RegExp(p));
    this._offset = 0;
    if (!this.path) throw new Error('LogMonitor requires config.path');
  }

  async check() {
    if (!existsSync(this.path)) return [];

    const stat = statSync(this.path);
    if (stat.size <= this._offset) return [];

    const content = readFileSync(this.path, 'utf-8');
    const newContent = content.slice(this._offset);
    this._offset = content.length;

    const issues = [];
    for (const line of newContent.split('\n')) {
      if (!line.trim()) continue;
      for (const pattern of this.patterns) {
        const match = line.match(pattern);
        if (match) {
          issues.push({
            id: `log-${Date.now()}-${issues.length}`,
            severity: 'high',
            summary: match[1] || match[0],
            details: { line, pattern: pattern.source, file: this.path }
          });
          break;
        }
      }
    }

    return issues;
  }
}
