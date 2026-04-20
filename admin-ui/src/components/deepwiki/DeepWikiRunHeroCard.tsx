import React from 'react';
import { BranchesOutlined, ClockCircleOutlined, DatabaseOutlined, PlayCircleOutlined, SyncOutlined } from '@ant-design/icons';
import { Card, Col, Progress, Row, Space, Statistic, Tag, Typography } from 'antd';
import { formatDuration, formatEta, getNumberValue } from '../../pages/deepwiki/deepWikiUtils';
import { statusTag } from '../../pages/deepwiki/deepWikiStatus';
import type { DeepWikiWorkspaceModel } from '../../pages/deepwiki/useDeepWikiWorkspace';

const { Paragraph, Text, Title } = Typography;

export function DeepWikiRunHeroCard({ workspace }: { workspace: DeepWikiWorkspaceModel }) {
  const {
    moduleCount,
    readableFileCount,
    runDetail,
    runSummary,
  } = workspace;
  if (!runDetail) {
    return null;
  }

  return (
    <Card
      style={{
        marginBottom: 16,
        borderRadius: 18,
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #f8fbff 0%, #eef6ff 55%, #f6faff 100%)',
        border: '1px solid #d7e8ff',
      }}
      bodyStyle={{ padding: 20 }}
    >
      <Row gutter={[16, 16]} align="middle">
        <Col span={15}>
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            <Space wrap size={8}>
              <Tag color="blue">{runDetail.repo_slug || runSummary.repoUrl}</Tag>
              {statusTag(runSummary.runtimeResult)}
              <Tag icon={<BranchesOutlined />} color="cyan">
                {String(runDetail.snapshot?.branch || runDetail.branch || runSummary.defaultBranch)}
              </Tag>
              <Tag color="purple">{runSummary.researchProvider}</Tag>
              <Tag color="geekblue">{runSummary.researchModel || 'provider default'}</Tag>
              <Tag icon={<ClockCircleOutlined />} color="gold">
                {runDetail.current_stage}
              </Tag>
            </Space>
            <Title level={3} style={{ margin: 0 }}>
              {runDetail.repo_slug || 'Deep Wiki 仓库知识库'}
            </Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              Commit {String(runDetail.snapshot?.commit_sha || runDetail.commit_sha || '-')} · 输出目录 {runSummary.outputRoot}
            </Paragraph>
            <Space wrap size={[8, 8]}>
              <Tag color="geekblue">模块 {moduleCount}</Tag>
              <Tag color="purple">可读文件 {readableFileCount}</Tag>
              <Tag color="green">页面 {runDetail.pages.length}</Tag>
              <Tag color="gold">图谱 {runSummary.diagramCount}</Tag>
              <Tag color="success">RAG Ready {runDetail.pages.filter((item) => item.ingest_status === 'ready').length}</Tag>
            </Space>
            {Array.isArray(runDetail.generation_jobs) && runDetail.generation_jobs.length ? (
              <Space wrap size={[8, 8]} style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  生成任务
                </Text>
                {runDetail.generation_jobs.map((job) => (
                  <Tag key={job.id ?? `${job.job_type}-${job.status}`} color="magenta">
                    {String(job.job_type || 'job')} · {String(job.status || '—')}
                  </Tag>
                ))}
              </Space>
            ) : null}
            <div style={{ marginTop: 8 }}>
              <Progress
                percent={runSummary.progressPercent}
                status={runSummary.runtimeResult === 'failed' ? 'exception' : runSummary.stalled ? 'normal' : undefined}
                strokeColor={runSummary.stalled ? '#faad14' : undefined}
                format={(percent) => `${percent || 0}%`}
              />
              <Space wrap size={[8, 8]}>
                <Text type="secondary">
                  当前阶段已运行{' '}
                  {formatDuration(
                    runSummary.currentStageMeta.duration_ms
                      ? getNumberValue(runSummary.currentStageMeta.duration_ms) / 1000
                      : runSummary.elapsedSeconds
                  )}
                </Text>
                <Text type="secondary">{formatEta(runSummary.estimatedRemainingSeconds)}</Text>
                {runSummary.queuePosition != null ? (
                  <Text type="secondary">
                    {runSummary.queuePosition === 0 ? '队列状态：正在执行' : `队列位置：第 ${runSummary.queuePosition} 位`}
                  </Text>
                ) : null}
                {runSummary.heartbeatAt ? <Text type="secondary">最近心跳：{runSummary.heartbeatAt}</Text> : null}
              </Space>
            </div>
          </Space>
        </Col>
        <Col span={9}>
          <Row gutter={[12, 12]}>
            <Col span={12}>
              <Card size="small" bordered={false} style={{ background: 'rgba(255,255,255,0.8)' }}>
                <Statistic title="最近检查" value={String(runSummary.sync.last_checked_at || '-')} prefix={<SyncOutlined />} />
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small" bordered={false} style={{ background: 'rgba(255,255,255,0.8)' }}>
                <Statistic title="运行结果" value={String(runSummary.runtimeResult || 'pending')} prefix={<PlayCircleOutlined />} />
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small" bordered={false} style={{ background: 'rgba(255,255,255,0.8)' }}>
                <Statistic title="同步结果" value={String(runSummary.sync.last_result || 'pending')} prefix={<DatabaseOutlined />} />
              </Card>
            </Col>
            <Col span={12}>
              <Card size="small" bordered={false} style={{ background: 'rgba(255,255,255,0.8)' }}>
                <Statistic
                  title="预计剩余"
                  value={runSummary.estimatedRemainingSeconds != null ? formatDuration(runSummary.estimatedRemainingSeconds) : '预估中'}
                  prefix={<ClockCircleOutlined />}
                />
              </Card>
            </Col>
          </Row>
        </Col>
      </Row>
    </Card>
  );
}
