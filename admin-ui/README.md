# AI 网关管理页面

> 基于 React + TypeScript + Ant Design 的 AI 网关管理平台

## 🚀 功能特性

### 已实现 ✅

- **Dashboard** - 用量监控
  - Token 使用趋势图
  - 成本统计
  - 热门模型排行
  - 团队用量排行
  - 实时数据刷新

- **API Key 管理** - 配置管理
  - 创建/编辑/删除 API Key
  - 设置配额 (日/月)
  - 配置允许的模型
  - 查看用量统计
  - 一键复制 API Key

### 待开发 ⏳

- **团队管理** - 团队/用户管理
- **成本报表** - 成本分析和导出
- **系统设置** - 网关配置、告警设置
- **门禁管理** - 门禁规则配置
- **日志查询** - AI 调用日志检索

---

## 🛠️ 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | React 18 + TypeScript |
| UI 库 | Ant Design 5 |
| 图表 | Ant Design Charts |
| 状态管理 | Zustand |
| 构建工具 | Vite 5 |
| 路由 | React Router 6 |

---

## 📦 快速开始

### 安装依赖

```bash
cd admin-ui
npm install
```

### 开发模式

```bash
# 启动开发服务器 (固定 127.0.0.1:3000，并在启动前自动清理旧进程)
npm run dev

# 强制重建依赖缓存后启动
npm run dev:force

# 清理本地 .vite 缓存后启动
npm run dev:clean

# 访问 http://127.0.0.1:3000
```

### 生产构建

```bash
npm run build
```

---

## 📁 项目结构

```
admin-ui/
├── src/
│   ├── pages/
│   │   ├── Dashboard.tsx      # 用量 Dashboard
│   │   ├── ApiKeys.tsx        # API Key 管理
│   │   ├── Teams.tsx          # 团队管理 (TODO)
│   │   ├── CostReport.tsx     # 成本报表 (TODO)
│   │   └── Settings.tsx       # 系统设置 (TODO)
│   ├── components/            # 可复用组件
│   ├── store/                 # 状态管理
│   ├── styles/
│   │   └── index.css          # 全局样式
│   ├── App.tsx                # 主应用
│   └── main.tsx               # 入口文件
├── index.html
├── package.json
├── vite.config.ts
└── README.md
```

---

## 🎨 页面预览

### Dashboard

- Token 使用趋势图 (折线图)
- 模型用量排行 (柱状图)
- 团队用量表格
- 实时统计卡片

### API Key 管理

- API Key 列表 (表格)
- 创建/编辑对话框
- 配额使用率进度条
- 一键复制功能

---

## 🔌 API 集成

管理页面通过代理连接到 AI 网关后端：

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001', // AI 网关
      changeOrigin: true,
    },
  },
}
```

### 需要实现的 API

| API | 方法 | 用途 |
|-----|------|------|
| `/api/v1/usage` | GET | 获取用量统计 |
| `/api/v1/keys` | GET | 获取 API Key 列表 |
| `/api/v1/keys` | POST | 创建 API Key |
| `/api/v1/keys/:id` | PUT | 更新 API Key |
| `/api/v1/keys/:id` | DELETE | 删除 API Key |
| `/api/v1/teams` | GET | 获取团队列表 |
| `/api/v1/cost/report` | GET | 获取成本报表 |

---

## 📝 开发注意事项

1. **TypeScript 类型** - 所有组件使用 TypeScript
2. **Ant Design 5** - 使用 CSS-in-JS (theme)
3. **响应式布局** - 支持不同屏幕尺寸
4. **代码规范** - ESLint + Prettier

---

## 🚀 下一步

1. ✅ Dashboard 页面 - 完成
2. ✅ API Key 管理 - 完成
3. ⏳ 团队管理页面
4. ⏳ 成本报表页面
5. ⏳ 系统设置页面
6. ⏳ 后端 API 集成
7. ⏳ 实时数据刷新 (WebSocket)
8. ⏳ 导出功能 (Excel/CSV)

---

*最后更新：2026-04-09*
