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
          while (j < lines.length) {
            const ll = lines[j];
            const li = ll.length - ll.trimStart().length;
            if (li <= indent) break;
            if (ll.trim().startsWith('- ')) {
              list.push(parseValue(ll.trim().slice(2).trim()));
            }
            j++;
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
  if (/^\d+$/.test(val)) return parseInt(val, 10);
  if (/^\d+\.\d+$/.test(val)) return parseFloat(val);
  return val;
}

export function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`Config not found: ${configPath}`);
  }
  const text = readFileSync(configPath, 'utf-8');
  return parseYaml(text);
}

export function loadProjectConfig(configDir, projectName) {
  const configPath = join(configDir, `${projectName}.yaml`);
  return loadConfig(configPath);
}
