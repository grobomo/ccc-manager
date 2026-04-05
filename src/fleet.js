// FleetCoordinator — multi-manager coordination via shared filesystem.
// Each manager writes a heartbeat file to state/fleet/. Any manager can
// read the fleet directory to discover peers, check task ownership, and
// detect stale workers.
//
// No external service needed — just a shared directory (PVC in K8s, NFS, etc.)

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from './logger.js';

export class FleetCoordinator {
  constructor(options = {}) {
    this.stateDir = options.stateDir || 'state';
    this.workerId = options.workerId;
    this.staleThreshold = options.staleThreshold ?? 120000; // 2 minutes
    this.log = createLogger('fleet');
    if (!this.workerId) throw new Error('FleetCoordinator requires options.workerId');
  }

  _fleetDir() {
    const dir = join(this.stateDir, 'fleet');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  _peerPath(workerId) {
    const safeId = String(workerId).replace(/[^a-zA-Z0-9._-]/g, '_');
    return join(this._fleetDir(), `${safeId}.json`);
  }

  // Write/update this manager's heartbeat.
  heartbeat(data = {}) {
    const status = {
      workerId: this.workerId,
      startedAt: this._startedAt || Date.now(),
      lastHeartbeat: Date.now(),
      uptime: this._startedAt ? Date.now() - this._startedAt : 0,
      status: data.status || 'active',
      currentTasks: data.currentTasks || [],
      metrics: data.metrics || {},
    };
    if (!this._startedAt) this._startedAt = status.startedAt;
    writeFileSync(this._peerPath(this.workerId), JSON.stringify(status, null, 2));
    return status;
  }

  // Read all peer status files. Returns array of peer statuses.
  peers({ includeStale = false, includeSelf = false } = {}) {
    const dir = this._fleetDir();
    if (!existsSync(dir)) return [];
    const results = [];
    for (const file of readdirSync(dir).filter(f => f.endsWith('.json'))) {
      try {
        const peer = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
        if (!includeSelf && peer.workerId === this.workerId) continue;
        const age = Date.now() - (peer.lastHeartbeat || 0);
        peer._stale = age > this.staleThreshold;
        if (!includeStale && peer._stale) continue;
        results.push(peer);
      } catch { /* corrupted file — skip */ }
    }
    return results;
  }

  // Check if a task is currently owned by any active peer.
  isTaskOwnedByPeer(taskId) {
    for (const peer of this.peers()) {
      if (peer.currentTasks?.includes(taskId)) return peer.workerId;
    }
    return null;
  }

  // Return stale workers (heartbeat older than threshold).
  staleWorkers() {
    return this.peers({ includeStale: true }).filter(p => p._stale);
  }

  // Remove stale peer status files and return count.
  pruneStale() {
    const stale = this.staleWorkers();
    let pruned = 0;
    for (const peer of stale) {
      try {
        unlinkSync(this._peerPath(peer.workerId));
        pruned++;
        this.log.info('Pruned stale peer', { workerId: peer.workerId });
      } catch { /* already gone */ }
    }
    return pruned;
  }

  // Remove this manager's heartbeat file (on shutdown).
  deregister() {
    try {
      unlinkSync(this._peerPath(this.workerId));
      this.log.info('Deregistered from fleet', { workerId: this.workerId });
    } catch { /* already gone */ }
  }

  // Fleet status summary for health endpoint.
  status() {
    const allPeers = this.peers({ includeStale: true, includeSelf: true });
    const active = allPeers.filter(p => !p._stale);
    const stale = allPeers.filter(p => p._stale);
    return {
      totalPeers: allPeers.length,
      active: active.length,
      stale: stale.length,
      peers: allPeers.map(p => ({
        workerId: p.workerId,
        status: p._stale ? 'stale' : p.status,
        lastHeartbeat: p.lastHeartbeat,
        currentTasks: p.currentTasks,
      })),
    };
  }
}
