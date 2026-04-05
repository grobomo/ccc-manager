// Write Set Validation — prevents parallel tasks from modifying the same files.
// Analyzes task write sets and adds dependsOn edges where overlaps exist.
// The existing dispatch() in base.js already respects dependsOn.

// Check if two patterns overlap. Supports exact match and simple glob (* suffix).
function patternsOverlap(a, b) {
  a = a.replace(/\\/g, '/');
  b = b.replace(/\\/g, '/');
  if (a === b) return true;
  if (a.includes('*') || b.includes('*')) {
    return globMatch(a, b) || globMatch(b, a);
  }
  return false;
}

// Simple glob matching: * (any chars except /) and ** (any path segment)
function globMatch(pattern, target) {
  if (!pattern.includes('*')) return pattern === target;
  const regexStr = pattern
    .replace(/\*\*/g, '<<DOUBLESTAR>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<DOUBLESTAR>>/g, '.*')
    .replace(/\//g, '\/');
  try {
    return new RegExp(`^${regexStr}$`).test(target);
  } catch {
    return pattern === target;
  }
}

// Check if two write sets have any overlapping patterns.
function writeSetsOverlap(setA, setB) {
  if (!setA?.length || !setB?.length) return false;
  for (const a of setA) {
    for (const b of setB) {
      if (patternsOverlap(a, b)) return true;
    }
  }
  return false;
}

// Validate and annotate a plan with dependsOn edges where write sets overlap.
// Returns a new plan (does not mutate the input).
export function validateWriteSets(plan) {
  if (!plan?.tasks?.length) return plan;
  const tasks = plan.tasks.map(t => ({ ...t, dependsOn: [...(t.dependsOn || [])] }));
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      if (writeSetsOverlap(tasks[i].writeSet, tasks[j].writeSet)) {
        if (!tasks[j].dependsOn.includes(tasks[i].id)) {
          tasks[j].dependsOn.push(tasks[i].id);
        }
      }
    }
  }
  return { ...plan, tasks };
}

// Analyze a plan and return a report of overlaps (for logging/debugging).
export function analyzeWriteSets(plan) {
  if (!plan?.tasks?.length) return { overlaps: [], maxParallel: 0, totalTasks: 0 };
  const overlaps = [];
  for (let i = 0; i < plan.tasks.length; i++) {
    for (let j = i + 1; j < plan.tasks.length; j++) {
      const a = plan.tasks[i];
      const b = plan.tasks[j];
      if (writeSetsOverlap(a.writeSet, b.writeSet)) {
        const shared = [];
        for (const pa of (a.writeSet || [])) {
          for (const pb of (b.writeSet || [])) {
            if (patternsOverlap(pa, pb)) shared.push(pa === pb ? pa : `${pa} ∩ ${pb}`);
          }
        }
        overlaps.push({ taskA: a.id, taskB: b.id, sharedFiles: shared });
      }
    }
  }
  const serialized = new Set();
  for (const o of overlaps) serialized.add(o.taskB);
  return { overlaps, maxParallel: plan.tasks.length - serialized.size, totalTasks: plan.tasks.length };
}

export { patternsOverlap, writeSetsOverlap, globMatch };
