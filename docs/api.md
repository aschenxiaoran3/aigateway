# AI 平台 API 文档

> **版本**: 1.0  
> **状态**: 草稿  
> **最后更新**: 2026-04-09  
> **基础 URL**: 
> - AI 网关：`http://localhost:3001`
> - 知识库：`http://localhost:3002`
> - 门禁系统：`http://localhost:3003`

---

## 📋 目录

1. [AI 网关 API](#1-ai 网关-api)
2. [知识库 API](#2-知识库-api)
3. [门禁系统 API](#3-门禁系统-api)
4. [错误码说明](#4-错误码说明)
5. [认证说明](#5-认证说明)

---

## 1. AI 网关 API

### 1.1 统一调用接口 (OpenAI 兼容)

**调用大模型进行对话**

```http
POST /v1/chat/completions
Content-Type: application/json
```

#### 请求头

|  Header | 必填 | 说明 |
|---------|------|------|
| `X-API-Key` | 是 | API Key（团队/个人/项目） |
| `X-Project-Id` | 否 | 项目 ID（用于成本归集） |
| `X-User-Id` | 否 | 用户 ID（用于配额统计） |

#### 请求体

```json
{
  "model": "auto",
  "messages": [
    {
      "role": "user",
      "content": "你好，请帮我写一份 PRD"
    }
  ],
  "max_tokens": 4096,
  "temperature": 0.7,
  "metadata": {
    "purpose": "PRD 生成",
    "pipeline": "product"
  }
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | 否 | `auto` | 模型名称或 `auto` 自动路由 |
| `messages` | array | 是 | - | 对话消息列表 |
| `max_tokens` | integer | 否 | `4096` | 最大生成 Token 数 |
| `temperature` | float | 否 | `0.7` | 温度值 (0-2) |
| `metadata` | object | 否 | - | 元数据（用途、管道等） |

**支持的模型**:

| 模型名 | Provider | 说明 |
|--------|----------|------|
| `auto` | - | 自动路由（推荐） |
| `deepseek-chat` | DeepSeek | 代码能力强，成本低 |
| `qwen-plus` | Qwen | 中文场景，平衡选择 |
| `gpt-4-turbo` | OpenAI | 高质量，复杂任务 |
| `claude-3-sonnet` | Anthropic | 长上下文 |

#### 响应

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1712649600,
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "你好！这是一份 PRD 草稿..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 200,
    "total_tokens": 210,
    "cost_cny": 0.105
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

**响应字段说明**:

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 请求 ID |
| `choices` | array | 生成结果列表 |
| `usage` | object | Token 使用情况 |
| `gateway` | object | 网关附加信息 |

---

### 1.2 配额查询

**查询当前 API Key 的配额使用情况**

```http
GET /v1/quota
```

#### 响应

```json
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

---

### 1.3 使用统计

**查询 API 调用统计**

```http
GET /v1/usage?start_date=2026-04-01&end_date=2026-04-09
```

#### 参数

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `start_date` | string | 否 | 开始日期 (YYYY-MM-DD) |
| `end_date` | string | 否 | 结束日期 (YYYY-MM-DD) |

#### 响应

```json
{
  "summary": {
    "total_requests": 1250,
    "total_tokens": 125000,
    "total_cost_cny": 62.5
  },
  "by_model": {
    "qwen-plus": {"requests": 800, "tokens": 80000},
    "deepseek-chat": {"requests": 400, "tokens": 40000},
    "gpt-4-turbo": {"requests": 50, "tokens": 5000}
  },
  "by_day": [
    {"date": "2026-04-09", "requests": 150, "tokens": 15000}
  ]
}
```

---

### 1.4 健康检查

**检查网关服务状态**

```http
GET /health
```

#### 响应

```json
{
  "status": "healthy",
  "timestamp": "2026-04-09T14:00:00Z",
  "version": "1.0.0"
}
```

---

## 2. 知识库 API

### 2.1 语义检索

**检索相关文档**

```http
POST /api/v1/search
Content-Type: application/json
```

#### 请求体

```json
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
```

**参数说明**:

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `query` | string | 是 | - | 检索查询 |
| `filters` | object | 否 | - | 过滤条件 |
| `top_k` | integer | 否 | `5` | 返回结果数 |
| `with_content` | boolean | 否 | `false` | 是否返回完整内容 |

#### 响应

```json
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

### 2.2 文档入库

**将文档添加到知识库**

```http
POST /api/v1/ingest
Content-Type: application/json
```

#### 请求体

```json
{
  "content": "文档内容...",
  "metadata": {
    "type": "PRD",
    "project": "购商云汇",
    "version": "1.0",
    "author": "user_001"
  }
}
```

#### 响应

```json
{
  "id": "doc_456",
  "status": "indexed",
  "chunks_created": 5,
  "timestamp": "2026-04-09T14:00:00Z"
}
```

---

### 2.3 健康检查

```http
GET /health
```

#### 响应

```json
{
  "status": "healthy",
  "qdrant_connected": true,
  "document_count": 1250,
  "timestamp": "2026-04-09T14:00:00Z"
}
```

---

## 3. 门禁系统 API

### 3.1 执行门禁检查

**对文档执行门禁检查**

```http
POST /api/v1/gate/check
Content-Type: application/json
```

#### 请求体

```json
{
  "gate_type": "prd",
  "content": "# PRD 文档内容...",
  "metadata": {
    "document_name": "用户模块 PRD",
    "author": "user_001",
    "project": "购商云汇"
  }
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `gate_type` | string | 是 | 门禁类型：`prd` / `tech` / `code` |
| `content` | string | 是 | 文档内容 |
| `metadata` | object | 否 | 元数据 |

#### 响应

**通过**:

```json
{
  "gate_name": "PRD 门禁",
  "gate_version": "1.0",
  "timestamp": "2026-04-09T14:00:00Z",
  "document": "用户模块 PRD",
  "author": "user_001",
  "passed": true,
  "total_score": 85,
  "max_score": 100,
  "checks": [
    {
      "name": "AI 初稿检查",
      "type": "required_field",
      "passed": true,
      "score": 10,
      "message": "✅ AI 初稿标识存在"
    }
  ]
}
```

**失败**:

```json
{
  "gate_name": "PRD 门禁",
  "gate_version": "1.0",
  "timestamp": "2026-04-09T14:00:00Z",
  "document": "用户模块 PRD",
  "author": "user_001",
  "passed": false,
  "total_score": 60,
  "max_score": 100,
  "failed_checks": ["大数据价值评估", "自检清单"],
  "checks": [
    {
      "name": "大数据价值评估",
      "type": "required_field",
      "passed": false,
      "score": 0,
      "message": "❌ 必须附带大数据价值评估报告"
    }
  ]
}
```

---

### 3.2 查询门禁状态

**查询特定 MR/PR 的门禁状态**

```http
GET /api/v1/gate/status?mr_id=12345
```

#### 响应

```json
{
  "mr_id": "12345",
  "gates": [
    {
      "type": "prd",
      "status": "passed",
      "checked_at": "2026-04-09T14:00:00Z",
      "score": 85
    },
    {
      "type": "tech",
      "status": "pending",
      "checked_at": null,
      "score": null
    }
  ]
}
```

---

### 3.3 健康检查

```http
GET /health
```

#### 响应

```json
{
  "status": "healthy",
  "rules_loaded": 3,
  "timestamp": "2026-04-09T14:00:00Z"
}
```

---

## 4. 错误码说明

### 4.1 通用错误

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `AuthenticationError` | 401 | 认证失败（API Key 无效/过期） |
| `PermissionDenied` | 403 | 权限不足 |
| `RateLimitExceeded` | 429 | 超过配额限制 |
| `NotFoundError` | 404 | 资源不存在 |
| `ValidationError` | 400 | 请求参数验证失败 |
| `ServerError` | 500 | 服务器内部错误 |

### 4.2 错误响应格式

```json
{
  "error": {
    "message": "Invalid API Key",
    "type": "AuthenticationError",
    "code": "invalid_api_key"
  },
  "request_id": "uuid-xxx"
}
```

---

## 5. 认证说明

### 5.1 API Key 获取

联系平台管理员获取 API Key：

- **团队 Key**: `team_xxx` - 团队共享配额
- **个人 Key**: `user_xxx` - 个人配额
- **项目 Key**: `proj_xxx` - 项目专用配额

### 5.2 使用方式

在请求头中携带 API Key：

```bash
# 方式 1: X-API-Key 头
curl -H "X-API-Key: team_xxx" http://localhost:3001/v1/chat/completions

# 方式 2: Authorization 头
curl -H "Authorization: Bearer team_xxx" http://localhost:3001/v1/chat/completions
```

### 5.3 安全建议

- ⚠️ **不要**将 API Key 提交到代码仓库
- ⚠️ **不要**在前端代码中暴露 API Key
- ✅ 使用环境变量存储 API Key
- ✅ 定期轮换 API Key
- ✅ 按最小权限原则分配配额

---

## 6. 示例代码

### 6.1 Node.js 示例

```javascript
const axios = require('axios');

async function callAI(prompt) {
  const response = await axios.post(
    'http://localhost:3001/v1/chat/completions',
    {
      model: 'auto',
      messages: [{ role: 'user', content: prompt }],
      metadata: { purpose: 'PRD 生成' }
    },
    {
      headers: {
        'X-API-Key': process.env.AI_GATEWAY_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
  
  return response.data.choices[0].message.content;
}

// 使用
const prd = await callAI('帮我写一份用户登录功能的 PRD');
console.log(prd);
```

### 6.2 Python 示例

```python
import requests

def call_ai(prompt):
    response = requests.post(
        'http://localhost:3001/v1/chat/completions',
        json={
            'model': 'auto',
            'messages': [{'role': 'user', 'content': prompt}],
            'metadata': {'purpose': 'PRD 生成'}
        },
        headers={
            'X-API-Key': 'team_xxx',
            'Content-Type': 'application/json'
        }
    )
    return response.json()['choices'][0]['message']['content']

# 使用
prd = call_ai('帮我写一份用户登录功能的 PRD')
print(prd)
```

### 6.3 门禁检查示例 (curl)

```bash
curl -X POST http://localhost:3003/api/v1/gate/check \
  -H "Content-Type: application/json" \
  -d '{
    "gate_type": "prd",
    "content": "# 用户模块 PRD\n\n## 需求背景\n...",
    "metadata": {
      "document_name": "用户模块 PRD",
      "author": "user_001"
    }
  }'
```

---

*文档结束*
