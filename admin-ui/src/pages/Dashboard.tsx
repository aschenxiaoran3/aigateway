/**
 * Dashboard - 用量监控（数据来自 AI 网关 /api/v1/usage/* → MySQL gateway_usage_logs）
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Card, Col, DatePicker, Empty, Row, Space, Spin, Statistic, Table, Tag, Typography, message } from 'antd';
import { Line, Column } from '@ant-design/charts';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  usageApi,
  metricsApi,
  type TokenTrend,
  type ModelUsage,
  type TeamUsage,
  type UsageStats,
} from '../services/api';

const { RangePicker } = DatePicker;
const { Text } = Typography;

type NormalizedTeamUsage = TeamUsage & {
  quotaConflict: boolean;
};

function rangeToIso(range: [Dayjs, Dayjs] | null): { start: string; end: string } | null {
  if (!range?.[0] || !range?.[1]) return null;
  const start = range[0].startOf('day').toISOString();
  const end = range[1].endOf('day').toISOString();
  return { start, end };
}

const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [range, setRange] = useState<[Dayjs, Dayjs]>(() => [
    dayjs().subtract(6, 'day').startOf('day'),
    dayjs().endOf('day'),
  ]);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [tokenTrend, setTokenTrend] = useState<TokenTrend[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [teamUsage, setTeamUsage] = useState<TeamUsage[]>([]);
  const [cpMetrics, setCpMetrics] = useState<Record<string, unknown> | null>(null);
  const [cpMetricsError, setCpMetricsError] = useState<string | null>(null);

  const isoRange = useMemo(() => rangeToIso(range), [range]);

  const loadDashboardData = async () => {
    const r = isoRange;
    if (!r) {
      message.warning('请选择时间范围');
      return;
    }
    setLoadError(null);
    setCpMetricsError(null);
    try {
      setLoading(true);
      const { start, end } = r;
      const [stats, trend, models, teams, dash] = await Promise.all([
        usageApi.getStats(start, end),
        usageApi.getTokenTrend(start, end),
        usageApi.getModelUsage(start, end),
        usageApi.getTeamUsage(start, end),
        metricsApi.getDashboard().catch((e) => {
          console.warn('metrics/dashboard:', e);
          setCpMetricsError('控制平面 metrics 暂不可用（可忽略）');
          return null;
        }),
      ]);
      setUsageStats(stats);
      setTokenTrend(trend);
      setModelUsage(models);
      setTeamUsage(teams);
      if (dash) setCpMetrics(dash);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
      const msg =
        error instanceof Error ? error.message : '请确认 dev 代理将 /api 指向 AI 网关 :3001，且数据库有 gateway_usage_logs';
      setLoadError(msg);
      message.error('用量数据加载失败（未使用模拟数据）');
      setUsageStats(null);
      setTokenTrend([]);
      setModelUsage([]);
      setTeamUsage([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDashboardData();
  }, [range]);

  const avgTokensPerRequest =
    usageStats && usageStats.total_requests > 0
      ? usageStats.total_tokens / usageStats.total_requests
      : 0;

  const normalizedTeamUsage = useMemo<NormalizedTeamUsage[]>(() => {
    const grouped = new Map<string, NormalizedTeamUsage & { quotaCandidates: Set<number> }>();
    teamUsage.forEach((record) => {
      const team = String(record.team || '').trim() || '未关联团队';
      const current =
        grouped.get(team) ||
        {
          team,
          tokens: 0,
          cost: 0,
          quota: null,
          quotaConflict: false,
          quotaCandidates: new Set<number>(),
        };
      current.tokens += Number(record.tokens || 0);
      current.cost += Number(record.cost || 0);
      if (typeof record.quota === 'number' && Number.isFinite(record.quota)) {
        current.quotaCandidates.add(record.quota);
        current.quota = current.quota == null ? record.quota : Math.max(current.quota, record.quota);
      }
      current.quotaConflict = current.quotaCandidates.size > 1;
      grouped.set(team, current);
    });
    return Array.from(grouped.values())
      .map(({ quotaCandidates: _quotaCandidates, ...record }) => record)
      .sort((left, right) => right.tokens - left.tokens);
  }, [teamUsage]);

  const tokenTrendConfig = {
    data: tokenTrend,
    xField: 'date',
    yField: 'tokens',
    smooth: true,
    animation: { appear: { animation: 'path-in', duration: 800 } },
    color: ['#1890ff'],
  };

  const modelUsageConfig = {
    data: modelUsage,
    xField: 'model',
    yField: 'tokens',
    legend: { position: 'top' as const },
    animation: { appear: { animation: 'scale-in-y', duration: 800 } },
    color: ['#1890ff', '#13c2c2', '#faad14', '#f5222d'],
  };

  if (loading && !usageStats && !loadError) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" tip="从网关加载用量..." />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {loadError ? (
          <Alert
            type="error"
            showIcon
            message="无法读取网关用量统计"
            description={
              <>
                <div>{loadError}</div>
                <Text type="secondary">
                  接口应为 <Text code>GET /api/v1/usage/stats</Text> 等；请检查 admin-ui 的 Vite 代理目标是否为 AI 网关端口。
                </Text>
              </>
            }
          />
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24 }}>AI 网关使用情况</h1>
            <Text type="secondary">数据来自网关连接的 MySQL（如 gateway_usage_logs），非前端写死。</Text>
          </div>
          <Space wrap>
            <RangePicker
              value={range}
              onChange={(v) => v && v[0] && v[1] && setRange([v[0], v[1]])}
              allowClear={false}
            />
            <Tag color="blue">区间：{range[0].format('YYYY-MM-DD')} ~ {range[1].format('YYYY-MM-DD')}</Tag>
            <Tag
              color="processing"
              icon={<ReloadOutlined />}
              style={{ cursor: 'pointer' }}
              onClick={() => void loadDashboardData()}
            >
              刷新
            </Tag>
          </Space>
        </div>

        {usageStats ? (
          <>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic title="总请求数" value={usageStats.total_requests} suffix="次" />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    活跃用户（区间内去重）: {usageStats.active_users ?? 0}
                  </Text>
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic title="总 Token" value={usageStats.total_tokens} groupSeparator="," />
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic
                    title="区间总成本 (CNY)"
                    value={usageStats.total_cost}
                    precision={4}
                    prefix="¥"
                  />
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic
                    title="区间均值 Token/分钟"
                    value={usageStats.tokens_per_min}
                    groupSeparator=","
                  />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    由网关按区间时长对总 Token 折算
                  </Text>
                </Card>
              </Col>
            </Row>

            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic
                    title="平均成本 / 次请求"
                    value={usageStats.avg_cost_per_msg}
                    precision={6}
                    prefix="¥"
                  />
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic title="平均 Token / 次请求" value={avgTokensPerRequest} precision={1} groupSeparator="," />
                </Card>
              </Col>
              <Col xs={24} sm={12} lg={6}>
                <Card size="small">
                  <Statistic title="趋势样本天数" value={usageStats.trend_days ?? tokenTrend.length} suffix="天" />
                </Card>
              </Col>
            </Row>
          </>
        ) : !loadError ? (
          <Empty description="暂无用量汇总" />
        ) : null}

        {cpMetricsError ? <Alert type="warning" message={cpMetricsError} showIcon /> : null}
        {cpMetrics ? (
          <Card size="small" title="工程化度量（控制平面 · 同源阿里云 RDS 库表聚合）">
            <pre style={{ margin: 0, maxHeight: 220, overflow: 'auto', fontSize: 12 }}>
              {JSON.stringify(cpMetrics, null, 2)}
            </pre>
          </Card>
        ) : null}

        {tokenTrend.length > 0 ? (
          <Row gutter={16}>
            <Col xs={24} lg={12}>
              <Card title="Token 使用趋势">
                <Line {...tokenTrendConfig} height={300} />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="模型用量排行">
                <Column {...modelUsageConfig} height={300} />
              </Card>
            </Col>
          </Row>
        ) : usageStats && !loadError ? (
          <Empty description="当前区间无趋势点（可能尚无日志）" />
        ) : null}

        <Card title="团队用量">
          {normalizedTeamUsage.length > 0 ? (
            <Table
              dataSource={normalizedTeamUsage}
              rowKey="team"
              pagination={false}
              size="small"
              columns={[
                {
                  title: '团队',
                  dataIndex: 'team',
                  key: 'team',
                  render: (_: string, record: NormalizedTeamUsage) => (
                    <Space size={8}>
                      <span>{record.team}</span>
                      {record.quotaConflict ? <Tag color="orange">配额冲突</Tag> : null}
                    </Space>
                  ),
                },
                {
                  title: 'Token',
                  dataIndex: 'tokens',
                  render: (t: number) => t.toLocaleString(),
                },
                {
                  title: '成本 (CNY)',
                  dataIndex: 'cost',
                  render: (c: number) => `¥${Number(c).toFixed(4)}`,
                },
                {
                  title: '配额使用率',
                  key: 'quota_usage',
                  render: (_: unknown, record: NormalizedTeamUsage) => {
                    const q = record.quota;
                    if (q == null || q === 0) return <Tag>未配置配额</Tag>;
                    const pct = (record.tokens / q) * 100;
                    return <span>{pct.toFixed(1)}%</span>;
                  },
                },
              ]}
            />
          ) : (
            <Empty description="暂无团队维度数据" />
          )}
        </Card>
      </Space>
    </div>
  );
};

export default Dashboard;
