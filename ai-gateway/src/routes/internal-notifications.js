const express = require('express');
const crypto = require('crypto');
const feishuNotifier = require('../notifications/feishu-notifier');

const router = express.Router();

const STAGE_LABELS = {
  demand_confirm_wait: '需求确认',
  design_confirm_wait: '设计确认',
  development_coding: '开发中',
  development_unit_testing: '单测中',
  uat_wait: '等待 UAT',
  deploy_pending: '待部署',
  returned_to_dev: '打回开发',
  exception: '异常',
};

function normalizeText(value) {
  return String(value || '').trim();
}

function maskInternalToken(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.length <= 8) return '********';
  return `${'*'.repeat(Math.max(8, text.length - 4))}${text.slice(-4)}`;
}

function safeCompareSecret(expected, actual) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(actual || ''), 'utf8');
  if (!left.length || !right.length || left.length !== right.length) {
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

function getStageLabel(stageKey) {
  return STAGE_LABELS[normalizeText(stageKey)] || normalizeText(stageKey) || '-';
}

function buildFlowboardUrl(cardId) {
  const base = normalizeText(process.env.HARNESS_FLOWBOARD_URL || 'http://127.0.0.1:3000/flowboard');
  if (!cardId) return base;
  const joiner = base.includes('?') ? '&' : '?';
  return `${base}${joiner}card=${encodeURIComponent(String(cardId))}`;
}

function buildTitle(eventType, card) {
  const code = normalizeText(card?.card_code) || 'Harness';
  switch (normalizeText(eventType)) {
    case 'checkpoint.waiting':
      return `Harness 待处理 · ${code}`;
    case 'runtime.started':
      return `Harness 已启动 Runtime · ${code}`;
    case 'runtime.failed':
      return `Harness Runtime 失败 · ${code}`;
    case 'uat.passed':
      return `Harness UAT 通过 · ${code}`;
    case 'summary.generated':
      return `Harness 已生成总结 · ${code}`;
    case 'uat.failed':
      return `Harness UAT 打回 · ${code}`;
    case 'card.created':
      return `Harness 新建卡片 · ${code}`;
    default:
      return `Harness 事件通知 · ${code}`;
  }
}

function buildMarkdown(payload) {
  const eventType = normalizeText(payload.event_type);
  const card = payload.card || {};
  const runtimeRun = payload.runtime_run || {};
  const checkpoint = payload.checkpoint || {};
  const prompt = payload.prompt || {};
  const summary = payload.summary_artifact || {};
  const traceId = normalizeText(payload.trace_id || card.trace_id || runtimeRun.trace_id);
  const lines = [
    `**事件类型：** ${eventType || '-'}`,
    `**卡片：** ${normalizeText(card.card_code) || '-'} · ${normalizeText(card.title) || '-'}`,
    `**阶段：** ${getStageLabel(card.stage_key)}`,
  ];

  if (normalizeText(checkpoint.checkpoint_type)) {
    lines.push(`**待处理点：** ${normalizeText(checkpoint.checkpoint_type)} (${normalizeText(checkpoint.status) || '-'})`);
  }
  if (normalizeText(checkpoint.resume_token)) {
    lines.push(`**Checkpoint Token：** \`${normalizeText(checkpoint.resume_token)}\``);
  }
  if (normalizeText(prompt.prompt_code)) {
    lines.push(`**回复口令：** \`${normalizeText(prompt.prompt_code)}\``);
  }
  if (normalizeText(prompt.question)) {
    lines.push(`**确认问题：** ${normalizeText(prompt.question)}`);
  }
  if (normalizeText(prompt.instructions)) {
    lines.push(`**回复方式：** ${normalizeText(prompt.instructions)}`);
  }
  if (runtimeRun.id) {
    lines.push(`**Runtime：** #${runtimeRun.id} · ${normalizeText(runtimeRun.status) || '-'}`);
  }
  if (normalizeText(runtimeRun.test_command)) {
    lines.push(`**测试命令：** \`${normalizeText(runtimeRun.test_command)}\``);
  }
  if (normalizeText(runtimeRun.test_result)) {
    lines.push(`**测试结果：** ${normalizeText(runtimeRun.test_result)}`);
  }
  if (summary.id) {
    lines.push(`**总结：** #${summary.id} · ${normalizeText(summary.title) || '-'}`);
  }
  if (normalizeText(card.repo_url) || normalizeText(card.repo_branch)) {
    lines.push(`**仓库：** ${normalizeText(card.repo_url) || '-'} @ ${normalizeText(card.repo_branch) || '-'}`);
  }
  if (normalizeText(card.latest_ai_action)) {
    lines.push(`**最近 AI 动作：** ${normalizeText(card.latest_ai_action)}`);
  }
  if (normalizeText(card.latest_human_action)) {
    lines.push(`**最近人工动作：** ${normalizeText(card.latest_human_action)}`);
  }
  if (normalizeText(card.blocked_reason)) {
    lines.push(`**阻断原因：** ${normalizeText(card.blocked_reason)}`);
  }
  if (traceId) {
    lines.push(`**Trace：** \`${traceId}\``);
  }
  lines.push(`**工作台：** [打开 Flowboard](${buildFlowboardUrl(card.id)})`);
  return lines.join('\n');
}

function buildHumanPromptTitle(prompt) {
  const promptCode = normalizeText(prompt?.prompt_code) || 'Human Prompt';
  return `待你确认 · ${promptCode}`;
}

function buildHumanPromptMarkdown(prompt) {
  const payload = prompt?.prompt_payload_json || {};
  const customActions = Array.isArray(payload.actions) ? payload.actions : [];
  const lines = [
    `**Prompt：** ${normalizeText(prompt?.prompt_code) || '-'}`,
    `**问题：** ${normalizeText(prompt?.question) || '-'}`,
  ];
  if (normalizeText(payload.summary)) {
    lines.push(`**动作摘要：** ${normalizeText(payload.summary)}`);
  }
  if (normalizeText(payload.risk_level)) {
    lines.push(`**风险等级：** ${normalizeText(payload.risk_level)}`);
  }
  if (normalizeText(payload.template_key)) {
    lines.push(`**命令模板：** ${normalizeText(payload.template_key)}`);
  }
  if (normalizeText(payload.workspace_path)) {
    lines.push(`**工作目录：** ${normalizeText(payload.workspace_path)}`);
  }
  if (normalizeText(prompt?.instructions)) {
    lines.push(`**回复方式：** ${normalizeText(prompt.instructions)}`);
  }
  if (normalizeText(payload.card_code) || normalizeText(payload.card_title)) {
    lines.push(`**关联卡片：** ${normalizeText(payload.card_code) || '-'} · ${normalizeText(payload.card_title) || '-'}`);
  }
  if (normalizeText(payload.checkpoint_label)) {
    lines.push(`**确认类型：** ${normalizeText(payload.checkpoint_label)}`);
  }
  if (normalizeText(payload.resume_token)) {
    lines.push(`**Checkpoint Token：** \`${normalizeText(payload.resume_token)}\``);
  }
  if (customActions.length) {
    const labels = customActions
      .map((action) => normalizeText(action?.label))
      .filter(Boolean);
    if (labels.length) {
      lines.push(`**可选操作：** ${labels.join(' / ')}`);
    }
  }
  return lines.join('\n');
}

function buildPromptButtons(prompt) {
  const promptCode = normalizeText(prompt?.prompt_code);
  const payload = prompt?.prompt_payload_json || {};
  const checkpointType = normalizeText(prompt?.checkpoint_type);
  const cardId = payload.card_id || prompt?.card_id || null;
  const customActions = Array.isArray(payload.actions) ? payload.actions : [];
  const actions = [];

  if (customActions.length) {
    customActions.forEach((item) => {
      const label = normalizeText(item?.label);
      if (!label) return;
      actions.push({
        tag: 'button',
        text: { tag: 'plain_text', content: label },
        type: normalizeText(item?.type) || 'default',
        value: {
          action: normalizeText(item?.action) || 'reply',
          prompt_code: promptCode,
          answer_text: normalizeText(item?.answer_text) || label,
        },
      });
    });
  } else if (checkpointType === 'demand_confirmation' || checkpointType === 'design_confirmation') {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '确认并继续' },
      type: 'primary',
      value: { action: 'confirm', prompt_code: promptCode },
    });
  } else if (checkpointType === 'uat_acceptance') {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '通过' },
      type: 'primary',
      value: { action: 'pass', prompt_code: promptCode },
    });
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打回' },
      type: 'danger',
      value: { action: 'fail', prompt_code: promptCode },
    });
  } else {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '记录已读' },
      type: 'default',
      value: { action: 'ack', prompt_code: promptCode },
    });
  }

  if (cardId) {
    actions.push({
      tag: 'button',
      text: { tag: 'plain_text', content: '打开 Flowboard' },
      type: 'default',
      url: buildFlowboardUrl(cardId),
      value: { action: 'open_flowboard', prompt_code: promptCode },
    });
  }

  return actions;
}

function buildHumanPromptCard(prompt) {
  const payload = prompt?.prompt_payload_json || {};
  const customActions = Array.isArray(payload.actions) ? payload.actions : [];
  const title = buildHumanPromptTitle(prompt);
  const elements = [
    {
      tag: 'markdown',
      content: buildHumanPromptMarkdown(prompt),
    },
    {
      tag: 'action',
      actions: buildPromptButtons(prompt),
    },
    {
      tag: 'note',
      elements: [
        {
          tag: 'plain_text',
          content: `发送时间: ${new Date().toLocaleString('zh-CN')}`,
        },
      ],
    },
  ];

  if (normalizeText(payload.resume_token) || customActions.length) {
    elements.splice(1, 0, {
      tag: 'markdown',
      content: `如需补充备注，也可以直接回复：${normalizeText(prompt?.prompt_code)} + 你的意见`,
    });
  }

  return {
    config: {
      wide_screen_mode: true,
    },
    header: {
      title: {
        tag: 'plain_text',
        content: title,
      },
      template: 'blue',
    },
    elements,
  };
}

router.post('/harness', async (req, res) => {
  try {
    const expectedToken = normalizeText(process.env.HARNESS_NOTIFY_TOKEN);
    const actualToken = normalizeText(req.headers['x-internal-token']);
    if (expectedToken && !safeCompareSecret(expectedToken, actualToken)) {
      return res.status(403).json({
        success: false,
        error: `Invalid internal token (${maskInternalToken(actualToken)})`,
      });
    }

    const payload = req.body || {};
    const title = buildTitle(payload.event_type, payload.card);
    const markdown = buildMarkdown(payload);
    const delivered = await feishuNotifier.sendMarkdown(markdown, title);

    return res.json({
      success: true,
      data: {
        delivered,
        notifier_enabled: Boolean(feishuNotifier.enabled),
      },
    });
  } catch (error) {
    console.error('Failed to deliver harness notification:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to deliver harness notification',
    });
  }
});

router.post('/human-prompts', async (req, res) => {
  try {
    const expectedToken = normalizeText(process.env.HARNESS_NOTIFY_TOKEN);
    const actualToken = normalizeText(req.headers['x-internal-token']);
    if (expectedToken && !safeCompareSecret(expectedToken, actualToken)) {
      return res.status(403).json({
        success: false,
        error: `Invalid internal token (${maskInternalToken(actualToken)})`,
      });
    }

    const prompt = req.body?.prompt || {};
    const delivered = await feishuNotifier.sendInteractiveCard(buildHumanPromptCard(prompt));

    return res.json({
      success: true,
      data: {
        delivered,
        notifier_enabled: Boolean(feishuNotifier.enabled),
      },
    });
  } catch (error) {
    console.error('Failed to deliver human prompt notification:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to deliver human prompt notification',
    });
  }
});

module.exports = router;
