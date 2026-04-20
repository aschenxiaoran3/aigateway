import React, { useEffect, useState } from 'react';
import { Button, Card, Table, Tabs, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  contractsApi,
  controlPlaneApi,
  governanceApi,
  valueAssessmentApi,
  type CertificationRecordRow,
  type IntegrationConnectionRow,
  type MemoryFactRow,
  type MemoryPolicyRow,
  type MemoryThreadRow,
  type PipelineTemplateRow,
  type ValueAssessmentRow,
} from '../services/api';

const { Text } = Typography;

const ControlPlane: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [repos, setRepos] = useState<Array<Record<string, unknown>>>([]);
  const [pipelines, setPipelines] = useState<PipelineTemplateRow[]>([]);
  const [agents, setAgents] = useState<Array<Record<string, unknown>>>([]);
  const [schemas, setSchemas] = useState<Array<Record<string, unknown>>>([]);
  const [skills, setSkills] = useState<Array<Record<string, unknown>>>([]);
  const [nodes, setNodes] = useState<Array<Record<string, unknown>>>([]);
  const [integrations, setIntegrations] = useState<IntegrationConnectionRow[]>([]);
  const [valueAssessments, setValueAssessments] = useState<ValueAssessmentRow[]>([]);
  const [certifications, setCertifications] = useState<CertificationRecordRow[]>([]);
  const [memoryPolicies, setMemoryPolicies] = useState<MemoryPolicyRow[]>([]);
  const [memoryThreads, setMemoryThreads] = useState<MemoryThreadRow[]>([]);
  const [memoryFacts, setMemoryFacts] = useState<MemoryFactRow[]>([]);

  const loadAll = async () => {
    try {
      setLoading(true);
      const [r, p, a, s, sk, n, i, v, c, mp, mt, mf] = await Promise.all([
        controlPlaneApi.listRepositories(),
        controlPlaneApi.listPipelines(),
        controlPlaneApi.listAgents(),
        controlPlaneApi.listSchemas(),
        controlPlaneApi.listSkills(),
        contractsApi.listStandardNodes(),
        controlPlaneApi.listIntegrations(),
        valueAssessmentApi.list(),
        governanceApi.listCertifications(),
        controlPlaneApi.listMemoryPolicies(),
        controlPlaneApi.listMemoryThreads({ limit: 20 }),
        controlPlaneApi.listMemoryFacts({ limit: 20 }),
      ]);
      setRepos(r);
      setPipelines(p);
      setAgents(a);
      setSchemas(s);
      setSkills(sk);
      setNodes(n);
      setIntegrations(i);
      setValueAssessments(v);
      setCertifications(c);
      setMemoryPolicies(mp);
      setMemoryThreads(mt);
      setMemoryFacts(mf);
    } catch (e) {
      console.error(e);
      message.error('加载控制平面数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const txt = (value: unknown) => (value == null || value === '' ? '—' : String(value));

  return (
    <div style={{ padding: 24 }}>
      <Card size="small" style={{ marginBottom: 16 }} type="inner">
        当前控制平面已切到 Q2 官方模型：项目治理使用官方 22 项，模板/契约/技能优先指向
        <code>ai-rules/</code>，并新增统一集成、价值初评和认证记录对象。
      </Card>

      <Card
        title="控制平面"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadAll()}>
            刷新
          </Button>
        }
      >
        <Tabs
          items={[
            {
              key: 'pipelines',
              label: `管道模板 (${pipelines.length})`,
              children: (
                <Table<PipelineTemplateRow>
                  loading={loading}
                  rowKey={(row) => String(row.id ?? row.pipeline_key)}
                  dataSource={pipelines}
                  scroll={{ x: 1180 }}
                  columns={[
                    { title: 'pipeline_key', dataIndex: 'pipeline_key', width: 220, ellipsis: true },
                    { title: '名称', dataIndex: 'name', width: 240, ellipsis: true },
                    { title: 'domain', dataIndex: 'domain', width: 100 },
                    { title: '版本', dataIndex: 'current_version', width: 90 },
                    { title: '节点数', dataIndex: 'node_count', width: 80 },
                    { title: 'Owner', dataIndex: 'owner_role', width: 120 },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 90,
                      render: (value: string) => <Tag color={value === 'active' ? 'success' : 'default'}>{value || '-'}</Tag>,
                    },
                    {
                      title: '模板源',
                      dataIndex: 'source_ref',
                      render: (value: string | null, row) => (
                        <Text code>
                          {value || row.template_ref || '—'}
                        </Text>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'integrations',
              label: `统一集成 (${integrations.length})`,
              children: (
                <Table<IntegrationConnectionRow>
                  loading={loading}
                  rowKey={(row) => String(row.id ?? row.connection_key)}
                  dataSource={integrations}
                  columns={[
                    { title: 'connection_key', dataIndex: 'connection_key', width: 180 },
                    { title: '名称', dataIndex: 'name', width: 220 },
                    { title: '类别', dataIndex: 'category', width: 120 },
                    { title: '鉴权', dataIndex: 'auth_mode', width: 120 },
                    { title: 'Owner', dataIndex: 'owner_role', width: 120 },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (value: string) => <Tag>{value || '-'}</Tag>,
                    },
                    { title: 'Endpoint', dataIndex: 'endpoint_url', ellipsis: true },
                  ]}
                />
              ),
            },
            {
              key: 'agents',
              label: `Agent (${agents.length})`,
              children: (
                <Table
                  loading={loading}
                  rowKey={(row) => String((row as { id?: unknown; agent_key?: string }).id ?? (row as { agent_key?: string }).agent_key)}
                  dataSource={agents}
                  scroll={{ x: 1040 }}
                  columns={[
                    { title: 'agent_key', dataIndex: 'agent_key', width: 220 },
                    { title: '名称', dataIndex: 'name', width: 180 },
                    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag>{txt(value)}</Tag> },
                    { title: 'Prompt', dataIndex: 'source_ref', render: (value) => <Text code>{txt(value)}</Text> },
                  ]}
                />
              ),
            },
            {
              key: 'schemas',
              label: `Schema (${schemas.length})`,
              children: (
                <Table
                  loading={loading}
                  rowKey={(row, index) => {
                    const current = row as { id?: number; schema_key?: string; version?: string };
                    return String(current.id ?? `${current.schema_key}-${current.version}-${index}`);
                  }}
                  dataSource={schemas}
                  scroll={{ x: 1080 }}
                  columns={[
                    { title: 'schema_key', dataIndex: 'schema_key', width: 180 },
                    { title: 'schema_name', dataIndex: 'schema_name', width: 220 },
                    { title: 'version', dataIndex: 'version', width: 90 },
                    { title: 'domain', dataIndex: 'domain', width: 100 },
                    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag>{txt(value)}</Tag> },
                    { title: '契约源', dataIndex: 'source_ref', render: (value) => <Text code>{txt(value)}</Text> },
                  ]}
                />
              ),
            },
            {
              key: 'skills',
              label: `Skills (${skills.length})`,
              children: (
                <Table
                  loading={loading}
                  rowKey={(row, index) => {
                    const current = row as { id?: number; skill_key?: string; version?: string };
                    return String(current.id ?? `${current.skill_key}-${current.version}-${index}`);
                  }}
                  dataSource={skills}
                  scroll={{ x: 1080 }}
                  columns={[
                    { title: 'skill_key', dataIndex: 'skill_key', width: 220 },
                    { title: '名称', dataIndex: 'name', width: 220 },
                    { title: 'version', dataIndex: 'version', width: 90 },
                    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag>{txt(value)}</Tag> },
                    { title: '技能源', dataIndex: 'source_ref', render: (value) => <Text code>{txt(value)}</Text> },
                  ]}
                />
              ),
            },
            {
              key: 'memory',
              label: `Memory (${memoryThreads.length})`,
              children: (
                <>
                  <Card size="small" title={`Policies (${memoryPolicies.length})`} style={{ marginBottom: 16 }}>
                    <Table<MemoryPolicyRow>
                      loading={loading}
                      rowKey={(row) => String(row.id ?? `${row.scope_type}-${row.scope_id}`)}
                      dataSource={memoryPolicies}
                      pagination={false}
                      columns={[
                        { title: 'scope_type', dataIndex: 'scope_type', width: 120 },
                        { title: 'scope_id', dataIndex: 'scope_id', width: 220, ellipsis: true },
                        { title: 'enabled', dataIndex: 'enabled', width: 100, render: (value: boolean) => <Tag color={value ? 'success' : 'default'}>{String(value)}</Tag> },
                        { title: 'capture_mode', dataIndex: 'capture_mode', width: 120 },
                        { title: 'max_recall_tokens', dataIndex: 'max_recall_tokens', width: 150 },
                      ]}
                    />
                  </Card>

                  <Card size="small" title={`Threads (${memoryThreads.length})`} style={{ marginBottom: 16 }}>
                    <Table<MemoryThreadRow>
                      loading={loading}
                      rowKey={(row) => String(row.id ?? `${row.scope_key}-${row.thread_key}`)}
                      dataSource={memoryThreads}
                      pagination={false}
                      columns={[
                        { title: 'scope_key', dataIndex: 'scope_key', width: 240, ellipsis: true },
                        { title: 'thread_key', dataIndex: 'thread_key', width: 220, ellipsis: true },
                        { title: 'source', dataIndex: 'source_system', width: 100 },
                        { title: 'client', dataIndex: 'client_app', width: 100 },
                        { title: 'summary', dataIndex: 'summary_text', ellipsis: true },
                      ]}
                    />
                  </Card>

                  <Card size="small" title={`Facts (${memoryFacts.length})`}>
                    <Table<MemoryFactRow>
                      loading={loading}
                      rowKey={(row) => String(row.id ?? `${row.subject_text}-${row.predicate_text}`)}
                      dataSource={memoryFacts}
                      pagination={false}
                      columns={[
                        { title: 'fact_type', dataIndex: 'fact_type', width: 110 },
                        { title: 'subject', dataIndex: 'subject_text', width: 220, ellipsis: true },
                        { title: 'predicate', dataIndex: 'predicate_text', width: 160, ellipsis: true },
                        { title: 'object', dataIndex: 'object_text', ellipsis: true },
                        { title: 'valid_to', dataIndex: 'valid_to', width: 180, render: (value: string | null) => value || <Tag color="success">active</Tag> },
                      ]}
                    />
                  </Card>
                </>
              ),
            },
            {
              key: 'values',
              label: `价值初评 (${valueAssessments.length})`,
              children: (
                <Table<ValueAssessmentRow>
                  loading={loading}
                  rowKey={(row) => String(row.id ?? row.assessment_key)}
                  dataSource={valueAssessments}
                  columns={[
                    { title: '项目', dataIndex: 'project_code', width: 90 },
                    { title: 'assessment_key', dataIndex: 'assessment_key', width: 180 },
                    { title: '需求标题', dataIndex: 'demand_title', ellipsis: true },
                    { title: '状态', dataIndex: 'assessment_status', width: 100, render: (value: string) => <Tag>{value || '-'}</Tag> },
                    { title: '分数', dataIndex: 'assessment_score', width: 90 },
                    { title: '确认人', dataIndex: 'confirm_owner', width: 120 },
                  ]}
                />
              ),
            },
            {
              key: 'certifications',
              label: `认证记录 (${certifications.length})`,
              children: (
                <Table<CertificationRecordRow>
                  loading={loading}
                  rowKey={(row) => String(row.id ?? `${row.project_code}-${row.record_type}-${row.subject_name}`)}
                  dataSource={certifications}
                  columns={[
                    { title: '项目', dataIndex: 'project_code', width: 90 },
                    { title: 'record_type', dataIndex: 'record_type', width: 140 },
                    { title: '主题', dataIndex: 'subject_name', ellipsis: true },
                    { title: 'Owner', dataIndex: 'owner_role', width: 140 },
                    { title: '结果', dataIndex: 'assessment_result', width: 100, render: (value: string) => <Tag>{value || '-'}</Tag> },
                    { title: '生效日', dataIndex: 'effective_date', width: 120 },
                  ]}
                />
              ),
            },
            {
              key: 'repos',
              label: `代码仓库 (${repos.length})`,
              children: (
                <Table
                  loading={loading}
                  rowKey={(row) => String((row as { id?: unknown; repo_key?: string }).id ?? (row as { repo_key?: string }).repo_key)}
                  dataSource={repos}
                  scroll={{ x: 980 }}
                  columns={[
                    { title: 'repo_key', dataIndex: 'repo_key', width: 160 },
                    { title: '名称', dataIndex: 'name', width: 200 },
                    { title: '本地路径', dataIndex: 'local_path', render: (value) => <Text code>{txt(value)}</Text> },
                    { title: '项目', dataIndex: 'project_code', width: 90 },
                    { title: '默认分支', dataIndex: 'default_branch', width: 110 },
                    { title: '状态', dataIndex: 'status', width: 90, render: (value) => <Tag>{txt(value)}</Tag> },
                  ]}
                />
              ),
            },
            {
              key: 'nodes',
              label: `标准节点 (${nodes.length})`,
              children: (
                <Table
                  loading={loading}
                  rowKey={(row) => String((row as { node_key?: string }).node_key)}
                  dataSource={nodes}
                  scroll={{ x: 920 }}
                  columns={[
                    { title: 'node_key', dataIndex: 'node_key', width: 220 },
                    { title: 'title', dataIndex: 'title', width: 220 },
                    { title: '类型', dataIndex: 'node_type', width: 100 },
                    { title: '说明', dataIndex: 'description', ellipsis: true },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default ControlPlane;
