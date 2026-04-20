# AI 网关管理平台 - 购商云汇

> 企业级 AI 大模型统一管理平台 | 完全中文版

[English](./README.md) | **简体中文**

---

## 🎯 项目简介

购商云汇 AI 网关管理平台是一套**完全自主研发**的企业级 AI 大模型管理系统，提供：

- ✅ **统一接入** - 支持 DeepSeek、Qwen、GPT-4、Claude 等主流大模型
- ✅ **中文管理界面** - 全中文操作界面，符合国内用户使用习惯
- ✅ **用量监控** - 实时监控 Token 使用情况，可视化图表展示
- ✅ **成本管控** - 按团队/项目统计成本，支持配额管理
- ✅ **门禁系统** - CI/CD 集成，确保 AI 生成内容质量

---

## 🚀 快速开始

### 方式一：Docker 一键启动（推荐）

```bash
cd /Users/xiaoran/.openclaw/workspace/projects/ai-platform
docker-compose up -d
```

启动后访问：
- **管理页面**: http://localhost:3000
- **AI 网关 API**: http://localhost:3001

### 方式二：本地开发模式

```bash
# 1. 启动 AI 网关
cd ai-gateway
npm install
npm start

# 2. 启动管理页面（新终端）
cd ../admin-ui
npm install
npm run dev
```

---

## 📦 功能模块

### 1️⃣ Dashboard - 用量监控

- 📊 **实时统计卡片**
  - 总请求数、活跃用户数
  - 实时吞吐量（Token/分钟）
  - 平均 Token/请求
  - 缓存命中率
  
- 📈 **趋势图表**
  - Token 使用趋势（折线图）
  - 大模型用量排行（柱状图）
  - 团队用量排行（表格 + 进度条）

### 2️⃣ API Key 管理

- 🔑 **API Key 全生命周期管理**
  - 创建/编辑/删除 API Key
  - 支持三种类型：团队、个人、项目
  - 配额设置（日配额/月配额）
  - 模型权限控制
  
- 📊 **用量统计**
  - 实时用量监控
  - 配额使用率进度条
  - 超 80% 自动告警（红色提示）

### 3️⃣ 团队管理

- 👥 **团队信息管理**
  - 团队列表展示
  - 创建/编辑/删除团队
  - 成员管理（抽屉式界面）
  
- 💰 **配额管理**
  - 日配额/月配额设置
  - 用量统计和排行
  - 使用率可视化

### 4️⃣ 成本报表

- 💵 **成本分析**
  - 成本趋势图（折线图）
  - 成本分布饼图（按团队/模型）
  - 统计卡片（总成本/日均/预测）
  
- 📋 **成本明细**
  - 按团队分组统计
  - 按模型分组统计
  - 支持导出 Excel/CSV（开发中）
  
- 💡 **优化建议**
  - 自动识别高成本使用场景
  - 提供模型切换建议
  - 预计节省金额

### 5️⃣ 门禁系统

- 🚪 **PRD 门禁**
  - AI 初稿检查
  - 自检清单验证
  - 大数据价值评估
  
- 🔧 **技术方案门禁**
  - 架构规范检查
  - 接口一致性验证
  
- 💻 **代码门禁**（开发中）
  - Code Review 集成
  - 单元测试覆盖率
  - 代码规范检查

---

## 🛠️ 技术栈

| 模块 | 技术选型 | 说明 |
|------|----------|------|
| **前端** | React 18 + TypeScript | 现代化前端框架 |
| **UI 库** | Ant Design 5 | 企业级 UI 组件库 |
| **图表** | Ant Design Charts | 专业数据可视化 |
| **后端** | Node.js + Express | 高性能 API 服务 |
| **向量库** | Qdrant | 轻量级向量数据库 |
| **部署** | Docker Compose | 一键部署 |

---

## 📁 项目结构

```
ai-platform/
├── admin-ui/              # 管理页面前端
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx      # 用量监控
│   │   │   ├── ApiKeys.tsx        # API Key 管理
│   │   │   ├── Teams.tsx          # 团队管理
│   │   │   └── CostReport.tsx     # 成本报表
│   │   ├── services/
│   │   │   └── api.ts             # API 服务层
│   │   └── App.tsx                # 主应用
│   └── package.json
├── ai-gateway/            # AI 网关后端
│   ├── src/
│   │   ├── routes/
│   │   │   ├── model-router.js    # 模型路由
│   │   │   ├── usage.js           # 用量统计 API
│   │   │   ├── keys.js            # API Key 管理 API
│   │   │   └── teams.js           # 团队管理 API
│   │   └── index.js               # 主入口
│   └── package.json
├── gate-engine/           # 门禁系统
│   ├── src/
│   │   └── gate-runner.js         # 门禁执行引擎
│   └── rules/
│       └── prd-gate.yaml          # PRD 门禁规则
├── knowledge-base/        # 知识库 (RAG)
│   └── ingest/
│       └── document_loader.py     # 文档加载器
├── docs/                  # 文档
│   ├── architecture.md            # 架构设计
│   └── api.md                     # API 文档
└── docker-compose.yml     # Docker 部署配置
```

---

## 🔌 API 接口

### AI 网关 API

| 接口 | 方法 | 说明 |
|------|------|------|
| `/v1/chat/completions` | POST | 统一调用大模型（OpenAI 兼容） |
| `/api/v1/usage/stats` | GET | 获取用量统计 |
| `/api/v1/usage/trend` | GET | 获取 Token 趋势 |
| `/api/v1/usage/models` | GET | 获取模型用量排行 |
| `/api/v1/usage/teams` | GET | 获取团队用量排行 |
| `/api/v1/keys` | GET/POST | API Key 列表/创建 |
| `/api/v1/keys/:key` | PUT/DELETE | 更新/删除 API Key |
| `/api/v1/teams` | GET/POST | 团队列表/创建 |
| `/api/v1/teams/:id` | PUT/DELETE | 更新/删除团队 |

### 认证方式

```bash
# 在请求头中携带 API Key
curl -H "X-API-Key: team_xxx" \
  http://localhost:3001/api/v1/usage/stats
```

---

## 📊 核心指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| AI 网关接入率 | 100% | 所有 AI 调用通过网关 |
| 知识库文档覆盖率 | >70% | 核心文档入库 |
| 门禁通过率 | >80% | 首次检查通过率 |
| 检索准确率 | >85% | RAG 检索准确率 |
| API 响应延迟 | <100ms | P95 延迟 |

---

## 📅 实施路线图

| 阶段 | 时间 | 里程碑 | 状态 |
|------|------|--------|------|
| **阶段一** | 3-4 月 | AI 网关 MVP + 管理页面 | ✅ 进行中 (75%) |
| **阶段二** | 4-6 月 | 门禁系统 + CI/CD 集成 | ⏳ 待启动 |
| **阶段三** | 7-9 月 | 多 Agent 协作 + 超级个体 | ⏳ 待启动 |
| **阶段四** | 10-12 月 | AI 数字人 + 80% 自动化 | ⏳ 待启动 |

---

## 🔒 安全设计

- ✅ **API Key 认证** - 所有 API 调用需携带 API Key
- ✅ **配额管理** - 按团队/个人维度限制用量
- ✅ **审计日志** - 记录所有 AI 调用
- ✅ **数据隔离** - 不同团队数据隔离
- ✅ **敏感信息过滤** - 网关层过滤敏感内容

---

## 📝 待办任务

**本周计划** (剩余 25%):

- [ ] 系统设置页面 - 网关配置、告警规则
- [ ] 门禁规则配置页面 - 可视化配置
- [ ] 日志查询页面 - AI 调用日志检索
- [ ] 实时数据刷新 - WebSocket 或轮询
- [ ] 导出功能 - Excel/CSV 导出

---

## 🤝 团队协作

### 角色分工

| 角色 | 职责 | 权限 |
|------|------|------|
| **管理员** | 系统配置、团队管理 | 全部权限 |
| **团队负责人** | 团队配额管理、成员管理 | 团队内全部权限 |
| **开发者** | API Key 使用、用量查看 | 只读权限 |

### 使用流程

1. **管理员创建团队** → 设置配额
2. **团队负责人创建 API Key** → 分配给开发者
3. **开发者调用 AI 网关** → 自动记录用量
4. **管理员查看报表** → 成本分析和优化

---

## 📞 技术支持

- **文档**: `/Users/xiaoran/.openclaw/workspace/projects/ai-platform/docs/`
- **API 文档**: http://localhost:3001/api-docs (开发中)
- **问题反馈**: 联系技术部

---

## 📄 许可证

内部使用 · 购商云汇 · 2026

---

*最后更新：2026-04-09*
