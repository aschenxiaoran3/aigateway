import React from 'react';
import { Alert, Button, Card, Space } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import HarnessCenter from './HarnessCenter';

export type AIFlowboardCenterProps = {
  onOpenDeepWiki?: () => void;
  onOpenDocBundle?: (bundleId: number) => void;
};

/**
 * AI 协同研发：复用 Harness 工作台，并提供与 Deep Wiki / 文档门禁的快速跳转。
 */
const AIFlowboardCenter: React.FC<AIFlowboardCenterProps> = ({ onOpenDeepWiki, onOpenDocBundle }) => {
  const navigate = useNavigate();
  return (
    <div>
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          {onOpenDeepWiki ? (
            <Button type="primary" icon={<LinkOutlined />} onClick={onOpenDeepWiki}>
              打开 Deep Wiki
            </Button>
          ) : null}
          <Button icon={<LinkOutlined />} onClick={() => navigate('/doc-gate')}>
            文档门禁（PRD→技术→测试）
          </Button>
          {onOpenDocBundle ? (
            <Button
              icon={<LinkOutlined />}
              onClick={() => {
                const id = window.prompt('输入文档任务 bundle_id（数字）');
                if (id && /^\d+$/.test(id)) onOpenDocBundle(Number(id));
              }}
            >
              按 ID 打开文档门禁
            </Button>
          ) : null}
        </Space>
        <Alert
          style={{ marginTop: 12 }}
          type="info"
          showIcon
          message="Harness 与 Deep Wiki、文档门禁联动：先在 Deep Wiki 沉淀多仓知识，再在文档门禁中生成技术方案与测试方案。"
        />
      </Card>
      <HarnessCenter />
    </div>
  );
};

export default AIFlowboardCenter;
