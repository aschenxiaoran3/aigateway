const fs = require('fs');
const path = require('path');

class FileStore {
  constructor(root) {
    this.root = root;
  }

  ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  snapshotRoot(snapshotId) {
    const dir = path.join(this.root, '.deepwiki', 'snapshots', String(snapshotId || 'unknown'));
    this.ensureDir(dir);
    return dir;
  }

  snapshotAssetDir(snapshotId) {
    const dir = path.join(this.snapshotRoot(snapshotId), 'assets');
    this.ensureDir(dir);
    return dir;
  }

  saveAsset(snapshotId, assetKey, stageKey, payload, extras = {}) {
    const env = {
      assetKey,
      stageKey,
      snapshotId: String(snapshotId || ''),
      schemaVersion: '0.1.0',
      createdAt: new Date().toISOString(),
      ...extras,
      payload,
    };
    const file = path.join(this.snapshotAssetDir(snapshotId), `${assetKey}.json`);
    fs.writeFileSync(file, JSON.stringify(env, null, 2), 'utf8');
    return env;
  }

  readAsset(snapshotId, assetKey) {
    const file = path.join(this.snapshotAssetDir(snapshotId), `${assetKey}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }

  listAssets(snapshotId) {
    const dir = this.snapshotAssetDir(snapshotId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
  }

  saveMeta(snapshotId, key, payload) {
    const file = path.join(this.snapshotRoot(snapshotId), `${key}.json`);
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  readMeta(snapshotId, key) {
    const file = path.join(this.snapshotRoot(snapshotId), `${key}.json`);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
}

module.exports = {
  FileStore,
};
