/**
 * API Key 管理页面
 * 
 * 功能:
 * - 查看 API Key 列表
 * - 创建新 API Key
 * - 编辑/删除 API Key
 * - 设置配额和权限
 */

import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, message, Spin, Empty } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined } from '@ant-design/icons';
import { apiKeyApi, type ApiKey } from '../services/api';

const { TextArea } = Input;

const mockApiKeys: ApiKey[] = [
  {
    key: 'team_xxxxxxxxxxxxxxxxxxxx',
    type: 'team',
    name: '技术部',
    quota_daily: 100000,
    quota_monthly: 3000000,
    used_daily: 15420,
    used_monthly: 456780,
    allowed_models: ['deepseek', 'qwen', 'gpt-4'],
    created_at: '2026-03-01',
    status: 'active',
  },
  {
    key: 'user_xxxxxxxxxxxxxxxxxxxx',
    type: 'user',
    name: '张三',
    quota_daily: 10000,
    quota_monthly: 300000,
    used_daily: 2340,
    used_monthly: 45670,
    allowed_models: ['deepseek', 'qwen'],
    created_at: '2026-03-15',
    status: 'active',
  },
  {
    key: 'proj_xxxxxxxxxxxxxxxxxxxx',
    type: 'proj',
    name: '购商云汇项目',
    quota_daily: 50000,
    quota_monthly: 1500000,
    used_daily: 8900,
    used_monthly: 234500,
    allowed_models: ['deepseek', 'qwen', 'gpt-4', 'claude'],
    created_at: '2026-04-01',
    status: 'active',
  },
];

const ApiKeys: React.FC = () => {
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form] = Form.useForm();

  const loadApiKeys = async () => {
    try {
      setLoading(true);
      const data = await apiKeyApi.list();
      setApiKeys(data);
    } catch (error) {
      console.error('Failed to load API keys:', error);
      message.error('加载 API Key 列表失败，使用模拟数据');
      setApiKeys(mockApiKeys);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadApiKeys();
  }, []);

  // 打开创建/编辑对话框
  const handleOpenModal = (record?: any) => {
    if (record) {
      setEditingKey(record.key);
      form.setFieldsValue(record);
    } else {
      setEditingKey(null);
      form.resetFields();
    }
    setIsModalVisible(true);
  };

  // 保存 API Key
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      
      if (editingKey) {
        // 编辑 - TODO: 调用真实 API
        // await apiKeyApi.update(editingKey, values);
        setApiKeys(apiKeys.map(k => k.key === editingKey ? { ...k, ...values } : k));
        message.success('API Key 已更新');
        loadApiKeys(); // 刷新列表
      } else {
        // 创建 - TODO: 调用真实 API
        // const newKey = await apiKeyApi.create(values);
        const newKey = {
          ...values,
          key: `${values.type}_xxxxxxxxxxxxxxxxxxxx`,
          created_at: new Date().toISOString().split('T')[0],
          status: 'active',
          used_daily: 0,
          used_monthly: 0,
        };
        setApiKeys([...apiKeys, newKey]);
        message.success('API Key 已创建');
        loadApiKeys(); // 刷新列表
      }
      
      setIsModalVisible(false);
      form.resetFields();
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  // 删除 API Key
  const handleDelete = async (key: string) => {
    try {
      // TODO: 调用真实 API
      // await apiKeyApi.delete(key);
      setApiKeys(apiKeys.filter(k => k.key !== key));
      message.success('API Key 已删除');
      loadApiKeys(); // 刷新列表
    } catch (error) {
      console.error('Failed to delete API key:', error);
      message.error('删除失败');
    }
  };

  // 复制 API Key
  const handleCopy = (key: string) => {
    navigator.clipboard.writeText(key);
    message.success('API Key 已复制到剪贴板');
  };

  const columns = [
    {
      title: 'API Key',
      dataIndex: 'key',
      key: 'key',
      render: (key: string, record: any) => (
        <Space>
          <code style={{ background: '#f5f5f5', padding: '4px 8px', borderRadius: '4px' }}>
            {key.substring(0, 12)}...
          </code>
          <Button 
            type="link" 
            icon={<CopyOutlined />} 
            onClick={() => handleCopy(key)}
          />
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        const colorMap: any = {
          team: 'blue',
          user: 'green',
          proj: 'purple',
        };
        return <Tag color={colorMap[type]}>{type.toUpperCase()}</Tag>;
      },
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '日配额',
      dataIndex: 'quota_daily',
      key: 'quota_daily',
      render: (quota: number) => quota.toLocaleString(),
    },
    {
      title: '日用量',
      dataIndex: 'used_daily',
      key: 'used_daily',
      render: (used: number, record: any) => {
        const percentage = (used / record.quota_daily) * 100;
        return (
          <div>
            <div>{used.toLocaleString()}</div>
            <div style={{ fontSize: '12px', color: percentage > 80 ? '#ff4d4f' : '#666' }}>
              {percentage.toFixed(1)}%
            </div>
          </div>
        );
      },
    },
    {
      title: '月配额',
      dataIndex: 'quota_monthly',
      key: 'quota_monthly',
      render: (quota: number) => quota.toLocaleString(),
    },
    {
      title: '月用量',
      dataIndex: 'used_monthly',
      key: 'used_monthly',
      render: (used: number, record: any) => {
        const percentage = (used / record.quota_monthly) * 100;
        return (
          <div>
            <div>{used.toLocaleString()}</div>
            <div style={{ fontSize: '12px', color: percentage > 80 ? '#ff4d4f' : '#666' }}>
              {percentage.toFixed(1)}%
            </div>
          </div>
        );
      },
    },
    {
      title: '允许模型',
      dataIndex: 'allowed_models',
      key: 'allowed_models',
      render: (models: string[]) => (
        <Space>
          {models.map(model => (
            <Tag key={model} color="default">{model}</Tag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <Tag color={status === 'active' ? 'green' : 'red'}>
          {status === 'active' ? '✅ 正常' : '❌ 禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: any) => (
        <Space>
          <Button 
            type="link" 
            icon={<EditOutlined />}
            onClick={() => handleOpenModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个 API Key 吗？"
            onConfirm={() => handleDelete(record.key)}
            okText="确定"
            cancelText="取消"
          >
            <Button type="link" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (loading) {
    return (
      <div style={{ padding: '24px', textAlign: 'center' }}>
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }

  return (
    <div style={{ padding: '24px' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px' }}>🔑 API Key 管理</h1>
          <p style={{ margin: '8px 0 0', color: '#666' }}>
            管理大模型 API Key，配置配额和权限
          </p>
        </div>
        <Button 
          type="primary" 
          icon={<PlusOutlined />}
          onClick={() => handleOpenModal()}
        >
          创建 API Key
        </Button>
      </div>

      {/* API Key 列表 */}
      <Card>
        {apiKeys.length > 0 ? (
          <Table
            dataSource={apiKeys}
            columns={columns}
            rowKey="key"
            pagination={{ pageSize: 10 }}
            scroll={{ x: 1400 }}
          />
        ) : (
          <Empty description="暂无 API Key" />
        )}
      </Card>

      {/* 创建/编辑对话框 */}
      <Modal
        title={editingKey ? '编辑 API Key' : '创建 API Key'}
        open={isModalVisible}
        onOk={handleSave}
        onCancel={() => {
          setIsModalVisible(false);
          form.resetFields();
        }}
        width={600}
      >
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            type: 'team',
            status: 'active',
            allowed_models: ['deepseek', 'qwen'],
          }}
        >
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="例如：技术部、张三、购商云汇项目" />
          </Form.Item>

          <Form.Item
            name="type"
            label="类型"
            rules={[{ required: true, message: '请选择类型' }]}
          >
            <Select>
              <Select.Option value="team">团队 (team)</Select.Option>
              <Select.Option value="user">个人 (user)</Select.Option>
              <Select.Option value="proj">项目 (proj)</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="quota_daily"
            label="日配额 (Tokens)"
            rules={[{ required: true, message: '请输入日配额' }]}
          >
            <InputNumber 
              min={0} 
              style={{ width: '100%' }} 
              placeholder="例如：100000"
            />
          </Form.Item>

          <Form.Item
            name="quota_monthly"
            label="月配额 (Tokens)"
            rules={[{ required: true, message: '请输入月配额' }]}
          >
            <InputNumber 
              min={0} 
              style={{ width: '100%' }} 
              placeholder="例如：3000000"
            />
          </Form.Item>

          <Form.Item
            name="allowed_models"
            label="允许的模型"
            rules={[{ required: true, message: '请选择允许的模型' }]}
          >
            <Select mode="multiple" allowClear>
              <Select.Option value="deepseek">DeepSeek</Select.Option>
              <Select.Option value="qwen">Qwen (通义千问)</Select.Option>
              <Select.Option value="gpt-4">GPT-4</Select.Option>
              <Select.Option value="claude">Claude</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
          >
            <Select>
              <Select.Option value="active">正常</Select.Option>
              <Select.Option value="disabled">禁用</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default ApiKeys;
