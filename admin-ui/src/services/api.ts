import axios, { type AxiosRequestConfig } from 'axios';

const API_BASE = '/api';

const apiClient = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('api_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

type AxiosConfigWithSilent = AxiosRequestConfig & { silentErrorLog?: boolean };

apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const cfg = error.config as (AxiosRequestConfig & { silentErrorLog?: boolean }) | undefined;
    if (!cfg?.silentErrorLog) {
      console.error('API Error:', error.response?.data || error.message);
    }
    return Promise.reject(error);
  }
);

function unwrapData<T>(response: unknown): T {
  const payload = response as { data?: T };
  return (payload?.data ?? response) as T;
}

function toQueryString(params?: Record<string, string | number | boolean | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === '') return;
    search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

export interface UsageStats {
  total_tokens: number;
  total_cost: number;
  total_requests: number;
  active_users: number;
  tokens_per_min: number;
  avg_cost_per_msg: number;
  /** 网关统计返回：趋势天数等 */
  trend_days?: number;
}

export interface TokenTrend {
  date: string;
  tokens: number;
  cost: number;
}

export interface ModelUsage {
  model: string;
  tokens: number;
  cost: number;
  requests: number;
}

export interface TeamUsage {
  team: string;
  tokens: number;
  cost: number;
  /** 未配置时网关可能返回 null */
  quota: number | null;
}

export interface ApiKey {
  key: string;
  type: 'team' | 'user' | 'proj';
  name: string;
  quota_daily: number;
  quota_monthly: number;
  used_daily: number;
  used_monthly: number;
  allowed_models: string[];
  created_at: string;
  status: 'active' | 'disabled';
}

export interface Team {
  id: string;
  name: string;
  members: number;
  quota_daily: number;
  quota_monthly: number;
  used_daily: number;
  used_monthly: number;
  created_at: string;
}

export interface DeepWikiProvider {
  key: string;
  label: string;
  enabled?: boolean;
  default_model?: string;
  wire_mode?: string;
}

export interface DeepWikiModelOption {
  value: string;
  label: string;
}

export interface DeepWikiBranchRepoMapping {
  id?: number;
  branch_id?: number;
  project_repo_id?: number;
  repo_branch_name?: string;
  metadata_json?: Record<string, unknown>;
  project_repo?: DeepWikiProjectRepo;
}

export interface DeepWikiProjectRepo {
  id: number;
  repo_source_id?: number;
  repo_role?: string;
  is_primary?: boolean;
  repo_slug?: string;
  repo_url?: string;
  metadata_json?: Record<string, unknown>;
  repo_source?: DeepWikiRepoRow;
}

export interface DeepWikiProject {
  id: number;
  project_code: string;
  project_name: string;
  default_branch?: string | null;
  mission?: string | null;
  repo_count?: number;
  version_line_count?: number;
  repos?: DeepWikiProjectRepo[];
  latest_snapshot?: DeepWikiSnapshot | null;
  latest_published_snapshot?: DeepWikiSnapshot | null;
  latest_published_snapshot_summary?: DeepWikiSnapshot | null;
  source_bindings?: DeepWikiSourceBinding[];
  version_lines?: DeepWikiVersionLine[];
  diagnostic_version_lines?: DeepWikiBranch[];
}

export interface DeepWikiBranch {
  id?: number | null;
  branch: string;
  branch_name?: string;
  display_name?: string;
  snapshot_count?: number;
  repo_slugs?: string[];
  published_snapshot?: DeepWikiSnapshot | null;
  repo_mappings?: DeepWikiBranchRepoMapping[];
}

export interface DeepWikiVersionLine extends DeepWikiBranch {
  version_line_name?: string;
}

export interface DeepWikiVersionLineResult {
  project_id: number;
  project_code?: string;
  default_version_line?: string;
  version_lines: DeepWikiVersionLine[];
  diagnostic_version_lines?: DeepWikiBranch[];
}

export interface DeepWikiBootstrapMigrationReport {
  project_count?: number;
  version_line_count?: number;
  snapshot_count?: number;
  missing_repo_revision_snapshots?: number;
  missing_document_revision_snapshots?: number;
  missing_diagram_snapshots?: number;
  [key: string]: unknown;
}

export interface DeepWikiBootstrapSummary {
  migration_report?: DeepWikiBootstrapMigrationReport;
  [key: string]: unknown;
}

export interface DeepWikiSourceBinding {
  id: number;
  project_id?: number;
  source_type: string;
  source_key: string;
  source_ref_id?: number | null;
  title?: string | null;
  status?: string;
  metadata_json?: Record<string, unknown>;
}

export interface DeepWikiSnapshot {
  id: number;
  run_id?: number | null;
  repo_source_id?: number | null;
  branch: string;
  commit_sha?: string | null;
  status?: string | null;
  publish_ready?: boolean;
  quality_gate_blocked?: boolean;
  approval_status?: string | null;
  source_snapshot_id?: number | null;
  lineage_json?: Record<string, unknown>;
  publish_status?: string | null;
  quality_status?: string | null;
  snapshot_version?: string | null;
  run_status?: string | null;
  version_line_id?: number | null;
  version_line_name?: string | null;
  version_line_display_name?: string | null;
  publish_blockers?: string[];
  repo_revisions?: DeepWikiSnapshotRepoRevision[];
  document_revisions?: DeepWikiSnapshotDocumentRevision[];
  diagram_assets?: DeepWikiDiagramAsset[];
  metadata_json?: Record<string, unknown>;
}

export interface DeepWikiDevinSyncRequest {
  dry_run?: boolean;
}

export interface DeepWikiSnapshotRepoRevision {
  id?: number;
  repo_source_id?: number;
  repo_role?: string;
  repo_slug?: string;
  repo_url?: string;
  branch?: string;
  branch_name?: string;
  commit_sha?: string;
  metadata_json?: Record<string, unknown>;
}

export interface DeepWikiSnapshotDocumentRevision {
  id?: number;
  source_binding_id?: number | null;
  document_type?: string;
  title?: string | null;
  source_uri?: string | null;
  version_label?: string | null;
  knowledge_asset_id?: number | null;
  origin?: 'manual' | 'generated_from_code' | string | null;
  confidence?: number | null;
  source_snapshot_id?: number | null;
  metadata_json?: Record<string, unknown>;
}

export interface DeepWikiDiagramAsset {
  id?: number;
  snapshot_id?: number;
  diagram_type:
    | 'overview'
    | 'code_layered_architecture'
    | 'product_architecture'
    | 'technical_architecture'
    | 'business_domain'
    | 'business_flow'
    | 'module_flow'
    | 'core_logic'
    | 'database_er'
    | string;
  title: string;
  diagram_key?: string | null;
  scope_type?: 'project' | 'domain' | 'thread' | 'branch' | string;
  scope_key?: string | null;
  parent_scope_key?: string | null;
  sort_order?: number;
  format?: string;
  content?: string | null;
  render_status?: string;
  source_page_id?: number | null;
  metadata_json?: Record<string, unknown>;
  render_source?: string;
  provider?: string | null;
  model?: string | null;
  summary?: string | null;
  covered_evidence?: string[];
  missing_evidence?: string[];
  quality_notes?: string[];
  export_assets?: Record<string, unknown>;
}

export interface DeepWikiSnapshotOverview {
  snapshot: DeepWikiSnapshot;
  project?: DeepWikiProject | null;
  repo_revisions: DeepWikiSnapshotRepoRevision[];
  document_revisions: DeepWikiSnapshotDocumentRevision[];
  diagram_assets: DeepWikiDiagramAsset[];
  related_doc_bundles: DeepWikiDocBundle[];
  generation_jobs?: DeepWikiGenerationJob[];
  publish_blockers: string[];
  publish_warnings?: string[];
  source_coverage?: {
    repo_count: number;
    document_count: number;
    diagram_count: number;
  };
}

export interface DeepWikiSnapshotQuality {
  quality_report?: DeepWikiQualityReport | null;
  consistency_checks: DeepWikiConsistencyCheck[];
  semantic_scores: DeepWikiSemanticScore[];
  publish_blockers: string[];
  publish_warnings?: string[];
  publish_ready: boolean;
}

export interface DeepWikiStageContract {
  stageKey: string;
  skills: string[];
  inputSchema?: string;
  outputSchema?: string;
  qualityGateSchema?: string;
  fallbackPolicy?: string;
  projectionTargets?: string[];
}

export interface DeepWikiSkillContract {
  skillKey: string;
  skill_key?: string;
  layer?: string;
  purpose: string;
  inputs?: string[];
  outputs?: string[];
  algorithm?: string;
  parameters?: Record<string, unknown>;
  dependencies?: string[];
  version?: string;
  acceptedInputs: string[];
  producedOutputs: string[];
  failureModes?: string[];
  qualityChecks?: string[];
}

export interface DeepWikiSkillRegistryResponse {
  override_file: string;
  skills: DeepWikiSkillContract[];
}

export interface DeepWikiSkillDetailResponse {
  override_file: string;
  skill: DeepWikiSkillContract;
}

export interface DeepWikiStageRun {
  id?: number;
  snapshot_id?: number;
  project_id?: number | null;
  run_id?: number | null;
  stage_key?: string;
  stageKey?: string;
  sort_order?: number;
  sortOrder?: number;
  status?: string;
  contract?: DeepWikiStageContract | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DeepWikiSkillExecution {
  id?: number;
  snapshot_id?: number;
  project_id?: number | null;
  run_id?: number | null;
  stage_key?: string;
  stageKey?: string;
  skill_key?: string;
  skillKey?: string;
  status?: string;
  contract?: DeepWikiSkillContract | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DeepWikiProjectionAsset<T = unknown> {
  id?: number;
  assetKey: string;
  stageKey: string;
  snapshotId?: string;
  schemaVersion?: string;
  createdAt?: string;
  updatedAt?: string;
  payload: T;
  [key: string]: unknown;
}

export interface DeepWikiTopologyRepo {
  repoId?: string;
  repoSourceId?: number | null;
  role?: string;
  root?: string;
  branch?: string;
  commitSha?: string;
  subsystem?: string;
}

export interface DeepWikiProjectTopology {
  projectId?: number | null;
  projectCode?: string | null;
  projectName?: string | null;
  versionLine?: string | null;
  repos: DeepWikiTopologyRepo[];
}

export interface DeepWikiGateDecisionRow {
  id?: number;
  snapshot_id?: number;
  project_id?: number | null;
  run_id?: number | null;
  gate_key: string;
  source_stage_key?: string | null;
  decision_status?: string;
  is_blocking?: boolean;
  decision_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DeepWikiScorePenalty {
  type: string;
  score_delta: number;
}

export interface DeepWikiScoreRecord {
  score_id: string;
  entity_type: string;
  entity_id: string;
  snapshot_id: number;
  overall_score: number;
  dimensions?: Record<string, number>;
  penalties?: DeepWikiScorePenalty[];
  grader_versions?: Record<string, string>;
  explanations?: string[];
  score_group?: string;
  metadata_json?: Record<string, unknown>;
}

export interface DeepWikiHealthIndex {
  snapshotId?: number;
  health_key?: string;
  knowledge_health_index?: number;
  health_level?: string;
  numeric_value?: number | null;
  [key: string]: unknown;
}

export interface DeepWikiGenerationBase {
  snapshot_id: number;
  prd_asset_ids: number[];
  tech_spec_asset_id?: number | null;
  gate_status?: string;
}

export interface DeepWikiQualityReport {
  status?: string;
  score?: number;
  summary?: string;
  details?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DeepWikiFlowStep {
  step_order: number;
  step_type: string;
  step_name: string;
}

export interface DeepWikiFlow {
  id?: number;
  flow_code: string;
  flow_name: string;
  flow_type: string;
  status?: string;
  steps?: DeepWikiFlowStep[];
}

export interface DeepWikiAssertion {
  id?: number;
  assertion_code: string;
  assertion_type: string;
  expression?: string;
  expected_result_json?: Record<string, unknown>;
}

export interface DeepWikiScenario {
  id?: number;
  scenario_code: string;
  scenario_name: string;
  status?: string;
  input_fixture_json?: Record<string, unknown>;
  expected_assertions_json?: unknown[];
  linked_test_asset_object_id?: number | null;
}

export interface DeepWikiSemanticScore {
  id?: number;
  target_type: string;
  final_score: number;
  status?: string;
  detail_json?: Record<string, unknown>;
}

export interface DeepWikiQueryCitation {
  page_slug?: string | null;
  title?: string | null;
  source_uri?: string | null;
  knowledge_asset_id?: number | null;
  score?: number;
  excerpt?: string;
}

export interface DeepWikiQueryObjectHit {
  id?: number | null;
  object_type: string;
  object_key: string;
  title?: string;
  link_score?: number;
}

export interface DeepWikiCommunityHit {
  community_key: string;
  title: string;
  community_score?: number;
  rank_score?: number;
  page_slugs?: string[];
  summary_markdown?: string;
}

export interface DeepWikiThread {
  id?: number;
  snapshot_id?: number;
  thread_key: string;
  parent_thread_key?: string | null;
  thread_level: 'project_trunk' | 'domain' | 'core_thread' | 'branch_thread' | 'exception_thread' | 'frontend_journey' | string;
  domain_key?: string | null;
  title: string;
  summary_markdown?: string | null;
  entry_points_json?: Array<Record<string, unknown>>;
  steps_json?: Array<Record<string, unknown>>;
  branch_points_json?: Array<Record<string, unknown>>;
  object_keys_json?: string[];
  repo_roles_json?: string[];
  evidence_json?: Array<Record<string, unknown>>;
  metrics_json?: Record<string, unknown>;
  pages?: DeepWikiPageRow[];
  diagrams?: DeepWikiDiagramAsset[];
}

export interface DeepWikiSnapshotQueryResponse {
  answer: string;
  citations: DeepWikiQueryCitation[];
  retrieved_pages: Array<{
    page_slug?: string | null;
    title?: string | null;
    source_uri?: string | null;
    score?: number;
  }>;
  retrieved_objects: DeepWikiQueryObjectHit[];
  retrieved_threads: Array<{
    thread_key: string;
    parent_thread_key?: string | null;
    thread_level: string;
    domain_key?: string | null;
    title: string;
    rank_score?: number;
    object_keys?: string[];
    repo_roles?: string[];
    summary_markdown?: string;
  }>;
  community_hits: DeepWikiCommunityHit[];
  trace: Record<string, unknown>;
}

export interface DeepWikiConsistencyCheck {
  id?: number;
  snapshot_id?: number;
  check_type?: string;
  source_object_type?: string | null;
  source_object_id?: number | null;
  target_object_type?: string | null;
  target_object_id?: number | null;
  status?: string;
  score?: number;
  issue_code?: string | null;
  issue_level?: string;
  detail_json?: Record<string, unknown>;
  evidence_json?: unknown[];
  created_at?: string;
}

export interface DeepWikiGenerationJob {
  id?: number;
  run_id?: number;
  job_type?: string;
  status?: string;
  request_json?: Record<string, unknown>;
  result_json?: Record<string, unknown>;
  error_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface DeepWikiFeedbackEvent {
  id: number;
  feedback_type?: string;
  status?: string;
  source_pipeline?: string;
  snapshot_id?: number | null;
  pipeline_type?: string;
  category?: string;
  content_text?: string;
  created_at?: string;
  metadata_json?: Record<string, unknown>;
}

export interface DeepWikiRepoBranchesResult {
  repo_source_id?: number;
  default_branch?: string;
  available_branches?: string[];
  metadata_json?: Record<string, unknown>;
}

export interface DeepWikiRepoRow {
  id: number;
  repo_url: string;
  repo_slug: string;
  default_branch?: string;
  status?: string;
  branch_count?: number;
  run_count?: number;
  sync_result?: string;
  available_branches?: string[];
  metadata_json?: Record<string, unknown>;
  latest_run?: DeepWikiRunRow | null;
}

export interface DeepWikiDocBundle {
  id: number;
  bundle_code: string;
  title?: string;
  status?: string;
  current_stage?: string;
  project_code?: string;
  workflow_mode?: string;
}

export interface DeepWikiSnapshotDocBundleResponse extends DeepWikiDocBundleCreateResponse {
  generation_base?: DeepWikiGenerationBase;
}

export interface DeepWikiPageRow {
  id: number;
  run_id?: number;
  page_slug: string;
  title: string;
  page_type: string;
  source_uri?: string;
  ingest_status?: string;
  knowledge_asset_id?: number | null;
  metadata_json?: Record<string, unknown>;
  object_refs?: Array<Record<string, unknown>>;
}

export interface DeepWikiRunNode {
  id?: number;
  node_key?: string;
  node_name: string;
  status: string;
  output_summary?: string | null;
  error_message?: string | null;
}

export interface DeepWikiRunRow {
  id: number;
  trace_id: string;
  status: string;
  runtime_result?: string;
  current_stage?: string;
  repo_source_id: number;
  repo_url?: string;
  repo_slug?: string;
  branch?: string | null;
  commit_sha?: string | null;
  page_count?: number;
  ingested_page_count?: number;
  research_provider?: string;
  research_model?: string;
  output_profile?: string;
  diagram_profile?: string;
  diagram_count?: number;
  queue_position?: number | null;
  project_code?: string | null;
  updated_at?: string;
}

export interface DeepWikiActiveRun {
  run_id: number | null;
  status: string | null;
  project_id: number | null;
  project_code: string | null;
  pipeline_run_id: number | null;
  started_at: string | null;
  updated_at: string | null;
  branch: string | null;
}

export interface DeepWikiTimelineNode {
  node_id: number | null;
  node_key: string | null;
  node_label: string | null;
  status: string | null;
  attempt: number;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
}

export interface DeepWikiRunTimeline {
  run_id: number | null;
  run_status: string | null;
  started_at: string | null;
  finished_at: string | null;
  total_duration_ms: number | null;
  stats: { total: number; completed: number; failed: number; running: number };
  timeline: DeepWikiTimelineNode[];
}

export interface DeepWikiStageTrend {
  stage_key: string;
  sample_size: number;
  duration_p50_ms: number | null;
  duration_p95_ms: number | null;
  failure_count: number;
  failure_ratio: number;
  status_counts: Record<string, number>;
  error_counts: Record<string, number>;
}

export interface DeepWikiProjectTrends {
  project_id: number;
  run_sample: number;
  trends: DeepWikiStageTrend[];
}

export interface DeepWikiErrorSummary {
  code: string;
  count: number;
  stages: Record<string, number>;
  last_seen: string | null;
}

export interface DeepWikiProjectErrors {
  project_id: number;
  errors: DeepWikiErrorSummary[];
}

export interface DeepWikiManifestDiffResponse {
  run_id: number | null;
  compare_to: number | null;
  diff: {
    counters: Array<{
      key: string;
      before: number;
      after: number;
      delta: number;
      ratio: number | null;
      warn: boolean;
    }>;
    assets: Array<{
      key: string;
      before: number;
      after: number;
      delta: number;
      ratio: number | null;
      added: boolean;
      removed: boolean;
      warn: boolean;
    }>;
    stages: Array<{
      stage: string;
      beforeDuration: number;
      afterDuration: number;
      durationDelta: number;
      durationRatio: number | null;
      beforeStatus: string | null;
      afterStatus: string | null;
      slowWarn: boolean;
      statusChanged: boolean;
    }>;
    summary: {
      added_assets: string[];
      removed_assets: string[];
      warning_count: number;
      warnings: Array<{ kind: string; key: string; ratio?: number | null; beforeStatus?: string | null; afterStatus?: string | null }>;
    };
  };
}

export interface DeepWikiRunDetail extends DeepWikiRunRow {
  summary_json?: Record<string, unknown>;
  repo_source?: DeepWikiRepoRow & { metadata_json?: Record<string, unknown> };
  snapshot?: DeepWikiSnapshot | null;
  pages: DeepWikiPageRow[];
  nodes: DeepWikiRunNode[];
  output_root?: string;
  doc_bundles?: DeepWikiDocBundle[];
  object_counts?: Record<string, unknown>;
  relation_counts?: Record<string, unknown>;
  evidence_coverage?: Record<string, unknown>;
  generation_jobs?: DeepWikiGenerationJob[];
}

export interface DeepWikiGraphNode {
  id: string;
  type: 'page' | 'diagram' | 'feature' | 'service' | 'api' | 'table' | 'test_asset' | string;
  label: string;
  title?: string;
  status?: string;
  confidence?: number;
  source_files?: string[];
  source_apis?: string[];
  source_tables?: string[];
  page_slugs?: string[];
  evidence_count?: number;
  payload?: Record<string, unknown>;
}

export interface DeepWikiGraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export interface DeepWikiGraph {
  run_id: number;
  snapshot_id?: number | null;
  repo?: Record<string, unknown>;
  summary: {
    node_count: number;
    edge_count: number;
    object_counts?: Record<string, number>;
    relation_counts?: Record<string, number>;
    evidence_coverage?: Record<string, unknown>;
  };
  nodes: DeepWikiGraphNode[];
  edges: DeepWikiGraphEdge[];
  pages: DeepWikiPageRow[];
  mermaid: string;
  warnings?: string[];
}

export interface DeepWikiCreateRequest {
  repo_url: string;
  branch?: string;
  project_code?: string;
  focus_prompt?: string;
  research_provider?: string;
  research_model?: string;
  output_profile?: string;
  diagram_profile?: string;
}

export interface DeepWikiSyncConfig {
  enabled?: boolean;
  branch?: string;
  interval_minutes?: number;
  webhook_secret?: string;
  auto_ingest?: boolean;
  focus_prompt?: string;
  project_code?: string;
  research_provider?: string;
  research_model?: string;
  output_profile?: string;
  diagram_profile?: string;
}

export interface DeepWikiProjectRepoBindingRequest {
  repo_source_id: number;
  repo_role: string;
  branch?: string;
  is_primary?: boolean;
}

export interface DeepWikiProjectCreateRequest {
  project_name: string;
  project_code: string;
  default_branch?: string;
  mission?: string;
  repo_bindings?: DeepWikiProjectRepoBindingRequest[];
}

/** POST /v1/deepwiki/projects/:id/repos — 与 control-plane addRepoToDeepWikiProject 一致 */
export interface DeepWikiAddRepoToProjectRequest {
  repo_source_id?: number;
  repo_url?: string;
  repo_role?: string;
  branch?: string;
  is_primary?: boolean;
}

export interface DeepWikiRegenerateProjectRequest {
  branch?: string;
  focus_prompt?: string;
  research_provider?: string;
  research_model?: string;
  output_profile?: string;
  diagram_profile?: string;
  /** 覆盖逐仓分支，与 resolveDeepWikiProjectManifest 的 data.repos 一致 */
  repos?: Array<{ repo_source_id: number; branch?: string; repo_branch_name?: string }>;
}

export interface DeepWikiCreateRunResponse {
  run_id: number;
  trace_id: string;
  status: string;
  noop?: boolean;
  reason?: string;
  run: DeepWikiRunDetail;
}

export interface DeepWikiDocBundleCreateResponse {
  bundle: DeepWikiDocBundle;
}

export interface SystemSettings {
  gateway_port?: number;
  gateway_host?: string;
  deepwiki_default_provider?: string;
  deepwiki_default_model?: string;
  deepwiki_qwen_enabled?: boolean;
  deepwiki_weelinking_enabled?: boolean;
  deepwiki_qwen_default_model?: string;
  deepwiki_weelinking_default_model?: string;
  deepwiki_weelinking_base_url?: string;
  deepwiki_weelinking_wire_mode?: string;
  deepwiki_weelinking_api_key?: string;
  deepwiki_codex_enabled?: boolean;
  deepwiki_codex_base_url?: string;
  deepwiki_codex_api_key?: string;
  deepwiki_codex_default_model?: string;
  deepwiki_devin_enabled?: boolean;
  deepwiki_devin_base_url?: string;
  deepwiki_devin_api_key?: string;
  deepwiki_devin_auto_sync_on_publish?: boolean;
  deepwiki_devin_playbook_id?: string;
  deepwiki_devin_knowledge_ids?: string | string[];
  deepwiki_devin_max_acu_limit?: number;
  deepwiki_devin_unlisted?: boolean;
  deepwiki_diagram_provider_strategy?: 'default' | 'codex_only' | 'project_override' | string;
  [key: string]: unknown;
}

export interface HarnessMessage {
  id: string;
  actor: string;
  content: string;
  created_at: string;
  tab: string;
  status?: string | null;
  stage?: string | null;
}

export interface HarnessCheckpoint {
  id: number;
  checkpoint_type: string;
  stage_key: string;
  status: string;
  resume_token: string;
  payload_json: Record<string, unknown>;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface HarnessRuntimeRun {
  id: number;
  card_id: number;
  trace_id: string;
  status: string;
  repo_key?: string | null;
  repo_url?: string | null;
  repo_branch?: string | null;
  workspace_path?: string | null;
  commit_sha_before?: string | null;
  commit_sha_after?: string | null;
  test_command?: string | null;
  test_result?: string | null;
  retry_count: number;
  logs_json?: Array<Record<string, unknown>>;
  summary_artifact_id?: number | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface HarnessSummaryArtifact {
  id: number;
  title: string;
  content: string;
}

export interface HarnessCard {
  id: number;
  card_code: string;
  title: string;
  card_type: string;
  priority: string;
  stage_key: string;
  sub_status?: string | null;
  lane?: string;
  trace_id: string;
  repo_url?: string | null;
  repo_slug?: string | null;
  repo_branch?: string | null;
  deepwiki_run_id?: number | null;
  bundle_id?: number | null;
  summary?: string;
  latest_ai_action?: string | null;
  latest_human_action?: string | null;
  blocked_reason?: string | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  messages?: Record<string, HarnessMessage[]>;
  logs?: HarnessMessage[];
  summary_artifact?: HarnessSummaryArtifact | null;
  active_checkpoint?: HarnessCheckpoint | null;
  runtime_runs?: HarnessRuntimeRun[];
}

export interface HarnessCardCreateRequest {
  title: string;
  card_type?: string;
  priority?: string;
  repo_url?: string;
  repo_branch?: string;
  repo_slug?: string;
  deepwiki_run_id?: number;
  bundle_id?: number;
  summary?: string;
}

export interface HarnessEvent {
  type: string;
  created_at?: string;
  card_id?: number;
  runtime_run_id?: number | null;
  checkpoint?: HarnessCheckpoint;
  card?: HarnessCard;
  [key: string]: unknown;
}

export const usageApi = {
  getStats: async (startDate?: string, endDate?: string): Promise<UsageStats> => {
    const response = await apiClient.get('/v1/usage/stats', {
      params: { start_date: startDate, end_date: endDate },
    });
    return unwrapData<UsageStats>(response);
  },

  getTokenTrend: async (startDate?: string, endDate?: string): Promise<TokenTrend[]> => {
    const response = await apiClient.get('/v1/usage/trend', {
      params: { start_date: startDate, end_date: endDate },
    });
    return unwrapData<TokenTrend[]>(response);
  },

  getModelUsage: async (startDate?: string, endDate?: string): Promise<ModelUsage[]> => {
    const response = await apiClient.get('/v1/usage/models', {
      params:
        startDate && endDate ? { start_date: startDate, end_date: endDate } : undefined,
    });
    return unwrapData<ModelUsage[]>(response);
  },

  getTeamUsage: async (startDate?: string, endDate?: string): Promise<TeamUsage[]> => {
    const response = await apiClient.get('/v1/usage/teams', {
      params:
        startDate && endDate ? { start_date: startDate, end_date: endDate } : undefined,
    });
    return unwrapData<TeamUsage[]>(response);
  },
};

export const apiKeyApi = {
  list: async (): Promise<ApiKey[]> => unwrapData<ApiKey[]>(await apiClient.get('/v1/keys')),
  create: async (data: Partial<ApiKey>): Promise<ApiKey> => unwrapData<ApiKey>(await apiClient.post('/v1/keys', data)),
  update: async (key: string, data: Partial<ApiKey>): Promise<ApiKey> =>
    unwrapData<ApiKey>(await apiClient.put(`/v1/keys/${key}`, data)),
  delete: async (key: string): Promise<void> => {
    await apiClient.delete(`/v1/keys/${key}`);
  },
};

export const teamApi = {
  list: async (): Promise<Team[]> => unwrapData<Team[]>(await apiClient.get('/v1/teams')),
  create: async (data: Partial<Team>): Promise<Team> => unwrapData<Team>(await apiClient.post('/v1/teams', data)),
  update: async (id: string, data: Partial<Team>): Promise<Team> =>
    unwrapData<Team>(await apiClient.put(`/v1/teams/${id}`, data)),
  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/v1/teams/${id}`);
  },
};

export const settingsApi = {
  get: async (): Promise<SystemSettings> => unwrapData<SystemSettings>(await apiClient.get('/v1/settings')),
  update: async (payload: Partial<SystemSettings>): Promise<SystemSettings> =>
    unwrapData<SystemSettings>(await apiClient.put('/v1/settings', payload)),
};

export const deepWikiApi = {
  listProviders: async (): Promise<{ default_provider?: string; providers: DeepWikiProvider[] }> =>
    unwrapData(await apiClient.get('/v1/deepwiki/providers')),

  listModels: async (provider?: string): Promise<{ provider?: string; default_model?: string; models: DeepWikiModelOption[] }> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/models${toQueryString({ provider })}`)),

  listRuns: async (): Promise<DeepWikiRunRow[]> => unwrapData(await apiClient.get('/v1/deepwiki/runs')),
  listRunsByRepo: async (repoSourceId: number): Promise<DeepWikiRunRow[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/runs${toQueryString({ repo_source_id: repoSourceId })}`)),
  listRepos: async (): Promise<DeepWikiRepoRow[]> => unwrapData(await apiClient.get('/v1/deepwiki/repos')),
  getRun: async (runId: number): Promise<DeepWikiRunDetail> => unwrapData(await apiClient.get(`/v1/deepwiki/runs/${runId}`)),
  getRunGraph: async (runId: number): Promise<DeepWikiGraph> =>
    unwrapData(
      await apiClient.get(`/v1/deepwiki/runs/${runId}/graph`, { silentErrorLog: true } as AxiosConfigWithSilent)
    ),
  getPageContent: async (runId: number, pageId: number): Promise<DeepWikiPageRow & { content: string }> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/runs/${runId}/pages/${pageId}/content`)),
  getRepoBranches: async (repoSourceId: number): Promise<DeepWikiRepoBranchesResult> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/repos/${repoSourceId}/branches`)),
  createRun: async (payload: DeepWikiCreateRequest): Promise<DeepWikiCreateRunResponse> =>
    unwrapData(await apiClient.post('/v1/deepwiki/runs', payload)),
  syncRun: async (payload: DeepWikiCreateRequest & { force?: boolean }): Promise<DeepWikiCreateRunResponse> =>
    unwrapData(await apiClient.post('/v1/deepwiki/sync', payload)),
  updateSyncConfig: async (repoSourceId: number, payload: DeepWikiSyncConfig): Promise<DeepWikiRepoRow> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/repos/${repoSourceId}/sync-config`, payload)),
  retryRun: async (runId: number): Promise<DeepWikiRunDetail> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/runs/${runId}/retry`)),
  abortRun: async (runId: number): Promise<{ run_id: number; pipeline_run_id: number | null; status: string }> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/runs/${runId}/abort`)),
  getRunTimeline: async (runId: number): Promise<DeepWikiRunTimeline> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/runs/${runId}/timeline`)),
  listActiveRuns: async (): Promise<DeepWikiActiveRun[]> =>
    unwrapData(await apiClient.get('/v1/deepwiki/health/active-runs')),
  getProjectTrends: async (projectId: number, limit?: number): Promise<DeepWikiProjectTrends> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/health/trends${toQueryString({ limit })}`)),
  getProjectErrors: async (projectId: number, limit?: number): Promise<DeepWikiProjectErrors> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/health/errors${toQueryString({ limit })}`)),
  getRunManifestDiff: async (runId: number, compareTo?: number): Promise<DeepWikiManifestDiffResponse> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/runs/${runId}/manifest-diff${toQueryString({ compare_to: compareTo })}`)),
  reingestRun: async (runId: number): Promise<DeepWikiRunDetail> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/runs/${runId}/reingest`)),
  createDocBundle: async (
    runId: number,
    payload: { project_code?: string; workflow_mode?: string; create_prd_artifact?: boolean }
  ): Promise<DeepWikiDocBundleCreateResponse> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/runs/${runId}/doc-bundles`, payload)),

  listProjects: async (): Promise<DeepWikiProject[]> => unwrapData(await apiClient.get('/v1/deepwiki/projects')),
  createProject: async (payload: DeepWikiProjectCreateRequest): Promise<DeepWikiProject> =>
    unwrapData(await apiClient.post('/v1/deepwiki/projects', payload)),
  bootstrapProjects: async (payload: Record<string, unknown>): Promise<DeepWikiBootstrapSummary> =>
    unwrapData(await apiClient.post('/v1/deepwiki/projects/bootstrap', payload)),
  getProject: async (projectId: number): Promise<DeepWikiProject> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}`)),
  addRepoToProject: async (projectId: number, payload: DeepWikiAddRepoToProjectRequest): Promise<DeepWikiProject> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/projects/${projectId}/repos`, payload)),
  listVersionLines: async (
    projectId: number
  ): Promise<DeepWikiVersionLineResult> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/version-lines`)),
  createVersionLine: async (
    projectId: number,
    payload: { branch_name: string; display_name?: string; repo_mappings?: Array<{ project_repo_id: number; repo_branch_name: string }> }
  ): Promise<DeepWikiVersionLine> => unwrapData(await apiClient.post(`/v1/deepwiki/projects/${projectId}/version-lines`, payload)),
  listProjectBranches: async (projectId: number): Promise<{ branches: DeepWikiBranch[]; default_branch?: string }> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/branches`)),
  listProjectSnapshots: async (projectId: number, branch?: string, versionLineId?: number): Promise<DeepWikiSnapshot[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/snapshots${toQueryString({ branch, version_line_id: versionLineId })}`)),
  listSnapshotsByVersionLine: async (versionLineId: number): Promise<DeepWikiSnapshot[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/version-lines/${versionLineId}/snapshots`)),
  generateSnapshotByVersionLine: async (
    versionLineId: number,
    payload: Record<string, unknown>
  ): Promise<DeepWikiCreateRunResponse> => unwrapData(await apiClient.post(`/v1/deepwiki/version-lines/${versionLineId}/snapshots/generate`, payload)),
  regenerateProject: async (
    projectId: number,
    payload: DeepWikiRegenerateProjectRequest
  ): Promise<DeepWikiCreateRunResponse> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/projects/${projectId}/regenerate`, payload)),
  updateBranchRepoMapping: async (
    branchId: number,
    payload: { mappings: Array<{ project_repo_id: number; repo_branch_name: string; metadata_json?: Record<string, unknown> }> }
  ): Promise<Record<string, unknown>> => unwrapData(await apiClient.post(`/v1/deepwiki/branches/${branchId}/repo-mapping`, payload)),
  listFeedbackEvents: async (
    projectId: number,
    params?: { snapshot_id?: number }
  ): Promise<DeepWikiFeedbackEvent[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/feedback-events${toQueryString(params)}`)),

  listSnapshotRepoRevisions: async (snapshotId: number): Promise<DeepWikiSnapshotRepoRevision[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/repo-revisions`)),
  getSnapshotOverview: async (snapshotId: number): Promise<DeepWikiSnapshotOverview> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/overview`)),
  getSnapshotGraph: async (snapshotId: number): Promise<DeepWikiGraph> =>
    unwrapData(
      await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/graph`, { silentErrorLog: true } as AxiosConfigWithSilent)
    ),
  listSnapshotPages: async (snapshotId: number): Promise<DeepWikiPageRow[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/pages`)),
  getSnapshotPageContent: async (snapshotId: number, pageId: number): Promise<DeepWikiPageRow & { content: string }> =>
    unwrapData(
      await apiClient.get(
        `/v1/deepwiki/snapshots/${snapshotId}/pages/${pageId}/content`,
        { silentErrorLog: true } as AxiosConfigWithSilent
      )
    ),
  listSnapshotDiagrams: async (snapshotId: number): Promise<DeepWikiDiagramAsset[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/diagrams`)),
  listSnapshotThreads: async (
    snapshotId: number,
    filters?: { thread_level?: string; domain_key?: string }
  ): Promise<DeepWikiThread[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/threads${toQueryString(filters || {})}`)),
  getSnapshotThread: async (snapshotId: number, threadKey: string): Promise<DeepWikiThread> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/threads/${encodeURIComponent(threadKey)}`)),
  regenerateSnapshotDiagrams: async (
    snapshotId: number,
    payload?: { provider_strategy?: string; diagram_types?: string[]; scope_type?: string; scope_key?: string }
  ): Promise<DeepWikiDiagramAsset[]> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/snapshots/${snapshotId}/diagrams/regenerate`, payload || {})),
  getSnapshotDiagramContext: async (snapshotId: number): Promise<Record<string, unknown>> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/diagram-context`)),
  getSnapshotDiagramDownloadUrl: async (snapshotId: number, diagramType: string, format: 'svg' | 'png' | 'mmd') =>
    `${API_BASE}/v1/deepwiki/snapshots/${snapshotId}/diagrams/${encodeURIComponent(diagramType)}/download${toQueryString({ format })}`,
  getSnapshotQuality: async (snapshotId: number): Promise<DeepWikiSnapshotQuality> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/quality`)),
  listSkills: async (): Promise<DeepWikiSkillRegistryResponse> =>
    unwrapData(await apiClient.get('/v1/deepwiki/skills')),
  getSkill: async (skillKey: string): Promise<DeepWikiSkillDetailResponse> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/skills/${encodeURIComponent(skillKey)}`)),
  updateSkill: async (
    skillKey: string,
    payload: Partial<DeepWikiSkillContract>
  ): Promise<DeepWikiSkillDetailResponse> =>
    unwrapData(await apiClient.put(`/v1/deepwiki/skills/${encodeURIComponent(skillKey)}`, payload)),
  resetSkill: async (skillKey: string): Promise<DeepWikiSkillDetailResponse> =>
    unwrapData(await apiClient.delete(`/v1/deepwiki/skills/${encodeURIComponent(skillKey)}`)),
  getSnapshotStages: async (
    snapshotId: number
  ): Promise<{ snapshot: DeepWikiSnapshot; stage_runs: DeepWikiStageRun[]; contracts: DeepWikiStageContract[] }> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/stages`)),
  getSnapshotStageAssets: async (
    snapshotId: number
  ): Promise<{
    snapshot: DeepWikiSnapshot;
    assets: DeepWikiProjectionAsset[];
    asset_lineage: Array<{ stageKey: string; assetKey: string }>;
    skill_executions: DeepWikiSkillExecution[];
  }> => unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/stage-assets`)),
  getSnapshotEvidence: async (
    snapshotId: number
  ): Promise<{ evidence: DeepWikiProjectionAsset | null; confidence: DeepWikiProjectionAsset | null }> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/evidence`)),
  getSnapshotGateDecisions: async (
    snapshotId: number
  ): Promise<{
    gate_decisions: DeepWikiProjectionAsset | null;
    gate_decision_rows?: DeepWikiGateDecisionRow[];
    quality_report: DeepWikiProjectionAsset | null;
  }> => unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/gate-decisions`)),
  publishSnapshot: async (snapshotId: number): Promise<DeepWikiSnapshotOverview> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/snapshots/${snapshotId}/publish`, {})),
  syncSnapshotToDevin: async (
    snapshotId: number,
    payload?: DeepWikiDevinSyncRequest
  ): Promise<DeepWikiGenerationJob> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/snapshots/${snapshotId}/devin-sync`, payload || {})),
  getSnapshotQualityReport: async (snapshotId: number): Promise<DeepWikiQualityReport> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/quality-report`)),
  listSnapshotObjects: async (snapshotId: number, objectType?: string): Promise<Array<Record<string, unknown>>> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/objects${toQueryString({ object_type: objectType })}`)),
  listSnapshotFlows: async (snapshotId: number): Promise<DeepWikiFlow[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/flows`)),
  listSnapshotAssertions: async (snapshotId: number): Promise<DeepWikiAssertion[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/assertions`)),
  listSnapshotScenarios: async (snapshotId: number): Promise<DeepWikiScenario[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/scenarios`)),
  listSnapshotSemanticScores: async (snapshotId: number): Promise<DeepWikiSemanticScore[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/semantic-scores`)),
  querySnapshot: async (
    snapshotId: number,
    payload: {
      query: string;
      mode?: 'local' | 'global' | 'auto';
      top_k?: number;
      candidate_k?: number;
      rerank_top_k?: number;
    }
  ): Promise<DeepWikiSnapshotQueryResponse> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/snapshots/${snapshotId}/query`, payload)),

  /** 旧版 control-plane 无此路由时会 404；静默降级为空列表，避免控制台刷屏。部署含该路由的版本后可正常展示。 */
  listSnapshotConsistencyChecks: async (snapshotId: number): Promise<DeepWikiConsistencyCheck[]> => {
    try {
      const res = await apiClient.get(
        `/v1/deepwiki/snapshots/${snapshotId}/consistency-checks`,
        { silentErrorLog: true } as AxiosConfigWithSilent
      );
      return unwrapData(res);
    } catch {
      return [];
    }
  },

  createFeedbackEvent: async (
    pipelineType: string,
    payload: {
      project_id: number;
      snapshot_id?: number | null;
      feedback_type?: string;
      source_ref_id?: string | null;
      payload_json?: Record<string, unknown>;
      evidence_json?: unknown[];
      status?: string;
    }
  ): Promise<DeepWikiFeedbackEvent> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/feedback/${encodeURIComponent(pipelineType)}`, payload)),
  createTechSpecBundleFromSnapshot: async (
    snapshotId: number,
    payload?: { title?: string; project_code?: string }
  ): Promise<DeepWikiSnapshotDocBundleResponse> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/snapshots/${snapshotId}/doc-bundles/tech-spec`, payload || {})),
  createTestPlanBundleFromSnapshot: async (
    snapshotId: number,
    payload?: { title?: string; project_code?: string }
  ): Promise<DeepWikiSnapshotDocBundleResponse> =>
    unwrapData(await apiClient.post(`/v1/deepwiki/snapshots/${snapshotId}/doc-bundles/test-plan`, payload || {})),
  getProjectTopology: async (
    projectId: number,
    snapshotId?: number
  ): Promise<{ project: DeepWikiProject; snapshot?: DeepWikiSnapshot | null; topology?: DeepWikiProjectionAsset<DeepWikiProjectTopology> | null }> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/topology${toQueryString({ snapshot_id: snapshotId })}`)),
  getProjectScores: async (projectId: number, snapshotId?: number): Promise<DeepWikiScoreRecord[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/scores${toQueryString({ snapshot_id: snapshotId })}`)),
  getProjectHealth: async (projectId: number, snapshotId?: number): Promise<DeepWikiHealthIndex | null> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/projects/${projectId}/health${toQueryString({ snapshot_id: snapshotId })}`)),
  getSnapshotScores: async (snapshotId: number): Promise<DeepWikiScoreRecord[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/scores`)),
  getSnapshotScoreBreakdowns: async (snapshotId: number): Promise<Record<string, unknown>> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/score-breakdowns`)),
  getSnapshotScoreRegressions: async (snapshotId: number): Promise<Record<string, unknown>[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/snapshots/${snapshotId}/score-regressions`)),
  getDomainScores: async (domainId: string, snapshotId: number): Promise<DeepWikiScoreRecord[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/domains/${encodeURIComponent(domainId)}/scores${toQueryString({ snapshot_id: snapshotId })}`)),
  getFlowScores: async (flowId: string, snapshotId: number): Promise<DeepWikiScoreRecord[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/flows/${encodeURIComponent(flowId)}/scores${toQueryString({ snapshot_id: snapshotId })}`)),
  getSolutionScores: async (solutionId: string, snapshotId: number): Promise<DeepWikiScoreRecord[]> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/solutions/${encodeURIComponent(solutionId)}/scores${toQueryString({ snapshot_id: snapshotId })}`)),
  getRankingView: async (viewKey: string, snapshotId: number): Promise<Record<string, unknown> | null> =>
    unwrapData(await apiClient.get(`/v1/deepwiki/rankings/${encodeURIComponent(viewKey)}${toQueryString({ snapshot_id: snapshotId })}`)),
};

export const harnessApi = {
  listCards: async (): Promise<HarnessCard[]> => unwrapData(await apiClient.get('/v1/harness/cards')),
  createCard: async (payload: HarnessCardCreateRequest): Promise<HarnessCard> =>
    unwrapData(await apiClient.post('/v1/harness/cards', payload)),
  getCard: async (cardId: number): Promise<HarnessCard> => unwrapData(await apiClient.get(`/v1/harness/cards/${cardId}`)),
  confirmDemand: async (cardId: number, payload: { comment?: string }): Promise<HarnessCard> =>
    unwrapData(await apiClient.post(`/v1/harness/cards/${cardId}/confirm-demand`, payload)),
  confirmDesign: async (cardId: number, payload: { comment?: string }): Promise<HarnessCard> =>
    unwrapData(await apiClient.post(`/v1/harness/cards/${cardId}/confirm-design`, payload)),
  submitUatResult: async (
    cardId: number,
    payload: { result: 'pass' | 'fail'; comment?: string; summary?: string }
  ): Promise<HarnessCard> => unwrapData(await apiClient.post(`/v1/harness/cards/${cardId}/uat-result`, payload)),
  startRuntime: async (
    cardId: number,
    payload: { trigger?: string; change_request?: string; target_file?: string; replace_before?: string; replace_after?: string; append_content?: string; full_content?: string }
  ): Promise<HarnessRuntimeRun> => unwrapData(await apiClient.post(`/v1/harness/cards/${cardId}/runtime/start`, payload)),
  getRuntimeRun: async (runId: number): Promise<HarnessRuntimeRun> =>
    unwrapData(await apiClient.get(`/v1/harness/runtime-runs/${runId}`)),
  listRuntimeLogs: async (runId: number): Promise<HarnessMessage[]> =>
    unwrapData(await apiClient.get(`/v1/harness/runtime-runs/${runId}/logs`)),
  streamUrl: (): string => `${API_BASE}/v1/harness/stream`,
};

/** 控制平面统一包一层 `{ success, data }` */
function unwrapCp<T>(response: unknown): T {
  const r = response as { data?: T };
  if (r && typeof r === 'object' && r.data !== undefined) {
    return r.data as T;
  }
  return response as T;
}

export interface GateRuleRow {
  id: number;
  gate_type: string;
  gate_name: string;
  version?: string;
  status?: string;
  rules_config?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface GateExecutionRow {
  id?: number;
  gate_type?: string;
  gate_name?: string;
  trace_id?: string;
  status?: string;
  result?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface GateEngineLogRow {
  id?: number;
  gate_type?: string;
  event?: string;
  trace_id?: string;
  detail?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface AuditLogRow {
  id?: string | number;
  request_id?: string;
  timestamp?: string;
  model?: string;
  purpose?: string;
  client_app?: string;
  http_status?: number;
  created_at?: string;
  request_summary?: string;
  response_summary?: string;
  trace_id?: string;
  project_code?: string;
  [key: string]: unknown;
}

/** 对应控制平面 gateway_program_projects，库字段为 code / name */
export interface ProgramProjectRow {
  id?: number;
  code: string;
  name: string;
  layer?: string;
  okr_stage?: string;
  wave_id?: number | null;
  wave_name?: string | null;
  wave_code?: string | null;
  official_order?: number;
  owner_role?: string | null;
  co_owner_roles?: string[];
  start_date?: string | null;
  end_date?: string | null;
  status?: string;
  risk_level?: string;
  summary?: string | null;
  acceptance_rule?: string | null;
  milestone_count?: number;
  completed_milestone_count?: number;
  next_milestone_title?: string | null;
  next_milestone_due_date?: string | null;
  next_milestone_status?: string | null;
  open_risk_count?: number;
  evidence_count?: number;
  metadata_json?: Record<string, unknown>;
  milestones?: ProjectMilestoneRow[];
  evidence_packs?: EvidencePackRow[];
  [key: string]: unknown;
}

/** 对应 gateway_waves：code / name */
export interface WaveRow {
  id?: number;
  code?: string;
  name?: string;
  stage?: string;
  status?: string;
  [key: string]: unknown;
}

export interface ProjectMilestoneRow {
  id?: number;
  project_code?: string;
  milestone_type?: string;
  checkpoint_label?: string | null;
  title?: string;
  due_date?: string | null;
  acceptance_rule?: string | null;
  status?: string;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface EvidencePackRow {
  id?: number;
  project_code?: string;
  milestone_type?: string;
  review_result?: string;
  title?: string;
  reviewer?: string | null;
  trace_id?: string;
  pipeline_run_id?: number | null;
  summary?: string | null;
  metadata_json?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface PipelineRunRow {
  id?: number;
  pipeline_id?: number;
  pipeline_name?: string;
  pipeline_key?: string;
  source_ref?: string | null;
  trace_id?: string;
  status?: string;
  approval_status?: string;
  node_count?: number;
  completed_node_count?: number;
  failed_node_count?: number;
  pending_approval_count?: number;
  project_code?: string | null;
  request_payload?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface RuntimeNodeRow {
  id?: number;
  node_key?: string;
  node_name?: string;
  node_type?: string;
  status?: string;
  started_at?: string;
  ended_at?: string | null;
  output_summary?: string | null;
  input_payload?: Record<string, unknown> | null;
  output_payload?: Record<string, unknown> | null;
  retrieval_context?: Array<Record<string, unknown>>;
  evidence_refs?: Array<Record<string, unknown> | string>;
  [key: string]: unknown;
}

export interface ApprovalTaskRow {
  id?: number;
  approver_role?: string;
  status?: string;
  decision?: string | null;
  comment?: string | null;
  approval_context?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface RuntimeTraceDetail {
  run?: PipelineRunRow | null;
  nodes?: RuntimeNodeRow[];
  usage_logs?: Array<Record<string, unknown>>;
  gate_executions?: Array<Record<string, unknown>>;
  evidence_packs?: EvidencePackRow[];
  approvals?: ApprovalTaskRow[];
  doc_bundles?: Array<Record<string, unknown>>;
  doc_gate_executions?: Array<Record<string, unknown>>;
  workflow_summary?: Record<string, unknown> | null;
  memory_turns?: MemoryTurnRow[];
  memory_recalls?: MemoryRecallRow[];
  memory_facts?: MemoryFactRow[];
  [key: string]: unknown;
}

export interface MemoryPolicyRow {
  id?: number;
  scope_type?: string;
  scope_id?: string;
  enabled?: boolean;
  capture_mode?: string;
  fact_extraction?: boolean;
  retention_days?: number;
  redaction_mode?: string;
  max_recall_tokens?: number;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MemoryThreadRow {
  id?: number;
  scope_key?: string;
  thread_key?: string;
  source_system?: string;
  client_app?: string | null;
  project_code?: string | null;
  title?: string | null;
  summary_text?: string | null;
  last_message_at?: string | null;
  turn_count?: number;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MemoryTurnRow {
  id?: number;
  trace_id?: string | null;
  scope_key?: string;
  thread_key?: string;
  room_key?: string | null;
  hall_key?: string | null;
  role?: string;
  summary_text?: string | null;
  content_text_redacted?: string | null;
  created_at?: string;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MemoryFactRow {
  id?: number;
  scope_key?: string;
  thread_key?: string | null;
  fact_type?: string;
  subject_text?: string;
  predicate_text?: string;
  object_text?: string | null;
  confidence?: number | null;
  valid_from?: string;
  valid_to?: string | null;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MemoryRecallRow {
  id?: number;
  trace_id?: string | null;
  scope_key?: string;
  thread_key?: string | null;
  query_text?: string | null;
  recall_text?: string | null;
  token_count?: number;
  latency_ms?: number;
  status?: string;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface IntegrationConnectionRow {
  id?: number;
  connection_key?: string;
  name?: string;
  category?: string;
  endpoint_url?: string | null;
  auth_mode?: string | null;
  owner_role?: string | null;
  status?: string;
  last_sync_at?: string | null;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ValueAssessmentRow {
  id?: number;
  project_code?: string;
  assessment_key?: string;
  demand_title?: string | null;
  value_summary?: string | null;
  assessment_status?: string;
  assessment_score?: number | null;
  confirm_owner?: string | null;
  confirm_time?: string | null;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface CertificationRecordRow {
  id?: number;
  project_code?: string | null;
  record_type?: string;
  subject_name?: string;
  owner_role?: string | null;
  assessment_result?: string | null;
  score?: number | null;
  effective_date?: string | null;
  report_uri?: string | null;
  metadata_json?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface AcceptanceCheckpointRow {
  key: string;
  label: string;
  due_date: string;
  total_count: number;
  completed_count: number;
  blocked_count: number;
  projects: Array<Record<string, unknown>>;
}

export interface AcceptanceOverview {
  checkpoints: AcceptanceCheckpointRow[];
  summary: Record<string, unknown>;
}

export interface PipelineTemplateRow {
  id?: number;
  pipeline_key?: string;
  name?: string;
  domain?: string;
  description?: string | null;
  template_ref?: string | null;
  source_ref?: string | null;
  source_exists?: boolean;
  current_version?: string | null;
  node_count?: number;
  owner_role?: string | null;
  status?: string;
  [key: string]: unknown;
}

export interface KnowledgeAssetRow {
  id: number;
  title?: string;
  asset_type?: string;
  status?: string;
  domain?: string;
  module?: string;
  [key: string]: unknown;
}

export interface RagQueryLogRow {
  id?: number;
  project_code?: string;
  query_text?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface AuditEventRow {
  id?: number;
  event_type?: string;
  resource_type?: string;
  created_at?: string;
  [key: string]: unknown;
}

export interface EfficiencyReport {
  baselines?: Array<Record<string, unknown>>;
  aggregates?: Array<Record<string, unknown>>;
  metrics?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DocBundleRow {
  id: number;
  bundle_code?: string;
  title?: string;
  status?: string;
  current_stage?: string;
  project_code?: string;
  workflow_mode?: string;
  [key: string]: unknown;
}

export const gateApi = {
  listRules: async (params?: { status?: string; gate_type?: string; merge?: string }): Promise<GateRuleRow[]> => {
    const r = await apiClient.get('/v1/gates/rules', { params });
    return unwrapData<GateRuleRow[]>(r);
  },
  getRule: async (id: number): Promise<GateRuleRow> => unwrapData(await apiClient.get(`/v1/gates/rules/${id}`)),
  createRule: async (body: Partial<GateRuleRow> & { gate_type: string; gate_name: string }): Promise<GateRuleRow> =>
    unwrapData(await apiClient.post('/v1/gates/rules', body)),
  patchRule: async (id: number, body: Record<string, unknown>): Promise<GateRuleRow> =>
    unwrapData(await apiClient.patch(`/v1/gates/rules/${id}`, body)),
  listExecutions: async (params?: { limit?: number; offset?: number; gate_type?: string }): Promise<GateExecutionRow[]> => {
    const r = await apiClient.get('/v1/gates/executions', { params });
    return unwrapData<GateExecutionRow[]>(r);
  },
  listEngineLogs: async (
    params?: Record<string, string | number | undefined>
  ): Promise<{ rows: GateEngineLogRow[]; total: number }> => {
    const raw = (await apiClient.get('/v1/gates/engine-logs', { params })) as {
      data?: GateEngineLogRow[];
      total?: number;
    };
    const rows = unwrapData<GateEngineLogRow[]>(raw);
    const total = raw.total ?? rows.length;
    return { rows, total };
  },
};

export const auditLogsApi = {
  list: async (params?: {
    page?: number;
    limit?: number;
    start?: string;
    end?: string;
    model?: string;
    api_key?: string;
    requestId?: string;
    status?: string;
    purpose?: string;
    client_app?: string;
  }): Promise<{ logs: AuditLogRow[]; total: number; pagination: Record<string, unknown> }> => {
    const r = (await apiClient.get('/v1/audit-logs', { params })) as {
      logs?: AuditLogRow[];
      total?: number;
      pagination?: Record<string, unknown>;
    };
    return {
      logs: r.logs || [],
      total: r.total ?? 0,
      pagination: r.pagination || {},
    };
  },
};

export const programApi = {
  listWaves: async (): Promise<WaveRow[]> => unwrapCp(await apiClient.get('/v1/program/waves')),
  listProjects: async (): Promise<ProgramProjectRow[]> => unwrapCp(await apiClient.get('/v1/program/projects')),
  getProject: async (code: string): Promise<ProgramProjectRow> =>
    unwrapCp(await apiClient.get(`/v1/program/projects/${encodeURIComponent(code)}`)),
  getOpsSummary: async (code: string): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.get(`/v1/program/projects/${encodeURIComponent(code)}/ops-summary`)),
};

export const evidenceApi = {
  listPacks: async (projectCode?: string): Promise<EvidencePackRow[]> =>
    unwrapCp(await apiClient.get(`/v1/evidence/packs${toQueryString({ project_code: projectCode })}`)),
  createPack: async (body: Record<string, unknown>): Promise<EvidencePackRow> =>
    unwrapCp(await apiClient.post('/v1/evidence/packs', body)),
};

export const controlPlaneApi = {
  listRepositories: async (): Promise<Array<Record<string, unknown>>> =>
    unwrapCp(await apiClient.get('/v1/control/repositories')),
  createRepository: async (body: Record<string, unknown>): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post('/v1/control/repositories', body)),
  listPipelines: async (): Promise<PipelineTemplateRow[]> => unwrapCp(await apiClient.get('/v1/control/pipeline-templates')),
  createPipeline: async (body: Record<string, unknown>): Promise<PipelineTemplateRow> =>
    unwrapCp(await apiClient.post('/v1/control/pipelines', body)),
  publishPipeline: async (id: number): Promise<PipelineTemplateRow> =>
    unwrapCp(await apiClient.post(`/v1/control/pipelines/${id}/publish`)),
  listAgents: async (): Promise<Array<Record<string, unknown>>> => unwrapCp(await apiClient.get('/v1/control/agents')),
  listSchemas: async (): Promise<Array<Record<string, unknown>>> => unwrapCp(await apiClient.get('/v1/control/schemas')),
  listSkills: async (): Promise<Array<Record<string, unknown>>> => unwrapCp(await apiClient.get('/v1/control/skills')),
  listIntegrations: async (): Promise<IntegrationConnectionRow[]> =>
    unwrapCp(await apiClient.get('/v1/control/integrations')),
  listMemoryPolicies: async (params?: Record<string, string | number | boolean | undefined>): Promise<MemoryPolicyRow[]> =>
    unwrapCp(await apiClient.get(`/v1/memory/policies${toQueryString(params)}`)),
  upsertMemoryPolicy: async (
    scopeType: string,
    scopeId: string,
    body: Record<string, unknown>
  ): Promise<MemoryPolicyRow> =>
    unwrapCp(await apiClient.put(`/v1/memory/policies/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}`, body)),
  listMemoryThreads: async (params?: Record<string, string | number | boolean | undefined>): Promise<MemoryThreadRow[]> =>
    unwrapCp(await apiClient.get(`/v1/memory/threads${toQueryString(params)}`)),
  getMemoryThread: async (threadKey: string, params?: Record<string, string | number | boolean | undefined>): Promise<{ thread: MemoryThreadRow; turns: MemoryTurnRow[] }> =>
    unwrapCp(await apiClient.get(`/v1/memory/threads/${encodeURIComponent(threadKey)}${toQueryString(params)}`)),
  searchMemory: async (params?: Record<string, string | number | boolean | undefined>): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.get(`/v1/memory/search${toQueryString(params)}`)),
  listMemoryFacts: async (params?: Record<string, string | number | boolean | undefined>): Promise<MemoryFactRow[]> =>
    unwrapCp(await apiClient.get(`/v1/memory/facts${toQueryString(params)}`)),
};

export const contractsApi = {
  listStandardNodes: async (): Promise<Array<Record<string, unknown>>> =>
    unwrapCp(await apiClient.get('/v1/contracts/standard-nodes')),
  getStandardNode: async (nodeKey: string): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.get(`/v1/contracts/standard-nodes/${encodeURIComponent(nodeKey)}`)),
  getDocGateOutputSchema: async (): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.get('/v1/contracts/doc-gate-output-schema')),
};

export const runtimeApi = {
  listRuns: async (): Promise<PipelineRunRow[]> => unwrapCp(await apiClient.get('/v1/runtime/pipeline-runs')),
  startRun: async (body: Record<string, unknown>): Promise<PipelineRunRow> =>
    unwrapCp(await apiClient.post('/v1/runtime/pipeline-runs', body)),
  getTrace: async (traceId: string): Promise<RuntimeTraceDetail> =>
    unwrapCp(await apiClient.get(`/v1/runtime/traces/${encodeURIComponent(traceId)}`)),
  decideApproval: async (id: number, body: Record<string, unknown>): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/runtime/approvals/${id}/decision`, body)),
};

export const auditApi = {
  listEvents: async (): Promise<AuditEventRow[]> => unwrapCp(await apiClient.get('/v1/audit/events')),
};

export const knowledgeApi = {
  listAssets: async (params?: Record<string, string | undefined>): Promise<KnowledgeAssetRow[]> =>
    unwrapCp(
      await apiClient.get(
        `/v1/knowledge/assets${toQueryString(
          params as Record<string, string | number | boolean | undefined>
        )}`
      )
    ),
  ingestAsset: async (id: number, body?: Record<string, unknown>): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/knowledge/assets/${id}/ingest`, body || {})),
  spotCheck: async (id: number, body?: Record<string, unknown>): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/knowledge/assets/${id}/spot-check`, body || {})),
  listRagQueries: async (projectCode?: string): Promise<RagQueryLogRow[]> =>
    unwrapCp(await apiClient.get(`/v1/knowledge/rag-queries${toQueryString({ project_code: projectCode })}`)),
};

export const metricsApi = {
  getDashboard: async (): Promise<Record<string, unknown>> => unwrapCp(await apiClient.get('/v1/metrics/dashboard')),
  getEfficiencyReport: async (): Promise<EfficiencyReport> =>
    unwrapCp(await apiClient.get('/v1/metrics/efficiency-report')),
};

export const governanceApi = {
  getAcceptanceOverview: async (projectCode?: string): Promise<AcceptanceOverview> =>
    unwrapCp(await apiClient.get(`/v1/governance/acceptance-overview${toQueryString({ project_code: projectCode })}`)),
  listCertifications: async (projectCode?: string): Promise<CertificationRecordRow[]> =>
    unwrapCp(await apiClient.get(`/v1/governance/certifications${toQueryString({ project_code: projectCode })}`)),
};

export const valueAssessmentApi = {
  list: async (projectCode?: string): Promise<ValueAssessmentRow[]> =>
    unwrapCp(await apiClient.get(`/v1/value-assessments${toQueryString({ project_code: projectCode })}`)),
};

export const docBundlesApi = {
  list: async (): Promise<DocBundleRow[]> => unwrapCp(await apiClient.get('/v1/doc-bundles')),
  get: async (bundleId: number): Promise<DocBundleRow & Record<string, unknown>> =>
    unwrapCp(await apiClient.get(`/v1/doc-bundles/${bundleId}`)),
  create: async (body: Record<string, unknown>): Promise<DocBundleRow> =>
    unwrapCp(await apiClient.post('/v1/doc-bundles', body)),
  upsertContext: async (bundleId: number, body: Record<string, unknown>): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/context`, body)),
  generateTechSpec: async (bundleId: number): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/tech-specs/generate`, {})),
  buildCoverageGraph: async (bundleId: number): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/coverage-graphs/build`, {})),
  generateTestPlan: async (bundleId: number): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/test-plans/generate`, {})),
  evaluateInputContractGate: async (bundleId: number): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/gates/input-contract`, {})),
  evaluatePrdGate: async (bundleId: number): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/gates/prd`, {})),
  evaluateTechSpecGate: async (bundleId: number): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/gates/tech-spec`, {})),
  evaluateTestPlanGate: async (bundleId: number): Promise<Record<string, unknown>> =>
    unwrapCp(await apiClient.post(`/v1/doc-bundles/${bundleId}/gates/test-plan`, {})),
};

export default apiClient;
