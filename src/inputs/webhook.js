// WebhookInput — HTTP POST endpoint for external CI/CD triggers.
// Receives JSON task payloads, queues them via callback.
// Config: { port, path, secret }

import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { Input } from '../base.js';

export class WebhookInput extends Input {
  constructor(name, config) {
    super(name, config);
    this.port = config.port || 9090;
    this.path = config.path || '/webhook';
    this.secret = config.secret || null;
    this.server = null;
    this._queue = [];
  }

  async poll() {
    const tasks = this._queue.splice(0);
    return tasks;
  }

  async listen(callback) {
    this.server = createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== this.path) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        // Validate HMAC signature if secret configured
        if (this.secret) {
          const sig = req.headers['x-signature'] || '';
          const expected = createHmac('sha256', this.secret).update(body).digest('hex');
          if (sig !== expected) {
            res.writeHead(403);
            res.end(JSON.stringify({ error: 'Invalid signature' }));
            return;
          }
        }

        try {
          const task = JSON.parse(body);
          task.id = task.id || `webhook-${Date.now()}`;
          task.source = `webhook:${this.name}`;
          this._queue.push(task);
          if (callback) callback(task);
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ accepted: true, taskId: task.id }));
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
    });

    await new Promise(resolve => {
      this.server.listen(this.port, () => {
        console.log(`[webhook:${this.name}] Listening on :${this.port}${this.path}`);
        resolve();
      });
    });
  }

  async stop() {
    if (this.server) {
      await new Promise(r => this.server.close(r));
      this.server = null;
    }
  }
}
