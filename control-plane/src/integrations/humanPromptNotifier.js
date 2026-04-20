const axios = require('axios');

function normalizeText(value) {
  return String(value || '').trim();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(Number(ms) || 0, 0)));
}

function shouldRetry(error) {
  const status = Number(error?.response?.status || 0);
  if (!status) {
    return true;
  }
  return status === 408 || status === 429 || status >= 500;
}

function buildErrorDetails(error) {
  const status = Number(error?.response?.status || 0);
  const body = error?.response?.data;
  if (status) {
    return `${status} ${JSON.stringify(body || {})}`.trim();
  }
  const code = normalizeText(error?.code);
  return [code, normalizeText(error?.message)].filter(Boolean).join(' ').trim() || 'unknown_error';
}

function getNotifierConfig() {
  const enabledRaw = normalizeText(process.env.HARNESS_NOTIFY_ENABLED).toLowerCase();
  return {
    enabled: !['false', '0', 'off', 'no'].includes(enabledRaw),
    url: normalizeText(
      process.env.HUMAN_PROMPT_NOTIFY_URL || 'http://127.0.0.1:3001/api/v1/internal/notifications/human-prompts'
    ),
    token: normalizeText(process.env.HARNESS_NOTIFY_TOKEN),
    timeoutMs: Number(process.env.HARNESS_NOTIFY_TIMEOUT_MS || 5000),
    retryCount: Math.min(Math.max(Number(process.env.HARNESS_NOTIFY_RETRY_COUNT || 2), 0), 5),
    retryDelayMs: Math.max(Number(process.env.HARNESS_NOTIFY_RETRY_DELAY_MS || 800), 0),
  };
}

function createHumanPromptNotifier({ logger } = {}) {
  async function notify(payload) {
    const config = getNotifierConfig();
    if (!config.enabled || !config.url) {
      return { delivered: false, skipped: true, reason: 'disabled' };
    }
    let lastError = null;
    for (let attempt = 0; attempt <= config.retryCount; attempt += 1) {
      try {
        const response = await axios.post(config.url, payload, {
          timeout: config.timeoutMs,
          headers: {
            'content-type': 'application/json',
            ...(config.token ? { 'x-internal-token': config.token } : {}),
          },
        });
        if (attempt > 0) {
          logger?.info?.('human prompt notification recovered after retry', {
            attempts: attempt + 1,
            url: config.url,
            prompt_code: payload?.prompt?.prompt_code,
          });
        }
        return response.data?.data || { delivered: false };
      } catch (error) {
        lastError = error;
        const details = buildErrorDetails(error);
        const retryable = shouldRetry(error);
        logger?.warn?.('human prompt notification delivery failed', {
          attempt: attempt + 1,
          max_attempts: config.retryCount + 1,
          retryable,
          error: details,
          url: config.url,
          prompt_code: payload?.prompt?.prompt_code,
        });
        if (!retryable || attempt >= config.retryCount) {
          break;
        }
        await wait(config.retryDelayMs * (attempt + 1));
      }
    }
    return {
      delivered: false,
      skipped: false,
      error: buildErrorDetails(lastError),
    };
  }

  return {
    notify,
    isEnabled() {
      return Boolean(getNotifierConfig().enabled && getNotifierConfig().url);
    },
  };
}

module.exports = {
  createHumanPromptNotifier,
};
