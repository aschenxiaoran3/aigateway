# AI 平台部署指南

> 购商云汇 AI 网关管理平台 - 生产环境部署手册

---

## 📋 目录

1. [环境要求](#环境要求)
2. [快速部署 (Docker)](#快速部署-docker)
3. [环境变量配置](#环境变量配置)
4. [服务说明](#服务说明)
5. [生产环境部署](#生产环境部署)
6. [本地开发模式](#本地开发模式)
7. [运维管理](#运维管理)
8. [故障排查](#故障排查)

---

## 环境要求

### 硬件要求

| 组件 | 最低配置 | 推荐配置 |
|------|----------|----------|
| CPU | 4 核 | 8 核+ |
| 内存 | 8 GB | 16 GB+ |
| 磁盘 | 20 GB SSD | 50 GB+ SSD |
| 网络 | 100 Mbps | 1 Gbps |

### 软件要求

| 软件 | 版本 | 说明 |
|------|------|------|
| Docker | 24.0+ | 容器运行时 |
| Docker Compose | 2.20+ | 编排工具 |
| Git | 2.40+ | 版本控制 |

---

## 快速部署 (Docker)

### 1. 克隆项目

```bash
git clone <repository-url> ai-platform
cd ai-platform
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入实际的 API Key
```

### 3. 启动服务

```bash
# 构建并启动所有服务
docker-compose up -d --build

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 4. 验证部署

```bash
# 检查管理页面
curl http://localhost:3000

# 检查 AI 网关
curl http://localhost:3001/health

# 检查知识库
curl http://localhost:8000/health

# 检查门禁系统
curl http://localhost:3002/health

# 检查 Redis
docker-compose exec redis redis-cli ping
```

### 5. 访问地址

| 服务 | 地址 | 说明 |
|------|------|------|
| 管理页面 | http://localhost:3000 | React 管理界面 |
| AI 网关 API | http://localhost:3001 | OpenAI 兼容接口 |
| 知识库检索 | http://localhost:8000 | FastAPI 语义检索 |
| 门禁系统 | http://localhost:3002 | CI/CD 门禁检查 |
| Qdrant 控制台 | http://localhost:6333/dashboard | 向量数据库 |
| Redis | localhost:6379 | 缓存/配额管理 |

---

## 环境变量配置

创建 `.env` 文件（参考 `.env.example`）：

```bash
# ========== AI 提供商 API Keys ==========
DEEPSEEK_API_KEY=sk-xxx           # DeepSeek API Key
DASHSCOPE_API_KEY=sk-xxx          # 通义千问 API Key
OPENAI_API_KEY=sk-xxx             # OpenAI API Key
ANTHROPIC_API_KEY=sk-ant-xxx      # Anthropic API Key

# ========== GitLab 集成 (可选) ==========
GITLAB_URL=https://gitlab.example.com
GITLAB_PRIVATE_TOKEN=glpat-xxx
GITLAB_WEBHOOK_SECRET=your-secret-token

# ========== 向量库配置 ==========
VECTOR_STORE_PROVIDER=dashvector
DASHVECTOR_ENDPOINT=https://your-cluster-endpoint.dashvector.cn-hangzhou.aliyuncs.com
DASHVECTOR_API_KEY=sk-xxx
KNOWLEDGE_BASE_COLLECTION=phase1_knowledge_assets
DEEPWIKI_KNOWLEDGE_COLLECTION=deepwiki_assets
VERIFY_COLLECTION=phase1_knowledge_assets
EMBED_MODEL=BAAI/bge-m3
EMBED_MODEL_PATH=/app/models/BAAI_bge-m3
ALLOW_FALLBACK_EMBEDDING=false
RERANK_MODEL=BAAI/bge-reranker-v2-m3
DEEPWIKI_QUERY_MAX_COMMUNITIES=3

# ========== 部署配置 ==========
NODE_ENV=production
LOG_LEVEL=info
```

> ⚠️ 安全提示：不要将 `.env` 文件提交到版本控制系统！

---

## 服务说明

### 架构概览

```
                    ┌─────────────────┐
                    │   管理页面 :3000 │
                    │   (React + Nginx)│
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   AI 网关 :3001  │
                    │  (Node.js/Express)│
                    └───┬─────┬───────┘
                        │     │
              ┌─────────▼┐   ┌▼──────────┐
              │ Redis    │   │ 外部 LLM   │
              │ :6379    │   │ APIs      │
              └──────────┘   └───────────┘

              ┌─────────────────┐
              │ 知识库 :8000     │
              │ (FastAPI + RAG) │
              └────┬────────────┘
                   │
              ┌────▼────────────┐
              │ Qdrant :6333    │
              │ (向量数据库)     │
              └─────────────────┘

              ┌─────────────────┐
              │ 门禁系统 :3002   │
              │ (Node.js)       │
              └────┬────────────┘
                   │
              ┌────▼────────────┐
              │ GitLab CI/CD    │
              │ Webhook         │
              └─────────────────┘
```

### 各服务详情

#### 1. admin-ui (管理页面)
- **技术栈**: React 18 + TypeScript + Ant Design
- **端口**: 3000
- **功能**: 用量监控、API Key 管理、团队管理、成本报表、门禁配置、日志查询
- **依赖**: ai-gateway

#### 2. ai-gateway (AI 网关)
- **技术栈**: Node.js + Express
- **端口**: 3001
- **功能**: 统一 LLM 接入、模型路由、限流、审计日志、成本追踪
- **接口**: OpenAI 兼容 `/v1/chat/completions`
- **依赖**: Redis (可选)

#### 3. knowledge-base (知识库)
- **技术栈**: Python + FastAPI
- **端口**: 8000
- **功能**: 文档加载、分块、嵌入、语义检索
- **依赖**: Qdrant 或 DashVector

#### 4. gate-engine (门禁系统)
- **技术栈**: Node.js
- **端口**: 3002
- **功能**: PRD/技术方案/代码门禁检查、GitLab CI 集成
- **依赖**: 无 (可连接知识库)

#### 5. qdrant / dashvector (向量数据库)
- **技术栈**: Rust
- **端口**: 6333 (HTTP), 6334 (gRPC)
- **功能**: 向量存储与检索

> 若生产环境使用 DashVector，建议长期复用 `phase1_knowledge_assets` 与 `deepwiki_assets` 两个固定 collection，不再为每次验收创建新的临时 collection。
>
> 若生产环境使用 `bge-m3` / `bge-reranker-v2-m3`，建议先运行 `npm run kb:model:prepare` 预热模型目录，并将该目录挂载到对应模型路径。运行态禁止依赖 HuggingFace 在线下载。

#### 6. redis (缓存)
- **技术栈**: Redis 7
- **端口**: 6379
- **功能**: 配额管理、限流、缓存

---

## 生产环境部署

### Nginx 反向代理

```nginx
server {
    listen 80;
    server_name ai-platform.example.com;

    # 管理页面
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # AI 网关 API
    location /api/gateway/ {
        rewrite ^/api/gateway/(.*) /$1 break;
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 300s;
    }

    # 知识库 API
    location /api/knowledge/ {
        rewrite ^/api/knowledge/(.*) /$1 break;
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
    }
}
```

### HTTPS 配置 (Let's Encrypt)

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d ai-platform.example.com

# 自动续期
sudo crontab -e
# 添加: 0 3 * * * certbot renew --quiet
```

### 数据备份

```bash
#!/bin/bash
# backup.sh - 数据备份脚本

BACKUP_DIR="/backup/ai-platform/$(date +%Y%m%d)"
mkdir -p "$BACKUP_DIR"

# 备份 Redis
docker-compose exec redis redis-cli BGSAVE
sleep 5
docker cp ai-platform-redis-1:/data/dump.rdb "$BACKUP_DIR/redis.rdb"

# 备份 Qdrant
docker-compose exec qdrant cp /qdrant/storage "$BACKUP_DIR/qdrant"

# 备份日志
docker cp ai-platform-ai-gateway-1:/app/logs "$BACKUP_DIR/gateway-logs"

# 压缩
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"

echo "Backup completed: $BACKUP_DIR.tar.gz"
```

### 健康检查

```bash
#!/bin/bash
# health-check.sh

SERVICES=("admin-ui:3000" "ai-gateway:3001/health" "knowledge-base:8000/health" "gate-engine:3002/health")
ALL_HEALTHY=true

for service in "${SERVICES[@]}"; do
    name="${service%%:*}"
    endpoint="${service##*:}"
    status=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$endpoint" 2>/dev/null)

    if [[ "$status" == "200" ]]; then
        echo "✅ $name: healthy"
    else
        echo "❌ $name: unhealthy (HTTP $status)"
        ALL_HEALTHY=false
    fi
done

if [[ "$ALL_HEALTHY" == false ]]; then
    echo "\n⚠️  部分服务不健康，请检查!"
    exit 1
fi

echo "\n✅ 所有服务运行正常"
exit 0
```

---

## 本地开发模式

### 前端开发

```bash
cd admin-ui
npm install
npm run dev      # 开发模式 (热重载)
npm run build    # 生产构建
```

### 网关开发

```bash
cd ai-gateway
npm install
npm run dev      # 开发模式 (nodemon)
npm start        # 生产模式
```

### 知识库开发

```bash
cd knowledge-base
pip install -r requirements.txt
python -m uvicorn api.search_service:app --reload --port 8000
```

### 门禁系统开发

```bash
cd gate-engine
npm install
node src/gate-runner.js --server
```

---

## 运维管理

### 常用命令

```bash
# 查看所有服务状态
docker-compose ps

# 查看某个服务日志
docker-compose logs -f ai-gateway

# 重启某个服务
docker-compose restart ai-gateway

# 进入容器
docker-compose exec ai-gateway sh

# 更新单个服务
docker-compose up -d --build ai-gateway

# 停止所有服务
docker-compose down

# 停止并清除数据
docker-compose down -v
```

### 日志管理

```bash
# 查看最近 100 行日志
docker-compose logs --tail=100 ai-gateway

# 导出日志到文件
docker-compose logs ai-gateway > gateway-$(date +%Y%m%d).log

# 审计日志 (JSON 格式)
docker-compose exec ai-gateway tail -f /app/logs/audit.log
```

### 性能调优

```bash
# Redis 内存优化
docker-compose exec redis redis-cli CONFIG SET maxmemory 512mb
docker-compose exec redis redis-cli CONFIG SET maxmemory-policy allkeys-lru

# 查看容器资源使用
docker stats
```

---

## 故障排查

### 常见问题

#### 1. 服务启动失败

```bash
# 查看具体错误
docker-compose logs <service-name>

# 检查端口占用
lsof -i :3000
lsof -i :3001
```

#### 2. Redis 连接失败

```bash
# 检查 Redis 是否运行
docker-compose exec redis redis-cli ping

# 重启 Redis
docker-compose restart redis
```

#### 3. 知识库检索超时

```bash
# 检查 Qdrant 状态
curl http://localhost:6333/healthz

# 检查 embedding 模型
docker-compose exec knowledge-base ls /app/models
```

#### 4. API 网关 502 错误

```bash
# 检查网关服务
curl http://localhost:3001/health

# 查看网关日志
docker-compose logs ai-gateway | tail -50
```

### 紧急恢复

```bash
# 完全重建
docker-compose down -v
docker-compose up -d --build

# 从备份恢复 Redis
docker cp redis.rdb ai-platform-redis-1:/data/dump.rdb
docker-compose restart redis
```

---

*最后更新：2026-04-10*
