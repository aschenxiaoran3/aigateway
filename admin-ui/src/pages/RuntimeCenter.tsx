import React, { useEffect, useState } from 'react';
import { Button, Card, Descriptions, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import {
  runtimeApi,
  type ApprovalTaskRow,
  type PipelineRunRow,
  type RuntimeNodeRow,
  type RuntimeTraceDetail,
} from '../services/api';

const { Text } = Typography;

export type RuntimeCenterProps = {
  focusedTraceId?: string | null;
};

function statusColor(value?: string) {
  if (value === 'completed' || value === 'approved') return 'success';
  if (value === 'failed' || value === 'blocked') return 'error';
  if (value === 'running') return 'processing';
  return 'default';
}

const RuntimeCenter: React.FC<RuntimeCenterProps> = ({ focusedTraceId }) => {
  const [searchParams] = useSearchParams();
  const traceFromUrl = searchParams.get('trace');
  const [loading, setLoading] = useState(false);
  const [runs, setRuns] = useState<PipelineRunRow[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<RuntimeTraceDetail | null>(null);
  const [activeTrace, setActiveTrace] = useState<string | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const data = await runtimeApi.listRuns();
      setRuns(data);
    } catch (e) {
      console.error(e);
      message.error('加载 ThinCore 运行数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const traceId = traceFromUrl || focusedTraceId;
    if (traceId) {
      void openTrace(traceId);
    }
  }, [focusedTraceId, traceFromUrl]);

  const openTrace = async (traceId: string) => {
    try {
      setActiveTrace(traceId);
      const data = await runtimeApi.getTrace(traceId);
      setDetail(data);
      setDetailOpen(true);
    } catch (e) {
      console.error(e);
      message.error('加载 Trace 详情失败');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="ThinCore 运行编排"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        <Table<PipelineRunRow>
          loading={loading}
          rowKey={(row, index) => String(row.id ?? row.trace_id ?? index)}
          dataSource={runs}
          scroll={{ x: 1260 }}
          columns={[
            { title: 'trace_id', dataIndex: 'trace_id', width: 280, ellipsis: true },
            { title: 'pipeline', dataIndex: 'pipeline_name', width: 220, ellipsis: true },
            { title: 'project', dataIndex: 'project_code', width: 90 },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => <Tag color={statusColor(value)}>{value || '-'}</Tag>,
            },
            {
              title: '审批',
              dataIndex: 'approval_status',
              width: 100,
              render: (value: string) => <Tag>{value || '-'}</Tag>,
            },
            {
              title: '节点进度',
              width: 140,
              render: (_, row) => `${row.completed_node_count || 0}/${row.node_count || 0}`,
            },
            { title: '失败节点', dataIndex: 'failed_node_count', width: 90 },
            { title: '待审批', dataIndex: 'pending_approval_count', width: 90 },
            {
              title: '模板源',
              dataIndex: 'source_ref',
              width: 260,
              ellipsis: true,
              render: (value: string | null) => <Text code>{value || '—'}</Text>,
            },
            { title: '创建时间', dataIndex: 'created_at', width: 180 },
            {
              title: '操作',
              key: 'op',
              width: 90,
              fixed: 'right',
              render: (_, row) =>
                row.trace_id ? (
                  <Button type="link" size="small" onClick={() => void openTrace(String(row.trace_id))}>
                    详情
                  </Button>
                ) : null,
            },
          ]}
        />
      </Card>

      <Modal
        title={activeTrace ? `Trace · ${activeTrace}` : 'Trace 详情'}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={1180}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="pipeline">{detail.run?.pipeline_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="project">{detail.run?.project_code || '-'}</Descriptions.Item>
              <Descriptions.Item label="status">
                <Tag color={statusColor(detail.run?.status)}>{detail.run?.status || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="approval">
                <Tag>{detail.run?.approval_status || '-'}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="source_ref" span={2}>
                <Text code>{detail.run?.source_ref || '-'}</Text>
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="节点执行">
              <Table<RuntimeNodeRow>
                size="small"
                rowKey={(row, index) => String(row.id ?? `${row.node_key}-${index}`)}
                dataSource={detail.nodes || []}
                pagination={false}
                columns={[
                  { title: 'node_key', dataIndex: 'node_key', width: 180 },
                  { title: '名称', dataIndex: 'node_name', width: 180 },
                  { title: '类型', dataIndex: 'node_type', width: 100 },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 100,
                    render: (value: string) => <Tag color={statusColor(value)}>{value || '-'}</Tag>,
                  },
                  { title: '摘要', dataIndex: 'output_summary', ellipsis: true },
                ]}
              />
            </Card>

            <Card size="small" title="审批任务">
              <Table<ApprovalTaskRow>
                size="small"
                rowKey={(row, index) => String(row.id ?? index)}
                dataSource={detail.approvals || []}
                pagination={false}
                columns={[
                  { title: '审批角色', dataIndex: 'approver_role', width: 160 },
                  { title: '状态', dataIndex: 'status', width: 100, render: (value: string) => <Tag>{value || '-'}</Tag> },
                  { title: '决策', dataIndex: 'decision', width: 100, render: (value: string) => <Tag>{value || '-'}</Tag> },
                  { title: '备注', dataIndex: 'comment', ellipsis: true },
                ]}
              />
            </Card>

            <Card size="small" title="证据与门禁">
              <Descriptions bordered size="small" column={1}>
                <Descriptions.Item label="evidence_packs">
                  {detail.evidence_packs?.length || 0}
                </Descriptions.Item>
                <Descriptions.Item label="gate_executions">
                  {detail.gate_executions?.length || 0}
                </Descriptions.Item>
                <Descriptions.Item label="workflow_summary">
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(detail.workflow_summary || {}, null, 2)}
                  </pre>
                </Descriptions.Item>
              </Descriptions>
            </Card>

            <Card size="small" title="Memory">
              <Descriptions bordered size="small" column={3}>
                <Descriptions.Item label="memory_turns">
                  {detail.memory_turns?.length || 0}
                </Descriptions.Item>
                <Descriptions.Item label="memory_recalls">
                  {detail.memory_recalls?.length || 0}
                </Descriptions.Item>
                <Descriptions.Item label="memory_facts">
                  {detail.memory_facts?.length || 0}
                </Descriptions.Item>
              </Descriptions>
              <Table
                size="small"
                style={{ marginTop: 12 }}
                rowKey={(row, index) => String((row as { id?: number }).id ?? index)}
                dataSource={detail.memory_recalls || []}
                pagination={false}
                columns={[
                  { title: 'query', dataIndex: 'query_text', ellipsis: true },
                  { title: 'tokens', dataIndex: 'token_count', width: 90 },
                  { title: 'latency_ms', dataIndex: 'latency_ms', width: 110 },
                  { title: 'status', dataIndex: 'status', width: 100, render: (value: string) => <Tag>{value || '-'}</Tag> },
                ]}
              />
            </Card>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
};

export default RuntimeCenter;
