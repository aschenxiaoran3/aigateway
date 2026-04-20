/**
 * 门禁：规则 CRUD、执行记录、MVP 上报（CI / 手工）
 */

const express = require('express');
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs').promises;
const axios = require('axios');
const router = express.Router();
const db = require('../db/mysql');
const { collectExecutionWarnings } = require('../gate/execution-warnings');
const { mergeGateRules } = require('../lib/mergeGateRules');

const UPLOAD_DIR =
  process.env.GATE_UPLOAD_DIR ||
  path.join(process.cwd(), 'data', 'gate-uploads');

async function ensureUploadDir() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

async function syncGateExecutionToControlPlane(payload) {
  const baseUrl =
    (process.env.CONTROL_PLANE_BASE_URL || 'http://127.0.0.1:3003').replace(/\/$/, '');
  try {
    const response = await axios.post(
      `${baseUrl}/internal/gate-executions/sync`,
      payload,
      {
        timeout: 8000,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data?.data || null;
  } catch (error) {
    console.warn('[gates] control-plane sync failed:', error.message);
    return null;
  }
}

/**
 * GET /api/v1/gates/rules
 */
router.get('/rules', async (req, res) => {
  try {
    const { status, gate_type, merge } = req.query;
    const rules = await db.listGateRules({ status, gate_type });
    let data = rules;
    let total = rules.length;
    if (merge === 'all_active' && gate_type && rules.length > 1) {
      try {
        data = [mergeGateRules(rules)];
        total = 1;
      } catch (e) {
        return res.status(500).json({ success: false, error: String(e.message) });
      }
    }
    res.json({
      success: true,
      data,
      total,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('listGateRules:', error);
    res.status(500).json({ success: false, error: 'Failed to list gate rules' });
  }
});

/**
 * GET /api/v1/gates/rules/:id
 */
router.get('/rules/:id', async (req, res) => {
  try {
    const row = await db.getGateRuleById(Number(req.params.id));
    if (!row) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }
    res.json({ success: true, data: row, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('getGateRule:', error);
    res.status(500).json({ success: false, error: 'Failed to get gate rule' });
  }
});

/**
 * POST /api/v1/gates/rules
 * body: { gate_type, gate_name, version?, rules_config, status?, spec_markdown? }
 * spec_markdown 会合并进 rules_config.spec_markdown
 */
router.post('/rules', async (req, res) => {
  try {
    const {
      gate_type,
      gate_name,
      version,
      rules_config: rawCfg,
      status,
      spec_markdown,
    } = req.body || {};
    if (!gate_type || !gate_name) {
      return res.status(400).json({
        success: false,
        error: 'gate_type and gate_name are required',
      });
    }
    let rules_config =
      rawCfg && typeof rawCfg === 'object' ? { ...rawCfg } : {};
    if (typeof rawCfg === 'string') {
      try {
        rules_config = JSON.parse(rawCfg);
      } catch {
        rules_config = {};
      }
    }
    if (spec_markdown != null) {
      rules_config.spec_markdown = spec_markdown;
    }
    const { id } = await db.createGateRule({
      gate_type,
      gate_name,
      version,
      rules_config,
      status,
    });
    const row = await db.getGateRuleById(id);
    res.status(201).json({
      success: true,
      data: row,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('createGateRule:', error);
    res.status(500).json({ success: false, error: 'Failed to create gate rule' });
  }
});

/**
 * PATCH /api/v1/gates/rules/:id
 */
router.patch('/rules/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { gate_name, version, rules_config, status, spec_markdown } =
      req.body || {};
    const patch = {};
    if (gate_name !== undefined) patch.gate_name = gate_name;
    if (version !== undefined) patch.version = version;
    if (status !== undefined) patch.status = status;
    if (rules_config !== undefined || spec_markdown !== undefined) {
      const existing = await db.getGateRuleById(id);
      if (!existing) {
        return res.status(404).json({ success: false, error: 'Rule not found' });
      }
      let next =
        existing.rules_config && typeof existing.rules_config === 'object'
          ? { ...existing.rules_config }
          : {};
      if (rules_config !== undefined) {
        next =
          typeof rules_config === 'object'
            ? { ...next, ...rules_config }
            : next;
      }
      if (spec_markdown !== undefined) {
        next.spec_markdown = spec_markdown;
      }
      patch.rules_config = next;
    }
    const { affectedRows } = await db.updateGateRule(id, patch);
    if (!affectedRows) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }
    const row = await db.getGateRuleById(id);
    res.json({ success: true, data: row, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('updateGateRule:', error);
    res.status(500).json({ success: false, error: 'Failed to update gate rule' });
  }
});

/**
 * POST /api/v1/gates/rules/:id/upload
 * body: { filename, content_base64 } — 小文件 MVP，写入磁盘并在 rules_config 写入 spec_file_path
 */
router.post('/rules/:id/upload', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { filename, content_base64 } = req.body || {};
    if (!filename || !content_base64) {
      return res.status(400).json({
        success: false,
        error: 'filename and content_base64 are required',
      });
    }
    const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    await ensureUploadDir();
    const dest = path.join(UPLOAD_DIR, `${id}_${Date.now()}_${safeName}`);
    const buf = Buffer.from(content_base64, 'base64');
    if (buf.length > 5 * 1024 * 1024) {
      return res.status(400).json({
        success: false,
        error: 'File too large (max 5MB for MVP)',
      });
    }
    await fs.writeFile(dest, buf);
    const rel = path.relative(process.cwd(), dest);
    const existing = await db.getGateRuleById(id);
    if (!existing) {
      return res.status(404).json({ success: false, error: 'Rule not found' });
    }
    const next = {
      ...(existing.rules_config && typeof existing.rules_config === 'object'
        ? existing.rules_config
        : {}),
      spec_file_path: rel,
      spec_file_name: safeName,
    };
    await db.updateGateRule(id, { rules_config: next });
    const row = await db.getGateRuleById(id);
    res.json({
      success: true,
      data: row,
      uploaded_path: rel,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('gate upload:', error);
    res.status(500).json({ success: false, error: 'Failed to upload spec file' });
  }
});

/**
 * GET /api/v1/gates/executions
 */
router.get('/executions', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const offset = Number(req.query.offset) || 0;
    const { gate_type } = req.query;
    const rows = await db.listGateExecutions({ limit, offset, gate_type });
    res.json({
      success: true,
      data: rows,
      total: rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('listGateExecutions:', error);
    res
      .status(500)
      .json({ success: false, error: 'Failed to list gate executions' });
  }
});

const MAX_GATE_EXECUTION_BODY_BYTES = 4 * 1024 * 1024;

/**
 * POST /api/v1/gates/executions
 * CI / Agent 上报检查结果；软校验 warnings 不阻断入库（§6.0）
 */
router.post('/executions', async (req, res) => {
  try {
    const raw = JSON.stringify(req.body || {});
    if (Buffer.byteLength(raw, 'utf8') > MAX_GATE_EXECUTION_BODY_BYTES) {
      return res.status(413).json({
        success: false,
        error: 'Request body too large for gate execution',
      });
    }

    const b = req.body || {};
    if (!b.gate_type || !b.gate_name) {
      return res.status(400).json({
        success: false,
        error: 'gate_type and gate_name are required',
      });
    }

    const clientRunId =
      b.client_run_id != null ? String(b.client_run_id).trim() : '';
    if (clientRunId) {
      const existing = await db.getGateExecutionByClientRunId(clientRunId);
      if (existing) {
        return res.status(200).json({
          success: true,
          data: existing,
          warnings: [],
          execution_id: existing.id,
          duplicate: true,
          timestamp: new Date().toISOString(),
        });
      }
    }

    let ruleRow = null;
    if (b.rule_id != null) {
      const rid = Number(b.rule_id);
      if (!Number.isNaN(rid)) {
        ruleRow = await db.getGateRuleById(rid);
      }
    }

    const warnings = collectExecutionWarnings(b, ruleRow);

    const execution_meta = {};
    if (b.rule_id != null) execution_meta.rule_id = b.rule_id;
    if (b.rule_version != null) {
      execution_meta.rule_version = String(b.rule_version);
    }
    if (b.artifact_fingerprint != null) {
      execution_meta.artifact_fingerprint = String(b.artifact_fingerprint);
    }
    if (b.source != null) execution_meta.source = String(b.source);
    if (b.duration_ms != null) execution_meta.duration_ms = Number(b.duration_ms);
    if (b.trace_id != null) execution_meta.trace_id = String(b.trace_id);
    if (b.pipeline_id != null) execution_meta.pipeline_id = String(b.pipeline_id);
    if (b.pipeline_run_id != null) execution_meta.pipeline_run_id = Number(b.pipeline_run_id);
    if (b.node_id != null) execution_meta.node_id = String(b.node_id);
    if (b.project_code != null) execution_meta.project_code = String(b.project_code);
    execution_meta.contract_schema_key = 'gate-execution-sync';

    const hasMeta = Object.keys(execution_meta).length > 0;

    const { id } = await db.createGateExecution({
      gate_type: b.gate_type,
      gate_name: b.gate_name,
      document_name: b.document_name,
      author: b.author,
      total_score: b.total_score,
      max_score: b.max_score,
      passed: Boolean(b.passed),
      failed_checks: b.failed_checks,
      check_results: b.check_results,
      client_run_id: clientRunId || null,
      execution_meta: hasMeta ? execution_meta : undefined,
    });
    const row = await db.getGateExecutionById(id);
    const syncResult = await syncGateExecutionToControlPlane({
      contract_schema_key: 'gate-execution-sync',
      gate_execution_id: id,
      gate_type: b.gate_type,
      gate_name: b.gate_name,
      document_name: b.document_name,
      author: b.author,
      total_score: b.total_score,
      max_score: b.max_score,
      passed: Boolean(b.passed),
      failed_checks: b.failed_checks,
      trace_id: execution_meta.trace_id || clientRunId || `gate-${id}`,
      pipeline_id: execution_meta.pipeline_id || 'gate-review',
      pipeline_run_id: execution_meta.pipeline_run_id || null,
      node_id: execution_meta.node_id || null,
      project_code: execution_meta.project_code || b.project_code || 'C04',
      source: execution_meta.source || 'ai-gateway',
      milestone_type: b.milestone_type || '4_30_gate',
      execution_meta,
    });
    res.status(201).json({
      success: true,
      data: row,
      warnings,
      execution_id: id,
      sync_result: syncResult,
      duplicate: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      const b = req.body || {};
      const clientRunId =
        b.client_run_id != null ? String(b.client_run_id).trim() : '';
      if (clientRunId) {
        try {
          const existing = await db.getGateExecutionByClientRunId(clientRunId);
          if (existing) {
            return res.status(200).json({
              success: true,
              data: existing,
              warnings: [],
              execution_id: existing.id,
              duplicate: true,
              timestamp: new Date().toISOString(),
            });
          }
        } catch (_) {
          /* fall through */
        }
      }
    }
    console.error('createGateExecution:', error);
    res
      .status(500)
      .json({ success: false, error: 'Failed to record gate execution' });
  }
});

/**
 * POST /api/v1/gates/evaluate
 * 阶段 C：服务端调用 hermes-web-chat 的 gate-enforcement-cli.js（子进程），
 * 与 Hermes Web / OpenClaw 同源评判，避免各渠道复制 judge 逻辑。
 *
 * 环境变量：GATE_ENFORCEMENT_CLI = gate-enforcement-cli.js 的绝对路径（所在目录需含 node_modules）。
 */
router.post('/evaluate', async (req, res) => {
  try {
    const cliPath = (process.env.GATE_ENFORCEMENT_CLI || '').trim();
    if (!cliPath) {
      return res.status(501).json({
        success: false,
        error:
          'GATE_ENFORCEMENT_CLI is not set; use absolute path to gate-enforcement-cli.js',
      });
    }
    try {
      await fs.access(cliPath);
    } catch {
      return res.status(501).json({
        success: false,
        error: `GATE_ENFORCEMENT_CLI not found: ${cliPath}`,
      });
    }

    const b = req.body || {};
    if (!Array.isArray(b.messages)) {
      return res
        .status(400)
        .json({ success: false, error: 'messages must be an array' });
    }
    if (typeof b.assistantContent !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'assistantContent must be a string',
      });
    }

    const payload = JSON.stringify({
      messages: b.messages,
      assistantContent: b.assistantContent,
      traceId:
        b.trace_id != null
          ? String(b.trace_id)
          : b.traceId != null
            ? String(b.traceId)
            : '',
      apiKey: b.api_key || b.apiKey,
      apiBase: b.api_base || b.apiBase,
      chatBase: b.chat_base || b.chatBase,
      judgeModel: b.judge_model || b.judgeModel,
    });

    const nodeBin = process.env.NODE_BINARY || 'node';
    const r = spawnSync(nodeBin, [cliPath], {
      input: payload,
      encoding: 'utf8',
      cwd: path.dirname(cliPath),
      env: process.env,
      maxBuffer: 50 * 1024 * 1024,
      timeout: 180000,
    });

    if (r.error) {
      console.error('gates evaluate spawn:', r.error);
      return res.status(500).json({
        success: false,
        error: String(r.error.message),
      });
    }
    if (r.status !== 0) {
      return res.status(500).json({
        success: false,
        error: r.stderr || 'gate-enforcement-cli exited with error',
        exitCode: r.status,
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (e) {
      return res.status(500).json({
        success: false,
        error: 'Invalid JSON from gate-enforcement-cli',
        detail: String(r.stdout || '').slice(0, 2000),
      });
    }

    return res.status(200).json({
      success: true,
      data: parsed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('gates evaluate:', error);
    return res
      .status(500)
      .json({ success: false, error: 'Failed to run gate evaluation' });
  }
});

/**
 * GET /api/v1/gates/engine-logs
 * 门禁引擎诊断轨迹（过程日志），与 POST /gates/executions 评判落库区分开。
 * Query: page, pageSize, gate_type, event（模糊）, trace_id, since, until（ISO）
 */
router.get('/engine-logs', async (req, res) => {
  try {
    const {
      page,
      pageSize,
      gate_type,
      event,
      trace_id,
      since,
      until,
    } = req.query;
    const result = await db.listGateEngineLogs({
      page,
      pageSize,
      gate_type,
      event,
      trace_id,
      since,
      until,
    });
    res.json({
      success: true,
      data: result.rows,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('listGateEngineLogs:', error);
    res
      .status(500)
      .json({ success: false, error: 'Failed to list gate engine logs' });
  }
});

/**
 * POST /api/v1/gates/engine-logs
 * Body: { entries: [{ created_at, event, detail?, source?, trace_id?, gate_type?, rule_id? }] }，单次 ≤50 条
 */
router.post('/engine-logs', async (req, res) => {
  try {
    const body = req.body || {};
    const entries = body.entries;
    if (!Array.isArray(entries)) {
      return res.status(400).json({
        success: false,
        error: 'entries must be an array',
      });
    }
    if (entries.length > 50) {
      return res.status(400).json({
        success: false,
        error: 'entries length must be <= 50',
      });
    }
    const { inserted } = await db.createGateEngineLogsBatch(entries);
    res.status(201).json({
      success: true,
      inserted,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('createGateEngineLogsBatch:', error);
    res
      .status(500)
      .json({ success: false, error: 'Failed to record gate engine logs' });
  }
});

module.exports = router;
