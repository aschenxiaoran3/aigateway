# AI 平台架构设计文档

> **版本**: 1.0  
> **状态**: 草稿  
> **最后更新**: 2026-04-09  
> **负责人**: 技术总监  
> **同步**: 本设计与《购商云汇 2026 年产品研发体系 AI 组织能力升级汇报》保持一致

---

## 📋 文档控制

| 版本 | 日期 | 作者 | 变更说明 | 审核状态 |
|------|------|------|----------|----------|
| 0.1 | 2026-04-09 | 幽灵 AI | 初稿创建 | 待审核 |
| 1.0 | TBD | TBD | 阶段一 MVP 定稿 | 待审核 |

---

## 1. 概述

### 1.1 背景

根据《购商云汇 2026 年产品研发体系 AI 组织能力升级汇报》要求，需在阶段一（2026 年 3-4 月）完成三大核心基建：

1. **AI 网关** - 统一 LLM 接入层
2. **知识库** - RAG 向量化检索系统
3. **门禁系统** - CI/CD 检查点

本设计文档详细说明三大系统的技术架构、接口定义、部署方案。

### 1.2 目标

| 系统 | 阶段一目标 | 验收标准 |
|------|------------|----------|
| **AI 网关** | 统一接入、路由、审计、成本管控 | 试点团队 100% 接入，日志完整 |
| **知识库** | 核心文档入库，语义检索可用 | 检索准确率>85%，延迟<100ms |
| **门禁系统** | PRD/技术方案门禁上线 | 试点项目门禁接入率 100% |

### 1.3 范围

**包含**:
- AI 网关核心功能（认证、路由、审计、配额）
- 知识库 V1（文档加载、向量化、检索）
- 门禁系统 V1（规则引擎、执行器、CI/CD 集成）
- Docker Compose 部署方案

**不包含** (阶段二+):
- 多 Agent 协作编排
- 高级 Dashboard 和可观测性
- K8s 生产部署
- 职能岗位 AI 化集成

---

## 2. 整体架构

### 2.1 架构全景

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户层 (User Layer)                       │
│    产品/设计/研发/测试/运维 → AI 工作台 (统一入口)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      门禁系统 (Gate System)                      │
│   PRD 门禁 → 技术方案门禁 → 代码门禁 → 测试门禁 → 发布门禁        │
│   (CI/CD 集成 + 自检清单 + AI 初稿验证)                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AI 网关 (AI Gateway)                        │
│   ┌──────────┬──────────┬──────────┬──────────┬─────────────┐  │
│   │ 路由层   │ 鉴权层   │ 限流层   │ 审计层   │ 成本管控    │  │
│   └──────────┴──────────┴──────────┴──────────┴─────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    知识库 (RAG Knowledge Base)                   │
│   ┌──────────────┐  ┌──────────────┐  ┌─────────────────────┐  │
│   │ 文档向量化   │  │ 代码向量化   │  │ 工程产物向量化      │  │
│   │ (PRD/规范)   │  │ (Repo/Review)│  │ (Bug/用例/复盘)     │  │
│   └──────────────┘  └──────────────┘  └─────────────────────┘  │
│                        ↓ 向量数据库 (Qdrant)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     LLM Provider Layer                           │
│    DeepSeek │ Qwen │ Claude │ GPT-4 │ 本地模型 (Ollama)         │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈选型

| 系统 | 组件 | 技术选型 | 选型理由 |
|------|------|----------|----------|
| **AI 网关** | 框架 | Node.js + Express | 轻量、高性能、团队熟悉 |
| | 认证 | API Key + Redis | 简单、可扩展 |
| | 限流 | Redis 计数器 | 高性能、分布式友好 |
| | 日志 | Winston | 成熟、易扩展 |
| **知识库** | 向量库 | Qdrant | 轻量、易部署、性能优秀 |
| | 嵌入模型 | bge-large-zh | 中文场景优化 |
| | 框架 | Python + FastAPI | 生态丰富、开发效率高 |
| | 文档处理 | LangChain | 标准化、可扩展 |
| **门禁系统** | 框架 | Node.js | 与网关技术栈统一 |
| | 规则引擎 | YAML + 自研 | 灵活、可读性好 |
| | CI/CD 集成 | Webhook | 通用、解耦 |
| **部署** | 阶段一 | Docker Compose | 简单、快速 |
| | 阶段二+ | Kubernetes | 高可用、弹性伸缩 |

### 2.3 部署架构

#### 阶段一（开发/测试环境）

```yaml
单机部署，Docker Compose 管理：

ai-gateway      → 端口 3001
knowledge-base  → 端口 3002
gate-engine     → 端口 3003
qdrant          → 端口 6333, 6334
redis           → 端口 6379
```

#### 阶段二+（生产环境）

```yaml
Kubernetes 集群：

Namespace: ai-platform
├── Deployment: ai-gateway (3 副本)
├── Deployment: knowledge-base (2 副本)
├── Deployment: gate-engine (2 副本)
├── StatefulSet: qdrant (3 副本)
├── Redis Cluster (3 主 3 从)
└── Ingress + TLS
```

---

## 3. AI 网关详细设计

### 3.1 功能模块

```
ai-gateway/
├── src/
│   ├── index.js              # 主入口
│   ├── middleware/
│   │   ├── auth.js           # 认证中间件
│   │   ├── rate-limit.js     # 限流中间件 (TODO)
│   │   ├── audit.js          # 审计日志中间件 (TODO)
│   │   └── cost-tracker.js   # 成本追踪中间件 (TODO)
│   └── routes/
│       └── model-router.js   # 模型路由
├── config/
│   └── gateway.config.yaml   # 网关配置
└── package.json
```

### 3.2 核心流程

#### 3.2.1 请求处理流程

```
1. 接收请求
   ↓
2. 认证中间件 (验证 API Key)
   ↓
3. 限流中间件 (检查配额)
   ↓
4. 审计中间件 (记录请求日志)
   ↓
5. 模型路由 (选择 LLM Provider)
   ↓
6. 调用 LLM
   ↓
7. 成本追踪 (记录 Token 消耗)
   ↓
8. 返回响应
```

#### 3.2.2 模型路由策略

| 任务类型 | 推荐模型 | 路由理由 |
|----------|----------|----------|
| PRD 生成 | qwen-plus | 中文场景，平衡质量和成本 |
| 技术方案 | qwen-plus | 中文场景，平衡质量和成本 |
| 代码生成 | deepseek-chat | 代码能力强，成本低 |
| 代码审查 | deepseek-chat | 代码能力强，成本低 |
| 测试用例 | qwen-plus | 中文场景，平衡质量 |
| 数据分析 | gpt-4-turbo | 复杂分析用高质量模型 |
| 文档翻译 | deepseek-chat | 成本低，质量好 |
| 默认 | qwen-plus | 平衡选择 |

### 3.3 API 设计

#### 3.3.1 统一调用接口 (OpenAI 兼容)

```http
POST /v1/chat/completions
Content-Type: application/json

Headers:
  X-API-Key: <团队/个人 API Key>
  X-Project-Id: <项目 ID>
  X-User-Id: <用户 ID>

Body:
{
  "model": "auto",  // 或指定 deepseek/qwen/claude
  "messages": [
    {"role": "user", "content": "你好"}
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "metadata": {
    "purpose": "PRD 生成",  // 用途标签
    "pipeline": "product"   // 所属管道
  }
}

Response:
{
  "id": "chatcmpl-xxx",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "你好！有什么可以帮助你的？"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 20,
    "total_tokens": 30,
    "cost_cny": 0.015
  },
  "gateway": {
    "model_used": "qwen-plus",
    "provider": "qwen",
    "route_reason": "auto_selected",
    "response_time_ms": 245,
    "quota_remaining": 9850
  }
}
```

#### 3.3.2 配额查询接口

```http
GET /v1/quota

Response:
{
  "quota": {
    "daily_limit": 10000,
    "daily_used": 1500,
    "daily_remaining": 8500,
    "monthly_limit": 300000,
    "monthly_used": 45000,
    "monthly_remaining": 255000
  },
  "timestamp": "2026-04-09T14:00:00Z"
}
```

### 3.4 数据模型

#### 3.4.1 API Key 结构

```json
{
  "key": "team_xxx",
  "type": "team",  // team | user | proj
  "id": "team_001",
  "name": "测试团队",
  "quota": {
    "daily": 100000,
    "monthly": 3000000
  },
  "allowed_models": ["deepseek", "qwen", "gpt-4"],
  "created_at": "2026-04-01T00:00:00Z",
  "expires_at": null
}
```

#### 3.4.2 审计日志结构

```json
{
  "request_id": "uuid-xxx",
  "timestamp": "2026-04-09T14:00:00Z",
  "user_id": "user_001",
  "team_id": "team_001",
  "model": "qwen-plus",
  "purpose": "PRD 生成",
  "input_tokens": 100,
  "output_tokens": 200,
  "cost_cny": 0.15,
  "response_time_ms": 245,
  "status": "success"
}
```

---

## 4. 知识库详细设计

### 4.1 功能模块

```
knowledge-base/
├── ingest/
│   ├── document_loader.py    # 文档加载器
│   ├── code_parser.py        # 代码解析器 (TODO)
│   ├── chunker.py            # 分块策略 (TODO)
│   └── embedder.py           # 嵌入模型 (TODO)
├── retriever/
│   ├── semantic_search.py    # 语义检索 (TODO)
│   ├── hybrid_search.py      # 混合检索 (TODO)
│   └── reranker.py           # 重排序 (TODO)
├── api/
│   └── search_service.py     # 检索 API (TODO)
├── storage/
│   └── qdrant_data/
└── requirements.txt
```

### 4.2 知识分层

| 层级 | 内容 | 优先级 | 入库方式 |
|------|------|--------|----------|
| **规范层** | 《AI 工作手册》、编码规范、API 规范 | P0 | 手动入库 |
| **工程产物层** | PRD、技术方案、Bug 报告、测试用例 | P1 | 自动入库 |
| **代码层** | 核心业务代码、公共组件、API 定义 | P2 | 定期同步 |

### 4.3 向量化流程

```
1. 文档加载
   ↓
2. 文本清洗
   ↓
3. 分块 (Chunking)
   ↓
4. 向量化 (Embedding)
   ↓
5. 存入 Qdrant
   ↓
6. 建立索引
```

### 4.4 API 设计

#### 4.4.1 语义检索接口

```http
POST /api/v1/search
Content-Type: application/json

Body:
{
  "query": "PRD 文档中用户模块的字段规范",
  "filters": {
    "doc_type": ["PRD", "规范"],
    "project": ["购商云汇"],
    "date_range": {"gte": "2026-01-01"}
  },
  "top_k": 5,
  "with_content": true
}

Response:
{
  "results": [
    {
      "id": "doc_123",
      "score": 0.92,
      "content": "用户模块字段规范：...",
      "metadata": {
        "source": "PRD-2026-Q2-001",
        "section": "3.2 用户模型",
        "updated_at": "2026-03-15"
      }
    }
  ],
  "query_embedding_used": true,
  "search_time_ms": 45
}
```

---

## 5. 门禁系统详细设计

### 5.1 功能模块

```
gate-engine/
├── src/
│   ├── index.js              # 主入口 (TODO)
│   └── gate-runner.js        # 门禁执行引擎
├── rules/
│   ├── prd-gate.yaml         # PRD 门禁规则
│   ├── tech-gate.yaml        # 技术方案门禁 (TODO)
│   └── code-gate.yaml        # 代码门禁 (TODO)
├── integrations/
│   ├── gitlab-ci.js          # GitLab 集成 (TODO)
│   └── dingtalk.js           # 钉钉通知 (TODO)
└── package.json
```

### 5.2 门禁类型

| 门禁 | 检查点 | 触发条件 | 阶段 |
|------|--------|----------|------|
| **PRD 门禁** | AI 初稿、自检清单、价值评估 | PR 创建/更新 | 阶段一 |
| **技术方案门禁** | AI 初稿、架构规范、接口一致性 | PR 创建/更新 | 阶段一 |
| **代码门禁** | Code Review、单元测试、规范检查 | PR 创建/更新 | 阶段二 |
| **测试用例门禁** | AI 生成、覆盖率、边界场景 | 提测前 | 阶段二 |
| **发布门禁** | 自动化验收、回滚方案、监控配置 | 发布前 | 阶段二 |

### 5.3 规则引擎

#### 5.3.1 规则结构 (YAML)

```yaml
gate:
  name: PRD 门禁
  version: 1.0
  stage: product

checks:
  - name: AI 初稿检查
    type: required_field
    field: ai_generated
    required: true
    weight: 10

  - name: 自检清单
    type: checklist
    items: [...]
    min_pass: 4
    weight: 15

pass_criteria:
  min_total_score: 70
  required_checks:
    - AI 初稿检查
    - 文档格式检查

on_fail:
  action: block
  notify:
    - type: dingtalk
      target: product_group
```

#### 5.3.2 检查类型

| 类型 | 说明 | 实现状态 |
|------|------|----------|
| `required_field` | 必需字段检查 | ✅ 已完成 |
| `format_check` | 文档格式检查 | ✅ 已完成 |
| `checklist` | 自检清单检查 | ✅ 已完成 |
| `pattern_check` | 正则模式匹配 | ✅ 已完成 |
| `knowledge_check` | 知识库一致性 | ⏳ 阶段二 |
| `rag_reference` | RAG 参考检查 | ⏳ 阶段二 |

---

## 6. 部署方案

### 6.1 前置要求

| 组件 | 版本 | 用途 |
|------|------|------|
| Docker | 24+ | 容器运行 |
| Docker Compose | 2.20+ | 服务编排 |
| Node.js | 20+ | AI 网关/门禁系统 |
| Python | 3.10+ | 知识库 |

### 6.2 一键启动

```bash
# 克隆项目
cd /Users/xiaoran/.openclaw/workspace/projects/ai-platform

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 API Key

# 启动所有服务
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f ai-gateway
```

### 6.3 服务端口

| 服务 | 端口 | 用途 |
|------|------|------|
| ai-gateway | 3001 | AI 网关 API |
| knowledge-base | 3002 | 知识库检索 API |
| gate-engine | 3003 | 门禁系统 API |
| qdrant | 6333 | 向量数据库 HTTP |
| qdrant | 6334 | 向量数据库 gRPC |
| redis | 6379 | 配额管理 |

### 6.4 健康检查

```bash
# AI 网关
curl http://localhost:3001/health

# 知识库
curl http://localhost:3002/health

# 门禁系统
curl http://localhost:3003/health
```

---

## 7. 监控与告警

### 7.1 核心指标

| 指标 | 告警阈值 | 监控方式 |
|------|----------|----------|
| AI 网关响应时间 | P95 > 5s | Prometheus |
| 知识库检索延迟 | P95 > 100ms | Prometheus |
| 门禁检查失败率 | > 20% | 钉钉告警 |
| API 错误率 | > 5% | 钉钉告警 |
| Token 配额消耗 | > 80% | 钉钉告警 |

### 7.2 日志收集

```yaml
日志路径:
  ai-gateway:      /Users/xiaoran/.openclaw/workspace/projects/ai-platform/ai-gateway/logs/
  knowledge-base:  /Users/xiaoran/.openclaw/workspace/projects/ai-platform/knowledge-base/logs/
  gate-engine:     /Users/xiaoran/.openclaw/workspace/projects/ai-platform/gate-engine/logs/

日志级别:
  开发环境：DEBUG
  生产环境：INFO
```

---

## 8. 安全设计

### 8.1 认证与授权

- **API Key 认证**: 所有 API 调用需携带 API Key
- **配额管理**: 按团队/个人维度限制 Token 消耗
- **权限隔离**: 不同团队数据隔离

### 8.2 数据安全

- **敏感信息过滤**: 网关层过滤敏感内容
- **审计日志**: 所有 AI 调用记录完整日志
- **数据加密**: 传输层 TLS 加密

### 8.3 合规要求

- **内容审计**: 记录所有 AI 生成内容
- **成本管控**: Token 消耗可追溯
- **访问控制**: API Key 可撤销、可过期

---

## 9. 演进路线

### 阶段一 (2026.03-04)

- [x] AI 网关 MVP（认证、路由、日志）
- [ ] 知识库 V1（文档加载、向量化、检索）
- [ ] 门禁系统 V1（PRD/技术方案门禁）
- [ ] Docker Compose 部署

### 阶段二 (2026.04-06)

- [ ] AI 网关增强（限流、成本追踪、Dashboard）
- [ ] 知识库 V2（代码入库、混合检索、重排序）
- [ ] 门禁系统 V2（代码/测试/发布门禁）
- [ ] CI/CD 深度集成（GitLab、钉钉）

### 阶段三 (2026.07-09)

- [ ] 多 Agent 协作编排
- [ ] 知识库 V3（自动更新、质量评估）
- [ ] 超级个体试点支持
- [ ] K8s 生产部署

---

## 10. 附录

### 10.1 术语表

| 术语 | 含义 |
|------|------|
| **AI 网关** | 统一接入大模型等 AI 服务的入口 |
| **RAG** | Retrieval-Augmented Generation，检索增强生成 |
| **门禁** | CI/CD 中的检查点，确保产出物符合规范 |
| **Pipeline** | 自动化管道，如产品管道、技术管道 |
| **Harness** | AI 工程化框架，支持多 Agent 协作 |

### 10.2 参考文档

- 《购商云汇 2026 年产品研发体系 AI 组织能力升级汇报.md》
- 《购商云汇 2026-2027 年 AI 原生研发转型战略规划-PPT 提纲.md》
- [OpenClaw 文档](https://docs.openclaw.ai)

---

*文档结束*
