const express = require('express');
const axios = require('axios');
const winston = require('winston');
const db = require('../db/mysql');

const router = express.Router();
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.File({ filename: 'logs/combined.log' })],
});

const PROVIDERS = {
  qwen_dashscope_native: {
    key: 'qwen_dashscope_native',
    label: 'Qwen Deep Research',
    wire_mode: 'dashscope_native',
  },
  weelinking_openai_compatible: {
    key: 'weelinking_openai_compatible',
    label: 'Weelinking / ChatGPT Deep Research',
    wire_mode: 'openai_responses_compatible',
  },
  openai_codex_compatible: {
    key: 'openai_codex_compatible',
    label: 'OpenAI / Codex High-Fidelity Diagrams',
    wire_mode: 'openai_responses_compatible',
  },
};

const DASHSCOPE_ENDPOINT =
  process.env.DASHSCOPE_DEEP_RESEARCH_URL ||
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
const DASHSCOPE_COMPATIBLE_ENDPOINT =
  process.env.DASHSCOPE_COMPATIBLE_URL ||
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const SUMMARY_TIMEOUT_MS = Number(process.env.DEEPWIKI_SUMMARY_TIMEOUT_MS || 30000);
const DEEP_RESEARCH_TIMEOUT_MS = Number(process.env.DEEPWIKI_DEEP_RESEARCH_TIMEOUT_MS || 180000);
const DIAGRAM_SUMMARY_TIMEOUT_MS = Number(process.env.DEEPWIKI_DIAGRAM_SUMMARY_TIMEOUT_MS || 120000);

function normalizeText(value) {
  return String(value || '').replace(/\r/g, '').trim();
}

function getObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function getBoolean(value, fallback = false) {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function extractMessageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item && typeof item.text === 'string') return item.text;
      if (item && item.type === 'output_text' && typeof item.text === 'string') return item.text;
      return '';
    })
    .join('');
}

function extractDeepResearchPayloadText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (typeof payload.output?.text === 'string') return payload.output.text;
  if (typeof payload.content === 'string') return payload.content;
  const choiceMessage = payload.output?.choices?.[0]?.message || payload.choices?.[0]?.message;
  if (choiceMessage) {
    return extractMessageText(choiceMessage.content);
  }
  if (Array.isArray(payload.output)) {
    return payload.output
      .map((item) => {
        if (typeof item?.content === 'string') return item.content;
        if (Array.isArray(item?.content)) return extractMessageText(item.content);
        return '';
      })
      .join('\n');
  }
  if (payload.output?.message) {
    return extractMessageText(payload.output.message.content);
  }
  return '';
}

async function collectDashScopeSSE(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let latestText = '';
    let finalPayload = null;

    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      buffer += chunk;
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';

      for (const event of events) {
        const dataLines = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\s*/, '').trim())
          .filter(Boolean);
        for (const line of dataLines) {
          if (line === '[DONE]') continue;
          try {
            const payload = JSON.parse(line);
            finalPayload = payload;
            const nextText = extractDeepResearchPayloadText(payload);
            if (nextText && nextText.length >= latestText.length) {
              latestText = nextText;
            }
          } catch {
            // ignore partial frames
          }
        }
      }
    });
    stream.on('end', () => resolve({ content: normalizeText(latestText), payload: finalPayload }));
    stream.on('error', reject);
  });
}

function buildFallbackModels(settings, providerKey) {
  const defaults = [];
  const configuredDefaultModel = normalizeText(settings.deepwiki_default_model);
  const providerDefaultModel = normalizeText(
    providerKey === PROVIDERS.weelinking_openai_compatible.key
      ? settings.deepwiki_weelinking_default_model
      : settings.deepwiki_qwen_default_model
  );
  if (providerDefaultModel) defaults.push(providerDefaultModel);
  if (configuredDefaultModel) defaults.push(configuredDefaultModel);

  if (providerKey === PROVIDERS.qwen_dashscope_native.key) {
    defaults.push('qwen-deep-research', 'qwen3.6-plus');
  } else if (providerKey === PROVIDERS.openai_codex_compatible.key) {
    defaults.push('gpt-5.4', 'gpt-5.4-mini', 'o4-mini');
  } else {
    defaults.push('deep-research', 'gpt-4.1', 'o4-mini');
  }

  return Array.from(new Set(defaults.filter(Boolean))).map((model) => ({
    value: model,
    label: model,
  }));
}

async function loadDeepWikiSettings() {
  const settings = getObject(await db.getSettings().catch(() => ({})), {});
  return {
    deepwiki_default_provider:
      normalizeText(settings.deepwiki_default_provider) || PROVIDERS.qwen_dashscope_native.key,
    deepwiki_default_model: normalizeText(settings.deepwiki_default_model) || '',
    deepwiki_qwen_enabled: getBoolean(settings.deepwiki_qwen_enabled, true),
    deepwiki_weelinking_enabled: getBoolean(
      settings.deepwiki_weelinking_enabled,
      Boolean(process.env.DEEPWIKI_WEELINKING_API_KEY || process.env.WEELINKING_API_KEY)
    ),
    deepwiki_codex_enabled: getBoolean(
      settings.deepwiki_codex_enabled,
      Boolean(process.env.DEEPWIKI_CODEX_API_KEY || process.env.OPENAI_API_KEY)
    ),
    deepwiki_qwen_default_model: normalizeText(settings.deepwiki_qwen_default_model) || 'qwen-deep-research',
    deepwiki_weelinking_default_model:
      normalizeText(settings.deepwiki_weelinking_default_model) || 'deep-research',
    deepwiki_codex_default_model:
      normalizeText(settings.deepwiki_codex_default_model) || 'gpt-5.4',
    deepwiki_weelinking_base_url:
      normalizeText(settings.deepwiki_weelinking_base_url) ||
      normalizeText(process.env.DEEPWIKI_WEELINKING_BASE_URL) ||
      normalizeText(process.env.WEELINKING_BASE_URL) ||
      'https://api.weelinking.com',
    deepwiki_weelinking_api_key:
      normalizeText(settings.deepwiki_weelinking_api_key) ||
      normalizeText(process.env.DEEPWIKI_WEELINKING_API_KEY) ||
      normalizeText(process.env.WEELINKING_API_KEY),
    deepwiki_codex_base_url:
      normalizeText(settings.deepwiki_codex_base_url) ||
      normalizeText(process.env.DEEPWIKI_CODEX_BASE_URL) ||
      normalizeText(process.env.OPENAI_BASE_URL) ||
      'https://api.openai.com',
    deepwiki_codex_api_key:
      normalizeText(settings.deepwiki_codex_api_key) ||
      normalizeText(process.env.DEEPWIKI_CODEX_API_KEY) ||
      normalizeText(process.env.OPENAI_API_KEY),
    deepwiki_diagram_provider_strategy:
      normalizeText(settings.deepwiki_diagram_provider_strategy) || 'default',
    deepwiki_weelinking_wire_mode:
      normalizeText(settings.deepwiki_weelinking_wire_mode) ||
      normalizeText(process.env.DEEPWIKI_WEELINKING_WIRE_MODE) ||
      'openai_responses_compatible',
  };
}

function getProviderDescriptor(settings, providerKey) {
  const provider = PROVIDERS[providerKey] || PROVIDERS[settings.deepwiki_default_provider] || PROVIDERS.qwen_dashscope_native;
  const enabled =
    provider.key === PROVIDERS.qwen_dashscope_native.key
      ? settings.deepwiki_qwen_enabled
      : provider.key === PROVIDERS.openai_codex_compatible.key
        ? settings.deepwiki_codex_enabled
        : settings.deepwiki_weelinking_enabled;
  return {
    ...provider,
    enabled,
    default_model:
      provider.key === PROVIDERS.qwen_dashscope_native.key
        ? settings.deepwiki_qwen_default_model
        : provider.key === PROVIDERS.openai_codex_compatible.key
          ? settings.deepwiki_codex_default_model
          : settings.deepwiki_weelinking_default_model,
  };
}

function resolveDeepWikiRequestOptions(settings, body = {}) {
  const mode = normalizeText(body.mode || 'deep_research');
  const providerStrategy = normalizeText(body.provider_strategy) || settings.deepwiki_diagram_provider_strategy || 'default';
  const requestedProvider = normalizeText(body.provider || body.research_provider);
  const projectForceCodex = getBoolean(
    body.project_force_codex || body.repo_context?.project_force_codex,
    false
  );
  const shouldPreferCodex =
    mode === 'diagram_synthesis' &&
    settings.deepwiki_codex_enabled &&
    (
      providerStrategy === 'codex_only' ||
      providerStrategy === 'default' ||
      (providerStrategy === 'project_override' && projectForceCodex)
    );
  const effectiveRequestedProvider =
    requestedProvider ||
    (shouldPreferCodex
      ? PROVIDERS.openai_codex_compatible.key
      : '');
  const provider = getProviderDescriptor(settings, effectiveRequestedProvider || settings.deepwiki_default_provider);
  if (!provider.enabled) {
    const error = new Error(`Deep Wiki provider is disabled: ${provider.key}`);
    error.status = 400;
    throw error;
  }

  const requestedModel = normalizeText(body.model || body.research_model);
  const model = requestedModel || provider.default_model || settings.deepwiki_default_model;
  const wireMode =
    normalizeText(body.wire_mode) ||
    (provider.key === PROVIDERS.weelinking_openai_compatible.key
      ? settings.deepwiki_weelinking_wire_mode
      : provider.wire_mode);

  return {
    provider: provider.key,
    providerLabel: provider.label,
    model,
    wireMode,
    providerStrategy,
  };
}

function buildOpenAiCompatibleMessages(messages) {
  return Array.isArray(messages)
    ? messages.map((item) => ({
        role: normalizeText(item.role) || 'user',
        content: typeof item.content === 'string' ? item.content : extractMessageText(item.content),
      }))
    : [];
}

function summarizeProviderError(error) {
  const status = Number(error?.response?.status || error?.status || 0) || null;
  const responseData = error?.response?.data;
  let detail = '';
  if (typeof responseData === 'string') {
    detail = responseData;
  } else if (typeof responseData?.error?.message === 'string') {
    detail = responseData.error.message;
  } else if (typeof responseData?.message === 'string') {
    detail = responseData.message;
  }
  return {
    status,
    code: normalizeText(error?.code) || null,
    message: normalizeText(error?.message) || 'Unknown upstream error',
    detail: normalizeText(detail) || null,
    url: normalizeText(error?.config?.url) || null,
    method: normalizeText(error?.config?.method).toUpperCase() || null,
  };
}

function shouldFallbackToChatCompatible(error) {
  const status = Number(error?.response?.status || error?.status || 0);
  if (!status) {
    return false;
  }
  return [400, 404, 405, 415, 422].includes(status);
}

function logProviderAttemptFailure(providerKey, wireMode, error, extra = {}) {
  logger.warn('DeepWiki provider attempt failed', {
    provider: providerKey,
    wire_mode: wireMode,
    ...summarizeProviderError(error),
    ...extra,
  });
}

function annotateUpstreamConnectivityError(error, options) {
  if (!error || !options) return error;
  const summary = summarizeProviderError(error);
  const url = summary.url || '';
  const code = summary.code || '';
  const isConnectivityError = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code);
  if (!isConnectivityError) {
    return error;
  }

  if (options.provider === PROVIDERS.openai_codex_compatible.key && url.includes('api.openai.com')) {
    error.status = 502;
    error.deepwikiPreventDiagramFallback = true;
    error.message = 'Codex upstream connection failed while reaching api.openai.com. This environment appears to block direct OpenAI egress; configure DeepWiki Codex Base URL to an accessible OpenAI-compatible relay or proxy.';
  }

  return error;
}

async function callDashScopeDeepResearch(messages, model = 'qwen-deep-research') {
  const apiKey = normalizeText(process.env.DASHSCOPE_API_KEY);
  if (!apiKey) {
    const error = new Error('DASHSCOPE_API_KEY is not configured');
    error.status = 500;
    throw error;
  }
  const response = await axios.post(
    DASHSCOPE_ENDPOINT,
    {
      model: model || 'qwen-deep-research',
      input: { messages },
      parameters: {
        result_format: 'message',
        incremental_output: true,
      },
    },
    {
      responseType: 'stream',
      timeout: DEEP_RESEARCH_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'X-DashScope-SSE': 'enable',
      },
    }
  );
  return collectDashScopeSSE(response.data);
}

async function callDashScopeSummary(messages, outputFormat, model = 'qwen3.6-plus', timeoutMs = SUMMARY_TIMEOUT_MS) {
  const apiKey = normalizeText(process.env.DASHSCOPE_API_KEY);
  if (!apiKey) {
    const error = new Error('DASHSCOPE_API_KEY is not configured');
    error.status = 500;
    throw error;
  }
  const response = await axios.post(
    DASHSCOPE_COMPATIBLE_ENDPOINT,
    {
      model: model || 'qwen3.6-plus',
      messages,
      temperature: 0.2,
      stream: false,
      response_format: outputFormat === 'json' ? { type: 'json_object' } : undefined,
    },
    {
      timeout: Math.max(SUMMARY_TIMEOUT_MS, Number(timeoutMs) || 0),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    }
  );
  const message = response.data?.choices?.[0]?.message;
  return {
    content: normalizeText(message?.content || message?.reasoning_content || ''),
    raw: response.data,
  };
}

function getWeelinkingBaseUrl(settings) {
  const baseUrl = normalizeText(settings.deepwiki_weelinking_base_url);
  if (!baseUrl) {
    const error = new Error('Deep Wiki Weelinking base URL is not configured');
    error.status = 500;
    throw error;
  }
  return baseUrl.replace(/\/+$/, '');
}

function getWeelinkingApiKey(settings) {
  const apiKey = normalizeText(settings.deepwiki_weelinking_api_key);
  if (!apiKey) {
    const error = new Error('Deep Wiki Weelinking API key is not configured');
    error.status = 500;
    throw error;
  }
  return apiKey;
}

async function callWeelinkingChatCompatible(settings, messages, outputFormat, model, timeoutMs = DEEP_RESEARCH_TIMEOUT_MS) {
  const response = await axios.post(
    `${getWeelinkingBaseUrl(settings)}/v1/chat/completions`,
    {
      model,
      messages: buildOpenAiCompatibleMessages(messages),
      temperature: 0.2,
      stream: false,
      response_format: outputFormat === 'json' ? { type: 'json_object' } : undefined,
    },
    {
      timeout: Math.max(SUMMARY_TIMEOUT_MS, Number(timeoutMs) || 0),
      headers: {
        Authorization: `Bearer ${getWeelinkingApiKey(settings)}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return {
    content: normalizeText(extractDeepResearchPayloadText(response.data)),
    raw: response.data,
  };
}

async function callWeelinkingResponsesCompatible(settings, messages, model) {
  const response = await axios.post(
    `${getWeelinkingBaseUrl(settings)}/v1/responses`,
    {
      model,
      input: buildOpenAiCompatibleMessages(messages).map((item) => ({
        role: item.role,
        content: [{ type: 'input_text', text: item.content }],
      })),
    },
    {
      timeout: DEEP_RESEARCH_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${getWeelinkingApiKey(settings)}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return {
    content: normalizeText(extractDeepResearchPayloadText(response.data)),
    raw: response.data,
  };
}

function getCodexBaseUrl(settings) {
  const baseUrl = normalizeText(settings.deepwiki_codex_base_url);
  if (!baseUrl) {
    const error = new Error('Deep Wiki Codex base URL is not configured');
    error.status = 500;
    throw error;
  }
  return baseUrl.replace(/\/+$/, '');
}

function getCodexApiKey(settings) {
  const apiKey = normalizeText(settings.deepwiki_codex_api_key);
  if (!apiKey) {
    const error = new Error('Deep Wiki Codex API key is not configured');
    error.status = 500;
    throw error;
  }
  return apiKey;
}

async function callCodexChatCompatible(settings, messages, outputFormat, model, timeoutMs = DEEP_RESEARCH_TIMEOUT_MS) {
  const response = await axios.post(
    `${getCodexBaseUrl(settings)}/v1/chat/completions`,
    {
      model,
      messages: buildOpenAiCompatibleMessages(messages),
      temperature: 0.1,
      stream: false,
      response_format: outputFormat === 'json' ? { type: 'json_object' } : undefined,
    },
    {
      timeout: Math.max(SUMMARY_TIMEOUT_MS, Number(timeoutMs) || 0),
      headers: {
        Authorization: `Bearer ${getCodexApiKey(settings)}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return {
    content: normalizeText(extractDeepResearchPayloadText(response.data)),
    raw: response.data,
  };
}

async function callCodexResponsesCompatible(settings, messages, model) {
  const response = await axios.post(
    `${getCodexBaseUrl(settings)}/v1/responses`,
    {
      model,
      input: buildOpenAiCompatibleMessages(messages).map((item) => ({
        role: item.role,
        content: [{ type: 'input_text', text: item.content }],
      })),
    },
    {
      timeout: DEEP_RESEARCH_TIMEOUT_MS,
      headers: {
        Authorization: `Bearer ${getCodexApiKey(settings)}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return {
    content: normalizeText(extractDeepResearchPayloadText(response.data)),
    raw: response.data,
  };
}

async function callResearchProvider(settings, options, mode, payload = {}) {
  const messages = buildOpenAiCompatibleMessages(payload.messages);
  const summarizeTimeoutMs = Number(payload.timeoutMs) || SUMMARY_TIMEOUT_MS;
  if (options.provider === PROVIDERS.qwen_dashscope_native.key) {
    if (mode === 'summarize') {
      return callDashScopeSummary(messages, payload.outputFormat, options.model || 'qwen3.6-plus', summarizeTimeoutMs);
    }
    return callDashScopeDeepResearch(messages, options.model || 'qwen-deep-research');
  }

  if (options.provider === PROVIDERS.openai_codex_compatible.key) {
    if (options.wireMode === 'openai_chat_compatible') {
      return callCodexChatCompatible(
        settings,
        messages,
        payload.outputFormat,
        options.model || settings.deepwiki_codex_default_model,
        summarizeTimeoutMs
      );
    }
    try {
      return await callCodexResponsesCompatible(
        settings,
        messages,
        options.model || settings.deepwiki_codex_default_model
      );
    } catch (error) {
      logProviderAttemptFailure(
        options.provider,
        'openai_responses_compatible',
        error,
        {
          mode,
          fallback_target: 'openai_chat_compatible',
          fallback_allowed: shouldFallbackToChatCompatible(error),
        }
      );
      if (!shouldFallbackToChatCompatible(error)) {
        throw annotateUpstreamConnectivityError(error, options);
      }
      return callCodexChatCompatible(
        settings,
        messages,
        payload.outputFormat,
        options.model || settings.deepwiki_codex_default_model,
        summarizeTimeoutMs
      );
    }
  }

  if (options.wireMode === 'openai_chat_compatible') {
    return callWeelinkingChatCompatible(
      settings,
      messages,
      payload.outputFormat,
      options.model || settings.deepwiki_weelinking_default_model,
      summarizeTimeoutMs
    );
  }

  try {
    return await callWeelinkingResponsesCompatible(
      settings,
      messages,
      options.model || settings.deepwiki_weelinking_default_model
    );
  } catch (error) {
    logProviderAttemptFailure(
      options.provider,
      'openai_responses_compatible',
      error,
      {
        mode,
        fallback_target: 'openai_chat_compatible',
        fallback_allowed: shouldFallbackToChatCompatible(error),
      }
    );
    if (!shouldFallbackToChatCompatible(error)) {
      throw annotateUpstreamConnectivityError(error, options);
    }
    return callWeelinkingChatCompatible(
      settings,
      messages,
      payload.outputFormat,
      options.model || settings.deepwiki_weelinking_default_model,
      summarizeTimeoutMs
    );
  }
}

async function callDiagramFallbackProvider(settings, payload = {}) {
  const candidates = [];
  if (settings.deepwiki_qwen_enabled) {
    candidates.push({
      provider: PROVIDERS.qwen_dashscope_native.key,
      model: 'qwen3.6-plus',
      wireMode: PROVIDERS.qwen_dashscope_native.wire_mode,
    });
  }
  if (settings.deepwiki_weelinking_enabled) {
    candidates.push({
      provider: PROVIDERS.weelinking_openai_compatible.key,
      model: settings.deepwiki_weelinking_default_model,
      wireMode: settings.deepwiki_weelinking_wire_mode,
    });
  }

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const data = await callResearchProvider(settings, candidate, 'summarize', payload);
      return {
        ...data,
        provider: candidate.provider,
        model: candidate.model,
        wireMode: candidate.wireMode,
      };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('No fallback diagram provider available');
}

function formatRepoUnitsBlock(repoContext) {
  const units = Array.isArray(repoContext.repo_units) ? repoContext.repo_units : [];
  if (units.length <= 1) {
    return [];
  }
  return [
    '这是一个多仓库项目（同一产品/多仓协同）。请把各仓放在同一架构叙事里，说明边界、依赖与主链路，不要只按主仓复述。',
    ...units.map((u) => {
      const role = normalizeText(u.repo_role) || 'repo';
      const slug = normalizeText(u.repo_slug) || '';
      const branch = normalizeText(u.branch) || '';
      const sha = String(u.commit_sha || '').slice(0, 12);
      const url = normalizeText(u.repo_url) || '';
      return `- ${role}: ${slug} · ${branch}@${sha}${url ? ` · ${url}` : ''}`;
    }),
    '',
  ];
}

function buildDeepResearchOpeningPrompt(repoContext, focusPrompt, outputProfile, diagramProfile) {
  const multi = Boolean(repoContext.multi_repo) || (Array.isArray(repoContext.repo_units) && repoContext.repo_units.length > 1);
  return [
    multi
      ? '你是资深代码库分析研究员，请为**多仓库项目**生成工程化 Deep Wiki 研究报告。'
      : '你是资深代码库分析研究员，请为代码仓库生成工程化 Deep Wiki 研究报告。',
    '你的任务不是逐文件复述，而是形成工程架构包视角的综合认知。',
    '请先基于下面仓库信息给出研究计划、关键关注点、你还需要我补充的上下文。',
    '',
    ...formatRepoUnitsBlock(repoContext),
    `主索引仓库（流水线主仓）：${repoContext.repo_url}`,
    `分支：${repoContext.branch}`,
    `提交：${repoContext.commit_sha}`,
    `输出档位：${outputProfile || '工程架构包'}`,
    `图谱档位：${diagramProfile || '全量图谱'}`,
    focusPrompt ? `本次关注点：${focusPrompt}` : '本次关注点：全仓库整体理解',
    '',
    '仓库盘点摘要：',
    repoContext.inventory_summary || '无',
    '',
    '模块摘要：',
    (repoContext.modules || [])
      .map((item) => `- ${item.name}: ${normalizeText(item.content).slice(0, 500)}`)
      .join('\n') || '无',
  ].join('\n');
}

function buildDeepResearchFollowupPrompt(stageOneContent, repoContext, focusPrompt, outputProfile, diagramProfile) {
  const multi = Boolean(repoContext.multi_repo) || (Array.isArray(repoContext.repo_units) && repoContext.repo_units.length > 1);
  return [
    '继续，请根据你刚才的研究计划，输出 Deep Wiki 研究报告。',
    '',
    '**核心原则（抽取型，非总结型）**：',
    '- 不要写"本系统提供 XXX 功能"式的泛化总结；改为从代码 / 注释 / 测试 / 接口 / 表结构中**抽取可验证的事实陈述**。',
    '- 每一条事实必须是"**当 X 时 Y / 由于 X 所以 Y / 约束：X 不超过 Y**"式的可证伪陈述，而不是"本模块负责处理 X"这类抽象描述。',
    '- 每条事实后面给出可追溯线索：`模块名 / 路径前缀 / 方法名 / API 路径 / 表名 / 字段名 / 异常类名`，用 `代码块` 样式标注。',
    '- 如果某节**缺乏业务信号**（例如无注释、无测试、无异常分支），明确写出 `[无业务信号，仅存技术构件]`，不要强行补白。',
    '- 技术构件清单（Controller / Service / Repository / Entity 列表）**不再是正文主角**；它们由 control-plane 自动渲染为辅助页，此处只在必要时点名关键类。',
    multi ? '- 多仓库时必须写清跨仓调用链（frontend→BFF→backend→DB/event）中**已出现证据**的部分；缺仓则标注 `missing_repo_roles` 类待确认。' : '',
    '',
    '**输出结构（中文 Markdown）**：',
    '1. 项目定位与核心业务目标 — 基于 README / 主入口 / 核心实体抽取，避免泛化',
    '2. 关键业务规则与约束（"当 X 时 Y"式陈述，来源于：注释强触发词 / 校验注解 / 异常消息 / 测试名 / SQL 约束）',
    '3. 核心业务场景（Happy / Branch / Exception 路径，来源于：测试 Given-When-Then / if-else 分支 / throw 语句）',
    '4. 关键计算与边界（金额 / 时长 / 阈值公式，来源于：BigDecimal / LocalDate.plus / @Min / @Max / 注释中的数字）',
    '5. 状态机与状态迁移（实体状态字段 + 触发事件 + 守卫条件 + 副作用）',
    '6. 失败模式与补偿（异常触发条件 → 对应的 @ExceptionHandler / @Retryable / @CircuitBreaker / @Fallback / try-catch）',
    '7. 数据不变量（@NotNull / @Size / @Min / @Max / UNIQUE / NOT NULL / Preconditions.checkArgument 等）',
    '8. 接口地图（按业务动作分组而非按 Controller 分组，点出每个 API 的业务语义）',
    '9. 数据模型关系要点（实体 ↔ 表 ↔ 事件的业务关系，避免重复 DDL）',
    '10. 待确认与反直觉点（代码里行为与通常预期不一致的地方）',
    '',
    '**硬约束**：',
    '- 只基于现有上下文推断，**禁止虚构**不存在的能力、不存在的接口、不存在的字段。',
    '- 不要复述源码；每个小节至少包含 3 条可验证的业务事实陈述，否则标注 `[无业务信号]`。',
    '- 不要输出"本系统做了 X 功能"式空话；改为"在路径 `/api/xxx` 的 POST 操作中，若参数 `y` 为 null 则抛出 BizException（见 `XxxController.create`）"。',
    '- **禁止**在正文里粘贴代码块，除非是 ≤ 3 行的关键 SQL / 注解 / 异常消息。',
    '- 在正文中显式指出适合生成哪些 Mermaid 图谱（选用：模块依赖 / 序列图 / 状态机 / ER）。',
    '- **Knowledge OS**：本报告将作为 control-plane 的 Stage Asset，后续投影为 PRD / 技术方案 / 测试方案草案；请勿与 inventory 中的模块数、API 数、表数量级明显矛盾。',
    '',
    `输出档位：${outputProfile || '工程架构包'}`,
    `图谱档位：${diagramProfile || '全量图谱'}`,
    `额外 focus_prompt：${focusPrompt || '无'}`,
    '',
    '你刚才的研究计划 / 追问：',
    stageOneContent || '无',
    '',
    ...formatRepoUnitsBlock(repoContext),
    '仓库上下文复述：',
    repoContext.inventory_summary || '无',
    '',
    '模块摘要：',
    (repoContext.modules || [])
      .map((item) => `## ${item.name}\n${item.content}`)
      .join('\n\n') || '无',
  ].join('\n');
}

router.get('/deepwiki/providers', async (_req, res, next) => {
  try {
    const settings = await loadDeepWikiSettings();
    const providers = Object.keys(PROVIDERS).map((key) => getProviderDescriptor(settings, key));
    res.json({
      success: true,
      data: {
        default_provider: settings.deepwiki_default_provider,
        providers,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/deepwiki/models', async (req, res, next) => {
  try {
    const settings = await loadDeepWikiSettings();
    const providerKey = normalizeText(req.query.provider) || settings.deepwiki_default_provider;
    const provider = getProviderDescriptor(settings, providerKey);
    const models = buildFallbackModels(settings, provider.key);
    res.json({
      success: true,
      data: {
        provider: provider.key,
        default_model: provider.default_model || settings.deepwiki_default_model || '',
        models,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.post('/deepwiki', async (req, res, next) => {
  try {
    const body = getObject(req.body, {});
    const {
      mode = 'deep_research',
      messages = [],
      output_format,
      repo_context,
      focus_prompt,
      trace_id,
      output_profile,
      diagram_profile,
    } = body;
    const settings = await loadDeepWikiSettings();
    const options = resolveDeepWikiRequestOptions(settings, body);
    logger.info('DeepWiki provider resolved', {
      request_id: req.requestId || null,
      mode,
      provider_strategy: normalizeText(body.provider_strategy),
      requested_provider: normalizeText(body.provider || body.research_provider),
      resolved_provider: options.provider,
      resolved_model: options.model,
      resolved_wire_mode: options.wireMode,
      project_force_codex: getBoolean(
        body.project_force_codex || body.repo_context?.project_force_codex,
        false
      ),
    });

    if (mode === 'summarize') {
      if (!Array.isArray(messages) || !messages.length) {
        return res.status(400).json({ success: false, error: 'messages is required for summarize mode' });
      }
      const data = await callResearchProvider(settings, options, 'summarize', {
        messages,
        outputFormat: output_format,
      });
      return res.json({
        success: true,
        data: {
          ...data,
          trace_id: trace_id || null,
          mode,
          provider: options.provider,
          model: options.model,
          wire_mode: options.wireMode,
        },
      });
    }

    if (mode === 'diagram_synthesis') {
      if (!Array.isArray(messages) || !messages.length) {
        return res.status(400).json({ success: false, error: 'messages is required for diagram_synthesis mode' });
      }
      const fmt = output_format && output_format !== 'markdown' ? output_format : 'json';
      let data;
      let resolvedProvider = options.provider;
      let resolvedModel = options.model;
      let resolvedWireMode = options.wireMode;
      try {
        data = await callResearchProvider(settings, options, 'summarize', {
          messages,
          outputFormat: fmt,
          timeoutMs: DIAGRAM_SUMMARY_TIMEOUT_MS,
        });
      } catch (error) {
        const status = Number(error?.response?.status || error?.status || 0);
        if (
          options.provider === PROVIDERS.openai_codex_compatible.key &&
          !error?.deepwikiPreventDiagramFallback &&
          (status === 429 || status >= 500)
        ) {
          data = await callDiagramFallbackProvider(settings, {
            messages,
            outputFormat: fmt,
            timeoutMs: DIAGRAM_SUMMARY_TIMEOUT_MS,
          });
          resolvedProvider = data.provider || resolvedProvider;
          resolvedModel = data.model || resolvedModel;
          resolvedWireMode = data.wireMode || resolvedWireMode;
        } else {
          throw error;
        }
      }
      return res.json({
        success: true,
        data: {
          ...data,
          trace_id: trace_id || null,
          mode: 'diagram_synthesis',
          provider: resolvedProvider,
          model: resolvedModel,
          wire_mode: resolvedWireMode,
        },
      });
    }

    if (!repo_context || typeof repo_context !== 'object') {
      return res.status(400).json({ success: false, error: 'repo_context is required for deep_research mode' });
    }

    const stageOneMessages = [
      {
        role: 'user',
        content: buildDeepResearchOpeningPrompt(repo_context, focus_prompt, output_profile, diagram_profile),
      },
    ];
    const stageOne = await callResearchProvider(settings, options, 'deep_research', {
      messages: stageOneMessages,
    });

    const stageTwoMessages = [
      ...stageOneMessages,
      {
        role: 'assistant',
        content: stageOne.content || '已理解。',
      },
      {
        role: 'user',
        content: buildDeepResearchFollowupPrompt(
          stageOne.content,
          repo_context,
          focus_prompt,
          output_profile,
          diagram_profile
        ),
      },
    ];
    const stageTwo = await callResearchProvider(settings, options, 'deep_research', {
      messages: stageTwoMessages,
    });

    res.json({
      success: true,
      data: {
        trace_id: trace_id || null,
        mode,
        provider: options.provider,
        model: options.model,
        wire_mode: options.wireMode,
        output_profile: output_profile || 'engineering_architecture_pack',
        diagram_profile: diagram_profile || 'full',
        content: stageTwo.content,
        stage_one: {
          content: stageOne.content,
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
