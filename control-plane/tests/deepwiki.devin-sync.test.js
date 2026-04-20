const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildDevinWikiConfig,
  buildDevinPrompt,
  buildHandoffMarkdown,
  buildSessionRefreshPatch,
  exportDevinSnapshotArtifacts,
  isFinishedSession,
  loadDevinSettings,
  mergeSessionResult,
  pickLatestSessionMessage,
} = require('../src/deepwiki/devin-sync');

test('buildDevinWikiConfig converts published snapshot assets into wiki.json structure', () => {
  const config = buildDevinWikiConfig({
    project: { project_name: 'Order Hub', project_code: 'order-hub' },
    snapshot: { id: 12, status: 'published', snapshot_version: 'release-12', published_at: '2026-04-19 12:00:00' },
    overview: {
      repo_revisions: [
        { repo_slug: 'web-shop', repo_role: 'frontend' },
        { repo_slug: 'order-service', repo_role: 'backend' },
      ],
      publish_blockers: [],
    },
    topologyAsset: {
      payload: {
        repos: [
          { repoId: 'web-shop', role: 'frontend' },
          { repoId: 'order-service', role: 'backend' },
        ],
      },
    },
    domainModelAsset: {
      payload: {
        domains: [
          { name: '订单域', capabilities: ['支持订单提交'] },
        ],
      },
    },
    gateAsset: { payload: { publishReady: true, blockers: [] } },
    wikiPages: [
      {
        title: '项目总览',
        summary: '从业务域到线程的总览页',
        pageType: 'overview',
        sourceUri: 'deepwiki://overview/project',
      },
      {
        title: '订单域',
        summary: '覆盖订单提交和取消',
        pageType: 'domain',
        participatingRepos: ['web-shop', 'order-service'],
        coveredDiagrams: ['订单主流程图'],
      },
    ],
  });

  assert.ok(Array.isArray(config.repo_notes) && config.repo_notes.length >= 2);
  assert.ok(Array.isArray(config.pages) && config.pages.length === 2);
  assert.equal(config.pages[1].title, '订单域');
  assert.match(config.pages[1].purpose, /订单主流程图/);
});

test('buildDevinPrompt includes attachment markers and published snapshot instructions', () => {
  const prompt = buildDevinPrompt({
    project: { project_name: 'Order Hub' },
    snapshot: { id: 12, snapshot_version: 'release-12' },
    attachments: ['https://attachment.example/wiki.json', 'https://attachment.example/handoff.md'],
  });

  assert.match(prompt, /Published snapshot handoff: release-12/);
  assert.match(prompt, /ATTACHMENT:"https:\/\/attachment\.example\/wiki\.json"/);
  assert.match(prompt, /ATTACHMENT:"https:\/\/attachment\.example\/handoff\.md"/);
  assert.match(prompt, /严格按其中 pages 生成页面结构/);
});

test('buildDevinPrompt marks draft preview dry runs clearly', () => {
  const prompt = buildDevinPrompt({
    project: { project_name: 'Order Hub' },
    snapshot: { id: 19, snapshot_version: 'draft-19', status: 'generated' },
    attachments: ['https://attachment.example/wiki.json'],
    dry_run: true,
  });

  assert.match(prompt, /Draft snapshot dry run: draft-19/);
  assert.match(prompt, /draft snapshot 的 dry run 预演/);
});

test('exportDevinSnapshotArtifacts writes wiki json and handoff files under snapshot storage', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deepwiki-devin-sync-'));
  const snapshot = {
    id: 18,
    status: 'published',
    snapshot_version: 'release-18',
    metadata_json: {
      output_root: tempRoot,
    },
  };
  const exported = exportDevinSnapshotArtifacts({
    project: { project_name: 'Order Hub', project_code: 'order-hub' },
    snapshot,
    overview: {
      repo_revisions: [{ repo_slug: 'web-shop' }],
      document_revisions: [],
      diagram_assets: [],
      source_coverage: { repo_count: 1, document_count: 0, diagram_count: 0 },
    },
    topologyAsset: { payload: { repos: [{ repoId: 'web-shop', role: 'frontend' }] } },
    domainModelAsset: { payload: { domains: [{ name: '订单域', capabilities: ['支持订单提交'] }] } },
    gateAsset: { payload: { publishReady: true, blockers: [] } },
    wikiPages: [{ title: '项目总览', summary: '总览', pageType: 'overview' }],
  });

  assert.ok(fs.existsSync(exported.wiki_path));
  assert.ok(fs.existsSync(exported.handoff_path));
  assert.ok(fs.existsSync(exported.manifest_path));
  assert.match(fs.readFileSync(exported.handoff_path, 'utf8'), /Devin DeepWiki Handoff/);
});

test('loadDevinSettings normalizes csv and booleans from persisted settings', () => {
  const settings = loadDevinSettings({
    deepwiki_devin_enabled: 'true',
    deepwiki_devin_base_url: 'https://api.devin.ai',
    deepwiki_devin_api_key: 'secret',
    deepwiki_devin_auto_sync_on_publish: '1',
    deepwiki_devin_knowledge_ids: 'kn-1, kn-2',
    deepwiki_devin_unlisted: 'false',
  });

  assert.equal(settings.enabled, true);
  assert.equal(settings.auto_sync_on_publish, true);
  assert.deepEqual(settings.knowledge_ids, ['kn-1', 'kn-2']);
  assert.equal(settings.unlisted, false);
});

test('buildHandoffMarkdown summarizes repositories and publish gates', () => {
  const markdown = buildHandoffMarkdown({
    project: { project_name: 'Order Hub' },
    snapshot: { id: 12, status: 'published', snapshot_version: 'release-12' },
    overview: {
      repo_revisions: [{ repo_slug: 'web-shop' }],
      document_revisions: [],
      diagram_assets: [],
    },
    topologyAsset: { payload: { repos: [{ repoId: 'web-shop', role: 'frontend' }] } },
    domainModelAsset: { payload: { domains: [{ name: '订单域', capabilities: ['支持订单提交'] }] } },
    gateAsset: { payload: { publishReady: true, qualityGateBlocked: false, blockers: [] } },
    wikiPages: [{ title: '项目总览', summary: '总览', pageType: 'overview' }],
  });

  assert.match(markdown, /Order Hub/);
  assert.match(markdown, /web-shop \(frontend\)/);
  assert.match(markdown, /Publish ready: true/);
});

test('buildHandoffMarkdown labels draft preview mode', () => {
  const markdown = buildHandoffMarkdown({
    project: { project_name: 'Order Hub' },
    snapshot: { id: 20, status: 'generated', snapshot_version: 'draft-20' },
    overview: {
      repo_revisions: [{ repo_slug: 'web-shop' }],
      document_revisions: [],
      diagram_assets: [],
    },
    topologyAsset: { payload: { repos: [{ repoId: 'web-shop', role: 'frontend' }] } },
    domainModelAsset: { payload: { domains: [{ name: '订单域', capabilities: ['支持订单提交'] }] } },
    gateAsset: { payload: { publishReady: false, qualityGateBlocked: true, blockers: ['quality_gate_blocked'] } },
    wikiPages: [{ title: '项目总览', summary: '总览', pageType: 'overview' }],
    dry_run: true,
  });

  assert.match(markdown, /Mode: draft_preview/);
  assert.match(markdown, /Snapshot status: generated/);
});

test('pickLatestSessionMessage prefers the newest devin reply', () => {
  const latest = pickLatestSessionMessage({
    messages: [
      { type: 'initial_user_message', message: 'hello', timestamp: '2026-04-19T15:00:00Z' },
      { type: 'devin_message', message: 'first', timestamp: '2026-04-19T15:01:00Z', event_id: '1' },
      { type: 'devin_message', message: 'latest', timestamp: '2026-04-19T15:02:00Z', event_id: '2' },
    ],
  });

  assert.deepEqual(latest, {
    type: 'devin_message',
    message: 'latest',
    timestamp: '2026-04-19T15:02:00Z',
    event_id: '2',
  });
});

test('buildSessionRefreshPatch keeps active sessions submitted and stores latest status', () => {
  const patch = buildSessionRefreshPatch(
    {
      result_json: {
        devin_session_url: 'https://app.devin.ai/sessions/example',
      },
    },
    {
      session_id: 'devin-active',
      status: 'running',
      status_enum: 'working',
      title: 'Order Hub',
      updated_at: '2026-04-19T15:03:00Z',
      messages: [{ type: 'devin_message', message: 'Working on it', timestamp: '2026-04-19T15:03:00Z' }],
    }
  );

  assert.equal(patch.status, 'submitted');
  assert.equal(patch.result_json.devin_status, 'running');
  assert.equal(patch.result_json.devin_status_enum, 'working');
  assert.equal(patch.result_json.devin_latest_message.message, 'Working on it');
  assert.equal(patch.ended_at, null);
});

test('finished devin sessions are treated as completed jobs', () => {
  assert.equal(isFinishedSession({ status: 'suspended', status_enum: 'finished' }), true);

  const merged = mergeSessionResult(
    { devin_session_url: 'https://app.devin.ai/sessions/example' },
    {
      session_id: 'devin-finished',
      status: 'suspended',
      status_enum: 'finished',
      messages: [{ type: 'devin_message', message: 'done', timestamp: '2026-04-19T15:04:00Z' }],
    }
  );

  assert.equal(merged.devin_status, 'suspended');
  assert.equal(merged.devin_status_enum, 'finished');
  assert.equal(merged.devin_latest_message.message, 'done');
  assert.match(merged.devin_last_synced_at, /^2026-|^20\d\d-/);
});
