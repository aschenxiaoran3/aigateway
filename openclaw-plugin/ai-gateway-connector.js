/**
 * OpenClaw AI 网关连接器插件
 * 
 * 功能：拦截 OpenClaw 的大模型调用，通过 AI 网关转发，实现用量统计
 */

const axios = require('axios');

// AI 网关配置
const GATEWAY_CONFIG = {
  baseUrl: 'http://localhost:3001',
  apiKey: 'team_deepseek_qwen_001',
  models: {
    'deepseek-chat': 'deepseek-chat',
    'qwen-plus': 'qwen-plus',
    'qwen3.5-plus': 'qwen-plus',
  }
};

/**
 * 拦截并转发大模型调用
 */
async function interceptLLMCall(originalCall, model, messages, options) {
  const gatewayModel = GATEWAY_CONFIG.models[model];
  
  if (!gatewayModel) {
    // 不支持的模型，直接调用原始方法
    return originalCall(model, messages, options);
  }
  
  try {
    console.log(`[AI Gateway] 拦截调用：${model} -> ${gatewayModel}`);
    
    const response = await axios.post(
      `${GATEWAY_CONFIG.baseUrl}/v1/chat/completions`,
      {
        model: gatewayModel,
        messages: messages,
        max_tokens: options?.maxTokens || 4096,
        temperature: options?.temperature || 0.7,
      },
      {
        headers: {
          'X-API-Key': GATEWAY_CONFIG.apiKey,
          'Content-Type': 'application/json',
        },
      }
    );
    
    const content = response.data.choices[0].message.content;
    const usage = response.data.usage;
    
    console.log(`[AI Gateway] 调用成功: ${usage?.total_tokens} tokens`);
    
    return {
      content,
      usage: {
        promptTokens: usage?.prompt_tokens,
        completionTokens: usage?.completion_tokens,
        totalTokens: usage?.total_tokens,
      },
      gateway: {
        model: gatewayModel,
        cost: usage?.cost_cny,
      }
    };
    
  } catch (error) {
    console.error('[AI Gateway] 调用失败:', error.message);
    // 回退到原始调用
    return originalCall(model, messages, options);
  }
}

// 导出插件
module.exports = {
  name: 'ai-gateway-connector',
  version: '1.0.0',
  description: 'AI 网关连接器 - 用量统计',
  interceptLLMCall,
};
