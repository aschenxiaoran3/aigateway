import React, { useEffect, useState } from 'react';
import { Card, Table, Tabs, Tag, message, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { auditApi, knowledgeApi, type AuditEventRow, type KnowledgeAssetRow, type RagQueryLogRow } from '../services/api';

const KnowledgeAudit: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<KnowledgeAssetRow[]>([]);
  const [rag, setRag] = useState<RagQueryLogRow[]>([]);
  const [events, setEvents] = useState<AuditEventRow[]>([]);

  const load = async () => {
    try {
      setLoading(true);
      const [a, r, e] = await Promise.all([
        knowledgeApi.listAssets({}),
        knowledgeApi.listRagQueries(),
        auditApi.listEvents(),
      ]);
      setAssets(a);
      setRag(r);
      setEvents(e);
    } catch (err) {
      console.error(err);
      message.error('加载知识与审计数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="知识与审计"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()}>
            刷新
          </Button>
        }
      >
        <Tabs
          items={[
            {
              key: 'assets',
              label: `知识资产 (${assets.length})`,
              children: (
                <Table<KnowledgeAssetRow>
                  loading={loading}
                  rowKey="id"
                  dataSource={assets}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 80 },
                    { title: '标题', dataIndex: 'title', ellipsis: true },
                    { title: '类型', dataIndex: 'asset_type', width: 120 },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 120,
                      render: (s: string) => <Tag>{s || '-'}</Tag>,
                    },
                    { title: '域', dataIndex: 'domain', width: 120 },
                  ]}
                />
              ),
            },
            {
              key: 'rag',
              label: `RAG 查询 (${rag.length})`,
              children: (
                <Table<RagQueryLogRow>
                  loading={loading}
                  rowKey={(r, i) => String(r.id ?? i)}
                  dataSource={rag}
                  columns={[
                    { title: '项目', dataIndex: 'project_code', width: 140 },
                    { title: '查询', dataIndex: 'query_text', ellipsis: true },
                    { title: '时间', dataIndex: 'created_at', width: 180 },
                  ]}
                />
              ),
            },
            {
              key: 'audit',
              label: `治理审计 (${events.length})`,
              children: (
                <Table<AuditEventRow>
                  loading={loading}
                  rowKey={(r, i) => String(r.id ?? i)}
                  dataSource={events}
                  columns={[
                    { title: '类型', dataIndex: 'event_type', width: 160 },
                    { title: '资源', dataIndex: 'resource_type', width: 140 },
                    { title: '时间', dataIndex: 'created_at', width: 180 },
                  ]}
                />
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default KnowledgeAudit;
