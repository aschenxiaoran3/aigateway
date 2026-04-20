# 知识库 - RAG 向量化检索系统

> 阶段一目标：核心文档入库，检索准确率>85%

## 📦 项目结构

```
knowledge-base/
├── ingest/              # 数据入库管道
│   ├── document_loader.py
│   ├── code_parser.py
│   ├── chunker.py
│   └── embedder.py
├── retriever/           # 检索引擎
│   ├── semantic_search.py
│   ├── hybrid_search.py
│   └── reranker.py
├── api/                 # 检索 API
│   └── search_service.py
├── storage/             # 向量数据存储
│   └── qdrant_data/
├── config/              # 配置文件
│   └── kb_config.yaml
├── tests/               # 测试
├── requirements.txt
└── README.md
```

## 🚀 快速开始

### 前置要求

```bash
# Python 3.10+
python --version

# 安装依赖
pip install -r requirements.txt

# 启动 Qdrant (Docker)
docker run -p 6333:6333 -p 6334:6334 qdrant/qdrant
```

### 向量后端切换

默认会按以下顺序选择后端：

1. `VECTOR_STORE_PROVIDER` 显式指定
2. `QDRANT_URL`
3. `DASHVECTOR_ENDPOINT + DASHVECTOR_API_KEY`
4. 内存模式

#### 本地 Qdrant

```bash
export VECTOR_STORE_PROVIDER=qdrant
export QDRANT_URL=http://127.0.0.1:6333
```

#### 阿里云 DashVector

```bash
export VECTOR_STORE_PROVIDER=dashvector
export DASHVECTOR_ENDPOINT=https://YOUR_CLUSTER_ENDPOINT
export DASHVECTOR_API_KEY=sk-xxxxxxxx
# 可选
export DASHVECTOR_PARTITION=default
export DASHVECTOR_TIMEOUT_MS=30000
```

#### 固定 collection 策略

DashVector 实例通常有 collection 数量限制，生产环境建议长期复用固定 collection，而不是每次验证创建新的临时 collection：

```bash
export KNOWLEDGE_BASE_COLLECTION=phase1_knowledge_assets
export DEEPWIKI_KNOWLEDGE_COLLECTION=deepwiki_assets
# 验收脚本默认可复用 knowledge collection
export VERIFY_COLLECTION=phase1_knowledge_assets
```

#### Embedding 生产方案

推荐做法是“部署前预热 + 运行时只读本地目录”：

```bash
# 预热模型目录，补齐 tokenizer / modules / config 等小文件
npm run kb:model:prepare

# 运行时只读本地模型，不依赖外网下载
export EMBED_MODEL=BAAI/bge-m3
export EMBED_MODEL_PATH=/app/models/BAAI_bge-m3
export ALLOW_FALLBACK_EMBEDDING=false
export RERANK_MODEL=BAAI/bge-reranker-v2-m3
```

当前实现会优先使用：

1. `EMBED_MODEL_PATH`
2. 本地缓存中的完整模型目录
3. 远端模型名

如果生产环境设置了 `ALLOW_FALLBACK_EMBEDDING=false`，模型不可用时会直接启动失败，避免悄悄退回 hash embedding。

当前默认检索链路为：

1. dense retrieval
2. lexical retrieval (SQLite FTS)
3. Reciprocal Rank Fusion
4. reranker

### 入库文档

```bash
# 入库单个文档
python -m ingest.document_loader --file /path/to/doc.md

# 入库整个目录
python -m ingest.document_loader --dir /path/to/docs/

# 入库代码库
python -m ingest.code_parser --repo /path/to/repo
```

### 启动检索 API

```bash
python -m api.search_service
```

## 📊 知识分层

| 层级 | 内容 | 优先级 |
|------|------|--------|
| **规范层** | 《AI 工作手册》、编码规范、API 规范 | P0 |
| **工程产物层** | PRD、技术方案、Bug 报告、测试用例 | P1 |
| **代码层** | 核心业务代码、公共组件、API 定义 | P2 |

## 🔧 技术栈

| 组件 | 选型 |
|------|------|
| 向量数据库 | Qdrant / 阿里云 DashVector |
| 嵌入模型 | bge-m3 (dense 检索默认) |
| 重排序模型 | bge-reranker-v2-m3 |
| 文档处理 | Python + LangChain |
| 代码解析 | tree-sitter |
| 检索框架 | 自研轻量 RAG |

## 📈 核心指标

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| 检索准确率 | >85% | 人工抽样评估 |
| 检索延迟 | <100ms | P95 延迟 |
| 文档覆盖率 | >70% | 核心文档入库率 |
| 召回率 | >90% | 相关文档召回比例 |

## 🔌 API 接口

### 语义检索

```bash
POST /api/v1/search

{
  "query": "PRD 文档中用户模块的字段规范",
  "filters": {
    "doc_type": ["PRD", "规范"],
    "project": ["购商云汇"]
  },
  "top_k": 5
}
```

### 入库接口

```bash
POST /api/v1/ingest

{
  "content": "文档内容...",
  "metadata": {
    "type": "PRD",
    "project": "购商云汇",
    "version": "1.0"
  }
}
```

### 验收脚本

```bash
# 默认验证 knowledge-base + Qdrant
npm run kb:verify

# 验证 knowledge-base + DashVector
VECTOR_STORE_PROVIDER=dashvector \
DASHVECTOR_ENDPOINT=https://YOUR_CLUSTER_ENDPOINT \
DASHVECTOR_API_KEY=sk-xxxxxxxx \
npm run kb:verify
```

DashVector 模式下如果未指定 `VERIFY_COLLECTION`，脚本会默认复用 `KNOWLEDGE_BASE_COLLECTION`，避免额外消耗 collection 配额。

## 📝 待办任务

- [ ] 完成 Qdrant Docker 部署
- [ ] 实现文档加载器 (Markdown/PDF/Word)
- [ ] 实现代码解析器
- [ ] 实现分块策略 (chunker)
- [ ] 集成 bge-m3 / bge-reranker-v2-m3
- [ ] 实现语义检索 API
- [ ] 实现混合检索 (语义 + 关键词)
- [ ] 实现重排序 (reranker)
- [ ] 编写测试用例
- [ ] 性能优化

---

*最后更新：2026-04-09*
