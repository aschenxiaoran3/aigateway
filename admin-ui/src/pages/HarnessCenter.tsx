import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlayCircleOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  deepWikiApi,
  harnessApi,
  type DeepWikiRunRow,
  type HarnessCard,
  type HarnessCardCreateRequest,
  type HarnessMessage,
  type HarnessRuntimeRun,
} from '../services/api';

const { Paragraph, Text, Title } = Typography;
const { TextArea } = Input;

function stageTag(stage?: string) {
  const color =
    stage === 'exception' ? 'error'
      : stage === 'uat_wait' ? 'gold'
        : stage?.includes('confirm') ? 'processing'
          : stage === 'completed' ? 'success'
            : 'default';
  return <Tag color={color}>{stage || '-'}</Tag>;
}

export default function HarnessCenter() {
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [cards, setCards] = useState<HarnessCard[]>([]);
  const [selectedCardId, setSelectedCardId] = useState<number>();
  const [selectedCard, setSelectedCard] = useState<HarnessCard | null>(null);
  const [latestRuntime, setLatestRuntime] = useState<HarnessRuntimeRun | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<HarnessMessage[]>([]);
  const [deepWikiRuns, setDeepWikiRuns] = useState<DeepWikiRunRow[]>([]);
  const [createVisible, setCreateVisible] = useState(false);
  const [actionComment, setActionComment] = useState('');
  const [uatSummary, setUatSummary] = useState('');
  const [createForm] = Form.useForm<HarnessCardCreateRequest>();

  const refreshCards = async (nextSelectedCardId?: number) => {
    const nextCards = await harnessApi.listCards();
    setCards(nextCards);
    const targetId = nextSelectedCardId || selectedCardId || nextCards[0]?.id;
    if (targetId) {
      setSelectedCardId(targetId);
    }
  };

  const refreshDetail = async (cardId: number) => {
    const detail = await harnessApi.getCard(cardId);
    setSelectedCard(detail);
    const runtime = detail.runtime_runs?.[0] || null;
    setLatestRuntime(runtime);
    if (runtime?.id) {
      const [runtimeDetail, logs] = await Promise.all([
        harnessApi.getRuntimeRun(runtime.id),
        harnessApi.listRuntimeLogs(runtime.id),
      ]);
      setLatestRuntime(runtimeDetail);
      setRuntimeLogs(logs);
    } else {
      setRuntimeLogs([]);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const [cardRows, runRows] = await Promise.all([
          harnessApi.listCards(),
          deepWikiApi.listRuns().catch(() => []),
        ]);
        setCards(cardRows);
        setDeepWikiRuns(runRows);
        const defaultCardId = cardRows[0]?.id;
        if (defaultCardId) {
          setSelectedCardId(defaultCardId);
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  useEffect(() => {
    if (!selectedCardId) {
      setSelectedCard(null);
      setLatestRuntime(null);
      setRuntimeLogs([]);
      return;
    }
    void refreshDetail(selectedCardId);
  }, [selectedCardId]);

  useEffect(() => {
    const eventSource = new EventSource(harnessApi.streamUrl());
    const handleRefresh = (event?: MessageEvent) => {
      try {
        const payload = event?.data ? JSON.parse(event.data) : {};
        const eventCardId = Number(payload.card?.id || payload.card_id || 0) || undefined;
        void refreshCards(eventCardId);
        if (eventCardId) {
          void refreshDetail(eventCardId);
        } else if (selectedCardId) {
          void refreshDetail(selectedCardId);
        }
      } catch {
        void refreshCards();
      }
    };

    ['card.created', 'card.updated', 'checkpoint.waiting', 'checkpoint.resumed', 'runtime.log', 'runtime.failed', 'summary.generated']
      .forEach((eventName) => {
        eventSource.addEventListener(eventName, handleRefresh);
      });

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [selectedCardId]);

  const selectedCheckpoint = selectedCard?.active_checkpoint;
  const demandWaiting = selectedCheckpoint?.checkpoint_type === 'demand_confirmation';
  const designWaiting = selectedCheckpoint?.checkpoint_type === 'design_confirmation';
  const uatWaiting = selectedCheckpoint?.checkpoint_type === 'uat_acceptance';

  const deepWikiRunOptions = useMemo(
    () =>
      deepWikiRuns.map((item) => ({
        value: item.id,
        label: `${item.repo_slug || item.repo_url || item.trace_id} · ${item.branch || '-'} · ${item.runtime_result || item.status}`,
      })),
    [deepWikiRuns]
  );

  const runAction = async (executor: () => Promise<unknown>, successText: string) => {
    try {
      setActionLoading(true);
      await executor();
      message.success(successText);
      if (selectedCardId) {
        await refreshCards(selectedCardId);
        await refreshDetail(selectedCardId);
      }
      setActionComment('');
      setUatSummary('');
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '操作失败';
      message.error(msg);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreate = async () => {
    const values = await createForm.validateFields();
    await runAction(async () => {
      const created = await harnessApi.createCard(values);
      setCreateVisible(false);
      createForm.resetFields();
      setSelectedCardId(created.id);
      await refreshCards(created.id);
      await refreshDetail(created.id);
    }, 'Harness 卡片已创建');
  };

  return (
    <div>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={8}>
          <Card size="small">
            <Title level={4} style={{ margin: 0 }}>Harness Flowboard V1</Title>
            <Paragraph type="secondary" style={{ marginBottom: 0 }}>
              以数据库为唯一状态源，最小可用地覆盖卡片、checkpoint、runtime、summary 与 SSE 实时刷新。
            </Paragraph>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small">
            <Text type="secondary">卡片数</Text>
            <Title level={3} style={{ margin: 0 }}>{cards.length}</Title>
          </Card>
        </Col>
        <Col span={8}>
          <Card
            size="small"
            extra={
              <Space>
                <Button icon={<ReloadOutlined />} onClick={() => void refreshCards(selectedCardId)}>刷新</Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>新建卡片</Button>
              </Space>
            }
          >
            <Text type="secondary">当前选中</Text>
            <Title level={4} style={{ margin: 0 }}>{selectedCard?.card_code || '未选择'}</Title>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col span={8}>
          <Card title="卡片列表">
            <Spin spinning={loading}>
              <List
                dataSource={cards}
                locale={{ emptyText: '暂无 Harness 卡片' }}
                renderItem={(item) => (
                  <List.Item
                    style={{
                      cursor: 'pointer',
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 8,
                      background: item.id === selectedCardId ? '#eef6ff' : '#fff',
                      border: item.id === selectedCardId ? '1px solid #91caff' : '1px solid #f0f0f0',
                    }}
                    onClick={() => setSelectedCardId(item.id)}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space wrap>
                        <Text strong>{item.card_code}</Text>
                        {stageTag(item.stage_key)}
                        <Tag color="blue">{item.priority}</Tag>
                      </Space>
                      <Text>{item.title}</Text>
                      <Text type="secondary">
                        repo: {item.repo_branch ? `${item.repo_slug || item.repo_url} @ ${item.repo_branch}` : item.repo_slug || item.repo_url || '-'}
                      </Text>
                    </Space>
                  </List.Item>
                )}
              />
            </Spin>
          </Card>
        </Col>

        <Col span={16}>
          <Card title="卡片详情">
            <Spin spinning={loading || actionLoading}>
              {!selectedCard ? (
                <Empty description="请选择卡片" />
              ) : (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <Descriptions bordered size="small" column={2}>
                    <Descriptions.Item label="卡片">{selectedCard.card_code}</Descriptions.Item>
                    <Descriptions.Item label="阶段">{stageTag(selectedCard.stage_key)}</Descriptions.Item>
                    <Descriptions.Item label="标题">{selectedCard.title}</Descriptions.Item>
                    <Descriptions.Item label="类型">{selectedCard.card_type}</Descriptions.Item>
                    <Descriptions.Item label="repo_url">{selectedCard.repo_url || '-'}</Descriptions.Item>
                    <Descriptions.Item label="repo_branch">{selectedCard.repo_branch || '-'}</Descriptions.Item>
                    <Descriptions.Item label="deepwiki_run_id">{selectedCard.deepwiki_run_id || '-'}</Descriptions.Item>
                    <Descriptions.Item label="bundle_id">{selectedCard.bundle_id || '-'}</Descriptions.Item>
                    <Descriptions.Item label="最近 AI 动作">{selectedCard.latest_ai_action || '-'}</Descriptions.Item>
                    <Descriptions.Item label="最近人工动作">{selectedCard.latest_human_action || '-'}</Descriptions.Item>
                    <Descriptions.Item label="当前 checkpoint">
                      {selectedCheckpoint ? `${selectedCheckpoint.checkpoint_type} (${selectedCheckpoint.status})` : '-'}
                    </Descriptions.Item>
                    <Descriptions.Item label="最近 summary">
                      {selectedCard.summary_artifact ? `${selectedCard.summary_artifact.title} (#${selectedCard.summary_artifact.id})` : '-'}
                    </Descriptions.Item>
                  </Descriptions>

                  <Card size="small" title="需求摘要">
                    <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{selectedCard.summary || '-'}</Paragraph>
                    {selectedCard.blocked_reason ? (
                      <Alert style={{ marginTop: 12 }} type="error" showIcon message={selectedCard.blocked_reason} />
                    ) : null}
                  </Card>

                  <Card size="small" title="操作面板">
                    <Space direction="vertical" size={12} style={{ width: '100%' }}>
                      <TextArea
                        rows={3}
                        value={actionComment}
                        onChange={(event) => setActionComment(event.target.value)}
                        placeholder="输入需求确认、设计确认或打回说明"
                      />
                      {uatWaiting ? (
                        <TextArea
                          rows={3}
                          value={uatSummary}
                          onChange={(event) => setUatSummary(event.target.value)}
                          placeholder="UAT 补充总结，可选"
                        />
                      ) : null}
                      <Space wrap>
                        <Button
                          type="primary"
                          disabled={!demandWaiting}
                          onClick={() => void runAction(() => harnessApi.confirmDemand(selectedCard.id, { comment: actionComment }), '需求已确认')}
                        >
                          确认需求
                        </Button>
                        <Button
                          type="primary"
                          disabled={!designWaiting}
                          onClick={() => void runAction(() => harnessApi.confirmDesign(selectedCard.id, { comment: actionComment }), '设计已确认并启动 Runtime')}
                        >
                          确认设计
                        </Button>
                        <Button
                          icon={<PlayCircleOutlined />}
                          onClick={() => void runAction(() => harnessApi.startRuntime(selectedCard.id, { change_request: actionComment }), '已手动触发 Runtime')}
                        >
                          手动启动 Runtime
                        </Button>
                        <Button
                          type="primary"
                          disabled={!uatWaiting}
                          onClick={() =>
                            void runAction(
                              () => harnessApi.submitUatResult(selectedCard.id, { result: 'pass', comment: actionComment, summary: uatSummary }),
                              'UAT 已通过'
                            )
                          }
                        >
                          UAT 通过
                        </Button>
                        <Button
                          danger
                          disabled={!uatWaiting}
                          onClick={() =>
                            void runAction(
                              () => harnessApi.submitUatResult(selectedCard.id, { result: 'fail', comment: actionComment, summary: uatSummary }),
                              '已打回开发'
                            )
                          }
                        >
                          UAT 打回
                        </Button>
                      </Space>
                    </Space>
                  </Card>

                  <Row gutter={16}>
                    <Col span={12}>
                      <Card size="small" title="最近一次 Runtime">
                        {latestRuntime ? (
                          <Descriptions size="small" column={1}>
                            <Descriptions.Item label="run id">{latestRuntime.id}</Descriptions.Item>
                            <Descriptions.Item label="状态">{latestRuntime.status}</Descriptions.Item>
                            <Descriptions.Item label="测试命令">{latestRuntime.test_command || '未识别'}</Descriptions.Item>
                            <Descriptions.Item label="测试结果">{latestRuntime.test_result || '-'}</Descriptions.Item>
                            <Descriptions.Item label="summary_artifact_id">{latestRuntime.summary_artifact_id || '-'}</Descriptions.Item>
                            <Descriptions.Item label="workspace">{latestRuntime.workspace_path || '-'}</Descriptions.Item>
                          </Descriptions>
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Runtime 记录" />
                        )}
                      </Card>
                    </Col>
                    <Col span={12}>
                      <Card size="small" title="最近 Summary">
                        {selectedCard.summary_artifact ? (
                          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                            {selectedCard.summary_artifact.content}
                          </Paragraph>
                        ) : (
                          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Summary" />
                        )}
                      </Card>
                    </Col>
                  </Row>

                  <Card size="small" title={`Runtime 日志 (${runtimeLogs.length})`}>
                    <List
                      size="small"
                      dataSource={runtimeLogs}
                      locale={{ emptyText: '暂无日志' }}
                      renderItem={(item) => (
                        <List.Item>
                          <Space direction="vertical" size={0} style={{ width: '100%' }}>
                            <Text>{item.content}</Text>
                            <Text type="secondary">
                              {item.created_at} · {item.stage || '-'} · {item.status || 'info'}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </Card>
                </Space>
              )}
            </Spin>
          </Card>
        </Col>
      </Row>

      <Modal
        title="新建 Harness 卡片"
        open={createVisible}
        onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()}
        confirmLoading={actionLoading}
        width={720}
      >
        <Form form={createForm} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
                <Input placeholder="例如 Deep Wiki 回归收口" />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="类型" name="card_type" initialValue="需求">
                <Select options={[{ value: '需求', label: '需求' }, { value: 'Bug', label: 'Bug' }, { value: '任务', label: '任务' }]} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="优先级" name="priority" initialValue="中优先">
                <Select options={[{ value: '高优先', label: '高优先' }, { value: '中优先', label: '中优先' }, { value: '低优先', label: '低优先' }]} />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="repo_url" name="repo_url">
                <Input placeholder="/abs/path 或 git url" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="repo_branch" name="repo_branch">
                <Input placeholder="main / feature/..." />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item label="deepwiki_run_id" name="deepwiki_run_id">
                <Select allowClear showSearch optionFilterProp="label" options={deepWikiRunOptions} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item label="bundle_id" name="bundle_id">
                <Input placeholder="可选：关联现有文档任务 ID" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item label="需求摘要" name="summary">
            <TextArea rows={5} placeholder="描述本次要完成的收口、修复或验证内容" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
