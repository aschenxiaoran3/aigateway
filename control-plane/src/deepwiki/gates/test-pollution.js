function hasTestPollution(evidence, visiblePayloads = []) {
  const list = Array.isArray(evidence) ? evidence : [];
  const visible = Array.isArray(visiblePayloads) ? visiblePayloads : [visiblePayloads];
  const containsTestMarker = (value) => /test|spec|fixture|mockmvc|__tests__/i.test(String(value || ''));
  if (list.some((item) => containsTestMarker(item.source || item.source_uri || item.title || item.label))) {
    return true;
  }
  return visible.some((item) => containsTestMarker(typeof item === 'string' ? item : JSON.stringify(item || {})));
}

module.exports = {
  hasTestPollution,
};
