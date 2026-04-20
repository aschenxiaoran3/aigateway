/**
 * 团队管理页面
 * 
 * 功能:
 * - 查看团队列表
 * - 创建新团队
 * - 编辑/删除团队
 * - 管理团队成员
 * - 设置团队配额
 */

import React, { useState, useEffect } from 'react';
import { Card, Table, Button, Tag, Modal, Form, Input, InputNumber, Space, Popconfirm, message, Spin, Empty, Drawer } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, UserOutlined, SettingOutlined } from '@ant-design/icons';
import { teamApi, type Team } from '../services/api';

// 模拟数据
const mockTeams: Team[] = [
  {
    id: 'team_001',
    name: '技术部',
    members: 25,
    quota_daily: 150000,
    quota_monthly: 4500000,
    used_daily: 45200,
    used_monthly: 1356000,
    created_at: '2026-01-15',
  },
  {
    id: 'team_002',
    name: '产品部',
    members: 8,
    quota_daily: 80000,
    quota_monthly: 2400000,
    used_daily: 23400,
    used_monthly: 702000,
    created_at: '2026-01-20',
  },
  {
    id: 'team_003',
    name: '测试部',
    members: 5,
    quota_daily: 50000,
    quota_monthly: 1500000,
    used_daily: 12800,
    used_monthly: 384000,
    created_at: '2026-02-01',
  },
  {
    id: 'team_004',
    name: '运维部',
    members: 3,
    quota_daily: 30000,
    quota_monthly: 900000,
    used_daily: 8900,
    used_monthly: 267000,
    created_at: '2026-02-10',
  },
  {
    id: 'team_005',
    name: '设计部',
    members: 4,
    quota_daily: 40000,
    quota_monthly: 1200000,
    used_daily: 9500,
    used_monthly: 285000,
    created_at: '2026-02-15',
  },
];

const Teams: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [memberDrawerVisible, setMemberDrawerVisible] = useState(false);
  const [currentTeam, setCurrentTeam] = useState<Team | null>(null);
  const [form] = Form.useForm();

  useEffect(() => {
    loadTeams();
  }, []);

  const loadTeams = async () => {
    try {
      setLoading(true);
      // TODO: 调用真实 API
      // const data = await teamApi.list();
      // setTeams(data);
      
      // 暂时使用模拟数据
      setTeams(mockTeams);
    } catch (error) {
      console.error('Failed to load teams:', error);
      message.error('加载团队列表失败');
      setTeams(mockTeams);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (record?: Team) => {
    if (record) {
      setEditingTeam(record.id);
      form.setFieldsValue(record);
    } else {
      setEditingTeam(null);
      form.resetFields();
    }
    setIsModalVisible(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      
      if (editingTeam) {
        // 编辑
        // await teamApi.update(editingTeam, values);
        setTeams(teams.map(t => t.id === editingTeam ? { ...t, ...values } : t));
        message.success('团队信息已更新');
      } else {
        // 创建
        const newTeam = {
          ...values,
          id: `team_${Date.now()}`,
          created_at: new Date().toISOString().split('T')[0],
          used_daily: 0,
          used_monthly: 0,
        };
        setTeams([...teams, newTeam]);
        message.success('团队已创建');
      }
      
      setIsModalVisible(false);
      form.resetFields();
      loadTeams();
    } catch (error) {
      console.error('Validation failed:', error);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      // await teamApi.delete(id);
      setTeams(teams.filter(t => t.id !== id));
      message.success('团队已删除');
      loadTeams();
    } catch (error) {
      console.error('Failed to delete team:', error);
      message.error('删除失败');
    }
  };

  const handleOpenMembers = (record: Team) => {
    setCurrentTeam(record);
    setMemberDrawerVisible(true);
  };

  const columns = [
    {
      title: '团队名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => (
        <span style={{ fontWeight: 600 }}>{name}</span>
      ),
    },
    {
      title: '成员数',
      dataIndex: 'members',
      key: 'members',
      render: (members: number) => (
        <Space>
          <UserOutlined />
          {members} 人
        </Space>
      ),
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
      render: (used: number, record: Team) => {
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
      render: (used: number, record: Team) => {
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
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
    },
    {
      title: '操作',
      key: 'action',
      render: (_: any, record: Team) => (
        <Space>
          <Button 
            type="link"
            onClick={() => handleOpenMembers(record)}
          >
            成员
          </Button>
          <Button 
            type="link"
            icon={<EditOutlined />}
            onClick={() => handleOpenModal(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定要删除这个团队吗？"
            onConfirm={() => handleDelete(record.id)}
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

  // 模拟成员数据
  const mockMembers = [
    { id: 'user_001', name: '张三', role: '前端开发', email: 'zhangsan@example.com' },
    { id: 'user_002', name: '李四', role: '后端开发', email: 'lisi@example.com' },
    { id: 'user_003', name: '王五', role: '测试工程师', email: 'wangwu@example.com' },
    { id: 'user_004', name: '赵六', role: '产品经理', email: 'zhaoliu@example.com' },
  ];

  return (
    <div style={{ padding: '24px' }}>
      {/* 页面标题 */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '24px' }}>👥 团队管理</h1>
          <p style={{ margin: '8px 0 0', color: '#666' }}>
            管理团队信息、成员配置和 Token 配额
          </p>
        </div>
        <Button 
          type="primary" 
          icon={<PlusOutlined />}
          onClick={() => handleOpenModal()}
        >
          ➕ 新建团队
        </Button>
      </div>

      {/* 团队列表 */}
      <Card>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <Spin size="large" tip="加载中..." />
          </div>
        ) : teams.length > 0 ? (
          <Table
            dataSource={teams}
            columns={columns}
            rowKey="id"
            pagination={{ pageSize: 10 }}
          />
        ) : (
          <Empty description="暂无团队数据" />
        )}
      </Card>

      {/* 创建/编辑对话框 */}
      <Modal
        title={editingTeam ? '编辑团队' : '创建团队'}
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
            status: 'active',
          }}
        >
          <Form.Item
            name="name"
            label="团队名称"
            rules={[{ required: true, message: '请输入团队名称' }]}
          >
            <Input placeholder="例如：技术部、产品部" />
          </Form.Item>

          <Form.Item
            name="members"
            label="成员数"
            rules={[{ required: true, message: '请输入成员数' }]}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
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
        </Form>
      </Modal>

      {/* 成员管理抽屉 */}
      <Drawer
        title={`${currentTeam?.name} - 成员管理`}
        placement="right"
        width={600}
        open={memberDrawerVisible}
        onClose={() => setMemberDrawerVisible(false)}
      >
        <div style={{ marginBottom: '16px' }}>
          <Space>
            <Button type="primary" icon={<PlusOutlined />}>
              添加成员
            </Button>
            <Button icon={<SettingOutlined />}>
              批量设置
            </Button>
          </Space>
        </div>

        <Table
          dataSource={mockMembers}
          rowKey="id"
          pagination={false}
          columns={[
            {
              title: '姓名',
              dataIndex: 'name',
              key: 'name',
            },
            {
              title: '角色',
              dataIndex: 'role',
              key: 'role',
              render: (role: string) => <Tag color="blue">{role}</Tag>,
            },
            {
              title: '邮箱',
              dataIndex: 'email',
              key: 'email',
            },
            {
              title: '操作',
              key: 'action',
              render: (_: any, record: any) => (
                <Space>
                  <Button type="link">编辑</Button>
                  <Button type="link" danger>移除</Button>
                </Space>
              ),
            },
          ]}
        />
      </Drawer>
    </div>
  );
};

export default Teams;
