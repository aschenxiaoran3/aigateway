import React, { useEffect, useState } from 'react';
import { Button, Card, Table, Tabs, Tag, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  gateApi,
  type GateEngineLogRow,
  type GateExecutionRow,
  type GateRuleRow,
} from '../services/api';

export type GateConfigProps = {
  onOpenRuntimeTrace?: (traceId: string) => void;
  onOpenProject?: (projectCode: string) => void;
  onOpenEvidence?: (projectCode: string, traceId?: string) => void;
};

const GateConfig: React.FC<GateConfigProps> = ({
  onOpenRuntimeTrace,
  onOpenProject: _onOpenProject,
  onOpenEvidence: _onOpenEvidence,
}) => {
  const [tab, setTab] = useState('rules');
  const [loading, setLoading] = useState(false);
  const [rules, setRules] = useState<GateRuleRow[]>([]);
  const [executions, setExecutions] = useState<GateExecutionRow[]>([]);
  const [engineLogs, setEngineLogs] = useState<GateEngineLogRow[]>([]);

  const loadRules = async () => {
    const data = await gateApi.listRules();
    setRules(data);
  };

  const loadExec = async () => {
    const data = await gateApi.listExecutions({ limit: 100 });
    setExecutions(data);
  };

  const loadEngine = async () => {
    const { rows } = await gateApi.listEngineLogs({ page: 1, pageSize: 100 });
    setEngineLogs(rows);
  };

  const refresh = async () => {
    try {
      setLoading(true);
      if (tab === 'rules') await loadRules();
      else if (tab === 'exec') await loadExec();
      else await loadEngine();
    } catch (e) {
      console.error(e);
      message.error('加载门禁数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [tab]);

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="门禁治理"
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        }
      >
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k)}
          items={[
            {
              key: 'rules',
              label: '规则',
              children: (
                <Table<GateRuleRow>
                  loading={loading}
                  rowKey="id"
                  dataSource={rules}
                  scroll={{ x: 900 }}
                  columns={[
                    { title: 'ID', dataIndex: 'id', width: 70 },
                    { title: '类型', dataIndex: 'gate_type', width: 120 },
                    { title: '名称', dataIndex: 'gate_name', width: 200 },
                    { title: '版本', dataIndex: 'version', width: 100 },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 100,
                      render: (s: string) => <Tag color={s === 'active' ? 'green' : 'default'}>{s || '-'}</Tag>,
                    },
                  ]}
                />
              ),
            },
            {
              key: 'exec',
              label: '执行记录',
              children: (
                <Table<GateExecutionRow>
                  loading={loading}
                  rowKey={(r, i) => String(r.id ?? i)}
                  dataSource={executions}
                  scroll={{ x: 1100 }}
                  columns={[
                    { title: '时间', dataIndex: 'created_at', width: 180 },
                    { title: 'gate', dataIndex: 'gate_name', width: 160 },
                    {
                      title: 'trace',
                      dataIndex: 'trace_id',
                      ellipsis: true,
                      render: (t: string) =>
                        t ? (
                          <Button type="link" size="small" onClick={() => onOpenRuntimeTrace?.(t)}>
                            {t}
                          </Button>
                        ) : (
                          '-'
                        ),
                    },
                    { title: '结果', dataIndex: 'status', width: 100 },
                  ]}
                />
              ),
            },
            {
              key: 'engine',
              label: '引擎日志',
              children: (
                <Table<GateEngineLogRow>
                  loading={loading}
                  rowKey={(r, i) => String(r.id ?? i)}
                  dataSource={engineLogs}
                  scroll={{ x: 1200 }}
                  columns={[
                    { title: '时间', dataIndex: 'created_at', width: 180 },
                    { title: '事件', dataIndex: 'event', width: 200 },
                    {
                      title: 'trace',
                      dataIndex: 'trace_id',
                      ellipsis: true,
                      render: (t: string) =>
                        t ? (
                          <Button type="link" size="small" onClick={() => onOpenRuntimeTrace?.(t)}>
                            {t}
                          </Button>
                        ) : (
                          '-'
                        ),
                    },
                    { title: '详情', dataIndex: 'detail', ellipsis: true },
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

export default GateConfig;
