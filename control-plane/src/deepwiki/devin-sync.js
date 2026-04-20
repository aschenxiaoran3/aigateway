const fs = require('fs');
const path = require('path');

const { resolveStoreRootFromSnapshot } = require('./runtime');
const { assertPublishedBaseline, isPublishedSnapshot } = require('./snapshot-state-machine');

function normalizeText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of toArray(values)) {
    const text = normalizeText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function parseTimestamp(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : 0;
}

function nowSqlTimestamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function summarizePagePurpose(page) {
  const title = normalizeText(page.title || page.pageSlug || page.page_slug);
  const summary = normalizeText(page.summary || page.summary_markdown);
  const repos = uniqueStrings(page.participatingRepos || page.participating_repos);
  const diagrams = uniqueStrings(page.coveredDiagrams || page.covered_diagrams);
  return [
    summary || `${title} 的业务与技术说明页面`,
    repos.length ? `重点覆盖仓库：${repos.join('、')}` : '',
    diagrams.length ? `关联图表：${diagrams.join('、')}` : '',
    normalizeText(page.evidenceAsset || page.evidence_asset) ? '必须保留证据链和源码/接口/数据表引用。' : '',
  ]
    .filter(Boolean)
    .join('；');
}

function buildRepoNotes(input = {}) {
  const project = ensureObject(input.project);
  const snapshot = ensureObject(input.snapshot);
  const overview = ensureObject(input.overview);
  const topologyAsset = ensureObject(input.topologyAsset);
  const domainModelAsset = ensureObject(input.domainModelAsset);
  const gateAsset = ensureObject(input.gateAsset);
  const riskGapAsset = ensureObject(input.riskGapAsset);
  const repoRevisions = toArray(overview.repo_revisions);
  const repos = toArray(topologyAsset.payload?.repos || topologyAsset.repos || repoRevisions);
  const domains = toArray(domainModelAsset.payload?.domains || domainModelAsset.domains);
  const gateBlockers = uniqueStrings([
    ...toArray(overview.publish_blockers),
    ...toArray(gateAsset.payload?.blockers),
  ]);
  const riskSections = toArray(riskGapAsset.payload || []);

  const dryRun = Boolean(input.dry_run);
  return [
    {
      author: 'ai-platform',
      content: [
        `当前代码仓库群对应项目 ${normalizeText(project.project_name || project.project_code || project.id || '未知项目')}，这是一个多仓 DeepWiki ${dryRun ? 'draft preview' : 'published snapshot'} 导出。`,
        dryRun
          ? `当前 snapshot 版本 ${normalizeText(snapshot.snapshot_version || snapshot.commit_sha || snapshot.id)} 还未正式发布，本次仅用于 Devin dry run 验证，不得回写为正式方案基线。`
          : `正式基线要求：只接受 snapshot.status = published 的内容；当前 snapshot 版本 ${normalizeText(snapshot.snapshot_version || snapshot.commit_sha || snapshot.id)} 已通过平台发布。`,
        repos.length
          ? `优先覆盖这些仓库及其交互：${repos.map((repo) => `${normalizeText(repo.repoId || repo.repo_slug || repo.repo_source_id)}(${normalizeText(repo.role || repo.repo_role || 'unknown')})`).join('、')}`
          : '',
        domains.length
          ? `优先从业务域视角组织文档：${domains.map((domain) => normalizeText(domain.name || domain.domain_name || domain.key)).filter(Boolean).join('、')}`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
    {
      author: 'ai-platform',
      content: [
        `当前导出来自${dryRun ? 'draft snapshot 预演' : '已发布 snapshot'}，必须保持业务优先而不是类名优先。`,
        `页面要体现 项目 -> 业务域 -> 线程/旅程 -> 图表/接口/数据表 的层级，不要退回到 controller/service/table 的平铺说明。`,
        gateBlockers.length ? `历史发布阻塞项记录：${gateBlockers.join('、')}。` : '',
      ]
        .filter(Boolean)
        .join(' '),
    },
    ...(riskSections.length
      ? [
          {
            author: 'ai-platform',
            content: `当前 snapshot 仍需注意这些风险或缺口：${riskSections
              .map((item) => `${normalizeText(item.title)}:${normalizeText(item.detail)}`)
              .filter(Boolean)
              .join('；')}`,
          },
        ]
      : []),
  ].filter((item) => normalizeText(item.content));
}

function buildDevinWikiConfig(input = {}) {
  const wikiPages = toArray(input.wikiPages);
  const repoNotes = buildRepoNotes(input).slice(0, 100);
  const sortedPages = wikiPages
    .map((page) => ({
      title: normalizeText(page.title || page.pageSlug || page.page_slug),
      purpose: summarizePagePurpose(page),
      parent: normalizeText(page.parentTitle || page.parent_title || page.parent) || null,
      page_notes: uniqueStrings([
        normalizeText(page.pageType || page.page_type) ? `页面类型：${normalizeText(page.pageType || page.page_type)}` : '',
        normalizeText(page.sourceUri || page.source_uri) ? `平台源 URI：${normalizeText(page.sourceUri || page.source_uri)}` : '',
      ]).map((content) => ({ content })),
    }))
    .filter((page) => page.title && page.purpose)
    .slice(0, 30);

  return {
    repo_notes: repoNotes,
    pages: sortedPages,
  };
}

function buildDevinPrompt(input = {}) {
  const project = ensureObject(input.project);
  const snapshot = ensureObject(input.snapshot);
  const attachments = toArray(input.attachments);
  const dryRun = Boolean(input.dry_run);
  const requirements = [
    `为项目 ${normalizeText(project.project_name || project.project_code || project.id || '未知项目')} 生成或更新 Devin DeepWiki。`,
    `必须把附带的 wiki 配置视为 .devin/wiki.json 的权威版本，并严格按其中 pages 生成页面结构。`,
    dryRun
      ? `这是一份来自我们平台 draft snapshot 的 dry run 预演，只用于验证 session 创建、附件上传和 wiki 结构，不得视为正式发布基线。`
      : `这是一份来自我们平台已发布 snapshot 的正式基线，不能退回成类名/文件夹导向的平铺文档。`,
    `文档必须优先体现业务域、核心线程、前后端/服务/数据库/事件闭环，以及多仓交互关系。`,
    `如果缺少仓库访问能力，请明确指出哪些仓库无法直接索引，并基于附件给出最接近目标的 wiki 结构与缺口报告。`,
    `会话完成后，请在最终回复中简要说明：1) 覆盖了哪些页面；2) 仍缺哪些关键上下文；3) 是否需要补充仓库接入。`,
  ];
  const promptLines = [
    `${dryRun ? 'Draft snapshot dry run' : 'Published snapshot handoff'}: ${normalizeText(snapshot.snapshot_version || snapshot.commit_sha || snapshot.id)}`,
    ...requirements,
    '',
    ...attachments.map((url) => `ATTACHMENT:"${url}"`),
  ];
  return promptLines.join('\n');
}

function buildHandoffMarkdown(input = {}) {
  const project = ensureObject(input.project);
  const snapshot = ensureObject(input.snapshot);
  const overview = ensureObject(input.overview);
  const wikiPages = toArray(input.wikiPages);
  const topologyRepos = toArray(input.topologyAsset?.payload?.repos || input.topologyAsset?.repos);
  const domains = toArray(input.domainModelAsset?.payload?.domains || input.domainModelAsset?.domains);
  const gatePayload = ensureObject(input.gateAsset?.payload || input.gateAsset);
  const dryRun = Boolean(input.dry_run);
  const lines = [
    '# Devin DeepWiki Handoff',
    '',
    `- Mode: ${dryRun ? 'draft_preview' : 'published_sync'}`,
    `- Project: ${normalizeText(project.project_name || project.project_code || project.id) || 'unknown'}`,
    `- Snapshot: ${normalizeText(snapshot.snapshot_version || snapshot.commit_sha || snapshot.id) || 'unknown'}`,
    `- Snapshot status: ${normalizeText(snapshot.status) || 'unknown'}`,
    `- Published at: ${normalizeText(snapshot.published_at) || 'unknown'}`,
    `- Repo count: ${toArray(overview.repo_revisions).length}`,
    `- Document count: ${toArray(overview.document_revisions).length}`,
    `- Diagram count: ${toArray(overview.diagram_assets).length}`,
    '',
    '## Repositories',
    ...topologyRepos.map((repo) => `- ${normalizeText(repo.repoId || repo.repo_slug)} (${normalizeText(repo.role || repo.repo_role || 'unknown')}) @ ${normalizeText(repo.branch || '')} ${normalizeText(repo.commitSha || repo.commit_sha || '')}`),
    '',
    '## Domains',
    ...domains.map((domain) => `- ${normalizeText(domain.name || domain.domain_name || domain.key)}: ${(toArray(domain.capabilities).join('、') || '待补充')}`),
    '',
    '## Publish Gates',
    `- Publish ready: ${String(Boolean(gatePayload.publishReady || gatePayload.publish_ready))}`,
    `- Quality blocked: ${String(Boolean(gatePayload.qualityGateBlocked || gatePayload.quality_gate_blocked))}`,
    `- Blockers: ${uniqueStrings(gatePayload.blockers).join('、') || 'none'}`,
    '',
    '## Planned Wiki Pages',
    ...wikiPages.slice(0, 30).map((page) => `- ${normalizeText(page.title || page.pageSlug || page.page_slug)}: ${summarizePagePurpose(page)}`),
    '',
  ];
  return lines.join('\n');
}

function buildManifestJson(input = {}) {
  const overview = ensureObject(input.overview);
  return {
    mode: input.dry_run ? 'draft_preview' : 'published_sync',
    project: input.project || null,
    snapshot: input.snapshot || null,
    source_coverage: overview.source_coverage || null,
    repo_revisions: overview.repo_revisions || [],
    document_revisions: overview.document_revisions || [],
    diagram_assets: overview.diagram_assets || [],
    topology: input.topologyAsset?.payload || input.topologyAsset || null,
    domain_model: input.domainModelAsset?.payload || input.domainModelAsset || null,
    gate_decisions: input.gateAsset?.payload || input.gateAsset || null,
    wiki_pages: input.wikiPages || [],
  };
}

function exportDevinSnapshotArtifacts(input = {}) {
  const snapshot = ensureObject(input.snapshot);
  const outputRoot = resolveStoreRootFromSnapshot(snapshot);
  const exportDir = path.join(outputRoot, '.deepwiki', 'snapshots', String(snapshot.id || 'unknown'), 'devin');
  const dotDevinDir = path.join(exportDir, '.devin');
  ensureDir(dotDevinDir);

  const wikiConfig = buildDevinWikiConfig(input);
  const wikiPath = path.join(dotDevinDir, 'wiki.json');
  fs.writeFileSync(wikiPath, JSON.stringify(wikiConfig, null, 2), 'utf8');

  const handoffPath = path.join(exportDir, 'deepwiki-handoff.md');
  fs.writeFileSync(handoffPath, buildHandoffMarkdown(input), 'utf8');

  const manifestPath = path.join(exportDir, 'snapshot-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(buildManifestJson(input), null, 2), 'utf8');

  return {
    export_dir: exportDir,
    wiki_path: wikiPath,
    handoff_path: handoffPath,
    manifest_path: manifestPath,
    wiki_config: wikiConfig,
  };
}

function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const text = normalizeText(value).toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function normalizeArrayValue(value) {
  if (Array.isArray(value)) return uniqueStrings(value);
  if (typeof value === 'string') {
    return uniqueStrings(value.split(/[,\n]/));
  }
  return [];
}

function loadDevinSettings(raw = {}) {
  const settings = ensureObject(raw);
  return {
    enabled: parseBoolean(settings.deepwiki_devin_enabled, Boolean(process.env.DEEPWIKI_DEVIN_API_KEY || process.env.DEVIN_API_KEY)),
    auto_sync_on_publish: parseBoolean(settings.deepwiki_devin_auto_sync_on_publish, false),
    api_key: normalizeText(settings.deepwiki_devin_api_key || process.env.DEEPWIKI_DEVIN_API_KEY || process.env.DEVIN_API_KEY),
    base_url: normalizeText(settings.deepwiki_devin_base_url || process.env.DEEPWIKI_DEVIN_BASE_URL || 'https://api.devin.ai'),
    playbook_id: normalizeText(settings.deepwiki_devin_playbook_id || process.env.DEEPWIKI_DEVIN_PLAYBOOK_ID),
    knowledge_ids: normalizeArrayValue(settings.deepwiki_devin_knowledge_ids || process.env.DEEPWIKI_DEVIN_KNOWLEDGE_IDS),
    max_acu_limit: Number(settings.deepwiki_devin_max_acu_limit || process.env.DEEPWIKI_DEVIN_MAX_ACU_LIMIT || 0) || null,
    unlisted: parseBoolean(settings.deepwiki_devin_unlisted, true),
  };
}

async function uploadAttachment(baseUrl, apiKey, filePath) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/attachments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Devin attachment upload failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
  return normalizeText(text.replace(/^"|"$/g, ''));
}

async function createSession(baseUrl, apiKey, payload) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`Devin session create failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getSession(baseUrl, apiKey, sessionId) {
  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/v1/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const text = await response.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`Devin session fetch failed: ${response.status} ${text}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function isFinishedSession(session = {}) {
  const statusEnum = normalizeText(session.status_enum).toLowerCase();
  const status = normalizeText(session.status).toLowerCase();
  return (
    statusEnum === 'finished' ||
    ['completed', 'complete', 'failed', 'error', 'exit', 'suspended', 'terminated', 'cancelled', 'canceled'].includes(status)
  );
}

function pickLatestSessionMessage(session = {}) {
  const messages = toArray(session.messages)
    .map((item) => ensureObject(item))
    .filter((item) => normalizeText(item.message));
  if (!messages.length) return null;
  const sorted = messages.slice().sort((left, right) => parseTimestamp(left.timestamp) - parseTimestamp(right.timestamp));
  const preferred = sorted
    .slice()
    .reverse()
    .find((item) => normalizeText(item.type).toLowerCase() === 'devin_message');
  const latest = preferred || sorted[sorted.length - 1];
  return {
    type: normalizeText(latest.type) || null,
    message: normalizeText(latest.message) || null,
    timestamp: normalizeText(latest.timestamp) || null,
    event_id: normalizeText(latest.event_id) || null,
  };
}

function mergeSessionResult(existingResult = {}, session = {}) {
  const result = ensureObject(existingResult, {});
  const latestMessage = pickLatestSessionMessage(session);
  return {
    ...result,
    devin_session_id: normalizeText(session.session_id) || result.devin_session_id || null,
    devin_status: normalizeText(session.status) || result.devin_status || null,
    devin_status_enum: normalizeText(session.status_enum) || result.devin_status_enum || null,
    devin_title: normalizeText(session.title) || result.devin_title || null,
    devin_updated_at: normalizeText(session.updated_at) || result.devin_updated_at || null,
    devin_created_at: normalizeText(session.created_at) || result.devin_created_at || null,
    devin_message_count: toArray(session.messages).length || result.devin_message_count || 0,
    devin_latest_message: latestMessage || result.devin_latest_message || null,
    devin_pull_request: session.pull_request != null ? session.pull_request : result.devin_pull_request || null,
    devin_structured_output: session.structured_output != null ? session.structured_output : result.devin_structured_output || null,
    devin_last_synced_at: new Date().toISOString(),
  };
}

function buildSessionRefreshPatch(job = {}, session = {}) {
  const finished = isFinishedSession(session);
  return {
    status: finished ? 'completed' : 'submitted',
    result_json: mergeSessionResult(job.result_json || {}, session),
    error_json: {},
    ended_at: finished ? nowSqlTimestamp() : null,
  };
}

function createDevinDeepWikiSyncService({ db, logger } = {}) {
  async function loadSyncContext(snapshotId, options = {}) {
    const [overview, projection] = await Promise.all([
      db.getDeepWikiSnapshotOverview(Number(snapshotId)),
      db.getDeepWikiTemplateProjectionBySnapshotId(Number(snapshotId)).catch(() => null),
    ]);
    if (!overview?.snapshot) {
      const error = new Error('Snapshot not found');
      error.status = 404;
      throw error;
    }
    if (!options.allow_draft) {
      assertPublishedBaseline(overview.snapshot);
    }
    return {
      project: overview.project || null,
      snapshot: overview.snapshot,
      overview,
      projection: projection || {},
      wikiPages: toArray(projection?.assets)
        .find((item) => normalizeText(item.assetKey) === 'wiki_pages')
        ?.payload || [],
      topologyAsset: toArray(projection?.assets).find((item) => normalizeText(item.assetKey) === 'project_topology') || null,
      domainModelAsset: toArray(projection?.assets).find((item) => normalizeText(item.assetKey) === 'domain_model') || null,
      gateAsset: toArray(projection?.assets).find((item) => normalizeText(item.assetKey) === 'gate_decisions') || null,
      riskGapAsset: toArray(projection?.assets).find((item) => normalizeText(item.assetKey) === 'risk_gap_sections') || null,
    };
  }

  async function queueSnapshot(snapshotId, options = {}) {
    const allowDraft = Boolean(options.allow_draft || options.dry_run);
    const context = await loadSyncContext(snapshotId, { allow_draft: allowDraft });
    const settings = loadDevinSettings(await db.getGatewaySettings().catch(() => ({})));
    if (!settings.enabled || !settings.api_key) {
      const error = new Error('Devin sync is not configured');
      error.status = 409;
      throw error;
    }
    const exported = exportDevinSnapshotArtifacts(context);
    return db.upsertDeepWikiGenerationJob({
      project_id: Number(context.snapshot.project_id),
      snapshot_id: Number(context.snapshot.id),
      run_id: context.snapshot.run_id || null,
      job_type: 'devin_deepwiki_sync',
      status: 'queued',
      requested_by: normalizeText(options.requested_by) || 'system',
      request_json: {
        snapshot_id: Number(context.snapshot.id),
        project_id: Number(context.snapshot.project_id),
        dry_run: allowDraft || !isPublishedSnapshot(context.snapshot),
        sync_mode: allowDraft || !isPublishedSnapshot(context.snapshot) ? 'draft_preview' : 'published_sync',
        export_dir: exported.export_dir,
        wiki_path: exported.wiki_path,
        handoff_path: exported.handoff_path,
        manifest_path: exported.manifest_path,
        auto_sync_on_publish: Boolean(options.auto_sync_on_publish),
      },
      result_json: {},
      error_json: {},
      started_at: null,
      ended_at: null,
    });
  }

  async function runJob(jobId) {
    const job = await db.getDeepWikiGenerationJobById(Number(jobId));
    if (!job) return null;
    const settings = loadDevinSettings(await db.getGatewaySettings().catch(() => ({})));
    if (!settings.enabled || !settings.api_key) {
      throw new Error('Devin sync is not configured');
    }
    const dryRun = Boolean(job.request_json?.dry_run);
    const context = await loadSyncContext(job.snapshot_id || job.request_json?.snapshot_id, {
      allow_draft: dryRun,
    });
    const exported = exportDevinSnapshotArtifacts({
      ...context,
      dry_run: dryRun,
    });
    await db.upsertDeepWikiGenerationJob({
      id: job.id,
      project_id: Number(context.snapshot.project_id),
      snapshot_id: Number(context.snapshot.id),
      run_id: context.snapshot.run_id || null,
      job_type: 'devin_deepwiki_sync',
      status: 'running',
      requested_by: job.requested_by || 'system',
      request_json: {
        ...(job.request_json || {}),
        export_dir: exported.export_dir,
        wiki_path: exported.wiki_path,
        handoff_path: exported.handoff_path,
        manifest_path: exported.manifest_path,
      },
      result_json: job.result_json || {},
      error_json: {},
      started_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      ended_at: null,
    });

    try {
      const attachmentFiles = [exported.wiki_path, exported.handoff_path, exported.manifest_path];
      const attachmentUrls = [];
      for (const filePath of attachmentFiles) {
        attachmentUrls.push(await uploadAttachment(settings.base_url, settings.api_key, filePath));
      }
      const prompt = buildDevinPrompt({
        ...context,
        attachments: attachmentUrls,
        dry_run: dryRun,
      });
      const sessionPayload = {
        prompt,
        title: `${normalizeText(context.project?.project_name || context.project?.project_code || 'DeepWiki')} · ${dryRun ? 'draft-preview' : 'snapshot'} ${normalizeText(context.snapshot.snapshot_version || context.snapshot.id)}`,
        tags: uniqueStrings([
          'ai-platform',
          'deepwiki',
          dryRun ? 'draft-preview' : 'published-snapshot',
          `project:${normalizeText(context.project?.project_code || context.project?.id)}`,
          `snapshot:${normalizeText(context.snapshot.id)}`,
        ]),
        knowledge_ids: settings.knowledge_ids.length ? settings.knowledge_ids : null,
        playbook_id: settings.playbook_id || null,
        max_acu_limit: settings.max_acu_limit || null,
        unlisted: settings.unlisted,
      };
      const session = await createSession(settings.base_url, settings.api_key, sessionPayload);
      const sessionId = normalizeText(session.session_id);
      const sessionDetails = sessionId ? await getSession(settings.base_url, settings.api_key, sessionId).catch(() => null) : null;
      const sessionPatch = sessionDetails
        ? buildSessionRefreshPatch(job, sessionDetails)
        : {
            status: 'submitted',
            result_json: {
              ...(job.result_json || {}),
              devin_last_synced_at: new Date().toISOString(),
            },
            error_json: {},
            ended_at: null,
          };
      const result = await db.upsertDeepWikiGenerationJob({
        id: job.id,
        project_id: Number(context.snapshot.project_id),
        snapshot_id: Number(context.snapshot.id),
        run_id: context.snapshot.run_id || null,
        job_type: 'devin_deepwiki_sync',
        status: sessionPatch.status,
        requested_by: job.requested_by || 'system',
        request_json: {
          ...(job.request_json || {}),
          export_dir: exported.export_dir,
          wiki_path: exported.wiki_path,
          handoff_path: exported.handoff_path,
          manifest_path: exported.manifest_path,
        },
        result_json: {
          ...(sessionPatch.result_json || {}),
          sync_mode: dryRun ? 'draft_preview' : 'published_sync',
          devin_session_id: session.session_id || null,
          devin_session_url: session.url || null,
          devin_is_new_session: session.is_new_session,
          attachment_urls: attachmentUrls,
          exported_files: attachmentFiles,
        },
        error_json: sessionPatch.error_json || {},
        started_at: job.started_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
        ended_at: sessionPatch.ended_at,
      });
      if (logger?.info) {
        logger.info('devin deepwiki sync submitted', {
          job_id: result.id,
          snapshot_id: context.snapshot.id,
          session_id: session.session_id || null,
        });
      }
      return result;
    } catch (error) {
      await db.upsertDeepWikiGenerationJob({
        id: job.id,
        project_id: Number(context.snapshot.project_id),
        snapshot_id: Number(context.snapshot.id),
        run_id: context.snapshot.run_id || null,
        job_type: 'devin_deepwiki_sync',
        status: 'failed',
        requested_by: job.requested_by || 'system',
        request_json: {
          ...(job.request_json || {}),
          export_dir: exported.export_dir,
          wiki_path: exported.wiki_path,
          handoff_path: exported.handoff_path,
          manifest_path: exported.manifest_path,
        },
        result_json: job.result_json || {},
        error_json: {
          message: error.message || 'devin_sync_failed',
        },
        started_at: job.started_at || new Date().toISOString().slice(0, 19).replace('T', ' '),
        ended_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      });
      throw error;
    }
  }

  async function refreshJob(jobId, options = {}) {
    const job = await db.getDeepWikiGenerationJobById(Number(jobId));
    if (!job || normalizeText(job.job_type) !== 'devin_deepwiki_sync') return job;
    const sessionId = normalizeText(job.result_json?.devin_session_id);
    if (!sessionId) return job;
    const settings = options.settings || loadDevinSettings(await db.getGatewaySettings().catch(() => ({})));
    if (!settings.enabled || !settings.api_key) {
      return job;
    }
    try {
      const session = await getSession(settings.base_url, settings.api_key, sessionId);
      const patch = buildSessionRefreshPatch(job, session);
      return db.upsertDeepWikiGenerationJob({
        id: job.id,
        project_id: Number(job.project_id || 0),
        snapshot_id: job.snapshot_id || null,
        run_id: job.run_id || null,
        job_type: job.job_type,
        status: patch.status,
        requested_by: job.requested_by || 'system',
        request_json: job.request_json || {},
        result_json: patch.result_json,
        error_json: patch.error_json,
        started_at: job.started_at || nowSqlTimestamp(),
        ended_at: patch.ended_at,
      });
    } catch (error) {
      if (logger?.error) {
        logger.error('devin deepwiki refresh failed', {
          job_id: job.id,
          snapshot_id: job.snapshot_id,
          session_id: sessionId,
          error: error.message,
        });
      }
      return db.upsertDeepWikiGenerationJob({
        id: job.id,
        project_id: Number(job.project_id || 0),
        snapshot_id: job.snapshot_id || null,
        run_id: job.run_id || null,
        job_type: job.job_type,
        status: 'failed',
        requested_by: job.requested_by || 'system',
        request_json: job.request_json || {},
        result_json: {
          ...(job.result_json || {}),
          devin_last_synced_at: new Date().toISOString(),
        },
        error_json: {
          message: error.message || 'devin_sync_refresh_failed',
        },
        started_at: job.started_at || nowSqlTimestamp(),
        ended_at: nowSqlTimestamp(),
      });
    }
  }

  async function refreshSubmittedJobs(options = {}) {
    const settings = loadDevinSettings(await db.getGatewaySettings().catch(() => ({})));
    if (!settings.enabled || !settings.api_key) return [];
    const jobs = await db.listDeepWikiGenerationJobs({
      job_type: 'devin_deepwiki_sync',
      statuses: ['submitted'],
      limit: Number(options.limit || 10),
    });
    const results = [];
    for (const job of toArray(jobs)) {
      results.push(await refreshJob(job.id, { settings }));
    }
    return results;
  }

  async function isAutoSyncEnabled() {
    const settings = loadDevinSettings(await db.getGatewaySettings().catch(() => ({})));
    return settings.enabled && settings.auto_sync_on_publish && Boolean(settings.api_key);
  }

  return {
    loadSyncContext,
    queueSnapshot,
    runJob,
    refreshJob,
    refreshSubmittedJobs,
    isAutoSyncEnabled,
  };
}

function createDevinDeepWikiSyncScheduler({ service, logger, pollIntervalMs, batchLimit } = {}) {
  const intervalMs = Math.max(15_000, Number(pollIntervalMs || process.env.DEEPWIKI_DEVIN_SYNC_POLL_MS || 20_000));
  const maxBatchSize = Math.max(1, Number(batchLimit || process.env.DEEPWIKI_DEVIN_SYNC_BATCH_SIZE || 5));
  let timer = null;
  let running = false;
  let lastTickStartedAt = null;
  let lastTickFinishedAt = null;
  let lastError = null;
  let lastResult = [];

  async function tick() {
    if (running) {
      return {
        skipped: true,
        reason: 'scheduler_busy',
      };
    }
    running = true;
    lastTickStartedAt = new Date().toISOString();
    lastError = null;
    try {
      const refreshed = await service.refreshSubmittedJobs({ limit: maxBatchSize });
      lastResult = toArray(refreshed).map((job) => ({
        id: job?.id || null,
        snapshot_id: job?.snapshot_id || null,
        status: job?.status || null,
        devin_status: job?.result_json?.devin_status || null,
        devin_status_enum: job?.result_json?.devin_status_enum || null,
      }));
      lastTickFinishedAt = new Date().toISOString();
      return {
        refreshed: lastResult.length,
        jobs: lastResult,
      };
    } catch (error) {
      lastError = error.message || 'devin_sync_scheduler_error';
      lastTickFinishedAt = new Date().toISOString();
      if (logger?.error) {
        logger.error('devin deepwiki sync scheduler failed', {
          error: error.message,
        });
      }
      return {
        refreshed: 0,
        error: lastError,
      };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      void tick();
    }, intervalMs);
    setImmediate(() => {
      void tick();
    });
  }

  function stop() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function status() {
    return {
      running,
      enabled: Boolean(timer),
      poll_interval_ms: intervalMs,
      batch_limit: maxBatchSize,
      last_tick_started_at: lastTickStartedAt,
      last_tick_finished_at: lastTickFinishedAt,
      last_error: lastError,
      last_result: lastResult,
    };
  }

  return {
    start,
    stop,
    tick,
    status,
  };
}

module.exports = {
  buildDevinWikiConfig,
  buildDevinPrompt,
  buildHandoffMarkdown,
  buildManifestJson,
  exportDevinSnapshotArtifacts,
  loadDevinSettings,
  isFinishedSession,
  pickLatestSessionMessage,
  mergeSessionResult,
  buildSessionRefreshPatch,
  createDevinDeepWikiSyncService,
  createDevinDeepWikiSyncScheduler,
};
