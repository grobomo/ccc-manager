// Shared command execution helper for monitors (ProcessMonitor, CronMonitor).
// Runs a shell command, returns structured result with truncated preview.

import { execSync } from 'node:child_process';

export function execCommand(command, timeout = 30000) {
  const cmdPreview = command.length > 80 ? command.slice(0, 77) + '...' : command;
  try {
    execSync(command, { stdio: 'pipe', timeout });
    return { success: true, cmdPreview };
  } catch (err) {
    return {
      success: false,
      cmdPreview,
      exitCode: err.status,
      stderr: err.stderr?.toString().slice(0, 500) || '',
    };
  }
}
