const axios = require('axios');

function normalizeText(value) {
  return String(value || '').trim();
}

function getNotifierConfig() {
  const enabledRaw = normalizeText(process.env.HARNESS_NOTIFY_ENABLED).toLowerCase();
  return {
    enabled: !['false', '0', 'off', 'no'].includes(enabledRaw),
    url: normalizeText(
      process.env.HARNESS_NOTIFY_URL || 'http://127.0.0.1:3001/api/v1/internal/notifications/harness'
    ),
    token: normalizeText(process.env.HARNESS_NOTIFY_TOKEN),
    timeoutMs: Number(process.env.HARNESS_NOTIFY_TIMEOUT_MS || 5000),
  };
}

function createHarnessNotifier({ logger } = {}) {
  async function notify(payload) {
    const config = getNotifierConfig();
    if (!config.enabled || !config.url) {
      return { delivered: false, skipped: true, reason: 'disabled' };
    }
    try {
      const response = await axios.post(config.url, payload, {
        timeout: config.timeoutMs,
        headers: {
          'content-type': 'application/json',
          ...(config.token ? { 'x-internal-token': config.token } : {}),
        },
      });
      return response.data?.data || { delivered: false };
    } catch (error) {
      logger?.warn?.('harness notification delivery failed', {
        error: error.message,
        url: config.url,
        event_type: payload?.event_type,
      });
      return { delivered: false, skipped: false, error: error.message };
    }
  }

  return {
    notify,
    isEnabled() {
      return Boolean(getNotifierConfig().enabled && getNotifierConfig().url);
    },
  };
}

module.exports = {
  createHarnessNotifier,
};
