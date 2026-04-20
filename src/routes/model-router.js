/**
 * 模型路由 - 根据任务类型路由到不同 LLM
 * 
 * 路由策略:
 * 1. 成本优先：简单任务 → 便宜模型
 * 2. 质量优先：复杂任务 → 高质量模型
 * 3. 用户指定：直接使用指定模型
 * 
 * 支持的模型（本部署以通义 qwen3.6-plus 为主；自动路由默认亦指向该模型）
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const db = require('../db/mysql');
const { v4: uuidv4 } = require('uuid');

require('../lib/load-env');

console.log('[Model Router] DASHSCOPE_API_KEY:', process.env.DASHSCOPE_API_KEY ? 'CONFIGURED ✓' : 'MISSING ✗');

const logDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [new winston.transports.File({ filename: path.join(logDir, 'router.log') })],
});
const CONTROL_PLANE_BASE_URL = (process.env.CONTROL_PLANE_BASE_URL || 'http://127.0.0.1:3104').replace(/\/$/, '');

// 模型配置
const MODEL_CONFIGS = {
  'qwen3.6-plus': {
    provider: 'qwen',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    api_key_env: 'DASHSCOPE_API_KEY',
    cost_per_1k_tokens: { input: 0.002, output: 0.006 },
    max_tokens: 32000,
    capabilities: ['chat', 'code', 'analysis', 'chinese'],
    priority: 'balanced',
  },
  /** 兼容旧客户端仍传 qwen3.5-plus；上游 DashScope 按 qwen3.6-plus 调用 */
  'qwen3.5-plus': {
    provider: 'qwen',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    api_key_env: 'DASHSCOPE_API_KEY',
    cost_per_1k_tokens: { input: 0.002, output: 0.006 },
    max_tokens: 32000,
    capabilities: ['chat', 'code', 'analysis', 'chinese'],
    priority: 'balanced',
    upstream_model: 'qwen3.6-plus',
  },
  'gpt-4-turbo': {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    api_key_env: 'OPENAI_API_KEY',
    cost_per_1k_tokens: { input: 0.01, output: 0.03 },
    max_tokens: 128000,
    capabilities: ['chat', 'code', 'analysis', 'vision'],
    priority: 'high_quality',
  },
  'claude-3-sonnet': {
    provider: 'anthropic',
    endpoint: 'https://api.anthropic.com/v1/messages',
    api_key_env: 'ANTHROPIC_API_KEY',
    cost_per_1k_tokens: { input: 0.003, output: 0.015 },
    max_tokens: 200000,
    capabilities: ['chat', 'code', 'analysis', 'long_context'],
    priority: 'high_quality',
  },
};

/**
 * OpenClaw 等客户端请求的 model 常为 `qwen/qwen3.6-plus`，MODEL_CONFIGS 键为 `qwen3.6-plus`
 */
function normalizeGatewayModelId(model) {
  if (!model || model === 'auto') return model;
  if (model === 'qwen-plus') return 'qwen3.6-plus';
  if (MODEL_CONFIGS[model]) return model;
  const m = model.match(/^(?:qwen|modelstudio)\/(.+)$/);
  if (m && MODEL_CONFIGS[m[1]]) return m[1];
  return model;
}

// 自动路由规则
function selectModel(requestBody, keyInfo) {
  let { model, metadata } = requestBody;
  
  // 用户指定模型
  if (model && model !== 'auto') {
    model = normalizeGatewayModelId(model);
    if (!MODEL_CONFIGS[model]) {
      throw new Error(`Unsupported model: ${model}`);
    }
    if (!keyInfo.allowed_models.includes(MODEL_CONFIGS[model].provider)) {
      throw new Error(`Model ${model} not allowed for your API key`);
    }
    return model;
  }
  
  // 自动路由 - 根据任务类型
  const purpose = metadata?.purpose || 'general';
  
  const routingRules = {
    'PRD 生成': 'qwen3.6-plus',
    '技术方案': 'qwen3.6-plus',
    '代码生成': 'qwen3.6-plus',
    '代码审查': 'qwen3.6-plus',
    '测试用例': 'qwen3.6-plus',
    '数据分析': 'qwen3.6-plus',
    '文档翻译': 'qwen3.6-plus',
    'general': 'qwen3.6-plus',
  };
  
  const selectedModel = routingRules[purpose] || routingRules['general'];
  
  logger.info('Auto model selection', {
    purpose,
    selected_model: selectedModel,
    reason: routingRules[selectedModel] ? 'purpose_based' : 'default',
  });
  
  return selectedModel;
}

/**
 * 通义等模型可能在 message.content 为空时把可见文本放在 reasoning_content；
 * OpenClaw/飞书只认 content，会导致 replies=0。上游若走流式，本网关当前未做 SSE 代理，须强制非流式。
 */
function normalizeOpenAICompletionPayload(data) {
  if (!data || !Array.isArray(data.choices) || data.choices.length === 0) return data;
  const msg = data.choices[0].message;
  if (!msg || typeof msg !== 'object') return data;
  const c = msg.content;
  const emptyString = typeof c === 'string' && c.trim() === '';
  const emptyArray = Array.isArray(c) && c.length === 0;
  const empty = c == null || emptyString || emptyArray;
  const rc = msg.reasoning_content;
  if (empty && typeof rc === 'string' && rc.trim() !== '') {
    msg.content = rc;
  }
  return data;
}

/** 从 OpenAI 形态 message 取出纯文本（供 SSE 写入 delta.content） */
function textFromAssistantMessage(msg) {
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && part.type === 'text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * OpenClaw / pi-ai 在 stream:true 时走 OpenAI SDK 流式解析，必须收到 text/event-stream。
 * 本网关上游统一非流式拉齐后，在此合成 SSE，避免客户端收 JSON 导致 delta 为空、飞书 replies=0。
 */
function sendOpenAICompletionAsSSE(res, llmResponse, selectedModel) {
  const raw = { ...llmResponse };
  delete raw._response_time_ms;
  delete raw.gateway;
  const payload = normalizeOpenAICompletionPayload(raw);
  const id = payload.id || `chatcmpl-gw-${Date.now()}`;
  const created = payload.created || Math.floor(Date.now() / 1000);
  const modelName = payload.model || selectedModel;
  const msg = payload.choices?.[0]?.message;
  let text = textFromAssistantMessage(msg);
  if (!text && typeof msg?.reasoning_content === 'string') {
    text = msg.reasoning_content;
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const line = (obj) => {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };

  line({
    id,
    object: 'chat.completion.chunk',
    created,
    model: modelName,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          ...(text ? { content: text } : {}),
        },
        finish_reason: null,
      },
    ],
  });

  const usage = payload.usage;
  line({
    id,
    object: 'chat.completion.chunk',
    created,
    model: modelName,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    ...(usage && typeof usage === 'object' ? { usage } : {}),
  });

  res.write('data: [DONE]\n\n');
  res.end();
}

async function callLLM(model, requestBody) {
  const config = MODEL_CONFIGS[model];
  const apiKey = process.env[config.api_key_env];
  
  // 调试输出
  console.log('Model:', model);
  console.log('API Key Env:', config.api_key_env);
  console.log('API Key Value:', apiKey ? apiKey.substring(0, 10) + '...' : 'UNDEFINED');
  
  if (!apiKey) {
    throw new Error(`API key not configured for model: ${model}`);
  }
  
  const startTime = Date.now();
  
  try {
    let response;
    
    if (config.provider === 'anthropic') {
      // Anthropic API 格式不同
      response = await axios.post(config.endpoint, {
        model: model,
        max_tokens: requestBody.max_tokens || 4096,
        messages: requestBody.messages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
      }, {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
      });
      
      // 转换为 OpenAI 格式
      return {
        id: `claude_${Date.now()}`,
        choices: [{
          message: {
            role: 'assistant',
            content: response.data.content[0].text,
          },
        }],
        usage: {
          prompt_tokens: response.data.usage?.input_tokens || 0,
          completion_tokens: response.data.usage?.output_tokens || 0,
          total_tokens: (response.data.usage?.input_tokens || 0) + 
                        (response.data.usage?.output_tokens || 0),
        },
        _response_time_ms: Date.now() - startTime,
      };
    } else if (config.provider === 'qwen') {
      const isCompatibleMode = config.endpoint.includes('/compatible-mode/');
      if (isCompatibleMode) {
        const upstreamModel = config.upstream_model || model;
        response = await axios.post(config.endpoint, {
          model: upstreamModel,
          messages: requestBody.messages,
          max_tokens: requestBody.max_tokens || 4096,
          temperature: requestBody.temperature ?? 0.7,
          stream: false,
        }, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        const payload = normalizeOpenAICompletionPayload({ ...response.data });
        return {
          ...payload,
          _response_time_ms: Date.now() - startTime,
        };
      }

      // 阿里云 DashScope generation 格式
      response = await axios.post(config.endpoint, {
        model: model,
        input: {
          messages: requestBody.messages,
        },
        parameters: {
          max_tokens: requestBody.max_tokens || 4096,
          temperature: requestBody.temperature || 0.7,
        },
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });

      // 转换为 OpenAI 格式
      return {
        id: `qwen_${Date.now()}`,
        choices: [{
          message: {
            role: 'assistant',
            content: response.data.output?.text || response.data.output?.choices?.[0]?.message?.content || '',
          },
        }],
        usage: response.data.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        _response_time_ms: Date.now() - startTime,
      };
    } else {
      // OpenAI 兼容格式
      response = await axios.post(config.endpoint, {
        model: model,
        messages: requestBody.messages,
        max_tokens: requestBody.max_tokens || 4096,
        temperature: requestBody.temperature ?? 0.7,
        stream: false,
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      });
      
      const payload = normalizeOpenAICompletionPayload({ ...response.data });
      return {
        ...payload,
        _response_time_ms: Date.now() - startTime,
      };
    }
  } catch (error) {
    logger.error('LLM call failed', {
      model,
      error: error.message,
      response: error.response?.data,
    });
    throw error;
  }
}

function normalizeClientAppToken(s) {
  if (s == null || s === '') return null;
  const t = String(s).trim().slice(0, 64).toLowerCase();
  if (!t) return null;
  const cleaned = t.replace(/[^a-z0-9._-]/g, '');
  return cleaned || null;
}

/**
 * 解析客户端标识：请求头 X-AI-Gateway-Client / X-Client-Name > metadata.client|source > User-Agent 启发式
 */
function resolveClientApp(req, requestBody) {
  const rawHeader =
    req.headers['x-ai-gateway-client'] ||
    req.headers['x-client-name'];
  const headerVal = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
  let v = normalizeClientAppToken(headerVal);
  if (v) return v;

  const meta = requestBody.metadata || {};
  const fromMeta = meta.client != null ? meta.client : meta.source;
  v = normalizeClientAppToken(
    fromMeta != null ? String(fromMeta) : ''
  );
  if (v) return v;

  const ua = String(req.headers['user-agent'] || '').toLowerCase();
  if (ua.includes('cursor')) return 'cursor';
  if (ua.includes('openclaw')) return 'openclaw';
  if (ua.includes('hermes')) return 'hermes';

  return null;
}

function truncateUserAgent(ua) {
  if (ua == null || typeof ua !== 'string') return null;
  return ua.length > 512 ? ua.slice(0, 512) : ua;
}

function summarizeMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const summary = messages
    .slice(-3)
    .map((msg) => {
      const role = msg?.role || 'unknown';
      const content = typeof msg?.content === 'string'
        ? msg.content
        : Array.isArray(msg?.content)
          ? msg.content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join(' ')
          : '';
      return `${role}:${String(content).replace(/\s+/g, ' ').slice(0, 120)}`;
    })
    .join(' | ');
  return summary || null;
}

function summarizeResponse(llmResponse) {
  const text = textFromAssistantMessage(llmResponse?.choices?.[0]?.message);
  if (!text) return null;
  return text.replace(/\s+/g, ' ').slice(0, 240);
}

function textFromMessageContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        return part.text || part.input_text || part.output_text || '';
      })
      .join('\n')
      .trim();
  }
  return '';
}

function buildMemoryQuery(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const lastUser = [...messages]
    .reverse()
    .find((item) => String(item?.role || '').toLowerCase() === 'user');
  const recent = messages.slice(-3).map((item) => {
    const role = String(item?.role || 'unknown').toLowerCase();
    return `${role}: ${textFromMessageContent(item?.content).replace(/\s+/g, ' ').slice(0, 240)}`;
  });
  return [textFromMessageContent(lastUser?.content), recent.join('\n')]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .trim();
}

function prependMemoryBlock(messages, recallText) {
  if (!recallText) return Array.isArray(messages) ? messages : [];
  return [
    {
      role: 'system',
      content: `Long-term memory context:\n${recallText}`,
    },
    ...(Array.isArray(messages) ? messages : []),
  ];
}

function resolveRuntimeContext(req, requestBody) {
  const meta = requestBody?.metadata || {};
  const fromHeader = (name) => {
    const value = req.headers[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const traceId =
    fromHeader('x-trace-id') ||
    meta.trace_id ||
    meta.traceId ||
    req.requestId;
  return {
    trace_id: traceId != null ? String(traceId).slice(0, 64) : req.requestId,
    pipeline_id:
      fromHeader('x-pipeline-id') ||
      meta.pipeline_id ||
      meta.pipelineId ||
      meta.pipeline ||
      null,
    pipeline_run_id:
      fromHeader('x-pipeline-run-id') ||
      meta.pipeline_run_id ||
      meta.pipelineRunId ||
      null,
    run_node_id:
      fromHeader('x-run-node-id') ||
      meta.run_node_id ||
      meta.node_id ||
      meta.nodeId ||
      null,
    agent_spec_id:
      fromHeader('x-agent-spec-id') ||
      meta.agent_spec_id ||
      meta.agentSpecId ||
      null,
    skill_package_id:
      fromHeader('x-skill-package-id') ||
      meta.skill_package_id ||
      meta.skillPackageId ||
      null,
    project_code:
      fromHeader('x-project-code') ||
      meta.project_code ||
      meta.projectCode ||
      null,
    fallback_mode:
      fromHeader('x-fallback-mode') ||
      meta.fallback_mode ||
      meta.fallbackMode ||
      null,
    human_intervention:
      meta.human_intervention === true ||
      meta.humanIntervention === true ||
      String(fromHeader('x-human-intervention') || '').toLowerCase() === 'true',
  };
}

async function resolveMemoryContext(req, requestBody, runtimeContext) {
  const meta = requestBody?.metadata || {};
  const memoryMeta =
    meta.memory && typeof meta.memory === 'object' ? meta.memory : {};
  const projectCode = runtimeContext.project_code || 'global';
  const subjectId =
    memoryMeta.subject_id ||
    req.gatewayUserId ||
    req.apiKeyId ||
    req.keyInfo?.id ||
    'anonymous';
  const scopeKey =
    memoryMeta.scope_key ||
    (runtimeContext.agent_spec_id || runtimeContext.skill_package_id
      ? `agt:${projectCode}:${runtimeContext.agent_spec_id || runtimeContext.skill_package_id || subjectId}`
      : `dlg:${projectCode}:${subjectId}`);
  const threadKey =
    memoryMeta.conversation_id ||
    runtimeContext.trace_id ||
    req.requestId;
  const roomKey =
    memoryMeta.room ||
    requestBody?.metadata?.purpose ||
    requestBody?.metadata?.pipeline ||
    'general';

  let resolvedPolicy = null;
  try {
    const response = await axios.get(
      `${CONTROL_PLANE_BASE_URL}/api/v1/memory/policies`,
      {
        params: {
          resolve: 'true',
          scope_key: scopeKey,
          project_code: runtimeContext.project_code || '',
          api_key_id: req.apiKeyId || req.keyInfo?.id || '',
          agent_spec_id: runtimeContext.agent_spec_id || '',
          skill_package_id: runtimeContext.skill_package_id || '',
        },
        timeout: 5000,
      }
    );
    resolvedPolicy = response.data?.data?.resolved_policy || null;
  } catch (error) {
    logger.warn('Memory policy resolution skipped', {
      error: error.message,
      request_id: req.requestId,
    });
  }

  const explicitEnabled = memoryMeta.enabled;
  const enabled =
    explicitEnabled === true ||
    (explicitEnabled == null && resolvedPolicy?.enabled === true);

  return {
    enabled,
    scope_key: scopeKey,
    thread_key: threadKey,
    room_key: roomKey,
    subject_id: subjectId,
    project_code: projectCode,
    source_system: 'gateway',
    client_app: resolveClientApp(req, requestBody),
    policy: resolvedPolicy || {},
  };
}

async function recallMemoryForRequest(req, requestBody, runtimeContext, memoryContext) {
  if (!memoryContext?.enabled) return null;
  const query = buildMemoryQuery(requestBody?.messages || []);
  if (!query) return null;
  try {
    const response = await axios.get(
      `${CONTROL_PLANE_BASE_URL}/api/v1/memory/search`,
      {
        params: {
          query,
          scope_key: memoryContext.scope_key,
          thread_key: memoryContext.thread_key,
          trace_id: runtimeContext.trace_id,
          project_code: runtimeContext.project_code || '',
          source_system: memoryContext.source_system,
          client_app: memoryContext.client_app || '',
          room_key: memoryContext.room_key || '',
          max_recall_tokens: memoryContext.policy?.max_recall_tokens || 800,
        },
        timeout: 10000,
      }
    );
    return response.data?.data || null;
  } catch (error) {
    logger.warn('Memory recall skipped', {
      error: error.message,
      request_id: req.requestId,
      scope_key: memoryContext.scope_key,
    });
    return null;
  }
}

async function captureMemoryTurn(req, requestBody, llmResponse, runtimeContext, memoryContext) {
  if (!memoryContext?.enabled) return null;
  const lastUserMessage = [...(requestBody.messages || [])]
    .reverse()
    .find((item) => String(item?.role || '').toLowerCase() === 'user');
  const userText = textFromMessageContent(lastUserMessage?.content);
  const assistantText = textFromAssistantMessage(llmResponse?.choices?.[0]?.message);
  const turns = [];
  if (userText) {
    turns.push({
      role: 'user',
      content_text: userText,
      summary_text: userText.replace(/\s+/g, ' ').slice(0, 240),
      metadata_json: {
        request_id: req.requestId,
      },
    });
  }
  if (assistantText) {
    turns.push({
      role: 'assistant',
      content_text: assistantText,
      summary_text: assistantText.replace(/\s+/g, ' ').slice(0, 240),
      metadata_json: {
        request_id: req.requestId,
      },
    });
  }
  if (!turns.length) return null;
  try {
    const response = await axios.post(
      `${CONTROL_PLANE_BASE_URL}/api/v1/memory/ingest-turn`,
      {
        source_system: 'gateway',
        client_app: memoryContext.client_app,
        scope_key: memoryContext.scope_key,
        thread_key: memoryContext.thread_key,
        project_code: runtimeContext.project_code || null,
        trace_id: runtimeContext.trace_id,
        room_key: memoryContext.room_key,
        title:
          requestBody?.metadata?.purpose ||
          requestBody?.metadata?.pipeline ||
          null,
        metadata_json: {
          purpose: requestBody?.metadata?.purpose || null,
          pipeline: requestBody?.metadata?.pipeline || null,
          request_id: req.requestId,
        },
        turns,
      },
      {
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data?.data || null;
  } catch (error) {
    logger.warn('Memory capture skipped', {
      error: error.message,
      request_id: req.requestId,
      scope_key: memoryContext.scope_key,
    });
    return null;
  }
}

function persistCompletionUsage(req, requestBody, selectedModel, modelConfig, llmResponse) {
  const runtimeContext = resolveRuntimeContext(req, requestBody);
  const gatewayInfo = {
    model_used: selectedModel,
    provider: modelConfig.provider,
    route_reason: requestBody.model === 'auto' ? 'auto_selected' : 'user_specified',
    response_time_ms: llmResponse._response_time_ms,
    trace_id: runtimeContext.trace_id,
    pipeline_run_id: runtimeContext.pipeline_run_id,
    project_code: runtimeContext.project_code,
  };
  const usage = llmResponse.usage || {};
  const clientApp = resolveClientApp(req, requestBody);
  const userAgent = truncateUserAgent(req.headers['user-agent']);
  console.log('📝 Logging usage to DB:', {
    api_key_id: req.apiKeyId ?? req.keyInfo?.id,
    model: selectedModel,
    total_tokens: usage.total_tokens,
    client_app: clientApp,
  });
  db.logUsage({
    api_key_id: req.apiKeyId ?? req.keyInfo?.id ?? 0,
    request_id: req.requestId,
    model: selectedModel,
    provider: modelConfig.provider,
    prompt_tokens: usage.prompt_tokens || 0,
    completion_tokens: usage.completion_tokens || 0,
    total_tokens: usage.total_tokens || 0,
    cost_cny: usage.cost_cny || 0,
    purpose: requestBody.metadata?.purpose || null,
    pipeline: requestBody.metadata?.pipeline || null,
    user_id: req.gatewayUserId != null ? req.gatewayUserId : null,
    team_id: req.teamId != null ? req.teamId : null,
    status: 'success',
    response_time_ms: gatewayInfo.response_time_ms,
    client_app: clientApp,
    user_agent: userAgent,
    trace_id: runtimeContext.trace_id,
    pipeline_run_id: runtimeContext.pipeline_run_id,
    run_node_id: runtimeContext.run_node_id,
    agent_spec_id: runtimeContext.agent_spec_id,
    skill_package_id: runtimeContext.skill_package_id,
    project_code: runtimeContext.project_code,
    request_summary: summarizeMessages(requestBody.messages),
    response_summary: summarizeResponse(llmResponse),
    fallback_mode: runtimeContext.fallback_mode,
    human_intervention: runtimeContext.human_intervention,
  })
    .then(() => console.log('✅ Usage logged successfully'))
    .catch((err) => {
      console.error('❌ Failed to log usage:', err.message);
      logger.error('Failed to log usage', { error: err.message });
    });
  db.updateApiKeyUsage(req.apiKey, usage.total_tokens || 0).catch((err) =>
    logger.error('Failed to update API key usage', { error: err.message })
  );
  return gatewayInfo;
}

async function modelRouter(req, res, next) {
  try {
    const requestBody = req.body;
    const keyInfo = req.keyInfo;
    
    // 选择模型
    const selectedModel = selectModel(requestBody, keyInfo);
    const modelConfig = MODEL_CONFIGS[selectedModel];
    
    // 调试输出
    console.log('Selected Model:', selectedModel);
    console.log('Model Config:', modelConfig ? modelConfig.provider : 'UNDEFINED');
    console.log('Env Var:', modelConfig ? modelConfig.api_key_env : 'UNDEFINED');
    console.log('API Key:', modelConfig && process.env[modelConfig.api_key_env] ? 'CONFIGURED' : 'MISSING');
    
    logger.info('Routing request to model', {
      model: selectedModel,
      provider: modelConfig.provider,
      purpose: requestBody.metadata?.purpose,
    });

    const runtimeContext = resolveRuntimeContext(req, requestBody);
    const memoryContext = await resolveMemoryContext(req, requestBody, runtimeContext);
    const memoryRecall = await recallMemoryForRequest(
      req,
      requestBody,
      runtimeContext,
      memoryContext
    );

    const wantsStream =
      requestBody.stream === true ||
      requestBody.stream === 'true' ||
      requestBody.stream === 1;
    const internalBody = {
      ...requestBody,
      stream: false,
      messages: prependMemoryBlock(
        requestBody.messages,
        memoryRecall?.recall_text || ''
      ),
    };
    
    // 调用 LLM（上游始终非流式，流式在网关侧合成）
    const llmResponse = await callLLM(selectedModel, internalBody);
    const gatewayInfo = persistCompletionUsage(
      req,
      requestBody,
      selectedModel,
      modelConfig,
      llmResponse
    );
    const memoryWrite = await captureMemoryTurn(
      req,
      requestBody,
      llmResponse,
      runtimeContext,
      memoryContext
    );
    gatewayInfo.memory = {
      enabled: Boolean(memoryContext?.enabled),
      scope_key: memoryContext?.scope_key || null,
      recalled: Boolean(memoryRecall?.recall_text),
      recall_id: memoryRecall?.recall?.id || null,
      turn_count: Array.isArray(memoryWrite?.turns) ? memoryWrite.turns.length : 0,
      fact_count: Array.isArray(memoryWrite?.facts) ? memoryWrite.facts.length : 0,
    };

    if (wantsStream) {
      sendOpenAICompletionAsSSE(res, llmResponse, selectedModel);
      return;
    }

    res.json({
      ...llmResponse,
      gateway: gatewayInfo,
    });
    
  } catch (error) {
    logger.error('Model routing failed', {
      error: error.message,
      request_id: req.requestId,
    });
    
    res.status(error.response?.status || 500).json({
      error: {
        message: error.message || 'Model routing failed',
        type: error.type || 'RoutingError',
      },
    });
  }
}

module.exports = modelRouter;
module.exports.MODEL_CONFIGS = MODEL_CONFIGS;
