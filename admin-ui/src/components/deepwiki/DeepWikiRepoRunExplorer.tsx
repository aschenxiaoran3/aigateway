import React from 'react';
import {
  BranchesOutlined,
  ClockCircleOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  FileTextOutlined,
  LinkOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  List,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Tree,
  Typography,
  message,
} from 'antd';
import { MermaidBlock } from './MermaidBlock';
import { WikiGraphView } from './WikiGraphView';
import { renderMarkdownBlocks } from '../../pages/deepwiki/deepWikiMarkdown';
import { statusTag } from '../../pages/deepwiki/deepWikiStatus';
import type { WikiTreeNode } from '../../pages/deepwiki/deepWikiTypes';
import { formatEta, getNumberValue, getRecordObject } from '../../pages/deepwiki/deepWikiUtils';
const { Paragraph, Text, Title, Link } = Typography;
const { Search } = Input;
import type { DeepWikiWorkspaceModel } from '../../pages/deepwiki/useDeepWikiWorkspace';

export function DeepWikiRepoRunExplorer({ workspace }: { workspace: DeepWikiWorkspaceModel }) {
  const {
    actionLoading,
    availableBranches,
    displayedRuns,
    filteredWikiTree,
    handleRepoExplorerBranchChange,
    repoExplorerBranchFilter,
    graphLoading,
    handleCreateDocBundle,
    handleReingest,
    handleRetry,
    handleSaveSyncConfig,
    handleSyncNow,
    loadModels,
    loading,
    models,
    onOpenDocBundle,
    onOpenKnowledge,
    onOpenRuntimeTrace,
    pageContent,
    providers,
    relatedDocBundles,
    repos,
    runColumns,
    runDetail,
    runGraph,
    runSummary,
    runs,
    selectedPage,
    selectedPageSourceFiles,
    selectedRepo,
    selectedRepoSourceId,
    selectedRunId,
    selectedTreeKeys,
    setCreateVisible,
    setSelectedPage,
    setSelectedRepoSourceId,
    setSelectedRunId,
    setTreeQuery,
    syncForm,
    treeQuery,
    wikiTree,
  } = workspace;
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="仓库数" value={repos.length} prefix={<DatabaseOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="当前仓库运行数" value={runs.length} prefix={<FileSearchOutlined />} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="RAG Ready"
              value={runDetail?.pages.filter((item) => item.ingest_status === 'ready').length || 0}
              prefix={<DatabaseOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="默认分支" value={runSummary.defaultBranch} prefix={<BranchesOutlined />} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card title="仓库列表">
            <Spin spinning={loading || actionLoading}>
              <List
                size="small"
                dataSource={repos}
                locale={{ emptyText: '还没有登记 Deep Wiki 仓库' }}
                renderItem={(item) => (
                  <List.Item
                    style={{
                      cursor: 'pointer',
                      borderRadius: 12,
                      padding: 12,
                      marginBottom: 8,
                      background: item.id === selectedRepoSourceId ? '#eef6ff' : '#fff',
                      border: item.id === selectedRepoSourceId ? '1px solid #91caff' : '1px solid #f0f0f0',
                    }}
                    onClick={() => {
                      setSelectedRepoSourceId(item.id);
                      setSelectedRunId(item.latest_run?.id || undefined);
                      setSelectedPage(null);
                    }}
                  >
                    <Space direction="vertical" size={6} style={{ width: '100%' }}>
                      <Space wrap>
                        <Text strong>{item.repo_slug}</Text>
                        {statusTag(item.latest_run?.runtime_result || item.latest_run?.status || item.status)}
                      </Space>
                      <Text type="secondary">{item.repo_url}</Text>
                      <Space wrap size={[8, 8]}>
                        <Tag color="blue">默认分支 {item.default_branch || '-'}</Tag>
                        <Tag color="cyan">分支 {Number(item.branch_count || 0)}</Tag>
                        <Tag color="green">运行 {Number(item.run_count || 0)}</Tag>
                        <Tag color="gold">同步 {item.sync_result || 'pending'}</Tag>
                      </Space>
                    </Space>
                  </List.Item>
                )}
              />
            </Spin>
          </Card>
        </Col>

        <Col span={6}>
          <Card
            title="运行记录"
            extra={
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateVisible(true)}>
                添加仓库 / 新建任务
              </Button>
            }
          >
            <Spin spinning={loading || actionLoading}>
              {selectedRepo ? (
                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                  <Space wrap size={[8, 8]}>
                    <Tag color="blue">{selectedRepo.repo_slug}</Tag>
                    <Tag color="default">默认分支 {selectedRepo.default_branch || '-'}</Tag>
                  </Space>
                  {availableBranches.length ? (
                    <Select
                      showSearch
                      style={{ width: '100%' }}
                      placeholder="选择分支：筛选下方运行记录并切换详情"
                      optionFilterProp="label"
                      value={repoExplorerBranchFilter === null ? '__all__' : repoExplorerBranchFilter}
                      onChange={(value) => handleRepoExplorerBranchChange(String(value))}
                      options={[
                        { value: '__all__', label: '全部分支（显示该仓库全部运行）' },
                        ...availableBranches.map((item) => ({
                          value: item,
                          label: item,
                        })),
                      ]}
                    />
                  ) : null}
                </Space>
              ) : null}
              <div style={{ height: 12 }} />
              <Table
                size="small"
                rowKey="id"
                pagination={{ pageSize: 8 }}
                dataSource={displayedRuns}
                columns={runColumns}
                rowClassName={(record) => (record.id === selectedRunId ? 'ant-table-row-selected' : '')}
                onRow={(record) => ({
                  onClick: () => {
                    setSelectedRunId(record.id);
                    setSelectedPage(null);
                  },
                })}
              />
            </Spin>
          </Card>
        </Col>

        <Col span={12}>
          <Spin spinning={loading || actionLoading}>
            <Card
              title="运行详情 / Markdown 兼容视图"
              extra={
                runDetail ? (
                  <Space wrap>
                    {relatedDocBundles.length ? (
                      <Button icon={<FileTextOutlined />} onClick={() => onOpenDocBundle?.(relatedDocBundles[0].id)}>
                        继续当前 bundle
                      </Button>
                    ) : null}
                    <Button icon={<FileTextOutlined />} onClick={() => void handleCreateDocBundle()}>
                      新建技术/测试方案
                    </Button>
                    <Button icon={<SyncOutlined />} onClick={() => void handleSyncNow()}>
                      同步更新
                    </Button>
                    <Button icon={<ReloadOutlined />} onClick={() => void handleRetry()}>
                      重新生成
                    </Button>
                    <Button icon={<DatabaseOutlined />} onClick={() => void handleReingest()}>
                      重新入库
                    </Button>
                    <Button
                      icon={<PlayCircleOutlined />}
                      disabled={!runDetail.trace_id}
                      onClick={() => runDetail.trace_id && onOpenRuntimeTrace?.(runDetail.trace_id)}
                    >
                      打开 Runtime
                    </Button>
                    <Button icon={<FileSearchOutlined />} onClick={() => onOpenKnowledge?.()}>
                      打开 Knowledge
                    </Button>
                  </Space>
                ) : null
              }
            >
              {!runDetail ? (
                <Empty description="请选择或创建一个 Deep Wiki 任务" />
              ) : (
                <>
                  <Descriptions bordered size="small" column={2}>
                    <Descriptions.Item label="Trace ID">{runDetail.trace_id}</Descriptions.Item>
                    <Descriptions.Item label="运行状态">{statusTag(runSummary.runtimeResult)}</Descriptions.Item>
                    <Descriptions.Item label="仓库">{runSummary.repoUrl}</Descriptions.Item>
                    <Descriptions.Item label="分支">{String(runDetail.snapshot?.branch || runDetail.branch || '-')}</Descriptions.Item>
                    <Descriptions.Item label="提交">{String(runDetail.snapshot?.commit_sha || runDetail.commit_sha || '-')}</Descriptions.Item>
                    <Descriptions.Item label="输出目录">
                      <Paragraph copyable style={{ marginBottom: 0 }}>
                        {runSummary.outputRoot}
                      </Paragraph>
                    </Descriptions.Item>
                    <Descriptions.Item label="当前阶段">{runDetail.current_stage}</Descriptions.Item>
                    <Descriptions.Item label="页面数">
                      {runDetail.pages.length} / RAG Ready {runDetail.pages.filter((item) => item.ingest_status === 'ready').length}
                    </Descriptions.Item>
                    <Descriptions.Item label="Deep Wiki Provider">{runSummary.researchProvider}</Descriptions.Item>
                    <Descriptions.Item label="Deep Wiki Model">{runSummary.researchModel || 'provider default'}</Descriptions.Item>
                    <Descriptions.Item label="输出档位">{runSummary.outputProfile}</Descriptions.Item>
                    <Descriptions.Item label="图谱档位">
                      {runSummary.diagramProfile} / 图谱 {runSummary.diagramCount}
                    </Descriptions.Item>
                    <Descriptions.Item label="结构化对象">
                      {Number(runSummary.structuredObjectCount)} / 证据覆盖 {Number(runSummary.evidenceCoveragePercent)}%
                    </Descriptions.Item>
                    <Descriptions.Item label="关系数">
                      {Object.values(runSummary.relationCounts).reduce(
                        (sum: number, value: unknown) => sum + getNumberValue(value, 0),
                        0
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="进度">
                      <Space wrap>
                        <Text>{runSummary.progressPercent}%</Text>
                        {runSummary.stalled ? <Tag color="warning">已超时</Tag> : null}
                        {runSummary.queuePosition != null ? (
                          <Tag color={runSummary.queuePosition === 0 ? 'processing' : 'default'}>
                            {runSummary.queuePosition === 0 ? '正在执行' : `排队第 ${runSummary.queuePosition} 位`}
                          </Tag>
                        ) : null}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="预计剩余">{formatEta(runSummary.estimatedRemainingSeconds)}</Descriptions.Item>
                    <Descriptions.Item label="文档任务">
                      {relatedDocBundles.length ? (
                        <Space wrap>
                          {relatedDocBundles.slice(0, 3).map((item) => (
                            <Button key={item.id} size="small" onClick={() => onOpenDocBundle?.(item.id)}>
                              {item.bundle_code}
                            </Button>
                          ))}
                        </Space>
                      ) : (
                        <Text type="secondary">尚未从该 Deep Wiki 衍生文档任务</Text>
                      )}
                    </Descriptions.Item>
                  </Descriptions>

                  <Tabs
                    style={{ marginTop: 16 }}
                    defaultActiveKey="graph"
                    items={[
                      {
                        key: 'graph',
                        label: 'Wiki 图谱',
                        children: (
                          <WikiGraphView
                            graph={runGraph}
                            loading={graphLoading}
                            onOpenPage={(page) => setSelectedPage(page)}
                          />
                        ),
                      },
                      {
                        key: 'pages',
                        label: '页面浏览',
                        children: (
                          <Row gutter={[12, 12]}>
                            <Col span={8}>
                              <Card
                                size="small"
                                title={`Wiki 目录 (${runDetail.pages.length})`}
                                extra={<Text type="secondary">辅助页面浏览</Text>}
                                bodyStyle={{ minHeight: 560, maxHeight: 560, overflow: 'auto' }}
                              >
                                <Space direction="vertical" size={12} style={{ width: '100%' }}>
                                  <Search
                                    allowClear
                                    placeholder="搜索页面标题 / slug / modules"
                                    prefix={<SearchOutlined />}
                                    value={treeQuery}
                                    onChange={(event) => setTreeQuery(event.target.value)}
                                  />
                                  <Space wrap size={[8, 8]}>
                                    <Tag color="blue">全部页面 {runDetail.pages.length}</Tag>
                                    <Tag color="cyan">模块页 {runDetail.pages.filter((item) => item.page_type === 'module').length}</Tag>
                                    <Tag color="gold">图谱 {runDetail.pages.filter((item) => item.page_type === 'diagram').length}</Tag>
                                    <Tag color="green">命中 {treeQuery ? filteredWikiTree.length : wikiTree.length}</Tag>
                                  </Space>
                                  {filteredWikiTree.length ? (
                                    <Tree
                                      showLine
                                      defaultExpandAll
                                      selectedKeys={selectedTreeKeys}
                                      treeData={filteredWikiTree}
                                      onSelect={(_keys: React.Key[], info: { node: WikiTreeNode }) => {
                                        const page = (info.node as WikiTreeNode).page;
                                        if (page) {
                                          setSelectedPage(page);
                                        }
                                      }}
                                    />
                                  ) : (
                                    <Empty description="没有匹配到页面，请换个关键词" />
                                  )}
                                </Space>
                              </Card>
                            </Col>

                            <Col span={16}>
                              <Card
                                size="small"
                                title={selectedPage ? `Markdown 阅读 · ${selectedPage.title}` : 'Markdown 阅读'}
                                extra={selectedPage ? statusTag(selectedPage.ingest_status) : null}
                                bodyStyle={{ minHeight: 560, padding: 0, overflow: 'hidden' }}
                              >
                                {selectedPage ? (
                                  <div>
                                    <div
                                      style={{
                                        padding: '18px 20px 16px',
                                        background: 'linear-gradient(180deg, #fbfdff 0%, #f4f8fc 100%)',
                                        borderBottom: '1px solid #edf2f7',
                                      }}
                                    >
                                      <Space direction="vertical" size={8} style={{ width: '100%' }}>
                                        <Space wrap>
                                          <Tag color="blue">{selectedPage.page_type}</Tag>
                                          <Tag color="processing">{selectedPage.page_slug}</Tag>
                                          {statusTag(selectedPage.ingest_status)}
                                        </Space>
                                        <Title level={4} style={{ margin: 0 }}>
                                          {selectedPage.title}
                                        </Title>
                                        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                                          本地文件：{selectedPage.source_uri}
                                          <br />
                                          知识资产：{selectedPage.knowledge_asset_id || '-'}
                                        </Paragraph>
                                        {selectedPage.object_refs?.length ? (
                                          <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                                            关联对象：{selectedPage.object_refs.length} 个
                                          </Paragraph>
                                        ) : null}
                                        {selectedPageSourceFiles.length ? (
                                          <>
                                            <Divider style={{ margin: '6px 0' }} />
                                            <Space wrap size={[8, 8]}>
                                              {selectedPageSourceFiles.slice(0, 10).map((item) => (
                                                <Tag key={item} color="default">
                                                  {item}
                                                </Tag>
                                              ))}
                                              {selectedPageSourceFiles.length > 10 ? (
                                                <Tag color="default">+{selectedPageSourceFiles.length - 10} more</Tag>
                                              ) : null}
                                            </Space>
                                          </>
                                        ) : null}
                                      </Space>
                                    </div>

                                    <div
                                      style={{
                                        padding: '20px 24px 32px',
                                        maxHeight: 420,
                                        overflow: 'auto',
                                        background: '#ffffff',
                                      }}
                                    >
                                      {pageContent ? (
                                        selectedPage.page_type === 'diagram' ? (
                                          <Space direction="vertical" size={16} style={{ width: '100%' }}>
                                            <MermaidBlock code={pageContent} />
                                            <pre
                                              style={{
                                                whiteSpace: 'pre-wrap',
                                                margin: 0,
                                                padding: 16,
                                                borderRadius: 12,
                                                background: '#0f172a',
                                                color: '#e2e8f0',
                                                overflow: 'auto',
                                              }}
                                            >
                                              {pageContent}
                                            </pre>
                                          </Space>
                                        ) : renderMarkdownBlocks(pageContent)
                                      ) : <Empty description="正在加载页面内容..." />}
                                    </div>
                                  </div>
                                ) : (
                                  <Empty description="请从左侧目录树选择一页" />
                                )}
                              </Card>
                            </Col>
                          </Row>
                        ),
                      },
                      {
                        key: 'mermaid',
                        label: 'Mermaid 总图',
                        children: runGraph?.mermaid ? (
                          <Card
                            size="small"
                            title="Wiki 知识图谱 · Mermaid"
                            extra={
                              <Button
                                size="small"
                                onClick={() => {
                                  void navigator.clipboard.writeText(runGraph.mermaid);
                                  message.success('Mermaid 总图已复制');
                                }}
                              >
                                复制 .mmd
                              </Button>
                            }
                          >
                            <Space direction="vertical" size={16} style={{ width: '100%' }}>
                              <MermaidBlock code={runGraph.mermaid} />
                              <pre
                                style={{
                                  whiteSpace: 'pre-wrap',
                                  margin: 0,
                                  padding: 16,
                                  borderRadius: 12,
                                  background: '#0f172a',
                                  color: '#e2e8f0',
                                  overflow: 'auto',
                                }}
                              >
                                {runGraph.mermaid}
                              </pre>
                            </Space>
                          </Card>
                        ) : (
                          <Empty description="该 run 尚未生成 Mermaid 总图" />
                        ),
                      },
                      {
                        key: 'details',
                        label: '运行详情',
                        children: (
                          <Row gutter={[12, 12]}>
                            <Col span={24}>
                      <Card
                        size="small"
                        title={`方案任务联动 (${relatedDocBundles.length})`}
                        extra={
                          <Space wrap>
                            {relatedDocBundles.length ? (
                              <Button size="small" icon={<FileTextOutlined />} onClick={() => onOpenDocBundle?.(relatedDocBundles[0].id)}>
                                继续当前 bundle
                              </Button>
                            ) : null}
                            <Button size="small" type="primary" icon={<FileTextOutlined />} onClick={() => void handleCreateDocBundle()}>
                              新建技术/测试方案任务
                            </Button>
                          </Space>
                        }
                      >
                        <List
                          size="small"
                          dataSource={relatedDocBundles}
                          locale={{ emptyText: '当前 Deep Wiki 还没有衍生文档任务。点击右上角按钮后，就可以在文档门禁页上传 PRD 并生成技术/测试方案。' }}
                          renderItem={(item) => (
                            <List.Item
                              actions={[
                                <Button key="open" size="small" onClick={() => onOpenDocBundle?.(item.id)}>
                                  打开工作台
                                </Button>,
                              ]}
                            >
                              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                                <Space wrap>
                                  <Text strong>{item.bundle_code}</Text>
                                  {statusTag(item.status)}
                                  <Tag color="purple">{item.workflow_mode === 'generate_tech_spec' ? '生成技术方案' : item.workflow_mode || '-'}</Tag>
                                </Space>
                                <Text type="secondary">
                                  {item.title} · 当前阶段 {item.current_stage || '-'} · 项目 {item.project_code || '-'}
                                </Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      </Card>
                            </Col>

                            <Col span={24}>
                      <Card
                        size="small"
                        title="自动同步设置"
                        extra={
                          <Space size={16}>
                            <Text type="secondary">
                              <LinkOutlined /> Webhook: {runSummary.webhookUrl}
                            </Text>
                            <Button size="small" type="primary" icon={<SyncOutlined />} onClick={() => void handleSaveSyncConfig()}>
                              保存配置
                            </Button>
                          </Space>
                        }
                      >
                        <Form form={syncForm} layout="vertical">
                          <Row gutter={12}>
                            <Col span={6}>
                              <Form.Item label="启用自动同步" name="enabled" valuePropName="checked">
                                <Switch />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item label="分支策略" name="branch">
                                <Input placeholder="留空则自动解析默认分支" />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item label="轮询间隔(分钟)" name="interval_minutes">
                                <InputNumber min={5} max={1440} style={{ width: '100%' }} />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item label="自动入库" name="auto_ingest" valuePropName="checked">
                                <Switch />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item label="Webhook Secret" name="webhook_secret">
                                <Input.Password placeholder="可选，给 Git Webhook 留口令" />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item label="项目编码" name="project_code">
                                <Input placeholder="例如 lime-server / C04" />
                              </Form.Item>
                            </Col>
                            <Col span={8}>
                              <Form.Item label="同步偏好" name="focus_prompt">
                                <Input placeholder="例如更关注架构、接口、部署" />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item label="Deep Wiki Provider" name="research_provider">
                                <Select
                                  allowClear
                                  placeholder="默认 provider"
                                  options={providers.filter((item) => item.enabled !== false).map((item) => ({
                                    value: item.key,
                                    label: item.label,
                                  }))}
                                  onChange={(value) => {
                                    void loadModels(String(value || ''));
                                  }}
                                />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item label="Deep Wiki Model" name="research_model">
                                <Select
                                  allowClear
                                  showSearch
                                  placeholder="默认模型"
                                  optionFilterProp="label"
                                  options={models.map((item) => ({
                                    value: item.value,
                                    label: item.label,
                                  }))}
                                />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item label="输出档位" name="output_profile">
                                <Select
                                  options={[
                                    { value: 'engineering_architecture_pack', label: '工程架构包' },
                                  ]}
                                />
                              </Form.Item>
                            </Col>
                            <Col span={6}>
                              <Form.Item label="图谱档位" name="diagram_profile">
                                <Select
                                  options={[
                                    { value: 'full', label: '全量图谱' },
                                    { value: 'core_only', label: '核心图谱' },
                                  ]}
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                        </Form>
                        <Descriptions size="small" column={2} style={{ marginTop: 8 }}>
                          <Descriptions.Item label="最近检查">
                            {String(runSummary.sync.last_checked_at || '-')}
                          </Descriptions.Item>
                          <Descriptions.Item label="最近结果">
                            {statusTag(String(runSummary.sync.last_result || 'pending'))}
                          </Descriptions.Item>
                          <Descriptions.Item label="最近触发">
                            {String(runSummary.sync.last_triggered_at || runSummary.sync.last_noop_at || '-')}
                          </Descriptions.Item>
                          <Descriptions.Item label="最近提交">
                            {String(runSummary.sync.last_commit_sha || '-')}
                          </Descriptions.Item>
                          <Descriptions.Item label="最近分支">
                            {String(runSummary.sync.last_branch || runSummary.defaultBranch || '-')}
                          </Descriptions.Item>
                          <Descriptions.Item label="最近错误">
                            <Text type={runSummary.sync.last_error ? 'danger' : 'secondary'}>
                              {String(runSummary.sync.last_error || '-')}
                            </Text>
                          </Descriptions.Item>
                        </Descriptions>
                      </Card>
                            </Col>

                            <Col span={12}>
                      <Card size="small" title="Preflight 与仓库画像">
                        <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 12 }}>
                          {JSON.stringify(runSummary.preflight || {}, null, 2)}
                        </Paragraph>
                        <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                          {JSON.stringify(runSummary.inventory || {}, null, 2)}
                        </Paragraph>
                      </Card>
                            </Col>

                            <Col span={12}>
                      <Card size="small" title="阶段状态">
                        <List
                          size="small"
                          dataSource={runDetail.nodes}
                          locale={{ emptyText: '暂无节点状态' }}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                                <Space>
                                  <Text strong>{item.node_name}</Text>
                                  {statusTag(item.status)}
                                </Space>
                                <Text type="secondary">{item.output_summary || item.error_message || '-'}</Text>
                                {getRecordObject(runSummary.stageProgress[item.node_key || '']).processed || getRecordObject(runSummary.stageProgress[item.node_key || '']).total ? (
                                  <Text type="secondary">
                                    已处理 {getNumberValue(getRecordObject(runSummary.stageProgress[item.node_key || '']).processed)} /
                                    {getNumberValue(getRecordObject(runSummary.stageProgress[item.node_key || '']).total)}
                                  </Text>
                                ) : null}
                              </Space>
                            </List.Item>
                          )}
                        />
                      </Card>
                            </Col>

                            <Col span={24}>
                      <Card size="small" title="运行日志">
                        <List
                          size="small"
                          dataSource={runSummary.logs}
                          locale={{ emptyText: '暂无日志' }}
                          renderItem={(item) => (
                            <List.Item>
                              <Space direction="vertical" size={0}>
                                <Text>{String(item.message || '-')}</Text>
                                <Text type="secondary">
                                  {String(item.timestamp || '-')} · {String(item.stage || '-')} · {String(item.level || 'info')}
                                </Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      </Card>
                            </Col>
                          </Row>
                        ),
                      },
                    ]}
                  />
                </>
              )}
            </Card>
          </Spin>
        </Col>
      </Row>
    </>
  );
}
