import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Tabs,
  Tag,
  Tree,
  Typography,
  message,
} from 'antd';
import {
  BranchesOutlined,
  DeleteOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { MermaidBlock } from '../components/deepwiki/MermaidBlock';
import { WikiGraphView } from '../components/deepwiki/WikiGraphView';
import { renderMarkdownBlocks } from './deepwiki/deepWikiMarkdown';
import { statusTag } from './deepwiki/deepWikiStatus';
import { buildWikiTreeData, filterWikiTreeData } from './deepwiki/deepWikiTree';
import {
  deepWikiApi,
  type DeepWikiAddRepoToProjectRequest,
  type DeepWikiBootstrapSummary,
  type DeepWikiDiagramAsset,
  type DeepWikiGateDecisionRow,
  type DeepWikiGenerationJob,
  type DeepWikiHealthIndex,
  type DeepWikiPageRow,
  type DeepWikiProjectionAsset,
  type DeepWikiProject,
  type DeepWikiProjectCreateRequest,
  type DeepWikiProjectTopology,
  type DeepWikiProjectRepo,
  type DeepWikiRepoRow,
  type DeepWikiScoreRecord,
  type DeepWikiSnapshot,
  type DeepWikiSnapshotOverview,
  type DeepWikiSnapshotQuality,
  type DeepWikiSnapshotQueryResponse,
  type DeepWikiSkillContract,
  type DeepWikiSkillExecution,
  type DeepWikiStageRun,
  type DeepWikiThread,
  type DeepWikiVersionLine,
} from '../services/api';

const { Paragraph, Text } = Typography;
const { Search } = Input;

const DIAGRAM_ORDER: Array<DeepWikiDiagramAsset['diagram_type']> = [
  'overview',
  'code_layered_architecture',
  'technical_architecture',
  'product_architecture',
  'business_domain',
  'business_flow',
  'module_flow',
  'core_logic',
  'database_er',
];

const CRITICAL_DIAGRAM_TYPES: string[] = [
  'code_layered_architecture',
  'technical_architecture',
  'business_flow',
  'core_logic',
  'database_er',
];

const DIAGRAM_LABELS: Record<string, string> = {
  overview: '总图',
  code_layered_architecture: '代码分层架构图',
  product_architecture: '产品架构图',
  technical_architecture: '技术架构图',
  business_domain: '业务域知识图',
  business_flow: '业务总体流程图',
  module_flow: '模块流程图',
  core_logic: '核心逻辑时序图',
  database_er: '数据库 ER 图',
};

const THREAD_LEVEL_LABELS: Record<string, string> = {
  project_trunk: '项目主干',
  domain: '业务域',
  core_thread: '核心线程',
  branch_thread: '分支线程',
  exception_thread: '异常线程',
  frontend_journey: '前后端联动',
};

const STAGE_LABELS: Record<string, string> = {
  repo_understanding: '仓库理解',
  structure_extraction: '结构抽取',
  data_contract_extraction: '数据与契约',
  semantic_mining: '语义挖掘',
  ddd_mapping: 'DDD 映射',
  evidence_ranking_binding: '证据绑定',
  diagram_composition: '图谱生成',
  wiki_authoring: 'Wiki 写作',
  quality_gates: '质量门禁',
  solution_derivation: '方案派生',
};

const BLOCKER_LABELS: Record<string, string> = {
  missing_repo_revisions: '缺少代码修订集合',
  missing_pages: '缺少 Wiki 页面',
  missing_diagram_assets: '缺少关键图表资产',
  missing_critical_diagrams: '缺少关键架构/流程图',
  diagram_fallback_detected: '关键图仍为 fallback 草图',
  diagram_missing_evidence: '关键图缺少证据来源',
  diagram_low_business_specificity: '关键图业务特异性不足',
  diagram_not_exportable: '关键图尚不可导出',
  missing_thread_views: '缺少线程视图',
  missing_branch_threads: '缺少分支线程',
  inventory_noise_detected: '检测到噪声目录',
  missing_frontend_repo_view: '缺少前端 / BFF 视角',
  missing_quality_report: '缺少质量报告',
  quality_gate_blocked: '质量门禁未通过',
  missing_prd_or_biz_spec: '缺少 PRD / 业务方案',
  missing_tech_spec: '缺少技术方案资产',
  missing_api_contract: '缺少接口契约文档',
  missing_ddl: '缺少数据库 DDL',
  snapshot_not_found: '快照不存在',
};

const REPO_ROLE_OPTIONS = [
  { label: '前端', value: 'frontend' },
  { label: 'BFF', value: 'bff' },
  { label: '服务', value: 'service' },
  { label: '任务', value: 'job' },
  { label: '测试', value: 'test' },
  { label: '文档', value: 'doc' },
];

type ProjectFormValues = DeepWikiProjectCreateRequest & {
  repo_bindings?: Array<{
    repo_source_id?: number;
    repo_role?: string;
    branch?: string;
    is_primary?: boolean;
  }>;
};

type VersionLineFormValues = {
  branch_name: string;
  display_name?: string;
  repo_mappings?: Array<{
    project_repo_id: number;
    repo_branch_name?: string;
  }>;
};

type VersionLineRepoMapping = {
  project_repo_id: number;
  repo_branch_name: string;
};

function blockerLabel(value: string) {
  return BLOCKER_LABELS[value] || value;
}

function isActiveDevinSyncJob(job?: DeepWikiGenerationJob | null) {
  if (!job) return false;
  const status = String(job.status || '').trim().toLowerCase();
  if (['queued', 'running', 'submitted'].includes(status)) {
    const sessionState = String(job.result_json?.devin_status_enum || '').trim().toLowerCase();
    return sessionState !== 'finished';
  }
  return false;
}

function devinLatestMessageText(job?: DeepWikiGenerationJob | null) {
  const latest = job?.result_json?.devin_latest_message;
  if (!latest || typeof latest !== 'object' || Array.isArray(latest)) {
    return '';
  }
  return String((latest as { message?: unknown }).message || '').trim();
}

function scoreColor(value?: number | null) {
  if (!Number.isFinite(Number(value))) return 'default';
  const score = Number(value);
  if (score >= 0.85) return 'green';
  if (score >= 0.7) return 'blue';
  if (score >= 0.6) return 'orange';
  return 'red';
}

function hasNumericId(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function repoBindingDefaultBranch(repo?: DeepWikiProjectRepo | null, fallback = 'main') {
  return (
    String(repo?.metadata_json?.default_branch || '') ||
    String(repo?.repo_source?.default_branch || '') ||
    fallback
  ).trim();
}

function stringifySkillList(values?: string[]) {
  return Array.isArray(values) ? values.join('\n') : '';
}

function parseSkillList(value: unknown) {
  return String(value || '')
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function clearSnapshotScopedState(
  setters: {
    setSnapshotOverview: (value: DeepWikiSnapshotOverview | null) => void;
    setSnapshotGraph: (value: any | null) => void;
    setSnapshotPages: (value: DeepWikiPageRow[]) => void;
    setPagesOwnerSnapshotId: (value: number | undefined) => void;
    setSnapshotQuality: (value: DeepWikiSnapshotQuality | null) => void;
    setDiagramAssets: (value: DeepWikiDiagramAsset[]) => void;
    setSnapshotThreads: (value: DeepWikiThread[]) => void;
    setSelectedPageId: (value: number | undefined) => void;
    setPageContent: (value: string) => void;
    setPageContentOwner: (value: { snapshotId: number; pageId: number } | null) => void;
    setProjectTopology: (value: DeepWikiProjectionAsset<DeepWikiProjectTopology> | null) => void;
    setSnapshotStageRuns: (value: DeepWikiStageRun[]) => void;
    setSnapshotStageAssets: (value: DeepWikiProjectionAsset[]) => void;
    setSnapshotSkillExecutions: (value: DeepWikiSkillExecution[]) => void;
    setSnapshotGateDecisionRows: (value: DeepWikiGateDecisionRow[]) => void;
    setSnapshotGateDecisionAsset: (value: DeepWikiProjectionAsset | null) => void;
    setSnapshotEvidenceAsset: (value: DeepWikiProjectionAsset | null) => void;
    setSnapshotConfidenceAsset: (value: DeepWikiProjectionAsset | null) => void;
    setSnapshotScores: (value: DeepWikiScoreRecord[]) => void;
    setSnapshotScoreBreakdowns: (value: Record<string, unknown> | null) => void;
    setSnapshotScoreRegressions: (value: Record<string, unknown>[]) => void;
  }
) {
  setters.setSnapshotOverview(null);
  setters.setSnapshotGraph(null);
  setters.setSnapshotPages([]);
  setters.setPagesOwnerSnapshotId(undefined);
  setters.setSnapshotQuality(null);
  setters.setDiagramAssets([]);
  setters.setSnapshotThreads([]);
  setters.setSelectedPageId(undefined);
  setters.setPageContent('');
  setters.setPageContentOwner(null);
  setters.setProjectTopology(null);
  setters.setSnapshotStageRuns([]);
  setters.setSnapshotStageAssets([]);
  setters.setSnapshotSkillExecutions([]);
  setters.setSnapshotGateDecisionRows([]);
  setters.setSnapshotGateDecisionAsset(null);
  setters.setSnapshotEvidenceAsset(null);
  setters.setSnapshotConfidenceAsset(null);
  setters.setSnapshotScores([]);
  setters.setSnapshotScoreBreakdowns(null);
  setters.setSnapshotScoreRegressions([]);
}

function buildVersionMappingDefaults(project: DeepWikiProject | null): VersionLineRepoMapping[] {
  return (project?.repos || [])
    .filter((repo) => hasNumericId(repo.id))
    .map((repo) => ({
      project_repo_id: Number(repo.id),
      repo_branch_name: repoBindingDefaultBranch(repo, project?.default_branch || 'main'),
    }));
}

function normalizeVersionMappings(
  mappings?: VersionLineFormValues['repo_mappings']
): VersionLineRepoMapping[] {
  return (mappings || []).flatMap((item) => {
    if (!hasNumericId(item.project_repo_id)) {
      return [];
    }
    const repoBranchName = String(item.repo_branch_name || '').trim();
    if (!repoBranchName) {
      return [];
    }
    return [
      {
        project_repo_id: Number(item.project_repo_id),
        repo_branch_name: repoBranchName,
      },
    ];
  });
}

function formatApiError(error: any, fallback: string) {
  const blockerText = Array.isArray(error?.response?.data?.blockers)
    ? error.response.data.blockers.map((item: string) => blockerLabel(item)).join('、')
    : '';
  if (blockerText) {
    return `${fallback}：${blockerText}`;
  }
  return error?.response?.data?.error || error?.message || fallback;
}

const DeepWikiCenter: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [projects, setProjects] = useState<DeepWikiProject[]>([]);
  const [availableRepos, setAvailableRepos] = useState<DeepWikiRepoRow[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>();
  const [selectedProject, setSelectedProject] = useState<DeepWikiProject | null>(null);
  const [projectOwnerId, setProjectOwnerId] = useState<number | undefined>();
  const [versionLines, setVersionLines] = useState<DeepWikiVersionLine[]>([]);
  const [diagnosticVersionLines, setDiagnosticVersionLines] = useState<DeepWikiVersionLine[]>([]);
  const [selectedVersionLineId, setSelectedVersionLineId] = useState<number | undefined>();
  const [snapshots, setSnapshots] = useState<DeepWikiSnapshot[]>([]);
  const [snapshotsOwnerVersionLineId, setSnapshotsOwnerVersionLineId] = useState<number | undefined>();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number | undefined>();
  const [snapshotOverview, setSnapshotOverview] = useState<DeepWikiSnapshotOverview | null>(null);
  const [snapshotGraph, setSnapshotGraph] = useState<any | null>(null);
  const [snapshotPages, setSnapshotPages] = useState<DeepWikiPageRow[]>([]);
  const [pagesOwnerSnapshotId, setPagesOwnerSnapshotId] = useState<number | undefined>();
  const [selectedPageId, setSelectedPageId] = useState<number | undefined>();
  const [pageContent, setPageContent] = useState('');
  const [pageContentOwner, setPageContentOwner] = useState<{ snapshotId: number; pageId: number } | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [snapshotQuality, setSnapshotQuality] = useState<DeepWikiSnapshotQuality | null>(null);
  const [diagramAssets, setDiagramAssets] = useState<DeepWikiDiagramAsset[]>([]);
  const [snapshotThreads, setSnapshotThreads] = useState<DeepWikiThread[]>([]);
  const [projectTopology, setProjectTopology] = useState<DeepWikiProjectionAsset<DeepWikiProjectTopology> | null>(null);
  const [snapshotStageRuns, setSnapshotStageRuns] = useState<DeepWikiStageRun[]>([]);
  const [snapshotStageAssets, setSnapshotStageAssets] = useState<DeepWikiProjectionAsset[]>([]);
  const [snapshotSkillExecutions, setSnapshotSkillExecutions] = useState<DeepWikiSkillExecution[]>([]);
  const [snapshotGateDecisionRows, setSnapshotGateDecisionRows] = useState<DeepWikiGateDecisionRow[]>([]);
  const [snapshotGateDecisionAsset, setSnapshotGateDecisionAsset] = useState<DeepWikiProjectionAsset | null>(null);
  const [snapshotEvidenceAsset, setSnapshotEvidenceAsset] = useState<DeepWikiProjectionAsset | null>(null);
  const [snapshotConfidenceAsset, setSnapshotConfidenceAsset] = useState<DeepWikiProjectionAsset | null>(null);
  const [projectScores, setProjectScores] = useState<DeepWikiScoreRecord[]>([]);
  const [projectHealth, setProjectHealth] = useState<DeepWikiHealthIndex | null>(null);
  const [snapshotScores, setSnapshotScores] = useState<DeepWikiScoreRecord[]>([]);
  const [snapshotScoreBreakdowns, setSnapshotScoreBreakdowns] = useState<Record<string, unknown> | null>(null);
  const [snapshotScoreRegressions, setSnapshotScoreRegressions] = useState<Record<string, unknown>[]>([]);
  const [skillRegistryLoading, setSkillRegistryLoading] = useState(false);
  const [skillRegistry, setSkillRegistry] = useState<DeepWikiSkillContract[]>([]);
  const [skillOverrideFile, setSkillOverrideFile] = useState('');
  const [selectedSkillKey, setSelectedSkillKey] = useState<string | undefined>();
  const [skillEditorOpen, setSkillEditorOpen] = useState(false);
  const [diagramRegeneratingKey, setDiagramRegeneratingKey] = useState<string | null>(null);
  const [snapshotQueryLoading, setSnapshotQueryLoading] = useState(false);
  const [snapshotQueryText, setSnapshotQueryText] = useState('');
  const [snapshotQueryMode, setSnapshotQueryMode] = useState<'local' | 'global' | 'auto'>('auto');
  const [snapshotQueryResult, setSnapshotQueryResult] = useState<DeepWikiSnapshotQueryResponse | null>(null);
  const [pageQuery, setPageQuery] = useState('');
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [repoModalOpen, setRepoModalOpen] = useState(false);
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [bootstrapSummary, setBootstrapSummary] = useState<DeepWikiBootstrapSummary | null>(null);
  const [projectForm] = Form.useForm<ProjectFormValues>();
  const [repoForm] = Form.useForm<DeepWikiAddRepoToProjectRequest>();
  const [versionForm] = Form.useForm<VersionLineFormValues>();
  const [skillForm] = Form.useForm();
  const initialQueryRef = useRef({
    projectId: Number(searchParams.get('project') || 0) || undefined,
    versionLineId: Number(searchParams.get('versionLine') || 0) || undefined,
    snapshotId: Number(searchParams.get('snapshot') || 0) || undefined,
    pageId: Number(searchParams.get('page') || 0) || undefined,
  });
  const initialQueryHydratingRef = useRef(Boolean(searchParams.toString()));
  const invalidSnapshotPageKeysRef = useRef<Set<string>>(new Set());
  const selectedProjectIdRef = useRef<number | undefined>(undefined);
  const selectedVersionLineIdRef = useRef<number | undefined>(undefined);
  const selectedSnapshotIdRef = useRef<number | undefined>(undefined);
  const selectedPageIdRef = useRef<number | undefined>(undefined);
  const pagesOwnerSnapshotIdRef = useRef<number | undefined>(undefined);
  const projectRequestRef = useRef(0);
  const snapshotListRequestRef = useRef(0);
  const snapshotDetailRequestRef = useRef(0);
  const pageContentRequestRef = useRef(0);
  const lastSyncedSearchRef = useRef(searchParams.toString());

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    selectedVersionLineIdRef.current = selectedVersionLineId;
  }, [selectedVersionLineId]);

  useEffect(() => {
    selectedSnapshotIdRef.current = selectedSnapshotId;
  }, [selectedSnapshotId]);

  useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  useEffect(() => {
    pagesOwnerSnapshotIdRef.current = pagesOwnerSnapshotId;
  }, [pagesOwnerSnapshotId]);

  useEffect(() => {
    lastSyncedSearchRef.current = location.search.replace(/^\?/, '');
  }, [location.search]);

  useEffect(() => {
    if (!initialQueryHydratingRef.current) {
      return;
    }
    if (!selectedProjectId || projectOwnerId !== selectedProjectId) {
      return;
    }
    if (selectedVersionLineId && snapshotsOwnerVersionLineId !== selectedVersionLineId) {
      return;
    }
    if (selectedSnapshotId && pagesOwnerSnapshotId !== selectedSnapshotId) {
      return;
    }
    initialQueryHydratingRef.current = false;
  }, [pagesOwnerSnapshotId, projectOwnerId, selectedProjectId, selectedSnapshotId, selectedVersionLineId, snapshotsOwnerVersionLineId]);

  const projectOptions = useMemo(
    () =>
      projects
        .filter((project) => hasNumericId(project.id))
        .map((project) => ({
          value: Number(project.id),
          label: `${project.project_name} (${project.project_code})`,
        })),
    [projects]
  );

  const versionLineOptions = useMemo(
    () =>
      versionLines
        .filter((item) => hasNumericId(item.id))
        .map((item) => ({
          value: Number(item.id),
          label: `${item.display_name || item.version_line_name || item.branch} · published ${item.published_snapshot ? 'yes' : 'no'} · snapshots ${item.snapshot_count || 0}`,
        })),
    [versionLines]
  );

  const snapshotOptions = useMemo(
    () =>
      snapshots
        .filter((item) => hasNumericId(item.id))
        .map((item) => ({
          value: Number(item.id),
          label: `${item.snapshot_version || item.commit_sha?.slice(0, 8) || `snapshot-${item.id}`} · ${item.publish_status || item.status || 'draft'} · ${item.quality_status || 'pending'}`,
        })),
    [snapshots]
  );

  const repoSourceOptions = useMemo(
    () =>
      availableRepos
        .filter((repo) => hasNumericId(repo.id))
        .map((repo) => ({
          value: Number(repo.id),
          label: `${repo.repo_slug} · ${repo.default_branch || 'main'}`,
        })),
    [availableRepos]
  );

  const activeProjectId = useMemo(
    () => (selectedProjectId && projects.some((item) => Number(item.id) === Number(selectedProjectId)) ? Number(selectedProjectId) : undefined),
    [projects, selectedProjectId]
  );

  const activeVersionLineId = useMemo(
    () =>
      activeProjectId && selectedVersionLineId && versionLines.some((item) => Number(item.id) === Number(selectedVersionLineId))
        ? Number(selectedVersionLineId)
        : undefined,
    [activeProjectId, selectedVersionLineId, versionLines]
  );

  const activeSnapshotId = useMemo(
    () =>
      activeVersionLineId && selectedSnapshotId && snapshots.some((item) => Number(item.id) === Number(selectedSnapshotId))
        ? Number(selectedSnapshotId)
        : undefined,
    [activeVersionLineId, selectedSnapshotId, snapshots]
  );

  const sortedDiagrams = useMemo(() => {
    const order = new Map(DIAGRAM_ORDER.map((item, index) => [item, index]));
    return [...diagramAssets].sort((left, right) => {
      const leftScopeRank = ['project', 'domain', 'thread', 'branch'].indexOf(String(left.scope_type || 'project'));
      const rightScopeRank = ['project', 'domain', 'thread', 'branch'].indexOf(String(right.scope_type || 'project'));
      if (leftScopeRank !== rightScopeRank) {
        return leftScopeRank - rightScopeRank;
      }
      const leftIndex = Number.isFinite(Number(left.sort_order)) ? Number(left.sort_order) : (order.get(left.diagram_type) ?? 99);
      const rightIndex = Number.isFinite(Number(right.sort_order)) ? Number(right.sort_order) : (order.get(right.diagram_type) ?? 99);
      if (leftIndex !== rightIndex) {
        return leftIndex - rightIndex;
      }
      return String(left.diagram_key || left.title || '').localeCompare(String(right.diagram_key || right.title || ''));
    });
  }, [diagramAssets]);

  const diagramGroups = useMemo(() => {
    const groups = new Map<string, { title: string; scopeType: string; scopeKey: string; diagrams: DeepWikiDiagramAsset[] }>();
    sortedDiagrams.forEach((diagram) => {
      const scopeType = String(diagram.scope_type || 'project');
      const scopeKey = String(diagram.scope_key || 'project');
      const groupKey = `${scopeType}:${scopeKey}`;
      const title =
        scopeType === 'project'
          ? '项目级图谱'
          : scopeType === 'domain'
            ? `领域图谱 · ${scopeKey}`
            : scopeType === 'thread'
              ? `线程图谱 · ${scopeKey}`
              : `分支图谱 · ${scopeKey}`;
      const existing = groups.get(groupKey);
      if (existing) {
        existing.diagrams.push(diagram);
      } else {
        groups.set(groupKey, { title, scopeType, scopeKey, diagrams: [diagram] });
      }
    });
    return Array.from(groups.values());
  }, [sortedDiagrams]);

  const groupedThreads = useMemo(() => {
    return [...snapshotThreads].sort((left, right) => {
      const levelOrder = ['project_trunk', 'domain', 'core_thread', 'branch_thread', 'exception_thread', 'frontend_journey'];
      const leftIndex = levelOrder.indexOf(String(left.thread_level || 'core_thread'));
      const rightIndex = levelOrder.indexOf(String(right.thread_level || 'core_thread'));
      if (leftIndex !== rightIndex) return leftIndex - rightIndex;
      return String(left.title || left.thread_key).localeCompare(String(right.title || right.thread_key));
    });
  }, [snapshotThreads]);

  const topologyPayload = useMemo<DeepWikiProjectTopology>(
    () =>
      projectTopology?.payload && typeof projectTopology.payload === 'object'
        ? (projectTopology.payload as DeepWikiProjectTopology)
        : { repos: [] },
    [projectTopology]
  );

  const topSnapshotScores = useMemo(
    () => [...snapshotScores].sort((left, right) => Number(right.overall_score || 0) - Number(left.overall_score || 0)).slice(0, 8),
    [snapshotScores]
  );

  const selectedSkillContract = useMemo(
    () =>
      skillRegistry.find(
        (item) => String(item.skillKey || item.skill_key || '') === String(selectedSkillKey || '')
      ) || null,
    [selectedSkillKey, skillRegistry]
  );

  const stageAssetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    snapshotStageAssets.forEach((asset) => {
      const key = String(asset.stageKey || 'unknown');
      counts.set(key, Number(counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([stageKey, count]) => ({ stageKey, count }));
  }, [snapshotStageAssets]);

  const selectedPage = useMemo(
    () => snapshotPages.find((item) => item.id === selectedPageId) || null,
    [selectedPageId, snapshotPages]
  );

  const selectedPageDiagram = useMemo(() => {
    if (!selectedPage) return null;
    const pageSlug = String(selectedPage.page_slug || '').toLowerCase();
    return (
      sortedDiagrams.find((diagram) => Number(diagram.source_page_id) === Number(selectedPage.id)) ||
      sortedDiagrams.find((diagram) => pageSlug.includes(String(diagram.diagram_type || '').toLowerCase())) ||
      sortedDiagrams.find((diagram) => pageSlug.includes(String(diagram.title || '').toLowerCase()))
    );
  }, [selectedPage, sortedDiagrams]);

  const filteredTreeData = useMemo(
    () => filterWikiTreeData(buildWikiTreeData(snapshotPages), pageQuery),
    [pageQuery, snapshotPages]
  );

  const shouldHideRawDiagramSource = useMemo(() => {
    const text = String(pageContent || '').trim();
    return Boolean(
      selectedPageDiagram?.content &&
      text &&
      !text.includes('```') &&
      /^(sequenceDiagram|flowchart|graph|erDiagram|stateDiagram|classDiagram)\b/i.test(text)
    );
  }, [pageContent, selectedPageDiagram]);

  const loadRepos = useCallback(async () => {
    const nextRepos = await deepWikiApi.listRepos();
    setAvailableRepos(nextRepos);
    return nextRepos;
  }, []);

  const loadSkillRegistry = useCallback(async () => {
    setSkillRegistryLoading(true);
    try {
      const data = await deepWikiApi.listSkills();
      const nextSkills = Array.isArray(data.skills)
        ? [...data.skills].sort((left, right) =>
            String(left.layer || '').localeCompare(String(right.layer || '')) ||
            String(left.skillKey || left.skill_key || '').localeCompare(String(right.skillKey || right.skill_key || ''))
          )
        : [];
      setSkillRegistry(nextSkills);
      setSkillOverrideFile(String(data.override_file || ''));
      setSelectedSkillKey((current) => {
        if (current && nextSkills.some((item) => String(item.skillKey || item.skill_key || '') === current)) {
          return current;
        }
        return nextSkills[0] ? String(nextSkills[0].skillKey || nextSkills[0].skill_key || '') : undefined;
      });
      return nextSkills;
    } finally {
      setSkillRegistryLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async () => {
    const nextProjects = await deepWikiApi.listProjects();
    setProjects(nextProjects);
    setSelectedProjectId((current) => {
      const queryProjectId = initialQueryRef.current.projectId;
      const preferredProjectId =
        (queryProjectId && nextProjects.some((item) => Number(item.id) === queryProjectId) ? queryProjectId : undefined) ||
        (current && nextProjects.some((item) => Number(item.id) === current) ? current : undefined) ||
        (hasNumericId(nextProjects[0]?.id) ? Number(nextProjects[0]?.id) : undefined);
      if (preferredProjectId === queryProjectId) {
        initialQueryRef.current.projectId = undefined;
      }
      return preferredProjectId;
    });
    return nextProjects;
  }, []);

  const loadProject = useCallback(
    async (projectId: number) => {
      const requestId = projectRequestRef.current + 1;
      projectRequestRef.current = requestId;
      const [project, versionLineResult, nextProjectScores, nextProjectHealth] = await Promise.all([
        deepWikiApi.getProject(projectId),
        deepWikiApi.listVersionLines(projectId),
        deepWikiApi.getProjectScores(projectId).catch(() => []),
        deepWikiApi.getProjectHealth(projectId).catch(() => null),
      ]);
      if (projectRequestRef.current !== requestId || selectedProjectIdRef.current !== projectId) {
        return null;
      }
      const nextVersionLines = (versionLineResult.version_lines || []).filter((item) => hasNumericId(item.id));
      setSelectedProject(project);
      setProjectOwnerId(projectId);
      setProjectScores(nextProjectScores);
      setProjectHealth(nextProjectHealth);
      setVersionLines(nextVersionLines);
      setDiagnosticVersionLines((versionLineResult.diagnostic_version_lines || []) as DeepWikiVersionLine[]);
      setSelectedVersionLineId((current) => {
        const queryVersionLineId = initialQueryRef.current.versionLineId;
        const preferredVersionLineId =
          (queryVersionLineId && nextVersionLines.some((item) => Number(item.id) === queryVersionLineId) ? queryVersionLineId : undefined) ||
          (current && nextVersionLines.some((item) => Number(item.id) === current) ? current : undefined) ||
          (project.latest_published_snapshot?.version_line_id &&
          nextVersionLines.some((item) => Number(item.id) === Number(project.latest_published_snapshot?.version_line_id))
            ? Number(project.latest_published_snapshot?.version_line_id)
            : undefined) ||
          (hasNumericId(nextVersionLines[0]?.id) ? Number(nextVersionLines[0]?.id) : undefined);
        if (preferredVersionLineId === queryVersionLineId) {
          initialQueryRef.current.versionLineId = undefined;
        }
        return preferredVersionLineId;
      });
      return { project, versionLineResult };
    },
    []
  );

  const loadSnapshots = useCallback(
    async (projectId: number, versionLineId?: number) => {
      const requestId = snapshotListRequestRef.current + 1;
      snapshotListRequestRef.current = requestId;
      const rawSnapshots = versionLineId
        ? await deepWikiApi.listSnapshotsByVersionLine(versionLineId)
        : await deepWikiApi.listProjectSnapshots(projectId);
      if (
        snapshotListRequestRef.current !== requestId ||
        selectedProjectIdRef.current !== projectId ||
        Number(selectedVersionLineIdRef.current || 0) !== Number(versionLineId || 0)
      ) {
        return [];
      }
      const nextSnapshots = rawSnapshots.filter((item) => hasNumericId(item.id));
      setSnapshots(nextSnapshots);
      setSnapshotsOwnerVersionLineId(versionLineId ? Number(versionLineId) : undefined);
      setSelectedSnapshotId(() => {
        const querySnapshotId = initialQueryRef.current.snapshotId;
        const publishedSnapshot = nextSnapshots.find((item) => item.publish_status === 'published' || item.status === 'published');
        const preferredSnapshotId =
          (hasNumericId(publishedSnapshot?.id) ? Number(publishedSnapshot?.id) : undefined) ||
          (querySnapshotId && nextSnapshots.some((item) => Number(item.id) === querySnapshotId) && publishedSnapshot ? querySnapshotId : undefined) ||
          (hasNumericId(nextSnapshots[0]?.id) ? Number(nextSnapshots[0]?.id) : undefined);
        if (preferredSnapshotId === querySnapshotId) {
          initialQueryRef.current.snapshotId = undefined;
        }
        return preferredSnapshotId;
      });
      return nextSnapshots;
    },
    []
  );

  const loadSnapshot = useCallback(async (snapshotId: number) => {
    const requestId = snapshotDetailRequestRef.current + 1;
    snapshotDetailRequestRef.current = requestId;
    const [overview, graph, pages, quality, diagrams, threads, stages, stageAssets, evidence, gateDecisions, topology, scores, scoreBreakdowns, scoreRegressions, nextProjectScores, nextProjectHealth] = await Promise.all([
      deepWikiApi.getSnapshotOverview(snapshotId),
      deepWikiApi.getSnapshotGraph(snapshotId).catch(() => null),
      deepWikiApi.listSnapshotPages(snapshotId),
      deepWikiApi.getSnapshotQuality(snapshotId),
      deepWikiApi.listSnapshotDiagrams(snapshotId),
      deepWikiApi.listSnapshotThreads(snapshotId).catch(() => []),
      deepWikiApi.getSnapshotStages(snapshotId).catch(() => ({ snapshot: { id: snapshotId, branch: '' } as DeepWikiSnapshot, stage_runs: [], contracts: [] })),
      deepWikiApi.getSnapshotStageAssets(snapshotId).catch(() => ({ snapshot: { id: snapshotId, branch: '' } as DeepWikiSnapshot, assets: [], asset_lineage: [], skill_executions: [] })),
      deepWikiApi.getSnapshotEvidence(snapshotId).catch(() => ({ evidence: null, confidence: null })),
      deepWikiApi.getSnapshotGateDecisions(snapshotId).catch(() => ({ gate_decisions: null, gate_decision_rows: [], quality_report: null })),
      selectedProjectIdRef.current ? deepWikiApi.getProjectTopology(selectedProjectIdRef.current, snapshotId).catch(() => ({ project: {} as DeepWikiProject, snapshot: null, topology: null })) : Promise.resolve({ project: {} as DeepWikiProject, snapshot: null, topology: null }),
      deepWikiApi.getSnapshotScores(snapshotId).catch(() => []),
      deepWikiApi.getSnapshotScoreBreakdowns(snapshotId).catch(() => ({})),
      deepWikiApi.getSnapshotScoreRegressions(snapshotId).catch(() => []),
      selectedProjectIdRef.current ? deepWikiApi.getProjectScores(selectedProjectIdRef.current, snapshotId).catch(() => []) : Promise.resolve([]),
      selectedProjectIdRef.current ? deepWikiApi.getProjectHealth(selectedProjectIdRef.current, snapshotId).catch(() => null) : Promise.resolve(null),
    ]);
    if (snapshotDetailRequestRef.current !== requestId || selectedSnapshotIdRef.current !== snapshotId) {
      return;
    }
    setSnapshotOverview(overview);
    setSnapshotGraph(graph);
    setSnapshotPages(pages);
    setPagesOwnerSnapshotId(snapshotId);
    setSnapshotQuality(quality);
    setDiagramAssets(diagrams);
    setSnapshotThreads(threads);
    setSnapshotStageRuns(stages.stage_runs || []);
    setSnapshotStageAssets(stageAssets.assets || []);
    setSnapshotSkillExecutions(stageAssets.skill_executions || []);
    setSnapshotEvidenceAsset(evidence.evidence || null);
    setSnapshotConfidenceAsset(evidence.confidence || null);
    setSnapshotGateDecisionAsset(gateDecisions.gate_decisions || null);
    setSnapshotGateDecisionRows(gateDecisions.gate_decision_rows || []);
    setProjectTopology(topology.topology || null);
    setProjectScores(nextProjectScores || []);
    setProjectHealth(nextProjectHealth || null);
    setSnapshotScores(scores || []);
    setSnapshotScoreBreakdowns(scoreBreakdowns || {});
    setSnapshotScoreRegressions(scoreRegressions || []);
    setPageContentOwner(null);
    setSelectedPageId((current) => {
      const invalidPageKeys = invalidSnapshotPageKeysRef.current;
      const availablePages = pages.filter((item) => !invalidPageKeys.has(`${snapshotId}:${Number(item.id)}`));
      const queryPageId = initialQueryRef.current.snapshotId === snapshotId ? initialQueryRef.current.pageId : undefined;
      const preferredPageId =
        (queryPageId && availablePages.some((item) => Number(item.id) === queryPageId) ? queryPageId : undefined) ||
        (hasNumericId(availablePages[0]?.id) ? Number(availablePages[0]?.id) : undefined);
      if (preferredPageId === queryPageId) {
        initialQueryRef.current.pageId = undefined;
      }
      return preferredPageId;
    });
  }, []);

  const refreshSnapshotAssetSummary = useCallback(async (snapshotId: number) => {
    const [overview, graph, pages, quality, diagrams, threads, stages, stageAssets, evidence, gateDecisions, topology, scores, scoreBreakdowns, scoreRegressions, nextProjectScores, nextProjectHealth] = await Promise.all([
      deepWikiApi.getSnapshotOverview(snapshotId),
      deepWikiApi.getSnapshotGraph(snapshotId).catch(() => null),
      deepWikiApi.listSnapshotPages(snapshotId).catch(() => []),
      deepWikiApi.getSnapshotQuality(snapshotId),
      deepWikiApi.listSnapshotDiagrams(snapshotId),
      deepWikiApi.listSnapshotThreads(snapshotId).catch(() => []),
      deepWikiApi.getSnapshotStages(snapshotId).catch(() => ({ snapshot: { id: snapshotId, branch: '' } as DeepWikiSnapshot, stage_runs: [], contracts: [] })),
      deepWikiApi.getSnapshotStageAssets(snapshotId).catch(() => ({ snapshot: { id: snapshotId, branch: '' } as DeepWikiSnapshot, assets: [], asset_lineage: [], skill_executions: [] })),
      deepWikiApi.getSnapshotEvidence(snapshotId).catch(() => ({ evidence: null, confidence: null })),
      deepWikiApi.getSnapshotGateDecisions(snapshotId).catch(() => ({ gate_decisions: null, gate_decision_rows: [], quality_report: null })),
      selectedProjectIdRef.current ? deepWikiApi.getProjectTopology(selectedProjectIdRef.current, snapshotId).catch(() => ({ project: {} as DeepWikiProject, snapshot: null, topology: null })) : Promise.resolve({ project: {} as DeepWikiProject, snapshot: null, topology: null }),
      deepWikiApi.getSnapshotScores(snapshotId).catch(() => []),
      deepWikiApi.getSnapshotScoreBreakdowns(snapshotId).catch(() => ({})),
      deepWikiApi.getSnapshotScoreRegressions(snapshotId).catch(() => []),
      selectedProjectIdRef.current ? deepWikiApi.getProjectScores(selectedProjectIdRef.current, snapshotId).catch(() => []) : Promise.resolve([]),
      selectedProjectIdRef.current ? deepWikiApi.getProjectHealth(selectedProjectIdRef.current, snapshotId).catch(() => null) : Promise.resolve(null),
    ]);
    if (selectedSnapshotIdRef.current !== snapshotId) {
      return;
    }
    setSnapshotOverview(overview);
    setSnapshotGraph(graph);
    setSnapshotPages(pages);
    setPagesOwnerSnapshotId(snapshotId);
    setSnapshotQuality(quality);
    setDiagramAssets(diagrams);
    setSnapshotThreads(threads);
    setSnapshotStageRuns(stages.stage_runs || []);
    setSnapshotStageAssets(stageAssets.assets || []);
    setSnapshotSkillExecutions(stageAssets.skill_executions || []);
    setSnapshotEvidenceAsset(evidence.evidence || null);
    setSnapshotConfidenceAsset(evidence.confidence || null);
    setSnapshotGateDecisionAsset(gateDecisions.gate_decisions || null);
    setSnapshotGateDecisionRows(gateDecisions.gate_decision_rows || []);
    setProjectTopology(topology.topology || null);
    setProjectScores(nextProjectScores || []);
    setProjectHealth(nextProjectHealth || null);
    setSnapshotScores(scores || []);
    setSnapshotScoreBreakdowns(scoreBreakdowns || {});
    setSnapshotScoreRegressions(scoreRegressions || []);
    setSelectedPageId((current) => {
      if (current && pages.some((item) => Number(item.id) === Number(current))) {
        return current;
      }
      return hasNumericId(pages[0]?.id) ? Number(pages[0]?.id) : undefined;
    });
  }, []);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      try {
        await Promise.all([loadProjects(), loadRepos().catch(() => []), loadSkillRegistry().catch(() => [])]);
      } catch (error: any) {
        message.error(formatApiError(error, 'DeepWiki 项目列表加载失败'));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [loadProjects, loadRepos, loadSkillRegistry]);

  useEffect(() => {
    if (!selectedProjectId) {
      setSelectedProject(null);
      setProjectOwnerId(undefined);
      setVersionLines([]);
      setDiagnosticVersionLines([]);
      setSnapshots([]);
      setSnapshotsOwnerVersionLineId(undefined);
      setSelectedVersionLineId(undefined);
      setSelectedSnapshotId(undefined);
      clearSnapshotScopedState({
        setSnapshotOverview,
        setSnapshotGraph,
        setSnapshotPages,
        setPagesOwnerSnapshotId,
        setSnapshotQuality,
        setDiagramAssets,
        setSnapshotThreads,
        setSelectedPageId,
        setPageContent,
        setPageContentOwner,
        setProjectTopology,
        setSnapshotStageRuns,
        setSnapshotStageAssets,
        setSnapshotSkillExecutions,
        setSnapshotGateDecisionRows,
        setSnapshotGateDecisionAsset,
        setSnapshotEvidenceAsset,
        setSnapshotConfidenceAsset,
        setSnapshotScores,
        setSnapshotScoreBreakdowns,
        setSnapshotScoreRegressions,
      });
      setProjectScores([]);
      setProjectHealth(null);
      return;
    }
    if (projectOwnerId === selectedProjectId) {
      return;
    }
    setSelectedProject(null);
    setProjectOwnerId(undefined);
    setVersionLines([]);
    setDiagnosticVersionLines([]);
    setSnapshots([]);
    setSnapshotsOwnerVersionLineId(undefined);
    setSelectedVersionLineId(undefined);
    setSelectedSnapshotId(undefined);
    clearSnapshotScopedState({
      setSnapshotOverview,
      setSnapshotGraph,
      setSnapshotPages,
      setPagesOwnerSnapshotId,
      setSnapshotQuality,
      setDiagramAssets,
      setSnapshotThreads,
      setSelectedPageId,
      setPageContent,
      setPageContentOwner,
      setProjectTopology,
      setSnapshotStageRuns,
      setSnapshotStageAssets,
      setSnapshotSkillExecutions,
      setSnapshotGateDecisionRows,
      setSnapshotGateDecisionAsset,
      setSnapshotEvidenceAsset,
      setSnapshotConfidenceAsset,
      setSnapshotScores,
      setSnapshotScoreBreakdowns,
      setSnapshotScoreRegressions,
    });
    const run = async () => {
      try {
        await loadProject(selectedProjectId);
      } catch (error: any) {
        message.error(formatApiError(error, '项目详情加载失败'));
      }
    };
    void run();
  }, [loadProject, projectOwnerId, selectedProjectId]);

  useEffect(() => {
    if (selectedVersionLineId && !versionLines.some((item) => Number(item.id) === Number(selectedVersionLineId))) {
      setSelectedVersionLineId(undefined);
      setSelectedSnapshotId(undefined);
      clearSnapshotScopedState({
        setSnapshotOverview,
        setSnapshotGraph,
        setSnapshotPages,
        setPagesOwnerSnapshotId,
        setSnapshotQuality,
        setDiagramAssets,
        setSnapshotThreads,
        setSelectedPageId,
        setPageContent,
        setPageContentOwner,
        setProjectTopology,
        setSnapshotStageRuns,
        setSnapshotStageAssets,
        setSnapshotSkillExecutions,
        setSnapshotGateDecisionRows,
        setSnapshotGateDecisionAsset,
        setSnapshotEvidenceAsset,
        setSnapshotConfidenceAsset,
        setSnapshotScores,
        setSnapshotScoreBreakdowns,
        setSnapshotScoreRegressions,
      });
    }
  }, [selectedVersionLineId, versionLines]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!selectedVersionLineId) {
      setSnapshots([]);
      setSnapshotsOwnerVersionLineId(undefined);
      setSelectedSnapshotId(undefined);
      clearSnapshotScopedState({
        setSnapshotOverview,
        setSnapshotGraph,
        setSnapshotPages,
        setPagesOwnerSnapshotId,
        setSnapshotQuality,
        setDiagramAssets,
        setSnapshotThreads,
        setSelectedPageId,
        setPageContent,
        setPageContentOwner,
        setProjectTopology,
        setSnapshotStageRuns,
        setSnapshotStageAssets,
        setSnapshotSkillExecutions,
        setSnapshotGateDecisionRows,
        setSnapshotGateDecisionAsset,
        setSnapshotEvidenceAsset,
        setSnapshotConfidenceAsset,
        setSnapshotScores,
        setSnapshotScoreBreakdowns,
        setSnapshotScoreRegressions,
      });
      return;
    }
    if (snapshotsOwnerVersionLineId === selectedVersionLineId) {
      return;
    }
    setSelectedSnapshotId(undefined);
    setSnapshotsOwnerVersionLineId(undefined);
    clearSnapshotScopedState({
      setSnapshotOverview,
      setSnapshotGraph,
      setSnapshotPages,
      setPagesOwnerSnapshotId,
      setSnapshotQuality,
      setDiagramAssets,
      setSnapshotThreads,
      setSelectedPageId,
      setPageContent,
      setPageContentOwner,
      setProjectTopology,
      setSnapshotStageRuns,
      setSnapshotStageAssets,
      setSnapshotSkillExecutions,
      setSnapshotGateDecisionRows,
      setSnapshotGateDecisionAsset,
      setSnapshotEvidenceAsset,
      setSnapshotConfidenceAsset,
      setSnapshotScores,
      setSnapshotScoreBreakdowns,
      setSnapshotScoreRegressions,
    });
    const run = async () => {
      try {
        await loadSnapshots(selectedProjectId, selectedVersionLineId);
      } catch (error: any) {
        message.error(formatApiError(error, 'Snapshot 列表加载失败'));
      }
    };
    void run();
  }, [loadSnapshots, selectedProjectId, selectedVersionLineId, snapshotsOwnerVersionLineId]);

  useEffect(() => {
    if (selectedSnapshotId && !snapshots.some((item) => Number(item.id) === Number(selectedSnapshotId))) {
      setSelectedSnapshotId(undefined);
      clearSnapshotScopedState({
        setSnapshotOverview,
        setSnapshotGraph,
        setSnapshotPages,
        setPagesOwnerSnapshotId,
        setSnapshotQuality,
        setDiagramAssets,
        setSnapshotThreads,
        setSelectedPageId,
        setPageContent,
        setPageContentOwner,
        setProjectTopology,
        setSnapshotStageRuns,
        setSnapshotStageAssets,
        setSnapshotSkillExecutions,
        setSnapshotGateDecisionRows,
        setSnapshotGateDecisionAsset,
        setSnapshotEvidenceAsset,
        setSnapshotConfidenceAsset,
        setSnapshotScores,
        setSnapshotScoreBreakdowns,
        setSnapshotScoreRegressions,
      });
    }
  }, [selectedSnapshotId, snapshots]);

  useEffect(() => {
    if (!selectedSnapshotId) {
      invalidSnapshotPageKeysRef.current = new Set();
      setSnapshotQueryResult(null);
      clearSnapshotScopedState({
        setSnapshotOverview,
        setSnapshotGraph,
        setSnapshotPages,
        setPagesOwnerSnapshotId,
        setSnapshotQuality,
        setDiagramAssets,
        setSnapshotThreads,
        setSelectedPageId,
        setPageContent,
        setPageContentOwner,
        setProjectTopology,
        setSnapshotStageRuns,
        setSnapshotStageAssets,
        setSnapshotSkillExecutions,
        setSnapshotGateDecisionRows,
        setSnapshotGateDecisionAsset,
        setSnapshotEvidenceAsset,
        setSnapshotConfidenceAsset,
        setSnapshotScores,
        setSnapshotScoreBreakdowns,
        setSnapshotScoreRegressions,
      });
      return;
    }
    if (pagesOwnerSnapshotId === selectedSnapshotId) {
      return;
    }
    invalidSnapshotPageKeysRef.current = new Set();
    setSnapshotQueryResult(null);
    setSelectedPageId(undefined);
    setPageContent('');
    setSnapshotPages([]);
    setPagesOwnerSnapshotId(undefined);
    setPageContentOwner(null);
    const run = async () => {
      try {
        await loadSnapshot(selectedSnapshotId);
      } catch (error: any) {
        message.error(formatApiError(error, 'Snapshot 明细加载失败'));
      }
    };
    void run();
  }, [loadSnapshot, pagesOwnerSnapshotId, selectedSnapshotId]);

  useEffect(() => {
    if (
      selectedPageId &&
      (!pagesOwnerSnapshotId ||
        pagesOwnerSnapshotId !== selectedSnapshotId ||
        !snapshotPages.some((item) => Number(item.id) === Number(selectedPageId)))
    ) {
      setSelectedPageId(undefined);
      setPageContent('');
      setPageContentOwner(null);
    }
  }, [pagesOwnerSnapshotId, selectedPageId, selectedSnapshotId, snapshotPages]);

  useEffect(() => {
    if (!selectedSnapshotId || !selectedPageId) {
      setPageContent('');
      setPageContentOwner(null);
      return;
    }
    if (pagesOwnerSnapshotId !== selectedSnapshotId) {
      setPageContent('');
      setPageContentOwner(null);
      return;
    }
    if (!snapshotPages.some((item) => Number(item.id) === Number(selectedPageId))) {
      setPageContent('');
      setPageContentOwner(null);
      return;
    }
    const run = async () => {
      const requestId = pageContentRequestRef.current + 1;
      pageContentRequestRef.current = requestId;
      setPageLoading(true);
      setPageContentOwner({ snapshotId: selectedSnapshotId, pageId: selectedPageId });
      try {
        const data = await deepWikiApi.getSnapshotPageContent(selectedSnapshotId, selectedPageId);
        if (
          pageContentRequestRef.current !== requestId ||
          pagesOwnerSnapshotIdRef.current !== selectedSnapshotId ||
          selectedSnapshotIdRef.current !== selectedSnapshotId ||
          selectedPageIdRef.current !== selectedPageId
        ) {
          return;
        }
        setPageContent(data.content || '');
      } catch (error: any) {
        if (Number(error?.response?.status) === 404) {
          invalidSnapshotPageKeysRef.current.add(`${selectedSnapshotId}:${Number(selectedPageId)}`);
          setPageContent('');
          setPageContentOwner(null);
          const fallbackPageId = snapshotPages.find(
            (item) => !invalidSnapshotPageKeysRef.current.has(`${selectedSnapshotId}:${Number(item.id)}`)
          )?.id;
          if (fallbackPageId && Number(fallbackPageId) !== Number(selectedPageId)) {
            setSelectedPageId(Number(fallbackPageId));
          } else {
            setSelectedPageId(undefined);
          }
          return;
        }
        message.error(formatApiError(error, '页面内容加载失败'));
      } finally {
        setPageLoading(false);
      }
    };
    void run();
  }, [pagesOwnerSnapshotId, selectedPageId, selectedSnapshotId, snapshotPages]);

  useEffect(() => {
    if (initialQueryHydratingRef.current) {
      return;
    }
    const next = new URLSearchParams();
    if (activeProjectId) {
      next.set('project', String(activeProjectId));
      if (activeVersionLineId) {
        next.set('versionLine', String(activeVersionLineId));
        if (activeSnapshotId) {
          next.set('snapshot', String(activeSnapshotId));
          if (
            pagesOwnerSnapshotId === activeSnapshotId &&
            selectedPageId &&
            snapshotPages.some((item) => Number(item.id) === Number(selectedPageId))
          ) {
            next.set('page', String(selectedPageId));
          }
        }
      }
    }
    const targetSearch = next.toString();
    const currentSearch = location.search.replace(/^\?/, '');
    if (!targetSearch && !currentSearch) {
      return;
    }
    if (targetSearch === currentSearch || targetSearch === lastSyncedSearchRef.current) {
      return;
    }
    lastSyncedSearchRef.current = targetSearch;
    setSearchParams(next, { replace: true });
  }, [
    activeProjectId,
    activeSnapshotId,
    activeVersionLineId,
    location.search,
    pagesOwnerSnapshotId,
    selectedPageId,
    setSearchParams,
    snapshotPages,
  ]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadProjects(), loadRepos().catch(() => []), loadSkillRegistry().catch(() => [])]);
    if (selectedProjectId) {
      await loadProject(selectedProjectId);
      if (selectedVersionLineId) {
        await loadSnapshots(selectedProjectId, selectedVersionLineId);
      } else {
        setSnapshots([]);
        setSnapshotsOwnerVersionLineId(undefined);
        setSelectedSnapshotId(undefined);
      }
    }
    if (selectedSnapshotId && selectedVersionLineId) {
      await loadSnapshot(selectedSnapshotId);
    }
  }, [loadProject, loadProjects, loadRepos, loadSkillRegistry, loadSnapshot, loadSnapshots, selectedProjectId, selectedSnapshotId, selectedVersionLineId]);

  const handleOpenSkillEditor = useCallback((skill: DeepWikiSkillContract) => {
    skillForm.setFieldsValue({
      purpose: skill.purpose || '',
      layer: skill.layer || '',
      algorithm: skill.algorithm || '',
      version: skill.version || '',
      inputsText: stringifySkillList(skill.inputs || skill.acceptedInputs || []),
      outputsText: stringifySkillList(skill.outputs || skill.producedOutputs || []),
      dependenciesText: stringifySkillList(skill.dependencies || []),
      failureModesText: stringifySkillList(skill.failureModes || []),
      qualityChecksText: stringifySkillList(skill.qualityChecks || []),
      parametersText: JSON.stringify(skill.parameters || {}, null, 2),
    });
    setSelectedSkillKey(String(skill.skillKey || skill.skill_key || ''));
    setSkillEditorOpen(true);
  }, [skillForm]);

  const handleSaveSkillOverride = useCallback(async () => {
    if (!selectedSkillContract) return;
    try {
      const values = await skillForm.validateFields();
      let parameters = {};
      if (String(values.parametersText || '').trim()) {
        parameters = JSON.parse(String(values.parametersText || '{}'));
      }
      setActionLoading(true);
      await deepWikiApi.updateSkill(String(selectedSkillContract.skillKey || selectedSkillContract.skill_key || ''), {
        purpose: String(values.purpose || '').trim(),
        layer: String(values.layer || '').trim(),
        algorithm: String(values.algorithm || '').trim(),
        version: String(values.version || '').trim(),
        inputs: parseSkillList(values.inputsText),
        outputs: parseSkillList(values.outputsText),
        dependencies: parseSkillList(values.dependenciesText),
        failureModes: parseSkillList(values.failureModesText),
        qualityChecks: parseSkillList(values.qualityChecksText),
        parameters,
      });
      await loadSkillRegistry();
      setSkillEditorOpen(false);
      message.success('Skill 覆盖已保存，新 run / 重投影将使用新合同');
    } catch (error: any) {
      if (error?.errorFields) return;
      if (error instanceof SyntaxError) {
        message.error('参数 JSON 格式无效，请检查 parameters 字段');
        return;
      }
      message.error(formatApiError(error, '保存 Skill 覆盖失败'));
    } finally {
      setActionLoading(false);
    }
  }, [loadSkillRegistry, selectedSkillContract, skillForm]);

  const handleResetSkillOverride = useCallback(async (skillKey: string) => {
    setActionLoading(true);
    try {
      await deepWikiApi.resetSkill(skillKey);
      await loadSkillRegistry();
      message.success('Skill 覆盖已重置为默认值');
    } catch (error: any) {
      message.error(formatApiError(error, '重置 Skill 覆盖失败'));
    } finally {
      setActionLoading(false);
    }
  }, [loadSkillRegistry]);

  const handleBootstrap = async () => {
    setActionLoading(true);
    try {
      const summary = await deepWikiApi.bootstrapProjects({});
      setBootstrapSummary(summary);
      const report = summary?.migration_report;
      if (report) {
        message.success(
          `回填完成：项目 ${report.project_count || 0}，版本线 ${report.version_line_count || 0}，Snapshot ${report.snapshot_count || 0}`
        );
      } else {
        message.success('历史 DeepWiki runs 已回填到项目驾驶舱');
      }
      await refreshAll();
    } catch (error: any) {
      message.error(formatApiError(error, '历史项目回填失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenProjectModal = () => {
    projectForm.setFieldsValue({
      default_branch: 'main',
      repo_bindings: [{ repo_role: 'service', branch: 'main', is_primary: true }],
    });
    setProjectModalOpen(true);
  };

  const handleCreateProject = async () => {
    try {
      const values = await projectForm.validateFields();
      const payload: ProjectFormValues = {
        ...values,
        repo_bindings: (values.repo_bindings || [])
          .filter((item) => hasNumericId(item.repo_source_id))
          .map((item, index) => ({
            repo_source_id: Number(item.repo_source_id),
            repo_role: item.repo_role || 'service',
            branch: item.branch || values.default_branch || 'main',
            is_primary: Boolean(item.is_primary || index === 0),
          })),
      };
      setActionLoading(true);
      const project = await deepWikiApi.createProject(payload);
      message.success('项目已创建');
      setProjectModalOpen(false);
      projectForm.resetFields();
      await refreshAll();
      if (hasNumericId(project.id)) {
        setSelectedProjectId(Number(project.id));
      }
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(formatApiError(error, '创建项目失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenRepoModal = () => {
    repoForm.setFieldsValue({
      repo_role: 'service',
      branch: selectedProject?.default_branch || 'main',
      is_primary: !selectedProject?.repos?.length,
    });
    setRepoModalOpen(true);
  };

  const handleAddRepo = async () => {
    if (!selectedProjectId) return;
    try {
      const values = await repoForm.validateFields();
      if (!values.repo_source_id && !values.repo_url) {
        message.warning('请选择现有仓库，或填写新的仓库地址');
        return;
      }
      setActionLoading(true);
      await deepWikiApi.addRepoToProject(selectedProjectId, values);
      message.success('仓库已绑定到项目');
      setRepoModalOpen(false);
      repoForm.resetFields();
      await refreshAll();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(formatApiError(error, '绑定仓库失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenVersionModal = () => {
    versionForm.setFieldsValue({
      branch_name: selectedProject?.default_branch || 'main',
      display_name: '',
      repo_mappings: buildVersionMappingDefaults(selectedProject),
    });
    setVersionModalOpen(true);
  };

  const handleCreateVersionLine = async () => {
    if (!selectedProjectId) return;
    try {
      const values = await versionForm.validateFields();
      setActionLoading(true);
      await deepWikiApi.createVersionLine(selectedProjectId, {
        branch_name: values.branch_name,
        display_name: values.display_name,
        repo_mappings: normalizeVersionMappings(values.repo_mappings),
      });
      message.success('版本线已创建');
      setVersionModalOpen(false);
      versionForm.resetFields();
      await refreshAll();
    } catch (error: any) {
      if (error?.errorFields) return;
      message.error(formatApiError(error, '创建版本线失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleInitializeDefaultVersionLine = async () => {
    if (!selectedProjectId || !selectedProject?.repos?.length) {
      message.warning('当前项目还没有仓库绑定，暂时不能初始化版本线');
      return;
    }
    const branchName = String(selectedProject.default_branch || '').trim() || 'main';
    setActionLoading(true);
    try {
      const created = await deepWikiApi.createVersionLine(selectedProjectId, {
        branch_name: branchName,
        display_name: branchName,
        repo_mappings: normalizeVersionMappings(buildVersionMappingDefaults(selectedProject)),
      });
      message.success(`默认版本线 ${created?.display_name || created?.branch || branchName} 已初始化`);
      await refreshAll();
      if (hasNumericId(created?.id)) {
        setSelectedVersionLineId(Number(created.id));
      }
    } catch (error: any) {
      message.error(formatApiError(error, '初始化默认版本线失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleGenerateSnapshot = async () => {
    if (!selectedVersionLineId) {
      message.warning('请先选择版本线');
      return;
    }
    setActionLoading(true);
    try {
      const result = await deepWikiApi.generateSnapshotByVersionLine(selectedVersionLineId, {});
      message.success(`已触发项目级快照生成，run #${result.run_id}`);
      navigate(`/runtime?trace=${encodeURIComponent(result.trace_id)}`);
    } catch (error: any) {
      message.error(formatApiError(error, '触发快照生成失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSnapshotQuery = async () => {
    if (!selectedSnapshotId) {
      message.warning('请先选择 Snapshot');
      return;
    }
    const query = String(snapshotQueryText || '').trim();
    if (!query) {
      message.warning('请输入检索问题');
      return;
    }
    setSnapshotQueryLoading(true);
    try {
      const result = await deepWikiApi.querySnapshot(selectedSnapshotId, {
        query,
        mode: snapshotQueryMode,
        top_k: 5,
        candidate_k: 12,
        rerank_top_k: 8,
      });
      setSnapshotQueryResult(result);
    } catch (error: any) {
      message.error(formatApiError(error, '智能检索失败'));
    } finally {
      setSnapshotQueryLoading(false);
    }
  };

  const handlePublish = async () => {
    if (!selectedSnapshotId) return;
    setActionLoading(true);
    try {
      const result = await deepWikiApi.publishSnapshot(selectedSnapshotId);
      setSnapshotOverview(result);
      const nextSnapshots = selectedVersionLineId
        ? await deepWikiApi.listSnapshotsByVersionLine(selectedVersionLineId)
        : await deepWikiApi.listProjectSnapshots(selectedProjectId || 0);
      setSnapshots(nextSnapshots.filter((item) => hasNumericId(item.id)));
      setSnapshotQuality(await deepWikiApi.getSnapshotQuality(selectedSnapshotId));
      message.success('Snapshot 已发布，可作为正式方案派生基线');
      await loadProjects();
    } catch (error: any) {
      message.error(formatApiError(error, '发布失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSyncToDevin = async () => {
    if (!selectedSnapshotId) return;
    setActionLoading(true);
    try {
      const isPublishedSnapshot = (snapshot?.status || snapshot?.publish_status) === 'published';
      const job = await deepWikiApi.syncSnapshotToDevin(selectedSnapshotId, {
        dry_run: !isPublishedSnapshot,
      });
      setSnapshotOverview(await deepWikiApi.getSnapshotOverview(selectedSnapshotId));
      await loadProjects();
      const sessionUrl = String(job?.result_json?.devin_session_url || '');
      const syncMode = String(job?.request_json?.sync_mode || job?.result_json?.sync_mode || '');
      const syncLabel = syncMode === 'draft_preview' ? 'Devin dry run' : 'Devin';
      if (sessionUrl) {
        message.success(`已提交到 ${syncLabel}：${sessionUrl}`);
      } else {
        message.success(`已提交 ${syncLabel} 任务`);
      }
    } catch (error: any) {
      message.error(formatApiError(error, '提交 Devin 同步失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegenerateDiagrams = async (
    diagramTypes: string[],
    options?: { actionKey?: string; scopeLabel?: string; scopeType?: string; scopeKey?: string }
  ) => {
    if (!selectedSnapshotId) return;
    const normalizedTypes = Array.from(new Set(diagramTypes.map((item) => String(item || '').trim()).filter(Boolean)));
    if (!normalizedTypes.length) return;
    const actionKey = options?.actionKey || normalizedTypes.join(',');
    const scopeLabel =
      options?.scopeLabel ||
      (normalizedTypes.length === 1 ? DIAGRAM_LABELS[normalizedTypes[0]] || normalizedTypes[0] : '所选图谱');
    setDiagramRegeneratingKey(actionKey);
    try {
      await deepWikiApi.regenerateSnapshotDiagrams(selectedSnapshotId, {
        diagram_types: normalizedTypes,
        scope_type: options?.scopeType,
        scope_key: options?.scopeKey,
      });
      await refreshSnapshotAssetSummary(selectedSnapshotId);
      message.success(`${scopeLabel} 已重跑并刷新图谱资产`);
    } catch (error: any) {
      message.error(formatApiError(error, `${scopeLabel} 重跑失败`));
    } finally {
      setDiagramRegeneratingKey(null);
    }
  };

  const handleCreateTechSpec = async () => {
    if (!selectedSnapshotId) return;
    setActionLoading(true);
    try {
      const result = await deepWikiApi.createTechSpecBundleFromSnapshot(selectedSnapshotId);
      message.success('技术方案任务已创建');
      navigate(`/doc-gate?bundle=${result.bundle.id}`);
    } catch (error: any) {
      message.error(formatApiError(error, '创建技术方案任务失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateTestPlan = async () => {
    if (!selectedSnapshotId) return;
    setActionLoading(true);
    try {
      const result = await deepWikiApi.createTestPlanBundleFromSnapshot(selectedSnapshotId);
      message.success('测试方案任务已创建');
      navigate(`/doc-gate?bundle=${result.bundle.id}`);
    } catch (error: any) {
      message.error(formatApiError(error, '创建测试方案任务失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const projectSummary = snapshotOverview?.project || selectedProject;
  const snapshot =
    snapshotOverview?.snapshot || snapshots.find((item) => Number(item.id) === Number(activeSnapshotId)) || null;
  const devinSyncJob = useMemo(
    () => snapshotOverview?.generation_jobs?.find((item) => item.job_type === 'devin_deepwiki_sync') || null,
    [snapshotOverview]
  );
  const devinSyncLatestMessage = useMemo(() => devinLatestMessageText(devinSyncJob), [devinSyncJob]);

  useEffect(() => {
    if (!selectedSnapshotId || !isActiveDevinSyncJob(devinSyncJob)) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void deepWikiApi.getSnapshotOverview(selectedSnapshotId)
        .then((overview) => {
          if (selectedSnapshotIdRef.current === selectedSnapshotId) {
            setSnapshotOverview(overview);
          }
        })
        .catch(() => undefined);
    }, 12000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [devinSyncJob, selectedSnapshotId]);

  return (
    <Spin spinning={loading}>
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card
          title="DeepWiki 项目驾驶舱"
          extra={
            <Space wrap>
              <Button icon={<ReloadOutlined />} loading={actionLoading} onClick={() => void refreshAll()}>
                刷新
              </Button>
              <Button icon={<PlusOutlined />} onClick={handleOpenProjectModal}>
                新建项目
              </Button>
              <Button icon={<PlusOutlined />} onClick={handleOpenRepoModal} disabled={!activeProjectId}>
                添加仓库
              </Button>
              <Button icon={<BranchesOutlined />} onClick={handleOpenVersionModal} disabled={!activeProjectId || !selectedProject?.repos?.length}>
                新建版本线
              </Button>
              <Button icon={<ReloadOutlined />} loading={actionLoading} onClick={() => void handleBootstrap()}>
                回填历史项目
              </Button>
            </Space>
          }
        >
          <Space direction="vertical" size={14} style={{ width: '100%' }}>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              {'主链路固定为 项目 -> 版本线 -> 已发布 Snapshot -> 图谱 / 页面 / 图表 / 质量门禁 -> 技术方案 -> 测试方案。'}
            </Paragraph>
            <Space wrap size={[12, 12]} style={{ width: '100%' }}>
              <Select
                key={`project:${activeProjectId ?? 'none'}`}
                style={{ width: 280 }}
                placeholder="选择项目"
                value={activeProjectId}
                options={projectOptions}
                onChange={(value) => {
                  setSelectedProjectId(value);
                  setSelectedVersionLineId(undefined);
                  setSelectedSnapshotId(undefined);
                  setSelectedPageId(undefined);
                  setPageContent('');
                  setSnapshotPages([]);
                }}
              />
              <Select
                key={`version-line:${activeProjectId ?? 'none'}`}
                style={{ width: 320 }}
                placeholder="选择版本线"
                value={activeProjectId ? activeVersionLineId : undefined}
                options={activeProjectId ? versionLineOptions : []}
                onChange={(value) => {
                  setSelectedVersionLineId(value);
                  setSelectedSnapshotId(undefined);
                  setSelectedPageId(undefined);
                  setPageContent('');
                  setSnapshotPages([]);
                }}
                disabled={!activeProjectId}
              />
              <Select
                key={`snapshot:${activeProjectId ?? 'none'}:${activeVersionLineId ?? 'none'}`}
                style={{ width: 360 }}
                placeholder="选择 Snapshot"
                value={activeVersionLineId ? activeSnapshotId : undefined}
                options={activeVersionLineId ? snapshotOptions : []}
                onChange={(value) => {
                  setSelectedSnapshotId(value);
                  setSelectedPageId(undefined);
                  setPageContent('');
                  setSnapshotPages([]);
                }}
                disabled={!activeProjectId || !activeVersionLineId}
              />
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={actionLoading}
                onClick={() => void handleGenerateSnapshot()}
                disabled={!activeVersionLineId}
              >
                生成项目快照
              </Button>
              <Button
                icon={<SafetyCertificateOutlined />}
                loading={actionLoading}
                onClick={() => void handlePublish()}
                disabled={!activeSnapshotId}
              >
                发布 Snapshot
              </Button>
              <Button
                icon={<RocketOutlined />}
                loading={actionLoading}
                onClick={() => void handleSyncToDevin()}
                disabled={!activeSnapshotId}
              >
                {(snapshot?.status || snapshot?.publish_status) === 'published' ? '同步 Devin Wiki' : '运行 Devin Dry Run'}
              </Button>
            </Space>
            {snapshotQuality?.publish_blockers?.length ? (
              <Alert
                type="warning"
                showIcon
                message="当前 Snapshot 仍有发布阻塞项"
                description={snapshotQuality.publish_blockers.map(blockerLabel).join('、')}
              />
            ) : snapshotQuality?.publish_warnings?.length ? (
              <Alert
                type="info"
                showIcon
                message="当前 Snapshot 已可发布，以下知识资产将继续自动补全"
                description={snapshotQuality.publish_warnings.map(blockerLabel).join('、')}
              />
            ) : snapshot ? (
              <Alert type="success" showIcon message="当前 Snapshot 已满足发布要求或暂无阻塞项" />
            ) : (
              <Alert type="info" showIcon message="请先为项目配置版本线并生成 Snapshot" />
            )}
            {activeProjectId && !versionLines.length && selectedProject?.repos?.length ? (
              <Alert
                type="warning"
                showIcon
                message="当前项目还没有正式版本线"
                description={`系统已识别到诊断分支，但还未落库为正式版本线。可直接按项目默认分支 ${selectedProject.default_branch || 'main'} 初始化。`}
                action={
                  <Button type="primary" size="small" loading={actionLoading} onClick={() => void handleInitializeDefaultVersionLine()}>
                    初始化默认版本线
                  </Button>
                }
              />
            ) : null}
            {bootstrapSummary?.migration_report ? (
              <Alert
                type="info"
                showIcon
                message="最近一次历史回填核对"
                description={`项目 ${bootstrapSummary.migration_report.project_count || 0}，版本线 ${bootstrapSummary.migration_report.version_line_count || 0}，Snapshot ${bootstrapSummary.migration_report.snapshot_count || 0}，缺 repo revision ${bootstrapSummary.migration_report.missing_repo_revision_snapshots || 0}，缺文档 revision ${bootstrapSummary.migration_report.missing_document_revision_snapshots || 0}，缺图表 ${bootstrapSummary.migration_report.missing_diagram_snapshots || 0}`}
              />
            ) : null}
          </Space>
        </Card>

        {!projects.length ? (
          <Empty description="还没有项目级 DeepWiki。先回填历史 runs，或先创建项目并绑定多仓库后再进入驾驶舱。" />
        ) : (
          <>
            {selectedProject ? (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Row gutter={[16, 16]}>
                  <Col span={8}>
                    <Card title="当前项目" size="small">
                      <Descriptions column={1} size="small">
                        <Descriptions.Item label="项目">{selectedProject.project_name}</Descriptions.Item>
                        <Descriptions.Item label="项目编码">{selectedProject.project_code}</Descriptions.Item>
                        <Descriptions.Item label="默认主分支">{selectedProject.default_branch || 'main'}</Descriptions.Item>
                        <Descriptions.Item label="仓库数">{selectedProject.repos?.length || selectedProject.repo_count || 0}</Descriptions.Item>
                        <Descriptions.Item label="版本线数">{selectedProject.version_lines?.length || selectedProject.version_line_count || 0}</Descriptions.Item>
                        <Descriptions.Item label="最近已发布 Snapshot">
                          {selectedProject.latest_published_snapshot?.snapshot_version ||
                            selectedProject.latest_published_snapshot_summary?.snapshot_version ||
                            selectedProject.latest_published_snapshot?.commit_sha ||
                            selectedProject.latest_published_snapshot_summary?.commit_sha ||
                            '-'}
                        </Descriptions.Item>
                      </Descriptions>
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card title="仓库绑定" size="small">
                      <List
                        size="small"
                        dataSource={selectedProject.repos || []}
                        locale={{ emptyText: '当前项目还没有绑定仓库' }}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={2} style={{ width: '100%' }}>
                              <Space wrap>
                                <Tag color={item.is_primary ? 'gold' : 'blue'}>{item.is_primary ? '主仓' : item.repo_role || 'repo'}</Tag>
                                <Text strong>{item.repo_source?.repo_slug || item.repo_slug || '-'}</Text>
                              </Space>
                              <Text type="secondary">
                                {repoBindingDefaultBranch(item, selectedProject.default_branch || 'main')} · {item.repo_source?.repo_url || item.repo_url || '-'}
                              </Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                  <Col span={8}>
                    <Card title="项目输入源" size="small">
                      <List
                        size="small"
                        dataSource={selectedProject.source_bindings || []}
                        locale={{ emptyText: '当前项目还没有同步出文档输入源' }}
                        renderItem={(item) => (
                          <List.Item>
                            <Space direction="vertical" size={2} style={{ width: '100%' }}>
                              <Space wrap>
                                <Tag color="purple">{item.source_type}</Tag>
                                <Text strong>{item.title || item.source_key}</Text>
                              </Space>
                              <Text type="secondary">{item.source_key}</Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    </Card>
                  </Col>
                </Row>
                {diagnosticVersionLines.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="以下分支还没有落成正式版本线，暂时不会进入选择器"
                    description={
                      <Space wrap>
                        {diagnosticVersionLines.map((item) => (
                          <Tag key={`${item.branch}:${item.display_name || 'diagnostic'}`} color="orange">
                            {item.display_name || item.branch}
                          </Tag>
                        ))}
                      </Space>
                    }
                  />
                ) : null}
              </Space>
            ) : null}

            {!activeProjectId || !snapshot ? (
              <Alert type="info" showIcon message="请选择项目、版本线和 Snapshot；如果还没有 Snapshot，请先生成项目快照。" />
            ) : (
              <Tabs
                items={[
                  {
                    key: 'overview',
                    label: '总览',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[16, 16]}>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic title="仓库修订" value={snapshotOverview?.repo_revisions.length || 0} prefix={<BranchesOutlined />} />
                            </Card>
                          </Col>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic title="文档修订" value={snapshotOverview?.document_revisions.length || 0} prefix={<FileTextOutlined />} />
                            </Card>
                          </Col>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic title="图表资产" value={snapshotOverview?.diagram_assets.length || 0} prefix={<FileSearchOutlined />} />
                            </Card>
                          </Col>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic title="相关方案任务" value={snapshotOverview?.related_doc_bundles.length || 0} prefix={<RocketOutlined />} />
                            </Card>
                          </Col>
                        </Row>
                        <Row gutter={[16, 16]}>
                          <Col span={12}>
                            <Card title="项目信息" size="small">
                              <Descriptions column={1} size="small">
                                <Descriptions.Item label="项目">{projectSummary?.project_name}</Descriptions.Item>
                                <Descriptions.Item label="项目编码">{projectSummary?.project_code}</Descriptions.Item>
                                <Descriptions.Item label="版本线">{snapshot.version_line_display_name || snapshot.version_line_name || snapshot.branch}</Descriptions.Item>
                                <Descriptions.Item label="Snapshot">{snapshot.snapshot_version || snapshot.commit_sha || '-'}</Descriptions.Item>
                                <Descriptions.Item label="发布状态">{statusTag(snapshot.publish_status || snapshot.status || undefined)}</Descriptions.Item>
                                <Descriptions.Item label="质量状态">{statusTag(snapshot.quality_status || undefined)}</Descriptions.Item>
                                <Descriptions.Item label="Devin 同步">
                                  {devinSyncJob ? (
                                    <Space wrap>
                                      <Tag color="magenta">
                                        {devinSyncJob.status || 'queued'}
                                      </Tag>
                                      <Tag color="purple">
                                        {String(devinSyncJob.result_json?.sync_mode || devinSyncJob.request_json?.sync_mode || 'published_sync')}
                                      </Tag>
                                      {String(devinSyncJob.result_json?.devin_status || '') ? (
                                        <Tag color="blue">
                                          {String(devinSyncJob.result_json?.devin_status)}
                                          {String(devinSyncJob.result_json?.devin_status_enum || '')
                                            ? ` / ${String(devinSyncJob.result_json?.devin_status_enum)}`
                                            : ''}
                                        </Tag>
                                      ) : null}
                                      {String(devinSyncJob.result_json?.devin_session_url || '') ? (
                                        <a
                                          href={String(devinSyncJob.result_json?.devin_session_url || '')}
                                          target="_blank"
                                          rel="noreferrer"
                                        >
                                          打开 Session
                                        </a>
                                      ) : null}
                                      {devinSyncLatestMessage ? (
                                        <Text type="secondary">
                                          {devinSyncLatestMessage.slice(0, 60)}
                                        </Text>
                                      ) : null}
                                    </Space>
                                  ) : (
                                    <Tag>未提交</Tag>
                                  )}
                                </Descriptions.Item>
                              </Descriptions>
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card title="输入覆盖" size="small">
                              <Descriptions column={1} size="small">
                                <Descriptions.Item label="仓库数">{snapshotOverview?.source_coverage?.repo_count || 0}</Descriptions.Item>
                                <Descriptions.Item label="文档数">{snapshotOverview?.source_coverage?.document_count || 0}</Descriptions.Item>
                                <Descriptions.Item label="图表数">{snapshotOverview?.source_coverage?.diagram_count || 0}</Descriptions.Item>
                                <Descriptions.Item label="发布阻塞">
                                  {snapshotOverview?.publish_blockers?.length ? (
                                    <Space wrap>
                                      {snapshotOverview.publish_blockers.map((item) => (
                                        <Tag color="orange" key={item}>
                                          {blockerLabel(item)}
                                        </Tag>
                                      ))}
                                    </Space>
                                  ) : (
                                    <Tag color="green">无</Tag>
                                  )}
                                </Descriptions.Item>
                                <Descriptions.Item label="待补全建议">
                                  {snapshotOverview?.publish_warnings?.length ? (
                                    <Space wrap>
                                      {snapshotOverview.publish_warnings.map((item) => (
                                        <Tag color="blue" key={item}>
                                          {blockerLabel(item)}
                                        </Tag>
                                      ))}
                                    </Space>
                                  ) : (
                                    <Tag color="green">无</Tag>
                                  )}
                                </Descriptions.Item>
                              </Descriptions>
                            </Card>
                          </Col>
                        </Row>
                        <Row gutter={[16, 16]}>
                          <Col span={12}>
                            <Card title="代码修订集合" size="small">
                              <List
                                size="small"
                                dataSource={snapshotOverview?.repo_revisions || []}
                                locale={{ emptyText: '暂无 repo revision' }}
                                renderItem={(item) => (
                                  <List.Item>
                                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                      <Space wrap>
                                        <Tag color="blue">{item.repo_role || 'repo'}</Tag>
                                        <Text strong>{item.repo_slug || '-'}</Text>
                                      </Space>
                                      <Text type="secondary">
                                        {item.branch_name || item.branch || '-'} @ {item.commit_sha || '-'}
                                      </Text>
                                    </Space>
                                  </List.Item>
                                )}
                              />
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card title="文档修订集合" size="small">
                              <List
                                size="small"
                                dataSource={snapshotOverview?.document_revisions || []}
                                locale={{ emptyText: '暂无文档修订' }}
                                renderItem={(item) => (
                                  <List.Item>
                                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                      <Space wrap>
                                        <Tag color="purple">{item.document_type || 'doc'}</Tag>
                                        {(item.origin || item.metadata_json?.origin) ? (
                                          <Tag color={(item.origin || item.metadata_json?.origin) === 'generated_from_code' ? 'gold' : 'blue'}>
                                            {String(item.origin || item.metadata_json?.origin)}
                                          </Tag>
                                        ) : null}
                                        {Number.isFinite(Number(item.confidence ?? item.metadata_json?.confidence)) ? (
                                          <Tag color="geekblue">
                                            confidence {Number(item.confidence ?? item.metadata_json?.confidence).toFixed(2)}
                                          </Tag>
                                        ) : null}
                                        {Number.isFinite(Number(item.source_snapshot_id ?? item.metadata_json?.source_snapshot_id)) ? (
                                          <Tag>snapshot {Number(item.source_snapshot_id ?? item.metadata_json?.source_snapshot_id)}</Tag>
                                        ) : null}
                                        <Text strong>{item.title || item.source_uri || '-'}</Text>
                                      </Space>
                                      <Text type="secondary">{item.version_label || item.source_uri || '-'}</Text>
                                    </Space>
                                  </List.Item>
                                )}
                              />
                            </Card>
                          </Col>
                        </Row>
                      </Space>
                    ),
                  },
                  {
                    key: 'graph',
                    label: 'Wiki 图谱',
                    children: <WikiGraphView graph={snapshotGraph} loading={loading} onOpenPage={(page) => setSelectedPageId(page.id)} />,
                  },
                  {
                    key: 'pages',
                    label: '页面浏览',
                    children: (
                      <Row gutter={[16, 16]}>
                        <Col span={8}>
                          <Card
                            size="small"
                            title="页面树"
                            extra={<Search allowClear placeholder="搜索页面 / slug" value={pageQuery} onChange={(event) => setPageQuery(event.target.value)} />}
                          >
                            <Tree
                              key={`snapshot-tree:${activeSnapshotId || 'none'}`}
                              treeData={filteredTreeData}
                              selectedKeys={
                                pagesOwnerSnapshotId === activeSnapshotId &&
                                selectedPageId &&
                                snapshotPages.some((item) => Number(item.id) === Number(selectedPageId))
                                  ? [`page:${selectedPageId}`]
                                  : []
                              }
                              onSelect={(_keys, info) => {
                                const node = info.node as any;
                                if (node.page?.id) {
                                  setSelectedPageId(Number(node.page.id));
                                }
                              }}
                              defaultExpandAll
                            />
                          </Card>
                        </Col>
                        <Col span={16}>
                          <Card size="small" title={selectedPage?.title || '页面内容'}>
                            {!selectedPage ? (
                              <Empty description="请选择页面" />
                            ) : (
                              <Spin spinning={pageLoading}>
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                  <Descriptions size="small" column={2}>
                                    <Descriptions.Item label="Slug">{selectedPage.page_slug}</Descriptions.Item>
                                    <Descriptions.Item label="类型">{selectedPage.page_type}</Descriptions.Item>
                                    <Descriptions.Item label="入库状态">{statusTag(selectedPage.ingest_status)}</Descriptions.Item>
                                    <Descriptions.Item label="来源">{selectedPage.source_uri || '-'}</Descriptions.Item>
                                  </Descriptions>
                                  {selectedPageDiagram?.content ? (
                                    <MermaidBlock
                                      code={selectedPageDiagram.content}
                                      title={selectedPageDiagram.title}
                                      summary={selectedPageDiagram.summary}
                                      renderSource={selectedPageDiagram.render_source}
                                      provider={selectedPageDiagram.provider}
                                      model={selectedPageDiagram.model}
                                      coveredEvidence={selectedPageDiagram.covered_evidence}
                                      missingEvidence={selectedPageDiagram.missing_evidence}
                                      qualityNotes={selectedPageDiagram.quality_notes}
                                      downloadName={`${selectedPage.page_slug || selectedPageDiagram.diagram_type || 'diagram'}-${activeSnapshotId || 'snapshot'}`}
                                    />
                                  ) : null}
                                  {shouldHideRawDiagramSource ? null : <div>{renderMarkdownBlocks(pageContent)}</div>}
                                </Space>
                              </Spin>
                            )}
                          </Card>
                        </Col>
                      </Row>
                    ),
                  },
                  {
                    key: 'diagrams',
                    label: '图表中心',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Alert
                          type="info"
                          showIcon
                          message="图资产采用逐图生成与聚合总图"
                          description="重跑关键图时只刷新当前 Snapshot 的 overview / quality / diagrams 资产，不会清空页面浏览状态。fallback 图会明确标记为 draft / fallback。"
                          action={
                            <Space wrap>
                              <Button
                                size="small"
                                loading={diagramRegeneratingKey === 'critical'}
                                onClick={() =>
                                  void handleRegenerateDiagrams(CRITICAL_DIAGRAM_TYPES, {
                                    actionKey: 'critical',
                                    scopeLabel: '关键图谱',
                                  })
                                }
                              >
                                重跑关键图
                              </Button>
                              <Button
                                size="small"
                                loading={diagramRegeneratingKey === 'all'}
                                onClick={() =>
                                  void handleRegenerateDiagrams(
                                    DIAGRAM_ORDER.filter((item) => item !== 'overview'),
                                    {
                                      actionKey: 'all',
                                      scopeLabel: '全部正式图谱',
                                    }
                                  )
                                }
                              >
                                重跑全部正式图
                              </Button>
                            </Space>
                          }
                        />
                        <Space direction="vertical" size={16} style={{ width: '100%' }}>
                          {diagramGroups.length ? (
                            diagramGroups.map((group) => (
                              <Card
                                key={`${group.scopeType}:${group.scopeKey}`}
                                size="small"
                                title={group.title}
                                extra={group.scopeType === 'project' ? null : (
                                  <Button
                                    size="small"
                                    loading={diagramRegeneratingKey === `${group.scopeType}:${group.scopeKey}`}
                                    onClick={() =>
                                      void handleRegenerateDiagrams([], {
                                        actionKey: `${group.scopeType}:${group.scopeKey}`,
                                        scopeLabel: group.title,
                                        scopeType: group.scopeType,
                                        scopeKey: group.scopeKey,
                                      })
                                    }
                                  >
                                    重跑此组
                                  </Button>
                                )}
                              >
                                <Row gutter={[16, 16]}>
                                  {group.diagrams.map((diagram) => (
                                    <Col span={12} key={`${diagram.diagram_key || diagram.diagram_type}:${diagram.id || diagram.title}`}>
                                      <Card
                                        size="small"
                                        title={diagram.title || DIAGRAM_LABELS[diagram.diagram_type] || diagram.diagram_type}
                                        extra={
                                          <Space wrap size={[6, 6]}>
                                            <Button
                                              size="small"
                                              loading={diagramRegeneratingKey === (diagram.diagram_key || diagram.diagram_type)}
                                              onClick={() =>
                                                void handleRegenerateDiagrams([diagram.diagram_type], {
                                                  actionKey: diagram.diagram_key || diagram.diagram_type,
                                                  scopeLabel: DIAGRAM_LABELS[diagram.diagram_type] || diagram.diagram_type,
                                                  scopeType: diagram.scope_type || undefined,
                                                  scopeKey: diagram.scope_key || undefined,
                                                })
                                              }
                                            >
                                              重跑本图
                                            </Button>
                                            {diagram.scope_type && diagram.scope_type !== 'project' ? (
                                              <Tag color="purple">{diagram.scope_type}</Tag>
                                            ) : null}
                                            {diagram.render_source ? (
                                              <Tag color={diagram.render_source === 'fallback_heuristic' ? 'orange' : 'blue'}>
                                                {diagram.render_source === 'fallback_heuristic' ? 'draft / fallback' : diagram.render_source}
                                              </Tag>
                                            ) : null}
                                            {statusTag(diagram.render_status)}
                                          </Space>
                                        }
                                      >
                                        {diagram.content ? (
                                          <MermaidBlock
                                            code={diagram.content}
                                            title={diagram.title || DIAGRAM_LABELS[diagram.diagram_type] || diagram.diagram_type}
                                            summary={diagram.summary}
                                            renderSource={diagram.render_source}
                                            provider={diagram.provider}
                                            model={diagram.model}
                                            coveredEvidence={diagram.covered_evidence}
                                            missingEvidence={diagram.missing_evidence}
                                            qualityNotes={diagram.quality_notes}
                                            downloadName={`${diagram.diagram_key || diagram.diagram_type}-${activeSnapshotId || 'snapshot'}`}
                                          />
                                        ) : (
                                          <Empty description="当前图表尚未生成内容" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                                        )}
                                      </Card>
                                    </Col>
                                  ))}
                                </Row>
                              </Card>
                            ))
                          ) : (
                            <Empty description="当前 Snapshot 尚未生成图表资产" />
                          )}
                        </Space>
                      </Space>
                    ),
                  },
                  {
                    key: 'threads',
                    label: '线程视图',
                    children: (
                      <Row gutter={[16, 16]}>
                        <Col span={10}>
                          <Card size="small" title="线程索引">
                            <List
                              size="small"
                              dataSource={groupedThreads}
                              locale={{ emptyText: '当前 Snapshot 尚未生成线程' }}
                              renderItem={(item) => (
                                <List.Item>
                                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                    <Space wrap>
                                      <Tag color="blue">{THREAD_LEVEL_LABELS[item.thread_level] || item.thread_level}</Tag>
                                      <Text strong>{item.title}</Text>
                                    </Space>
                                    <Text type="secondary">{item.thread_key}</Text>
                                    <Text type="secondary">domain: {item.domain_key || 'project'}</Text>
                                  </Space>
                                </List.Item>
                              )}
                            />
                          </Card>
                        </Col>
                        <Col span={14}>
                          <Card size="small" title="线程摘要">
                            {groupedThreads.length ? (
                              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                {groupedThreads.slice(0, 12).map((thread) => (
                                  <Card key={thread.thread_key} size="small" type="inner" title={thread.title}>
                                    <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                      <Space wrap>
                                        <Tag color="purple">{THREAD_LEVEL_LABELS[thread.thread_level] || thread.thread_level}</Tag>
                                        {thread.repo_roles_json?.map((role) => <Tag key={`${thread.thread_key}:${role}`}>{role}</Tag>)}
                                      </Space>
                                      <div>{renderMarkdownBlocks(thread.summary_markdown || '暂无摘要')}</div>
                                    </Space>
                                  </Card>
                                ))}
                              </Space>
                            ) : (
                              <Empty description="等待线程抽取结果" />
                            )}
                          </Card>
                        </Col>
                      </Row>
                    ),
                  },
                  {
                    key: 'quality',
                    label: '质量门禁',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[16, 16]}>
                          <Col span={8}>
                            <Card size="small">
                              <Statistic title="发布状态" value={snapshotQuality?.publish_ready ? 'Ready' : 'Blocked'} />
                            </Card>
                          </Col>
                          <Col span={8}>
                            <Card size="small">
                              <Statistic title="一致性检查" value={snapshotQuality?.consistency_checks.length || 0} />
                            </Card>
                          </Col>
                          <Col span={8}>
                            <Card size="small">
                              <Statistic title="语义评分项" value={snapshotQuality?.semantic_scores.length || 0} />
                            </Card>
                          </Col>
                        </Row>
                        <Card size="small" title="发布阻塞项">
                          {snapshotQuality?.publish_blockers?.length ? (
                            <Space wrap>
                              {snapshotQuality.publish_blockers.map((item) => (
                                <Tag key={item} color="orange">
                                  {blockerLabel(item)}
                                </Tag>
                              ))}
                            </Space>
                          ) : (
                            <Tag color="green">无阻塞项</Tag>
                          )}
                        </Card>
                        <Card size="small" title="待补全建议">
                          {snapshotQuality?.publish_warnings?.length ? (
                            <Space wrap>
                              {snapshotQuality.publish_warnings.map((item) => (
                                <Tag key={item} color="blue">
                                  {blockerLabel(item)}
                                </Tag>
                              ))}
                            </Space>
                          ) : (
                            <Tag color="green">无待补全项</Tag>
                          )}
                        </Card>
                        <Row gutter={[16, 16]}>
                          <Col span={12}>
                            <Card size="small" title="一致性检查">
                              <List
                                size="small"
                                dataSource={snapshotQuality?.consistency_checks || []}
                                locale={{ emptyText: '暂无一致性检查记录' }}
                                renderItem={(item) => (
                                  <List.Item>
                                    <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                      <Space wrap>
                                        <Tag color={item.issue_level === 'error' ? 'red' : item.issue_level === 'warn' ? 'orange' : 'blue'}>
                                          {item.issue_level || 'info'}
                                        </Tag>
                                        <Text strong>{item.issue_code || item.check_type || '-'}</Text>
                                        {statusTag(item.status)}
                                      </Space>
                                      <Text type="secondary">{item.check_type || '-'} · score {item.score ?? '-'}</Text>
                                    </Space>
                                  </List.Item>
                                )}
                              />
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card size="small" title="语义评分">
                              <List
                                size="small"
                                dataSource={snapshotQuality?.semantic_scores || []}
                                locale={{ emptyText: '暂无语义评分' }}
                                renderItem={(item) => (
                                  <List.Item>
                                    <Descriptions size="small" column={1} style={{ width: '100%' }}>
                                      <Descriptions.Item label="目标">{item.target_type}</Descriptions.Item>
                                      <Descriptions.Item label="总分">{item.final_score}</Descriptions.Item>
                                      <Descriptions.Item label="状态">{statusTag(item.status)}</Descriptions.Item>
                                    </Descriptions>
                                  </List.Item>
                                )}
                              />
                            </Card>
                          </Col>
                        </Row>
                      </Space>
                    ),
                  },
                  {
                    key: 'engine',
                    label: '引擎 / 评分',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Row gutter={[16, 16]}>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic title="Stage Runs" value={snapshotStageRuns.length} prefix={<SafetyCertificateOutlined />} />
                            </Card>
                          </Col>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic title="Stage Assets" value={snapshotStageAssets.length} prefix={<FileSearchOutlined />} />
                            </Card>
                          </Col>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic title="Snapshot Scores" value={snapshotScores.length} prefix={<RocketOutlined />} />
                            </Card>
                          </Col>
                          <Col span={6}>
                            <Card size="small">
                              <Statistic
                                title="Health Index"
                                value={Number(projectHealth?.knowledge_health_index ?? projectHealth?.numeric_value ?? 0)}
                                precision={3}
                              />
                            </Card>
                          </Col>
                        </Row>
                        <Row gutter={[16, 16]}>
                          <Col span={12}>
                            <Card size="small" title="项目拓扑">
                              {topologyPayload.repos?.length ? (
                                <List
                                  size="small"
                                  dataSource={topologyPayload.repos}
                                  renderItem={(item) => (
                                    <List.Item>
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          <Tag color="purple">{item.role || 'repo'}</Tag>
                                          {item.subsystem ? <Tag color="geekblue">{item.subsystem}</Tag> : null}
                                          <Text strong>{item.repoId || item.root || '-'}</Text>
                                        </Space>
                                        <Text type="secondary">
                                          {item.branch || '-'} @ {item.commitSha || '-'}
                                        </Text>
                                      </Space>
                                    </List.Item>
                                  )}
                                />
                              ) : (
                                <Empty description="暂无项目拓扑投影" />
                              )}
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card size="small" title="Stage Runner">
                              <List
                                size="small"
                                dataSource={snapshotStageRuns}
                                locale={{ emptyText: '暂无 stage runs' }}
                                renderItem={(item) => {
                                  const stageKey = String(item.stage_key || item.stageKey || '');
                                  const skillCount = snapshotSkillExecutions.filter(
                                    (execution) => String(execution.stage_key || execution.stageKey || '') === stageKey
                                  ).length;
                                  return (
                                    <List.Item>
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          <Tag color="blue">{STAGE_LABELS[stageKey] || stageKey}</Tag>
                                          {statusTag(item.status)}
                                          <Tag>{skillCount} skills</Tag>
                                        </Space>
                                        <Text type="secondary">
                                          sort {Number(item.sort_order ?? item.sortOrder ?? 0)} · {stageKey}
                                        </Text>
                                      </Space>
                                    </List.Item>
                                  );
                                }}
                              />
                            </Card>
                          </Col>
                        </Row>
                        <Row gutter={[16, 16]}>
                          <Col span={10}>
                            <Card
                              size="small"
                              title="Skill Registry"
                              extra={skillOverrideFile ? <Text type="secondary">{skillOverrideFile}</Text> : null}
                            >
                              <Alert
                                type="info"
                                showIcon
                                style={{ marginBottom: 12 }}
                                message="所有 DeepWiki 算法都已封装为 Skill，后续可直接通过这里调整合同并重跑项目。"
                              />
                              <List
                                size="small"
                                loading={skillRegistryLoading}
                                dataSource={skillRegistry}
                                locale={{ emptyText: '暂无 Skill 合同' }}
                                renderItem={(item) => {
                                  const skillKey = String(item.skillKey || item.skill_key || '');
                                  const selected = String(selectedSkillKey || '') === skillKey;
                                  return (
                                    <List.Item
                                      onClick={() => setSelectedSkillKey(skillKey)}
                                      style={{
                                        cursor: 'pointer',
                                        paddingInline: 12,
                                        borderRadius: 12,
                                        background: selected ? '#eff6ff' : 'transparent',
                                      }}
                                    >
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          {item.layer ? <Tag color="blue">{item.layer}</Tag> : null}
                                          <Text strong>{skillKey}</Text>
                                          {item.algorithm ? <Tag color="purple">{item.algorithm}</Tag> : null}
                                        </Space>
                                        <Text type="secondary">{item.purpose || '暂无说明'}</Text>
                                      </Space>
                                    </List.Item>
                                  );
                                }}
                              />
                            </Card>
                          </Col>
                          <Col span={14}>
                            <Card
                              size="small"
                              title="Skill Detail"
                              extra={
                                selectedSkillContract ? (
                                  <Space wrap>
                                    <Button size="small" onClick={() => handleOpenSkillEditor(selectedSkillContract)}>
                                      编辑 Skill
                                    </Button>
                                    <Button
                                      size="small"
                                      danger
                                      icon={<DeleteOutlined />}
                                      loading={actionLoading}
                                      onClick={() =>
                                        void handleResetSkillOverride(
                                          String(selectedSkillContract.skillKey || selectedSkillContract.skill_key || '')
                                        )
                                      }
                                    >
                                      重置覆盖
                                    </Button>
                                  </Space>
                                ) : null
                              }
                            >
                              {selectedSkillContract ? (
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                  <Descriptions size="small" column={1}>
                                    <Descriptions.Item label="Skill Key">
                                      {selectedSkillContract.skillKey || selectedSkillContract.skill_key}
                                    </Descriptions.Item>
                                    <Descriptions.Item label="Layer">{selectedSkillContract.layer || '-'}</Descriptions.Item>
                                    <Descriptions.Item label="Algorithm">{selectedSkillContract.algorithm || '-'}</Descriptions.Item>
                                    <Descriptions.Item label="Version">{selectedSkillContract.version || '-'}</Descriptions.Item>
                                    <Descriptions.Item label="Purpose">{selectedSkillContract.purpose || '-'}</Descriptions.Item>
                                  </Descriptions>
                                  <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                    <div>
                                      <Text strong>Inputs</Text>
                                      <div style={{ marginTop: 6 }}>
                                        {(selectedSkillContract.inputs || selectedSkillContract.acceptedInputs || []).map((item) => (
                                          <Tag key={`input:${item}`} color="geekblue">
                                            {item}
                                          </Tag>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <Text strong>Outputs</Text>
                                      <div style={{ marginTop: 6 }}>
                                        {(selectedSkillContract.outputs || selectedSkillContract.producedOutputs || []).map((item) => (
                                          <Tag key={`output:${item}`} color="green">
                                            {item}
                                          </Tag>
                                        ))}
                                      </div>
                                    </div>
                                    <div>
                                      <Text strong>Dependencies</Text>
                                      <div style={{ marginTop: 6 }}>
                                        {(selectedSkillContract.dependencies || []).length ? (
                                          selectedSkillContract.dependencies?.map((item) => (
                                            <Tag key={`dependency:${item}`} color="gold">
                                              {item}
                                            </Tag>
                                          ))
                                        ) : (
                                          <Text type="secondary">无依赖</Text>
                                        )}
                                      </div>
                                    </div>
                                    <div>
                                      <Text strong>Quality Checks</Text>
                                      <div style={{ marginTop: 6 }}>
                                        {(selectedSkillContract.qualityChecks || []).length ? (
                                          selectedSkillContract.qualityChecks?.map((item) => (
                                            <Tag key={`quality:${item}`} color="cyan">
                                              {item}
                                            </Tag>
                                          ))
                                        ) : (
                                          <Text type="secondary">未配置</Text>
                                        )}
                                      </div>
                                    </div>
                                  </Space>
                                </Space>
                              ) : (
                                <Empty description="请选择一个 Skill 查看详情" />
                              )}
                            </Card>
                          </Col>
                        </Row>
                        <Row gutter={[16, 16]}>
                          <Col span={12}>
                            <Card size="small" title="Gate Decisions">
                              {snapshotGateDecisionRows.length ? (
                                <List
                                  size="small"
                                  dataSource={snapshotGateDecisionRows}
                                  renderItem={(item) => (
                                    <List.Item>
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          <Tag color={item.is_blocking ? 'red' : item.decision_status === 'warn' ? 'orange' : 'green'}>
                                            {item.decision_status || 'review'}
                                          </Tag>
                                          <Text strong>{item.gate_key}</Text>
                                          {item.source_stage_key ? <Tag>{item.source_stage_key}</Tag> : null}
                                        </Space>
                                        <Text type="secondary">
                                          {JSON.stringify(item.decision_json || {}, null, 0)}
                                        </Text>
                                      </Space>
                                    </List.Item>
                                  )}
                                />
                              ) : snapshotGateDecisionAsset?.payload ? (
                                <pre
                                  style={{
                                    margin: 0,
                                    padding: 12,
                                    borderRadius: 12,
                                    background: '#f8fafc',
                                    color: '#334155',
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {JSON.stringify(snapshotGateDecisionAsset.payload, null, 2)}
                                </pre>
                              ) : (
                                <Empty description="暂无 gate decisions" />
                              )}
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card size="small" title="Score Breakdown">
                              {snapshotScoreBreakdowns && Object.keys(snapshotScoreBreakdowns).length ? (
                                <Descriptions size="small" column={1}>
                                  {Object.entries(snapshotScoreBreakdowns).map(([key, value]) => (
                                    <Descriptions.Item key={key} label={key}>
                                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                    </Descriptions.Item>
                                  ))}
                                </Descriptions>
                              ) : (
                                <Empty description="暂无 score breakdown" />
                              )}
                            </Card>
                          </Col>
                        </Row>
                        <Row gutter={[16, 16]}>
                          <Col span={12}>
                            <Card size="small" title="Stage Assets 分布">
                              <List
                                size="small"
                                dataSource={stageAssetCounts}
                                locale={{ emptyText: '暂无 stage assets' }}
                                renderItem={(item) => (
                                  <List.Item>
                                    <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                                      <Space wrap>
                                        <Tag color="purple">{STAGE_LABELS[item.stageKey] || item.stageKey}</Tag>
                                        <Text type="secondary">{item.stageKey}</Text>
                                      </Space>
                                      <Tag color="blue">{item.count}</Tag>
                                    </Space>
                                  </List.Item>
                                )}
                              />
                            </Card>
                          </Col>
                          <Col span={12}>
                            <Card size="small" title="Top Scored Entities">
                              <List
                                size="small"
                                dataSource={topSnapshotScores}
                                locale={{ emptyText: '暂无 snapshot scores' }}
                                renderItem={(item) => (
                                  <List.Item>
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                      <Space wrap>
                                        <Tag color={scoreColor(item.overall_score)}>{item.overall_score.toFixed(3)}</Tag>
                                        <Tag>{item.entity_type}</Tag>
                                        <Text strong>{item.entity_id}</Text>
                                      </Space>
                                      {item.explanations?.length ? <Text type="secondary">{item.explanations[0]}</Text> : null}
                                    </Space>
                                  </List.Item>
                                )}
                              />
                            </Card>
                          </Col>
                        </Row>
                        {snapshotScoreRegressions.length ? (
                          <Card size="small" title="Score Regressions">
                            <pre
                              style={{
                                margin: 0,
                                padding: 12,
                                borderRadius: 12,
                                background: '#f8fafc',
                                color: '#334155',
                                overflow: 'auto',
                                whiteSpace: 'pre-wrap',
                              }}
                            >
                              {JSON.stringify(snapshotScoreRegressions, null, 2)}
                            </pre>
                          </Card>
                        ) : null}
                      </Space>
                    ),
                  },
                  {
                    key: 'query',
                    label: '智能检索',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Card
                          size="small"
                          title="Snapshot 智能检索"
                          extra={(
                            <Space>
                              <Select
                                value={snapshotQueryMode}
                                style={{ width: 140 }}
                                onChange={(value) => setSnapshotQueryMode(value)}
                                options={[
                                  { value: 'auto', label: 'Auto' },
                                  { value: 'local', label: 'Local' },
                                  { value: 'global', label: 'Global' },
                                ]}
                              />
                              <Button type="primary" loading={snapshotQueryLoading} onClick={() => void handleSnapshotQuery()}>
                                发起检索
                              </Button>
                            </Space>
                          )}
                        >
                          <Space direction="vertical" size={12} style={{ width: '100%' }}>
                            <Alert
                              type="info"
                              showIcon
                              message="基于当前 Snapshot 的图谱 + RAG 证据回答"
                              description="Auto 会自动判断走局部实体检索还是项目级全局检索；如果证据不足，回答会显式提示。"
                            />
                            <Input.TextArea
                              rows={4}
                              value={snapshotQueryText}
                              onChange={(event) => setSnapshotQueryText(event.target.value)}
                              placeholder="例如：销售订单服务依赖哪些接口和表？ / 这个项目的整体业务域与核心模块怎么分层？"
                            />
                          </Space>
                        </Card>
                        <Row gutter={[16, 16]}>
                          <Col span={14}>
                            <Card size="small" title="回答与引用">
                              {snapshotQueryResult ? (
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                  <div>{renderMarkdownBlocks(snapshotQueryResult.answer || '')}</div>
                                  <List
                                    size="small"
                                    header="引用证据"
                                    dataSource={snapshotQueryResult.citations || []}
                                    locale={{ emptyText: '暂无引用证据' }}
                                    renderItem={(item) => (
                                      <List.Item>
                                        <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                          <Space wrap>
                                            <Text strong>{item.title || item.page_slug || item.source_uri || '未知页面'}</Text>
                                            {Number.isFinite(Number(item.score)) ? <Tag color="blue">score {Number(item.score).toFixed(3)}</Tag> : null}
                                          </Space>
                                          <Text type="secondary">{item.page_slug || item.source_uri || '-'}</Text>
                                          <Paragraph style={{ marginBottom: 0 }}>{item.excerpt || '无摘录'}</Paragraph>
                                        </Space>
                                      </List.Item>
                                    )}
                                  />
                                </Space>
                              ) : (
                                <Empty description="输入问题后即可查看回答、引用页和检索轨迹" />
                              )}
                            </Card>
                          </Col>
                          <Col span={10}>
                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                              <Card size="small" title="命中对象">
                                <List
                                  size="small"
                                  dataSource={snapshotQueryResult?.retrieved_objects || []}
                                  locale={{ emptyText: '暂无命中对象' }}
                                  renderItem={(item) => (
                                    <List.Item>
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          <Tag color="purple">{item.object_type}</Tag>
                                          <Text strong>{item.title || item.object_key}</Text>
                                        </Space>
                                        <Text type="secondary">{item.object_key}</Text>
                                        {Number.isFinite(Number(item.link_score)) ? <Tag color="geekblue">link {Number(item.link_score).toFixed(3)}</Tag> : null}
                                      </Space>
                                    </List.Item>
                                  )}
                                />
                              </Card>
                              <Card size="small" title="命中线程">
                                <List
                                  size="small"
                                  dataSource={snapshotQueryResult?.retrieved_threads || []}
                                  locale={{ emptyText: '暂无命中线程' }}
                                  renderItem={(item) => (
                                    <List.Item>
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          <Tag color="purple">{THREAD_LEVEL_LABELS[item.thread_level] || item.thread_level}</Tag>
                                          <Text strong>{item.title}</Text>
                                          {Number.isFinite(Number(item.rank_score)) ? <Tag color="blue">rank {Number(item.rank_score).toFixed(3)}</Tag> : null}
                                        </Space>
                                        <Text type="secondary">{item.thread_key}</Text>
                                        {item.summary_markdown ? <Paragraph style={{ marginBottom: 0 }}>{item.summary_markdown}</Paragraph> : null}
                                      </Space>
                                    </List.Item>
                                  )}
                                />
                              </Card>
                              <Card size="small" title="命中社区">
                                <List
                                  size="small"
                                  dataSource={snapshotQueryResult?.community_hits || []}
                                  locale={{ emptyText: '暂无命中社区' }}
                                  renderItem={(item) => (
                                    <List.Item>
                                      <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        <Space wrap>
                                          <Text strong>{item.title}</Text>
                                          {Number.isFinite(Number(item.rank_score)) ? <Tag color="blue">rank {Number(item.rank_score).toFixed(3)}</Tag> : null}
                                        </Space>
                                        <Text type="secondary">{item.community_key}</Text>
                                      </Space>
                                    </List.Item>
                                  )}
                                />
                              </Card>
                              <Card size="small" title="检索 Trace">
                                <pre
                                  style={{
                                    margin: 0,
                                    padding: 12,
                                    borderRadius: 12,
                                    background: '#f8fafc',
                                    color: '#334155',
                                    overflow: 'auto',
                                    whiteSpace: 'pre-wrap',
                                  }}
                                >
                                  {JSON.stringify(snapshotQueryResult?.trace || {}, null, 2)}
                                </pre>
                              </Card>
                            </Space>
                          </Col>
                        </Row>
                      </Space>
                    ),
                  },
                  {
                    key: 'derive',
                    label: '方案派生',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Alert
                          type="info"
                          showIcon
                          message="正式方案只能基于已发布 Snapshot 派生"
                          description="技术方案要求 PRD / 业务方案已进入当前 Snapshot；测试方案要求 PRD、技术方案、接口契约、数据库 DDL 以及关键图表均已进入当前 Snapshot。"
                        />
                        <Space wrap>
                          <Button
                            type="primary"
                            icon={<FileTextOutlined />}
                            loading={actionLoading}
                            onClick={() => void handleCreateTechSpec()}
                            disabled={snapshot.status !== 'published'}
                          >
                            生成技术方案
                          </Button>
                          <Button
                            icon={<FileSearchOutlined />}
                            loading={actionLoading}
                            onClick={() => void handleCreateTestPlan()}
                            disabled={snapshot.status !== 'published'}
                          >
                            生成测试方案
                          </Button>
                        </Space>
                        <Card size="small" title="当前 Snapshot 相关方案任务">
                          <List
                            size="small"
                            dataSource={snapshotOverview?.related_doc_bundles || []}
                            locale={{ emptyText: '暂无相关 bundle' }}
                            renderItem={(item) => (
                              <List.Item
                                actions={[
                                  <Button key="open" type="link" onClick={() => navigate(`/doc-gate?bundle=${item.id}`)}>
                                    打开
                                  </Button>,
                                ]}
                              >
                                <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                  <Space wrap>
                                    <Text strong>{item.title || item.bundle_code}</Text>
                                    {statusTag(item.status)}
                                    <Tag color="blue">{item.workflow_mode || '-'}</Tag>
                                  </Space>
                                  <Text type="secondary">{item.bundle_code}</Text>
                                </Space>
                              </List.Item>
                            )}
                          />
                        </Card>
                      </Space>
                    ),
                  },
                ]}
              />
            )}
          </>
        )}
      </Space>

      <Modal
        title="新建项目"
        open={projectModalOpen}
        onCancel={() => setProjectModalOpen(false)}
        onOk={() => void handleCreateProject()}
        confirmLoading={actionLoading}
        width={860}
      >
        <Form form={projectForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="项目名称" name="project_name" rules={[{ required: true, message: '请输入项目名称' }]}>
                <Input placeholder="销售订单中心" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="项目编码" name="project_code" rules={[{ required: true, message: '请输入项目编码' }]}>
                <Input placeholder="sales-order" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="默认主分支" name="default_branch">
                <Input placeholder="main" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="项目使命" name="mission">
                <Input placeholder="面向销售订单域的项目级知识库与方案生成基座" />
              </Form.Item>
            </Col>
          </Row>
          <Form.List name="repo_bindings">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Text strong>初始仓库绑定</Text>
                  <Button
                    icon={<PlusOutlined />}
                    type="dashed"
                    onClick={() => add({ repo_role: 'service', branch: projectForm.getFieldValue('default_branch') || 'main' })}
                  >
                    添加仓库
                  </Button>
                </Space>
                {fields.map((field, index) => (
                  <Card
                    size="small"
                    key={field.key}
                    title={`仓库 ${index + 1}`}
                    extra={
                      fields.length > 1 ? (
                        <Button size="small" type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                      ) : null
                    }
                  >
                    <Row gutter={12}>
                      <Col span={12}>
                        <Form.Item
                          label="仓库源"
                          name={[field.name, 'repo_source_id']}
                          rules={[{ required: true, message: '请选择仓库源' }]}
                        >
                          <Select placeholder="选择已有仓库源" options={repoSourceOptions} showSearch optionFilterProp="label" />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="仓库角色" name={[field.name, 'repo_role']} initialValue="service">
                          <Select options={REPO_ROLE_OPTIONS} />
                        </Form.Item>
                      </Col>
                      <Col span={6}>
                        <Form.Item label="默认分支" name={[field.name, 'branch']}>
                          <Input placeholder="main" />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Form.Item name={[field.name, 'is_primary']} valuePropName="checked">
                      <Checkbox>设为主仓</Checkbox>
                    </Form.Item>
                  </Card>
                ))}
              </Space>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Modal
        title="添加仓库到项目"
        open={repoModalOpen}
        onCancel={() => setRepoModalOpen(false)}
        onOk={() => void handleAddRepo()}
        confirmLoading={actionLoading}
      >
        <Form form={repoForm} layout="vertical">
          <Form.Item label="已有仓库源" name="repo_source_id">
            <Select allowClear placeholder="优先选择已有仓库源" options={repoSourceOptions} showSearch optionFilterProp="label" />
          </Form.Item>
          <Form.Item label="或输入新仓库地址" name="repo_url">
            <Input placeholder="https://codeup.aliyun.com/.../repo.git" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="仓库角色" name="repo_role" initialValue="service">
                <Select options={REPO_ROLE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="默认分支" name="branch">
                <Input placeholder={selectedProject?.default_branch || 'main'} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="is_primary" valuePropName="checked">
            <Checkbox>设为主仓</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="新建版本线"
        open={versionModalOpen}
        onCancel={() => setVersionModalOpen(false)}
        onOk={() => void handleCreateVersionLine()}
        confirmLoading={actionLoading}
        width={860}
      >
        <Form form={versionForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="版本线名称" name="branch_name" rules={[{ required: true, message: '请输入版本线名称' }]}>
                <Input placeholder="release/2026Q2" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="展示名称" name="display_name">
                <Input placeholder="2026Q2 公司版" />
              </Form.Item>
            </Col>
          </Row>
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Text strong>版本线下仓库分支映射</Text>
            {(selectedProject?.repos || []).filter((repo) => hasNumericId(repo.id)).map((repo, index) => {
              const availableBranches = Array.from(
                new Set([
                  ...(Array.isArray(repo.repo_source?.available_branches) ? repo.repo_source?.available_branches : []),
                  repoBindingDefaultBranch(repo, selectedProject?.default_branch || 'main'),
                ].filter(Boolean))
              );
              return (
                <Card key={repo.id} size="small" title={repo.repo_source?.repo_slug || repo.repo_slug || `仓库 ${index + 1}`}>
                  <Form.Item name={['repo_mappings', index, 'project_repo_id']} initialValue={repo.id} hidden>
                    <Input />
                  </Form.Item>
                  <Form.Item
                    label="对应物理分支"
                    name={['repo_mappings', index, 'repo_branch_name']}
                    rules={[{ required: true, message: '请输入该仓库在版本线下的分支' }]}
                  >
                    <Input placeholder={repoBindingDefaultBranch(repo, selectedProject?.default_branch || 'main')} />
                  </Form.Item>
                  <Text type="secondary">可参考分支：{availableBranches.join('、')}</Text>
                </Card>
              );
            })}
          </Space>
        </Form>
      </Modal>

      <Modal
        title={selectedSkillContract ? `编辑 Skill · ${selectedSkillContract.skillKey || selectedSkillContract.skill_key}` : '编辑 Skill'}
        open={skillEditorOpen}
        onCancel={() => setSkillEditorOpen(false)}
        onOk={() => void handleSaveSkillOverride()}
        confirmLoading={actionLoading}
        width={860}
      >
        <Form form={skillForm} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="用途说明" name="purpose" rules={[{ required: true, message: '请输入 Skill 用途' }]}>
                <Input placeholder="用于抽取项目拓扑与仓库角色" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="所属层" name="layer" rules={[{ required: true, message: '请输入所属层' }]}>
                <Input placeholder="repo_understanding" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="版本" name="version">
                <Input placeholder="1.0.0" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Algorithm" name="algorithm" rules={[{ required: true, message: '请输入算法入口名' }]}>
                <Input placeholder="deriveRepoUnderstanding" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="依赖 Skills（每行一个）" name="dependenciesText">
                <Input.TextArea rows={4} placeholder="structure_extraction_skill" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Inputs（每行一个）" name="inputsText">
                <Input.TextArea rows={6} placeholder="project_topology" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Outputs（每行一个）" name="outputsText">
                <Input.TextArea rows={6} placeholder="route_graph" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item label="Failure Modes（每行一个）" name="failureModesText">
                <Input.TextArea rows={5} placeholder="missing_repo_root" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="Quality Checks（每行一个）" name="qualityChecksText">
                <Input.TextArea rows={5} placeholder="main_flow_present" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="Parameters（JSON）" name="parametersText">
            <Input.TextArea rows={8} placeholder={"{\n  \"mode\": \"project_topology\"\n}"} />
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  );
};

export default DeepWikiCenter;
