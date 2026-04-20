/**
 * AI 网关管理页面 - 主应用（React Router）
 */

import React, { useMemo, useState } from 'react';
import { Layout, Menu, theme } from 'antd';
import {
  DashboardOutlined,
  KeyOutlined,
  TeamOutlined,
  DollarOutlined,
  SettingOutlined,
  BarsOutlined,
  FileSearchOutlined,
  SafetyCertificateOutlined,
  ExportOutlined,
  ApartmentOutlined,
  DeploymentUnitOutlined,
  AuditOutlined,
  FileMarkdownOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import ApiKeys from './pages/ApiKeys';
import Teams from './pages/Teams';
import CostReport from './pages/CostReport';
import Settings from './pages/Settings';
import Logs from './pages/Logs';
import GateConfig from './pages/GateConfig';
import ExportButton from './components/ExportButton';
import ProjectGovernance from './pages/ProjectGovernance';
import ControlPlane from './pages/ControlPlane';
import RuntimeCenter from './pages/RuntimeCenter';
import KnowledgeAudit from './pages/KnowledgeAudit';
import AcceptanceCenter from './pages/AcceptanceCenter';
import DocumentGateCenter from './pages/DocumentGateCenter';
import DeepWikiCenter from './pages/DeepWikiCenter';
import DeepWikiProjectPage from './pages/DeepWikiProjectPage';
import DeepWikiHealthPanel from './pages/DeepWikiHealthPanel';
import AIFlowboardCenter from './pages/AIFlowboardCenter';

const { Header, Content, Sider } = Layout;

type MenuItem = Required<MenuProps>['items'][number];

function getItem(
  label: React.ReactNode,
  key: React.Key,
  icon?: React.ReactNode,
  children?: MenuItem[],
): MenuItem {
  return {
    key,
    icon,
    children,
    label,
  } as MenuItem;
}

const menuItems: MenuItem[] = [
  getItem('总览驾驶舱', 'dashboard', <DashboardOutlined />),
  getItem('项目治理', 'program', <ApartmentOutlined />),
  getItem('控制平面', 'control', <DeploymentUnitOutlined />),
  getItem('运行编排', 'runtime', <BarsOutlined />),
  getItem('门禁治理', 'gate', <SafetyCertificateOutlined />),
  getItem('文档门禁', 'doc-gate', <FileMarkdownOutlined />),
  getItem('Deep Wiki', 'deepwiki', <ReadOutlined />),
  getItem('Deep Wiki 健康', 'deepwiki-health', <ReadOutlined />),
  getItem('AI 协同研发', 'flowboard', <ReadOutlined />),
  getItem('度量与可观测', 'cost', <DollarOutlined />),
  getItem('知识与审计', 'knowledge', <AuditOutlined />),
  getItem('阶段验收', 'acceptance', <ExportOutlined />),
  getItem('日志查询', 'logs', <FileSearchOutlined />),
  getItem('API Key 管理', 'apikeys', <KeyOutlined />),
  getItem('团队管理', 'teams', <TeamOutlined />),
  getItem('系统设置', 'settings', <SettingOutlined />),
];

const MENU_PATH: Record<string, string> = {
  dashboard: '/dashboard',
  program: '/program',
  control: '/control',
  runtime: '/runtime',
  gate: '/gate',
  'doc-gate': '/doc-gate',
  deepwiki: '/deepwiki',
  'deepwiki-health': '/deepwiki/health',
  flowboard: '/flowboard',
  cost: '/cost',
  knowledge: '/knowledge',
  acceptance: '/acceptance',
  logs: '/logs',
  apikeys: '/apikeys',
  teams: '/teams',
  settings: '/settings',
};

function menuKeyFromPath(pathname: string): string {
  if (pathname.startsWith('/deepwiki/health')) return 'deepwiki-health';
  if (pathname.startsWith('/deepwiki')) return 'deepwiki';
  const seg = pathname.split('/').filter(Boolean)[0];
  if (!seg) return 'dashboard';
  const hit = Object.entries(MENU_PATH).find(([, p]) => p === `/${seg}`);
  return hit ? hit[0] : 'dashboard';
}

const App: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const selectedKey = useMemo(() => menuKeyFromPath(location.pathname), [location.pathname]);

  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        theme="light"
        style={{
          background: colorBgContainer,
          borderRight: '1px solid #f0f0f0',
        }}
      >
        <div
          style={{
            height: '64px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderBottom: '1px solid #f0f0f0',
            margin: '16px',
            marginBottom: 0,
            paddingLeft: collapsed ? 0 : '16px',
          }}
        >
          <span style={{ fontSize: '20px', fontWeight: 'bold', color: '#1890ff' }}>
            {collapsed ? '🤖 AI' : '🤖 AI 工程化管理平台'}
          </span>
        </div>

        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={(e) => {
            const path = MENU_PATH[String(e.key)] || '/dashboard';
            navigate(path);
          }}
          style={{
            borderRight: 0,
            marginTop: '16px',
          }}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            padding: '0 24px',
            background: colorBgContainer,
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <BarsOutlined
              style={{ fontSize: '18px', cursor: 'pointer' }}
              onClick={() => setCollapsed(!collapsed)}
              title="展开/收起菜单"
            />
            <span style={{ color: '#666', fontSize: '14px' }}>购商云汇 · AI 工程化管理平台</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ color: '#999', fontSize: '14px' }}>👤 管理员</span>
            <ExportButton data={[]} columns={[]} />
          </div>
        </Header>

        <Content
          style={{
            margin: '16px',
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            overflow: 'auto',
          }}
        >
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/program" element={<ProjectGovernance />} />
            <Route path="/control" element={<ControlPlane />} />
            <Route path="/runtime" element={<RuntimeCenter />} />
            <Route path="/apikeys" element={<ApiKeys />} />
            <Route path="/teams" element={<Teams />} />
            <Route path="/cost" element={<CostReport />} />
            <Route
              path="/gate"
              element={
                <GateConfig
                  onOpenRuntimeTrace={(traceId) => {
                    navigate(`/runtime?trace=${encodeURIComponent(traceId)}`);
                  }}
                  onOpenProject={(projectCode) => {
                    navigate(`/program?focus=${encodeURIComponent(projectCode)}`);
                  }}
                  onOpenEvidence={(projectCode, traceId) => {
                    const q = traceId
                      ? `?focus=${encodeURIComponent(projectCode)}&trace=${encodeURIComponent(traceId)}`
                      : `?focus=${encodeURIComponent(projectCode)}`;
                    navigate(`/acceptance${q}`);
                  }}
                />
              }
            />
            <Route path="/doc-gate" element={<DocumentGateCenter />} />
            <Route path="/knowledge" element={<KnowledgeAudit />} />
            <Route path="/deepwiki" element={<DeepWikiCenter />} />
            <Route path="/deepwiki/health" element={<DeepWikiHealthPanel />} />
            <Route path="/deepwiki/health/:projectId" element={<DeepWikiHealthPanel />} />
            <Route path="/deepwiki/project/:projectId" element={<DeepWikiProjectPage />} />
            <Route
              path="/flowboard"
              element={
                <AIFlowboardCenter
                  onOpenDeepWiki={() => navigate('/deepwiki')}
                  onOpenDocBundle={(bundleId) => navigate(`/doc-gate?bundle=${bundleId}`)}
                />
              }
            />
            <Route path="/acceptance" element={<AcceptanceCenter />} />
            <Route path="/logs" element={<Logs />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
};

export default App;
