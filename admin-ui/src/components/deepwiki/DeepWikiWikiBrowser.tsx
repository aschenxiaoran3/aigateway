import React from 'react';
import {
  Card,
  Descriptions,
  Empty,
  List,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { statusTag } from '../../pages/deepwiki/deepWikiStatus';
import { getRecordObject, getStringArray, stringifyShortJson } from '../../pages/deepwiki/deepWikiUtils';
const { Text } = Typography;
import type { DeepWikiWorkspaceModel } from '../../pages/deepwiki/useDeepWikiWorkspace';

export function DeepWikiWikiBrowser({ workspace }: { workspace: DeepWikiWorkspaceModel }) {
  const {
    selectedSnapshot,
    setSnapshotObjectTypeFilter,
    setSnapshotView,
    snapshotAssertions,
    snapshotConsistencyChecks,
    snapshotFlows,
    snapshotObjectTypeFilter,
    snapshotObjectTypeOptions,
    snapshotObjects,
    snapshotScenarios,
    snapshotSemanticScores,
    snapshotView,
  } = workspace;
  return (
      <Card
        title="项目 Wiki 浏览"
        style={{ marginBottom: 16 }}
        extra={selectedSnapshot ? (
          <Space wrap>
            <Segmented
              size="small"
              value={snapshotView}
              onChange={(value) =>
                setSnapshotView(value as 'objects' | 'flows' | 'assertions' | 'scenarios' | 'scores' | 'consistency')
              }
              options={[
                { label: `Objects ${snapshotObjects.length}`, value: 'objects' },
                { label: `Flows ${snapshotFlows.length}`, value: 'flows' },
                { label: `Assertions ${snapshotAssertions.length}`, value: 'assertions' },
                { label: `Scenarios ${snapshotScenarios.length}`, value: 'scenarios' },
                { label: `Consistency ${snapshotConsistencyChecks.length}`, value: 'consistency' },
                { label: `Scores ${snapshotSemanticScores.length}`, value: 'scores' },
              ]}
            />
            {snapshotView === 'objects' ? (
              <Select
                size="small"
                style={{ width: 180 }}
                value={snapshotObjectTypeFilter}
                onChange={(value) => setSnapshotObjectTypeFilter(value)}
                options={snapshotObjectTypeOptions.map((item) => ({
                  value: item,
                  label: item === 'all' ? '全部对象' : item,
                }))}
              />
            ) : null}
          </Space>
        ) : null}
      >
        {!selectedSnapshot ? (
          <Empty description="请选择项目 snapshot 后浏览项目 Wiki" />
        ) : snapshotView === 'objects' ? (
          <List
            dataSource={snapshotObjects}
            locale={{ emptyText: '当前 snapshot 暂无对象' }}
            renderItem={(item) => {
              const payload = getRecordObject(item.payload_json);
              const sourceFiles = getStringArray(payload.source_files).slice(0, 6);
              return (
                <List.Item>
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color="blue">{String(item.object_type || '-')}</Tag>
                      <Text strong>{String(item.title || item.object_key || '-')}</Text>
                      {statusTag(String(item.status || 'draft'))}
                    </Space>
                    <Text type="secondary">{String(item.object_key || '-')}</Text>
                    {sourceFiles.length ? (
                      <Space wrap>
                        {sourceFiles.map((file) => (
                          <Tag key={file}>{file}</Tag>
                        ))}
                      </Space>
                    ) : null}
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        borderRadius: 12,
                        background: '#f8fafc',
                        color: '#334155',
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {stringifyShortJson(payload)}
                    </pre>
                  </Space>
                </List.Item>
              );
            }}
          />
        ) : snapshotView === 'flows' ? (
          <List
            dataSource={snapshotFlows}
            locale={{ emptyText: '当前 snapshot 暂无 flow' }}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={8} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color="purple">{item.flow_type}</Tag>
                    <Text strong>{item.flow_name}</Text>
                    {statusTag(item.status)}
                  </Space>
                  <Text type="secondary">{item.flow_code}</Text>
                  <List
                    size="small"
                    dataSource={item.steps || []}
                    renderItem={(step) => (
                      <List.Item style={{ paddingInline: 0 }}>
                        <Text>{step.step_order}. {step.step_type} · {step.step_name}</Text>
                      </List.Item>
                    )}
                  />
                </Space>
              </List.Item>
            )}
          />
        ) : snapshotView === 'assertions' ? (
          <List
            dataSource={snapshotAssertions}
            locale={{ emptyText: '当前 snapshot 暂无 assertion' }}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color="gold">{item.assertion_type}</Tag>
                    <Text strong>{item.assertion_code}</Text>
                  </Space>
                  <Text>{item.expression || '-'}</Text>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      borderRadius: 12,
                      background: '#f8fafc',
                      color: '#334155',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {stringifyShortJson(item.expected_result_json || {})}
                  </pre>
                </Space>
              </List.Item>
            )}
          />
        ) : snapshotView === 'scenarios' ? (
          <List
            dataSource={snapshotScenarios}
            locale={{ emptyText: '当前 snapshot 暂无 scenario' }}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color="cyan">{item.status}</Tag>
                    <Text strong>{item.scenario_name}</Text>
                  </Space>
                  <Text type="secondary">{item.scenario_code}</Text>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      borderRadius: 12,
                      background: '#f8fafc',
                      color: '#334155',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {stringifyShortJson({
                      input_fixture_json: item.input_fixture_json || {},
                      expected_assertions_json: item.expected_assertions_json || [],
                      linked_test_asset_object_id: item.linked_test_asset_object_id || null,
                    })}
                  </pre>
                </Space>
              </List.Item>
            )}
          />
        ) : snapshotView === 'consistency' ? (
          <List
            dataSource={snapshotConsistencyChecks}
            locale={{ emptyText: '当前 snapshot 暂无一致性检查记录' }}
            renderItem={(item) => (
              <List.Item>
                <Space direction="vertical" size={6} style={{ width: '100%' }}>
                  <Space wrap>
                    <Tag color={item.issue_level === 'error' ? 'red' : item.issue_level === 'warn' ? 'orange' : 'blue'}>
                      {item.issue_level || 'info'}
                    </Tag>
                    <Tag>{item.check_type}</Tag>
                    <Text strong>{item.issue_code || '-'}</Text>
                    {statusTag(String(item.status || 'pending'))}
                  </Space>
                  <Text type="secondary">
                    score {item.score ?? '-'} · src {item.source_object_type ?? '-'}#{item.source_object_id ?? '-'} → tgt{' '}
                    {item.target_object_type ?? '-'}#{item.target_object_id ?? '-'}
                  </Text>
                  <pre
                    style={{
                      margin: 0,
                      padding: 12,
                      borderRadius: 12,
                      background: '#f8fafc',
                      color: '#334155',
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {stringifyShortJson({
                      detail_json: item.detail_json || {},
                      evidence_json: item.evidence_json || [],
                    })}
                  </pre>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <List
            dataSource={snapshotSemanticScores}
            locale={{ emptyText: '当前 snapshot 暂无语义评分' }}
            renderItem={(item) => (
              <List.Item>
                <Descriptions size="small" column={4} style={{ width: '100%' }}>
                  <Descriptions.Item label="目标">{item.target_type}</Descriptions.Item>
                  <Descriptions.Item label="总分">{item.final_score}</Descriptions.Item>
                  <Descriptions.Item label="状态">{statusTag(item.status)}</Descriptions.Item>
                  <Descriptions.Item label="明细">{stringifyShortJson(item.detail_json || {})}</Descriptions.Item>
                </Descriptions>
              </List.Item>
            )}
          />
        )}
      </Card>
  );
}
