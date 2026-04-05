// ClaudeDispatcher — AI-powered spec generation via `claude -p`.
// Calls Claude CLI to analyze issues and produce structured repair plans.
// Falls back to SHTDDispatcher-style plan if Claude is unavailable.

import { execSync } from 'node:child_process';
import { Dispatcher } from '../base.js';

export class ClaudeDispatcher extends Dispatcher {
  constructor(config) {
    super(config);
    this.projectDir = config.projectDir || '.';
    this.model = config.model || undefined; // Use default
    this.timeout = config.timeout || 60000;
    this.claudePath = config.claudePath || 'claude';
    this.maxPromptLen = config.maxPromptLen || 4000;
  }

  _buildPrompt(issue) {
    const parts = [
      'You are an automated repair system. Analyze this issue and produce a JSON repair plan.',
      '',
      '## Issue',
      `Summary: ${issue.summary}`,
      `Severity: ${issue.severity || 'unknown'}`,
      `Source: ${issue.source || 'unknown'}`,
    ];

    if (issue.details) {
      parts.push('', '## Details');
      if (typeof issue.details === 'string') {
        parts.push(issue.details);
      } else {
        parts.push(JSON.stringify(issue.details, null, 2));
      }
    }

    parts.push(
      '',
      '## Required Output Format',
      'Respond with ONLY a JSON object, no markdown fences:',
      '{',
      '  "title": "Brief fix title",',
      '  "tasks": [',
      '    { "type": "investigate|fix|verify", "summary": "What to do", "command": "shell command or null" }',
      '  ]',
      '}',
      '',
      'Rules:',
      '- Each task must have type, summary, and command (null if manual investigation)',
      '- Keep commands safe — no rm -rf, no force operations',
      '- Prefer diagnostic commands first, then targeted fixes',
    );

    const prompt = parts.join('\n');
    return prompt.slice(0, this.maxPromptLen);
  }

  _parseResponse(raw) {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // Try to extract JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.tasks || !Array.isArray(parsed.tasks)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async analyze(issue) {
    const specId = `repair-${Date.now()}`;
    const prompt = this._buildPrompt(issue);

    let aiPlan = null;
    try {
      const args = [this.claudePath, '-p', JSON.stringify(prompt), '--output-format', 'text'];
      if (this.model) args.splice(1, 0, '--model', this.model);

      const raw = execSync(args.join(' '), {
        stdio: 'pipe',
        timeout: this.timeout,
        cwd: this.projectDir,
        shell: true,
        env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'ccc-manager' }
      }).toString();

      aiPlan = this._parseResponse(raw);
      if (aiPlan) {
        console.log(`[claude-dispatcher] AI generated ${aiPlan.tasks.length} task(s) for: ${issue.summary}`);
      }
    } catch (err) {
      console.warn(`[claude-dispatcher] Claude unavailable (${err.message}), using fallback`);
    }

    // Build task list — from AI or fallback
    const tasks = [];
    if (aiPlan) {
      for (let i = 0; i < aiPlan.tasks.length; i++) {
        const t = aiPlan.tasks[i];
        tasks.push({
          id: `${specId}-T${String(i + 1).padStart(3, '0')}`,
          type: t.type || 'fix',
          summary: t.summary,
          command: t.command || null,
          issue
        });
      }
    } else {
      // Fallback: same as SHTDDispatcher
      tasks.push({
        id: `${specId}-T001`,
        type: 'investigate',
        summary: `Investigate: ${issue.summary}`,
        command: null,
        issue
      });
      if (issue.details?.command) {
        tasks.push({
          id: `${specId}-T002`,
          type: 'verify',
          summary: `Verify fix: re-run ${issue.details.command}`,
          command: issue.details.command,
          issue
        });
      }
    }

    return {
      spec: {
        id: specId,
        title: aiPlan?.title || `Fix: ${issue.summary}`,
        severity: issue.severity,
        createdAt: Date.now(),
        aiGenerated: !!aiPlan
      },
      tasks,
      branch: `fix/${specId}`,
      issue
    };
  }

  // dispatch() inherited from Dispatcher base class
}
