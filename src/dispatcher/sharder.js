// Sharder — splits a high-level task into discrete work units across dimensions.
//
// Given a task with sharding dimensions (time ranges, data sources, analysis types, etc.)
// and a worker count, produces N work units that can be distributed to workers in parallel.
//
// Strategies:
//   'cartesian' — every combination of dimension values (N × M × P units)
//   'round-robin' — distribute dimension combos evenly across worker count
//   'chunk' — split a single dimension into N chunks (e.g., time range → N sub-ranges)

export class Sharder {
  /**
   * @param {Object} options
   * @param {string} options.strategy - 'cartesian' | 'round-robin' | 'chunk'
   * @param {Object} options.dimensions - { dimName: [values] | { start, end, step } }
   * @param {number} [options.maxUnits] - Cap total work units (safety limit)
   */
  constructor(options = {}) {
    this.strategy = options.strategy || 'cartesian';
    this.dimensions = options.dimensions || {};
    this.maxUnits = options.maxUnits || 1000;
  }

  /**
   * Expand a dimension spec into an array of values.
   * Accepts: array of values, or { start, end, step } for numeric/time ranges.
   */
  _expandDimension(spec) {
    if (Array.isArray(spec)) return spec;

    if (spec && typeof spec === 'object' && 'start' in spec && 'end' in spec) {
      const { start, end, step = 1 } = spec;
      const values = [];
      for (let v = start; v < end; v += step) {
        const chunkEnd = Math.min(v + step, end);
        values.push({ start: v, end: chunkEnd });
      }
      return values;
    }

    return [spec]; // Single value
  }

  /**
   * Compute cartesian product of all dimension value arrays.
   */
  _cartesian(arrays) {
    if (arrays.length === 0) return [{}];

    return arrays.reduce((acc, [dimName, values]) => {
      const result = [];
      for (const existing of acc) {
        for (const val of values) {
          result.push({ ...existing, [dimName]: val });
        }
      }
      return result;
    }, [{}]);
  }

  /**
   * Shard a task into work units.
   *
   * @param {Object} task - The high-level task to shard
   * @param {string} task.id - Task identifier
   * @param {string} task.summary - What to do
   * @param {Object} [task.dimensions] - Override dimensions from constructor
   * @param {number} [workerCount] - Number of available workers (used by round-robin/chunk)
   * @returns {Object[]} Array of work units: [{ unitId, taskId, dimensions, workerIndex }]
   */
  shard(task, workerCount = 1) {
    const dims = task.dimensions || this.dimensions;
    const dimNames = Object.keys(dims);

    if (dimNames.length === 0) {
      // No dimensions — single unit
      return [{
        unitId: `${task.id}-U001`,
        taskId: task.id,
        summary: task.summary,
        dimensions: {},
        workerIndex: 0
      }];
    }

    // Expand all dimensions
    const expanded = dimNames.map(name => [name, this._expandDimension(dims[name])]);

    let combos;
    if (this.strategy === 'chunk' && dimNames.length === 1) {
      // Chunk: split the single dimension into workerCount chunks
      combos = this._chunkSingle(expanded[0], workerCount);
    } else {
      // Cartesian product of all dimensions
      combos = this._cartesian(expanded);
    }

    // Safety cap
    if (combos.length > this.maxUnits) {
      combos = combos.slice(0, this.maxUnits);
    }

    // Assign worker indices
    const units = combos.map((dims, i) => ({
      unitId: `${task.id}-U${String(i + 1).padStart(3, '0')}`,
      taskId: task.id,
      summary: task.summary,
      dimensions: dims,
      workerIndex: i % Math.max(1, workerCount)
    }));

    return units;
  }

  /**
   * Chunk a single dimension into N groups.
   */
  _chunkSingle([dimName, values], workerCount) {
    const expanded = this._expandDimension(values);
    const n = Math.max(1, workerCount);
    const chunkSize = Math.ceil(expanded.length / n);
    const chunks = [];

    for (let i = 0; i < expanded.length; i += chunkSize) {
      const slice = expanded.slice(i, i + chunkSize);
      chunks.push({ [dimName]: slice });
    }

    return chunks;
  }
}

/**
 * Parallel dispatch — runs sharded work units across multiple workers concurrently.
 *
 * @param {Object[]} units - Work units from Sharder.shard()
 * @param {Object} workers - { name: Worker } map
 * @param {Object} [options]
 * @param {number} [options.concurrency] - Max parallel executions (default: units.length)
 * @param {Function} [options.buildCommand] - (unit) => command string for the worker
 * @returns {Promise<Object[]>} Results array: [{ unitId, success, output, error }]
 */
export async function parallelDispatch(units, workers, options = {}) {
  const workerList = Object.values(workers);
  if (workerList.length === 0) {
    return units.map(u => ({ unitId: u.unitId, success: true, output: 'No worker configured', skipped: true }));
  }

  const concurrency = options.concurrency || units.length;
  const buildCommand = options.buildCommand || (unit => unit.command || null);
  const results = [];
  let cursor = 0;

  // Process in batches of `concurrency`
  while (cursor < units.length) {
    const batch = units.slice(cursor, cursor + concurrency);
    const promises = batch.map(unit => {
      const worker = workerList[unit.workerIndex % workerList.length];
      const task = {
        id: unit.unitId,
        summary: unit.summary,
        command: buildCommand(unit),
        dimensions: unit.dimensions
      };

      return worker.execute(task).then(
        result => ({ unitId: unit.unitId, ...result }),
        err => ({ unitId: unit.unitId, success: false, error: err.message })
      );
    });

    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
    cursor += concurrency;
  }

  return results;
}

/**
 * Aggregate results from parallel dispatch into a summary.
 *
 * @param {Object[]} results - Results from parallelDispatch()
 * @param {Object} [options]
 * @param {Function} [options.merge] - Custom merge function (results => merged)
 * @returns {Object} { total, succeeded, failed, results, merged? }
 */
export function aggregateResults(results, options = {}) {
  const succeeded = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);

  const summary = {
    total: results.length,
    succeeded: succeeded.length,
    failed: failedResults.length,
    status: failedResults.length === 0 ? 'completed' : (succeeded.length > 0 ? 'partial' : 'failed'),
    results
  };

  if (options.merge && typeof options.merge === 'function') {
    summary.merged = options.merge(succeeded);
  }

  return summary;
}
