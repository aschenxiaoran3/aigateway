/**
 * 系统设置 API
 */
const express = require('express');
const router = express.Router();
const db = require('../db/mysql');

const SECRET_KEYS = new Set([
  'deepwiki_weelinking_api_key',
  'deepwiki_codex_api_key',
  'deepwiki_devin_api_key',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function maskSecret(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= 6) return '******';
  return `${'*'.repeat(Math.max(6, text.length - 4))}${text.slice(-4)}`;
}

function getDefaultSettings() {
  return {
    gateway_port: Number(process.env.PORT || 3001),
    gateway_host: process.env.HOST || '0.0.0.0',
    db_host: process.env.DB_HOST || '',
    db_port: Number(process.env.DB_PORT || 3306),
    db_name: process.env.DB_NAME || '',
    db_user: process.env.DB_USER || '',
    log_level: process.env.LOG_LEVEL || 'info',
    log_max_files: 5,
    log_max_size: 10,
    default_quota_daily: 100000,
    default_quota_monthly: 3000000,
    enable_rate_limit: true,
    enable_audit_log: true,
    enable_cost_tracking: true,
    deepwiki_default_provider: process.env.DEEPWIKI_DEFAULT_PROVIDER || 'qwen_dashscope_native',
    deepwiki_default_model: process.env.DEEPWIKI_DEFAULT_MODEL || '',
    deepwiki_qwen_enabled: true,
    deepwiki_weelinking_enabled: Boolean(
      process.env.DEEPWIKI_WEELINKING_API_KEY || process.env.WEELINKING_API_KEY
    ),
    deepwiki_codex_enabled: Boolean(
      process.env.DEEPWIKI_CODEX_API_KEY || process.env.OPENAI_API_KEY
    ),
    deepwiki_qwen_default_model: process.env.DEEPWIKI_QWEN_DEFAULT_MODEL || 'qwen-deep-research',
    deepwiki_weelinking_default_model: process.env.DEEPWIKI_WEELINKING_DEFAULT_MODEL || 'deep-research',
    deepwiki_codex_default_model: process.env.DEEPWIKI_CODEX_DEFAULT_MODEL || 'gpt-5.4',
    deepwiki_weelinking_base_url:
      process.env.DEEPWIKI_WEELINKING_BASE_URL ||
      process.env.WEELINKING_BASE_URL ||
      'https://api.weelinking.com',
    deepwiki_weelinking_wire_mode: process.env.DEEPWIKI_WEELINKING_WIRE_MODE || 'openai_responses_compatible',
    deepwiki_weelinking_api_key: '',
    deepwiki_codex_base_url:
      process.env.DEEPWIKI_CODEX_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://api.openai.com',
    deepwiki_codex_api_key: '',
    deepwiki_devin_enabled: Boolean(
      process.env.DEEPWIKI_DEVIN_API_KEY || process.env.DEVIN_API_KEY
    ),
    deepwiki_devin_base_url:
      process.env.DEEPWIKI_DEVIN_BASE_URL ||
      process.env.DEVIN_BASE_URL ||
      'https://api.devin.ai',
    deepwiki_devin_api_key: '',
    deepwiki_devin_auto_sync_on_publish: false,
    deepwiki_devin_playbook_id: process.env.DEEPWIKI_DEVIN_PLAYBOOK_ID || '',
    deepwiki_devin_knowledge_ids: process.env.DEEPWIKI_DEVIN_KNOWLEDGE_IDS || '',
    deepwiki_devin_max_acu_limit: Number(process.env.DEEPWIKI_DEVIN_MAX_ACU_LIMIT || 0) || undefined,
    deepwiki_devin_unlisted: true,
    deepwiki_diagram_provider_strategy: process.env.DEEPWIKI_DIAGRAM_PROVIDER_STRATEGY || 'default',
  };
}

function buildPublicSettings(defaults, dbSettings) {
  const merged = {
    ...defaults,
    ...dbSettings,
  };
  return {
    ...merged,
    deepwiki_weelinking_api_key: maskSecret(merged.deepwiki_weelinking_api_key),
    deepwiki_codex_api_key: maskSecret(merged.deepwiki_codex_api_key),
    deepwiki_devin_api_key: maskSecret(merged.deepwiki_devin_api_key),
  };
}

function mergeSecretPayload(payload, existing) {
  const next = { ...payload };
  SECRET_KEYS.forEach((key) => {
    if (!(key in next)) return;
    const incoming = normalizeText(next[key]);
    if (!incoming) {
      delete next[key];
      return;
    }
    const maskedExisting = maskSecret(existing[key]);
    if (incoming === maskedExisting) {
      delete next[key];
    }
  });
  return next;
}

router.get('/', async (req, res) => {
  try {
    const dbSettings = await db.getSettings();
    res.json({
      success: true,
      data: buildPublicSettings(getDefaultSettings(), dbSettings),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to get settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get settings'
    });
  }
});

router.put('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const existing = await db.getSettings();
    const mergedPayload = mergeSecretPayload(payload, existing);
    await db.upsertSettings(mergedPayload);
    const latest = await db.getSettings();
    res.json({
      success: true,
      data: buildPublicSettings(getDefaultSettings(), latest),
      message: 'Settings updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to update settings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update settings'
    });
  }
});

module.exports = router;
