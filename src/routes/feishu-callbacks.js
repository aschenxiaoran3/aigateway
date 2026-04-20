const express = require('express');
const axios = require('axios');
const feishuNotifier = require('../notifications/feishu-notifier');

const router = express.Router();
const seenMessageIds = new Map();

function normalizeText(value) {
  return String(value || '').trim();
}

function safeTrimJsonText(content) {
  if (!content) return '';
  if (typeof content === 'object' && typeof content.text === 'string') {
    return normalizeText(content.text);
  }
  const text = normalizeText(content);
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    return normalizeText(parsed?.text || parsed?.content || text);
  } catch {
    return text;
  }
}

function extractPromptCode(text) {
  const match = normalizeText(text).match(/\bHP-[A-Z0-9]{8}\b/i);
  return match ? match[0].toUpperCase() : '';
}

function extractActionValue(body = {}) {
  return (
    body?.action?.value ||
    body?.event?.action?.value ||
    body?.payload?.action?.value ||
    body?.callback?.action?.value ||
    null
  );
}

function buildAnswerTextFromAction(actionValue) {
  const explicitAnswer = normalizeText(actionValue?.answer_text);
  if (explicitAnswer) {
    return explicitAnswer;
  }
  const action = normalizeText(actionValue?.action).toLowerCase();
  const note = normalizeText(actionValue?.note);
  if (action === 'confirm') {
    return `确认 ${note}`.trim();
  }
  if (action === 'pass') {
    return `通过 ${note}`.trim();
  }
  if (action === 'fail') {
    return `打回 ${note}`.trim();
  }
  if (action === 'ack') {
    return `已确认 ${note}`.trim();
  }
  return note;
}

function rememberMessageId(messageId) {
  const normalized = normalizeText(messageId);
  if (!normalized) return false;
  const now = Date.now();
  for (const [key, ts] of seenMessageIds.entries()) {
    if (ts < now - 6 * 3600 * 1000) {
      seenMessageIds.delete(key);
    }
  }
  if (seenMessageIds.has(normalized)) {
    return true;
  }
  seenMessageIds.set(normalized, now);
  return false;
}

function getControlPlaneReplyConfig() {
  return {
    promptListUrl: normalizeText(
      process.env.FEISHU_PROMPT_LIST_URL ||
        'http://127.0.0.1:3104/api/v1/harness/human-prompts?status=pending&limit=20'
    ),
    url: normalizeText(
      process.env.FEISHU_REPLY_FORWARD_URL ||
        'http://127.0.0.1:3104/api/v1/internal/harness/human-prompts/reply'
    ),
    token: normalizeText(process.env.HARNESS_NOTIFY_TOKEN),
    timeoutMs: Number(process.env.HARNESS_NOTIFY_TIMEOUT_MS || 5000),
    verifyToken: normalizeText(process.env.FEISHU_EVENT_VERIFY_TOKEN),
  };
}

function verifyFeishuToken(req) {
  const expected = getControlPlaneReplyConfig().verifyToken;
  if (!expected) return true;
  const actual = normalizeText(req.body?.token || req.body?.header?.token || req.headers['x-lark-request-token']);
  return Boolean(actual && actual === expected);
}

async function resolvePromptCode(config) {
  const response = await axios.get(config.promptListUrl, {
    timeout: config.timeoutMs,
    headers: {
      ...(config.token ? { 'x-internal-token': config.token } : {}),
    },
  });
  const prompts = Array.isArray(response.data?.data) ? response.data.data : [];
  if (!prompts.length) {
    return { promptCode: '', reason: 'no_pending_prompt' };
  }
  const harnessPrompts = prompts.filter((item) => normalizeText(item?.source_type) === 'harness_checkpoint');
  if (harnessPrompts.length === 1) {
    return {
      promptCode: normalizeText(harnessPrompts[0]?.prompt_code),
      reason: 'single_harness_prompt',
    };
  }
  if (prompts.length > 1) {
    return {
      promptCode: '',
      reason: 'multiple_pending_prompts',
      promptCodes: prompts.map((item) => normalizeText(item?.prompt_code)).filter(Boolean),
    };
  }
  return {
    promptCode: normalizeText(prompts[0]?.prompt_code),
    reason: 'single_pending_prompt',
  };
}

router.post('/callbacks', async (req, res) => {
  try {
    if (req.body?.challenge) {
      return res.json({ challenge: req.body.challenge });
    }

    if (!verifyFeishuToken(req)) {
      return res.status(403).json({ success: false, error: 'Invalid Feishu verification token' });
    }

    const actionValue = extractActionValue(req.body);
    if (actionValue) {
      const config = getControlPlaneReplyConfig();
      const promptCode = normalizeText(actionValue?.prompt_code).toUpperCase();
      if (!promptCode) {
        return res.json({
          toast: {
            type: 'warning',
            content: '缺少 prompt_code，暂时无法处理这次点击。',
          },
        });
      }
      const answerText = buildAnswerTextFromAction(actionValue);
      const senderOpenId = normalizeText(
        req.body?.open_id ||
          req.body?.operator?.open_id ||
          req.body?.event?.operator?.operator_id?.open_id ||
          req.body?.event?.operator?.open_id
      );
      const response = await axios.post(
        config.url,
        {
          prompt_code: promptCode,
          answer_text: answerText,
          answered_by: senderOpenId || 'feishu_card_action',
          raw_event: req.body,
        },
        {
          timeout: config.timeoutMs,
          headers: {
            'content-type': 'application/json',
            ...(config.token ? { 'x-internal-token': config.token } : {}),
          },
        }
      );
      const actionResult = response.data?.data?.action_result || {};
      return res.json({
        toast: {
          type: 'success',
          content: `已处理 ${normalizeText(actionResult?.action) || promptCode}`,
        },
      });
    }

    const eventType = normalizeText(req.body?.header?.event_type || req.body?.type);
    if (eventType !== 'im.message.receive_v1') {
      return res.json({ success: true, ignored: true, reason: 'unsupported_event_type' });
    }

    const event = req.body?.event || {};
    const messageId = normalizeText(event?.message?.message_id);
    if (rememberMessageId(messageId)) {
      return res.json({ success: true, duplicate: true });
    }

    const text = safeTrimJsonText(event?.message?.content);
    let promptCode = extractPromptCode(text);
    const config = getControlPlaneReplyConfig();
    const senderOpenId = normalizeText(event?.sender?.sender_id?.open_id);
    if (!promptCode) {
      const resolved = await resolvePromptCode(config);
      if (resolved.promptCode) {
        promptCode = resolved.promptCode;
      } else {
        if (senderOpenId && resolved.reason === 'multiple_pending_prompts') {
          await feishuNotifier.sendText(
            `你现在有多条待确认，请在回复里带上口令，例如：${resolved.promptCodes.join(' / ')}`,
            '需要补充回复口令',
            { receiveId: senderOpenId }
          );
        }
        return res.json({ success: true, ignored: true, reason: resolved.reason || 'no_prompt_code' });
      }
    }

    const response = await axios.post(
      config.url,
      {
        prompt_code: promptCode,
        answer_text: text,
        answered_by: senderOpenId || normalizeText(event?.sender?.sender_id?.user_id) || 'feishu',
        raw_event: event,
      },
      {
        timeout: config.timeoutMs,
        headers: {
          'content-type': 'application/json',
          ...(config.token ? { 'x-internal-token': config.token } : {}),
        },
      }
    );

    const prompt = response.data?.data?.prompt || {};
    const action = response.data?.data?.action_result || {};
    if (senderOpenId) {
      const summary = normalizeText(action?.action) || 'recorded';
      await feishuNotifier.sendText(
        `已收到 ${normalizeText(prompt.prompt_code) || promptCode} 的回复，并已执行 ${summary}。`,
        '已收到你的确认',
        { receiveId: senderOpenId }
      );
    }

    return res.json({
      success: true,
      data: {
        prompt_code: promptCode,
        status: response.data?.data?.prompt?.status || 'answered',
      },
    });
  } catch (error) {
    console.error('Failed to handle Feishu callback:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to handle Feishu callback',
    });
  }
});

module.exports = router;
