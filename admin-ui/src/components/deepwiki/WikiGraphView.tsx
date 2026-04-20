import React, { useMemo, useState } from 'react';
import { Alert, Button, Card, Checkbox, Col, Descriptions, Empty, Input, List, Row, Select, Space, Statistic, Tag, Typography } from 'antd';
import { FileTextOutlined, LinkOutlined } from '@ant-design/icons';
import type { DeepWikiGraph, DeepWikiGraphEdge, DeepWikiGraphNode, DeepWikiPageRow } from '../../services/api';

const { Paragraph, Text } = Typography;
const { Search } = Input;

const NODE_TYPE_ORDER = ['page', 'diagram', 'domain', 'capability', 'flow', 'journey', 'evidence', 'feature', 'service', 'api', 'table', 'test_asset'];
const NODE_TYPE_LABELS: Record<string, string> = {
  page: '页面',
  diagram: '图谱',
  domain: '业务域',
  capability: '能力',
  flow: '流程',
  journey: '旅程',
  evidence: '证据',
  feature: 'Feature',
  service: 'Service',
  api: 'API',
  table: 'Table',
  test_asset: 'Test',
};
const NODE_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  page: { fill: '#eef5ff', stroke: '#7da4d9', text: '#26456d' },
  diagram: { fill: '#f5edff', stroke: '#9254de', text: '#531dab' },
  domain: { fill: '#eefbf0', stroke: '#52c41a', text: '#237804' },
  capability: { fill: '#fff9e6', stroke: '#d4b106', text: '#876800' },
  flow: { fill: '#fff7e6', stroke: '#fa8c16', text: '#ad4e00' },
  journey: { fill: '#f0f5ff', stroke: '#2f54eb', text: '#1d39c4' },
  evidence: { fill: '#f9f0ff', stroke: '#722ed1', text: '#391085' },
  feature: { fill: '#edf9f1', stroke: '#52c41a', text: '#237804' },
  service: { fill: '#eaf4ff', stroke: '#1677ff', text: '#0958d9' },
  api: { fill: '#fff7e6', stroke: '#fa8c16', text: '#ad4e00' },
  table: { fill: '#e6fffb', stroke: '#13c2c2', text: '#006d75' },
  test_asset: { fill: '#fff1f0', stroke: '#ff4d4f', text: '#a8071a' },
};

type GraphSelection =
  | { kind: 'node'; node: DeepWikiGraphNode }
  | { kind: 'edge'; edge: DeepWikiGraphEdge }
  | null;

function getNodeColor(type: string) {
  return NODE_COLORS[type] || { fill: '#f8fafc', stroke: '#94a3b8', text: '#334155' };
}

function trimLabel(value: string, max = 28) {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function stringifyShort(value: unknown) {
  try {
    return JSON.stringify(value || {}, null, 2).slice(0, 2400);
  } catch {
    return '{}';
  }
}

export function WikiGraphView({
  graph,
  loading,
  onOpenPage,
}: {
  graph: DeepWikiGraph | null;
  loading?: boolean;
  onOpenPage: (page: DeepWikiPageRow) => void;
}) {
  const allNodeTypes = useMemo(() => {
    const values = new Set(NODE_TYPE_ORDER);
    (graph?.nodes || []).forEach((node) => values.add(node.type));
    return Array.from(values);
  }, [graph?.nodes]);
  const [enabledTypes, setEnabledTypes] = useState<string[]>(NODE_TYPE_ORDER);
  const [relationTypes, setRelationTypes] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<GraphSelection>(null);

  const relationOptions = useMemo(() => {
    const values = Array.from(new Set((graph?.edges || []).map((edge) => edge.type).filter(Boolean)));
    return values.map((value) => ({ value, label: value.replace(/_/g, ' ') }));
  }, [graph?.edges]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const enabled = new Set(enabledTypes.length ? enabledTypes : allNodeTypes);
    const nodes = (graph?.nodes || []).filter((node) => {
      if (!enabled.has(node.type)) return false;
      if (!normalizedQuery) return true;
      const haystack = [
        node.id,
        node.label,
        node.title,
        ...(node.source_files || []),
        ...(node.source_apis || []),
        ...(node.source_tables || []),
        ...(node.page_slugs || []),
      ].join(' ').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
    const nodeIds = new Set(nodes.map((node) => node.id));
    const relationFilter = new Set(relationTypes);
    const edges = (graph?.edges || []).filter((edge) => {
      if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return false;
      if (relationFilter.size && !relationFilter.has(edge.type)) return false;
      return true;
    });
    return { nodes, edges };
  }, [allNodeTypes, enabledTypes, graph?.edges, graph?.nodes, query, relationTypes]);

  const layout = useMemo(() => {
    const grouped = new Map<string, DeepWikiGraphNode[]>();
    filtered.nodes.forEach((node) => {
      const key = NODE_TYPE_ORDER.includes(node.type) ? node.type : 'feature';
      const bucket = grouped.get(key) || [];
      bucket.push(node);
      grouped.set(key, bucket);
    });
    const positions = new Map<string, { x: number; y: number }>();
    const width = Math.max(1180, NODE_TYPE_ORDER.length * 170 + 120);
    const columnGap = 170;
    const rowGap = 86;
    const left = 72;
    const top = 72;
    let maxRows = 1;
    NODE_TYPE_ORDER.forEach((type, columnIndex) => {
      const bucket = (grouped.get(type) || []).slice(0, 28);
      maxRows = Math.max(maxRows, bucket.length || 1);
      bucket.forEach((node, rowIndex) => {
        positions.set(node.id, {
          x: left + columnIndex * columnGap,
          y: top + rowIndex * rowGap,
        });
      });
    });
    const height = Math.max(520, top * 2 + maxRows * rowGap);
    return { width, height, positions };
  }, [filtered.nodes]);

  const nodeById = useMemo(() => new Map((graph?.nodes || []).map((node) => [node.id, node])), [graph?.nodes]);
  const selectedNode = selection?.kind === 'node' ? selection.node : null;
  const selectedEdge = selection?.kind === 'edge' ? selection.edge : null;

  if (!graph && !loading) {
    return <Empty description="该 run 尚未生成 Wiki Graph，请重新生成或执行 graph backfill" />;
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {graph?.warnings?.length ? (
        <Alert
          type="warning"
          showIcon
          message="Wiki Graph 需要补齐"
          description={graph.warnings.join('；')}
        />
      ) : null}

      <Row gutter={[12, 12]}>
        <Col span={6}>
          <Card size="small">
            <Statistic title="节点" value={graph?.summary.node_count || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="关系" value={graph?.summary.edge_count || 0} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic title="对象类型" value={Object.keys(graph?.summary.object_counts || {}).length} />
          </Card>
        </Col>
        <Col span={6}>
          <Card size="small">
            <Statistic
              title="证据覆盖"
              value={Number(graph?.summary.evidence_coverage?.percent || 0)}
              suffix="%"
              precision={1}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col span={5}>
          <Card size="small" title="过滤器" bodyStyle={{ minHeight: 560 }}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <Search allowClear placeholder="搜索节点 / 文件 / API / 表" value={query} onChange={(event) => setQuery(event.target.value)} />
              <div>
                <Text type="secondary">节点类型</Text>
                <Checkbox.Group
                  style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}
                  value={enabledTypes}
                  onChange={(values) => setEnabledTypes(values.map(String))}
                  options={allNodeTypes.map((type) => ({
                    value: type,
                    label: NODE_TYPE_LABELS[type] || type,
                  }))}
                />
              </div>
              <div>
                <Text type="secondary">关系类型</Text>
                <Select
                  mode="multiple"
                  allowClear
                  style={{ width: '100%', marginTop: 8 }}
                  placeholder="全部关系"
                  value={relationTypes}
                  options={relationOptions}
                  onChange={setRelationTypes}
                />
              </div>
              <Space wrap size={[6, 6]}>
                {Object.entries(graph?.summary.object_counts || {}).map(([type, count]) => (
                  <Tag key={type} color={getNodeColor(type).stroke}>
                    {NODE_TYPE_LABELS[type] || type} {count}
                  </Tag>
                ))}
              </Space>
            </Space>
          </Card>
        </Col>

        <Col span={13}>
          <Card
            size="small"
            title={`Wiki Graph (${filtered.nodes.length} nodes / ${filtered.edges.length} edges)`}
            loading={loading}
            bodyStyle={{ padding: 0, overflow: 'auto', background: '#f8fbff' }}
          >
            {filtered.nodes.length ? (
              <svg width="100%" height={Math.min(layout.height, 760)} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img">
                <defs>
                  <marker id="wiki-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                    <path d="M0,0 L8,4 L0,8 z" fill="#94a3b8" />
                  </marker>
                </defs>
                {filtered.edges.map((edge) => {
                  const source = layout.positions.get(edge.source);
                  const target = layout.positions.get(edge.target);
                  if (!source || !target) return null;
                  const fallback = edge.metadata?.source === 'fallback_index';
                  return (
                    <g key={edge.id} style={{ cursor: 'pointer' }} onClick={() => setSelection({ kind: 'edge', edge })}>
                      <line
                        x1={source.x + 56}
                        y1={source.y}
                        x2={target.x - 56}
                        y2={target.y}
                        stroke={fallback ? '#cbd5e1' : '#94a3b8'}
                        strokeWidth={selection?.kind === 'edge' && selection.edge.id === edge.id ? 3 : 1.5}
                        strokeDasharray={fallback ? '6 5' : undefined}
                        markerEnd="url(#wiki-graph-arrow)"
                      />
                      <line
                        x1={source.x + 56}
                        y1={source.y}
                        x2={target.x - 56}
                        y2={target.y}
                        stroke="transparent"
                        strokeWidth={12}
                      />
                    </g>
                  );
                })}
                {filtered.nodes.map((node) => {
                  const position = layout.positions.get(node.id);
                  if (!position) return null;
                  const colors = getNodeColor(node.type);
                  const active = selection?.kind === 'node' && selection.node.id === node.id;
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${position.x - 58}, ${position.y - 28})`}
                      style={{ cursor: 'pointer' }}
                      onClick={() => {
                        setSelection({ kind: 'node', node });
                        if (node.type === 'page' || node.type === 'diagram') {
                          const pageId = Number(node.payload?.page_id);
                          const pageSlug = String(node.payload?.page_slug || '');
                          const page = (graph?.pages || []).find((item) => Number(item.id) === pageId || item.page_slug === pageSlug);
                          if (page) onOpenPage(page);
                        }
                      }}
                    >
                      <rect
                        width={116}
                        height={56}
                        rx={14}
                        fill={colors.fill}
                        stroke={active ? '#111827' : colors.stroke}
                        strokeWidth={active ? 2.5 : 1.5}
                      />
                      <text x={58} y={23} textAnchor="middle" fill={colors.text} style={{ fontSize: 12, fontWeight: 700 }}>
                        {trimLabel(node.label, 18)}
                      </text>
                      <text x={58} y={41} textAnchor="middle" fill="#64748b" style={{ fontSize: 10 }}>
                        {NODE_TYPE_LABELS[node.type] || node.type}
                      </text>
                    </g>
                  );
                })}
              </svg>
            ) : (
              <Empty style={{ padding: 80 }} description="当前过滤条件下没有可展示节点" />
            )}
          </Card>
        </Col>

        <Col span={6}>
          <Card size="small" title="节点 / 关系详情" bodyStyle={{ minHeight: 560, maxHeight: 760, overflow: 'auto' }}>
            {!selection ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="点击图上的节点或关系查看详情" />
            ) : selectedNode ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag color={getNodeColor(selectedNode.type).stroke}>{NODE_TYPE_LABELS[selectedNode.type] || selectedNode.type}</Tag>
                  {selectedNode.status ? <Tag>{selectedNode.status}</Tag> : null}
                </Space>
                <Text strong>{selectedNode.title || selectedNode.label}</Text>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="ID">{selectedNode.id}</Descriptions.Item>
                  <Descriptions.Item label="置信度">{selectedNode.confidence ?? '-'}</Descriptions.Item>
                  <Descriptions.Item label="证据">{selectedNode.evidence_count ?? 0}</Descriptions.Item>
                </Descriptions>
                {(selectedNode.page_slugs || []).length ? (
                  <Space direction="vertical" size={4}>
                    <Text type="secondary">关联页面</Text>
                    {(selectedNode.page_slugs || []).map((slug) => (
                      <Button
                        key={slug}
                        size="small"
                        icon={<FileTextOutlined />}
                        onClick={() => {
                          const page = (graph?.pages || []).find((item) => item.page_slug === slug);
                          if (page) onOpenPage(page);
                        }}
                      >
                        {slug}
                      </Button>
                    ))}
                  </Space>
                ) : null}
                {(selectedNode.source_files || []).length ? (
                  <List
                    size="small"
                    header="Source Files"
                    dataSource={(selectedNode.source_files || []).slice(0, 12)}
                    renderItem={(item) => <List.Item>{item}</List.Item>}
                  />
                ) : null}
                <Paragraph style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 10 }}>
                  {stringifyShort(selectedNode.payload)}
                </Paragraph>
              </Space>
            ) : selectedEdge ? (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Space wrap>
                  <Tag icon={<LinkOutlined />} color={selectedEdge.metadata?.source === 'fallback_index' ? 'warning' : 'blue'}>
                    {selectedEdge.type}
                  </Tag>
                </Space>
                <Descriptions size="small" column={1}>
                  <Descriptions.Item label="Source">{nodeById.get(selectedEdge.source)?.label || selectedEdge.source}</Descriptions.Item>
                  <Descriptions.Item label="Target">{nodeById.get(selectedEdge.target)?.label || selectedEdge.target}</Descriptions.Item>
                  <Descriptions.Item label="Source Type">{String(selectedEdge.metadata?.source || '-')}</Descriptions.Item>
                </Descriptions>
                <Paragraph style={{ whiteSpace: 'pre-wrap', background: '#f8fafc', padding: 12, borderRadius: 10 }}>
                  {stringifyShort(selectedEdge.metadata)}
                </Paragraph>
              </Space>
            ) : null}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
