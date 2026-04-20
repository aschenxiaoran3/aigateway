const path = require('path');
const { loadProjectEnv } = require('../../scripts/lib/load-shared-env.cjs');

loadProjectEnv({
  serviceDir: path.resolve(__dirname, '..'),
  projectRoot: path.resolve(__dirname, '../..'),
});

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs');
const winston = require('winston');
const db = require('./db/mysql');
const { createDeepWikiQueue } = require('./deepwiki/queue');
const { createDeepWikiScheduler } = require('./deepwiki/scheduler');
const { listContracts, readSnapshotProjection } = require('./deepwiki/runtime');
const { createDevinDeepWikiSyncService, createDevinDeepWikiSyncScheduler } = require('./deepwiki/devin-sync');
const {
  OVERRIDE_FILE: DEEPWIKI_SKILL_OVERRIDE_FILE,
  listSkillContracts,
  getSkillContract,
  updateSkillContractOverride,
  resetSkillContractOverride,
} = require('./deepwiki/contracts/contracts');
const {
  loadKnowledgeOsBundleSafe,
  listKnowledgeOsEditableFiles,
  readKnowledgeOsRelative,
  writeKnowledgeOsRelative,
} = require('./deepwiki/knowledge-os-loader');
const harnessStore = require('./harness/store');
const { createApprovalStore } = require('./approval/store');
const { createHarnessNotifier } = require('./integrations/harnessNotifier');
const { createHumanPromptNotifier } = require('./integrations/humanPromptNotifier');
const memoryStore = require('./memory/store');

const logDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(logDir, 'control-plane.log') }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

const app = express();
const PORT = Number(process.env.PORT || 3104);
const deepWikiQueue = createDeepWikiQueue(async (runId) => {
  await db.executeDeepWikiRun(runId);
});
const devinDeepWikiSyncService = createDevinDeepWikiSyncService({ db, logger });
const devinDeepWikiQueue = createDeepWikiQueue(async (jobId) => {
  await devinDeepWikiSyncService.runJob(jobId);
});
const devinDeepWikiSyncScheduler = createDevinDeepWikiSyncScheduler({
  service: devinDeepWikiSyncService,
  logger,
});
const deepWikiScheduler = createDeepWikiScheduler({
  db,
  queue: deepWikiQueue,
  logger,
});
const approvalStore = createApprovalStore({ harnessStore, logger });
const harnessNotifier = createHarnessNotifier({ logger });
const humanPromptNotifier = createHumanPromptNotifier({ logger });

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return String(value[0] || '').trim();
  }
  return String(value || '').trim();
}

function safeCompareSecret(expected, actual) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(actual || ''), 'utf8');
  if (!left.length || !right.length || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function requireInternalToken(req, res, next) {
  const expectedToken = normalizeHeaderValue(process.env.HARNESS_NOTIFY_TOKEN);
  if (!expectedToken) {
    next();
    return;
  }
  const actualToken = normalizeHeaderValue(req.headers['x-internal-token']);
  if (!safeCompareSecret(expectedToken, actualToken)) {
    res.status(403).json({ success: false, error: 'Invalid internal token' });
    return;
  }
  next();
}

function isLoopbackAddress(value) {
  const text = normalizeHeaderValue(value);
  return (
    text === '127.0.0.1' ||
    text === '::1' ||
    text === '::ffff:127.0.0.1' ||
    text === 'localhost'
  );
}

function requireLoopback(req, res, next) {
  const candidates = [
    req.ip,
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
    req.hostname,
    req.headers.host ? String(req.headers.host).split(':')[0] : '',
  ];
  if (candidates.some(isLoopbackAddress)) {
    next();
    return;
  }
  res.status(403).json({ success: false, error: 'Loopback requests only' });
}

function extractWebhookSecretCandidates(req, payload) {
  const authorization = normalizeHeaderValue(req.headers.authorization);
  const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';

  return [
    req.headers['x-gitlab-token'],
    req.headers['x-webhook-token'],
    req.headers['x-gogs-token'],
    req.headers['x-gitee-token'],
    bearer,
    payload.webhook_secret,
    payload.secret,
    payload.secret_token,
    payload.token,
  ].map(normalizeHeaderValue).filter(Boolean);
}

function enrichDeepWikiRunState(run) {
  if (!run) return run;
  const summary = run.summary_json && typeof run.summary_json === 'object' ? run.summary_json : {};
  const queuePosition = typeof deepWikiQueue.getPosition === 'function' ? deepWikiQueue.getPosition(run.id) : null;
  const runtimeResult = run.status === 'completed'
    ? 'completed'
    : summary.stalled
      ? 'stalled'
      : String(summary.runtime_result || run.status || 'queued');
  const progressPercent = summary.progress_percent != null ? Number(summary.progress_percent) : null;
  const elapsedSeconds = summary.elapsed_seconds != null ? Number(summary.elapsed_seconds) : null;
  const estimatedRemainingSeconds =
    summary.estimated_remaining_seconds != null ? Number(summary.estimated_remaining_seconds) : null;
  return {
    ...run,
    runtime_result: runtimeResult,
    queue_position: queuePosition,
    progress_percent: progressPercent,
    elapsed_seconds: elapsedSeconds,
    estimated_remaining_seconds: estimatedRemainingSeconds,
    current_stage_started_at: summary.current_stage_started_at || null,
    heartbeat_at: summary.heartbeat_at || null,
    stalled: Boolean(summary.stalled),
    stage_progress: summary.stage_progress || {},
    summary_json: {
      ...summary,
      runtime_result: runtimeResult,
      queue_position: queuePosition,
    },
  };
}

function normalizeDownloadFilename(value) {
  const base = String(value || 'artifact')
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return `${base || 'artifact'}.md`;
}

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, _res, next) => {
  logger.info('control-plane request', {
    method: req.method,
    path: req.path,
  });
  next();
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'control-plane',
    deepwiki_scheduler: deepWikiScheduler.status(),
    devin_deepwiki_queue: devinDeepWikiQueue.status(),
    devin_deepwiki_sync_scheduler: devinDeepWikiSyncScheduler.status(),
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/v1/doc-bundles', async (_req, res, next) => {
  try {
    const data = await db.listDocBundles();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

async function buildHarnessContext() {
  const [deepWikiRuns, bundles] = await Promise.all([
    db.listDeepWikiRuns().catch(() => []),
    db.listDocBundles().catch(() => []),
  ]);
  return { deepWikiRuns, bundles };
}

async function buildHarnessNotificationPayload(event) {
  const cardId = Number(event?.card?.id || event?.card_id || 0);
  const runtimeRunId = Number(event?.runtime_run_id || event?.checkpoint?.payload_json?.runtime_run_id || 0);
  const card = cardId ? await harnessStore.getCardById(cardId, await buildHarnessContext()) : null;
  if (!card) return null;
  const runtimeRun =
    runtimeRunId
      ? await harnessStore.getRuntimeRunById(runtimeRunId).catch(() => null)
      : card.runtime_runs?.[0] || null;
  return {
    event_type: event.type,
    trace_id: runtimeRun?.trace_id || card.trace_id || null,
    card: {
      id: card.id,
      card_code: card.card_code,
      title: card.title,
      stage_key: card.stage_key,
      trace_id: card.trace_id,
      repo_url: card.repo_url,
      repo_branch: card.repo_branch,
      latest_ai_action: card.latest_ai_action,
      latest_human_action: card.latest_human_action,
      blocked_reason: card.blocked_reason,
    },
    runtime_run: runtimeRun
      ? {
          id: runtimeRun.id,
          trace_id: runtimeRun.trace_id,
          status: runtimeRun.status,
          test_command: runtimeRun.test_command,
          test_result: runtimeRun.test_result,
        }
      : null,
    checkpoint: card.active_checkpoint
      ? {
          id: card.active_checkpoint.id,
          checkpoint_type: card.active_checkpoint.checkpoint_type,
          status: card.active_checkpoint.status,
          resume_token: card.active_checkpoint.resume_token,
        }
      : null,
    prompt: event.prompt || card.active_prompt || null,
    summary_artifact: card.summary_artifact
      ? {
          id: card.summary_artifact.id,
          title: card.summary_artifact.title,
        }
      : null,
    metadata: {
      trigger: event.trigger || null,
      comment: event.comment || null,
      created_at: event.created_at || new Date().toISOString(),
    },
  };
}

async function deliverHumanPrompt(prompt) {
  if (!prompt || !humanPromptNotifier.isEnabled()) {
    return { delivered: false, skipped: true, reason: 'disabled_or_missing_prompt' };
  }
  return humanPromptNotifier.notify({ prompt });
}

async function handleHarnessNotificationEvent(event) {
  const eventType = String(event?.type || '').trim();
  if (!eventType) return;
  if (eventType === 'checkpoint.waiting' && event?.prompt && humanPromptNotifier.isEnabled()) {
    try {
      await deliverHumanPrompt(event.prompt);
      return;
    } catch (error) {
      logger.warn('human prompt notification delivery failed', {
        event_type: eventType,
        prompt_code: event?.prompt?.prompt_code || null,
        error: error.message,
      });
    }
  }
  if (!harnessNotifier.isEnabled()) return;
  if (
    eventType === 'runtime.log' ||
    eventType === 'stage.progress' ||
    eventType === 'stage.started' ||
    eventType === 'stage.completed' ||
    eventType === 'checkpoint.resumed' ||
    eventType === 'card.updated'
  ) {
    return;
  }
  try {
    const payload = await buildHarnessNotificationPayload(event);
    if (!payload) return;
    await harnessNotifier.notify(payload);
  } catch (error) {
    logger.warn('harness notification build failed', {
      event_type: eventType,
      error: error.message,
    });
  }
}

app.get('/api/v1/harness/cards', async (_req, res, next) => {
  try {
    const data = await harnessStore.listCards(await buildHarnessContext());
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/harness/cards', async (req, res, next) => {
  try {
    const data = await harnessStore.createCard(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/harness/cards/:id', async (req, res, next) => {
  try {
    const data = await harnessStore.getCardById(Number(req.params.id), await buildHarnessContext());
    if (!data) {
      return res.status(404).json({ success: false, error: 'Harness card not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/harness/cards/:id/confirm-demand', async (req, res, next) => {
  try {
    const data = await harnessStore.confirmDemand(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Harness card not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/harness/cards/:id/confirm-design', async (req, res, next) => {
  try {
    const data = await harnessStore.confirmDesign(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Harness card not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/harness/cards/:id/uat-result', async (req, res, next) => {
  try {
    const data = await harnessStore.submitUatResult(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Harness card not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/harness/cards/:id/events', async (req, res, next) => {
  try {
    const card = await harnessStore.getCardById(Number(req.params.id), await buildHarnessContext());
    if (!card) {
      return res.status(404).json({ success: false, error: 'Harness card not found' });
    }
    const data = await harnessStore.listCardEvents(Number(req.params.id), await buildHarnessContext());
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/harness/human-prompts', async (req, res, next) => {
  try {
    const data = await harnessStore.listHumanPrompts({
      status: req.query.status,
      source_type: req.query.source_type,
      limit: req.query.limit,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/harness/human-prompts/:code', async (req, res, next) => {
  try {
    const data = await harnessStore.getHumanPromptByCode(req.params.code);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Human prompt not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/internal/harness/human-prompts', requireInternalToken, async (req, res, next) => {
  try {
    const prompt = await harnessStore.createHumanPrompt(req.body || {});
    const notification = await deliverHumanPrompt(prompt);
    res.status(201).json({
      success: true,
      data: {
        prompt,
        notification,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/harness/human-prompts/local', requireLoopback, async (req, res, next) => {
  try {
    const prompt = await harnessStore.createHumanPrompt({
      ...req.body,
      source_type: 'codex_manual',
      channel: 'feishu',
    });
    const notification = await deliverHumanPrompt(prompt);
    res.status(201).json({
      success: true,
      data: {
        prompt,
        notification,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/internal/harness/human-prompts/reply', requireInternalToken, async (req, res, next) => {
  try {
    const data = await harnessStore.answerHumanPrompt(req.body?.prompt_code, req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Human prompt not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/approval-templates', async (_req, res, next) => {
  try {
    const data = approvalStore.listApprovalTemplates();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/approval-tasks', async (req, res, next) => {
  try {
    const data = await approvalStore.listApprovalTasks({
      status: req.query.status,
      template_key: req.query.template_key,
      limit: req.query.limit,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/approval-tasks/:id', async (req, res, next) => {
  try {
    const data = await approvalStore.getApprovalTaskById(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Approval task not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/approval-tasks/local', requireLoopback, async (req, res, next) => {
  try {
    const data = await approvalStore.createApprovalTask(req.body || {});
    const notification = await deliverHumanPrompt(data.prompt);
    res.status(201).json({
      success: true,
      data: {
        ...data,
        notification,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/internal/approval-tasks/:id/execution-start', requireInternalToken, async (req, res, next) => {
  try {
    const data = await approvalStore.markTaskExecuting(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Approval task not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/internal/approval-tasks/:id/execution-result', requireInternalToken, async (req, res, next) => {
  try {
    const data = await approvalStore.recordExecutionResult(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Approval task not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/harness/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (eventType, payload) => {
    res.write(`event: ${eventType}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send('connected', { timestamp: new Date().toISOString() });
  const unsubscribe = harnessStore.subscribe((event) => {
    send(event.type || 'message', event);
  });
  const heartbeat = setInterval(() => {
    send('heartbeat', { timestamp: new Date().toISOString() });
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

app.post('/api/v1/harness/cards/:id/runtime/start', async (req, res, next) => {
  try {
    const data = await harnessStore.startRuntime(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Harness card not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/harness/runtime-runs/:id', async (req, res, next) => {
  try {
    const data = await harnessStore.getRuntimeRunById(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Harness runtime run not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/harness/runtime-runs/:id/logs', async (req, res, next) => {
  try {
    const data = await harnessStore.listRuntimeLogs(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles', async (req, res, next) => {
  try {
    const data = await db.createDocBundle(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/doc-bundles/:bundleId', async (req, res, next) => {
  try {
    const data = await db.getDocBundleById(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/context', async (req, res, next) => {
  try {
    const data = await db.upsertDocBundleContext(Number(req.params.bundleId), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/doc-bundles/:bundleId/artifacts', async (req, res, next) => {
  try {
    const data = await db.listDocArtifacts(Number(req.params.bundleId));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/doc-bundles/:bundleId/artifacts/:artifactId/download', async (req, res, next) => {
  try {
    const artifact = await db.getDocArtifactById(Number(req.params.bundleId), Number(req.params.artifactId));
    if (!artifact) {
      return res.status(404).json({ success: false, error: 'Document artifact not found' });
    }
    const content = String(
      artifact.content_text ||
      (artifact.storage_uri && fs.existsSync(artifact.storage_uri) ? fs.readFileSync(artifact.storage_uri, 'utf8') : '')
    );
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${normalizeDownloadFilename(artifact.title)}"`);
    res.send(content);
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/artifacts', async (req, res, next) => {
  try {
    const data = await db.createDocArtifact(Number(req.params.bundleId), req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/artifact-links', async (req, res, next) => {
  try {
    const data = await db.createDocArtifactLink(Number(req.params.bundleId), req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/doc-bundles/:bundleId/gates', async (req, res, next) => {
  try {
    const data = await db.listDocGateExecutions(Number(req.params.bundleId));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/gates/input-contract', async (req, res, next) => {
  try {
    const data = await db.evaluateInputContract(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/gates/prd', async (req, res, next) => {
  try {
    const data = await db.evaluatePrdGate(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/gates/tech-spec', async (req, res, next) => {
  try {
    const data = await db.evaluateTechSpecGate(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/gates/tech-spec-generated', async (req, res, next) => {
  try {
    const data = await db.evaluateTechSpecGate(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/tech-specs/generate', async (req, res, next) => {
  try {
    const data = await db.generateTechSpec(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/doc-bundles/:bundleId/tech-specs/latest', async (req, res, next) => {
  try {
    const data = await db.getLatestTechSpecRun(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Tech spec run not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/coverage-graphs/build', async (req, res, next) => {
  try {
    const data = await db.buildCoverageGraph(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/doc-bundles/:bundleId/coverage-graphs/latest', async (req, res, next) => {
  try {
    const data = await db.getLatestCoverageGraph(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Coverage Graph not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/test-plans/generate', async (req, res, next) => {
  try {
    const data = await db.generateTestPlan(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/gates/test-plan', async (req, res, next) => {
  try {
    const data = await db.evaluateTestPlanGate(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/doc-bundles/:bundleId/test-plans/latest', async (req, res, next) => {
  try {
    const data = await db.getLatestTestPlanRun(Number(req.params.bundleId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Test plan run not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/doc-bundles/:bundleId/test-plans/publish', async (req, res, next) => {
  try {
    const data = await db.publishTestPlan(Number(req.params.bundleId));
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/program/waves', async (_req, res, next) => {
  try {
    const data = await db.listWaves();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/program/projects', async (_req, res, next) => {
  try {
    const data = await db.listProjects();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/program/projects/:code', async (req, res, next) => {
  try {
    const data = await db.getProjectByCode(req.params.code);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Project not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/program/projects/:code/ops-summary', async (req, res, next) => {
  try {
    const data = await db.getProjectOpsSummary(req.params.code);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Project code required' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/contracts/standard-nodes', async (_req, res, next) => {
  try {
    const data = await db.listStandardNodes();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/contracts/standard-nodes/:nodeKey', async (req, res, next) => {
  try {
    const data = await db.getStandardNodeByKey(req.params.nodeKey);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Standard node not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/control/repositories', async (req, res, next) => {
  try {
    const data = await db.listCodeRepositories(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/control/repositories', async (req, res, next) => {
  try {
    const data = await db.createCodeRepository(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/contracts/doc-gate-output-schema', async (_req, res, next) => {
  try {
    const data = db.getDocGateOutputSchema();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/program/projects/:code/weekly-updates', async (req, res, next) => {
  try {
    const data = await db.createWeeklyUpdate(req.params.code, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/evidence/packs', async (req, res, next) => {
  try {
    const data = await db.listEvidencePacks(req.query.project_code || null);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/evidence/packs', async (req, res, next) => {
  try {
    const data = await db.createEvidencePack(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/control/pipelines', async (_req, res, next) => {
  try {
    const data = await db.listPipelines();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/control/pipeline-templates', async (_req, res, next) => {
  try {
    const data = await db.listPipelines();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/control/pipelines', async (req, res, next) => {
  try {
    const data = await db.createPipeline(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/control/pipelines/:id/publish', async (req, res, next) => {
  try {
    const data = await db.publishPipeline(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Pipeline not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/control/integrations', async (_req, res, next) => {
  try {
    const data = await db.listIntegrationConnections();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/control/integrations', async (req, res, next) => {
  try {
    const data = await db.createIntegrationConnection(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/control/agents', async (_req, res, next) => {
  try {
    const data = await db.listAgents();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/control/schemas', async (_req, res, next) => {
  try {
    const data = await db.listSchemas();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/control/skills', async (_req, res, next) => {
  try {
    const data = await db.listSkills();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/memory/policies', async (req, res, next) => {
  try {
    const shouldResolve =
      req.query.resolve === 'true' ||
      req.query.scope_key ||
      req.query.project_code ||
      req.query.api_key_id ||
      req.query.agent_spec_id ||
      req.query.skill_package_id;
    if (shouldResolve) {
      const resolved = await memoryStore.resolveMemoryPolicy(req.query || {});
      return res.json({
        success: true,
        data: {
          policies: resolved.policies || [],
          resolved_policy: resolved.policy || null,
          matched_policy: resolved.matched_policy || null,
          global_policy: resolved.global_policy || null,
        },
      });
    }
    const data = await memoryStore.listMemoryPolicies(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.put('/api/v1/memory/policies/:scopeType/:scopeId', async (req, res, next) => {
  try {
    const data = await memoryStore.upsertMemoryPolicy({
      ...(req.body || {}),
      scope_type: req.params.scopeType,
      scope_id: req.params.scopeId,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/memory/threads', async (req, res, next) => {
  try {
    const data = await memoryStore.listMemoryThreads(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/memory/threads/:threadKey', async (req, res, next) => {
  try {
    const data = await memoryStore.getMemoryThread(req.params.threadKey, req.query || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Memory thread not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/memory/search', async (req, res, next) => {
  try {
    const query = { ...(req.query || {}) };
    if (typeof query.persist_recall === 'string') {
      query.persist_recall = !['false', '0', 'no', 'off'].includes(query.persist_recall.trim().toLowerCase());
    }
    const data = await memoryStore.searchMemory(query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/memory/facts', async (req, res, next) => {
  try {
    const data = await memoryStore.listMemoryFacts(req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/memory/ingest-turn', async (req, res, next) => {
  try {
    const data = await memoryStore.ingestMemoryTurn(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/value-assessments', async (req, res, next) => {
  try {
    const data = await db.listValueAssessments(req.query.project_code || null);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/value-assessments', async (req, res, next) => {
  try {
    const data = await db.createValueAssessment(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/governance/certifications', async (req, res, next) => {
  try {
    const data = await db.listCertificationRecords(req.query.project_code || null);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/governance/certifications', async (req, res, next) => {
  try {
    const data = await db.createCertificationRecord(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/governance/acceptance-overview', async (req, res, next) => {
  try {
    const data = await db.getGovernanceAcceptanceOverview(req.query.project_code || null);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/runtime/events/ingest', async (req, res, next) => {
  try {
    const data = await db.createRuntimeEvent(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/runtime/runs/:pipelineId/start', async (req, res, next) => {
  try {
    const data = await db.startPipelineRun(Number(req.params.pipelineId), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Pipeline not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/runtime/pipelines/doc-pipeline-v1/runs', async (req, res, next) => {
  try {
    const { bundle_id, project_code, trace_id } = req.body || {};
    if (!bundle_id) {
      return res.status(400).json({ success: false, error: 'bundle_id is required' });
    }
    const data = await db.executeDocPipelineRun(Number(bundle_id), { project_code, trace_id });
    if (!data) {
      return res.status(404).json({ success: false, error: 'Document bundle not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    if (error?.pipeline_context) {
      return res.status(500).json({
        success: false,
        error: error.message || 'doc-pipeline-v1 execution failed',
        data: error.pipeline_context,
      });
    }
    next(error);
  }
});

app.post('/api/v1/runtime/quality-benchmarks/test-plan', async (req, res, next) => {
  try {
    const data = await db.runTestPlanQualityBenchmark(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/runtime/runs', async (_req, res, next) => {
  try {
    const data = await db.listPipelineRuns();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/runtime/pipeline-runs', async (_req, res, next) => {
  try {
    const data = await db.listPipelineRuns();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/runtime/pipeline-runs', async (req, res, next) => {
  try {
    const pipelineRef = req.body?.pipeline_id ?? req.body?.pipeline_key;
    const pipeline = await db.getPipelineDefinitionByRef(pipelineRef);
    if (!pipeline) {
      return res.status(404).json({ success: false, error: 'Pipeline template not found' });
    }
    const data = await db.startPipelineRun(pipeline.id, req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/runtime/traces/:traceId', async (req, res, next) => {
  try {
    const [data, traceMemory] = await Promise.all([
      db.getTraceById(req.params.traceId),
      memoryStore.getTraceMemory(req.params.traceId).catch(() => ({
        memory_turns: [],
        memory_recalls: [],
        memory_facts: [],
      })),
    ]);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Trace not found' });
    }
    res.json({
      success: true,
      data: {
        ...data,
        ...traceMemory,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/runtime/approvals/:id/decision', async (req, res, next) => {
  try {
    const data = await db.decideApproval(Number(req.params.id), req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/metrics/dashboard', async (_req, res, next) => {
  try {
    const data = await db.getDashboardMetrics();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/metrics/efficiency-report', async (_req, res, next) => {
  try {
    const data = await db.getEfficiencyReport();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/audit/events', async (_req, res, next) => {
  try {
    const data = await db.listAuditEvents();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/knowledge/assets', async (_req, res, next) => {
  try {
    const data = await db.listKnowledgeAssets({
      asset_category: _req.query.asset_category || null,
      domain: _req.query.domain || null,
      module: _req.query.module || null,
      asset_type: _req.query.asset_type || null,
      status: _req.query.status || null,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/knowledge/assets/:id/ingest', async (req, res, next) => {
  try {
    const data = await db.ingestKnowledgeAsset(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Knowledge asset not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/knowledge/assets/:id/spot-check', async (req, res, next) => {
  try {
    const data = await db.createKnowledgeSpotCheck(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Knowledge asset not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/knowledge/rag-queries', async (req, res, next) => {
  try {
    const data = await db.listRagQueries(req.query.project_code || null);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/knowledge/rag-queries', async (req, res, next) => {
  try {
    const data = await db.logRagQuery(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/runs', async (_req, res, next) => {
  try {
    const data = await db.listDeepWikiRuns({
      repo_source_id: _req.query.repo_source_id || null,
    });
    res.json({ success: true, data: data.map(enrichDeepWikiRunState) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/repos', async (_req, res, next) => {
  try {
    const data = await db.listDeepWikiRepos();
    res.json({
      success: true,
      data: data.map((item) => ({
        ...item,
        latest_run: item.latest_run ? enrichDeepWikiRunState(item.latest_run) : null,
        sync_result: item.sync_config?.last_result || null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects', async (_req, res, next) => {
  try {
    const data = await db.listDeepWikiProjects();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/projects', async (req, res, next) => {
  try {
    const data = await db.createDeepWikiProject(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/projects/bootstrap', async (req, res, next) => {
  try {
    const data = await db.bootstrapDeepWikiProjects(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiProjectById(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/repos', async (req, res, next) => {
  try {
    const project = await db.getDeepWikiProjectById(Number(req.params.id));
    if (!project) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    res.json({ success: true, data: project.repos || [] });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/projects/:id/repos', async (req, res, next) => {
  try {
    const data = await db.addRepoToDeepWikiProject(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/branches', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiProjectBranches(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/version-lines', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiVersionLines(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/projects/:id/version-lines', async (req, res, next) => {
  try {
    const data = await db.createDeepWikiVersionLine(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/branches/:id/repo-mapping', async (req, res, next) => {
  try {
    const data = await db.updateDeepWikiBranchRepoMapping(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki branch not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/snapshots', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiProjectSnapshots(Number(req.params.id), {
      branch: req.query.branch || null,
      version_line_id: req.query.version_line_id || null,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/version-lines/:id/snapshots', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiSnapshotsByVersionLine(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki version line not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/version-lines/:id/snapshots/generate', async (req, res, next) => {
  try {
    const versionLine = await db.getDeepWikiVersionLineById(Number(req.params.id));
    if (!versionLine) {
      return res.status(404).json({ success: false, error: 'Deep Wiki version line not found' });
    }
    const data = await db.createDeepWikiRunRequest({
      ...(req.body || {}),
      project_id: versionLine.project_id,
      version_line_id: versionLine.id,
      branch: versionLine.branch,
    });
    deepWikiQueue.enqueue(data.run_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/default-published-snapshot', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiProjectDefaultPublishedSnapshot(Number(req.params.id), String(req.query.branch || ''));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Published snapshot not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/projects/:id/regenerate', async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = await db.createDeepWikiRunRequest({
      ...body,
      project_id: Number(req.params.id),
      branch: body.branch || '',
    });
    deepWikiQueue.enqueue(data.run_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/providers', async (_req, res, next) => {
  try {
    const data = await db.getDeepWikiProviders();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

async function loadDeepWikiProjectionBySnapshotId(snapshotId) {
  const overview = await db.getDeepWikiSnapshotOverview(Number(snapshotId));
  if (!overview?.snapshot) {
    return null;
  }
  const dbProjection = await db.getDeepWikiTemplateProjectionBySnapshotId(Number(snapshotId));
  const fileProjection = readSnapshotProjection(overview.snapshot);

  const preferArray = (primary, fallback) =>
    Array.isArray(primary) && primary.length ? primary : Array.isArray(fallback) ? fallback : [];
  const preferObject = (primary, fallback) =>
    primary && typeof primary === 'object' && !Array.isArray(primary) && Object.keys(primary).length
      ? primary
      : fallback && typeof fallback === 'object' && !Array.isArray(fallback)
        ? fallback
        : null;

  const mergeProjection = (primary, fallback) => {
    if (!primary) return fallback || null;
    if (!fallback) return primary;
    return {
      contracts: {
        stages: preferArray(primary.contracts?.stages, fallback.contracts?.stages),
        skills: preferArray(primary.contracts?.skills, fallback.contracts?.skills),
      },
      stageRuns: preferArray(primary.stageRuns, fallback.stageRuns),
      skillExecutions: preferArray(primary.skillExecutions, fallback.skillExecutions),
      assetLineage: preferArray(primary.assetLineage, fallback.assetLineage),
      assets: preferArray(primary.assets, fallback.assets),
      gateDecisions: preferArray(primary.gateDecisions, fallback.gateDecisions),
      scores: {
        projectScores: preferArray(primary.scores?.projectScores, fallback.scores?.projectScores),
        snapshotScores: preferArray(primary.scores?.snapshotScores, fallback.scores?.snapshotScores),
        domainScores: preferArray(primary.scores?.domainScores, fallback.scores?.domainScores),
        capabilityScores: preferArray(primary.scores?.capabilityScores, fallback.scores?.capabilityScores),
        flowScores: preferArray(primary.scores?.flowScores, fallback.scores?.flowScores),
        journeyScores: preferArray(primary.scores?.journeyScores, fallback.scores?.journeyScores),
        pageScores: preferArray(primary.scores?.pageScores, fallback.scores?.pageScores),
        diagramScores: preferArray(primary.scores?.diagramScores, fallback.scores?.diagramScores),
        solutionScores: preferArray(primary.scores?.solutionScores, fallback.scores?.solutionScores),
        scoreBreakdowns: preferObject(primary.scores?.scoreBreakdowns, fallback.scores?.scoreBreakdowns) || {},
        rankingViews: preferObject(primary.scores?.rankingViews, fallback.scores?.rankingViews) || {},
        scoreRegressions: preferArray(primary.scores?.scoreRegressions, fallback.scores?.scoreRegressions),
        healthIndices: preferObject(primary.scores?.healthIndices, fallback.scores?.healthIndices),
      },
    };
  };

  return {
    overview,
    projection: mergeProjection(dbProjection, fileProjection),
  };
}

async function resolveDeepWikiProjectProjectionSnapshot(projectId, requestedSnapshotId) {
  const numericProjectId = Number(projectId || 0);
  if (!numericProjectId) return null;
  if (Number(requestedSnapshotId || 0)) {
    const requestedOverview = await db.getDeepWikiSnapshotOverview(Number(requestedSnapshotId));
    if (Number(requestedOverview?.snapshot?.project_id || 0) === numericProjectId) {
      return requestedOverview.snapshot;
    }
  }
  const project = await db.getDeepWikiProjectById(numericProjectId);
  if (!project) return null;
  if (project.latest_published_snapshot?.id) {
    return project.latest_published_snapshot;
  }
  const defaultPublished = await db.getDeepWikiProjectDefaultPublishedSnapshot(numericProjectId);
  if (defaultPublished?.id) {
    return defaultPublished;
  }
  const snapshots = await db.listDeepWikiProjectSnapshots(numericProjectId).catch(() => []);
  return snapshots[0] || null;
}

app.get('/api/v1/deepwiki/contracts', (_req, res) => {
  res.json({ success: true, data: listContracts() });
});

app.get('/api/v1/deepwiki/skills', (_req, res) => {
  const data = listSkillContracts();
  res.json({
    success: true,
    data: {
      override_file: DEEPWIKI_SKILL_OVERRIDE_FILE,
      skills: data,
    },
  });
});

app.get('/api/v1/deepwiki/skills/:skillKey', (req, res) => {
  const data = getSkillContract(req.params.skillKey);
  if (!data) {
    return res.status(404).json({ success: false, error: 'Deep Wiki skill not found' });
  }
  res.json({
    success: true,
    data: {
      override_file: DEEPWIKI_SKILL_OVERRIDE_FILE,
      skill: data,
    },
  });
});

app.put('/api/v1/deepwiki/skills/:skillKey', (req, res, next) => {
  try {
    const skill = updateSkillContractOverride(req.params.skillKey, req.body || {});
    res.json({
      success: true,
      data: {
        override_file: DEEPWIKI_SKILL_OVERRIDE_FILE,
        skill,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/v1/deepwiki/skills/:skillKey', (req, res, next) => {
  try {
    const skill = resetSkillContractOverride(req.params.skillKey);
    res.json({
      success: true,
      data: {
        override_file: DEEPWIKI_SKILL_OVERRIDE_FILE,
        skill,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/deepwiki/knowledge-os-admin', (_req, res) => {
  const htmlPath = path.join(__dirname, 'static', 'knowledge-os-admin.html');
  res.type('html').send(fs.readFileSync(htmlPath, 'utf8'));
});

app.get('/api/v1/deepwiki/knowledge-os/files', (_req, res, next) => {
  try {
    const files = listKnowledgeOsEditableFiles();
    res.json({ success: true, data: { files, root: 'ai-rules/skills/knowledge-os' } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/knowledge-os/bundle', (req, res, next) => {
  try {
    const repoSlug = String(req.query.repo_slug || '').trim();
    const bundle = loadKnowledgeOsBundleSafe({ repo_slug: repoSlug });
    res.json({ success: true, data: bundle });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/knowledge-os/file', (req, res) => {
  try {
    const rel = String(req.query.path || '');
    const { path: p, content } = readKnowledgeOsRelative(rel);
    res.json({ success: true, data: { path: p, content } });
  } catch (error) {
    const msg = String(error.message || 'error');
    if (msg.includes('Invalid') || msg.includes('Not found')) {
      return res.status(400).json({ success: false, error: msg });
    }
    return res.status(500).json({ success: false, error: msg });
  }
});

app.put('/api/v1/deepwiki/knowledge-os/file', (req, res) => {
  try {
    const { path: relPath, content } = req.body || {};
    const out = writeKnowledgeOsRelative(relPath, content);
    res.json({ success: true, data: out });
  } catch (error) {
    const msg = String(error.message || 'error');
    if (msg.includes('Invalid')) {
      return res.status(400).json({ success: false, error: msg });
    }
    return res.status(500).json({ success: false, error: msg });
  }
});

app.get('/api/v1/deepwiki/models', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiModels(String(req.query.provider || ''));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/repos/:id/branches', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiRepoBranches(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki repository not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/runs', async (req, res, next) => {
  try {
    const data = await db.createDeepWikiRunRequest(req.body || {});
    deepWikiQueue.enqueue(data.run_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/sync', async (req, res, next) => {
  try {
    const data = await db.requestDeepWikiSync(req.body || {});
    if (!data.noop && data.run_id) {
      deepWikiQueue.enqueue(data.run_id);
    }
    res.status(data.noop ? 200 : 201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/repos/:id/sync-config', async (req, res, next) => {
  try {
    const data = await db.updateRepoSourceSyncConfig(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki repository not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/webhook/git', async (req, res, next) => {
  try {
    const payload = req.body || {};
    const repoCandidates = [
      payload.repo_url,
      payload.repository?.git_http_url,
      payload.repository?.homepage,
      payload.repository?.url,
      payload.project?.git_http_url,
      payload.project?.web_url,
      payload.project?.homepage,
    ].filter(Boolean);
    const repoSource = await db.findRepoSourceForWebhook(repoCandidates);
    const repoUrl = repoSource?.repo_url || repoCandidates[0] || null;
    const ref = String(payload.ref || payload.branch || '').trim();
    const branch = ref.startsWith('refs/heads/') ? ref.replace('refs/heads/', '') : ref;
    const gitlabEvent = normalizeHeaderValue(req.headers['x-gitlab-event']);
    const objectKind = String(payload.object_kind || '').trim();
    const syncStateBase = repoSource
      ? {
          last_webhook_at: new Date().toISOString(),
          last_webhook_repo_url: repoUrl,
          last_webhook_branch: branch || null,
          last_webhook_event: objectKind || gitlabEvent || 'push',
        }
      : null;

    if (!repoUrl) {
      return res.status(400).json({ success: false, error: 'Webhook payload missing repository URL' });
    }

    if (repoSource && syncStateBase) {
      await db.updateRepoSourceSyncState(repoSource.id, syncStateBase);
    }

    if (gitlabEvent && gitlabEvent !== 'Push Hook') {
      if (repoSource) {
        await db.updateRepoSourceSyncState(repoSource.id, {
          ...syncStateBase,
          last_webhook_result: 'ignored',
          last_webhook_error: null,
        });
      }
      return res.status(202).json({
        success: true,
        data: {
          ignored: true,
          reason: 'unsupported_event',
          event: gitlabEvent,
        },
      });
    }

    if (!branch) {
      if (repoSource) {
        await db.updateRepoSourceSyncState(repoSource.id, {
          ...syncStateBase,
          last_webhook_result: 'ignored',
          last_webhook_error: 'missing_branch',
        });
      }
      return res.status(202).json({
        success: true,
        data: {
          ignored: true,
          reason: 'missing_branch',
        },
      });
    }

    if (!repoSource) {
      return res.status(404).json({ success: false, error: 'Deep Wiki repository not registered' });
    }

    const syncConfig = repoSource.metadata_json?.sync || {};
    const expectedSecret = String(syncConfig.webhook_secret || '').trim();
    const providedSecrets = extractWebhookSecretCandidates(req, payload);
    if (expectedSecret && !providedSecrets.some((item) => safeCompareSecret(expectedSecret, item))) {
      await db.updateRepoSourceSyncState(repoSource.id, {
        ...syncStateBase,
        last_webhook_result: 'rejected',
        last_webhook_error: 'invalid_secret',
      });
      return res.status(403).json({ success: false, error: 'Invalid webhook secret' });
    }

    const data = await db.requestDeepWikiSync({
      repo_url: repoSource.repo_url,
      branch,
      project_code: payload.project_code || syncConfig.project_code || payload.project?.path_with_namespace || null,
      focus_prompt: payload.focus_prompt || syncConfig.focus_prompt || '',
      force: Boolean(payload.force),
    });
    if (!data.noop && data.run_id) {
      deepWikiQueue.enqueue(data.run_id);
    }
    await db.updateRepoSourceSyncState(repoSource.id, {
      ...syncStateBase,
      last_webhook_result: data.noop ? 'up_to_date' : 'queued',
      last_webhook_error: null,
      last_webhook_run_id: data.run_id || null,
      last_webhook_trace_id: data.trace_id || null,
      last_webhook_commit_sha: data.preflight?.commit_sha || null,
    });
    res.status(data.noop ? 200 : 201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/scheduler/status', (_req, res) => {
  res.json({
    success: true,
    data: deepWikiScheduler.status(),
  });
});

app.post('/api/v1/deepwiki/scheduler/tick', async (_req, res, next) => {
  try {
    const data = await deepWikiScheduler.tick();
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/runs/:id/doc-bundles', async (req, res, next) => {
  try {
    const data = await db.createDocBundleFromDeepWikiRun(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki run not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/overview', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiSnapshotOverview(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/runs/:id', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiRunById(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki run not found' });
    }
    res.json({ success: true, data: enrichDeepWikiRunState(data) });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/runs/:id/graph', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiGraphByRunId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki graph not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/runs/:id/pages', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiPages(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/runs/:id/pages/:pageId/content', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiPageContent(Number(req.params.id), Number(req.params.pageId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki page not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/repo-revisions', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiSnapshotRepoRevisions(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/pages', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiPagesBySnapshotId(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/pages/:pageId/content', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiPageContentBySnapshotId(Number(req.params.id), Number(req.params.pageId));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki page not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/graph', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiGraphBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot graph not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/diagrams', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiSnapshotDiagrams(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/threads', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiThreads(Number(req.params.id), req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/domains', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiDomains(Number(req.params.id), req.query || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/domains/:domainKey', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiDomainByKey(Number(req.params.id), req.params.domainKey);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki domain not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/threads/:threadKey', async (req, res, next) => {
  try {
    const thread = await db.getDeepWikiThreadByKey(Number(req.params.id), req.params.threadKey);
    if (!thread) {
      return res.status(404).json({ success: false, error: 'Deep Wiki thread not found' });
    }
    const [pages, diagrams] = await Promise.all([
      db.listDeepWikiPagesBySnapshotId(Number(req.params.id)),
      db.listDeepWikiSnapshotDiagrams(Number(req.params.id)),
    ]);
    const data = {
      ...thread,
      pages: pages.filter((item) => String(item.metadata_json?.thread_key || '') === String(thread.thread_key || '')),
      diagrams: diagrams.filter((item) => String(item.scope_key || '') === String(thread.thread_key || '')),
    };
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/snapshots/:id/diagrams/regenerate', async (req, res, next) => {
  try {
    const data = await db.regenerateDeepWikiSnapshotDiagrams(Number(req.params.id), req.body || {});
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/diagram-context', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiDiagramContextBySnapshotId(Number(req.params.id));
    res.json({ success: true, data: data || {} });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/diagrams/:diagramType/download', async (req, res, next) => {
  try {
    const format = String(req.query.format || 'mmd').toLowerCase();
    const asset = await db.downloadDeepWikiDiagramAssetBySnapshotId(
      Number(req.params.id),
      req.params.diagramType,
      format
    );
    if (!asset) {
      return res.status(404).json({ success: false, error: 'Deep Wiki diagram export not found' });
    }
    res.setHeader('Content-Type', asset.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${asset.filename}"`);
    res.send(asset.buffer);
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/objects', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiSnapshotObjects(Number(req.params.id), req.query.object_type || null);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/flows', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiFlows(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/assertions', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiAssertions(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/scenarios', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiScenarios(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/semantic-scores', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiSemanticScores(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/snapshots/:id/query', async (req, res, next) => {
  try {
    const data = await db.queryDeepWikiSnapshot(Number(req.params.id), req.body || {});
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/quality-report', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiQualityReportBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki quality report not found' });
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/quality', async (req, res, next) => {
  try {
    const data = await db.getDeepWikiSnapshotQuality(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/stages', async (req, res, next) => {
  try {
    const data = await loadDeepWikiProjectionBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.json({
      success: true,
      data: {
        snapshot: data.overview.snapshot,
        stage_runs: data.projection?.stageRuns || [],
        contracts: data.projection?.contracts?.stages || [],
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/stage-assets', async (req, res, next) => {
  try {
    const data = await loadDeepWikiProjectionBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.json({
      success: true,
      data: {
        snapshot: data.overview.snapshot,
        assets: data.projection?.assets || [],
        asset_lineage: data.projection?.assetLineage || [],
        skill_executions: data.projection?.skillExecutions || [],
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/evidence', async (req, res, next) => {
  try {
    const data = await loadDeepWikiProjectionBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    const evidence = (data.projection?.assets || []).find((item) => item.assetKey === 'evidence_index') || null;
    const confidence = (data.projection?.assets || []).find((item) => item.assetKey === 'confidence_report') || null;
    res.json({ success: true, data: { evidence, confidence } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/gate-decisions', async (req, res, next) => {
  try {
    const data = await loadDeepWikiProjectionBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    const gateDecisions = (data.projection?.assets || []).find((item) => item.assetKey === 'gate_decisions') || null;
    res.json({
      success: true,
      data: {
        gate_decisions: gateDecisions,
        gate_decision_rows: data.projection?.gateDecisions || [],
        quality_report: (data.projection?.assets || []).find((item) => item.assetKey === 'quality_report') || null,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/topology', async (req, res, next) => {
  try {
    const project = await db.getDeepWikiProjectById(Number(req.params.id));
    if (!project) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    const requestedSnapshotId = Number(req.query.snapshot_id || 0);
    const requestedSnapshot =
      requestedSnapshotId ? (await db.getDeepWikiSnapshotOverview(requestedSnapshotId))?.snapshot : null;
    const snapshot =
      (requestedSnapshot && Number(requestedSnapshot.project_id) === Number(project.id) ? requestedSnapshot : null) ||
      project.latest_published_snapshot ||
      (await db.getDeepWikiProjectDefaultPublishedSnapshot(Number(req.params.id))) ||
      null;
    if (!snapshot?.id) {
      return res.json({ success: true, data: { project, topology: null } });
    }
    const data = await loadDeepWikiProjectionBySnapshotId(Number(snapshot.id));
    const topology = (data?.projection?.assets || []).find((item) => item.assetKey === 'project_topology') || null;
    res.json({ success: true, data: { project, snapshot: data?.overview?.snapshot || snapshot, topology } });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/consistency-checks', async (req, res, next) => {
  try {
    const data = await db.listDeepWikiConsistencyChecks(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/feedback/:pipelineType', async (req, res, next) => {
  try {
    const body = req.body || {};
    const data = await db.createDeepWikiFeedbackEvent({
      ...body,
      source_pipeline: String(req.params.pipelineType || ''),
      feedback_type: body.feedback_type || String(req.params.pipelineType || ''),
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/snapshots/:id/publish', async (req, res, next) => {
  try {
    const snapshotId = Number(req.params.id);
    const data = await db.publishDeepWikiSnapshot(snapshotId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    let devin_generation_job = null;
    if (await devinDeepWikiSyncService.isAutoSyncEnabled()) {
      try {
        devin_generation_job = await devinDeepWikiSyncService.queueSnapshot(snapshotId, {
          requested_by: 'snapshot_publish_api',
          auto_sync_on_publish: true,
        });
        if (devin_generation_job?.id) {
          devinDeepWikiQueue.enqueue(devin_generation_job.id);
        }
      } catch (error) {
        logger.error('devin deepwiki auto sync queue failed', {
          snapshot_id: snapshotId,
          error: error.message,
        });
      }
    }
    res.status(201).json({ success: true, data: { ...data, devin_generation_job } });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/snapshots/:id/devin-sync', async (req, res, next) => {
  try {
    const snapshotId = Number(req.params.id);
    const dryRun = Boolean(req.body?.dry_run);
    const job = await devinDeepWikiSyncService.queueSnapshot(snapshotId, {
      requested_by: 'snapshot_devin_sync_api',
      dry_run: dryRun,
      allow_draft: dryRun,
      ...(req.body || {}),
    });
    if (job?.id) {
      devinDeepWikiQueue.enqueue(job.id);
    }
    res.status(201).json({ success: true, data: job });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/snapshots/:id/approval', async (req, res, next) => {
  try {
    const snapshotId = Number(req.params.id);
    const approvalStatus = String(req.body?.approval_status || req.body?.decision || 'approved');
    const data = await db.updateDeepWikiSnapshotApprovalStatus(snapshotId, approvalStatus, {
      approval_updated_via: 'snapshot_approval_api',
      approval_note: req.body?.note || null,
    });
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/snapshots/:id/doc-bundles/tech-spec', async (req, res, next) => {
  try {
    const data = await db.createDocBundleFromDeepWikiSnapshot(Number(req.params.id), {
      ...(req.body || {}),
      mode: 'tech_spec',
    });
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/snapshots/:id/doc-bundles/test-plan', async (req, res, next) => {
  try {
    const data = await db.createDocBundleFromDeepWikiSnapshot(Number(req.params.id), {
      ...(req.body || {}),
      mode: 'test_plan',
    });
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:projectId/feedback-events', async (req, res, next) => {
  try {
    const projectId = Number(req.params.projectId);
    if (!Number.isFinite(projectId)) {
      return res.status(400).json({ success: false, error: 'invalid projectId' });
    }
    const snapshotId = req.query.snapshot_id != null && req.query.snapshot_id !== '' ? Number(req.query.snapshot_id) : undefined;
    const sourcePipeline = req.query.source_pipeline ? String(req.query.source_pipeline) : undefined;
    const data = await db.listDeepWikiFeedbackEvents({
      project_id: projectId,
      snapshot_id: Number.isFinite(snapshotId) ? snapshotId : undefined,
      source_pipeline: sourcePipeline,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/scores', async (req, res, next) => {
  try {
    const snapshot = await resolveDeepWikiProjectProjectionSnapshot(Number(req.params.id), Number(req.query.snapshot_id || 0));
    if (!snapshot?.id) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    const data = await loadDeepWikiProjectionBySnapshotId(Number(snapshot.id));
    res.json({ success: true, data: data?.projection?.scores?.projectScores || [] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/projects/:id/health', async (req, res, next) => {
  try {
    const snapshot = await resolveDeepWikiProjectProjectionSnapshot(Number(req.params.id), Number(req.query.snapshot_id || 0));
    if (!snapshot?.id) {
      return res.status(404).json({ success: false, error: 'Deep Wiki project not found' });
    }
    const data = await loadDeepWikiProjectionBySnapshotId(Number(snapshot.id));
    res.json({ success: true, data: data?.projection?.scores?.healthIndices || null });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/scores', async (req, res, next) => {
  try {
    const data = await loadDeepWikiProjectionBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.json({ success: true, data: data.projection?.scores?.snapshotScores || [] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/score-breakdowns', async (req, res, next) => {
  try {
    const data = await loadDeepWikiProjectionBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.json({ success: true, data: data.projection?.scores?.scoreBreakdowns || {} });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/snapshots/:id/score-regressions', async (req, res, next) => {
  try {
    const data = await loadDeepWikiProjectionBySnapshotId(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    res.json({ success: true, data: data.projection?.scores?.scoreRegressions || [] });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/domains/:id/scores', async (req, res, next) => {
  try {
    const snapshotId = Number(req.query.snapshot_id || 0);
    if (!snapshotId) {
      return res.status(400).json({ success: false, error: 'snapshot_id is required' });
    }
    const data = await loadDeepWikiProjectionBySnapshotId(snapshotId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    const rows = (data.projection?.scores?.domainScores || []).filter((item) => String(item.entity_id || '') === String(req.params.id));
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/flows/:id/scores', async (req, res, next) => {
  try {
    const snapshotId = Number(req.query.snapshot_id || 0);
    if (!snapshotId) {
      return res.status(400).json({ success: false, error: 'snapshot_id is required' });
    }
    const data = await loadDeepWikiProjectionBySnapshotId(snapshotId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    const rows = (data.projection?.scores?.flowScores || []).filter((item) => String(item.entity_id || '') === String(req.params.id));
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/solutions/:id/scores', async (req, res, next) => {
  try {
    const snapshotId = Number(req.query.snapshot_id || 0);
    if (!snapshotId) {
      return res.status(400).json({ success: false, error: 'snapshot_id is required' });
    }
    const data = await loadDeepWikiProjectionBySnapshotId(snapshotId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    const rows = (data.projection?.scores?.solutionScores || []).filter((item) => String(item.entity_id || '') === String(req.params.id));
    res.json({ success: true, data: rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/deepwiki/rankings/:viewKey', async (req, res, next) => {
  try {
    const snapshotId = Number(req.query.snapshot_id || 0);
    if (!snapshotId) {
      return res.status(400).json({ success: false, error: 'snapshot_id is required' });
    }
    const data = await loadDeepWikiProjectionBySnapshotId(snapshotId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki snapshot not found' });
    }
    const rankingViews = data.projection?.scores?.rankingViews || {};
    res.json({ success: true, data: rankingViews[String(req.params.viewKey || '')] || null });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/runs/:id/retry', async (req, res, next) => {
  try {
    const data = await db.resetDeepWikiRunForRetry(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki run not found' });
    }
    deepWikiQueue.enqueue(Number(req.params.id));
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/api/v1/deepwiki/runs/:id/reingest', async (req, res, next) => {
  try {
    const data = await db.reingestDeepWikiRun(Number(req.params.id));
    if (!data) {
      return res.status(404).json({ success: false, error: 'Deep Wiki run not found' });
    }
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.post('/internal/gate-executions/sync', async (req, res, next) => {
  try {
    const data = await db.syncGateExecution(req.body || {});
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  logger.error('control-plane error', {
    error: err.message,
    stack: err.stack,
  });
  res.status(Number(err.status) || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    blockers: Array.isArray(err.blockers) ? err.blockers : undefined,
  });
});

deepWikiScheduler.start();
devinDeepWikiSyncScheduler.start();
harnessStore.ensureSchema().catch((error) => {
  logger.error('failed to ensure harness schema', { error: error.message });
});
approvalStore.ensureSchema().catch((error) => {
  logger.error('failed to ensure approval schema', { error: error.message });
});
harnessStore.subscribe((event) => {
  void handleHarnessNotificationEvent(event);
});

app.listen(PORT, () => {
  logger.info(`control-plane started on ${PORT}`);
  console.log(`🧭 Control Plane running on http://localhost:${PORT}`);
});
