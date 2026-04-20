import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Descriptions, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import {
  programApi,
  type EvidencePackRow,
  type ProgramProjectRow,
  type ProjectMilestoneRow,
  type WaveRow,
} from '../services/api';

const { Text } = Typography;

export type ProjectGovernanceProps = {
  focusedProjectCode?: string | null;
};

function statusTag(value?: string) {
  const color =
    value === 'completed' ? 'success'
      : value === 'active' ? 'processing'
        : value === 'failed' || value === 'blocked' ? 'error'
          : value === 'pending' ? 'default'
            : 'default';
  return <Tag color={color}>{value || '-'}</Tag>;
}

const ProjectGovernance: React.FC<ProjectGovernanceProps> = ({ focusedProjectCode }) => {
  const [searchParams] = useSearchParams();
  const focusFromUrl = searchParams.get('focus');
  const effectiveFocus = focusFromUrl || focusedProjectCode || null;
  const [loading, setLoading] = useState(false);
  const [projects, setProjects] = useState<ProgramProjectRow[]>([]);
  const [waves, setWaves] = useState<WaveRow[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ProgramProjectRow | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const [plist, wlist] = await Promise.all([programApi.listProjects(), programApi.listWaves()]);
      setProjects(plist);
      setWaves(wlist);
    } catch (e) {
      console.error(e);
      message.error('加载项目治理数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!effectiveFocus || !projects.length) return;
    void openDetail(effectiveFocus);
  }, [effectiveFocus, projects]);

  const openDetail = async (code: string) => {
    try {
      const data = await programApi.getProject(code);
      setDetail(data);
      setDetailOpen(true);
    } catch (e) {
      console.error(e);
      message.error('加载项目详情失败');
    }
  };

  const officialProjects = useMemo(
    () => [...projects].sort((left, right) => (left.official_order || 999) - (right.official_order || 999)),
    [projects]
  );

  return (
    <div style={{ padding: 24 }}>
      <Card size="small" style={{ marginBottom: 16 }} type="inner">
        当前页面已切换到《Harness 工程化项目落地方案》官方 22 项治理口径，排序、波次和阶段验收均以
        <code>gateway_program_projects</code> 的官方序为准。
      </Card>

      <Card
        title="项目治理"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <Table<ProgramProjectRow>
          loading={loading}
          rowKey={(row) => row.code}
          dataSource={officialProjects}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 1380 }}
          columns={[
            { title: '序号', dataIndex: 'official_order', width: 72 },
            { title: '项目代码', dataIndex: 'code', width: 96 },
            { title: '项目名称', dataIndex: 'name', width: 240, ellipsis: true },
            {
              title: 'OKR 阶段',
              dataIndex: 'okr_stage',
              width: 110,
              render: (value) => <Tag color={value === '跨阶段' ? 'gold' : 'blue'}>{value || '-'}</Tag>,
            },
            {
              title: '波次',
              width: 180,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Text>{row.wave_code || '-'}</Text>
                  <Text type="secondary">{row.wave_name || '-'}</Text>
                </Space>
              ),
            },
            { title: '负责人', dataIndex: 'owner_role', width: 140, ellipsis: true },
            {
              title: '周期',
              width: 180,
              render: (_, row) => `${row.start_date || '-'} ~ ${row.end_date || '-'}`,
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value) => statusTag(value),
            },
            {
              title: '风险',
              dataIndex: 'risk_level',
              width: 100,
              render: (value) => <Tag color={value === 'high' ? 'red' : value === 'medium' ? 'gold' : 'green'}>{value || '-'}</Tag>,
            },
            {
              title: '下一里程碑',
              width: 260,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Text>{row.next_milestone_title || '—'}</Text>
                  <Text type="secondary">
                    {row.next_milestone_due_date || '—'} / {row.next_milestone_status || 'pending'}
                  </Text>
                </Space>
              ),
            },
            { title: '证据包', dataIndex: 'evidence_count', width: 90 },
            { title: '风险项', dataIndex: 'open_risk_count', width: 90 },
            {
              title: '操作',
              key: 'op',
              width: 100,
              fixed: 'right',
              render: (_, row) => (
                <Button type="link" icon={<EyeOutlined />} onClick={() => void openDetail(row.code)}>
                  详情
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card title="波次总览" loading={loading}>
        <Table<WaveRow>
          rowKey={(row, index) => String(row.id ?? index)}
          dataSource={waves}
          pagination={false}
          columns={[
            { title: '波次编码', dataIndex: 'code', width: 120 },
            { title: '名称', dataIndex: 'name' },
            { title: '阶段', dataIndex: 'stage', width: 140 },
            { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
          ]}
        />
      </Card>

      <Modal
        title={detail ? `${detail.code} · ${detail.name}` : '项目详情'}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={1100}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="OKR 阶段">{detail.okr_stage || '-'}</Descriptions.Item>
              <Descriptions.Item label="波次">{`${detail.wave_code || '-'} / ${detail.wave_name || '-'}`}</Descriptions.Item>
              <Descriptions.Item label="负责人">{detail.owner_role || '-'}</Descriptions.Item>
              <Descriptions.Item label="协同组">{(detail.co_owner_roles || []).join(' / ') || '-'}</Descriptions.Item>
              <Descriptions.Item label="起止日期">{`${detail.start_date || '-'} ~ ${detail.end_date || '-'}`}</Descriptions.Item>
              <Descriptions.Item label="状态">{statusTag(detail.status)}</Descriptions.Item>
              <Descriptions.Item label="风险等级">{detail.risk_level || '-'}</Descriptions.Item>
              <Descriptions.Item label="证据包数">{detail.evidence_count || 0}</Descriptions.Item>
              <Descriptions.Item label="项目摘要" span={2}>
                {detail.summary || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="验收口径" span={2}>
                {detail.acceptance_rule || '-'}
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="里程碑">
              <Table<ProjectMilestoneRow>
                size="small"
                rowKey={(row, index) => String(row.id ?? index)}
                dataSource={(detail.milestones as ProjectMilestoneRow[]) || []}
                pagination={false}
                columns={[
                  { title: '检查点', dataIndex: 'checkpoint_label', width: 90 },
                  { title: '类型', dataIndex: 'milestone_type', width: 130 },
                  { title: '标题', dataIndex: 'title', ellipsis: true },
                  { title: '到期日', dataIndex: 'due_date', width: 120 },
                  { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
                ]}
              />
            </Card>

            <Card size="small" title="证据包">
              <Table<EvidencePackRow>
                size="small"
                rowKey={(row, index) => String(row.id ?? index)}
                dataSource={(detail.evidence_packs as EvidencePackRow[]) || []}
                pagination={false}
                columns={[
                  { title: '检查点', dataIndex: 'milestone_type', width: 110 },
                  { title: '标题', dataIndex: 'title', ellipsis: true },
                  { title: '评审结果', dataIndex: 'review_result', width: 100, render: statusTag },
                  { title: 'Reviewer', dataIndex: 'reviewer', width: 120 },
                  { title: 'Trace', dataIndex: 'trace_id', ellipsis: true },
                ]}
              />
            </Card>
          </Space>
        ) : (
          <span>无数据</span>
        )}
      </Modal>
    </div>
  );
};

export default ProjectGovernance;
