const { normalizeSnapshotStatus } = require('../snapshot-state-machine');

function normalizeRepoRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (['frontend', 'backend', 'bff', 'shared_lib', 'test_automation', 'infra'].includes(role)) {
    return role;
  }
  if (['service', 'server', 'api', 'application', 'core'].includes(role)) {
    return 'backend';
  }
  if (['frontend_view', 'frontend_app', 'web', 'client'].includes(role)) {
    return 'frontend';
  }
  if (['shared', 'lib', 'common'].includes(role)) {
    return 'shared_lib';
  }
  if (['test', 'qa', 'automation'].includes(role)) {
    return 'test_automation';
  }
  return 'unknown';
}

module.exports = {
  normalizeRepoRole,
  normalizeSnapshotStatus,
};
