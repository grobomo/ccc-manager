// AlertInput — in-memory queue that monitors push alerts into.
// poll() drains the queue. Used for monitor→dispatcher pipeline.

import { Input } from '../base.js';

export class AlertInput extends Input {
  constructor(name, config) {
    super(name, config);
    this._queue = [];
  }

  push(alert) {
    this._queue.push(alert);
  }

  async poll() {
    const alerts = this._queue.splice(0);
    return alerts;
  }
}
