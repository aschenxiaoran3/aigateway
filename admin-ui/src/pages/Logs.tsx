import React, { useEffect, useState } from 'react';
import { Button, Card, Input, Select, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { auditLogsApi, type AuditLogRow } from '../services/api';

const { Text } = Typography;

const Logs: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [clientApp, setClientApp] = useState<string>();
  const [requestId, setRequestId] = useState('');
  const pageSize = 20;

  const load = async (p = page) => {
    try {
      setLoading(true);
      const res = await auditLogsApi.list({
        page: p,
        limit: pageSize,
        client_app: clientApp,
        requestId: requestId || undefined,
      });
      setRows(res.logs);
      setTotal(res.total);
    } catch (e) {
      console.error(e);
      message.error('加载调用日志失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(1);
  }, []);

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="日志查询"
        extra={
          <Space wrap>
            <Select
              allowClear
              placeholder="客户端"
              style={{ width: 160 }}
              value={clientApp}
              onChange={(value) => setClientApp(value)}
              options={[
                { value: 'codex', label: 'codex' },
                { value: 'openclaw', label: 'openclaw' },
                { value: 'cursor', label: 'cursor' },
              ]}
            />
            <Input
              placeholder="request_id"
              style={{ width: 220 }}
              value={requestId}
              onChange={(event) => setRequestId(event.target.value)}
              onPressEnter={() => void load(1)}
            />
            <Button icon={<ReloadOutlined />} onClick={() => void load(1)}>
              刷新
            </Button>
          </Space>
        }
      >
        <Table<AuditLogRow>
          loading={loading}
          rowKey={(r, i) => String(r.id ?? r.request_id ?? i)}
          dataSource={rows}
          scroll={{ x: 1200 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            onChange: (p) => {
              setPage(p);
              void load(p);
            },
          }}
          columns={[
            {
              title: '时间',
              width: 180,
              render: (_, row) => row.timestamp || row.created_at || '-',
            },
            { title: 'request_id', dataIndex: 'request_id', ellipsis: true, width: 280 },
            { title: '模型', dataIndex: 'model', width: 160 },
            { title: '用途', dataIndex: 'purpose', width: 120 },
            { title: '客户端', dataIndex: 'client_app', width: 140 },
            {
              title: '摘要预览',
              width: 420,
              render: (_, row) => (
                <Space direction="vertical" size={0}>
                  <Text type="secondary">{row.request_summary || '-'}</Text>
                  <Text>{row.response_summary || '-'}</Text>
                </Space>
              ),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 90,
              render: (s: number) => (s >= 400 ? <Tag color="error">{s}</Tag> : <Tag color="success">{s}</Tag>),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default Logs;
