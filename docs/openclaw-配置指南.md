# OpenClaw 配置 AI 网关指南

## 📋 配置目标

让 OpenClaw 通过 AI 网关调用大模型，实现用量统计和成本追踪。

---

## 🔧 配置方法

### 方法 1: 修改 OpenClaw 配置文件（推荐）

编辑 OpenClaw 配置文件：`~/.openclaw/openclaw.json`

```json
{
  "agents": {
    "defaults": {
      "models": {
        // 添加 AI 网关作为 Provider
        "gateway/deepseek-chat": {
          "alias": "DeepSeek (通过网关)",
          "endpoint": "http://localhost:3001/v1/chat/completions",
          "api_key": "team_deepseek_qwen_001"
        },
        "gateway/qwen-plus": {
          "alias": "Qwen (通过网关)",
          "endpoint": "http://localhost:3001/v1/chat/completions",
          "api_key": "team_deepseek_qwen_001"
        }
      }
    }
  },
  
  // 或者配置默认使用网关
  "gateway": {
    "mode": "local",
    "port": 18789,
    "proxy": {
      "enabled": true,
      "target": "http://localhost:3001",
      "api_key": "team_deepseek_qwen_001"
    }
  }
}
```

### 方法 2: 使用环境变量

```bash
# 设置 AI 网关为默认 Provider
export OPENCLAW_GATEWAY_URL=http://localhost:3001
export OPENCLAW_GATEWAY_API_KEY=team_deepseek_qwen_001

# 或者配置模型路由
export OPENCLAW_MODEL_deepseek=gateway://localhost:3001/deepseek-chat
export OPENCLAW_MODEL_qwen=gateway://localhost:3001/qwen-plus
```

### 方法 3: 修改 Provider 配置

如果 OpenClaw 使用 `providers` 配置：

```json
{
  "providers": {
    "gateway": {
      "type": "openai-compatible",
      "base_url": "http://localhost:3001/v1",
      "api_key": "team_deepseek_qwen_001",
      "models": {
        "deepseek-chat": {
          "name": "DeepSeek Chat",
          "context_length": 32000
        },
        "qwen-plus": {
          "name": "Qwen Plus",
          "context_length": 32000
        }
      }
    }
  }
}
```

---

## ✅ 验证配置

### 1. 测试 AI 网关

```bash
# 测试 DeepSeek
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "X-API-Key: team_deepseek_qwen_001" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好"}]
  }'

# 测试千问
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "X-API-Key: team_deepseek_qwen_001" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen-plus",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

### 2. 检查数据库记录

```sql
-- 查看用量日志
SELECT 
  model,
  COUNT(*) as request_count,
  SUM(total_tokens) as total_tokens,
  SUM(cost_cny) as total_cost
FROM gateway_usage_logs
GROUP BY model
ORDER BY created_at DESC;
```

### 3. 查看管理页面

访问：http://localhost:3004

- Dashboard 应该显示调用记录
- API Key 管理页面应该显示用量

---

##  配置后的效果

### Before (无法统计)
```
OpenClaw → 直接调用 千问/DeepSeek API
```

### After (可以统计)
```
OpenClaw → AI 网关 (3001) → 千问/DeepSeek API
           ↓
      记录用量到数据库
```

---

## 📊 用量统计示例

配置后，管理页面会显示：

| 指标 | 说明 |
|------|------|
| 总请求数 | OpenClaw 调用次数 |
| Token 使用 | 输入 + 输出 Token 总数 |
| 成本统计 | 按模型计算的成本 |
| 团队用量 | 各团队的用量排行 |

---

## 🔍 故障排查

### 问题 1: OpenClaw 无法连接网关

```bash
# 检查 AI 网关是否运行
curl http://localhost:3001/health

# 检查防火墙
lsof -i:3001

# 查看 AI 网关日志
tail -f /Users/xiaoran/.openclaw/workspace/projects/ai-platform/ai-gateway/logs/combined.log
```

### 问题 2: API Key 认证失败

```bash
# 验证 API Key
curl -X POST http://localhost:3001/v1/chat/completions \
  -H "X-API-Key: team_deepseek_qwen_001" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek-chat","messages":[{"role":"user","content":"hi"}]}'
```

### 问题 3: 数据库无记录

```bash
# 检查数据库连接
mysql -h <db-host> \
  -P 3306 -u <db-user> -p \
  <db-name> -e "SELECT COUNT(*) FROM gateway_usage_logs;"
```

---

## 📞 需要帮助？

联系萧然获取 OpenClaw 配置支持。
