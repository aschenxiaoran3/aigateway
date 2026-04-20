import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined, StopOutlined, ThunderboltOutlined } from '@ant-design/icons';
import {
  deepWikiApi,
  type DeepWikiActiveRun,
  type DeepWikiErrorSummary,
  type DeepWikiProject,
  type DeepWikiProjectErrors,
  type DeepWikiProjectTrends,
  type DeepWikiRunTimeline,
  type DeepWikiStageTrend,
  type DeepWikiTimelineNode,
} from '../services/api';

const { Text } = Typography;

function statusColor(value?: string | null) {
  if (!value) return 'default';
  if (value === 'completed' || value === 'approved') return 'success';
  if (value === 'failed' || value === 'blocked' || value === 'aborted') return 'error';
  if (value === 'running') return 'processing';
  if (value === 'queued' || value === 'pending' || value === 'retrying') return 'warning';
  return 'default';
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)} s`;
  const min = sec / 60;
  if (min < 60) return `${min.toFixed(1)} min`;
  return `${(min / 60).toFixed(1)} h`;
}

const DeepWikiHealthPanel: React.FC = () => {
  const [projects, setProjects] = useState<DeepWikiProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [active, setActive] = useState<DeepWikiActiveRun[]>([]);
  const [timeline, setTimeline] = useState<DeepWikiRunTimeline | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [trends, setTrends] = useState<DeepWikiProjectTrends | null>(null);
  const [errors, setErrors] = useState<DeepWikiProjectErrors | null>(null);
  const [trendLimit, setTrendLimit] = useState<number>(20);
  const [loading, setLoading] = useState(false);

  const loadProjects = async () => {
    try {
      const list = await deepWikiApi.listProjects();
      setProjects(list);
      if (list.length && selectedProjectId == null) {
        setSelectedProjectId(list[0].id);
      }
    } catch (e) {
      console.error(e);
      message.error('加载 DeepWiki 项目列表失败');
    }
  };

  const loadActive = async () => {
    try {
      const list = await deepWikiApi.listActiveRuns();
      setActive(list);
      if (list.length && selectedRunId == null) {
        setSelectedRunId(list[0].run_id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const loadTimeline = async (runId: number | null) => {
    if (!runId) {
      setTimeline(null);
      return;
    }
    try {
      const data = await deepWikiApi.getRunTimeline(runId);
      setTimeline(data);
    } catch (e) {
      console.error(e);
      message.error('加载 run timeline 失败');
    }
  };

  const loadProjectHealth = async (projectId: number | null, limit: number) => {
    if (!projectId) {
      setTrends(null);
      setErrors(null);
      return;
    }
    try {
      const [t, e] = await Promise.all([
        deepWikiApi.getProjectTrends(projectId, limit),
        deepWikiApi.getProjectErrors(projectId, limit),
      ]);
      setTrends(t);
      setErrors(e);
    } catch (err) {
      console.error(err);
      message.error('加载 DeepWiki 项目健康数据失败');
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadProjects(),
        loadActive(),
        loadTimeline(selectedRunId),
        loadProjectHealth(selectedProjectId, trendLimit),
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshAll();
    const t = setInterval(() => {
      void loadActive();
      if (selectedRunId) void loadTimeline(selectedRunId);
    }, 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    void loadTimeline(selectedRunId);
  }, [selectedRunId]);

  useEffect(() => {
    void loadProjectHealth(selectedProjectId, trendLimit);
  }, [selectedProjectId, trendLimit]);

  const handleAbort = async (runId: number | null) => {
    if (!runId) return;
    try {
      await deepWikiApi.abortRun(runId);
      message.success(`已向 run #${runId} 发送中止指令`);
      await loadActive();
      await loadTimeline(runId);
    } catch (e) {
      console.error(e);
      message.error('中止 run 失败');
    }
  };

  const handleRetry = async (runId: number | null) => {
    if (!runId) return;
    try {
      await deepWikiApi.retryRun(runId);
      message.success(`已向 run #${runId} 触发重试`);
      await loadActive();
    } catch (e) {
      console.error(e);
      message.error('重试 run 失败');
    }
  };

  const stats = useMemo(() => {
    const total = active.length;
    const running = active.filter((r) => r.status === 'running').length;
    const queued = active.filter((r) => r.status === 'queued' || r.status === 'pending').length;
    return { total, running, queued };
  }, [active]);

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="DeepWiki 任务健康面板"
        extra={
          <Space>
            <Select
              style={{ width: 280 }}
              placeholder="选择项目"
              value={selectedProjectId ?? undefined}
              onChange={(value) => setSelectedProjectId(value)}
              options={projects.map((p) => ({ label: `${p.project_code || ''} · ${p.project_name || p.project_code || '—'}`, value: p.id }))}
            />
            <InputNumber
              min={1}
              max={50}
              value={trendLimit}
              onChange={(value) => setTrendLimit(Number(value || 20))}
              addonBefore="样本 run"
            />
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refreshAll()}>
              刷新
            </Button>
          </Space>
        }
      >
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={6}>
            <Card size="small"><Statistic title="活跃任务" value={stats.total} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="运行中" value={stats.running} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="排队中" value={stats.queued} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="采样 run 数" value={trends?.run_sample || 0} /></Card>
          </Col>
        </Row>

        <Tabs
          defaultActiveKey="active"
          items={[
            {
              key: 'active',
              label: '活跃任务',
              children: (
                <Table<DeepWikiActiveRun>
                  size="small"
                  rowKey={(row) => String(row.run_id ?? row.pipeline_run_id ?? Math.random())}
                  dataSource={active}
                  locale={{ emptyText: <Empty description="当前没有活跃任务" /> }}
                  onRow={(row) => ({
                    onClick: () => row.run_id != null && setSelectedRunId(row.run_id),
                    style: {
                      cursor: 'pointer',
                      background: row.run_id === selectedRunId ? '#e6f7ff' : undefined,
                    },
                  })}
                  columns={[
                    { title: 'run_id', dataIndex: 'run_id', width: 100 },
                    { title: 'project', dataIndex: 'project_code', width: 140 },
                    { title: 'branch', dataIndex: 'branch', width: 200, ellipsis: true },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 120,
                      render: (v) => <Tag color={statusColor(v)}>{v || '—'}</Tag>,
                    },
                    { title: 'started_at', dataIndex: 'started_at', width: 200 },
                    { title: 'updated_at', dataIndex: 'updated_at', width: 200 },
                    {
                      title: '操作',
                      key: 'op',
                      width: 200,
                      render: (_, row) => (
                        <Space>
                          <Button size="small" icon={<ThunderboltOutlined />} onClick={(e) => { e.stopPropagation(); void handleRetry(row.run_id); }}>
                            重试
                          </Button>
                          <Button size="small" danger icon={<StopOutlined />} onClick={(e) => { e.stopPropagation(); void handleAbort(row.run_id); }}>
                            中止
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'timeline',
              label: 'Stage 时间线',
              children: (
                <>
                  {timeline ? (
                    <>
                      <Row gutter={16} style={{ marginBottom: 12 }}>
                        <Col span={6}>
                          <Statistic title="run 状态" value={timeline.run_status || '—'} />
                        </Col>
                        <Col span={6}>
                          <Statistic title="总耗时" value={formatDuration(timeline.total_duration_ms)} />
                        </Col>
                        <Col span={6}>
                          <Statistic title="已完成" value={`${timeline.stats.completed}/${timeline.stats.total}`} />
                        </Col>
                        <Col span={6}>
                          <Statistic title="失败" value={timeline.stats.failed} valueStyle={{ color: timeline.stats.failed > 0 ? '#cf1322' : undefined }} />
                        </Col>
                      </Row>
                      <Table<DeepWikiTimelineNode>
                        size="small"
                        rowKey={(row) => String(row.node_id ?? row.node_key ?? Math.random())}
                        dataSource={timeline.timeline}
                        locale={{ emptyText: <Empty description="无 stage 数据" /> }}
                        columns={[
                          { title: 'stage', dataIndex: 'node_key', width: 240 },
                          {
                            title: '状态',
                            dataIndex: 'status',
                            width: 120,
                            render: (v) => <Tag color={statusColor(v)}>{v || '—'}</Tag>,
                          },
                          { title: '耗时', dataIndex: 'duration_ms', width: 120, render: (v) => formatDuration(v) },
                          { title: '尝试次数', dataIndex: 'attempt', width: 90 },
                          {
                            title: '错误码',
                            dataIndex: 'error_code',
                            width: 220,
                            render: (v: string | null) => v ? <Tag color="error">{v}</Tag> : '—',
                          },
                          { title: 'started_at', dataIndex: 'started_at', width: 200 },
                          { title: 'finished_at', dataIndex: 'finished_at', width: 200 },
                        ]}
                      />
                    </>
                  ) : (
                    <Alert type="info" message="点击上方活跃任务行或选择一个 run 以查看 stage 时间线" />
                  )}
                </>
              ),
            },
            {
              key: 'trends',
              label: 'Stage 趋势',
              children: (
                <>
                  {!selectedProjectId ? (
                    <Alert type="info" message="请先选择一个 DeepWiki 项目" />
                  ) : (
                    <Table<DeepWikiStageTrend>
                      size="small"
                      rowKey={(row) => row.stage_key}
                      dataSource={trends?.trends || []}
                      locale={{ emptyText: <Empty description="暂无趋势数据" /> }}
                      columns={[
                        { title: 'stage', dataIndex: 'stage_key', width: 240 },
                        { title: '样本数', dataIndex: 'sample_size', width: 100 },
                        { title: 'p50', dataIndex: 'duration_p50_ms', width: 120, render: (v) => formatDuration(v) },
                        { title: 'p95', dataIndex: 'duration_p95_ms', width: 120, render: (v) => formatDuration(v) },
                        { title: '失败数', dataIndex: 'failure_count', width: 100 },
                        {
                          title: '失败率',
                          dataIndex: 'failure_ratio',
                          width: 120,
                          render: (v: number) => {
                            const pct = (v * 100).toFixed(1) + '%';
                            return v >= 0.3 ? <Tag color="error">{pct}</Tag> : v >= 0.1 ? <Tag color="warning">{pct}</Tag> : <Text>{pct}</Text>;
                          },
                        },
                        {
                          title: '错误分布',
                          dataIndex: 'error_counts',
                          render: (counts: Record<string, number>) => {
                            const entries = Object.entries(counts || {});
                            if (!entries.length) return '—';
                            return (
                              <Space wrap>
                                {entries.map(([code, n]) => (
                                  <Tooltip key={code} title={code}>
                                    <Tag color="error">{code} × {n}</Tag>
                                  </Tooltip>
                                ))}
                              </Space>
                            );
                          },
                        },
                      ]}
                    />
                  )}
                </>
              ),
            },
            {
              key: 'errors',
              label: '错误码聚合',
              children: (
                <>
                  {!selectedProjectId ? (
                    <Alert type="info" message="请先选择一个 DeepWiki 项目" />
                  ) : (
                    <Table<DeepWikiErrorSummary>
                      size="small"
                      rowKey={(row) => row.code}
                      dataSource={errors?.errors || []}
                      locale={{ emptyText: <Empty description="最近无失败记录" /> }}
                      columns={[
                        { title: '错误码', dataIndex: 'code', width: 240, render: (v) => <Tag color="error">{v}</Tag> },
                        { title: '发生次数', dataIndex: 'count', width: 120 },
                        { title: '最近一次', dataIndex: 'last_seen', width: 220 },
                        {
                          title: '分布到 stage',
                          dataIndex: 'stages',
                          render: (stages: Record<string, number>) => {
                            const entries = Object.entries(stages || {});
                            if (!entries.length) return '—';
                            return (
                              <Space wrap>
                                {entries.map(([stage, n]) => (
                                  <Tag key={stage}>{stage} × {n}</Tag>
                                ))}
                              </Space>
                            );
                          },
                        },
                      ]}
                    />
                  )}
                </>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default DeepWikiHealthPanel;
