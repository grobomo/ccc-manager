// GitHubInput — poll GitHub issues with a specific label.
// Uses gh CLI (no npm dependency).

import { execSync } from 'node:child_process';
import { Input } from '../base.js';

export class GitHubInput extends Input {
  constructor(name, config) {
    super(name, config);
    this.repo = config.repo;
    this.label = config.label || 'self-repair';
    this._seen = new Set();
    if (!this.repo) throw new Error('GitHubInput requires config.repo');
  }

  _parseIssues(issues) {
    return issues.map(issue => ({
      id: `github-${issue.number}`,
      type: 'github-issue',
      summary: issue.title,
      details: {
        number: issue.number,
        body: issue.body,
        labels: issue.labels?.map(l => l.name) || [],
        repo: this.repo
      }
    }));
  }

  async poll() {
    try {
      const output = execSync(
        `gh issue list --repo ${JSON.stringify(this.repo)} --label ${JSON.stringify(this.label)} --state open --json number,title,body,labels`,
        { stdio: 'pipe', timeout: 30000 }
      ).toString();

      const issues = JSON.parse(output || '[]');
      const parsed = this._parseIssues(issues);

      const newIssues = parsed.filter(i => !this._seen.has(i.id));
      for (const i of newIssues) this._seen.add(i.id);

      return newIssues;
    } catch (err) {
      if (!err.message.includes('not found')) {
        console.error(`[github:${this.name}] Poll error: ${err.message}`);
      }
      return [];
    }
  }
}
