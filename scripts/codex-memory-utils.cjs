const fs = require('fs');
const os = require('os');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const STORAGE_ROOT = path.join(PROJECT_ROOT, 'storage/codex-memory');
const RAW_ROOT = path.join(STORAGE_ROOT, 'raw');
const DAILY_ROOT = path.join(STORAGE_ROOT, 'daily');
const BRIEF_PATH = path.join(STORAGE_ROOT, 'CODEX_BRIEF.md');
const STATE_PATH = path.join(STORAGE_ROOT, 'import-state.json');
const DEFAULT_ARCHIVE_DIR = path.join(os.homedir(), '.codex', 'archived_sessions');
const DEFAULT_PROJECT_LABEL = 'ai-platform';

function normalizeText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function truncateText(value, limit = 240) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return '';
  return text.length > limit ? `${text.slice(0, Math.max(0, limit - 1))}...` : text;
}

function ensureDirSecure(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch {
    // ignore chmod on unsupported filesystems
  }
}

function writeFileSecure(filePath, content) {
  ensureDirSecure(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // ignore chmod on unsupported filesystems
  }
}

function readJsonFile(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function toDateKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
}

function textPartsToString(content = []) {
  if (typeof content === 'string') return normalizeText(content);
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return normalizeText(item.text || item.input_text || item.output_text || item.content || '');
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function tryParseFunctionArgs(text) {
  const raw = normalizeText(text);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function messageMentionsProject(text, options = {}) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) return false;
  const projectLabel = normalizeText(options.projectLabel || DEFAULT_PROJECT_LABEL).toLowerCase();
  const projectRoot = normalizeText(options.projectRoot || PROJECT_ROOT).toLowerCase();
  const needles = [
    projectLabel,
    'projects/ai-platform',
    projectRoot,
    '/ai-platform/',
  ].filter(Boolean);
  return needles.some((needle) => normalized.includes(needle));
}

function extractMeaningfulStatements(text) {
  const raw = normalizeText(text);
  if (
    /AGENTS\.md instructions/i.test(raw) ||
    /<INSTRUCTIONS>/i.test(raw) ||
    (/This folder is home/i.test(raw) && /Before doing anything else/i.test(raw))
  ) {
    return [];
  }
  return normalizeText(text)
    .split(/[\n\r。！？!?]+/g)
    .map((item) =>
      item
        .replace(/\s+/g, ' ')
        .replace(/^[-*]\s*/, '')
        .replace(/^\d+[、.]\s*/, '')
        .trim()
    )
    .filter(Boolean);
}

function extractCodexSessionFromText(text, options = {}) {
  const lines = String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const session = {
    id: '',
    timestamp: '',
    date_key: '',
    cwd: '',
    source_file: normalizeText(options.sourceFile),
    turns: [],
    commentary: [],
    workdirs: [],
    related_reasons: [],
    related_score: 0,
    title: '',
  };

  for (const line of lines) {
    const record = parseJsonLine(line);
    if (!record || typeof record !== 'object') continue;
    if (record.type === 'session_meta') {
      const payload = record.payload || {};
      session.id = normalizeText(payload.id);
      session.timestamp = normalizeText(payload.timestamp || record.timestamp);
      session.date_key = toDateKey(session.timestamp || record.timestamp);
      session.cwd = normalizeText(payload.cwd);
      continue;
    }

    const payload = record.payload || {};
    if (record.type === 'response_item' && payload.type === 'message') {
      const role = normalizeText(payload.role).toLowerCase();
      if (role !== 'user' && role !== 'assistant') continue;
      const textValue = textPartsToString(payload.content);
      if (!textValue) continue;
      session.turns.push({
        role,
        text: textValue,
        timestamp: normalizeText(record.timestamp),
        phase: normalizeText(payload.phase),
      });
      continue;
    }

    if (record.type === 'event_msg' && payload.type === 'agent_message') {
      const commentaryText = normalizeText(payload.message);
      if (!commentaryText) continue;
      session.commentary.push({
        text: commentaryText,
        timestamp: normalizeText(record.timestamp),
        phase: normalizeText(payload.phase) || 'commentary',
      });
      continue;
    }

    if (record.type === 'response_item' && payload.type === 'function_call') {
      const args = tryParseFunctionArgs(payload.arguments);
      const workdir = normalizeText(args.workdir);
      if (workdir) {
        session.workdirs.push(workdir);
      }
    }
  }

  const reasons = [];
  const projectRoot = normalizeText(options.projectRoot || PROJECT_ROOT);
  if (session.cwd && session.cwd.startsWith(projectRoot)) {
    reasons.push('session_cwd');
  }
  if (session.workdirs.some((item) => normalizeText(item).startsWith(projectRoot))) {
    reasons.push('tool_workdir');
  }
  const userTexts = session.turns.filter((item) => item.role === 'user').map((item) => item.text);
  const assistantTexts = session.turns.filter((item) => item.role === 'assistant').map((item) => item.text);
  if ([...userTexts, ...assistantTexts].some((item) => messageMentionsProject(item, options))) {
    reasons.push('message_match');
  }

  session.related_reasons = Array.from(new Set(reasons));
  session.related_score = session.related_reasons.length;
  const preferredTitle =
    [...session.turns, ...session.commentary]
      .flatMap((item) => extractMeaningfulStatements(item.text || ''))
      .find((statement) => !isNoiseStatement(statement)) ||
    userTexts[0] ||
    assistantTexts[0] ||
    session.commentary[0]?.text ||
    session.id;
  session.title = truncateText(preferredTitle, 120);
  if (!session.id && session.source_file) {
    session.id = path.basename(session.source_file, '.jsonl').replace(/^rollout-/, '');
  }
  if (!session.date_key) {
    session.date_key = toDateKey(session.timestamp);
  }
  return session;
}

function sessionRelatesToProject(session, options = {}) {
  const manualMap = readJsonFile(options.manualMapPath || path.join(STORAGE_ROOT, 'manual-session-map.json'), {});
  if (manualMap[session.id] === true) {
    return { related: true, reasons: [...session.related_reasons, 'manual_map'] };
  }
  return {
    related: session.related_score > 0,
    reasons: session.related_reasons,
  };
}

function listArchivedSessionFiles(archiveDir = DEFAULT_ARCHIVE_DIR) {
  if (!fs.existsSync(archiveDir)) return [];
  return fs
    .readdirSync(archiveDir)
    .filter((item) => item.endsWith('.jsonl'))
    .map((item) => path.join(archiveDir, item))
    .sort();
}

function loadStoredSessions(rawRoot = RAW_ROOT, options = {}) {
  if (!fs.existsSync(rawRoot)) return [];
  const sessions = [];
  for (const day of fs.readdirSync(rawRoot).sort()) {
    const dayDir = path.join(rawRoot, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const fileName of fs.readdirSync(dayDir).filter((item) => item.endsWith('.jsonl')).sort()) {
      const filePath = path.join(dayDir, fileName);
      const session = extractCodexSessionFromText(fs.readFileSync(filePath, 'utf8'), {
        ...options,
        sourceFile: filePath,
      });
      sessions.push(session);
    }
  }
  return sessions.sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')));
}

function renderDailyMarkdown(dateKey, sessions = []) {
  const lines = [
    `# Codex Project Daily Log - ${dateKey}`,
    '',
    `- Project: ${DEFAULT_PROJECT_LABEL}`,
    `- Session count: ${sessions.length}`,
    '',
  ];
  for (const session of sessions.sort((left, right) => String(left.timestamp || '').localeCompare(String(right.timestamp || '')))) {
    lines.push(`## ${session.title || session.id}`);
    lines.push('');
    lines.push(`- Session ID: ${session.id}`);
    lines.push(`- Source: ${session.source_file}`);
    lines.push(`- Match reasons: ${session.related_reasons.join(', ') || 'unknown'}`);
    lines.push(`- Turns: ${session.turns.length}, commentary: ${session.commentary.length}`);
    lines.push('');
    lines.push('### User');
    const userStatements = session.turns
      .filter((item) => item.role === 'user')
      .flatMap((item) => extractMeaningfulStatements(item.text))
      .filter((item) => !isNoiseStatement(item))
      .slice(0, 8);
    if (userStatements.length) {
      userStatements.forEach((item) => lines.push(`- ${truncateText(item, 360)}`));
    } else {
      lines.push('- (none)');
    }
    lines.push('');
    lines.push('### Assistant');
    const assistantStatements = session.turns
      .filter((item) => item.role === 'assistant')
      .flatMap((item) => extractMeaningfulStatements(item.text))
      .filter((item) => !isNoiseStatement(item))
      .slice(0, 8);
    if (assistantStatements.length) {
      assistantStatements.forEach((item) => lines.push(`- ${truncateText(item, 360)}`));
    } else {
      lines.push('- (none)');
    }
    if (session.commentary.length) {
      lines.push('');
      lines.push('### Commentary');
      session.commentary.slice(0, 4).forEach((item) => lines.push(`- ${truncateText(item.text, 280)}`));
    }
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function isNoiseStatement(statement) {
  const text = normalizeText(statement);
  if (!text) return true;
  return [
    /^#+\s*/,
    /^<INSTRUCTIONS>$/i,
    /AGENTS\.md/i,
    /SOUL\.md/i,
    /USER\.md/i,
    /MEMORY\.md/i,
    /HEARTBEAT\.md/i,
    /This folder is home/i,
    /Treat it that way/i,
    /If `BOOTSTRAP\.md` exists/i,
    /that's your birth certificate/i,
    /Don't ask permission/i,
    /Just do it/i,
    /You wake up fresh each session/i,
    /These files are your continuity/i,
    /Capture what matters/i,
    /Skip the secrets unless asked/i,
    /ONLY load in main session/i,
    /DO NOT load in shared contexts/i,
    /This is for \*\*security\*\*/i,
    /Write significant events/i,
    /thoughts, decisions, opinions, lessons learned/i,
    /Mental notes.*don't survive/i,
    /future-you/i,
    /Text > Brain/i,
    /Don't exfiltrate private data/i,
    /Don't run destructive commands without asking/i,
    /recoverable beats gone forever/i,
    /Before doing anything else/i,
    /If in MAIN SESSION/i,
    /Daily notes:/i,
    /Long-term:/i,
    /Your Workspace/i,
    /What to call them/i,
    /My request for Codex:/i,
    /Read `memory\/YYYY-MM-DD\.md`/i,
    /curated memory/i,
    /memory is limited/i,
    /heartbeat-state\.json/i,
    /Track your checks/i,
    /Read through recent `memory/i,
    /Read and organize memory files/i,
    /remember this/i,
    /memory\/YYYY-MM-DD/i,
  ].some((pattern) => pattern.test(text));
}

function pickBriefLines(sessions, options = {}) {
  const keywords = Array.isArray(options.keywords) ? options.keywords : [];
  const role = normalizeText(options.role);
  const output = [];
  const seen = new Set();
  const orderedSessions = [...sessions].sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
  for (const session of orderedSessions) {
    for (const turn of session.turns) {
      if (role && normalizeText(turn.role) !== role) continue;
      const statements = extractMeaningfulStatements(turn.text);
      for (const statement of statements) {
        if (isNoiseStatement(statement)) continue;
        const matched = keywords.length === 0 || keywords.some((keyword) => statement.toLowerCase().includes(String(keyword).toLowerCase()));
        if (!matched) continue;
        const line = truncateText(statement, 180);
        if (seen.has(line)) continue;
        seen.add(line);
        output.push(`- ${line}`);
        if (output.length >= Number(options.limit || 6)) {
          return output;
        }
      }
    }
  }
  return output;
}

function buildCodexBrief(sessions = []) {
  const orderedSessions = [...sessions].sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || '')));
  const latest = orderedSessions[0] || null;
  const currentGoals = pickBriefLines(orderedSessions, {
    role: 'user',
    keywords: ['希望', '需要', '实现', '支持', '计划', '落地', '长期记忆', 'codex', '日志', '平台'],
    limit: 5,
  });
  const completed = pickBriefLines(orderedSessions, {
    role: 'assistant',
    keywords: ['已', '完成', '新增', '补齐', '实现', '接入', '通过', '落地', '创建'],
    limit: 5,
  });
  const risks = pickBriefLines(orderedSessions, {
    keywords: ['未', '待', '风险', '后续', '下一步', '限制', 'TODO', 'memory', 'trace'],
    limit: 6,
  });
  const decisions = pickBriefLines(orderedSessions, {
    keywords: ['采用', '固定', '默认', '优先', '一期', '不引入', '复用', '按项目', '按 key', '混合记忆', 'brief'],
    limit: 6,
  });

  const nextChecks = [
    '- 先读 `storage/codex-memory/CODEX_BRIEF.md`。',
    '- 再看最近两份 `storage/codex-memory/daily/*.md`。',
  ];
  if (latest?.source_file) {
    nextChecks.push(`- 最近一次原始会话：\`${latest.source_file}\``);
  }
  if (risks.length) {
    nextChecks.push(...risks.slice(0, 2));
  }

  const lines = [
    '# CODEX_BRIEF',
    '',
    `- Project: ${DEFAULT_PROJECT_LABEL}`,
    `- Generated at: ${new Date().toISOString()}`,
    `- Sessions indexed: ${sessions.length}`,
    '',
    '## 当前项目目标',
    ...(currentGoals.length ? currentGoals : ['- 近期目标暂未从历史会话里提炼出来，先看最近 daily log。']),
    '',
    '## 最近已完成',
    ...(completed.length ? completed : ['- 尚未从历史会话中归纳出稳定的完成项，请结合最近 daily log 判断。']),
    '',
    '## 当前未完成/风险',
    ...(risks.length ? risks : ['- 暂未提炼出明确风险，但建议先复查最近一轮对话的未尽事项。']),
    '',
    '## 关键决策与偏好',
    ...(decisions.length ? decisions : ['- 暂未提炼出稳定偏好，建议先看最近 daily log 与用户最新要求。']),
    '',
    '## 下次开线程先查什么',
    ...nextChecks,
    '',
  ];
  return `${lines.join('\n').trim()}\n`;
}

async function syncSessionToControlPlane(session, options = {}) {
  const baseUrl = normalizeText(
    options.controlPlaneBaseUrl ||
    process.env.CONTROL_PLANE_BASE_URL ||
    'http://127.0.0.1:3104'
  );
  const turns = session.turns.map((item) => ({
    role: item.role,
    content_text: item.text,
    summary_text: truncateText(item.text, 240),
    metadata_json: {
      phase: item.phase || null,
      imported_from: 'codex_archived_sessions',
    },
  }));
  const payloadBody = {
    source_system: 'codex',
    client_app: 'codex',
    scope_key: 'workspace:ai-platform',
    thread_key: `codex:${session.id}`,
    project_code: DEFAULT_PROJECT_LABEL,
    sync_to_kb: options.syncToKb === true,
    title: session.title,
    metadata_json: {
      imported_from: 'codex_archived_sessions',
      source_file: session.source_file,
      session_cwd: session.cwd,
      related_reasons: session.related_reasons,
    },
    turns,
  };

  if (!options.directStore && baseUrl) {
    try {
      const url = `${baseUrl.replace(/\/$/, '')}/api/v1/memory/ingest-turn`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payloadBody),
      });
      if (!response.ok) {
        throw new Error(`control-plane sync failed with status ${response.status}`);
      }
      const payload = await response.json();
      if (payload && payload.success === false) {
        throw new Error(normalizeText(payload.error) || 'control-plane sync returned success=false');
      }
      return payload;
    } catch (error) {
      if (options.disableDirectFallback === true) {
        throw error;
      }
    }
  }

  const memoryStore = require(path.join(PROJECT_ROOT, 'control-plane/src/memory/store.js'));
  const result = await memoryStore.ingestMemoryTurn(payloadBody);
  return { success: true, data: result, via: 'direct_store' };
}

async function closeControlPlaneSyncResources() {
  try {
    const db = require(path.join(PROJECT_ROOT, 'control-plane/src/db/mysql.js'));
    if (typeof db.closePool === 'function') {
      await db.closePool();
    }
  } catch {
    // Ignore cleanup failures in one-shot sync scripts.
  }
}

module.exports = {
  PROJECT_ROOT,
  STORAGE_ROOT,
  RAW_ROOT,
  DAILY_ROOT,
  BRIEF_PATH,
  STATE_PATH,
  DEFAULT_ARCHIVE_DIR,
  ensureDirSecure,
  writeFileSecure,
  readJsonFile,
  listArchivedSessionFiles,
  extractCodexSessionFromText,
  sessionRelatesToProject,
  renderDailyMarkdown,
  loadStoredSessions,
  buildCodexBrief,
  syncSessionToControlPlane,
  closeControlPlaneSyncResources,
  toDateKey,
  truncateText,
};
