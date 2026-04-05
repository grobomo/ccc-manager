// CronMonitor — runs a command on an independent cron-like schedule.
// Config: { command, schedule: '*/5 * * * *', timeout }
// schedule format: 'minute hour dayOfMonth month dayOfWeek' (simplified cron)
// Supports: *, */N (every N), specific numbers, comma-separated lists.

import { Monitor } from '../base.js';
import { execCommand } from './exec-helper.js';

export class CronMonitor extends Monitor {
  constructor(name, config) {
    super(name, config);
    this.command = config.command;
    this.schedule = config.schedule || '* * * * *'; // Every minute
    if (!this.command) throw new Error('CronMonitor requires config.command');
    this._lastRun = 0;
    this._fields = parseCron(this.schedule);
  }

  async check() {
    // Only run if the current minute matches the cron schedule
    const now = new Date();
    if (!matchesCron(now, this._fields)) return [];

    // Avoid running twice in the same minute
    const minuteKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (this._lastRunKey === minuteKey) return [];
    this._lastRunKey = minuteKey;

    const result = execCommand(this.command, this.config.timeout || 30000);
    if (result.success) return [];
    return [{
      severity: this.config.severity || 'high',
      summary: `Cron check failed: ${result.cmdPreview}`,
      details: {
        exitCode: result.exitCode,
        stderr: result.stderr,
        command: this.command,
        schedule: this.schedule
      }
    }];
  }
}

// Parse a cron expression into structured fields.
// Format: minute hour dayOfMonth month dayOfWeek
export function parseCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Invalid cron expression: ${expr} (need 5 fields)`);
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6), // 0=Sunday
  };
}

function parseField(field, min, max) {
  if (field === '*') return null; // Match all

  // */N — every N
  const stepMatch = field.match(/^\*\/(\d+)$/);
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10);
    if (step < 1 || step > max) throw new Error(`Invalid step: ${field}`);
    const values = [];
    for (let i = min; i <= max; i += step) values.push(i);
    return new Set(values);
  }

  // Comma-separated values and ranges
  const values = new Set();
  for (const part of field.split(',')) {
    const rangeMatch = part.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      values.add(parseInt(part, 10));
    }
  }
  return values;
}

export function matchesCron(date, fields) {
  const checks = [
    [fields.minute, date.getMinutes()],
    [fields.hour, date.getHours()],
    [fields.dayOfMonth, date.getDate()],
    [fields.month, date.getMonth() + 1],
    [fields.dayOfWeek, date.getDay()],
  ];
  return checks.every(([allowed, value]) => allowed === null || allowed.has(value));
}
