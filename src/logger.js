// Logger — structured output for production (JSON) and dev (human-readable).
// Usage: import { createLogger } from './logger.js';
//        const log = createLogger('manager', { json: true });
//        log.info('Started', { components: 14 });

export function createLogger(component, options = {}) {
  const json = options.json ?? (process.env.CCC_LOG_FORMAT === 'json');
  const level = options.level ?? (process.env.CCC_LOG_LEVEL || 'info');
  const levels = { debug: 0, info: 1, warn: 2, error: 3 };
  const minLevel = levels[level] ?? 1;

  function emit(lvl, msg, data) {
    if ((levels[lvl] ?? 1) < minLevel) return;
    if (json) {
      const entry = {
        ts: new Date().toISOString(),
        level: lvl,
        component,
        msg,
        ...data
      };
      process.stderr.write(JSON.stringify(entry) + '\n');
    } else {
      const prefix = `[${component}]`;
      const extra = data && Object.keys(data).length > 0
        ? ' ' + Object.entries(data).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ')
        : '';
      const stream = lvl === 'error' || lvl === 'warn' ? process.stderr : process.stdout;
      stream.write(`${prefix} ${msg}${extra}\n`);
    }
  }

  return {
    debug: (msg, data) => emit('debug', msg, data),
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
  };
}
