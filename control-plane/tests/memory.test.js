const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildMemoryRecallText,
  buildMemorySourceUri,
  inferMemoryFactsFromTurns,
  resolveMemoryPolicyChain,
} = require('../src/memory/shared');
const {
  extractCodexSessionFromText,
  buildCodexBrief,
} = require('../../scripts/codex-memory-utils.cjs');

test('resolveMemoryPolicyChain prefers scope specific policy over project and global', () => {
  const resolved = resolveMemoryPolicyChain({
    policies: [
      { scope_type: 'global', scope_id: 'default', enabled: false, max_recall_tokens: 300 },
      { scope_type: 'project', scope_id: 'ai-platform', enabled: true, max_recall_tokens: 700 },
      { scope_type: 'scope_key', scope_id: 'workspace:ai-platform', enabled: true, max_recall_tokens: 900 },
    ],
    scope_key: 'workspace:ai-platform',
    project: 'ai-platform',
    global: 'default',
  });

  assert.equal(resolved.policy.enabled, true);
  assert.equal(resolved.policy.max_recall_tokens, 900);
  assert.equal(resolved.matched_policy.scope_type, 'scope_key');
});

test('inferMemoryFactsFromTurns extracts preference and decision hints', () => {
  const facts = inferMemoryFactsFromTurns(
    [
      { role: 'user', content_text: '以后默认中文，结论先行。' },
      { role: 'user', content_text: '一期采用 MySQL + knowledge-base，不引入 Chroma。' },
    ],
    { scope_key: 'workspace:ai-platform' }
  );

  assert.ok(facts.some((item) => item.fact_type === 'preference'));
  assert.ok(facts.some((item) => item.fact_type === 'decision'));
});

test('buildMemoryRecallText builds layered memory block', () => {
  const text = buildMemoryRecallText({
    facts: [{ object_text: '默认中文，结论先行' }],
    turns: [
      { role: 'user', content_text_redacted: '我们采用 MySQL 作为 authority layer。' },
      { role: 'assistant', content_text_redacted: '已补上 control-plane memory API。' },
    ],
    max_recall_tokens: 400,
  });

  assert.match(text, /L0 Profile/);
  assert.match(text, /L2 Scoped Recall/);
});

test('buildMemorySourceUri stays stable for the same scope thread and turn index', () => {
  const first = buildMemorySourceUri(
    {
      source_system: 'codex',
      scope_key: 'workspace:ai-platform',
      thread_key: 'codex:session-1',
    },
    7
  );
  const second = buildMemorySourceUri(
    {
      source_system: 'codex',
      scope_key: 'workspace:ai-platform',
      thread_key: 'codex:session-1',
    },
    7
  );

  assert.equal(first, second);
  assert.match(first, /^memory:\/\/workspace:ai-platform\/codex:session-1\/turn\/7$/);
});

test('extractCodexSessionFromText keeps user assistant turns and project signals', () => {
  const session = extractCodexSessionFromText(
    [
      JSON.stringify({
        timestamp: '2026-04-17T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-1',
          timestamp: '2026-04-17T01:00:00.000Z',
          cwd: '/Users/xiaoran/.openclaw/workspace',
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-17T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '请给 projects/ai-platform 做长期记忆方案' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-17T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call',
          name: 'exec_command',
          arguments: JSON.stringify({
            cmd: 'sed -n 1,20p README.md',
            workdir: '/Users/xiaoran/.openclaw/workspace/projects/ai-platform',
          }),
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-17T01:00:03.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: '我会补 importer、brief、memory API。' }],
        },
      }),
    ].join('\n'),
    {
      sourceFile: '/tmp/session-1.jsonl',
    }
  );

  assert.equal(session.id, 'session-1');
  assert.equal(session.turns.length, 2);
  assert.ok(session.related_reasons.includes('tool_workdir'));
  assert.ok(session.related_reasons.includes('message_match'));
  assert.equal(session.title, '请给 projects/ai-platform 做长期记忆方案');
});

test('buildCodexBrief produces five required sections', () => {
  const brief = buildCodexBrief([
    {
      id: 'session-1',
      timestamp: '2026-04-17T01:00:00.000Z',
      source_file: '/tmp/session-1.jsonl',
      turns: [
        { role: 'user', text: '希望给 ai-platform 加长期记忆，并记录我和 Codex 的对话日志。' },
        { role: 'assistant', text: '一期采用 MySQL + knowledge-base，新增 importer 和 CODEX_BRIEF。' },
      ],
      commentary: [],
    },
  ]);

  assert.match(brief, /## 当前项目目标/);
  assert.match(brief, /## 最近已完成/);
  assert.match(brief, /## 当前未完成\/风险/);
  assert.match(brief, /## 关键决策与偏好/);
  assert.match(brief, /## 下次开线程先查什么/);
});

test('extractCodexSessionFromText skips startup boilerplate when choosing title', () => {
  const session = extractCodexSessionFromText(
    [
      JSON.stringify({
        timestamp: '2026-04-17T01:00:00.000Z',
        type: 'session_meta',
        payload: {
          id: 'session-2',
          timestamp: '2026-04-17T01:00:00.000Z',
          cwd: '/Users/xiaoran/.openclaw/workspace',
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-17T01:00:01.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '# AGENTS.md instructions for /Users/xiaoran/.openclaw/workspace' }],
        },
      }),
      JSON.stringify({
        timestamp: '2026-04-17T01:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: '继续完善 ai-platform 的长期记忆和项目 continuity。' }],
        },
      }),
    ].join('\n'),
    {
      sourceFile: '/tmp/session-2.jsonl',
    }
  );

  assert.equal(session.title, '继续完善 ai-platform 的长期记忆和项目 continuity');
});
