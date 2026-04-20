const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function normalizeDir(value) {
  const text = String(value || '').trim();
  return text ? path.resolve(text) : '';
}

function uniquePaths(values) {
  const seen = new Set();
  const list = [];
  for (const value of values) {
    const resolved = normalizeDir(value);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    list.push(resolved);
  }
  return list;
}

function loadFile(filePath, loaded, logger) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  dotenv.config({ path: filePath });
  loaded.push(filePath);
  logger?.debug?.('loaded env file', { path: filePath });
}

function loadProjectEnv(options = {}) {
  const serviceDir = normalizeDir(options.serviceDir || process.cwd());
  const projectRoot = normalizeDir(options.projectRoot || serviceDir);
  const logger = options.logger;
  const candidateFiles = uniquePaths([
    path.join(serviceDir, '.env'),
    path.join(serviceDir, '.env.local'),
    path.join(projectRoot, '.env.shared'),
    path.join(projectRoot, '.env.shared.local'),
  ]);
  const loaded = [];
  for (const filePath of candidateFiles) {
    loadFile(filePath, loaded, logger);
  }
  return loaded;
}

module.exports = {
  loadProjectEnv,
};
