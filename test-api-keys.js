/**
 * 测试 AI Gateway 的 API Key 配置
 * 
 * 用法：node test-api-keys.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, 'ai-gateway/.env') });
const axios = require('axios');

const GATEWAY_URL = 'http://localhost:3001';

async function testDeepSeek() {
  console.log('\n🔍 测试 DeepSeek API...\n');
  
  try {
    const response = await axios.post(
      `${GATEWAY_URL}/v1/chat/completions`,
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: '你好，请用一句话介绍你自己' }
        ],
        max_tokens: 100,
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
    console.log('Token 使用:', response.data.usage);
    console.log('成本：¥' + (response.data.usage.cost_cny || 0).toFixed(6));
    
  } catch (error) {
    console.error('❌ DeepSeek 调用失败:', error.response?.data || error.message);
  }
}

async function testQwen() {
  console.log('\n🔍 测试千问 (Qwen) API...\n');
  
  try {
    const response = await axios.post(
      `${GATEWAY_URL}/v1/chat/completions`,
      {
        model: 'qwen-plus',
        messages: [
          { role: 'user', content: '你好，请用一句话介绍你自己' }
        ],
        max_tokens: 100,
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
    console.log('Token 使用:', response.data.usage);
    console.log('成本：¥' + (response.data.usage.cost_cny || 0).toFixed(6));
    
  } catch (error) {
    console.error('❌ 千问调用失败:', error.response?.data || error.message);
  }
}

async function testGatewayHealth() {
  console.log('\n🏥 检查 AI Gateway 健康状态...\n');
  
  try {
    const response = await axios.get(`${GATEWAY_URL}/health`);
    console.log('✅ AI Gateway 运行正常！');
    console.log('状态:', response.data);
  } catch (error) {
    console.error('❌ AI Gateway 无法访问:', error.message);
    console.log('\n请确保 AI Gateway 已启动：');
    console.log('  cd ai-gateway && npm start\n');
  }
}

async function main() {
  console.log('='.repeat(60));
  console.log('🧪 AI Gateway API Key 测试');
  console.log('='.repeat(60));
  
  // 检查环境变量
  if (!process.env.DEEPSEEK_API_KEY) {
    console.error('\n❌ 错误：DEEPSEEK_API_KEY 未配置！');
    console.error('请检查 ai-gateway/.env 文件\n');
    return;
  }
  
  if (!process.env.DASHSCOPE_API_KEY) {
    console.error('\n❌ 错误：DASHSCOPE_API_KEY 未配置！');
    console.error('请检查 ai-gateway/.env 文件\n');
    return;
  }
  
  console.log('\n✅ 环境变量配置正确');
  console.log('DeepSeek API Key: sk-' + process.env.DEEPSEEK_API_KEY.substring(3, 15) + '...');
  console.log('千问 API Key: sk-' + process.env.DASHSCOPE_API_KEY.substring(3, 15) + '...');
  
  // 运行测试
  await testGatewayHealth();
  await testDeepSeek();
  await testQwen();
  
  console.log('\n' + '='.repeat(60));
  console.log('🎉 测试完成！');
  console.log('='.repeat(60) + '\n');
}

main().catch(console.error);
