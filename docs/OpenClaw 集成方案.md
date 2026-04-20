# OpenClaw 集成 AI 网关方案

## 🎯 目标

让 OpenClaw 通过 AI 网关调用大模型，实现用量统计。

---

## ✅ 方案对比

### 方案 1: 修改 OpenClaw 配置（不可行）❌

OpenClaw 不支持自定义 `proxy` 配置，会报错：
```
gateway: Unrecognized key: "proxy"
```

### 方案 2: OpenClaw 插件（推荐）✅

开发一个 OpenClaw 插件，拦截 LLM 调用并通过 AI 网关转发。

### 方案 3: 环境变量（简单）✅

通过环境变量重定向 API 调用。

---

## 🔧 实施方案

### 方法 A: 环境变量（立即生效）

创建或编辑 `~/.zshrc` 或 `~/.bashrc`：

```bash
# AI 网关环境变量
export OPENCLAW_LLM_ENDPOINT=http://localhost:3001/v1/chat/completions
export OPENCLAW_LLM_API_KEY=team_deepseek_qwen_001

# 模型映射
export OPENCLAW_MODEL_deepseek-chat=deepseek-chat
export OPENCLAW_MODEL_qwen-plus=qwen-plus
```

应用配置：
```bash
source ~/.zshrc
# 或
source ~/.bashrc
```

### 方法 B: OpenClaw 插件（需要开发）

插件位置：`~/.openclaw/plugins/ai-gateway-connector.js`

插件功能：
1. 拦截 `agent.run()` 调用
2. 转发到 AI 网关
3. 记录用量到数据库

### 方法 C: 修改 OpenClaw 源码（不推荐）

直接修改 OpenClaw 的 LLM Provider 配置。

---

## 📋 当前推荐方案

**使用 AI 网关独立统计**：

1. **手动调用测试**（已实现）
   ```bash
   node test-openai-compatible.js
   ```

2. **管理页面查看**（已实现）
   - 访问：http://localhost:3004
   - Dashboard 显示用量统计

3. **数据库查询**（已实现）
   ```sql
   SELECT model, COUNT(*), SUM(total_tokens), SUM(cost_cny)
   FROM gateway_usage_logs
   GROUP BY model;
   ```

---

## 🎯 完整集成步骤（未来）

### 步骤 1: 开发 OpenClaw 插件

```javascript
// ~/.openclaw/plugins/ai-gateway.js
module.exports = {
  name: 'ai-gateway',
  hooks: {
    'llm:call': async (model, messages) => {
      // 转发到 AI 网关
      return gateway.call(model, messages);
    }
  }
};
```

### 步骤 2: 配置 OpenClaw

```json
{
  "plugins": {
    "entries": {
      "ai-gateway": {
        "enabled": true,
        "config": {
          "baseUrl": "http://localhost:3001",
          "apiKey": "team_deepseek_qwen_001"
        }
      }
    }
  }
}
```

### 步骤 3: 重启 OpenClaw

```bash
openclaw gateway restart
```

---

## 📊 当前可用功能

✅ **独立使用 AI 网关**
- 通过 API 调用统计用量
- 管理页面查看统计
- 数据库查询

⏳ **OpenClaw 集成**
- 需要开发插件
- 或等待 OpenClaw 原生支持

---

## 💡 临时方案

在代码中使用 AI 网关：

```javascript
const axios = require('axios');

async function callLLM(prompt) {
  const response = await axios.post(
    'http://localhost:3001/v1/chat/completions',
    {
      model: 'qwen-plus',
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'X-API-Key': 'team_deepseek_qwen_001'
      }
    }
  );
  
  return response.data.choices[0].message.content;
}
```

---

## 📞 需要帮助？

联系萧然获取 OpenClaw 插件开发支持。
