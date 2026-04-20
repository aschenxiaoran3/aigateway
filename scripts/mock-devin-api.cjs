#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');

const PORT = Number(process.env.PORT || 3199);
const HOST = process.env.HOST || '127.0.0.1';
const STATE_DIR = process.env.MOCK_DEVIN_STATE_DIR || path.join(__dirname, '..', 'storage', 'mock-devin');
const VALID_API_KEY = process.env.MOCK_DEVIN_API_KEY || 'mock-devin-key';

fs.mkdirSync(STATE_DIR, { recursive: true });

const state = {
  attachments: [],
  sessions: [],
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

function requireAuth(req, res) {
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${VALID_API_KEY}`) return true;
  sendJson(res, 401, { error: 'unauthorized' });
  return false;
}

function collectRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function persistState() {
  fs.writeFileSync(path.join(STATE_DIR, 'state.json'), JSON.stringify(state, null, 2), 'utf8');
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok', service: 'mock-devin-api', attachments: state.attachments.length, sessions: state.sessions.length });
    }

    if (!requireAuth(req, res)) {
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/attachments') {
      const body = await collectRequestBody(req);
      const attachmentId = `att_${state.attachments.length + 1}`;
      const attachment = {
        id: attachmentId,
        size_bytes: body.length,
        content_type: String(req.headers['content-type'] || ''),
        created_at: new Date().toISOString(),
      };
      state.attachments.push(attachment);
      persistState();
      return sendText(res, 200, `http://${HOST}:${PORT}/attachments/${attachmentId}`);
    }

    if (req.method === 'POST' && url.pathname === '/v1/sessions') {
      const body = JSON.parse(String(await collectRequestBody(req) || '{}') || '{}');
      const sessionId = `sess_${state.sessions.length + 1}`;
      const session = {
        session_id: sessionId,
        status: 'blocked',
        status_enum: 'WAITING_ON_USER',
        url: `http://${HOST}:${PORT}/sessions/${sessionId}`,
        is_new_session: true,
        title: body.title || '',
        prompt: body.prompt || '',
        tags: Array.isArray(body.tags) ? body.tags : [],
        knowledge_ids: Array.isArray(body.knowledge_ids) ? body.knowledge_ids : [],
        playbook_id: body.playbook_id || null,
        max_acu_limit: body.max_acu_limit || null,
        unlisted: Boolean(body.unlisted),
        created_at: new Date().toISOString(),
      };
      state.sessions.push(session);
      persistState();
      return sendJson(res, 200, {
        session_id: session.session_id,
        url: session.url,
        is_new_session: true,
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/v1/sessions/')) {
      const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '');
      const session = state.sessions.find((item) => item.session_id === sessionId);
      if (!session) {
        return sendJson(res, 404, { error: 'not_found' });
      }
      return sendJson(res, 200, {
        session_id: session.session_id,
        status: session.status,
        status_enum: session.status_enum,
        url: session.url,
        title: session.title,
        created_at: session.created_at,
      });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/attachments/')) {
      const attachmentId = decodeURIComponent(url.pathname.split('/').pop() || '');
      const attachment = state.attachments.find((item) => item.id === attachmentId);
      if (!attachment) {
        return sendJson(res, 404, { error: 'not_found' });
      }
      return sendJson(res, 200, attachment);
    }

    if (req.method === 'GET' && url.pathname.startsWith('/sessions/')) {
      const sessionId = decodeURIComponent(url.pathname.split('/').pop() || '');
      const session = state.sessions.find((item) => item.session_id === sessionId);
      if (!session) {
        return sendText(res, 404, 'session not found');
      }
      return sendText(
        res,
        200,
        `Mock Devin Session\n\nSession: ${session.session_id}\nTitle: ${session.title}\nStatus: ${session.status}\nStatus enum: ${session.status_enum}\n`
      );
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || 'mock_server_error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`mock-devin-api listening on http://${HOST}:${PORT}`);
  console.log(`state dir: ${STATE_DIR}`);
  console.log(`api key: ${VALID_API_KEY}`);
});
