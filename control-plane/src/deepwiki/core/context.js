const fs = require('fs');
const path = require('path');
const { FileStore } = require('./storage/file-store');
const {
  assertTransition,
  normalizeSnapshotStatus,
} = require('../snapshot-state-machine');

class PipelineContext {
  constructor(rootDir, config) {
    this.rootDir = rootDir;
    this.config = config;
    this.store = new FileStore(rootDir);
    this.status = normalizeSnapshotStatus(config.status, 'queued');
    this.lineage = [];
  }

  static fromConfigFile(configPath) {
    const rootDir = process.cwd();
    const fullPath = path.resolve(rootDir, configPath);
    const config = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    return new PipelineContext(rootDir, config);
  }

  asset(assetKey) {
    const env = this.store.readAsset(this.config.snapshotId, assetKey);
    return env ? env.payload : null;
  }

  save(stageKey, assetKey, payload, extras = {}) {
    this.store.saveAsset(this.config.snapshotId, assetKey, stageKey, payload, extras);
    const found = this.lineage.find((item) => item.stageKey === stageKey);
    if (found) {
      found.assets.push(assetKey);
      return;
    }
    this.lineage.push({ stageKey, assets: [assetKey] });
  }

  saveMeta(key, payload) {
    return this.store.saveMeta(this.config.snapshotId, key, payload);
  }

  meta(key) {
    return this.store.readMeta(this.config.snapshotId, key);
  }

  transitionTo(nextStatus, context = {}) {
    assertTransition(this.status, nextStatus, {
      ...this.config,
      ...context,
      status: this.status,
    });
    this.status = normalizeSnapshotStatus(nextStatus, this.status);
    return this.status;
  }
}

module.exports = {
  PipelineContext,
};
