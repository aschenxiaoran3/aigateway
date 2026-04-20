/**
 * 测试 AI 网关的 OpenAI 兼容性
 * 
 * 用于验证 OpenClaw 是否可以通过 AI 网关调用大模型
 */

const axios = require('axios');

const GATEWAY_URL = 'http://localhost:3001';
const API_KEY = 'team_deepseek_qwen_001';

async function testOpenAICompatible() {
  console.log('='.repeat(70));
  console.log('🧪 测试 AI 网关的 OpenAI 兼容性');
  console.log('='.repeat(70));
  console.log();
  
  // 测试 1: DeepSeek Chat
  console.log('📋 测试 1: DeepSeek Chat (OpenAI 兼容格式)');
  console.log('-'.repeat(70));
  
  try {
    const response = await axios.post(
      `${GATEWAY_URL}/v1/chat/completions`,
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'user', content: '你好，请用一句话介绍你自己' }
        ],
        max_tokens: 100,
        temperature: 0.7,
      },
      {
        headers: {
          'X-API-Key': API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ 调用成功！');
    console.log('回复:', response.data.choices[0].message.content);
    console.log('模型:', response.data.gateway?.model_used);
    console.log('Token:', response.data.usage?.total_tokens);
    console.log('成本：¥' + (response.data.usage?.cost_cny || 0).toFixed(6));
    console.log();
    
  } catch (error) {
    console.log('❌ 调用失败:', error.response?.data || error.message);
    console.log();
  }
  
  // 测试 2: Qwen Plus
  console.log('📋 测试 2: Qwen Plus (OpenAI 兼容格式)');
  console.log('-'.repeat(70));
  
  try {
    const response = await axios.post(
      `${GATEWAY_URL}/v1/chat/completions`,
      {
        model: 'qwen-plus',
        messages: [
          { role: 'user', content: '你好，请用一句话介绍你自己' }
        ],
        max_tokens: 100,
        temperature: 0.7,
      },
      {
        headers: {
          'X-API-Key': API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ 调用成功！');
    console.log('回复:', response.data.choices[0].message.content);
    console.log('模型:', response.data.gateway?.model_used);
    console.log('Token:', response.data.usage?.total_tokens);
    console.log('成本：¥' + (response.data.usage?.cost_cny || 0).toFixed(6));
    console.log();
    
  } catch (error) {
    console.log('❌ 调用失败:', error.response?.data || error.message);
    console.log();
  }
  
  // 测试 3: 自动路由
  console.log('📋 测试 3: 自动路由 (model: "auto")');
  console.log('-'.repeat(70));
  
  try {
    const response = await axios.post(
      `${GATEWAY_URL}/v1/chat/completions`,
      {
        model: 'auto',  // 自动路由
        messages: [
          { role: 'user', content: '写一首关于春天的诗' }
        ],
        max_tokens: 200,
        metadata: {
          purpose: 'PRD 生成',  // 用于路由决策
        },
      },
      {
        headers: {
          'X-API-Key': API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );
    
    console.log('✅ 调用成功！');
    console.log('回复:', response.data.choices[0].message.content);
    console.log('路由模型:', response.data.gateway?.model_used);
    console.log('路由理由:', response.data.gateway?.route_reason);
    console.log();
    
  } catch (error) {
    console.log('❌ 调用失败:', error.response?.data || error.message);
    console.log();
  }
  
  // 测试 4: 检查数据库记录
  console.log('📋 测试 4: 检查数据库记录');
  console.log('-'.repeat(70));
  
  const { exec } = require('child_process');
  
  const dbHost = process.env.DB_HOST || '127.0.0.1';
  const dbPort = process.env.DB_PORT || '3306';
  const dbUser = process.env.DB_USER || 'root';
  const dbName = process.env.DB_NAME || 'ai_gateway';
  const dbPassArg = process.env.DB_PASS ? `-p'${process.env.DB_PASS}'` : '';
  exec(
    `mysql -h ${dbHost} -P ${dbPort} -u ${dbUser} ${dbPassArg} ${dbName} -e "SELECT id, model, total_tokens, cost_cny, created_at FROM gateway_usage_logs ORDER BY created_at DESC LIMIT 5;"`,
    (error, stdout, stderr) => {
      if (error) {
        console.log('❌ 数据库查询失败:', error.message);
      } else {
        console.log('✅ 数据库记录:');
        console.log(stdout);
      }
      
      console.log('='.repeat(70));
      console.log('🎉 测试完成！');
      console.log('='.repeat(70));
      console.log();
      console.log('💡 OpenClaw 配置说明:');
      console.log('  1. 编辑 ~/.openclaw/openclaw.json');
      console.log('  2. 添加网关配置:');
      console.log('     {');
      console.log('       "gateway": {');
      console.log('         "proxy": {');
      console.log('           "enabled": true,');
      console.log('           "target": "http://localhost:3001",');
      console.log('           "api_key": "team_deepseek_qwen_001"');
      console.log('         }');
      console.log('       }');
      console.log('     }');
      console.log();
      console.log('  3. 重启 OpenClaw');
      console.log();
    }
  );
}

testOpenAICompatible().catch(console.error);
