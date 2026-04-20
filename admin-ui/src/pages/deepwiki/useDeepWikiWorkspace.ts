import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppWorkspace } from '../../context/AppWorkspaceContext';
import { Form, message } from 'antd';
import {
  deepWikiApi,
  settingsApi,
  type DeepWikiAddRepoToProjectRequest,
  type DeepWikiCreateRequest,
  type DeepWikiBranch,
  type DeepWikiFeedbackEvent,
  type DeepWikiGraph,
  type DeepWikiAssertion,
  type DeepWikiFlow,
  type DeepWikiModelOption,
  type DeepWikiPageRow,
  type DeepWikiProvider,
  type DeepWikiProject,
  type DeepWikiProjectCreateRequest,
  type DeepWikiRepoBranchesResult,
  type DeepWikiRepoRow,
  type DeepWikiRunDetail,
  type DeepWikiRunRow,
  type DeepWikiScenario,
  type DeepWikiSemanticScore,
  type DeepWikiConsistencyCheck,
  type DeepWikiSnapshot,
  type DeepWikiSnapshotRepoRevision,
  type DeepWikiQualityReport,
  type DeepWikiSyncConfig,
  type SystemSettings,
} from '../../services/api';
import type { ColumnsType } from 'antd/es/table';
import {
  buildWikiTreeData,
  filterWikiTreeData,
} from './deepWikiTree';
import {
  getNumberValue,
  getRecordObject,
  getStringArray,
} from './deepWikiUtils';
import { statusTag } from './deepWikiStatus';
import type { DeepWikiCenterProps } from './deepWikiCenterProps';

export function useDeepWikiWorkspace({
  onOpenRuntimeTrace,
  onOpenKnowledge,
  onOpenDocBundle,
  initialProjectId,
}: DeepWikiCenterProps) {
  const { setProjectCode } = useAppWorkspace();
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [projects, setProjects] = useState<DeepWikiProject[]>([]);
  const [projectBranches, setProjectBranches] = useState<DeepWikiBranch[]>([]);
  const [projectSnapshots, setProjectSnapshots] = useState<DeepWikiSnapshot[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | undefined>(() =>
    initialProjectId != null && Number.isFinite(initialProjectId) ? initialProjectId : undefined,
  );
  const [selectedBranchName, setSelectedBranchName] = useState<string>();
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<number>();
  const [selectedSnapshot, setSelectedSnapshot] = useState<DeepWikiSnapshot | null>(null);
  const [snapshotRepoRevisions, setSnapshotRepoRevisions] = useState<DeepWikiSnapshotRepoRevision[]>([]);
  const [snapshotQuality, setSnapshotQuality] = useState<DeepWikiQualityReport | null>(null);
  const [snapshotObjects, setSnapshotObjects] = useState<Array<Record<string, unknown>>>([]);
  const [snapshotFlows, setSnapshotFlows] = useState<DeepWikiFlow[]>([]);
  const [snapshotAssertions, setSnapshotAssertions] = useState<DeepWikiAssertion[]>([]);
  const [snapshotScenarios, setSnapshotScenarios] = useState<DeepWikiScenario[]>([]);
  const [snapshotSemanticScores, setSnapshotSemanticScores] = useState<DeepWikiSemanticScore[]>([]);
  const [snapshotConsistencyChecks, setSnapshotConsistencyChecks] = useState<DeepWikiConsistencyCheck[]>([]);
  const [wikiFeedbackEvents, setWikiFeedbackEvents] = useState<DeepWikiFeedbackEvent[]>([]);
  const [wikiFeedbackLoading, setWikiFeedbackLoading] = useState(false);
  const [snapshotView, setSnapshotView] = useState<
    'objects' | 'flows' | 'assertions' | 'scenarios' | 'scores' | 'consistency'
  >('objects');
  const [snapshotObjectTypeFilter, setSnapshotObjectTypeFilter] = useState<string>('all');
  const [branchMappingDraft, setBranchMappingDraft] = useState<Record<number, string>>({});
  /** 项目工作台：每个 repo_source 可选 Git 分支（getRepoBranches），用于逐仓映射下拉 */
  const [repoBranchOptionsBySourceId, setRepoBranchOptionsBySourceId] = useState<Record<number, string[]>>({});
  const [projectRepoBranchesLoading, setProjectRepoBranchesLoading] = useState(false);
  const [repos, setRepos] = useState<DeepWikiRepoRow[]>([]);
  const [runs, setRuns] = useState<DeepWikiRunRow[]>([]);
  const [repoBranches, setRepoBranches] = useState<DeepWikiRepoBranchesResult | null>(null);
  const [providers, setProviders] = useState<DeepWikiProvider[]>([]);
  const [models, setModels] = useState<DeepWikiModelOption[]>([]);
  const [selectedRepoSourceId, setSelectedRepoSourceId] = useState<number>();
  /** null = 运行记录表显示该仓库全部分支；非 null = 仅显示该分支上的运行 */
  const [repoExplorerBranchFilter, setRepoExplorerBranchFilter] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number>();
  const [runDetail, setRunDetail] = useState<DeepWikiRunDetail | null>(null);
  const [runGraph, setRunGraph] = useState<DeepWikiGraph | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [selectedPage, setSelectedPage] = useState<DeepWikiPageRow | null>(null);
  const [pageContent, setPageContent] = useState('');
  const [treeQuery, setTreeQuery] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [projectCreateVisible, setProjectCreateVisible] = useState(false);
  const [createForm] = Form.useForm<DeepWikiCreateRequest>();
  const [projectCreateForm] = Form.useForm<DeepWikiProjectCreateRequest>();
  const [syncForm] = Form.useForm<DeepWikiSyncConfig>();
  const [providerSettingsForm] = Form.useForm<Partial<SystemSettings>>();
  const [providerSettingsMasked, setProviderSettingsMasked] = useState('');

  const loadProviders = useCallback(async () => {
    const data = await deepWikiApi.listProviders();
    const nextProviders = Array.isArray(data.providers) ? data.providers : [];
    setProviders(nextProviders);
    const currentProvider = String(createForm.getFieldValue('research_provider') || '').trim();
    const defaultProvider = currentProvider || data.default_provider || nextProviders.find((item) => item.enabled)?.key || 'qwen_dashscope_native';
    createForm.setFieldValue('research_provider', defaultProvider);
    return { defaultProvider, nextProviders };
  }, [createForm]);

  const loadModels = useCallback(async (provider?: string) => {
    const data = await deepWikiApi.listModels(provider);
    const nextModels = Array.isArray(data.models) ? data.models : [];
    setModels(nextModels);
    const currentModel = String(createForm.getFieldValue('research_model') || '').trim();
    if (!currentModel && data.default_model) {
      createForm.setFieldValue('research_model', data.default_model);
    }
    return nextModels;
  }, [createForm]);

  const loadProjects = useCallback(async () => {
    const data = await deepWikiApi.listProjects();
    setProjects(data);
    setSelectedProjectId((prev) => {
      if (initialProjectId != null && Number.isFinite(initialProjectId)) return initialProjectId;
      if (prev != null) return prev;
      return data[0]?.id;
    });
    return data;
  }, [initialProjectId]);

  useEffect(() => {
    if (initialProjectId != null && Number.isFinite(initialProjectId)) {
      setSelectedProjectId(initialProjectId);
    }
  }, [initialProjectId]);

  const loadProjectWorkspace = useCallback(async (projectId: number, branchName?: string) => {
    const [project, branchResult, snapshots] = await Promise.all([
      deepWikiApi.getProject(projectId),
      deepWikiApi.listProjectBranches(projectId),
      deepWikiApi.listProjectSnapshots(projectId, branchName),
    ]);
    setProjects((current) => {
      const next = current.slice();
      const index = next.findIndex((item) => item.id === project.id);
      if (index >= 0) {
        next[index] = project;
        return next;
      }
      return [project, ...next];
    });
    setProjectBranches(branchResult.branches || []);
    setProjectSnapshots(snapshots);
    const nextBranch = branchName || branchResult.default_branch || branchResult.branches?.[0]?.branch;
    if (branchName) {
      setSelectedBranchName(branchName);
    } else {
      setSelectedBranchName((current) => current || nextBranch || current);
    }
    const defaultSnapshot =
      snapshots.find((item) => item.status === 'published') ||
      snapshots[0] ||
      null;
    if (defaultSnapshot) {
      setSelectedSnapshotId(defaultSnapshot.id);
      setSelectedSnapshot(defaultSnapshot);
      if (defaultSnapshot.run_id) {
        setSelectedRunId(Number(defaultSnapshot.run_id));
      }
    }
    return { project, branchResult, snapshots };
  }, []);

  const loadRepos = useCallback(async () => {
    const data = await deepWikiApi.listRepos();
    setRepos(data);
    setSelectedRepoSourceId((prev) => (prev == null && data[0]?.id ? data[0].id : prev));
    return data;
  }, []);

  const loadRuns = useCallback(async (repoSourceId?: number) => {
    const data = repoSourceId ? await deepWikiApi.listRunsByRepo(repoSourceId) : await deepWikiApi.listRuns();
    setRuns(data);
    setSelectedRunId((prev) => {
      if (prev && data.some((r) => r.id === prev)) return prev;
      return data[0]?.id;
    });
    return data;
  }, []);

  const loadRunDetail = useCallback(async (runId: number) => {
    const detail = await deepWikiApi.getRun(runId);
    setRunDetail(detail);
    setSelectedPage((current) => detail.pages.find((item) => item.id === current?.id) || detail.pages[0] || null);
    return detail;
  }, []);

  const loadProviderSettings = useCallback(async () => {
    const data = await settingsApi.get();
    setProviderSettingsMasked(String(data.deepwiki_weelinking_api_key || ''));
    providerSettingsForm.setFieldsValue({
      deepwiki_default_provider: data.deepwiki_default_provider || 'qwen_dashscope_native',
      deepwiki_default_model: data.deepwiki_default_model || '',
      deepwiki_qwen_enabled: data.deepwiki_qwen_enabled !== false,
      deepwiki_weelinking_enabled: Boolean(data.deepwiki_weelinking_enabled),
      deepwiki_qwen_default_model: data.deepwiki_qwen_default_model || 'qwen-deep-research',
      deepwiki_weelinking_default_model: data.deepwiki_weelinking_default_model || 'deep-research',
      deepwiki_weelinking_base_url: data.deepwiki_weelinking_base_url || 'https://api.weelinking.com',
      deepwiki_weelinking_wire_mode: data.deepwiki_weelinking_wire_mode || 'openai_responses_compatible',
      deepwiki_weelinking_api_key: '',
    });
  }, [providerSettingsForm]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [{ defaultProvider }, repoRows, projectRows] = await Promise.all([
          loadProviders(),
          loadRepos(),
          loadProjects(),
          loadProviderSettings(),
        ]);
        await loadModels(defaultProvider);
        const targetProjectId = initialProjectId ?? selectedProjectId ?? projectRows[0]?.id;
        if (targetProjectId) {
          await loadProjectWorkspace(targetProjectId, selectedBranchName);
        }
        const targetRepoSourceId = selectedRepoSourceId || repoRows[0]?.id;
        await loadRuns(targetRepoSourceId);
      } finally {
        setLoading(false);
      }
    };
    void load();
    // 勿将 selectedProjectId / selectedBranchName 放入依赖：否则每次选仓库、选 run 都会整页重拉，
    // loadProjectWorkspace 会再次用 snapshot.run_id 覆盖当前仓库/run，表现为「切不了仓库」与请求风暴。
  }, [
    initialProjectId,
    loadModels,
    loadProjectWorkspace,
    loadProjects,
    loadProviderSettings,
    loadProviders,
    loadRepos,
    loadRuns,
  ]);

  useEffect(() => {
    if (!selectedRepoSourceId) return;
    setRepoExplorerBranchFilter(null);
    void loadRuns(selectedRepoSourceId).then((data) => {
      setSelectedRunId((prev) => {
        if (prev && data.find((item) => item.id === prev)) return prev;
        return data[0]?.id;
      });
    });
  }, [loadRuns, selectedRepoSourceId]);

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadProjectWorkspace(selectedProjectId, selectedBranchName || undefined);
  }, [loadProjectWorkspace, selectedBranchName, selectedProjectId]);

  useEffect(() => {
    if (!selectedRunId) return;
    void loadRunDetail(selectedRunId);
  }, [loadRunDetail, selectedRunId]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunGraph(null);
      return;
    }
    const load = async () => {
      try {
        setGraphLoading(true);
        const graph = await deepWikiApi.getRunGraph(selectedRunId);
        setRunGraph(graph);
      } catch {
        setRunGraph(null);
      } finally {
        setGraphLoading(false);
      }
    };
    void load();
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedSnapshotId) {
      setSnapshotRepoRevisions([]);
      setSnapshotQuality(null);
      setSnapshotObjects([]);
      setSnapshotFlows([]);
      setSnapshotAssertions([]);
      setSnapshotScenarios([]);
      setSnapshotSemanticScores([]);
      setSnapshotConsistencyChecks([]);
      return;
    }
    const snapshot = projectSnapshots.find((item) => item.id === selectedSnapshotId) || null;
    setSelectedSnapshot(snapshot);
    const load = async () => {
      try {
        const [revisions, quality, objects, flows, assertions, scenarios, scores, consistency] = await Promise.all([
          deepWikiApi.listSnapshotRepoRevisions(selectedSnapshotId),
          deepWikiApi.getSnapshotQualityReport(selectedSnapshotId).catch(() => null),
          deepWikiApi.listSnapshotObjects(
            selectedSnapshotId,
            snapshotObjectTypeFilter !== 'all' ? snapshotObjectTypeFilter : undefined
          ).catch(() => []),
          deepWikiApi.listSnapshotFlows(selectedSnapshotId).catch(() => []),
          deepWikiApi.listSnapshotAssertions(selectedSnapshotId).catch(() => []),
          deepWikiApi.listSnapshotScenarios(selectedSnapshotId).catch(() => []),
          deepWikiApi.listSnapshotSemanticScores(selectedSnapshotId).catch(() => []),
          deepWikiApi.listSnapshotConsistencyChecks(selectedSnapshotId).catch(() => []),
        ]);
        setSnapshotRepoRevisions(revisions);
        setSnapshotQuality(quality);
        setSnapshotObjects(objects);
        setSnapshotFlows(flows);
        setSnapshotAssertions(assertions);
        setSnapshotScenarios(scenarios);
        setSnapshotSemanticScores(scores);
        setSnapshotConsistencyChecks(consistency);
      } catch {
        setSnapshotRepoRevisions([]);
        setSnapshotQuality(null);
        setSnapshotObjects([]);
        setSnapshotFlows([]);
        setSnapshotAssertions([]);
        setSnapshotScenarios([]);
        setSnapshotSemanticScores([]);
        setSnapshotConsistencyChecks([]);
      }
    };
    void load();
  }, [projectSnapshots, selectedSnapshotId, snapshotObjectTypeFilter]);

  const reloadWikiFeedbackEvents = useCallback(async () => {
    if (!selectedProjectId) {
      setWikiFeedbackEvents([]);
      return;
    }
    setWikiFeedbackLoading(true);
    try {
      const rows = await deepWikiApi.listFeedbackEvents(
        selectedProjectId,
        selectedSnapshotId ? { snapshot_id: selectedSnapshotId } : undefined
      );
      setWikiFeedbackEvents(rows);
    } catch {
      setWikiFeedbackEvents([]);
    } finally {
      setWikiFeedbackLoading(false);
    }
  }, [selectedProjectId, selectedSnapshotId]);

  useEffect(() => {
    void reloadWikiFeedbackEvents();
  }, [reloadWikiFeedbackEvents]);

  useEffect(() => {
    if (!selectedRepoSourceId) {
      setRepoBranches(null);
      return;
    }
    const load = async () => {
      try {
        const data = await deepWikiApi.getRepoBranches(selectedRepoSourceId);
        setRepoBranches(data);
      } catch {
        setRepoBranches(null);
      }
    };
    void load();
  }, [selectedRepoSourceId]);

  useEffect(() => {
    if (!runDetail?.id || !selectedPage?.id) {
      setPageContent('');
      return;
    }
    const load = async () => {
      try {
        const data = await deepWikiApi.getPageContent(runDetail.id, selectedPage.id);
        setPageContent(data.content || '');
      } catch {
        setPageContent('');
      }
    };
    void load();
  }, [runDetail?.id, selectedPage?.id]);

  useEffect(() => {
    if (!runDetail?.id || !['queued', 'running'].includes(runDetail.status)) return;
    const timer = window.setTimeout(async () => {
      await loadRuns(runDetail.repo_source_id);
      const detail = await loadRunDetail(runDetail.id);
      setSelectedPage((current) => detail.pages.find((item) => item.id === current?.id) || detail.pages[0] || null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [loadRunDetail, loadRuns, runDetail]);

  useEffect(() => {
    const repoSource = getRecordObject(runDetail?.repo_source);
    const metadata = getRecordObject(repoSource.metadata_json);
    const sync = getRecordObject(metadata.sync);
    syncForm.setFieldsValue({
      enabled: Boolean(sync.enabled),
      branch: String(sync.branch || runDetail?.branch || repoSource.default_branch || ''),
      interval_minutes: Number(sync.interval_minutes || 30),
      webhook_secret: String(sync.webhook_secret || ''),
      auto_ingest: sync.auto_ingest !== false,
      focus_prompt: String(sync.focus_prompt || runDetail?.summary_json?.focus_prompt || ''),
      project_code: String(sync.project_code || runDetail?.project_code || ''),
      research_provider: String(sync.research_provider || runDetail?.research_provider || runDetail?.summary_json?.research_provider || ''),
      research_model: String(sync.research_model || runDetail?.research_model || runDetail?.summary_json?.research_model || ''),
      output_profile: String(sync.output_profile || runDetail?.output_profile || runDetail?.summary_json?.output_profile || 'engineering_architecture_pack'),
      diagram_profile: String(sync.diagram_profile || runDetail?.diagram_profile || runDetail?.summary_json?.diagram_profile || 'full'),
    });
  }, [runDetail, syncForm]);

  const selectedProject = useMemo(
    () => projects.find((item) => item.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  /** 项目绑定仓库变化时重拉各仓分支列表，避免快速切换项目串数据 */
  const projectRepoBranchLoadKey = useMemo(() => {
    const p = projects.find((item) => item.id === selectedProjectId);
    if (!p?.repos?.length) return '';
    return [
      String(p.id),
      ...p.repos
        .map((r) => `${r.id}:${r.repo_source_id ?? r.repo_source?.id ?? 0}`)
        .sort(),
    ].join('|');
  }, [projects, selectedProjectId]);

  useEffect(() => {
    let cancelled = false;
    const project = projects.find((item) => item.id === selectedProjectId);
    if (!projectRepoBranchLoadKey || !project?.repos?.length) {
      setRepoBranchOptionsBySourceId({});
      setProjectRepoBranchesLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const sourceIds = Array.from(
      new Set(
        project.repos
          .map((r) => Number(r.repo_source_id ?? r.repo_source?.id ?? 0))
          .filter((id) => Number.isFinite(id) && id > 0)
      )
    );
    setProjectRepoBranchesLoading(true);
    void (async () => {
      const next: Record<number, string[]> = {};
      await Promise.all(
        sourceIds.map(async (sid) => {
          const repoRow = project.repos!.find(
            (r) => Number(r.repo_source_id ?? r.repo_source?.id ?? 0) === sid
          );
          try {
            const res = await deepWikiApi.getRepoBranches(sid);
            const branches = new Set<string>();
            getStringArray(res.available_branches).forEach((b) => branches.add(String(b)));
            if (res.default_branch) branches.add(String(res.default_branch));
            const metaDefault = repoRow?.repo_source?.default_branch;
            if (metaDefault) branches.add(String(metaDefault));
            next[sid] = Array.from(branches).sort((a, b) => a.localeCompare(b));
          } catch {
            next[sid] = [];
          }
        })
      );
      if (!cancelled) {
        setRepoBranchOptionsBySourceId(next);
        setProjectRepoBranchesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectRepoBranchLoadKey, projects, selectedProjectId]);

  useEffect(() => {
    if (selectedProject?.project_code) {
      setProjectCode(String(selectedProject.project_code));
    }
  }, [selectedProject?.project_code, setProjectCode]);

  const selectedBranch = useMemo(
    () => projectBranches.find((item) => item.branch === selectedBranchName) || null,
    [projectBranches, selectedBranchName]
  );

  useEffect(() => {
    if (!selectedBranch || !selectedProject?.repos?.length) {
      setBranchMappingDraft({});
      return;
    }
    const nextDraft: Record<number, string> = {};
    selectedProject.repos.forEach((repo) => {
      const mapping = selectedBranch.repo_mappings?.find((item) => Number(item.project_repo_id) === Number(repo.id));
      nextDraft[repo.id] =
        String(
          mapping?.repo_branch_name ||
          repo.metadata_json?.default_branch ||
          repo.repo_source?.default_branch ||
          selectedBranch.branch ||
          ''
        ).trim() || selectedBranch.branch;
    });
    setBranchMappingDraft(nextDraft);
  }, [selectedBranch, selectedProject?.repos]);

  const runColumns: ColumnsType<DeepWikiRunRow> = useMemo(
    () => [
      { title: '仓库', dataIndex: 'repo_slug', key: 'repo_slug', width: 170, ellipsis: true },
      { title: '分支', dataIndex: 'branch', key: 'branch', width: 120, ellipsis: true },
      {
        title: '状态',
        dataIndex: 'runtime_result',
        key: 'runtime_result',
        width: 100,
        render: (_value: string, record) => statusTag(record.runtime_result || record.status),
      },
      { title: '阶段', dataIndex: 'current_stage', key: 'current_stage', width: 150, ellipsis: true },
      { title: '页数', dataIndex: 'page_count', key: 'page_count', width: 70 },
      { title: '更新时间', dataIndex: 'updated_at', key: 'updated_at', width: 180 },
    ],
    []
  );

  const runSummary = useMemo(() => {
    const summary = getRecordObject(runDetail?.summary_json);
    const preflight = getRecordObject(summary.preflight);
    const inventory = getRecordObject(summary.inventory);
    const logs = Array.isArray(summary.logs) ? summary.logs : [];
    const stageProgress = getRecordObject(summary.stage_progress);
    const repoSource = getRecordObject(runDetail?.repo_source);
    const metadata = getRecordObject(repoSource.metadata_json);
    const sync = getRecordObject(metadata.sync);
    const runtimeResult = String(runDetail?.runtime_result || summary.runtime_result || runDetail?.status || 'queued');
    const progressPercent = getNumberValue(summary.progress_percent, runtimeResult === 'completed' ? 100 : 0);
    const elapsedSeconds = getNumberValue(summary.elapsed_seconds, 0);
    const estimatedRemainingSeconds =
      summary.estimated_remaining_seconds == null ? null : getNumberValue(summary.estimated_remaining_seconds, 0);
    const queuePosition =
      runDetail?.queue_position == null ? (summary.queue_position == null ? null : getNumberValue(summary.queue_position, 0)) : runDetail.queue_position;
    const currentStageMeta = getRecordObject(stageProgress[runDetail?.current_stage || '']);
    const evidenceCoverage = getRecordObject(runDetail?.evidence_coverage);
    const objectCounts = getRecordObject(runDetail?.object_counts);
    const relationCounts = getRecordObject(runDetail?.relation_counts);

    return {
      preflight,
      inventory,
      logs: logs.slice().reverse() as Array<Record<string, unknown>>,
      stageProgress,
      sync,
      runtimeResult,
      progressPercent,
      elapsedSeconds,
      estimatedRemainingSeconds,
      queuePosition,
      heartbeatAt: String(summary.heartbeat_at || ''),
      stalled: Boolean(summary.stalled) || runtimeResult === 'stalled',
      currentStageMeta,
      defaultBranch: String(repoSource.default_branch || preflight.default_branch || '-'),
      repoUrl: String(repoSource.repo_url || runDetail?.repo_url || '-'),
      outputRoot: String(runDetail?.output_root || '-'),
      researchProvider: String(runDetail?.research_provider || summary.research_provider || '-'),
      researchModel: String(runDetail?.research_model || summary.research_model || '-'),
      outputProfile: String(runDetail?.output_profile || summary.output_profile || 'engineering_architecture_pack'),
      diagramProfile: String(runDetail?.diagram_profile || summary.diagram_profile || 'full'),
      diagramCount: getNumberValue(runDetail?.diagram_count ?? getRecordObject(summary.manifest).diagram_count, 0),
      objectCounts,
      relationCounts,
      evidenceCoveragePercent: getNumberValue(evidenceCoverage.percent, 0),
      structuredObjectCount: Object.values(objectCounts).reduce<number>((sum, value) => sum + getNumberValue(value, 0), 0),
      webhookUrl: `${window.location.origin}/api/v1/deepwiki/webhook/git`,
    };
  }, [runDetail]);

  const wikiTree = useMemo(() => buildWikiTreeData(runDetail?.pages || []), [runDetail?.pages]);
  const filteredWikiTree = useMemo(() => filterWikiTreeData(wikiTree, treeQuery), [treeQuery, wikiTree]);
  const selectedTreeKeys = selectedPage ? [`page:${selectedPage.id}`] : [];
  const selectedPageMeta = useMemo(() => getRecordObject(selectedPage?.metadata_json), [selectedPage?.metadata_json]);
  const selectedPageSourceFiles = useMemo(() => getStringArray(selectedPageMeta.source_files), [selectedPageMeta]);
  const snapshotObjectTypeOptions = useMemo(
    () => ['all', 'project', 'domain', 'feature', 'frontend_page', 'api', 'service', 'table', 'state_machine', 'test_asset', 'runbook', 'decision'],
    []
  );
  const moduleCount = Array.isArray(runSummary.inventory.modules) ? runSummary.inventory.modules.length : 0;
  const readableFileCount = Number(runSummary.inventory.readable_files || 0);
  const relatedDocBundles = useMemo(() => runDetail?.doc_bundles || [], [runDetail?.doc_bundles]);
  const projectRepoOptions = useMemo(
    () =>
      repos.map((item) => ({
        value: item.id,
        label: item.repo_slug || item.repo_url || `repo-${item.id}`,
      })),
    [repos]
  );

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    try {
      setActionLoading(true);
      const created = await deepWikiApi.createRun(values);
      message.success(`Deep Wiki 任务已创建：${created.trace_id}`);
      setCreateVisible(false);
      createForm.resetFields();
      await loadRepos();
      await loadRuns(selectedRepoSourceId);
      setSelectedRunId(created.run_id);
      setSelectedRepoSourceId(created.run.repo_source_id);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '创建任务失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateProject = async () => {
    const values = await projectCreateForm.validateFields();
    const repoBindings = Array.isArray(values.repo_bindings)
      ? values.repo_bindings
          .map((item, index) => ({
            repo_source_id: Number(item?.repo_source_id),
            repo_role: String(item?.repo_role || 'service'),
            branch: String(item?.branch || '').trim(),
            is_primary: Boolean(item?.is_primary) || index === 0,
          }))
          .filter((item) => Number.isFinite(item.repo_source_id) && item.repo_source_id > 0)
      : [];
    if (!repoBindings.length) {
      message.error('请至少绑定一个仓库，并指定其项目角色');
      return;
    }
    try {
      setActionLoading(true);
      const created = await deepWikiApi.createProject({
        project_name: String(values.project_name || '').trim(),
        project_code: String(values.project_code || '').trim(),
        default_branch: String(values.default_branch || '').trim() || undefined,
        mission: String(values.mission || '').trim() || undefined,
        repo_bindings: repoBindings,
      });
      message.success(`项目已创建：${created.project_name}`);
      setProjectCreateVisible(false);
      projectCreateForm.resetFields();
      projectCreateForm.setFieldsValue({
        default_branch: 'main',
        repo_bindings: [{ repo_role: 'frontend', is_primary: true }],
      });
      await loadProjects();
      setSelectedProjectId(created.id);
      const nextBranch = String(created.default_branch || repoBindings[0]?.branch || '').trim() || undefined;
      setSelectedBranchName(nextBranch);
      await loadProjectWorkspace(created.id, nextBranch);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '创建项目失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRetry = async () => {
    if (!runDetail) return;
    try {
      setActionLoading(true);
      const updated = await deepWikiApi.retryRun(runDetail.id);
      setRunDetail(updated);
      message.success('已重新排队生成 Deep Wiki');
      await loadRepos();
      await loadRuns(runDetail.repo_source_id);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '重新生成失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReingest = async () => {
    if (!runDetail) return;
    try {
      setActionLoading(true);
      const updated = await deepWikiApi.reingestRun(runDetail.id);
      setRunDetail(updated);
      message.success('已重新触发 RAG 入库');
      await loadRepos();
      await loadRuns(runDetail.repo_source_id);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '重新入库失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSyncNow = async () => {
    if (!runDetail) return;
    const values = await syncForm.validateFields();
    try {
      setActionLoading(true);
      const response = await deepWikiApi.syncRun({
        repo_url: runSummary.repoUrl,
        branch: values.branch || '',
        project_code: values.project_code || runDetail.project_code || undefined,
        focus_prompt: values.focus_prompt || String(runDetail.summary_json?.focus_prompt || ''),
        research_provider: values.research_provider || undefined,
        research_model: values.research_model || undefined,
        output_profile: values.output_profile || undefined,
        diagram_profile: values.diagram_profile || undefined,
      });
      if (response.noop) {
        message.info('仓库当前提交与最新 Deep Wiki 一致，未重复生成');
      } else {
        message.success(`已发起同步生成：${response.trace_id}`);
      }
      await loadRepos();
      await loadRuns(runDetail.repo_source_id);
      setSelectedRunId(response.run_id);
      setSelectedRepoSourceId(response.run.repo_source_id);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '同步更新失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveSyncConfig = async () => {
    if (!runDetail) return;
    const values = await syncForm.validateFields();
    try {
      setActionLoading(true);
      await deepWikiApi.updateSyncConfig(runDetail.repo_source_id, values);
      message.success('自动同步配置已保存');
      await loadRunDetail(runDetail.id);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '保存同步配置失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveProviderSettings = async () => {
    const values = await providerSettingsForm.validateFields();
    try {
      setActionLoading(true);
      await settingsApi.update({
        ...values,
        deepwiki_weelinking_api_key: String(values.deepwiki_weelinking_api_key || '').trim(),
      });
      await Promise.all([
        loadProviderSettings(),
        loadProviders(),
      ]);
      const currentProvider = String(createForm.getFieldValue('research_provider') || '').trim();
      await loadModels(currentProvider);
      message.success('Deep Wiki Provider 配置已保存');
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '保存 Provider 配置失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateDocBundle = async (workflowMode?: 'upload_existing' | 'generate_tech_spec') => {
    if (!runDetail) return;
    const repoSlug = String(runDetail.repo_slug || '');
    const nextWorkflowMode =
      workflowMode ||
      (repoSlug.includes('aiplan-erp-platform') ? 'upload_existing' : 'generate_tech_spec');
    try {
      setActionLoading(true);
      const response = await deepWikiApi.createDocBundle(runDetail.id, {
        project_code:
          String(syncForm.getFieldValue('project_code') || runDetail.project_code || '').trim() || undefined,
        workflow_mode: nextWorkflowMode,
        create_prd_artifact: nextWorkflowMode === 'generate_tech_spec',
      });
      message.success(`已创建文档任务：${response.bundle.bundle_code}`);
      await loadRunDetail(runDetail.id);
      onOpenDocBundle?.(response.bundle.id);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '创建文档任务失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRegenerateProject = async () => {
    if (!selectedProjectId) return;
    try {
      setActionLoading(true);
      const reposPayload =
        selectedProject?.repos?.flatMap((repo) => {
          const repoSourceId = Number(repo.repo_source_id ?? repo.repo_source?.id ?? 0);
          if (!Number.isFinite(repoSourceId) || repoSourceId <= 0) return [];
          const mapping = selectedBranch?.repo_mappings?.find(
            (m) => Number(m.project_repo_id) === Number(repo.id)
          );
          const branchName =
            String(branchMappingDraft[repo.id] || '').trim() ||
            String(mapping?.repo_branch_name || '').trim() ||
            String(selectedBranchName || '').trim();
          const entry: { repo_source_id: number; branch?: string } = { repo_source_id: repoSourceId };
          if (branchName) entry.branch = branchName;
          return [entry];
        }) ?? [];
      const response = await deepWikiApi.regenerateProject(selectedProjectId, {
        branch: selectedBranchName,
        focus_prompt: String(syncForm.getFieldValue('focus_prompt') || ''),
        research_provider: String(syncForm.getFieldValue('research_provider') || '') || undefined,
        research_model: String(syncForm.getFieldValue('research_model') || '') || undefined,
        output_profile: String(syncForm.getFieldValue('output_profile') || '') || undefined,
        diagram_profile: String(syncForm.getFieldValue('diagram_profile') || '') || undefined,
        ...(reposPayload.length ? { repos: reposPayload } : {}),
      });
      message.success(`已创建项目级生成任务：${response.trace_id}`);
      setSelectedRunId(response.run_id);
      await Promise.all([
        loadProjects(),
        loadProjectWorkspace(selectedProjectId, selectedBranchName),
      ]);
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '项目级重新生成失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddRepoToProject = async (values: {
    mode: 'existing' | 'url';
    repo_source_id?: number;
    repo_url?: string;
    repo_role: string;
    branch?: string;
    is_primary?: boolean;
  }): Promise<boolean> => {
    if (!selectedProjectId) return false;
    try {
      setActionLoading(true);
      let payload: DeepWikiAddRepoToProjectRequest;
      if (values.mode === 'existing') {
        const id = Number(values.repo_source_id);
        if (!Number.isFinite(id) || id <= 0) {
          message.error('请选择已登记的仓库');
          return false;
        }
        payload = {
          repo_source_id: id,
          repo_role: values.repo_role,
          branch: String(values.branch || '').trim() || undefined,
          is_primary: values.is_primary,
        };
      } else {
        const url = String(values.repo_url || '').trim();
        if (!url) {
          message.error('请输入仓库 clone URL');
          return false;
        }
        payload = {
          repo_url: url,
          repo_role: values.repo_role,
          branch: String(values.branch || '').trim() || undefined,
          is_primary: values.is_primary,
        };
      }
      await deepWikiApi.addRepoToProject(selectedProjectId, payload);
      message.success('已绑定仓库');
      await loadRepos();
      await loadProjectWorkspace(selectedProjectId, selectedBranchName);
      return true;
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '绑定仓库失败';
      message.error(msg);
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const handleBootstrapProjects = async () => {
    try {
      setActionLoading(true);
      const result = await deepWikiApi.bootstrapProjects({
        force_projection: true,
      });
      message.success(`项目级数据初始化完成，处理 ${Number(result.processed_runs || 0)} 条 run`);
      const nextProjects = await loadProjects();
      const nextProjectId = selectedProjectId || Number(nextProjects[0]?.id || 0) || undefined;
      if (nextProjectId) {
        setSelectedProjectId(nextProjectId);
        await loadProjectWorkspace(nextProjectId, selectedBranchName);
      }
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '初始化项目级数据失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleSaveBranchMappings = async () => {
    if (!selectedBranch?.id || !selectedProject?.repos?.length) return;
    try {
      setActionLoading(true);
      await deepWikiApi.updateBranchRepoMapping(selectedBranch.id, {
        mappings: selectedProject.repos.map((repo) => ({
          project_repo_id: Number(repo.id),
          repo_branch_name: String(branchMappingDraft[repo.id] || selectedBranch.branch || '').trim() || selectedBranch.branch,
          metadata_json: {
            repo_role: repo.repo_role,
          },
        })),
      });
      message.success('分支逐仓映射已保存');
      if (selectedProjectId) {
        await loadProjectWorkspace(selectedProjectId, selectedBranchName);
      }
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '保存分支映射失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const selectedRepo = useMemo(
    () => repos.find((item) => item.id === selectedRepoSourceId) || null,
    [repos, selectedRepoSourceId]
  );

  const availableBranches = useMemo(
    () =>
      getStringArray(repoBranches?.available_branches).length
        ? getStringArray(repoBranches?.available_branches)
        : getStringArray(selectedRepo?.available_branches),
    [repoBranches?.available_branches, selectedRepo?.available_branches]
  );

  const displayedRuns = useMemo(() => {
    if (repoExplorerBranchFilter === null) return runs;
    const target = repoExplorerBranchFilter.trim();
    return runs.filter((r) => String(r.branch || '').trim() === target);
  }, [runs, repoExplorerBranchFilter]);

  const handleRepoExplorerBranchChange = useCallback(
    (value: string) => {
      if (value === '__all__') {
        setRepoExplorerBranchFilter(null);
        setSelectedPage(null);
        setSelectedRunId(runs[0]?.id);
        return;
      }
      syncForm.setFieldValue('branch', value);
      setRepoExplorerBranchFilter(value);
      setSelectedPage(null);
      const matching = runs
        .filter((r) => String(r.branch || '').trim() === value.trim())
        .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
      setSelectedRunId(matching[0]?.id);
    },
    [runs, syncForm]
  );

  return {
    actionLoading,
    availableBranches,
    branchMappingDraft,
    displayedRuns,
    handleRepoExplorerBranchChange,
    repoExplorerBranchFilter,
    createForm,
    createVisible,
    filteredWikiTree,
    graphLoading,
    handleBootstrapProjects,
    handleCreate,
    handleCreateDocBundle,
    handleCreateProject,
    handleAddRepoToProject,
    handleRegenerateProject,
    handleReingest,
    handleRetry,
    handleSaveBranchMappings,
    handleSaveProviderSettings,
    handleSaveSyncConfig,
    handleSyncNow,
    loadModels,
    loadProjectWorkspace,
    loadProjects,
    loadProviderSettings,
    loadProviders,
    loadRepos,
    loadRunDetail,
    loadRuns,
    loading,
    models,
    moduleCount,
    onOpenDocBundle,
    onOpenKnowledge,
    onOpenRuntimeTrace,
    pageContent,
    projectBranches,
    projectCreateForm,
    projectCreateVisible,
    projectRepoOptions,
    projectSnapshots,
    projects,
    providerSettingsForm,
    providerSettingsMasked,
    providers,
    readableFileCount,
    relatedDocBundles,
    repoBranches,
    repos,
    runColumns,
    runDetail,
    runGraph,
    runSummary,
    runs,
    selectedBranch,
    selectedBranchName,
    selectedPage,
    selectedPageMeta,
    selectedPageSourceFiles,
    selectedProject,
    selectedProjectId,
    selectedRepo,
    selectedRepoSourceId,
    selectedRunId,
    selectedSnapshot,
    selectedSnapshotId,
    selectedTreeKeys,
    setActionLoading,
    setBranchMappingDraft,
    setCreateVisible,
    setLoading,
    setModels,
    setPageContent,
    setProjectBranches,
    setProjectCode,
    setProjectCreateVisible,
    setProjectSnapshots,
    setProjects,
    setProviderSettingsMasked,
    setProviders,
    setRepoBranches,
    setRepos,
    setRunDetail,
    setRunGraph,
    setRuns,
    setSelectedBranchName,
    setSelectedPage,
    setSelectedProjectId,
    setSelectedRepoSourceId,
    setSelectedRunId,
    setSelectedSnapshot,
    setSelectedSnapshotId,
    setSnapshotAssertions,
    setSnapshotFlows,
    setSnapshotObjectTypeFilter,
    setSnapshotObjects,
    setSnapshotQuality,
    setSnapshotRepoRevisions,
    setSnapshotScenarios,
    setSnapshotSemanticScores,
    setSnapshotConsistencyChecks,
    setSnapshotView,
    setTreeQuery,
    setWikiFeedbackEvents,
    setWikiFeedbackLoading,
    reloadWikiFeedbackEvents,
    projectRepoBranchesLoading,
    repoBranchOptionsBySourceId,
    snapshotAssertions,
    snapshotConsistencyChecks,
    snapshotFlows,
    snapshotObjectTypeFilter,
    snapshotObjectTypeOptions,
    snapshotObjects,
    snapshotQuality,
    snapshotRepoRevisions,
    snapshotScenarios,
    snapshotSemanticScores,
    snapshotView,
    syncForm,
    treeQuery,
    wikiFeedbackEvents,
    wikiFeedbackLoading,
    wikiTree,
  };
}

export type DeepWikiWorkspaceModel = ReturnType<typeof useDeepWikiWorkspace>;
