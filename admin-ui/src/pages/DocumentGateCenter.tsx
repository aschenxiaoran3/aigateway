import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Divider,
  Drawer,
  Radio,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import { docBundlesApi, type DocBundleRow } from '../services/api';

const { Text } = Typography;

export type DocumentGateCenterProps = {
  focusedBundleId?: number | null;
};

/** 无项目代码 = 平台/通用文档门禁任务；有 project_code = 绑定到具体研发项目 */
type ScopeFilter = 'all' | 'global' | 'project';

const DocumentGateCenter: React.FC<DocumentGateCenterProps> = ({ focusedBundleId }) => {
  const [searchParams] = useSearchParams();
  const bundleFromUrl = searchParams.get('bundle');
  const effectiveBundleId =
    (bundleFromUrl && /^\d+$/.test(bundleFromUrl) ? Number(bundleFromUrl) : null) ?? focusedBundleId ?? null;
  const projectFromUrl = searchParams.get('project')?.trim();
  const [loading, setLoading] = useState(false);
  const [pipelineBusy, setPipelineBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<DocBundleRow[]>([]);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<(DocBundleRow & Record<string, unknown>) | null>(null);
  const [scope, setScope] = useState<ScopeFilter>('all');
  const [projectFilter, setProjectFilter] = useState<string | undefined>(undefined);

  const load = async () => {
    try {
      setLoading(true);
      const data = await docBundlesApi.list();
      setRows(data);
    } catch (e) {
      console.error(e);
      message.error('加载文档门禁任务失败');
    } finally {
      setLoading(false);
    }
  };

  async function showDetail(id: number) {
    try {
      const data = await docBundlesApi.get(id);
      setCurrent(data);
      setOpen(true);
    } catch (e) {
      console.error(e);
      message.error('加载 bundle 详情失败');
    }
  }

  const projectOptions = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => {
      const c = r.project_code?.trim();
      if (c) set.add(c);
    });
    return Array.from(set).sort().map((v) => ({ label: v, value: v }));
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      const code = r.project_code?.trim() || '';
      if (scope === 'global') return !code;
      if (scope === 'project') {
        if (!code) return false;
        if (projectFilter) return code === projectFilter;
        return true;
      }
      if (projectFilter) return code === projectFilter;
      return true;
    });
  }, [rows, scope, projectFilter]);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (projectFromUrl) {
      setScope('project');
      setProjectFilter(projectFromUrl);
    }
  }, [projectFromUrl]);

  useEffect(() => {
    if (effectiveBundleId != null && rows.length) {
      const hit = rows.find((r) => r.id === effectiveBundleId);
      if (hit) {
        void showDetail(hit.id);
      }
    }
  }, [effectiveBundleId, rows]);

  const refreshCurrent = async () => {
    if (!current?.id) return;
    const data = await docBundlesApi.get(current.id);
    setCurrent(data);
  };

  const runPipeline = async (label: string, fn: () => Promise<unknown>) => {
    if (!current?.id) return;
    try {
      setPipelineBusy(label);
      await fn();
      message.success(`${label} 已完成`);
      await refreshCurrent();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      message.error(err.response?.data?.error || err.message || `${label} 失败`);
    } finally {
      setPipelineBusy(null);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="PRD 闭环：技术方案与测试方案"
        description="推荐顺序：输入契约门禁 → PRD 门禁 → 生成技术方案 → 技术方案门禁 → 构建 Coverage Graph → 生成测试方案 → 测试方案门禁。任务请绑定 project_code 与 bundle 上下文（含 code_repository / Deep Wiki）以便知识检索。"
      />
      <Card
        title="文档门禁"
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
              刷新
            </Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text type="secondary">
              「通用」表示未绑定 project_code 的平台级文档任务；「项目」表示已关联到具体项目代码（与 Deep Wiki / 研发项目一致）。
            </Text>
          </div>
          <Space wrap align="center">
            <span>范围：</span>
            <Radio.Group value={scope} onChange={(e) => setScope(e.target.value)}>
              <Radio.Button value="all">全部</Radio.Button>
              <Radio.Button value="global">仅通用（无项目）</Radio.Button>
              <Radio.Button value="project">仅项目级</Radio.Button>
            </Radio.Group>
            <Select
              allowClear
              placeholder="按项目代码筛选"
              style={{ minWidth: 200 }}
              options={projectOptions}
              value={projectFilter}
              onChange={(v) => setProjectFilter(v)}
            />
          </Space>

          <Table<DocBundleRow>
            loading={loading}
            rowKey="id"
            dataSource={filteredRows}
            columns={[
              { title: 'ID', dataIndex: 'id', width: 70 },
              {
                title: '类型',
                key: 'gate_scope',
                width: 120,
                render: (_, r) => {
                  const code = r.project_code?.trim();
                  return code ? (
                    <Tag color="blue">项目 · {code}</Tag>
                  ) : (
                    <Tag color="default">通用</Tag>
                  );
                },
              },
              { title: '编码', dataIndex: 'bundle_code', width: 180 },
              { title: '标题', dataIndex: 'title', ellipsis: true },
              {
                title: '阶段',
                dataIndex: 'current_stage',
                width: 140,
                render: (s: string) => <Tag color="processing">{s || '—'}</Tag>,
              },
              {
                title: '项目代码',
                dataIndex: 'project_code',
                width: 160,
                render: (v: string) => (v?.trim() ? v : <Text type="secondary">—</Text>),
              },
              {
                title: '操作',
                key: 'op',
                width: 100,
                render: (_, r) => (
                  <Button type="link" size="small" onClick={() => void showDetail(r.id)}>
                    详情
                  </Button>
                ),
              },
            ]}
          />
        </Space>
      </Card>

      <Drawer title="文档任务详情" width={720} open={open} onClose={() => setOpen(false)}>
        {current ? (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Text strong>闭环操作（bundle #{current.id}）</Text>
              <Divider style={{ margin: '12px 0' }} />
              <Space wrap>
                <Button
                  size="small"
                  loading={pipelineBusy === '输入契约门禁'}
                  disabled={!!pipelineBusy && pipelineBusy !== '输入契约门禁'}
                  onClick={() =>
                    void runPipeline('输入契约门禁', () => docBundlesApi.evaluateInputContractGate(current.id))
                  }
                >
                  输入契约门禁
                </Button>
                <Button
                  size="small"
                  loading={pipelineBusy === 'PRD 门禁'}
                  disabled={!!pipelineBusy && pipelineBusy !== 'PRD 门禁'}
                  onClick={() => void runPipeline('PRD 门禁', () => docBundlesApi.evaluatePrdGate(current.id))}
                >
                  PRD 门禁
                </Button>
                <Button
                  type="primary"
                  size="small"
                  loading={pipelineBusy === '生成技术方案'}
                  disabled={!!pipelineBusy && pipelineBusy !== '生成技术方案'}
                  onClick={() => void runPipeline('生成技术方案', () => docBundlesApi.generateTechSpec(current.id))}
                >
                  生成技术方案
                </Button>
                <Button
                  size="small"
                  loading={pipelineBusy === '技术方案门禁'}
                  disabled={!!pipelineBusy && pipelineBusy !== '技术方案门禁'}
                  onClick={() => void runPipeline('技术方案门禁', () => docBundlesApi.evaluateTechSpecGate(current.id))}
                >
                  技术方案门禁
                </Button>
                <Button
                  size="small"
                  loading={pipelineBusy === '构建 Coverage'}
                  disabled={!!pipelineBusy && pipelineBusy !== '构建 Coverage'}
                  onClick={() => void runPipeline('构建 Coverage', () => docBundlesApi.buildCoverageGraph(current.id))}
                >
                  构建 Coverage Graph
                </Button>
                <Button
                  type="primary"
                  size="small"
                  loading={pipelineBusy === '生成测试方案'}
                  disabled={!!pipelineBusy && pipelineBusy !== '生成测试方案'}
                  onClick={() => void runPipeline('生成测试方案', () => docBundlesApi.generateTestPlan(current.id))}
                >
                  生成测试方案
                </Button>
                <Button
                  size="small"
                  loading={pipelineBusy === '测试方案门禁'}
                  disabled={!!pipelineBusy && pipelineBusy !== '测试方案门禁'}
                  onClick={() => void runPipeline('测试方案门禁', () => docBundlesApi.evaluateTestPlanGate(current.id))}
                >
                  测试方案门禁
                </Button>
              </Space>
            </div>
            <Descriptions column={1} bordered size="small">
              {Object.entries(current).map(([k, v]) => (
                <Descriptions.Item key={k} label={k}>
                  {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                </Descriptions.Item>
              ))}
            </Descriptions>
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
};

export default DocumentGateCenter;
