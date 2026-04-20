require('dotenv').config();

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const mysql = require('mysql2/promise');
const winston = require('winston');

const LOG_DIR = path.join(__dirname, '../logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: path.join(LOG_DIR, 'egress-proxy.log') }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

const PORT = Number(process.env.EGRESS_PROXY_PORT || 8899);
const MODE = (process.env.EGRESS_PROXY_MODE || 'observe').toLowerCase();
const FALLBACK_PROXY = String(process.env.EGRESS_FALLBACK_PROXY || '').trim();
const ALLOWLIST = (process.env.EGRESS_ALLOWLIST || '127.0.0.1,localhost,::1')
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);
const LLM_HOST_PATTERNS = (process.env.EGRESS_LLM_HOST_PATTERNS || [
  'api.openai.com',
  'chat.openai.com',
  'chatgpt.com',
  'ab.chatgpt.com',
  'api.anthropic.com',
  'api.moonshot.ai',
  'api.moonshot.cn',
  'api.z.ai',
  'openrouter.ai',
  'dashscope.aliyuncs.com',
  'generativelanguage.googleapis.com',
  'ollama.com',
].join(','))
  .split(',')
  .map((item) => item.trim().toLowerCase())
  .filter(Boolean);

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT) || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASS || '',
      database: process.env.DB_NAME || 'ai_gateway',
      charset: 'utf8mb4',
      timezone: '+08:00',
      ssl: false,
      insecureAuth: true,
      waitForConnections: true,
      connectionLimit: 8,
      queueLimit: 0,
      connectTimeout: 30000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
}

function normalizeHost(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
}

function hostnameMatches(host, pattern) {
  if (host === pattern) return true;
  return host.endsWith(`.${pattern}`);
}

function classifyHost(hostname) {
  const host = normalizeHost(hostname);
  const matchedPattern = LLM_HOST_PATTERNS.find((pattern) => hostnameMatches(host, pattern));
  return {
    host,
    isLlmHost: Boolean(matchedPattern),
    matchedPattern: matchedPattern || null,
    isAllowlisted: ALLOWLIST.some((pattern) => hostnameMatches(host, pattern)),
  };
}

function deriveClientName(headers = {}) {
  const explicit = headers['x-ai-gateway-client'] || headers['x-client-name'];
  if (explicit) {
    return String(Array.isArray(explicit) ? explicit[0] : explicit).slice(0, 64);
  }
  const ua = String(headers['user-agent'] || '');
  const uaLower = ua.toLowerCase();
  if (uaLower.includes('cursor')) return 'cursor';
  if (uaLower.includes('openclaw')) return 'openclaw';
  if (uaLower.includes('hermes')) return 'hermes';
  if (uaLower.includes('codex')) return 'codex';
  if (uaLower.includes('python-urllib')) return 'python-urllib';
  return ua.slice(0, 64) || 'unknown';
}

async function logEvent(payload) {
  logger.info('egress event', payload);
  try {
    await getPool().execute(
      `INSERT INTO gateway_egress_events
       (event_type, client_name, method, target_scheme, target_host, target_port, target_path,
        decision, llm_host, matched_pattern, user_agent, trace_id, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
      [
        payload.event_type,
        payload.client_name,
        payload.method,
        payload.target_scheme,
        payload.target_host,
        payload.target_port,
        payload.target_path,
        payload.decision,
        payload.llm_host ? 1 : 0,
        payload.matched_pattern,
        payload.user_agent || null,
        payload.trace_id || null,
        JSON.stringify(payload.detail_json || {}),
      ]
    );
  } catch (error) {
    logger.error('failed to log egress event', { error: error.message });
  }
}

function shouldBlock(hostname) {
  const { isLlmHost, isAllowlisted } = classifyHost(hostname);
  return MODE === 'enforce' && isLlmHost && !isAllowlisted;
}

function parseConnectTarget(reqUrl = '') {
  const [host, portRaw] = String(reqUrl).split(':');
  return {
    host: normalizeHost(host),
    port: Number(portRaw || 443),
  };
}

function writeBlocked(res, message) {
  res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(message);
}

function buildPacResponse() {
  const llmHostsJson = JSON.stringify(LLM_HOST_PATTERNS);
  const fallbackChain = FALLBACK_PROXY
    ? `PROXY 127.0.0.1:${PORT}; PROXY ${FALLBACK_PROXY}; DIRECT`
    : `PROXY 127.0.0.1:${PORT}; DIRECT`;
  const defaultChain = FALLBACK_PROXY ? `PROXY ${FALLBACK_PROXY}; DIRECT` : 'DIRECT';
  return `function FindProxyForURL(url, host) {
  var llmHosts = ${llmHostsJson};
  for (var i = 0; i < llmHosts.length; i += 1) {
    if (dnsDomainIs(host, llmHosts[i]) || host === llmHosts[i]) {
      return "${fallbackChain}";
    }
  }
  return "${defaultChain}";
}
`;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'gateway-egress-proxy',
      mode: MODE,
      port: PORT,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && req.url === '/proxy.pac') {
    res.writeHead(200, {
      'Content-Type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    res.end(buildPacResponse());
    return;
  }

  let targetUrl;
  try {
    targetUrl = new URL(req.url);
  } catch {
    writeBlocked(res, 'Invalid proxy request URL');
    return;
  }

  const method = req.method || 'GET';
  const targetHost = normalizeHost(targetUrl.hostname);
  const targetPort = Number(targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80));
  const targetPath = `${targetUrl.pathname}${targetUrl.search}`;
  const clientName = deriveClientName(req.headers);
  const traceId = req.headers['x-trace-id'] || null;
  const { isLlmHost, matchedPattern, isAllowlisted } = classifyHost(targetHost);
  const decision = shouldBlock(targetHost) ? 'blocked' : 'allowed';

  await logEvent({
    event_type: 'http_request',
    client_name: clientName,
    method,
    target_scheme: targetUrl.protocol.replace(':', ''),
    target_host: targetHost,
    target_port: targetPort,
    target_path: targetPath.slice(0, 255),
    decision,
    llm_host: isLlmHost,
    matched_pattern: matchedPattern,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 255),
    trace_id: Array.isArray(traceId) ? traceId[0] : traceId,
    detail_json: {
      allowlisted: isAllowlisted,
    },
  });

  if (decision === 'blocked') {
    writeBlocked(res, `Direct LLM access blocked by gateway-egress-proxy: ${targetHost}`);
    return;
  }

  const transport = targetUrl.protocol === 'https:' ? https : http;
  const upstreamReq = transport.request(
    {
      hostname: targetHost,
      port: targetPort,
      path: targetPath,
      method,
      headers: req.headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', (error) => {
    logger.error('upstream http proxy error', { error: error.message, host: targetHost });
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Proxy upstream error: ${error.message}`);
  });

  req.pipe(upstreamReq);
});

server.on('connect', async (req, clientSocket, head) => {
  const { host, port } = parseConnectTarget(req.url);
  const clientName = deriveClientName(req.headers);
  const traceId = req.headers['x-trace-id'] || null;
  const { isLlmHost, matchedPattern, isAllowlisted } = classifyHost(host);
  const decision = shouldBlock(host) ? 'blocked' : 'tunneled';

  await logEvent({
    event_type: 'connect_tunnel',
    client_name: clientName,
    method: 'CONNECT',
    target_scheme: 'https',
    target_host: host,
    target_port: port,
    target_path: '/',
    decision,
    llm_host: isLlmHost,
    matched_pattern: matchedPattern,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 255),
    trace_id: Array.isArray(traceId) ? traceId[0] : traceId,
    detail_json: {
      allowlisted: isAllowlisted,
    },
  });

  if (decision === 'blocked') {
    clientSocket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    clientSocket.destroy();
    return;
  }

  const upstreamSocket = net.connect(port, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.on('error', (error) => {
    logger.error('upstream connect error', { error: error.message, host, port });
    clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    clientSocket.destroy();
  });
});

server.on('clientError', (error, socket) => {
  logger.error('client error', { error: error.message });
  socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(PORT, () => {
  logger.info(`gateway-egress-proxy started on ${PORT}`, { mode: MODE });
  console.log(`🛡️  gateway-egress-proxy listening on http://127.0.0.1:${PORT} (${MODE})`);
});
