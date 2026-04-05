// Config loader — reads manager.yaml for a project.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Minimal YAML parser (no npm dependency).
// Handles: scalars, nested objects (any depth), lists with - prefix.
function parseYaml(text) {
  const lines = text.split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l.trim() && !l.trim().startsWith('#'));

  return parseBlock(lines, 0).value;
}

function parseBlock(lines, startIdx) {
  const result = {};
  let i = startIdx;
  const baseIndent = lines[i] ? lines[i].length - lines[i].trimStart().length : 0;

  while (i < lines.length) {
    const line = lines[i];
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent < baseIndent) break; // Dedented — parent scope
    if (indent > baseIndent) { i++; continue; } // Skip — already consumed by child

    if (trimmed.startsWith('- ')) {
      // List at this level — caller handles
      break;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) { i++; continue; }

    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (val) {
      result[key] = parseValue(val);
      i++;
    } else {
      // Check what follows: list or nested object?
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1];
        const nextIndent = nextLine.length - nextLine.trimStart().length;
        const nextTrimmed = nextLine.trim();

        if (nextIndent > indent && nextTrimmed.startsWith('- ')) {
          // List
          const list = [];
          let j = i + 1;
          const listIndent = nextIndent;
          while (j < lines.length) {
            const ll = lines[j];
            const li = ll.length - ll.trimStart().length;
            if (li < listIndent) break;
            const lt = ll.trim();
            if (li === listIndent && lt.startsWith('- ')) {
              const itemText = lt.slice(2).trim();
              const itemColonIdx = itemText.indexOf(':');
              if (itemColonIdx !== -1 && itemText.slice(itemColonIdx + 1).trim()) {
                // "- key: value" — start of an object item
                const obj = {};
                const k = itemText.slice(0, itemColonIdx).trim();
                obj[k] = parseValue(itemText.slice(itemColonIdx + 1).trim());
                // Collect subsequent indented lines as more keys
                j++;
                while (j < lines.length) {
                  const ol = lines[j];
                  const oi = ol.length - ol.trimStart().length;
                  const ot = ol.trim();
                  if (oi <= listIndent) break;
                  const oc = ot.indexOf(':');
                  if (oc !== -1) {
                    obj[ot.slice(0, oc).trim()] = parseValue(ot.slice(oc + 1).trim());
                  }
                  j++;
                }
                list.push(obj);
              } else if (itemColonIdx !== -1 && !itemText.slice(itemColonIdx + 1).trim()) {
                // "- key:" with nested block below — object item with nested children
                const obj = {};
                const k = itemText.slice(0, itemColonIdx).trim();
                if (j + 1 < lines.length) {
                  const child = parseBlock(lines, j + 1);
                  obj[k] = child.value;
                  j = child.nextIdx;
                } else {
                  obj[k] = {};
                  j++;
                }
                list.push(obj);
              } else {
                // Simple scalar list item
                list.push(parseValue(itemText));
                j++;
              }
            } else {
              j++;
            }
          }
          result[key] = list;
          i = j;
        } else if (nextIndent > indent) {
          // Nested object
          const child = parseBlock(lines, i + 1);
          result[key] = child.value;
          i = child.nextIdx;
        } else {
          result[key] = {};
          i++;
        }
      } else {
        result[key] = {};
        i++;
      }
    }
  }

  return { value: result, nextIdx: i };
}

function parseValue(val) {
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val === 'null') return null;
  // Strip surrounding quotes (preserves inner content as string)
  if ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
  return val;
}

export function validateConfig(config) {
  const errors = [];

  if (!config.name) errors.push('Missing required field: name');
  if (config.interval !== undefined && (typeof config.interval !== 'number' || config.interval < 1000)) {
    errors.push('interval must be a number >= 1000 (ms)');
  }
  if (config.maxRetries !== undefined && (typeof config.maxRetries !== 'number' || config.maxRetries < 0)) {
    errors.push('maxRetries must be a non-negative number');
  }
  if (config.dedupWindow !== undefined && (typeof config.dedupWindow !== 'number' || config.dedupWindow < 0)) {
    errors.push('dedupWindow must be a non-negative number (ms)');
  }
  if (config.maxHistory !== undefined && (typeof config.maxHistory !== 'number' || config.maxHistory < 1)) {
    errors.push('maxHistory must be a positive number');
  }
  if (config.logFormat !== undefined && !['json', 'text'].includes(config.logFormat)) {
    errors.push('logFormat must be "json" or "text"');
  }

  // Validate component sections have type fields
  for (const section of ['monitors', 'inputs', 'verifiers', 'workers', 'notifiers']) {
    if (config[section] && typeof config[section] === 'object') {
      for (const [name, cfg] of Object.entries(config[section])) {
        if (!cfg || typeof cfg !== 'object') {
          errors.push(`${section}.${name}: must be an object with at least a type field`);
        }
      }
    }
  }

  return errors;
}

// Resolve ${VAR} and ${VAR:-default} in string values from process.env
export function interpolateEnv(obj) {
  if (typeof obj === 'string') {
    return obj.replace(/\$\{([^}]+)\}/g, (match, expr) => {
      const sepIdx = expr.indexOf(':-');
      if (sepIdx !== -1) {
        const varName = expr.slice(0, sepIdx);
        const fallback = expr.slice(sepIdx + 2);
        return process.env[varName] ?? fallback;
      }
      return process.env[expr] ?? match; // leave unresolved if env var not set
    });
  }
  if (Array.isArray(obj)) return obj.map(v => interpolateEnv(v));
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(obj)) result[k] = interpolateEnv(v);
    return result;
  }
  return obj;
}

export function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const text = readFileSync(configPath, 'utf-8');
  const config = interpolateEnv(parseYaml(text));

  const errors = validateConfig(config);
  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
  }

  return config;
}

export function loadProjectConfig(configDir, projectName) {
  const configPath = join(configDir, `${projectName}.yaml`);
  return loadConfig(configPath);
}
