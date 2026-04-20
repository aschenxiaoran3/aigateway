const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/mysql');
const {
  preflightRepository,
  prepareRepositorySnapshot,
  deriveRepoSlug,
} = require('../deepwiki/repository');

const execFileAsync = promisify(execFile);
const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);
const promptSourceHandlers = new Map();

const LANE_MAP = {
  demand_drafting: '需求',
  demand_confirm_wait: '需求',
  design_generating: '设计',
  design_confirm_wait: '设计',
  development_coding: '开发',
  development_unit_testing: '开发',
  uat_wait: '测试',
  deploy_pending: '部署',
  deploying: '部署',
  completed: '部署',
  returned_to_dev: '开发',
  exception: '测试',
};

const CHECKPOINT_PROMPT_LABELS = {
  demand_confirmation: '需求确认',
  design_confirmation: '设计确认',
  uat_acceptance: 'UAT 验收',
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function inferWorkspaceRoot() {
  return (
    process.env.AIPLAN_WORKSPACE_ROOT ||
    path.resolve(__dirname, '../../../../../')
  );
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function getRuntimeRoot() {
  const root = process.env.HARNESS_RUNTIME_ROOT
    ? path.resolve(process.env.HARNESS_RUNTIME_ROOT)
    : path.join(inferWorkspaceRoot(), 'projects', 'ai-platform', 'storage', 'harness-runtime');
  ensureDir(root);
  return root;
}

function getRuntimeRootForSource(sourcePath) {
  const root = getRuntimeRoot();
  const resolvedRoot = path.resolve(root);
  const resolvedSource = normalizeText(sourcePath) ? path.resolve(sourcePath) : '';
  if (
    resolvedSource &&
    (resolvedRoot === resolvedSource || resolvedRoot.startsWith(`${resolvedSource}${path.sep}`))
  ) {
    const fallbackRoot = path.join('/tmp', 'ai-harness-runtime');
    ensureDir(fallbackRoot);
    return fallbackRoot;
  }
  ensureDir(root);
  return root;
}

async function query(sql, params = []) {
  const [rows] = await db.getPool().execute(sql, params);
  return rows;
}

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_cards (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      card_code VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      card_type VARCHAR(32) NOT NULL DEFAULT '需求',
      priority VARCHAR(32) NOT NULL DEFAULT '中优先',
      stage_key VARCHAR(64) NOT NULL DEFAULT 'demand_confirm_wait',
      sub_status VARCHAR(64) NULL,
      trace_id VARCHAR(64) NOT NULL,
      repo_url VARCHAR(1024) NULL,
      repo_slug VARCHAR(255) NULL,
      repo_branch VARCHAR(255) NULL,
      deepwiki_run_id BIGINT NULL,
      bundle_id BIGINT NULL,
      summary_text TEXT NULL,
      latest_ai_action VARCHAR(255) NULL,
      latest_human_action VARCHAR(255) NULL,
      blocked_reason VARCHAR(255) NULL,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_gateway_harness_cards_card_code (card_code),
      UNIQUE KEY uk_gateway_harness_cards_trace_id (trace_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_card_stages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      card_id BIGINT NOT NULL,
      stage_key VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      metadata_json JSON NULL,
      started_at DATETIME NULL,
      ended_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_gateway_harness_card_stages_card (card_id),
      INDEX idx_gateway_harness_card_stages_stage (stage_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      card_id BIGINT NOT NULL,
      tab_key VARCHAR(32) NOT NULL,
      actor VARCHAR(32) NOT NULL,
      content_text TEXT NOT NULL,
      status VARCHAR(32) NULL,
      stage_key VARCHAR(64) NULL,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_gateway_harness_messages_card (card_id),
      INDEX idx_gateway_harness_messages_tab (tab_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      card_id BIGINT NOT NULL,
      runtime_run_id BIGINT NULL,
      stage_key VARCHAR(64) NULL,
      log_level VARCHAR(16) NOT NULL DEFAULT 'info',
      content_text TEXT NOT NULL,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_gateway_harness_logs_card (card_id),
      INDEX idx_gateway_harness_logs_runtime (runtime_run_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_human_checkpoints (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      card_id BIGINT NOT NULL,
      checkpoint_type VARCHAR(64) NOT NULL,
      stage_key VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'waiting',
      resume_token VARCHAR(128) NOT NULL,
      payload_json JSON NULL,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_gateway_harness_checkpoints_card (card_id),
      INDEX idx_gateway_harness_checkpoints_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_human_prompts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      prompt_code VARCHAR(32) NOT NULL,
      source_type VARCHAR(64) NOT NULL DEFAULT 'codex_manual',
      source_ref VARCHAR(255) NULL,
      card_id BIGINT NULL,
      checkpoint_id BIGINT NULL,
      checkpoint_type VARCHAR(64) NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'pending',
      channel VARCHAR(32) NOT NULL DEFAULT 'feishu',
      question_text TEXT NOT NULL,
      instructions_text TEXT NULL,
      prompt_payload_json JSON NULL,
      answer_text TEXT NULL,
      answer_payload_json JSON NULL,
      answered_by VARCHAR(255) NULL,
      answered_at DATETIME NULL,
      expires_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_gateway_harness_human_prompts_code (prompt_code),
      INDEX idx_gateway_harness_human_prompts_status (status),
      INDEX idx_gateway_harness_human_prompts_card (card_id),
      INDEX idx_gateway_harness_human_prompts_checkpoint (checkpoint_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_summaries (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      card_id BIGINT NOT NULL,
      runtime_run_id BIGINT NULL,
      title VARCHAR(255) NOT NULL,
      content_text MEDIUMTEXT NOT NULL,
      summary_type VARCHAR(64) NOT NULL DEFAULT 'change_summary',
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_gateway_harness_summaries_card (card_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS gateway_harness_runtime_runs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      card_id BIGINT NOT NULL,
      trace_id VARCHAR(64) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'queued',
      repo_key VARCHAR(255) NULL,
      repo_url VARCHAR(1024) NULL,
      repo_branch VARCHAR(255) NULL,
      workspace_path VARCHAR(1024) NULL,
      commit_sha_before VARCHAR(64) NULL,
      commit_sha_after VARCHAR(64) NULL,
      test_command VARCHAR(255) NULL,
      test_result VARCHAR(32) NULL,
      retry_count INT NOT NULL DEFAULT 0,
      logs_json JSON NULL,
      summary_artifact_id BIGINT NULL,
      metadata_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_gateway_harness_runtime_runs_trace_id (trace_id),
      INDEX idx_gateway_harness_runtime_runs_card (card_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  schemaReady = true;
}

function decorateCard(card) {
  if (!card) return null;
  return {
    ...card,
    lane: LANE_MAP[String(card.stage_key || '').trim()] || '需求',
  };
}

function mapCardRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    card_code: row.card_code,
    title: row.title,
    card_type: row.card_type,
    priority: row.priority,
    stage_key: row.stage_key,
    sub_status: row.sub_status || null,
    trace_id: row.trace_id,
    repo_url: row.repo_url || null,
    repo_slug: row.repo_slug || null,
    repo_branch: row.repo_branch || null,
    deepwiki_run_id: row.deepwiki_run_id == null ? null : Number(row.deepwiki_run_id),
    bundle_id: row.bundle_id == null ? null : Number(row.bundle_id),
    summary: row.summary_text || '',
    latest_ai_action: row.latest_ai_action || null,
    latest_human_action: row.latest_human_action || null,
    blocked_reason: row.blocked_reason || null,
    metadata_json: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMessageRow(row) {
  return {
    id: String(row.id),
    actor: row.actor,
    content: row.content_text,
    created_at: row.created_at,
    tab: row.tab_key,
    status: row.status || null,
    stage: row.stage_key || null,
  };
}

function mapLogRow(row) {
  return {
    id: String(row.id),
    actor: 'system',
    content: row.content_text,
    created_at: row.created_at,
    tab: 'dev',
    status: row.log_level,
    stage: row.stage_key || null,
  };
}

function mapCheckpointRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    checkpoint_type: row.checkpoint_type,
    stage_key: row.stage_key,
    status: row.status,
    resume_token: row.resume_token,
    payload_json: parseJson(row.payload_json, {}),
    expires_at: row.expires_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapPromptRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    prompt_code: row.prompt_code,
    source_type: row.source_type,
    source_ref: row.source_ref || null,
    card_id: row.card_id == null ? null : Number(row.card_id),
    checkpoint_id: row.checkpoint_id == null ? null : Number(row.checkpoint_id),
    checkpoint_type: row.checkpoint_type || null,
    status: row.status,
    channel: row.channel || 'feishu',
    question: row.question_text,
    instructions: row.instructions_text || null,
    prompt_payload_json: parseJson(row.prompt_payload_json, {}),
    answer_text: row.answer_text || null,
    answer_payload_json: parseJson(row.answer_payload_json, {}),
    answered_by: row.answered_by || null,
    answered_at: row.answered_at || null,
    expires_at: row.expires_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRuntimeRunRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    card_id: Number(row.card_id),
    trace_id: row.trace_id,
    status: row.status,
    repo_key: row.repo_key || null,
    repo_url: row.repo_url || null,
    repo_branch: row.repo_branch || null,
    workspace_path: row.workspace_path || null,
    commit_sha_before: row.commit_sha_before || null,
    commit_sha_after: row.commit_sha_after || null,
    test_command: row.test_command || null,
    test_result: row.test_result || null,
    retry_count: Number(row.retry_count || 0),
    logs_json: parseJson(row.logs_json, []),
    summary_artifact_id: row.summary_artifact_id == null ? null : Number(row.summary_artifact_id),
    metadata_json: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function emitEvent(type, payload = {}) {
  eventBus.emit('event', {
    type,
    created_at: nowIso(),
    ...payload,
  });
}

function subscribe(listener) {
  eventBus.on('event', listener);
  return () => eventBus.off('event', listener);
}

function registerPromptSourceHandler(sourceType, handler) {
  const key = normalizeText(sourceType);
  if (!key || typeof handler !== 'function') {
    return () => {};
  }
  promptSourceHandlers.set(key, handler);
  return () => {
    if (promptSourceHandlers.get(key) === handler) {
      promptSourceHandlers.delete(key);
    }
  };
}

function generatePromptCode() {
  return `HP-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function getCheckpointPromptQuestion(card, checkpointType) {
  const code = normalizeText(card?.card_code) || 'Harness';
  const title = normalizeText(card?.title) || '待确认事项';
  switch (checkpointType) {
    case 'demand_confirmation':
      return `请确认是否继续推进卡片 ${code}《${title}》的需求。`;
    case 'design_confirmation':
      return `请确认卡片 ${code}《${title}》的设计是否可以启动 Runtime。`;
    case 'uat_acceptance':
      return `请给出卡片 ${code}《${title}》的 UAT 结论：通过或打回。`;
    default:
      return `请处理卡片 ${code}《${title}》的人工确认请求。`;
  }
}

function getCheckpointPromptInstructions(checkpointType, promptCode) {
  switch (checkpointType) {
    case 'demand_confirmation':
    case 'design_confirmation':
      return `优先点消息里的按钮；也可以直接回复“确认 / 继续 + 备注”。如果你同时有多条待确认，再补 ${promptCode}`;
    case 'uat_acceptance':
      return `优先点消息里的按钮；也可以直接回复“通过 / 打回 + 备注”。如果你同时有多条待确认，再补 ${promptCode}`;
    default:
      return `优先点消息里的按钮；也可以直接回复你的答案。如果你同时有多条待确认，再补 ${promptCode}`;
  }
}

function stripPromptCodePrefix(text, promptCode) {
  const normalized = normalizeText(text);
  if (!normalized) return '';
  const escapedCode = String(promptCode || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return normalized.replace(new RegExp(`^${escapedCode}\\s*`, 'i'), '').trim();
}

async function createHumanPrompt(data = {}) {
  await ensureSchema();
  const promptCode = normalizeText(data.prompt_code) || generatePromptCode();
  const expiresHours = Number(data.expires_hours || 72);
  const expiresAt = Number.isFinite(expiresHours) && expiresHours > 0
    ? new Date(Date.now() + expiresHours * 3600 * 1000)
    : null;
  const result = await query(
    `INSERT INTO gateway_harness_human_prompts
     (prompt_code, source_type, source_ref, card_id, checkpoint_id, checkpoint_type, status, channel, question_text, instructions_text, prompt_payload_json, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [
      promptCode,
      normalizeText(data.source_type) || 'codex_manual',
      normalizeText(data.source_ref) || null,
      data.card_id == null ? null : Number(data.card_id),
      data.checkpoint_id == null ? null : Number(data.checkpoint_id),
      normalizeText(data.checkpoint_type) || null,
      normalizeText(data.status) || 'pending',
      normalizeText(data.channel) || 'feishu',
      normalizeText(data.question) || '请确认当前事项',
      normalizeText(data.instructions) || null,
      stringifyJson(data.prompt_payload_json || {}),
      expiresAt,
    ]
  );
  const rows = await query('SELECT * FROM gateway_harness_human_prompts WHERE id = ? LIMIT 1', [result.insertId]);
  return mapPromptRow(rows[0]);
}

async function createPromptForCheckpoint(cardId, checkpoint) {
  if (!checkpoint?.id) return null;
  const existingRows = await query(
    `SELECT * FROM gateway_harness_human_prompts
     WHERE checkpoint_id = ? AND status = 'pending'
     ORDER BY id DESC
     LIMIT 1`,
    [Number(checkpoint.id)]
  );
  if (existingRows[0]) {
    return mapPromptRow(existingRows[0]);
  }
  const card = await loadCardBase(cardId);
  if (!card) return null;
  const promptCode = generatePromptCode();
  const question = getCheckpointPromptQuestion(card, checkpoint.checkpoint_type);
  const instructions = getCheckpointPromptInstructions(checkpoint.checkpoint_type, promptCode);
  return createHumanPrompt({
    prompt_code: promptCode,
    source_type: 'harness_checkpoint',
    source_ref: `card:${card.id}:checkpoint:${checkpoint.checkpoint_type}`,
    card_id: Number(card.id),
    checkpoint_id: Number(checkpoint.id),
    checkpoint_type: checkpoint.checkpoint_type,
    question,
    instructions,
    expires_hours: 72,
    prompt_payload_json: {
      card_code: card.card_code,
      card_title: card.title,
      stage_key: checkpoint.stage_key,
      checkpoint_label: CHECKPOINT_PROMPT_LABELS[checkpoint.checkpoint_type] || checkpoint.checkpoint_type,
      resume_token: checkpoint.resume_token,
    },
  });
}

async function getHumanPromptByCode(promptCode) {
  await ensureSchema();
  const rows = await query(
    'SELECT * FROM gateway_harness_human_prompts WHERE prompt_code = ? LIMIT 1',
    [normalizeText(promptCode)]
  );
  return mapPromptRow(rows[0]);
}

async function listHumanPrompts(filters = {}) {
  await ensureSchema();
  const clauses = [];
  const params = [];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(normalizeText(filters.status));
  }
  if (filters.source_type) {
    clauses.push('source_type = ?');
    params.push(normalizeText(filters.source_type));
  }
  const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await query(
    `SELECT * FROM gateway_harness_human_prompts
     ${where}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit}`,
    params
  );
  return rows.map(mapPromptRow);
}

function parseHarnessPromptReply(prompt, answerText) {
  const normalized = stripPromptCodePrefix(answerText, prompt.prompt_code);
  const lower = normalized.toLowerCase();
  if (!normalized) {
    throw new Error('reply text is empty');
  }
  if (prompt.checkpoint_type === 'uat_acceptance') {
    if (
      /^(通过|pass|ok|yes|好的|可以|没问题)\b/i.test(normalized) ||
      lower.startsWith('通过') ||
      lower.startsWith('ok') ||
      lower.startsWith('yes')
    ) {
      return {
        decision: 'pass',
        comment:
          normalized.replace(/^(通过|pass|ok|yes|好的|可以|没问题)\s*/i, '').trim() || '飞书回复：UAT 通过',
      };
    }
    if (
      /^(打回|不通过|fail|reject|no|退回|驳回)\b/i.test(normalized) ||
      lower.startsWith('打回') ||
      lower.startsWith('不通过')
    ) {
      return {
        decision: 'fail',
        comment:
          normalized.replace(/^(打回|不通过|fail|reject|no|退回|驳回)\s*/i, '').trim() || '飞书回复：UAT 打回',
      };
    }
    throw new Error('uat reply must start with 通过 or 打回');
  }
  if (/^(取消|拒绝|不同意)\b/i.test(normalized)) {
    throw new Error('current harness mvp only supports confirm-style replies');
  }
  const comment =
    normalized.replace(/^(确认|继续|ok|yes|好的|可以|开始吧|继续吧)\s*/i, '').trim() || '飞书回复确认';
  return {
    decision: 'confirm',
    comment,
  };
}

async function applyHumanPromptAnswer(prompt, answerText, data = {}) {
  const customHandler = promptSourceHandlers.get(normalizeText(prompt.source_type));
  if (customHandler) {
    return customHandler(prompt, answerText, data);
  }
  if (prompt.source_type !== 'harness_checkpoint') {
    return {
      action: 'record_only',
      answer_text: answerText,
    };
  }
  const parsed = parseHarnessPromptReply(prompt, answerText);
  if (prompt.checkpoint_type === 'demand_confirmation') {
    const card = await confirmDemand(prompt.card_id, { comment: parsed.comment });
    return { action: 'confirm_demand', decision: parsed.decision, card };
  }
  if (prompt.checkpoint_type === 'design_confirmation') {
    const card = await confirmDesign(prompt.card_id, { comment: parsed.comment });
    return { action: 'confirm_design', decision: parsed.decision, card };
  }
  if (prompt.checkpoint_type === 'uat_acceptance') {
    const card = await submitUatResult(prompt.card_id, {
      result: parsed.decision === 'pass' ? 'pass' : 'fail',
      comment: parsed.comment,
      summary: parsed.decision === 'pass' ? '来自飞书回复的 UAT 结论已自动回写。' : '',
    });
    return { action: 'submit_uat', decision: parsed.decision, card };
  }
  throw new Error(`unsupported prompt source checkpoint_type: ${prompt.checkpoint_type || 'unknown'}`);
}

async function answerHumanPrompt(promptCode, data = {}) {
  await ensureSchema();
  const rows = await query(
    'SELECT * FROM gateway_harness_human_prompts WHERE prompt_code = ? LIMIT 1',
    [normalizeText(promptCode)]
  );
  const prompt = mapPromptRow(rows[0]);
  if (!prompt) return null;
  if (prompt.status !== 'pending') {
    return {
      prompt,
      action_result: prompt.answer_payload_json || null,
      duplicate: true,
    };
  }
  const answerText = normalizeText(data.answer_text);
  const actionResult = await applyHumanPromptAnswer(prompt, answerText, data || {});
  await query(
    `UPDATE gateway_harness_human_prompts
     SET status = 'answered',
         answer_text = ?,
         answer_payload_json = CAST(? AS JSON),
         answered_by = ?,
         answered_at = NOW(),
         updated_at = NOW()
     WHERE id = ?`,
    [
      answerText,
      stringifyJson({
        action: actionResult.action,
        decision: actionResult.decision || null,
        card_id: actionResult.card?.id || prompt.card_id || null,
      }),
      normalizeText(data.answered_by) || null,
      Number(prompt.id),
    ]
  );
  const updated = await getHumanPromptByCode(prompt.prompt_code);
  return {
    prompt: updated,
    action_result: actionResult,
    duplicate: false,
  };
}

async function appendStageMessage(cardId, tabKey, actor, content, stageKey, status, metadata = {}) {
  await query(
    `INSERT INTO gateway_harness_messages
     (card_id, tab_key, actor, content_text, status, stage_key, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [Number(cardId), tabKey, actor, normalizeText(content), status || null, stageKey || null, stringifyJson(metadata)]
  );
}

async function appendLog(cardId, stageKey, content, logLevel = 'info', runtimeRunId = null, metadata = {}) {
  await query(
    `INSERT INTO gateway_harness_logs
     (card_id, runtime_run_id, stage_key, log_level, content_text, metadata_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [Number(cardId), runtimeRunId, stageKey || null, logLevel, normalizeText(content), stringifyJson(metadata)]
  );
  await emitEvent(logLevel === 'error' ? 'runtime.failed' : 'runtime.log', {
    card_id: Number(cardId),
    stage_key: stageKey || null,
    content: normalizeText(content),
    log_level: logLevel,
    runtime_run_id: runtimeRunId,
  });
}

async function upsertStageHistory(cardId, stageKey, status, metadata = {}) {
  const rows = await query(
    `SELECT * FROM gateway_harness_card_stages
     WHERE card_id = ? AND stage_key = ?
     ORDER BY id DESC
     LIMIT 1`,
    [Number(cardId), stageKey]
  );
  const current = rows[0];
  if (current) {
    await query(
      `UPDATE gateway_harness_card_stages
       SET status = ?, metadata_json = CAST(? AS JSON), ended_at = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        status,
        stringifyJson({ ...parseJson(current.metadata_json, {}), ...metadata }),
        status === 'running' ? null : new Date(),
        Number(current.id),
      ]
    );
    return;
  }
  await query(
    `INSERT INTO gateway_harness_card_stages
     (card_id, stage_key, status, metadata_json, started_at, ended_at)
     VALUES (?, ?, ?, CAST(? AS JSON), ?, ?)`,
    [
      Number(cardId),
      stageKey,
      status,
      stringifyJson(metadata),
      new Date(),
      status === 'running' ? null : new Date(),
    ]
  );
}

async function createCheckpoint(cardId, checkpointType, stageKey, payload = {}, expiresHours = 72) {
  const resumeToken = `cp-${uuidv4().replace(/-/g, '').slice(0, 24)}`;
  const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000);
  const result = await query(
    `INSERT INTO gateway_harness_human_checkpoints
     (card_id, checkpoint_type, stage_key, status, resume_token, payload_json, expires_at)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), ?)`,
    [
      Number(cardId),
      checkpointType,
      stageKey,
      'waiting',
      resumeToken,
      stringifyJson(payload),
      expiresAt,
    ]
  );
  const rows = await query('SELECT * FROM gateway_harness_human_checkpoints WHERE id = ? LIMIT 1', [result.insertId]);
  const checkpoint = mapCheckpointRow(rows[0]);
  const prompt = await createPromptForCheckpoint(Number(cardId), checkpoint).catch(() => null);
  await emitEvent('checkpoint.waiting', {
    card_id: Number(cardId),
    checkpoint,
    prompt,
  });
  return checkpoint;
}

async function resolveCheckpoint(cardId, checkpointType, payload = {}) {
  const rows = await query(
    `SELECT *
     FROM gateway_harness_human_checkpoints
     WHERE card_id = ? AND checkpoint_type = ? AND status = 'waiting'
     ORDER BY id DESC
     LIMIT 1`,
    [Number(cardId), checkpointType]
  );
  const checkpoint = rows[0];
  if (!checkpoint) return null;
  await query(
    `UPDATE gateway_harness_human_checkpoints
     SET status = 'resumed', payload_json = CAST(? AS JSON), updated_at = NOW()
     WHERE id = ?`,
    [stringifyJson({ ...parseJson(checkpoint.payload_json, {}), ...payload }), Number(checkpoint.id)]
  );
  await emitEvent('checkpoint.resumed', {
    card_id: Number(cardId),
    checkpoint_type: checkpointType,
    stage_key: checkpoint.stage_key,
  });
  return mapCheckpointRow({
    ...checkpoint,
    status: 'resumed',
    payload_json: stringifyJson({ ...parseJson(checkpoint.payload_json, {}), ...payload }),
  });
}

async function loadCardBase(id) {
  const rows = await query('SELECT * FROM gateway_harness_cards WHERE id = ? LIMIT 1', [Number(id)]);
  return mapCardRow(rows[0]);
}

async function loadCardDetail(id) {
  const [card, messageRows, logRows, summaryRows, checkpointRows, runtimeRows, promptRows] = await Promise.all([
    loadCardBase(id),
    query('SELECT * FROM gateway_harness_messages WHERE card_id = ? ORDER BY id ASC', [Number(id)]),
    query('SELECT * FROM gateway_harness_logs WHERE card_id = ? ORDER BY id ASC', [Number(id)]),
    query('SELECT * FROM gateway_harness_summaries WHERE card_id = ? ORDER BY id DESC LIMIT 1', [Number(id)]),
    query(
      `SELECT * FROM gateway_harness_human_checkpoints
       WHERE card_id = ? AND status = 'waiting'
       ORDER BY id DESC`,
      [Number(id)]
    ),
    query('SELECT * FROM gateway_harness_runtime_runs WHERE card_id = ? ORDER BY id DESC', [Number(id)]),
    query(
      `SELECT * FROM gateway_harness_human_prompts
       WHERE card_id = ? AND status = 'pending'
       ORDER BY id DESC`,
      [Number(id)]
    ),
  ]);
  if (!card) return null;
  const messages = {
    demand: [],
    design: [],
    uat: [],
  };
  messageRows.map(mapMessageRow).forEach((item) => {
    const tab = item.tab || 'demand';
    if (!messages[tab]) messages[tab] = [];
    messages[tab].push(item);
  });
  return decorateCard({
    ...card,
    messages,
    logs: logRows.map(mapLogRow),
    summary_artifact: summaryRows[0]
      ? {
          id: Number(summaryRows[0].id),
          title: summaryRows[0].title,
          content: summaryRows[0].content_text,
        }
      : null,
    active_checkpoint: checkpointRows[0] ? mapCheckpointRow(checkpointRows[0]) : null,
    active_prompt: promptRows[0] ? mapPromptRow(promptRows[0]) : null,
    runtime_runs: runtimeRows.map(mapRuntimeRunRow),
  });
}

async function maybeSeedFromContext(context = {}) {
  await ensureSchema();
  const countRows = await query('SELECT COUNT(*) AS count FROM gateway_harness_cards');
  if (Number(countRows[0]?.count || 0) > 0) return;
  const deepWikiRuns = Array.isArray(context.deepWikiRuns) ? context.deepWikiRuns : [];
  const bundles = Array.isArray(context.bundles) ? context.bundles : [];
  for (let index = 0; index < Math.min(3, deepWikiRuns.length); index += 1) {
    const run = deepWikiRuns[index];
    const title = run.repo_slug?.includes('aiplan')
      ? '销售订单测试方案生成'
      : 'Deep Wiki 与文档门禁联动';
    const created = await createCard({
      title,
      card_type: run.repo_slug?.includes('aiplan') ? '需求' : 'Bug',
      priority: index === 0 ? '高优先' : '中优先',
      summary: run.repo_slug?.includes('aiplan')
        ? '结合 aiplan Deep Wiki 与正式文档继续生成测试方案。'
        : '把 Deep Wiki 与文档门禁链路转成卡片化工作流。',
      repo_slug: run.repo_slug,
      repo_branch: run.branch,
      deepwiki_run_id: run.id,
      bundle_id: bundles.find((item) => item.title?.includes('lime-server'))?.id || null,
    });
    if (created) {
      await appendLog(created.id, created.stage_key, '已根据现有 Deep Wiki / Doc Gate 状态自动生成示例卡片。', 'info');
    }
  }
}

async function listCards(context = {}) {
  await maybeSeedFromContext(context);
  const rows = await query('SELECT * FROM gateway_harness_cards ORDER BY updated_at DESC, id DESC');
  return rows.map(mapCardRow).map(decorateCard);
}

async function getCardById(id, context = {}) {
  await maybeSeedFromContext(context);
  return loadCardDetail(id);
}

async function createCard(data = {}) {
  await ensureSchema();
  const title = normalizeText(data.title) || '新建需求';
  const repoUrl = normalizeText(data.repo_url);
  const repoBranch = normalizeText(data.repo_branch || data.branch);
  const repoSlug =
    normalizeText(data.repo_slug) ||
    (repoUrl ? deriveRepoSlug(repoUrl) : '');
  const result = await query(
    `INSERT INTO gateway_harness_cards
     (card_code, title, card_type, priority, stage_key, sub_status, trace_id, repo_url, repo_slug, repo_branch, deepwiki_run_id, bundle_id, summary_text, latest_ai_action, latest_human_action, blocked_reason, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      normalizeText(data.card_code) || `REQ-2026-${String(Date.now()).slice(-6)}`,
      title,
      normalizeText(data.card_type) || '需求',
      normalizeText(data.priority) || '中优先',
      'demand_confirm_wait',
      'awaiting_confirmation',
      `trace-harness-${uuidv4().replace(/-/g, '').slice(0, 16)}`,
      repoUrl || null,
      repoSlug || null,
      repoBranch || null,
      data.deepwiki_run_id != null ? Number(data.deepwiki_run_id) : null,
      data.bundle_id != null ? Number(data.bundle_id) : null,
      normalizeText(data.summary),
      '已生成需求澄清建议，等待人工确认',
      '已录入原始需求',
      null,
      stringifyJson({
        repo_source_mode:
          data.deepwiki_run_id
            ? 'deepwiki_snapshot'
            : repoUrl
              ? (path.isAbsolute(repoUrl) ? 'local_path' : 'remote_git')
              : 'manual',
      }),
    ]
  );
  const card = await loadCardBase(result.insertId);
  await upsertStageHistory(card.id, 'demand_confirm_wait', 'running', { sub_status: 'awaiting_confirmation' });
  await appendStageMessage(card.id, 'demand', 'human', data.summary || title, 'demand_confirm_wait');
  await appendStageMessage(
    card.id,
    'demand',
    'ai',
    '已根据原始需求生成第一轮澄清建议。请补充边界、约束或直接确认需求后继续流转。',
    'demand_confirm_wait'
  );
  await appendLog(card.id, 'demand_confirm_wait', '卡片已创建，进入需求确认等待点。', 'info');
  await createCheckpoint(card.id, 'demand_confirmation', 'demand_confirm_wait', {
    title,
    summary: normalizeText(data.summary),
  });
  const detail = await loadCardDetail(card.id);
  await emitEvent('card.created', { card: detail });
  return detail;
}

async function updateCard(id, patch = {}) {
  const fields = [];
  const params = [];
  const mapping = {
    stage_key: 'stage_key',
    sub_status: 'sub_status',
    latest_ai_action: 'latest_ai_action',
    latest_human_action: 'latest_human_action',
    blocked_reason: 'blocked_reason',
    summary: 'summary_text',
    repo_url: 'repo_url',
    repo_slug: 'repo_slug',
    repo_branch: 'repo_branch',
    deepwiki_run_id: 'deepwiki_run_id',
    bundle_id: 'bundle_id',
  };
  Object.entries(mapping).forEach(([key, field]) => {
    if (patch[key] !== undefined) {
      fields.push(`${field} = ?`);
      params.push(patch[key]);
    }
  });
  if (patch.metadata_json !== undefined) {
    fields.push('metadata_json = CAST(? AS JSON)');
    params.push(stringifyJson(patch.metadata_json || {}));
  }
  if (!fields.length) return loadCardDetail(id);
  fields.push('updated_at = NOW()');
  await query(`UPDATE gateway_harness_cards SET ${fields.join(', ')} WHERE id = ?`, [...params, Number(id)]);
  const detail = await loadCardDetail(id);
  await emitEvent('card.updated', { card: detail });
  return detail;
}

async function confirmDemand(id, data = {}) {
  await ensureSchema();
  const card = await loadCardBase(id);
  if (!card) return null;
  await resolveCheckpoint(id, 'demand_confirmation', { comment: normalizeText(data.comment) });
  await appendStageMessage(id, 'demand', 'human', data.comment || '需求已确认', 'demand_confirm_wait');
  await appendStageMessage(
    id,
    'demand',
    'ai',
    '需求确认完成，已生成设计方向与边界说明，等待人工确认设计。',
    'design_confirm_wait'
  );
  await updateCard(id, {
    stage_key: 'design_confirm_wait',
    sub_status: 'design_ready',
    latest_human_action: '已确认需求',
    latest_ai_action: '已输出设计建议，等待人工确认',
  });
  await upsertStageHistory(id, 'demand_confirm_wait', 'completed', { result: 'confirmed' });
  await upsertStageHistory(id, 'design_confirm_wait', 'running', { result: 'waiting_human' });
  await appendLog(id, 'design_confirm_wait', '需求确认完成，已流转到设计确认阶段。', 'success');
  await createCheckpoint(id, 'design_confirmation', 'design_confirm_wait', {
    comment: normalizeText(data.comment),
  });
  return loadCardDetail(id);
}

async function confirmDesign(id, data = {}) {
  await ensureSchema();
  const card = await loadCardBase(id);
  if (!card) return null;
  await resolveCheckpoint(id, 'design_confirmation', { comment: normalizeText(data.comment) });
  await appendStageMessage(id, 'design', 'human', data.comment || '设计已确认', 'design_confirm_wait');
  await appendStageMessage(
    id,
    'design',
    'ai',
    '设计确认完成，开始 AI 自动开发、单元测试与变更总结。',
    'development_coding'
  );
  await updateCard(id, {
    stage_key: 'development_coding',
    sub_status: 'runtime_booting',
    latest_human_action: '已确认设计',
    latest_ai_action: '开始准备运行时工作区与测试命令',
  });
  await upsertStageHistory(id, 'design_confirm_wait', 'completed', { result: 'confirmed' });
  await upsertStageHistory(id, 'development_coding', 'running', { result: 'runtime_started' });
  await appendLog(id, 'development_coding', '设计确认完成，已启动 AI Runtime。', 'success');
  const detail = await loadCardDetail(id);
  setImmediate(() => {
    void startRuntime(id, {
      trigger: 'design_confirmation',
      change_request: detail.summary,
    }).catch(() => {});
  });
  return detail;
}

async function submitUatResult(id, data = {}) {
  await ensureSchema();
  const card = await loadCardBase(id);
  if (!card) return null;
  const passed = String(data.result || '').toLowerCase() === 'pass';
  await resolveCheckpoint(id, 'uat_acceptance', {
    result: passed ? 'pass' : 'fail',
    comment: normalizeText(data.comment),
    summary: normalizeText(data.summary),
  });
  await appendStageMessage(id, 'uat', 'human', data.comment || (passed ? 'UAT 验收通过' : 'UAT 打回开发'), 'uat_wait');
  if (passed) {
    const summaryTitle = `${card.card_code} · 变更总结`;
    const summaryContent = [
      `# ${summaryTitle}`,
      '',
      `- 标题：${card.title}`,
      `- 当前仓库：${card.repo_slug || card.repo_url || '待确认'}`,
      `- UAT 结论：通过`,
      `- 人工备注：${normalizeText(data.comment) || '无'}`,
      '',
      '## 总结补充',
      normalizeText(data.summary) || '已进入待部署状态，后续可接入 CI/CD 自动部署链路。',
    ].join('\n');
    const result = await query(
      `INSERT INTO gateway_harness_summaries
       (card_id, title, content_text, summary_type, metadata_json)
       VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
      [Number(id), summaryTitle, summaryContent, 'change_summary', stringifyJson({ source: 'uat_acceptance' })]
    );
    await updateCard(id, {
      stage_key: 'deploy_pending',
      sub_status: 'summary_ready',
      latest_human_action: 'UAT 已通过',
      latest_ai_action: '已生成变更总结，等待部署',
      blocked_reason: null,
    });
    await upsertStageHistory(id, 'uat_wait', 'completed', { result: 'pass' });
    await upsertStageHistory(id, 'deploy_pending', 'running', { summary_artifact_id: result.insertId });
    await appendLog(id, 'deploy_pending', 'UAT 通过，已进入待部署状态并生成总结。', 'success');
    await emitEvent('uat.passed', {
      card_id: Number(id),
      summary_artifact_id: Number(result.insertId),
      comment: normalizeText(data.comment) || 'UAT 验收通过',
    });
    await emitEvent('summary.generated', {
      card_id: Number(id),
      summary_artifact_id: Number(result.insertId),
    });
  } else {
    await updateCard(id, {
      stage_key: 'returned_to_dev',
      sub_status: 'uat_returned',
      latest_human_action: 'UAT 打回开发',
      latest_ai_action: '准备根据 UAT 反馈重新执行开发闭环',
      blocked_reason: normalizeText(data.comment) || 'UAT 未通过',
    });
    await upsertStageHistory(id, 'uat_wait', 'completed', { result: 'fail' });
    await upsertStageHistory(id, 'returned_to_dev', 'running', { result: 'reopen_dev' });
    await appendLog(id, 'returned_to_dev', 'UAT 未通过，任务已打回开发。', 'warning');
    await emitEvent('uat.failed', {
      card_id: Number(id),
      comment: normalizeText(data.comment) || 'UAT 未通过',
    });
    setImmediate(() => {
      void startRuntime(id, {
        trigger: 'uat_return',
        change_request: normalizeText(data.comment) || card.summary,
      }).catch(() => {});
    });
  }
  return loadCardDetail(id);
}

async function listCardEvents(id, context = {}) {
  const detail = await getCardById(id, context);
  if (!detail) return [];
  return [...(detail.messages?.demand || []), ...(detail.messages?.design || []), ...(detail.messages?.uat || []), ...(detail.logs || [])]
    .sort((left, right) => new Date(right.created_at) - new Date(left.created_at));
}

async function resolveRuntimeSource(card) {
  if (card.deepwiki_run_id) {
    const run = await db.getDeepWikiRunById(card.deepwiki_run_id);
    if (run?.snapshot?.local_path) {
      return {
        repo_key: `deepwiki:${run.repo_source?.repo_slug || run.repo_slug || card.repo_slug || 'repo'}`,
        repo_url: run.repo_source?.repo_url || run.repo_url || card.repo_url || null,
        repo_branch: run.snapshot?.branch || run.branch || card.repo_branch || null,
        commit_sha_before: run.snapshot?.commit_sha || run.commit_sha || null,
        source_path: run.snapshot.local_path,
      };
    }
  }

  if (card.repo_url) {
    if (path.isAbsolute(card.repo_url) && fs.existsSync(card.repo_url)) {
      const branchResult = await runShellCommand(`git -C "${card.repo_url}" branch --show-current`, inferWorkspaceRoot());
      const commitResult = await runShellCommand(`git -C "${card.repo_url}" rev-parse HEAD`, inferWorkspaceRoot());
      return {
        repo_key: `local:${deriveRepoSlug(card.repo_url)}`,
        repo_url: card.repo_url,
        repo_branch: normalizeText(branchResult.stdout) || card.repo_branch || 'main',
        commit_sha_before: normalizeText(commitResult.stdout) || null,
        source_path: card.repo_url,
      };
    }
    const preflight = await preflightRepository(card.repo_url, card.repo_branch || '');
    const snapshot = await prepareRepositorySnapshot({
      repoUrl: preflight.repo_url,
      branch: preflight.resolved_branch,
      storageRoot: path.join(inferWorkspaceRoot(), 'projects', 'ai-platform', 'storage'),
      repoSlug: preflight.repo_slug,
    });
    return {
      repo_key: `remote:${preflight.repo_slug}`,
      repo_url: preflight.repo_url,
      repo_branch: snapshot.branch,
      commit_sha_before: snapshot.commit_sha,
      source_path: snapshot.local_path,
    };
  }

  throw new Error('Harness card is missing repo_url or deepwiki_run_id');
}

function detectTestCommand(workspacePath) {
  const packageJsonPath = path.join(workspacePath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (pkg?.scripts?.test) {
        return 'npm test';
      }
    } catch {
      // ignore
    }
  }
  if (fs.existsSync(path.join(workspacePath, 'mvnw'))) return './mvnw -q -DskipTests=false test';
  if (fs.existsSync(path.join(workspacePath, 'pom.xml'))) return 'mvn -q -DskipTests=false test';
  if (fs.existsSync(path.join(workspacePath, 'gradlew'))) return './gradlew test';
  if (fs.existsSync(path.join(workspacePath, 'build.gradle')) || fs.existsSync(path.join(workspacePath, 'build.gradle.kts'))) {
    return 'gradle test';
  }
  return '';
}

function applyPatchInstruction(workspacePath, patchInstruction = {}) {
  const changedFiles = [];
  const targetFile = normalizeText(patchInstruction.target_file);
  if (!targetFile) {
    const notesPath = path.join(workspacePath, '.ai-harness', 'change-request.md');
    ensureDir(path.dirname(notesPath));
    fs.writeFileSync(
      notesPath,
      [
        '# AI Harness Change Request',
        '',
        normalizeText(patchInstruction.change_request) || '未提供结构化 patch，当前仅记录需求并运行测试闭环。',
      ].join('\n'),
      'utf8'
    );
    changedFiles.push('.ai-harness/change-request.md');
    return changedFiles;
  }

  const absoluteTarget = path.join(workspacePath, targetFile);
  ensureDir(path.dirname(absoluteTarget));
  const current = fs.existsSync(absoluteTarget) ? fs.readFileSync(absoluteTarget, 'utf8') : '';
  let next = current;
  if (normalizeText(patchInstruction.replace_before)) {
    next = current.replace(patchInstruction.replace_before, patchInstruction.replace_after || '');
  } else if (patchInstruction.append_content != null) {
    next = `${current}${current.endsWith('\n') || !current ? '' : '\n'}${String(patchInstruction.append_content)}`;
  } else if (patchInstruction.full_content != null) {
    next = String(patchInstruction.full_content);
  }
  if (next !== current) {
    fs.writeFileSync(absoluteTarget, next, 'utf8');
    changedFiles.push(targetFile);
  }
  return changedFiles;
}

async function runShellCommand(command, cwd) {
  const result = await execFileAsync('/bin/zsh', ['-lc', command], {
    cwd,
    timeout: 20 * 60 * 1000,
    maxBuffer: 16 * 1024 * 1024,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

async function buildRuntimeSummary(card, runtimeRunId, runtimeRun, changedFiles, commandOutput) {
  const title = `${card.card_code} · AI Runtime 变更总结`;
  const metadata = runtimeRun.metadata_json || {};
  const retrievalContext = Array.isArray(metadata.retrieval_context) ? metadata.retrieval_context : [];
  const evidenceRefs = Array.isArray(metadata.evidence_refs) ? metadata.evidence_refs : [];
  const content = [
    `# ${title}`,
    '',
    `- 卡片：${card.title}`,
    `- 仓库：${runtimeRun.repo_url || card.repo_url || card.repo_slug || '待确认'}`,
    `- 分支：${runtimeRun.repo_branch || card.repo_branch || '待确认'}`,
    `- 运行状态：${runtimeRun.status}`,
    `- 测试命令：${runtimeRun.test_command || '未识别'}`,
    `- 测试结果：${runtimeRun.test_result || '未执行'}`,
    `- 重试次数：${runtimeRun.retry_count}`,
    '',
    '## 变更文件',
    changedFiles.length ? changedFiles.map((item) => `- ${item}`).join('\n') : '- 当前为分析/记录模式，未直接改动业务文件',
    '',
    '## 节点输入概览',
    '```json',
    JSON.stringify(
      {
        trigger: metadata.trigger || null,
        change_request: metadata.change_request || null,
        node_input: metadata.node_input || null,
        approval_context: metadata.approval_context || null,
      },
      null,
      2
    ),
    '```',
    '',
    '## 检索上下文',
    retrievalContext.length ? retrievalContext.map((item) => `- ${JSON.stringify(item)}`).join('\n') : '- 无',
    '',
    '## 证据引用',
    evidenceRefs.length ? evidenceRefs.map((item) => `- ${JSON.stringify(item)}`).join('\n') : '- 无',
    '',
    '## 运行日志摘要',
    '```text',
    `${normalizeText(commandOutput.stdout).slice(0, 6000)}${commandOutput.stderr ? `\n${normalizeText(commandOutput.stderr).slice(0, 2000)}` : ''}`.trim(),
    '```',
  ].join('\n');
  const result = await query(
    `INSERT INTO gateway_harness_summaries
     (card_id, runtime_run_id, title, content_text, summary_type, metadata_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(card.id),
      Number(runtimeRunId),
      title,
      content,
      'change_summary',
      stringifyJson({
        changed_files: changedFiles,
        test_result: runtimeRun.test_result,
      }),
    ]
  );
  return Number(result.insertId);
}

async function executeRuntimeRun(runtimeRunId, requestBody = {}) {
  const rows = await query('SELECT * FROM gateway_harness_runtime_runs WHERE id = ? LIMIT 1', [Number(runtimeRunId)]);
  const runtimeRun = mapRuntimeRunRow(rows[0]);
  if (!runtimeRun) return null;
  const card = await loadCardBase(runtimeRun.card_id);
  if (!card) return null;
  let source = {
    repo_key: runtimeRun.repo_key,
    repo_url: runtimeRun.repo_url || card.repo_url || null,
    repo_branch: runtimeRun.repo_branch || card.repo_branch || null,
    commit_sha_before: runtimeRun.commit_sha_before || null,
  };
  let changedFiles = [];
  let commandOutput = { stdout: '', stderr: '' };
  let testCommand = '';
  let testResult = 'failed';
  let retryCount = 0;
  const mergedMetadata = {
    ...(runtimeRun.metadata_json || {}),
    node_input: requestBody.node_input || runtimeRun.metadata_json?.node_input || null,
    approval_context: requestBody.approval_context || runtimeRun.metadata_json?.approval_context || null,
    retrieval_context: requestBody.retrieval_context || runtimeRun.metadata_json?.retrieval_context || null,
    evidence_refs: requestBody.evidence_refs || runtimeRun.metadata_json?.evidence_refs || null,
    change_request: normalizeText(requestBody.change_request) || runtimeRun.metadata_json?.change_request || null,
  };

  try {
    await query(
      `UPDATE gateway_harness_runtime_runs
       SET status = 'running', metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [stringifyJson(mergedMetadata), runtimeRun.id]
    );
    await emitEvent('stage.started', {
      card_id: card.id,
      stage_key: 'development_coding',
      runtime_run_id: runtimeRun.id,
    });
    await appendLog(card.id, 'development_coding', '正在准备运行时工作区。', 'info', runtimeRun.id);
    source = await resolveRuntimeSource(card);
    const workspacePath = path.join(getRuntimeRootForSource(source.source_path), `card-${card.id}`, `run-${runtimeRun.id}`);
    ensureDir(path.dirname(workspacePath));
    if (!fs.existsSync(workspacePath)) {
      fs.cpSync(source.source_path, workspacePath, { recursive: true });
    }
    await query(
      `UPDATE gateway_harness_runtime_runs
       SET repo_key = ?, repo_url = ?, repo_branch = ?, workspace_path = ?, commit_sha_before = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        source.repo_key,
        source.repo_url,
        source.repo_branch,
        workspacePath,
        source.commit_sha_before,
        stringifyJson({
          ...mergedMetadata,
          workspace_path: workspacePath,
          repo_key: source.repo_key,
          repo_branch: source.repo_branch,
        }),
        runtimeRun.id,
      ]
    );
    await appendLog(card.id, 'development_coding', `工作区已准备：${workspacePath}`, 'info', runtimeRun.id);

    changedFiles = applyPatchInstruction(workspacePath, requestBody);
    if (changedFiles.length) {
      await appendLog(card.id, 'development_coding', `已应用变更：${changedFiles.join('、')}`, 'success', runtimeRun.id);
    }

    testCommand = detectTestCommand(workspacePath);
    testResult = 'skipped';
    retryCount = 0;
    if (testCommand) {
      await query(
        `UPDATE gateway_harness_runtime_runs
         SET test_command = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
         WHERE id = ?`,
        [
          testCommand,
          stringifyJson({
            ...mergedMetadata,
            test_command: testCommand,
          }),
          runtimeRun.id,
        ]
      );
      await updateCard(card.id, {
        stage_key: 'development_unit_testing',
        sub_status: 'unit_test_running',
        latest_ai_action: `执行单元测试：${testCommand}`,
      });
      await upsertStageHistory(card.id, 'development_unit_testing', 'running', { test_command: testCommand });
      await emitEvent('stage.progress', {
        card_id: card.id,
        stage_key: 'development_unit_testing',
        runtime_run_id: runtimeRun.id,
        message: testCommand,
      });
      while (retryCount < 3) {
        try {
          commandOutput = await runShellCommand(testCommand, workspacePath);
          testResult = 'passed';
          break;
        } catch (error) {
          retryCount += 1;
          commandOutput = {
            stdout: normalizeText(error.stdout),
            stderr: normalizeText(error.stderr || error.message),
          };
          testResult = retryCount >= 3 ? 'failed' : 'retrying';
          await appendLog(
            card.id,
            'development_unit_testing',
            `单测执行失败，第 ${retryCount} 轮：${commandOutput.stderr || '未知错误'}`,
            retryCount >= 3 ? 'error' : 'warning',
            runtimeRun.id
          );
          if (retryCount >= 3) {
            break;
          }
        }
      }
    } else {
      await appendLog(card.id, 'development_unit_testing', '未识别可执行的单测命令，跳过测试。', 'warning', runtimeRun.id);
    }

    const summaryArtifactId = await buildRuntimeSummary(
      card,
      runtimeRun.id,
      {
        ...runtimeRun,
        repo_url: source.repo_url,
        repo_branch: source.repo_branch,
        status: testResult === 'failed' ? 'failed' : 'completed',
        test_command: testCommand,
        test_result: testResult,
        retry_count: retryCount,
      },
      changedFiles,
      commandOutput
    );

    await query(
        `UPDATE gateway_harness_runtime_runs
       SET status = ?, test_result = ?, retry_count = ?, logs_json = CAST(? AS JSON), summary_artifact_id = ?, metadata_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [
        testResult === 'failed' ? 'failed' : 'completed',
        testResult,
        retryCount,
        stringifyJson([
          { type: 'stdout', content: commandOutput.stdout },
          { type: 'stderr', content: commandOutput.stderr },
        ]),
        summaryArtifactId,
        stringifyJson({
          ...mergedMetadata,
          changed_files: changedFiles,
          test_command: testCommand,
          test_result: testResult,
          retry_count: retryCount,
        }),
        runtimeRun.id,
      ]
    );

    if (testResult === 'failed') {
      await updateCard(card.id, {
        stage_key: 'exception',
        sub_status: 'unit_test_failed',
        latest_ai_action: '单元测试失败，等待人工补充或重新触发',
        blocked_reason: '单元测试三次失败',
      });
      await upsertStageHistory(card.id, 'development_unit_testing', 'completed', { result: 'failed' });
      await emitEvent('runtime.failed', {
        card_id: card.id,
        runtime_run_id: runtimeRun.id,
      });
    } else {
      await updateCard(card.id, {
        stage_key: 'uat_wait',
        sub_status: 'waiting_uat',
        latest_ai_action: '开发与单测完成，等待 UAT',
        blocked_reason: null,
      });
      await upsertStageHistory(card.id, 'development_coding', 'completed', { result: 'runtime_completed' });
      await upsertStageHistory(card.id, 'development_unit_testing', 'completed', { result: testResult });
      await upsertStageHistory(card.id, 'uat_wait', 'running', { result: 'waiting_human' });
      await createCheckpoint(card.id, 'uat_acceptance', 'uat_wait', {
        runtime_run_id: runtimeRun.id,
        summary_artifact_id: summaryArtifactId,
      });
    }
    await emitEvent('stage.completed', {
      card_id: card.id,
      stage_key: testResult === 'failed' ? 'development_unit_testing' : 'uat_wait',
      runtime_run_id: runtimeRun.id,
    });
    return loadCardDetail(card.id);
  } catch (error) {
    const errorOutput = {
      stdout: normalizeText(commandOutput.stdout),
      stderr: normalizeText(commandOutput.stderr || error.message),
    };
    const summaryArtifactId = await buildRuntimeSummary(
      card,
      runtimeRun.id,
      {
        ...runtimeRun,
        repo_url: source.repo_url || card.repo_url || null,
        repo_branch: source.repo_branch || card.repo_branch || null,
        status: 'failed',
        test_command: testCommand,
        test_result: 'failed',
        retry_count: retryCount,
      },
      changedFiles,
      errorOutput
    );
    await query(
      `UPDATE gateway_harness_runtime_runs
       SET status = 'failed',
           test_result = 'failed',
           retry_count = ?,
           logs_json = CAST(? AS JSON),
           summary_artifact_id = ?,
           metadata_json = CAST(? AS JSON),
           updated_at = NOW()
       WHERE id = ?`,
      [
        retryCount,
        stringifyJson([
          { type: 'stdout', content: errorOutput.stdout },
          { type: 'stderr', content: errorOutput.stderr },
        ]),
        summaryArtifactId,
        stringifyJson({
          ...mergedMetadata,
          changed_files: changedFiles,
          test_command: testCommand,
          test_result: 'failed',
          retry_count: retryCount,
        }),
        runtimeRun.id,
      ]
    );
    await updateCard(card.id, {
      stage_key: 'exception',
      sub_status: 'runtime_failed',
      latest_ai_action: 'Runtime 执行失败',
      blocked_reason: error.message,
    });
    await appendLog(card.id, 'development_coding', `Runtime 失败：${error.message}`, 'error', runtimeRun.id, {
      summary_artifact_id: summaryArtifactId,
    });
    throw error;
  }
}

async function startRuntime(cardId, body = {}) {
  await ensureSchema();
  const card = await loadCardBase(cardId);
  if (!card) return null;
  const result = await query(
    `INSERT INTO gateway_harness_runtime_runs
     (card_id, trace_id, status, repo_url, repo_branch, metadata_json)
     VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      Number(cardId),
      `trace-harness-runtime-${uuidv4().replace(/-/g, '').slice(0, 12)}`,
      'queued',
      card.repo_url || null,
      card.repo_branch || null,
      stringifyJson({
        trigger: normalizeText(body.trigger) || 'manual',
        change_request: normalizeText(body.change_request),
        target_file: normalizeText(body.target_file),
        node_input: body.node_input || null,
        approval_context: body.approval_context || null,
        retrieval_context: body.retrieval_context || null,
        evidence_refs: body.evidence_refs || null,
      }),
    ]
  );
  const rows = await query('SELECT * FROM gateway_harness_runtime_runs WHERE id = ? LIMIT 1', [result.insertId]);
  const runtimeRun = mapRuntimeRunRow(rows[0]);
  await appendLog(cardId, 'development_coding', '已创建 Runtime 运行任务。', 'info', runtimeRun.id);
  await emitEvent('runtime.started', {
    card_id: Number(cardId),
    runtime_run_id: runtimeRun.id,
    trigger: normalizeText(body.trigger) || 'manual',
  });
  setImmediate(() => {
    void executeRuntimeRun(runtimeRun.id, body).catch(() => {});
  });
  return runtimeRun;
}

async function getRuntimeRunById(id) {
  await ensureSchema();
  const rows = await query('SELECT * FROM gateway_harness_runtime_runs WHERE id = ? LIMIT 1', [Number(id)]);
  return mapRuntimeRunRow(rows[0]);
}

async function listRuntimeLogs(id) {
  await ensureSchema();
  const rows = await query(
    'SELECT * FROM gateway_harness_logs WHERE runtime_run_id = ? ORDER BY id ASC',
    [Number(id)]
  );
  return rows.map(mapLogRow);
}

module.exports = {
  subscribe,
  ensureSchema,
  listCards,
  getCardById,
  createCard,
  listHumanPrompts,
  getHumanPromptByCode,
  createHumanPrompt,
  answerHumanPrompt,
  registerPromptSourceHandler,
  confirmDemand,
  confirmDesign,
  submitUatResult,
  listCardEvents,
  startRuntime,
  getRuntimeRunById,
  listRuntimeLogs,
  _test: {
    loadCardDetail,
    mapCheckpointRow,
    mapRuntimeRunRow,
    resolveRuntimeSource,
  },
};
