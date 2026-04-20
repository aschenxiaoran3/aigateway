import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Select, Switch, message, Spin } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { settingsApi, type SystemSettings } from '../services/api';

const Settings: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const data = await settingsApi.get();
      form.setFieldsValue(data as Record<string, unknown>);
    } catch (e) {
      console.error(e);
      message.error('加载系统设置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [form]);

  const onSave = async () => {
    try {
      const values = (await form.validateFields()) as Partial<SystemSettings>;
      setSaving(true);
      await settingsApi.update(values);
      message.success('已保存');
    } catch (e) {
      console.error(e);
      message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div style={{ padding: 24 }}>
      <Card
        title="系统设置"
        extra={
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={() => void onSave()}>
            保存
          </Button>
        }
      >
        <Form form={form} layout="vertical" style={{ maxWidth: 720 }}>
          <Form.Item label="网关 Host" name="gateway_host">
            <Input placeholder="例如 0.0.0.0" />
          </Form.Item>
          <Form.Item label="网关端口" name="gateway_port">
            <InputNumber style={{ width: '100%' }} min={1} max={65535} />
          </Form.Item>
          <Form.Item label="Deep Wiki 默认 Provider" name="deepwiki_default_provider">
            <Input />
          </Form.Item>
          <Form.Item label="Deep Wiki 默认模型" name="deepwiki_default_model">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="启用 Qwen" name="deepwiki_qwen_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="启用 Weelinking" name="deepwiki_weelinking_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="启用 Codex / OpenAI 制图 Provider" name="deepwiki_codex_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Weelinking Base URL" name="deepwiki_weelinking_base_url">
            <Input />
          </Form.Item>
          <Form.Item label="Weelinking API Key" name="deepwiki_weelinking_api_key">
            <Input.Password placeholder="敏感信息，仅在有值时覆盖" autoComplete="off" />
          </Form.Item>
          <Form.Item label="Codex Base URL" name="deepwiki_codex_base_url">
            <Input placeholder="https://api.openai.com" />
          </Form.Item>
          <Form.Item label="Codex API Key" name="deepwiki_codex_api_key">
            <Input.Password placeholder="敏感信息，仅在有值时覆盖" autoComplete="off" />
          </Form.Item>
          <Form.Item label="Codex 默认模型" name="deepwiki_codex_default_model">
            <Input placeholder="gpt-5.4" />
          </Form.Item>
          <Form.Item label="启用 Devin DeepWiki Sync" name="deepwiki_devin_enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Devin Base URL" name="deepwiki_devin_base_url">
            <Input placeholder="https://api.devin.ai" />
          </Form.Item>
          <Form.Item label="Devin API Key" name="deepwiki_devin_api_key">
            <Input.Password placeholder="敏感信息，仅在有值时覆盖" autoComplete="off" />
          </Form.Item>
          <Form.Item label="发布后自动同步 Devin" name="deepwiki_devin_auto_sync_on_publish" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="Devin Playbook ID" name="deepwiki_devin_playbook_id">
            <Input placeholder="可选" />
          </Form.Item>
          <Form.Item label="Devin Knowledge IDs" name="deepwiki_devin_knowledge_ids">
            <Input.TextArea rows={2} placeholder="多个 ID 可用逗号分隔" />
          </Form.Item>
          <Form.Item label="Devin Max ACU Limit" name="deepwiki_devin_max_acu_limit">
            <InputNumber style={{ width: '100%' }} min={0} placeholder="可选" />
          </Form.Item>
          <Form.Item label="Devin Session 设为 Unlisted" name="deepwiki_devin_unlisted" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item label="DeepWiki 制图 Provider 策略" name="deepwiki_diagram_provider_strategy">
            <Select
              options={[
                { label: 'default', value: 'default' },
                { label: 'codex_only', value: 'codex_only' },
                { label: 'project_override', value: 'project_override' },
              ]}
            />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default Settings;
