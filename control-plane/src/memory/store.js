const axios = require('axios');
const db = require('../db/mysql');
const {
  DEFAULT_MEMORY_POLICY,
  parseJson,
  stringifyJson,
  normalizeText,
  truncateText,
  hashText,
  redactMemoryText,
  summarizeMemoryText,
  deriveHallKey,
  resolveMemoryScopeContext,
  buildMemorySourceUri,
  inferMemoryFactsFromTurns,
  buildMemoryRecallText,
  resolveMemoryPolicyChain,
} = require('./shared');

async function query(sql, params = []) {
  const [rows] = await db.getPool().execute(sql, params);
  return rows;
}

function shouldReplaceThreadHistory(payload = {}, rawTurns = []) {
  const sourceSystem = normalizeText(payload.source_system || payload.client_app).toLowerCase();
  return sourceSystem === 'codex' && normalizeText(payload.thread_key).startsWith('codex:') && rawTurns.length > 0;
}

async function replaceThreadHistory(scopeKey, threadKey) {
  await query('DELETE FROM gateway_memory_facts WHERE scope_key = ? AND thread_key = ?', [
    normalizeText(scopeKey),
    normalizeText(threadKey),
  ]);
  await query('DELETE FROM gateway_memory_turns WHERE scope_key = ? AND thread_key = ?', [
    normalizeText(scopeKey),
    normalizeText(threadKey),
  ]);
}

function dedupeMemoryKbResults(results = []) {
  const seen = new Set();
  const output = [];
  for (const item of results) {
    if (!item) continue;
    const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {};
    const key = [
      normalizeText(metadata.source_uri) || normalizeText(metadata.thread_key) || 'memory',
      normalizeText(metadata.role) || 'role',
      hashText(normalizeText(item.text || '')),
    ].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function tokenizeMemoryQuery(queryText = '') {
  const normalized = normalizeText(queryText).toLowerCase();
  if (!normalized) return [];
  const matches = normalized.match(/[\u4e00-\u9fff]{1,12}|[a-z0-9_./:-]{2,64}/g) || [];
  return Array.from(new Set(matches.map((item) => item.trim()).filter(Boolean))).slice(0, 8);
}

function scoreSqlFallbackRow(row, tokens = [], queryText = '') {
  const haystack = `${normalizeText(row.summary_text)} ${normalizeText(row.content_text_redacted)}`.toLowerCase();
  if (!haystack) return 0;
  let score = 0;
  if (queryText && haystack.includes(queryText.toLowerCase())) {
    score += 3;
  }
  for (const token of tokens) {
    if (!token) continue;
    if (haystack.includes(token)) {
      score += token.length >= 4 ? 2 : 1;
    }
  }
  if (/advice|discoveries|preferences/.test(normalizeText(row.hall_key).toLowerCase())) {
    score += 0.5;
  }
  return score;
}

async function searchTurnsBySqlFallback(queryText, context, options = {}) {
  const normalizedQuery = normalizeText(queryText);
  const tokens = tokenizeMemoryQuery(normalizedQuery);
  if (!normalizedQuery || !tokens.length) return [];
  const conditions = ['scope_key = ?'];
  const params = [context.scope_key];
  if (context.project_code !== 'global') {
    conditions.push('(project_code = ? OR project_code IS NULL)');
    params.push(context.project_code);
  }
  if (normalizeText(options.room_key)) {
    conditions.push('room_key = ?');
    params.push(normalizeText(options.room_key));
  }
  const likeClauses = [];
  for (const token of tokens) {
    likeClauses.push('(LOWER(content_text_redacted) LIKE ? OR LOWER(summary_text) LIKE ?)');
    const pattern = `%${token}%`;
    params.push(pattern, pattern);
  }
  if (likeClauses.length) {
    conditions.push(`(${likeClauses.join(' OR ')})`);
  }
  const candidateLimit = Math.max(12, Number(options.candidate_k || 24));
  const rows = await query(
    `SELECT *
     FROM gateway_memory_turns
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT ${candidateLimit}`,
    params
  );
  return rows
    .map(mapMemoryTurnRow)
    .map((row) => ({
      id: `sql-fallback:${row.id}`,
      score: scoreSqlFallbackRow(row, tokens, normalizedQuery),
      text: normalizeText(row.content_text_redacted || row.summary_text),
      metadata: {
        memory_turn_id: row.id,
        source_uri: normalizeText(row.metadata_json?.source_uri) || null,
        thread_key: row.thread_key,
        role: row.role,
        fallback_mode: 'sql_like',
      },
    }))
    .filter((item) => item.score > 0);
}

function mapMemoryPolicyRow(row) {
  if (!row) return null;
  return {
    ...row,
    enabled: Boolean(row.enabled),
    fact_extraction: Boolean(row.fact_extraction),
    retention_days: Number(row.retention_days || DEFAULT_MEMORY_POLICY.retention_days),
    max_recall_tokens: Number(row.max_recall_tokens || DEFAULT_MEMORY_POLICY.max_recall_tokens),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapMemoryThreadRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapMemoryTurnRow(row) {
  if (!row) return null;
  return {
    ...row,
    metadata_json: parseJson(row.metadata_json, {}),
    importance_score:
      row.importance_score == null ? null : Number(row.importance_score),
  };
}

function mapMemoryFactRow(row) {
  if (!row) return null;
  return {
    ...row,
    confidence: row.confidence == null ? null : Number(row.confidence),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function mapMemoryRecallRow(row) {
  if (!row) return null;
  return {
    ...row,
    recalled_turn_ids_json: parseJson(row.recalled_turn_ids_json, []),
    recalled_fact_ids_json: parseJson(row.recalled_fact_ids_json, []),
    metadata_json: parseJson(row.metadata_json, {}),
  };
}

function buildPolicyPairs(input = {}) {
  return [
    ['scope_key', input.scope_key],
    ['agent_spec', input.agent_spec_id],
    ['skill_package', input.skill_package_id],
    ['project', input.project_code],
    ['api_key', input.api_key_id],
    ['global', input.global || 'default'],
  ].filter(([, value]) => normalizeText(value));
}

async function listMemoryPolicies(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.scope_type) {
    conditions.push('scope_type = ?');
    params.push(normalizeText(filters.scope_type));
  }
  if (filters.scope_id) {
    conditions.push('scope_id = ?');
    params.push(normalizeText(filters.scope_id));
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await query(
    `SELECT *
     FROM gateway_memory_policies
     ${whereSql}
     ORDER BY updated_at DESC, id DESC
     LIMIT 200`,
    params
  );
  return rows.map(mapMemoryPolicyRow);
}

async function upsertMemoryPolicy(data = {}) {
  const scopeType = normalizeText(data.scope_type);
  const scopeId = normalizeText(data.scope_id);
  if (!scopeType || !scopeId) {
    throw new Error('scope_type and scope_id are required');
  }
  await query(
    `INSERT INTO gateway_memory_policies
     (scope_type, scope_id, enabled, capture_mode, fact_extraction, retention_days, redaction_mode, max_recall_tokens, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       enabled = VALUES(enabled),
       capture_mode = VALUES(capture_mode),
       fact_extraction = VALUES(fact_extraction),
       retention_days = VALUES(retention_days),
       redaction_mode = VALUES(redaction_mode),
       max_recall_tokens = VALUES(max_recall_tokens),
       metadata_json = VALUES(metadata_json),
       updated_at = NOW()`,
    [
      scopeType,
      scopeId,
      data.enabled === true ? 1 : 0,
      normalizeText(data.capture_mode) || DEFAULT_MEMORY_POLICY.capture_mode,
      data.fact_extraction === false ? 0 : 1,
      Number(data.retention_days || DEFAULT_MEMORY_POLICY.retention_days),
      normalizeText(data.redaction_mode) || DEFAULT_MEMORY_POLICY.redaction_mode,
      Number(data.max_recall_tokens || DEFAULT_MEMORY_POLICY.max_recall_tokens),
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query(
    'SELECT * FROM gateway_memory_policies WHERE scope_type = ? AND scope_id = ? LIMIT 1',
    [scopeType, scopeId]
  );
  return mapMemoryPolicyRow(row);
}

async function resolveMemoryPolicy(input = {}) {
  const pairs = buildPolicyPairs(input);
  if (!pairs.length) {
    return {
      policy: { ...DEFAULT_MEMORY_POLICY },
      matched_policy: null,
      global_policy: null,
      policies: [],
    };
  }
  const conditions = pairs.map(() => '(scope_type = ? AND scope_id = ?)');
  const params = pairs.flatMap(([scopeType, scopeId]) => [scopeType, normalizeText(scopeId)]);
  const rows = await query(
    `SELECT *
     FROM gateway_memory_policies
     WHERE ${conditions.join(' OR ')}`,
    params
  );
  const policies = rows.map(mapMemoryPolicyRow);
  const resolved = resolveMemoryPolicyChain({
    policies,
    scope_key: input.scope_key,
    agent_spec: input.agent_spec_id,
    skill_package: input.skill_package_id,
    project: input.project_code,
    api_key: input.api_key_id,
    global: input.global || 'default',
  });
  return {
    ...resolved,
    policies,
  };
}

async function upsertMemoryThread(data = {}) {
  const context = resolveMemoryScopeContext(data);
  await query(
    `INSERT INTO gateway_memory_threads
     (scope_key, thread_key, source_system, client_app, project_code, title, summary_text, last_message_at, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), CAST(? AS JSON))
     ON DUPLICATE KEY UPDATE
       source_system = VALUES(source_system),
       client_app = VALUES(client_app),
       project_code = VALUES(project_code),
       title = COALESCE(VALUES(title), title),
       summary_text = COALESCE(VALUES(summary_text), summary_text),
       last_message_at = COALESCE(VALUES(last_message_at), last_message_at, NOW()),
       metadata_json = VALUES(metadata_json),
       updated_at = NOW()`,
    [
      context.scope_key,
      context.thread_key,
      context.source_system,
      normalizeText(data.client_app).slice(0, 64) || null,
      context.project_code === 'global' ? null : context.project_code,
      normalizeText(data.title).slice(0, 255) || null,
      summarizeMemoryText(data.summary_text || data.title || '', 500) || null,
      data.last_message_at || null,
      stringifyJson({
        ...(parseJson(data.metadata_json, {})),
        room_key: context.room_key,
      }),
    ]
  );
  const [row] = await query(
    'SELECT * FROM gateway_memory_threads WHERE scope_key = ? AND thread_key = ? LIMIT 1',
    [context.scope_key, context.thread_key]
  );
  return mapMemoryThreadRow(row);
}

async function createMemoryTurn(data = {}, thread = null) {
  const context = resolveMemoryScopeContext({
    ...data,
    scope_key: data.scope_key || thread?.scope_key,
    thread_key: data.thread_key || thread?.thread_key,
  });
  const contentText = normalizeText(data.content_text || data.content_text_redacted);
  const redactedText = redactMemoryText(contentText);
  const summaryText = summarizeMemoryText(data.summary_text || redactedText, 500);
  const result = await query(
    `INSERT INTO gateway_memory_turns
     (thread_id, source_system, client_app, scope_key, thread_key, trace_id, project_code, room_key, hall_key, role,
      content_text_redacted, content_text_raw_cipher, summary_text, importance_score, embedding_collection, embedding_doc_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      thread?.id || data.thread_id || null,
      normalizeText(data.source_system || context.source_system || 'gateway').slice(0, 64),
      normalizeText(data.client_app).slice(0, 64) || null,
      context.scope_key,
      context.thread_key,
      normalizeText(data.trace_id).slice(0, 128) || null,
      context.project_code === 'global' ? null : context.project_code,
      normalizeText(data.room_key || context.room_key).slice(0, 64) || null,
      normalizeText(data.hall_key || deriveHallKey(redactedText, data.role)).slice(0, 64) || null,
      normalizeText(data.role || 'user').slice(0, 32) || 'user',
      redactedText || null,
      normalizeText(data.content_text_raw_cipher) || null,
      summaryText || null,
      data.importance_score != null ? Number(data.importance_score) : null,
      normalizeText(data.embedding_collection || context.collection).slice(0, 128) || null,
      normalizeText(data.embedding_doc_id).slice(0, 128) || null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_memory_turns WHERE id = ? LIMIT 1', [result.insertId]);
  return mapMemoryTurnRow(row);
}

async function upsertTemporalFact(data = {}) {
  const scopeKey = normalizeText(data.scope_key);
  const subjectText = normalizeText(data.subject_text);
  const predicateText = normalizeText(data.predicate_text);
  if (!scopeKey || !subjectText || !predicateText) return null;

  const activeRows = await query(
    `SELECT *
     FROM gateway_memory_facts
     WHERE scope_key = ?
       AND subject_text = ?
       AND predicate_text = ?
       AND valid_to IS NULL
     ORDER BY id DESC`,
    [scopeKey, subjectText, predicateText]
  );
  const activeFacts = activeRows.map(mapMemoryFactRow);
  const currentObject = normalizeText(data.object_text);
  const duplicate = activeFacts.find((item) => normalizeText(item.object_text) === currentObject);
  if (duplicate) {
    return duplicate;
  }
  if (activeFacts.length) {
    await query(
      `UPDATE gateway_memory_facts
       SET valid_to = NOW(), supersedes_turn_id = ?, updated_at = NOW()
       WHERE scope_key = ?
         AND subject_text = ?
         AND predicate_text = ?
         AND valid_to IS NULL`,
      [data.source_turn_id || null, scopeKey, subjectText, predicateText]
    );
  }
  const result = await query(
    `INSERT INTO gateway_memory_facts
     (scope_key, thread_key, source_turn_id, fact_type, subject_text, predicate_text, object_text, confidence, valid_from, valid_to, supersedes_turn_id, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, NOW()), ?, ?, CAST(? AS JSON))`,
    [
      scopeKey,
      normalizeText(data.thread_key) || null,
      data.source_turn_id || null,
      normalizeText(data.fact_type || 'fact').slice(0, 64) || 'fact',
      subjectText.slice(0, 255),
      predicateText.slice(0, 191),
      currentObject || null,
      data.confidence != null ? Number(data.confidence) : null,
      data.valid_from || null,
      data.valid_to || null,
      data.supersedes_turn_id || null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_memory_facts WHERE id = ? LIMIT 1', [result.insertId]);
  return mapMemoryFactRow(row);
}

async function listMemoryThreads(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.scope_key) {
    conditions.push('t.scope_key = ?');
    params.push(normalizeText(filters.scope_key));
  }
  if (filters.thread_key) {
    conditions.push('t.thread_key = ?');
    params.push(normalizeText(filters.thread_key));
  }
  if (filters.project_code) {
    conditions.push('t.project_code = ?');
    params.push(normalizeText(filters.project_code));
  }
  if (filters.client_app) {
    conditions.push('t.client_app = ?');
    params.push(normalizeText(filters.client_app));
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, Number(filters.limit || 50)));
  const rows = await query(
    `SELECT t.*,
            (SELECT COUNT(*) FROM gateway_memory_turns mt WHERE mt.thread_key = t.thread_key AND mt.scope_key = t.scope_key) AS turn_count
     FROM gateway_memory_threads t
     ${whereSql}
     ORDER BY COALESCE(t.last_message_at, t.updated_at) DESC, t.id DESC
     LIMIT ${limit}`,
    params
  );
  return rows.map(mapMemoryThreadRow);
}

async function getMemoryThread(threadKey, filters = {}) {
  const scopeKey = normalizeText(filters.scope_key);
  const params = [normalizeText(threadKey)];
  let sql = 'SELECT * FROM gateway_memory_threads WHERE thread_key = ?';
  if (scopeKey) {
    sql += ' AND scope_key = ?';
    params.push(scopeKey);
  }
  sql += ' ORDER BY id DESC LIMIT 1';
  const [threadRow] = await query(sql, params);
  if (!threadRow) return null;
  const turns = await query(
    `SELECT *
     FROM gateway_memory_turns
     WHERE scope_key = ? AND thread_key = ?
     ORDER BY created_at ASC, id ASC
     LIMIT 200`,
    [threadRow.scope_key, threadRow.thread_key]
  );
  return {
    thread: mapMemoryThreadRow(threadRow),
    turns: turns.map(mapMemoryTurnRow),
  };
}

async function listMemoryFacts(filters = {}) {
  const conditions = [];
  const params = [];
  if (filters.scope_key) {
    conditions.push('scope_key = ?');
    params.push(normalizeText(filters.scope_key));
  }
  if (filters.thread_key) {
    conditions.push('thread_key = ?');
    params.push(normalizeText(filters.thread_key));
  }
  if (filters.project_code) {
    conditions.push(
      'source_turn_id IN (SELECT id FROM gateway_memory_turns WHERE project_code = ?)'
    );
    params.push(normalizeText(filters.project_code));
  }
  if (filters.active_only !== false) {
    conditions.push('valid_to IS NULL');
  }
  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, Number(filters.limit || 50)));
  const rows = await query(
    `SELECT *
     FROM gateway_memory_facts
     ${whereSql}
     ORDER BY updated_at DESC, id DESC
     LIMIT ${limit}`,
    params
  );
  return rows.map(mapMemoryFactRow);
}

async function createMemoryRecall(data = {}) {
  const context = resolveMemoryScopeContext(data);
  const result = await query(
    `INSERT INTO gateway_memory_recalls
     (trace_id, scope_key, thread_key, source_system, client_app, query_text, recall_text, recalled_turn_ids_json, recalled_fact_ids_json, token_count, latency_ms, status, failure_reason, metadata_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      normalizeText(data.trace_id).slice(0, 128) || null,
      context.scope_key,
      context.thread_key,
      normalizeText(data.source_system || context.source_system || 'gateway').slice(0, 64),
      normalizeText(data.client_app).slice(0, 64) || null,
      normalizeText(data.query_text) || null,
      normalizeText(data.recall_text) || null,
      stringifyJson(data.recalled_turn_ids_json || []),
      stringifyJson(data.recalled_fact_ids_json || []),
      Number(data.token_count || 0),
      Number(data.latency_ms || 0),
      normalizeText(data.status || 'success').slice(0, 32) || 'success',
      truncateText(data.failure_reason, 255) || null,
      stringifyJson(data.metadata_json || {}),
    ]
  );
  const [row] = await query('SELECT * FROM gateway_memory_recalls WHERE id = ? LIMIT 1', [result.insertId]);
  return mapMemoryRecallRow(row);
}

async function ingestTurnIntoKnowledgeBase(turn, context, turnRow) {
  const url = (process.env.KNOWLEDGE_BASE_INGEST_URL || 'http://127.0.0.1:8000/api/v1/ingest').trim();
  const content = normalizeText(turn?.content_text || turn?.content_text_redacted || turnRow?.content_text_redacted);
  if (!url || !content) return null;
  const turnMetadata = parseJson(turnRow?.metadata_json, parseJson(turn?.metadata_json, {})) || {};
  const turnIndex = Math.max(0, Number(turnMetadata.turn_index || turn?.turn_index || 0));
  const stableSourceUri =
    normalizeText(turnMetadata.source_uri) || buildMemorySourceUri(context, turnIndex);
  const metadata = {
    scope_key: context.scope_key,
    thread_key: context.thread_key,
    source_system: context.source_system,
    client_app: normalizeText(context.client_app) || null,
    project_code: context.project_code === 'global' ? null : context.project_code,
    room_key: normalizeText(turnRow?.room_key) || null,
    hall_key: normalizeText(turnRow?.hall_key) || null,
    role: normalizeText(turnRow?.role) || normalizeText(turn?.role) || 'user',
    trace_id: normalizeText(turn?.trace_id || context.trace_id) || null,
    source_uri: stableSourceUri,
    section: normalizeText(turnMetadata.section) || `turn:${turnIndex}`,
    memory_turn_id: turnRow?.id || null,
  };
  const { data } = await axios.post(
    url,
    {
      content,
      collection: normalizeText(turnRow?.embedding_collection || context.collection),
      metadata,
      chunk_size: 700,
      chunk_overlap: 80,
    },
    {
      timeout: Number(process.env.KNOWLEDGE_BASE_TIMEOUT_MS || 20000),
      headers: { 'Content-Type': 'application/json' },
    }
  );
  const payload = data?.data || data || {};
  const documentId = Array.isArray(payload.document_ids) ? payload.document_ids[0] || null : null;
  if (documentId && turnRow?.id) {
    await query(
      'UPDATE gateway_memory_turns SET embedding_doc_id = ?, updated_at = NOW() WHERE id = ?',
      [documentId, turnRow.id]
    );
  }
  return {
    document_id: documentId,
    collection: normalizeText(turnRow?.embedding_collection || context.collection),
  };
}

async function ingestMemoryTurn(payload = {}) {
  const context = resolveMemoryScopeContext(payload);
  const thread = await upsertMemoryThread({
    ...payload,
    ...context,
    title: payload.thread_title || payload.title,
    summary_text: payload.thread_summary || payload.summary_text,
    client_app: payload.client_app,
    metadata_json: payload.metadata_json,
  });
  const rawTurns = Array.isArray(payload.turns) && payload.turns.length
    ? payload.turns
    : payload.role && (payload.content_text || payload.content_text_redacted)
      ? [payload]
      : [];
  if (shouldReplaceThreadHistory(payload, rawTurns)) {
    await replaceThreadHistory(context.scope_key, context.thread_key);
  }
  const insertedTurns = [];
  for (let index = 0; index < rawTurns.length; index += 1) {
    const item = rawTurns[index];
    const itemMetadata = parseJson(item.metadata_json, {});
    const turnIndex = Number.isFinite(Number(item.turn_index))
      ? Number(item.turn_index)
      : index;
    const inserted = await createMemoryTurn(
      {
        ...payload,
        ...item,
        scope_key: context.scope_key,
        thread_key: context.thread_key,
        source_system: item.source_system || payload.source_system || context.source_system,
        client_app: item.client_app || payload.client_app,
        trace_id: item.trace_id || payload.trace_id,
        turn_index: turnIndex,
        metadata_json: {
          ...itemMetadata,
          turn_index: turnIndex,
          source_uri:
            normalizeText(itemMetadata.source_uri) || buildMemorySourceUri(context, turnIndex),
        },
      },
      thread
    );
    insertedTurns.push(inserted);
  }

  const explicitFacts = Array.isArray(payload.facts) ? payload.facts : [];
  const inferredFacts =
    payload.infer_facts === false
      ? []
      : inferMemoryFactsFromTurns(rawTurns, {
          scope_key: context.scope_key,
          subject_text: context.scope_key,
        });
  const factSeed = [...explicitFacts, ...inferredFacts];
  const insertedFacts = [];
  for (const fact of factSeed) {
    const sourceTurn =
      insertedTurns.find((item) => normalizeText(item.role) === 'user') ||
      insertedTurns[0] ||
      null;
    const inserted = await upsertTemporalFact({
      ...fact,
      scope_key: context.scope_key,
      thread_key: context.thread_key,
      source_turn_id: fact.source_turn_id || sourceTurn?.id || null,
    });
    if (inserted) insertedFacts.push(inserted);
  }

  const kbResults = [];
  if (payload.sync_to_kb !== false) {
    for (let index = 0; index < insertedTurns.length; index += 1) {
      const turn = rawTurns[index];
      const turnRow = insertedTurns[index];
      try {
        const kbResult = await ingestTurnIntoKnowledgeBase(
          turn,
          {
            ...context,
            client_app: payload.client_app,
            trace_id: payload.trace_id,
          },
          turnRow
        );
        if (kbResult) kbResults.push(kbResult);
      } catch (error) {
        kbResults.push({
          error: error.message,
          turn_id: turnRow?.id || null,
        });
      }
    }
  }

  await query(
    'UPDATE gateway_memory_threads SET last_message_at = NOW(), updated_at = NOW() WHERE id = ?',
    [thread.id]
  );

  return {
    thread,
    turns: insertedTurns,
    facts: insertedFacts,
    kb_results: kbResults,
  };
}

async function searchCollection(queryText, collection, filters, options = {}) {
  const url = (process.env.KNOWLEDGE_BASE_SEARCH_URL || 'http://127.0.0.1:8000/api/v1/search').trim();
  const { data } = await axios.post(
    url,
    {
      query: queryText,
      collection,
      top_k: Math.max(1, Number(options.top_k || 5)),
      retrieval_mode: normalizeText(options.retrieval_mode) || 'hybrid',
      candidate_k: Math.max(1, Number(options.candidate_k || 12)),
      rerank_top_k: Math.max(1, Number(options.rerank_top_k || 8)),
      query_mode: normalizeText(options.query_mode) || 'auto',
      filters,
    },
    {
      timeout: Number(process.env.KNOWLEDGE_BASE_TIMEOUT_MS || 20000),
      headers: { 'Content-Type': 'application/json' },
    }
  );
  const payload = data?.data || data || {};
  return Array.isArray(payload.results) ? payload.results : [];
}

async function searchMemory(input = {}) {
  const startedAt = Date.now();
  const context = resolveMemoryScopeContext(input);
  const queryText = normalizeText(input.query);
  const facts = await listMemoryFacts({
    scope_key: context.scope_key,
    active_only: true,
    limit: Number(input.fact_limit || 8),
  });

  let kbResults = [];
  let usedSqlFallback = false;
  if (queryText) {
    const collections = Array.isArray(input.collections) && input.collections.length
      ? input.collections.map((item) => normalizeText(item)).filter(Boolean)
      : [context.collection];
    const filters = {
      scope_key: context.scope_key,
    };
    if (context.project_code !== 'global') {
      filters.project_code = context.project_code;
    }
    if (normalizeText(input.room_key)) {
      filters.room_key = normalizeText(input.room_key);
    }
    for (const collection of collections) {
      try {
        const results = await searchCollection(queryText, collection, filters, input);
        kbResults.push(...results);
      } catch {
        // 回退到 SQL 最新对话，不阻塞主链路
      }
    }
    if (!kbResults.length) {
      kbResults = await searchTurnsBySqlFallback(queryText, context, input);
      usedSqlFallback = kbResults.length > 0;
    }
  }

  kbResults = dedupeMemoryKbResults(kbResults)
    .filter(Boolean)
    .sort((left, right) => Number(right.score || 0) - Number(left.score || 0))
    .slice(0, Math.max(3, Number(input.top_k || 5)));

  const turnIds = kbResults
    .map((item) => Number(item?.metadata?.memory_turn_id || 0))
    .filter((item) => Number.isFinite(item) && item > 0);

  let turns = [];
  if (turnIds.length) {
    const placeholders = turnIds.map(() => '?').join(', ');
    const rows = await query(
      `SELECT *
       FROM gateway_memory_turns
       WHERE id IN (${placeholders})
       ORDER BY created_at DESC, id DESC`,
      turnIds
    );
    turns = rows.map(mapMemoryTurnRow);
  }
  if (!turns.length) {
    const rows = await query(
      `SELECT *
       FROM gateway_memory_turns
       WHERE scope_key = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [context.scope_key, Math.max(3, Number(input.top_k || 5))]
    );
    turns = rows.map(mapMemoryTurnRow);
  }

  const recallText = buildMemoryRecallText({
    facts,
    turns,
    max_recall_tokens: Number(input.max_recall_tokens || DEFAULT_MEMORY_POLICY.max_recall_tokens),
  });

  let recall = null;
  if (input.persist_recall !== false) {
    recall = await createMemoryRecall({
      ...context,
      trace_id: input.trace_id,
      client_app: input.client_app,
      query_text: queryText,
      recall_text: recallText,
      recalled_turn_ids_json: turns.map((item) => item.id),
      recalled_fact_ids_json: facts.map((item) => item.id),
      token_count: recallText ? Math.ceil(recallText.length / 4) : 0,
      latency_ms: Date.now() - startedAt,
      metadata_json: {
        collection: context.collection,
        kb_hit_count: kbResults.length,
        fallback_mode: usedSqlFallback ? 'sql_like' : null,
      },
    });
  }

  return {
    scope_key: context.scope_key,
    thread_key: context.thread_key,
    collection: context.collection,
    facts,
    turns,
    kb_results: kbResults,
    recall_text: recallText,
    recall,
  };
}

async function getTraceMemory(traceId) {
  const [turnRows, recallRows, factRows] = await Promise.all([
    query(
      `SELECT *
       FROM gateway_memory_turns
       WHERE trace_id = ?
       ORDER BY created_at ASC, id ASC`,
      [normalizeText(traceId)]
    ),
    query(
      `SELECT *
       FROM gateway_memory_recalls
       WHERE trace_id = ?
       ORDER BY created_at ASC, id ASC`,
      [normalizeText(traceId)]
    ),
    query(
      `SELECT f.*
       FROM gateway_memory_facts f
       INNER JOIN gateway_memory_turns t ON t.id = f.source_turn_id
       WHERE t.trace_id = ?
       ORDER BY f.created_at ASC, f.id ASC`,
      [normalizeText(traceId)]
    ),
  ]);
  return {
    memory_turns: turnRows.map(mapMemoryTurnRow),
    memory_recalls: recallRows.map(mapMemoryRecallRow),
    memory_facts: factRows.map(mapMemoryFactRow),
  };
}

module.exports = {
  listMemoryPolicies,
  upsertMemoryPolicy,
  resolveMemoryPolicy,
  listMemoryThreads,
  getMemoryThread,
  listMemoryFacts,
  ingestMemoryTurn,
  searchMemory,
  createMemoryRecall,
  getTraceMemory,
};
