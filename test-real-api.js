/**
 * 测试真实的 DeepSeek 和千问 API 调用
 */

require('dotenv').config({ path: './ai-gateway/.env' });
const axios = require('axios');

const GATEWAY_URL = 'http://localhost:3001';

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const QWEN_KEY = process.env.QWEN_API_KEY || '';

async function testDeepSeek() {
  console.log('\n🔍 测试 DeepSeek API 调用...\n');
  
  try {
    const response = await axios.post(
      `${GATEWAY_URL}/v1/chat/completions`,
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: '你好，请用一句话介绍你自己，并告诉我你现在心情如何？' }
        ],
        max_tokens: 200,
      },
      {
        headers: {
          'X-API-Key': 'team_deepseek_qwen_001',
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ DeepSeek 调用成功！');
    console.log('回复:', response.data.choices[0].message.content);
    console.log('\n📊 使用统计:');
    console.log('  - Prompt Tokens:', response.data.usage.prompt_tokens);
    console.log('  - Completion Tokens:', response.data.usage.completion_tokens);
    console.log('  - Total Tokens:', response.data.usage.total_tokens);
    console.log('  - 成本：¥' + (response.data.usage.cost_cny || 0).toFixed(6));
    console.log('  - 响应时间:', response.data.gateway?.response_time_ms + 'ms');
    
  } catch (error) {
    console.error('❌ DeepSeek 调用失败:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('详情:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function testQwen() {
  console.log('\n\n🔍 测试千问 (Qwen) API 调用...\n');
  
  try {
    const response = await axios.post(
      `${GATEWAY_URL}/v1/chat/completions`,
      {
        model: 'qwen-plus',
        messages: [
          { role: 'user', content: '你好，请用一句话介绍你自己，并告诉我你现在心情如何？' }
        ],
        max_tokens: 200,
      },
      {
        headers: {
          'X-API-Key': 'team_deepseek_qwen_001',
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ 千问调用成功！');
    console.log('回复:', response.data.choices[0].message.content);
    console.log('\n📊 使用统计:');
    console.log('  - Prompt Tokens:', response.data.usage.prompt_tokens);
    console.log('  - Completion Tokens:', response.data.usage.completion_tokens);
    console.log('  - Total Tokens:', response.data.usage.total_tokens);
    console.log('  - 成本：¥' + (response.data.usage.cost_cny || 0).toFixed(6));
    console.log('  - 响应时间:', response.data.gateway?.response_time_ms + 'ms');
    
  } catch (error) {
    console.error('❌ 千问调用失败:', error.response?.data || error.message);
    if (error.response?.data) {
      console.error('详情:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

async function main() {
  console.log('='.repeat(70));
  console.log('🧪 AI Gateway 真实 API 调用测试');
  console.log('='.repeat(70));
  console.log('\n📋 配置信息:');
  console.log('  - Gateway URL:', GATEWAY_URL);
  console.log('  - DeepSeek API Key:', DEEPSEEK_KEY ? '已配置' : '未配置');
  console.log('  - 千问 API Key:', QWEN_KEY ? '已配置' : '未配置');
  console.log('\n' + '='.repeat(70));
  
  // 先测试 DeepSeek
  await testDeepSeek();
  
  // 再测试千问
  await testQwen();
  
  console.log('\n' + '='.repeat(70));
  console.log('🎉 测试完成！');
  console.log('='.repeat(70) + '\n');
  
  console.log('💡 提示：');
  console.log('  1. 访问 http://localhost:3011 查看管理页面');
  console.log('  2. Dashboard 应该显示刚才的调用记录');
  console.log('  3. API Key 管理页面应该显示真实的 API Key\n');
}

main().catch(console.error);
