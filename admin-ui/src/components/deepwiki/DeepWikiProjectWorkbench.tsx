import React, { useMemo, useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import { getRecordObject } from '../../pages/deepwiki/deepWikiUtils';
import { statusTag } from '../../pages/deepwiki/deepWikiStatus';
import { deepWikiApi } from '../../services/api';
import type { DeepWikiWorkspaceModel } from '../../pages/deepwiki/useDeepWikiWorkspace';

const { Text } = Typography;

const PROJECT_REPO_ROLE_OPTIONS = [
  { value: 'frontend', label: 'frontend' },
  { value: 'backend', label: 'backend' },
  { value: 'bff', label: 'bff' },
  { value: 'shared_lib', label: 'shared_lib' },
  { value: 'test_automation', label: 'test_automation' },
  { value: 'infra', label: 'infra' },
  { value: 'service', label: 'service' },
];

export function DeepWikiProjectWorkbench({ workspace }: { workspace: DeepWikiWorkspaceModel }) {
  const {
    actionLoading,
    branchMappingDraft,
    handleAddRepoToProject,
    handleBootstrapProjects,
    handleRegenerateProject,
    handleSaveBranchMappings,
    projectBranches,
    projectCreateForm,
    projectRepoBranchesLoading,
    projectRepoOptions,
    projectSnapshots,
    repoBranchOptionsBySourceId,
    setSelectedPage,
    projects,
    selectedBranch,
    selectedBranchName,
    selectedProject,
    selectedProjectId,
    selectedSnapshot,
    selectedSnapshotId,
    setBranchMappingDraft,
    setProjectCreateVisible,
    setSelectedBranchName,
    setSelectedProjectId,
    setSelectedSnapshotId,
    setSelectedRepoSourceId,
    setSelectedRunId,
    snapshotQuality,
    snapshotRepoRevisions,
    wikiFeedbackEvents,
    wikiFeedbackLoading,
    reloadWikiFeedbackEvents,
  } = workspace;
  const [feedbackForm] = Form.useForm<{ pipeline_type: string; feedback_type: string; note?: string }>();
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [addRepoModalOpen, setAddRepoModalOpen] = useState(false);
  const [addRepoForm] = Form.useForm<{
    mode: 'existing' | 'url';
    repo_source_id?: number;
    repo_url?: string;
    repo_role: string;
    branch?: string;
    is_primary?: boolean;
  }>();
  const addRepoMode = Form.useWatch('mode', addRepoForm) ?? 'existing';

  const addRepoSelectOptions = useMemo(() => {
    const bound = new Set(
      (selectedProject?.repos || [])
        .map((r) => Number(r.repo_source_id ?? r.repo_source?.id ?? 0))
        .filter((id) => id > 0)
    );
    return projectRepoOptions.filter((o) => !bound.has(Number(o.value)));
  }, [projectRepoOptions, selectedProject?.repos]);

  const handleFeedbackFinish = async (values: { pipeline_type: string; feedback_type: string; note?: string }) => {
    if (!selectedProjectId) {
      message.warning('请先选择项目');
      return;
    }
    const pipelineType = String(values.pipeline_type || '').trim() || 'wiki_quality';
    setFeedbackSubmitting(true);
    try {
      await deepWikiApi.createFeedbackEvent(pipelineType, {
        project_id: selectedProjectId,
        snapshot_id: selectedSnapshotId ?? undefined,
        feedback_type: String(values.feedback_type || '').trim() || pipelineType,
        payload_json: values.note?.trim() ? { note: values.note.trim() } : {},
      });
      message.success('反馈已记录');
      feedbackForm.resetFields();
      await reloadWikiFeedbackEvents();
    } catch (error: unknown) {
      const msg =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error as Error)?.message ||
        '提交失败';
      message.error(msg);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const submitAddRepo = async () => {
    try {
      const values = await addRepoForm.validateFields();
      const ok = await handleAddRepoToProject(values);
      if (ok) {
        setAddRepoModalOpen(false);
        addRepoForm.resetFields();
      }
    } catch {
      /* validateFields */
    }
  };

  return (
    <>
      <Card
        title="项目工作台"
        style={{ marginBottom: 16 }}
        extra={(
          <Space>
            <Button
              icon={<PlusOutlined />}
              onClick={() => {
                projectCreateForm.setFieldsValue({
                  default_branch: selectedBranchName || 'main',
                  repo_bindings: [{ repo_role: 'frontend', is_primary: true }],
                });
                setProjectCreateVisible(true);
              }}
            >
              新建项目
            </Button>
            <Button icon={<SyncOutlined />} loading={actionLoading} onClick={() => void handleBootstrapProjects()}>
              初始化项目数据
            </Button>
            <Select
              style={{ width: 220 }}
              placeholder="选择项目"
              value={selectedProjectId}
              onChange={(value) => {
                setSelectedProjectId(value);
                setSelectedBranchName(undefined);
                setSelectedSnapshotId(undefined);
              }}
              options={projects.map((item) => ({
                value: item.id,
                label: `${item.project_name} (${item.project_code})`,
              }))}
            />
            <Select
              style={{ width: 180 }}
              placeholder="选择分支"
              value={selectedBranchName}
              onChange={(value) => setSelectedBranchName(value)}
              options={projectBranches.map((item) => ({
                value: item.branch,
                label: item.display_name || item.branch,
              }))}
            />
            <Button type="primary" icon={<ReloadOutlined />} loading={actionLoading} onClick={() => void handleRegenerateProject()}>
              项目级重生成
            </Button>
          </Space>
        )}
      >
        <Alert
          type="info"
          showIcon
          message="项目级 Deep Wiki：多仓与版本"
          description={
            <span>
              ① 在本项目下绑定多个仓库（「添加仓库」）。② 先选择协调分支，再在「分支映射与版本」中为每个仓库从下拉选择或手动输入参与生成的 Git 分支，点击「保存映射」。③ 最后点击「项目级重生成」；请求携带当前各仓分支，与后端多仓 manifest 一致。各仓分支列表来自远端；若拉取失败，仍可手动输入分支名。
            </span>
          }
          style={{ marginBottom: 16 }}
        />
        <Row gutter={16}>
          <Col span={7}>
            <Card
              size="small"
              title="项目与多仓绑定"
              extra={
                selectedProjectId ? (
                  <Button
                    size="small"
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      addRepoForm.setFieldsValue({
                        mode: addRepoSelectOptions.length ? 'existing' : 'url',
                        repo_role: 'backend',
                        is_primary: false,
                        branch: selectedBranchName || selectedProject?.default_branch || '',
                      });
                      setAddRepoModalOpen(true);
                    }}
                  >
                    添加仓库
                  </Button>
                ) : null
              }
              bodyStyle={{ padding: 12 }}
            >
              {selectedProject ? (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <Descriptions size="small" column={1}>
                    <Descriptions.Item label="项目">{selectedProject.project_name}</Descriptions.Item>
                    <Descriptions.Item label="项目编码">{selectedProject.project_code}</Descriptions.Item>
                    <Descriptions.Item label="默认分支">{selectedProject.default_branch || '-'}</Descriptions.Item>
                    <Descriptions.Item label="仓库数">{selectedProject.repo_count || selectedProject.repos?.length || 0}</Descriptions.Item>
                  </Descriptions>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    各仓库用于生成的分支在右侧「分支映射」中选择或填写。
                  </Text>
                  <List
                    size="small"
                    dataSource={selectedProject.repos || []}
                    locale={{ emptyText: '暂无绑定仓库' }}
                    renderItem={(item) => (
                      <List.Item>
                        <Space direction="vertical" size={2} style={{ width: '100%' }}>
                          <Space wrap>
                            <Tag color={item.repo_role === 'frontend' ? 'blue' : item.repo_role === 'backend' ? 'green' : 'default'}>
                              {item.repo_role}
                            </Tag>
                            {item.is_primary ? <Tag color="gold">primary</Tag> : null}
                          </Space>
                          <Text strong>{item.repo_source?.repo_slug || item.repo_slug}</Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {item.repo_source?.repo_url || item.repo_url}
                          </Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                </Space>
              ) : (
                <Empty
                  description="暂无项目。你可以先新建一个前后端多仓项目，或把现有 Deep Wiki runs 回填到项目级视图"
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                >
                  <Space>
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        projectCreateForm.setFieldsValue({
                          default_branch: 'main',
                          repo_bindings: [{ repo_role: 'frontend', is_primary: true }],
                        });
                        setProjectCreateVisible(true);
                      }}
                    >
                      新建项目
                    </Button>
                    <Button icon={<SyncOutlined />} loading={actionLoading} onClick={() => void handleBootstrapProjects()}>
                      初始化项目数据
                    </Button>
                  </Space>
                </Empty>
              )}
            </Card>
          </Col>
          <Col span={7}>
            <Card
              size="small"
              title="分支映射与版本"
              bodyStyle={{ padding: 12 }}
              extra={selectedBranch?.id ? (
                <Button size="small" type="primary" loading={actionLoading} onClick={() => void handleSaveBranchMappings()}>
                  保存映射
                </Button>
              ) : null}
            >
              <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div>
                  <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                    协调分支
                  </Text>
                  <Select
                    style={{ width: '100%' }}
                    showSearch
                    optionFilterProp="label"
                    placeholder={projectBranches.length ? '选择协调分支' : '暂无分支'}
                    value={selectedBranchName}
                    onChange={(value) => setSelectedBranchName(value)}
                    options={projectBranches.map((item) => ({
                      value: item.branch,
                      label: `${item.display_name || item.branch}${item.published_snapshot ? ' · published' : ' · draft'} · snapshot ${item.snapshot_count || 0}`,
                    }))}
                  />
                </div>
              </Space>
              {selectedBranch && selectedProject?.repos?.length ? (
                <>
                  <Divider style={{ margin: '12px 0' }} />
                  <Spin spinning={projectRepoBranchesLoading}>
                    <Space direction="vertical" size={10} style={{ width: '100%' }}>
                    {(selectedProject.repos || []).map((repo) => {
                      const mapping = selectedBranch.repo_mappings?.find(
                        (item) => Number(item.project_repo_id) === Number(repo.id)
                      );
                      const sourceId = Number(repo.repo_source_id ?? repo.repo_source?.id ?? 0);
                      const branchOptions = Number.isFinite(sourceId) && sourceId > 0
                        ? repoBranchOptionsBySourceId[sourceId] ?? []
                        : [];
                      const draftValue = branchMappingDraft[repo.id] || '';
                      return (
                        <div key={repo.id}>
                          <Text strong>{repo.repo_source?.repo_slug || repo.repo_slug}</Text>
                          <AutoComplete
                            style={{ width: '100%', marginTop: 6 }}
                            value={draftValue}
                            placeholder={
                              branchOptions.length
                                ? '选择或输入该仓库分支'
                                : '远端分支未加载时可手动输入分支名'
                            }
                            options={branchOptions.map((name) => ({ value: name, label: name }))}
                            filterOption={(inputValue, option) =>
                              String(option?.value ?? '')
                                .toLowerCase()
                                .includes(String(inputValue).toLowerCase())
                            }
                            onChange={(value) => {
                              setBranchMappingDraft((current) => ({
                                ...current,
                                [repo.id]: String(value ?? ''),
                              }));
                            }}
                          />
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            role: {repo.repo_role} · 当前映射:{' '}
                            {String(
                              mapping?.repo_branch_name ||
                                getRecordObject(repo.metadata_json).default_branch ||
                                repo.repo_source?.default_branch ||
                                '-'
                            )}
                          </Text>
                        </div>
                      );
                    })}
                    </Space>
                  </Spin>
                </>
              ) : null}
            </Card>
          </Col>
          <Col span={10}>
            <Card size="small" title="Snapshot 与质量状态" bodyStyle={{ padding: 12 }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Select
                  style={{ width: '100%' }}
                  placeholder="选择 snapshot"
                  value={selectedSnapshotId}
                  onChange={(value) => {
                    setSelectedSnapshotId(value);
                    const snap = projectSnapshots.find((item) => item.id === value);
                    if (snap?.run_id) {
                      setSelectedRunId(Number(snap.run_id));
                    }
                    if (snap?.repo_source_id) {
                      setSelectedRepoSourceId(Number(snap.repo_source_id));
                    }
                    setSelectedPage(null);
                  }}
                  options={projectSnapshots.map((item) => ({
                    value: item.id,
                    label: `${item.branch} @ ${item.commit_sha?.slice(0, 12) || '-'} · ${item.status || item.publish_status || 'draft'}`,
                  }))}
                />
                {selectedSnapshot ? (
                  <>
                    <Descriptions size="small" column={2}>
                      <Descriptions.Item label="版本">{selectedSnapshot.snapshot_version}</Descriptions.Item>
                      <Descriptions.Item label="发布状态">{statusTag(selectedSnapshot.status || selectedSnapshot.publish_status || undefined)}</Descriptions.Item>
                      <Descriptions.Item label="分支">{selectedSnapshot.branch}</Descriptions.Item>
                      <Descriptions.Item label="提交">{selectedSnapshot.commit_sha?.slice(0, 12) || '-'}</Descriptions.Item>
                      <Descriptions.Item label="运行">{selectedSnapshot.run_status || '-'}</Descriptions.Item>
                      <Descriptions.Item label="质量">{statusTag(snapshotQuality?.status || selectedSnapshot.quality_status || 'pending')}</Descriptions.Item>
                    </Descriptions>
                    <List
                      size="small"
                      header={<Text strong>Snapshot Repo Revisions</Text>}
                      dataSource={snapshotRepoRevisions}
                      locale={{ emptyText: '暂无 repo revision' }}
                      renderItem={(item) => (
                        <List.Item>
                          <Space direction="vertical" size={2}>
                            <Space wrap>
                              <Tag color="blue">{item.repo_role}</Tag>
                              <Text strong>{item.repo_slug}</Text>
                            </Space>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {item.branch_name} @ {item.commit_sha?.slice(0, 12)}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  </>
                ) : (
                  <Empty description="请选择 snapshot" />
                )}
              </Space>
            </Card>
          </Col>
        </Row>
        {selectedProjectId ? (
          <Card size="small" title="管道反馈" style={{ marginTop: 16 }}>
            <Text type="secondary" style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
              来自控制平面 gateway_wiki_feedback_events 表；列表随当前 snapshot 筛选变化。提交将调用 POST /api/v1/deepwiki/feedback/:pipelineType。
            </Text>
            <Form
              form={feedbackForm}
              layout="vertical"
              initialValues={{ pipeline_type: 'wiki_quality', feedback_type: 'wiki_quality' }}
              onFinish={(values) => void handleFeedbackFinish(values)}
              style={{ marginBottom: 16 }}
            >
              <Row gutter={12}>
                <Col span={8}>
                  <Form.Item
                    name="pipeline_type"
                    label="管道类型 (URL 段)"
                    rules={[{ required: true, message: '填写 pipeline 标识' }]}
                  >
                    <Input placeholder="例如 wiki_quality" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="feedback_type" label="反馈类型">
                    <Input placeholder="默认同管道类型" />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item label=" " colon={false}>
                    <Button type="primary" htmlType="submit" loading={feedbackSubmitting}>
                      提交反馈
                    </Button>
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="note" label="备注 (写入 payload_json.note)">
                <Input.TextArea rows={2} placeholder="可选：说明问题或建议" />
              </Form.Item>
            </Form>
            {wikiFeedbackLoading ? (
              <Spin />
            ) : wikiFeedbackEvents.length ? (
              <Timeline
                items={wikiFeedbackEvents.map((ev) => ({
                  color: 'blue',
                  children: (
                    <Space direction="vertical" size={0}>
                      <Text strong>
                        {ev.feedback_type} · {ev.status}
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {ev.source_pipeline} · snapshot {ev.snapshot_id ?? '-'} · {ev.created_at || '-'}
                      </Text>
                    </Space>
                  ),
                }))}
              />
            ) : (
              <Empty description="暂无反馈事件" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        ) : null}
      </Card>

      <Modal
        title="向项目添加仓库"
        open={addRepoModalOpen}
        onCancel={() => {
          setAddRepoModalOpen(false);
          addRepoForm.resetFields();
        }}
        onOk={() => void submitAddRepo()}
        confirmLoading={actionLoading}
        destroyOnClose
        width={560}
      >
        <Form form={addRepoForm} layout="vertical" initialValues={{ mode: 'existing', repo_role: 'backend', is_primary: false }}>
          <Form.Item name="mode" label="来源">
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              onChange={() => {
                addRepoForm.setFieldsValue({ repo_source_id: undefined, repo_url: undefined });
              }}
            >
              <Radio value="existing">已登记仓库</Radio>
              <Radio value="url">通过 clone URL</Radio>
            </Radio.Group>
          </Form.Item>
          {addRepoMode === 'url' ? (
            <Form.Item name="repo_url" label="仓库 URL" rules={[{ required: true, message: '请输入 clone URL' }]}>
              <Input placeholder="https://git.example.com/org/repo.git" />
            </Form.Item>
          ) : (
            <Form.Item
              name="repo_source_id"
              label="仓库"
              rules={[{ required: true, message: '请选择仓库' }]}
              extra={addRepoSelectOptions.length ? undefined : '当前无未绑定仓库，请切换到「通过 clone URL」'}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="选择已登记的 repo_source"
                options={addRepoSelectOptions}
                disabled={!addRepoSelectOptions.length}
              />
            </Form.Item>
          )}
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="repo_role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
                <Select options={PROJECT_REPO_ROLE_OPTIONS} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="branch" label="默认分支（可选）">
                <Input placeholder="留空则跟项目协调分支" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="is_primary" label="Primary" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
