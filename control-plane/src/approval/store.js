const { v4: uuidv4 } = require('uuid');
const db = require('../db/mysql');
const {
  getApprovalTemplate,
  listApprovalTemplates,
  normalizeTemplateArgs,
  resolveTemplateExecution,
} = require('./templates');

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

async function query(sql, params = []) {
  const [rows] = await db.getPool().execute(sql, params);
  return rows;
}

function mapApprovalTaskRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    task_code: row.task_code,
    prompt_code: row.prompt_code || null,
    task_type: row.task_type,
    template_key: row.template_key,
    status: row.status,
    risk_level: row.risk_level,
    summary: row.summary_text || '',
    question: row.question_text || '',
    workspace_path: row.workspace_path || null,
    command_args_json: parseJson(row.command_args_json, {}),
    prompt_payload_json: parseJson(row.prompt_payload_json, {}),
    answer_text: row.answer_text || null,
    answered_by: row.answered_by || null,
    answered_at: row.answered_at || null,
    executor_status: row.executor_status || null,
    executor_logs_json: parseJson(row.executor_logs_json, []),
    result_payload_json: parseJson(row.result_payload_json, {}),
    metadata_json: parseJson(row.metadata_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function generateTaskCode() {
  return `AT-${uuidv4().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
}

function buildPromptInstructions() {
  return '优先点按钮；如需补充背景，直接回复飞书消息。';
}

function buildTaskQuestion(task) {
  return normalizeText(task.question)
    || `是否允许执行 ${normalizeText(task.summary) || normalizeText(task.template_key)}？`;
}

function buildPromptPayload(task) {
  return {
    task_code: task.task_code,
    task_type: task.task_type,
    template_key: task.template_key,
    risk_level: task.risk_level,
    workspace_path: task.workspace_path,
    summary: task.summary,
    actions: [
      {
        label: '批准执行',
        answer_text: '批准执行',
        type: 'primary',
        action: 'approve',
      },
      {
        label: '稍后处理',
        answer_text: '稍后处理',
        type: 'default',
        action: 'defer',
      },
      {
        label: '拒绝',
        answer_text: '拒绝',
        type: 'danger',
        action: 'reject',
      },
    ],
  };
}

function parseDecision(answerText) {
  const normalized = normalizeText(answerText);
  const lower = normalized.toLowerCase();
  if (!normalized) {
    throw new Error('approval reply text is empty');
  }
  if (
    normalized.startsWith('批准') ||
    normalized.startsWith('同意') ||
    normalized.startsWith('继续执行') ||
    lower.startsWith('approve')
  ) {
    return { decision: 'approved', status: 'approved_pending_execution' };
  }
  if (
    normalized.startsWith('稍后') ||
    normalized.startsWith('延后') ||
    normalized.startsWith('晚点') ||
    lower.startsWith('defer') ||
    lower.startsWith('later')
  ) {
    return { decision: 'deferred', status: 'deferred' };
  }
  if (
    normalized.startsWith('拒绝') ||
    normalized.startsWith('不同意') ||
    normalized.startsWith('不执行') ||
    lower.startsWith('reject')
  ) {
    return { decision: 'rejected', status: 'rejected' };
  }
  throw new Error('approval reply must start with 批准执行 / 稍后处理 / 拒绝');
}

function createApprovalStore({ harnessStore, logger } = {}) {
  let schemaReady = false;

  async function ensureSchema() {
    if (schemaReady) return;
    await query(`
      CREATE TABLE IF NOT EXISTS gateway_codex_approval_tasks (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        task_code VARCHAR(32) NOT NULL,
        prompt_code VARCHAR(32) NULL,
        task_type VARCHAR(64) NOT NULL DEFAULT 'codex_command',
        template_key VARCHAR(64) NOT NULL,
        status VARCHAR(64) NOT NULL DEFAULT 'pending_approval',
        risk_level VARCHAR(32) NOT NULL DEFAULT 'high',
        summary_text VARCHAR(255) NOT NULL,
        question_text TEXT NULL,
        workspace_path VARCHAR(1024) NOT NULL,
        command_args_json JSON NULL,
        prompt_payload_json JSON NULL,
        answer_text TEXT NULL,
        answered_by VARCHAR(255) NULL,
        answered_at DATETIME NULL,
        executor_status VARCHAR(64) NULL,
        executor_logs_json JSON NULL,
        result_payload_json JSON NULL,
        metadata_json JSON NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uk_gateway_codex_approval_tasks_code (task_code),
        UNIQUE KEY uk_gateway_codex_approval_tasks_prompt_code (prompt_code),
        INDEX idx_gateway_codex_approval_tasks_status (status),
        INDEX idx_gateway_codex_approval_tasks_template (template_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    schemaReady = true;
  }

  async function getApprovalTaskById(id) {
    await ensureSchema();
    const rows = await query('SELECT * FROM gateway_codex_approval_tasks WHERE id = ? LIMIT 1', [Number(id)]);
    return mapApprovalTaskRow(rows[0]);
  }

  async function getApprovalTaskByCode(taskCode) {
    await ensureSchema();
    const rows = await query('SELECT * FROM gateway_codex_approval_tasks WHERE task_code = ? LIMIT 1', [
      normalizeText(taskCode),
    ]);
    return mapApprovalTaskRow(rows[0]);
  }

  async function listApprovalTasks(filters = {}) {
    await ensureSchema();
    const clauses = [];
    const params = [];
    if (filters.status) {
      const statuses = String(filters.status)
        .split(',')
        .map((item) => normalizeText(item))
        .filter(Boolean);
      if (statuses.length === 1) {
        clauses.push('status = ?');
        params.push(statuses[0]);
      } else if (statuses.length > 1) {
        clauses.push(`status IN (${statuses.map(() => '?').join(', ')})`);
        params.push(...statuses);
      }
    }
    if (filters.template_key) {
      clauses.push('template_key = ?');
      params.push(normalizeText(filters.template_key));
    }
    const limit = Math.min(Math.max(Number(filters.limit || 20), 1), 100);
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await query(
      `SELECT * FROM gateway_codex_approval_tasks
       ${where}
       ORDER BY updated_at DESC, id DESC
       LIMIT ${limit}`,
      params
    );
    return rows.map(mapApprovalTaskRow);
  }

  async function createApprovalTask(data = {}) {
    await ensureSchema();
    const templateKey = normalizeText(data.template_key);
    const template = getApprovalTemplate(templateKey);
    if (!template) {
      throw new Error(`unsupported approval template: ${templateKey || 'unknown'}`);
    }
    const workspacePath = normalizeText(data.workspace_path);
    if (!workspacePath) {
      throw new Error('workspace_path is required');
    }
    const normalizedArgs = normalizeTemplateArgs(templateKey, data.command_args_json || {});
    resolveTemplateExecution(templateKey, workspacePath, normalizedArgs);
    const taskCode = normalizeText(data.task_code) || generateTaskCode();
    const summary = normalizeText(data.summary)
      || `${template.label} · ${workspacePath}`;
    const question = buildTaskQuestion({
      ...data,
      summary,
      template_key: templateKey,
    });
    const promptPayload = buildPromptPayload({
      task_code: taskCode,
      task_type: normalizeText(data.task_type) || 'codex_command',
      template_key: templateKey,
      risk_level: normalizeText(data.risk_level) || template.risk_level,
      workspace_path: workspacePath,
      summary,
    });

    const result = await query(
      `INSERT INTO gateway_codex_approval_tasks
       (task_code, task_type, template_key, status, risk_level, summary_text, question_text, workspace_path, command_args_json, prompt_payload_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
      [
        taskCode,
        normalizeText(data.task_type) || 'codex_command',
        templateKey,
        'pending_approval',
        normalizeText(data.risk_level) || template.risk_level,
        summary,
        question,
        workspacePath,
        stringifyJson(normalizedArgs),
        stringifyJson(promptPayload),
        stringifyJson(data.metadata_json || {}),
      ]
    );

    const created = await getApprovalTaskById(result.insertId);
    const prompt = await harnessStore.createHumanPrompt({
      source_type: 'approval_task',
      source_ref: taskCode,
      channel: 'feishu',
      question,
      instructions: buildPromptInstructions(),
      prompt_payload_json: promptPayload,
    });
    await query(
      `UPDATE gateway_codex_approval_tasks
       SET prompt_code = ?, prompt_payload_json = CAST(? AS JSON), updated_at = NOW()
       WHERE id = ?`,
      [prompt.prompt_code, stringifyJson(promptPayload), Number(created.id)]
    );
    return {
      task: await getApprovalTaskById(created.id),
      prompt,
    };
  }

  async function handlePromptAnswer(prompt, answerText, extra = {}) {
    await ensureSchema();
    const taskCode = normalizeText(prompt?.source_ref || prompt?.prompt_payload_json?.task_code);
    const task = taskCode ? await getApprovalTaskByCode(taskCode) : null;
    if (!task) {
      throw new Error('approval task not found');
    }
    const parsed = parseDecision(answerText);
    await query(
      `UPDATE gateway_codex_approval_tasks
       SET status = ?, answer_text = ?, answered_by = ?, answered_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [
        parsed.status,
        normalizeText(answerText),
        normalizeText(extra.answered_by) || null,
        Number(task.id),
      ]
    );
    return {
      action: parsed.decision,
      decision: parsed.decision,
      task: await getApprovalTaskById(task.id),
    };
  }

  async function markTaskExecuting(id, data = {}) {
    await ensureSchema();
    await query(
      `UPDATE gateway_codex_approval_tasks
       SET status = 'executing',
           executor_status = 'running',
           result_payload_json = CAST(? AS JSON),
           updated_at = NOW()
       WHERE id = ?`,
      [
        stringifyJson({
          ...(data.result_payload_json || {}),
          executor_started_at: new Date().toISOString(),
        }),
        Number(id),
      ]
    );
    return getApprovalTaskById(id);
  }

  async function recordExecutionResult(id, data = {}) {
    await ensureSchema();
    const nextStatus = data.success ? 'executed_success' : 'executed_failed';
    await query(
      `UPDATE gateway_codex_approval_tasks
       SET status = ?,
           executor_status = ?,
           executor_logs_json = CAST(? AS JSON),
           result_payload_json = CAST(? AS JSON),
           updated_at = NOW()
       WHERE id = ?`,
      [
        nextStatus,
        data.success ? 'success' : 'failed',
        stringifyJson(Array.isArray(data.executor_logs_json) ? data.executor_logs_json : []),
        stringifyJson(data.result_payload_json || {}),
        Number(id),
      ]
    );
    return getApprovalTaskById(id);
  }

  harnessStore.registerPromptSourceHandler('approval_task', (prompt, answerText, extra) =>
    handlePromptAnswer(prompt, answerText, extra || {})
  );

  return {
    ensureSchema,
    listApprovalTemplates,
    listApprovalTasks,
    getApprovalTaskById,
    getApprovalTaskByCode,
    createApprovalTask,
    handlePromptAnswer,
    markTaskExecuting,
    recordExecutionResult,
  };
}

module.exports = {
  createApprovalStore,
  parseDecision,
  mapApprovalTaskRow,
};
