import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Col, Row, Statistic, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';
import {
  evidenceApi,
  governanceApi,
  metricsApi,
  type AcceptanceCheckpointRow,
  type AcceptanceOverview,
  type EfficiencyReport,
  type EvidencePackRow,
} from '../services/api';

const { Text } = Typography;

export type AcceptanceCenterProps = {
  focusedProjectCode?: string | null;
};

function checkpointColor(key: string) {
  if (key === '4_30_gate') return '#1677ff';
  if (key === '5_31_check') return '#faad14';
  return '#52c41a';
}

function renderInlineMetric(value: unknown) {
  return typeof value === 'number' || typeof value === 'string' ? value : '-';
}

const AcceptanceCenter: React.FC<AcceptanceCenterProps> = ({ focusedProjectCode }) => {
  const [searchParams] = useSearchParams();
  const focusFromUrl = searchParams.get('focus');
  const effectiveFocus = focusFromUrl || focusedProjectCode || undefined;
  const [loading, setLoading] = useState(false);
  const [packs, setPacks] = useState<EvidencePackRow[]>([]);
  const [eff, setEff] = useState<EfficiencyReport | null>(null);
  const [overview, setOverview] = useState<AcceptanceOverview | null>(null);

  const load = async () => {
    try {
      setLoading(true);
      const [packRows, effRows, overviewRows] = await Promise.all([
        evidenceApi.listPacks(effectiveFocus),
        metricsApi.getEfficiencyReport(),
        governanceApi.getAcceptanceOverview(effectiveFocus),
      ]);
      setPacks(packRows);
      setEff(effRows);
      setOverview(overviewRows);
    } catch (err) {
      console.error(err);
      message.error('加载阶段验收数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [effectiveFocus]);

  const filteredPacks = useMemo(
    () => (effectiveFocus ? packs.filter((item) => item.project_code === effectiveFocus) : packs),
    [effectiveFocus, packs]
  );

  const checkpoints = overview?.checkpoints || [];
  const summary = overview?.summary || {};

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="阶段验收总览"
        loading={loading}
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        }
        style={{ marginBottom: 16 }}
      >
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="官方项目数" value={Number(summary.total_projects || 0)} />
          </Col>
          <Col span={6}>
            <Statistic title="证据包数" value={Number(summary.evidence_pack_count || 0)} />
          </Col>
          <Col span={6}>
            <Statistic title="Foundation 覆盖率" value={Number(summary.knowledge_coverage_rate || 0)} suffix="%" />
          </Col>
          <Col span={6}>
            <Statistic title="度量基线数" value={Number(summary.baseline_count || 0)} />
          </Col>
        </Row>
        <Row gutter={16} style={{ marginTop: 16 }}>
          <Col span={8}>
            <Statistic title="统一集成连接" value={Number(summary.integration_count || 0)} />
          </Col>
          <Col span={8}>
            <Statistic title="价值初评记录" value={Number(summary.value_assessment_count || 0)} />
          </Col>
          <Col span={8}>
            <Statistic title="认证记录" value={Number(summary.certification_count || 0)} />
          </Col>
        </Row>
      </Card>

      <Row gutter={16} style={{ marginBottom: 16 }}>
        {checkpoints.map((checkpoint: AcceptanceCheckpointRow) => (
          <Col span={8} key={checkpoint.key}>
            <Card
              title={checkpoint.label}
              bordered={false}
              style={{
                background: `${checkpointColor(checkpoint.key)}10`,
                border: `1px solid ${checkpointColor(checkpoint.key)}33`,
              }}
            >
              <Statistic title="适用项目" value={checkpoint.total_count} />
              <Text type="secondary">到期日：{checkpoint.due_date}</Text>
              <div style={{ marginTop: 12 }}>
                <Tag color="success">完成 {checkpoint.completed_count}</Tag>
                <Tag color="error">阻塞 {checkpoint.blocked_count}</Tag>
              </div>
            </Card>
          </Col>
        ))}
      </Row>

      {checkpoints.map((checkpoint: AcceptanceCheckpointRow) => (
        <Card key={checkpoint.key} title={checkpoint.label} style={{ marginBottom: 16 }}>
          <Table
            size="small"
            rowKey={(row) => String((row as { code?: string }).code)}
            dataSource={checkpoint.projects}
            pagination={false}
            columns={[
              { title: '项目代码', dataIndex: 'code', width: 90 },
              { title: '名称', dataIndex: 'name', width: 220, ellipsis: true },
              { title: '负责人', dataIndex: 'owner_role', width: 140 },
              { title: '波次', dataIndex: 'wave_name', width: 180, ellipsis: true },
              {
                title: '状态',
                dataIndex: 'status',
                width: 100,
                render: (value: string) => <Tag color={value === 'completed' ? 'success' : 'default'}>{value || '-'}</Tag>,
              },
              { title: '证据包', dataIndex: 'evidence_count', width: 80 },
              { title: '到期日', dataIndex: 'due_date', width: 110 },
              { title: '验收口径', dataIndex: 'acceptance_rule', ellipsis: true },
            ]}
          />
        </Card>
      ))}

      <Card title="提效与证据包" loading={loading}>
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col span={8}>
            <Statistic title="当前筛选证据包" value={filteredPacks.length} />
          </Col>
          <Col span={16}>
            <Text type="secondary">
              采纳率：{renderInlineMetric(eff?.summary?.adoption_rate)}，AI 生成占比：
              {renderInlineMetric(eff?.summary?.ai_gen_ratio)}，返工率：
              {renderInlineMetric(eff?.summary?.rework_rate)}
            </Text>
          </Col>
        </Row>
        <Table<EvidencePackRow>
          loading={loading}
          rowKey={(row, index) => String(row.id ?? index)}
          dataSource={filteredPacks}
          columns={[
            { title: '项目', dataIndex: 'project_code', width: 90 },
            { title: '检查点', dataIndex: 'milestone_type', width: 110 },
            { title: '标题', dataIndex: 'title', ellipsis: true },
            {
              title: '评审结果',
              dataIndex: 'review_result',
              width: 110,
              render: (value: string) => <Tag color={value === 'passed' ? 'success' : 'default'}>{value || '-'}</Tag>,
            },
            { title: 'Reviewer', dataIndex: 'reviewer', width: 120 },
            { title: 'Trace', dataIndex: 'trace_id', ellipsis: true },
            { title: '创建时间', dataIndex: 'created_at', width: 180 },
          ]}
        />
      </Card>
    </div>
  );
};

export default AcceptanceCenter;
