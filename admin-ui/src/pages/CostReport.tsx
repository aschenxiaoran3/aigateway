/**
 * 成本报表页面
 * 
 * 功能:
 * - 成本趋势分析
 * - 按团队/模型分组统计
 * - 导出 Excel/CSV
 * - 成本预测
 */

import React, { useState, useEffect } from 'react';
import { Card, Table, Button, DatePicker, Space, Tag, Row, Col, Statistic, Select, message, Spin, Empty } from 'antd';
import { Line, Pie } from '@ant-design/charts';
import { DownloadOutlined, FilterOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { usageApi } from '../services/api';

const { RangePicker } = DatePicker;

// 模拟数据
const mockCostTrend = [
  { date: '2026-04-03', cost: 1.25, tokens: 2500000 },
  { date: '2026-04-04', cost: 1.40, tokens: 2800000 },
  { date: '2026-04-05', cost: 1.60, tokens: 3200000 },
  { date: '2026-04-06', cost: 1.45, tokens: 2900000 },
  { date: '2026-04-07', cost: 1.75, tokens: 3500000 },
  { date: '2026-04-08', cost: 1.55, tokens: 3100000 },
  { date: '2026-04-09', cost: 1.35, tokens: 2700000 },
];

const mockCostByTeam = [
  { team: '技术部', cost: 4.25, percentage: 41.1 },
  { team: '产品部', cost: 2.60, percentage: 25.1 },
  { team: '测试部', cost: 1.90, percentage: 18.4 },
  { team: '运维部', cost: 0.95, percentage: 9.2 },
  { team: '设计部', cost: 0.65, percentage: 6.3 },
];

const mockCostByModel = [
  { model: 'deepseek-chat', cost: 4.25, percentage: 41.1 },
  { model: 'qwen3.5-plus', cost: 3.60, percentage: 34.8 },
  { model: 'gpt-4-turbo', cost: 1.75, percentage: 16.9 },
  { model: 'claude-3-sonnet', cost: 0.75, percentage: 7.2 },
];

type CostBreakdownRow =
  | { team: string; cost: number; percentage: number }
  | { model: string; cost: number; percentage: number };

const CostReport: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState<[any, any]>([
    dayjs().subtract(6, 'day'),
    dayjs(),
  ]);
  const [groupBy, setGroupBy] = useState<'team' | 'model'>('team');
  const [costTrend, setCostTrend] = useState(mockCostTrend);
  const [costData, setCostData] = useState<CostBreakdownRow[]>(mockCostByTeam);

  useEffect(() => {
    loadCostData();
  }, [dateRange, groupBy]);

  const loadCostData = async () => {
    try {
      setLoading(true);
      // TODO: 调用真实 API
      // const report = await usageApi.getCostReport(
      //   dateRange[0].format('YYYY-MM-DD'),
      //   dateRange[1].format('YYYY-MM-DD')
      // );
      
      // 暂时使用模拟数据
      setCostTrend(mockCostTrend);
      setCostData(groupBy === 'team' ? mockCostByTeam : mockCostByModel);
    } catch (error) {
      console.error('Failed to load cost data:', error);
      message.error('加载成本数据失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    // TODO: 实现导出功能
    message.success('导出功能开发中...');
  };

  // 成本趋势图配置
  const costTrendConfig = {
    data: costTrend,
    xField: 'date',
    yField: 'cost',
    seriesField: 'cost',
    smooth: true,
    animation: {
      appear: {
        animation: 'path-in',
        duration: 1000,
      },
    },
    color: ['#faad14'],
    label: {
      formatter: (datum: any) => `¥${datum.cost.toFixed(2)}`,
    },
  };

  // 饼图配置
  const pieConfig = {
    appendPadding: 10,
    data: costData.map((item) => ({
      type: 'team' in item ? item.team : item.model,
      value: item.cost,
    })),
    angleField: 'value',
    colorField: 'type',
    radius: 0.8,
    label: {
      type: 'outer',
      content: '{name} {percentage}',
    },
    interactions: [{ type: 'element-active' }],
    color: ['#1890ff', '#13c2c2', '#faad14', '#f5222d', '#722ed1'],
  };

  // 计算总计
  const totalCost = costData.reduce((sum, item) => sum + item.cost, 0);
  const totalTokens = costTrend.reduce((sum, item) => sum + item.tokens, 0);
  const avgDailyCost = totalCost / costTrend.length;
  const projectedMonthly = avgDailyCost * 30;

  return (
    <div style={{ padding: '24px' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '24px' }}>💰 成本报表</h1>
        <p style={{ margin: '8px 0 0', color: '#666' }}>
          分析 AI 使用成本，优化资源配置
        </p>
      </div>

      {/* 筛选器 */}
      <Card style={{ marginBottom: '24px' }}>
        <Row gutter={16} align="middle">
          <Col>
            <span>日期范围:</span>
          </Col>
          <Col>
            <RangePicker
              value={dateRange}
              onChange={(dates) => setDateRange(dates as [any, any])}
            />
          </Col>
          <Col style={{ marginLeft: '24px' }}>
            <span>分组:</span>
          </Col>
          <Col>
            <Select
              value={groupBy}
              onChange={(value) => setGroupBy(value as 'team' | 'model')}
              style={{ width: 150 }}
            >
              <Select.Option value="team">按团队</Select.Option>
              <Select.Option value="model">按模型</Select.Option>
            </Select>
          </Col>
          <Col style={{ marginLeft: 'auto' }}>
            <Space>
              <Button icon={<FilterOutlined />}>
                高级筛选
              </Button>
              <Button 
                type="primary" 
                icon={<DownloadOutlined />}
                onClick={handleExport}
              >
                导出报表
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: '24px' }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总成本"
              value={totalCost}
              prefix="¥"
              precision={2}
              valueStyle={{ color: '#faad14' }}
            />
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
              {dateRange[0].format('MM-DD')} 至 {dateRange[1].format('MM-DD')}
            </div>
          </Card>
        </Col>
        
        <Col span={6}>
          <Card>
            <Statistic
              title="总 Token"
              value={totalTokens}
              precision={0}
              valueStyle={{ color: '#1890ff' }}
              suffix="tokens"
            />
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
              日均 {Math.round(totalTokens / costTrend.length).toLocaleString()}
            </div>
          </Card>
        </Col>
        
        <Col span={6}>
          <Card>
            <Statistic
              title="日均成本"
              value={avgDailyCost}
              prefix="¥"
              precision={2}
              valueStyle={{ color: '#13c2c2' }}
            />
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
              基于 {costTrend.length} 天数据
            </div>
          </Card>
        </Col>
        
        <Col span={6}>
          <Card>
            <Statistic
              title="预计月成本"
              value={projectedMonthly}
              prefix="¥"
              precision={2}
              valueStyle={{ color: '#722ed1' }}
            />
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
              按当前使用率预测
            </div>
          </Card>
        </Col>
      </Row>

      {/* 图表区域 */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spin size="large" tip="加载中..." />
        </div>
      ) : (
        <Row gutter={16}>
          {/* 成本趋势图 */}
          <Col span={12}>
            <Card title="📈 成本趋势" style={{ height: '400px' }}>
              <Line {...costTrendConfig} height={320} />
            </Card>
          </Col>
          
          {/* 成本分布饼图 */}
          <Col span={12}>
            <Card title={`📊 成本分布 (${groupBy === 'team' ? '团队' : '模型'})`} style={{ height: '400px' }}>
              <Pie {...pieConfig} height={320} />
            </Card>
          </Col>
        </Row>
      )}

      {/* 详细表格 */}
      <Card title="📋 成本明细" style={{ marginTop: '16px' }}>
        <Table
          dataSource={costData}
          rowKey={groupBy === 'team' ? 'team' : 'model'}
          pagination={false}
          columns={[
            {
              title: groupBy === 'team' ? '团队' : '模型',
              dataIndex: groupBy === 'team' ? 'team' : 'model',
              key: groupBy === 'team' ? 'team' : 'model',
              render: (value: string) => (
                <span style={{ fontWeight: 600 }}>{value}</span>
              ),
            },
            {
              title: '成本 (CNY)',
              dataIndex: 'cost',
              key: 'cost',
              render: (cost: number) => `¥${cost.toFixed(2)}`,
              sorter: (a: any, b: any) => a.cost - b.cost,
            },
            {
              title: '占比',
              dataIndex: 'percentage',
              key: 'percentage',
              render: (percentage: number) => (
                <Tag color={percentage > 30 ? 'red' : 'blue'}>
                  {percentage.toFixed(1)}%
                </Tag>
              ),
              sorter: (a: any, b: any) => a.percentage - b.percentage,
            },
            {
              title: '进度条',
              key: 'progress',
              render: (_: any, record: any) => (
                <div style={{ width: '100%' }}>
                  <div style={{ 
                    width: '100%', 
                    height: '8px', 
                    background: '#f0f0f0', 
                    borderRadius: '4px',
                    overflow: 'hidden'
                  }}>
                    <div style={{ 
                      width: `${record.percentage}%`, 
                      height: '100%', 
                      background: record.percentage > 30 ? '#ff4d4f' : '#1890ff',
                      transition: 'width 0.3s ease'
                    }} />
                  </div>
                </div>
              ),
            },
          ]}
          footer={() => (
            <div style={{ fontWeight: 600, textAlign: 'right' }}>
              总计：¥{totalCost.toFixed(2)} (100%)
            </div>
          )}
        />
      </Card>

      {/* 优化建议 */}
      <Card title="💡 优化建议" style={{ marginTop: '16px' }}>
        <div style={{ marginBottom: '12px' }}>
          <Tag color="green">省钱建议</Tag>
          <p style={{ marginTop: '8px' }}>
            当前 <strong>技术部</strong> 使用 GPT-4 占比较高，建议切换到 DeepSeek 或 Qwen，预计可节省 <strong>¥0.85/天</strong>。
          </p>
        </div>
        <div>
          <Tag color="blue">效率建议</Tag>
          <p style={{ marginTop: '8px' }}>
            产品部 Token 使用量增长较快，建议检查是否有重复调用或未优化的 Prompt。
          </p>
        </div>
      </Card>
    </div>
  );
};

export default CostReport;
