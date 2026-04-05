// TestSuiteVerifier — runs a shell command to verify fixes.
// Pass = exit code 0. Fail = anything else.

import { execSync } from 'node:child_process';
import { Verifier } from '../base.js';

export class TestSuiteVerifier extends Verifier {
  constructor(name, config) {
    super(name, config);
    this.command = config.command;
    if (!this.command) throw new Error('TestSuiteVerifier requires config.command');
  }

  async verify(task, result) {
    try {
      const output = execSync(this.command, {
        stdio: 'pipe',
        timeout: this.config.timeout || 60000
      }).toString();

      return { passed: true, details: output.slice(0, 1000) };
    } catch (err) {
      return {
        passed: false,
        details: `Command failed (exit ${err.status}): ${err.stderr?.toString().slice(0, 500) || err.message}`
      };
    }
  }
}
