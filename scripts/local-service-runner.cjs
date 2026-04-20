#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const projectRoot = path.resolve(__dirname, '..');
const nodePath = process.execPath;
const pythonPath = path.join(projectRoot, 'knowledge-base/.venv/bin/python');
const sharedEnvPath = path.join(projectRoot, '.env.shared.local');

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const values = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }
    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const sharedEnv = parseEnvFile(sharedEnvPath);

function envValue(name, fallback = '') {
  const value = process.env[name] ?? sharedEnv[name];
  return value == null || value === '' ? fallback : value;
}

function envPort(name, fallback) {
  const raw = envValue(name, String(fallback));
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const adminUiPort = envPort('ADMIN_UI_PORT', 3000);
const aiGatewayPort = envPort('AI_GATEWAY_PORT', 3001);
const controlPlanePort = envPort('CONTROL_PLANE_PORT', 3104);
const knowledgeBasePort = envPort('KNOWLEDGE_BASE_PORT', 8000);

const SERVICES = {
  'admin-ui': {
    label: 'Admin UI',
    cwd: path.join(projectRoot, 'admin-ui'),
    command: [nodePath, path.join(projectRoot, 'admin-ui/scripts/start-dev.cjs')],
    port: adminUiPort,
    healthUrl: `http://127.0.0.1:${adminUiPort}/`,
    startupTimeoutMs: 45000,
    env: {
      BROWSER: 'none',
      ADMIN_UI_PORT: String(adminUiPort),
    },
  },
  'ai-gateway': {
    label: 'AI Gateway',
    cwd: path.join(projectRoot, 'ai-gateway'),
    command: [nodePath, path.join(projectRoot, 'ai-gateway/src/index.js')],
    port: aiGatewayPort,
    healthUrl: `http://127.0.0.1:${aiGatewayPort}/health`,
    startupTimeoutMs: 45000,
    env: {
      PORT: String(aiGatewayPort),
    },
  },
  'control-plane': {
    label: 'Control Plane',
    cwd: path.join(projectRoot, 'control-plane'),
    command: [nodePath, path.join(projectRoot, 'control-plane/src/index.js')],
    port: controlPlanePort,
    healthUrl: `http://127.0.0.1:${controlPlanePort}/health`,
    startupTimeoutMs: 45000,
    env: {
      PORT: String(controlPlanePort),
    },
  },
  'knowledge-base': {
    label: 'Knowledge Base',
    cwd: path.join(projectRoot, 'knowledge-base'),
    command: [pythonPath, '-m', 'api.search_service'],
    port: knowledgeBasePort,
    healthUrl: envValue('KNOWLEDGE_BASE_HEALTH_URL', `http://127.0.0.1:${knowledgeBasePort}/health`),
    startupTimeoutMs: 120000,
    env: {
      PYTHONUNBUFFERED: '1',
      PORT: String(knowledgeBasePort),
    },
  },
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getService(name) {
  const service = SERVICES[name];
  if (!service) {
    const known = Object.keys(SERVICES).join(', ');
    throw new Error(`Unknown service "${name}". Expected one of: ${known}`);
  }
  if (!fs.existsSync(service.cwd)) {
    throw new Error(`Service directory not found: ${service.cwd}`);
  }
  if (!fs.existsSync(service.command[0])) {
    throw new Error(`Executable not found: ${service.command[0]}`);
  }
  if (!service.command.slice(1).every((entry) => !entry.endsWith('.js') || fs.existsSync(entry))) {
    throw new Error(`Service command includes a missing file: ${service.command.join(' ')}`);
  }
  return service;
}

async function listListeningPids(port) {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      cwd: projectRoot,
      timeout: 5000,
      encoding: 'utf8',
    });
    return String(stdout || '')
      .split('\n')
      .map((line) => Number(String(line || '').trim()))
      .filter((pid) => Number.isFinite(pid) && pid > 0 && pid !== process.pid);
  } catch (error) {
    if (Number(error?.code) === 1) {
      return [];
    }
    throw error;
  }
}

async function waitUntilPortReleased(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const pids = await listListeningPids(port);
    if (!pids.length) {
      return true;
    }
    await sleep(300);
  }
  return false;
}

async function cleanupPort(port) {
  const existingPids = await listListeningPids(port);
  if (!existingPids.length) {
    return;
  }

  console.log(`[local-service-runner] port ${port} is occupied, stopping stale pid(s): ${existingPids.join(', ')}`);
  existingPids.forEach((pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  });

  if (await waitUntilPortReleased(port, 5000)) {
    return;
  }

  const stubbornPids = await listListeningPids(port);
  stubbornPids.forEach((pid) => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  });

  if (!(await waitUntilPortReleased(port, 3000))) {
    throw new Error(`Port ${port} is still occupied after cleanup`);
  }
}

function checkHealth(healthUrl) {
  return new Promise((resolve) => {
    const target = new URL(healthUrl);
    const client = target.protocol === 'https:' ? https : http;
    const request = client.get(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        timeout: 1500,
      },
      (response) => {
        response.resume();
        const code = Number(response.statusCode || 0);
        resolve(code >= 200 && code < 500);
      }
    );
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

function forwardTerminationSignals(child) {
  ['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((signal) => {
    process.on(signal, () => {
      if (child.exitCode == null) {
        child.kill(signal);
      }
    });
  });
}

async function waitForHealthy(child, service) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < service.startupTimeoutMs) {
    if (child.exitCode != null) {
      return false;
    }
    if (await checkHealth(service.healthUrl)) {
      return true;
    }
    await sleep(800);
  }
  return false;
}

async function main() {
  const serviceName = String(process.argv[2] || '').trim();
  if (!serviceName) {
    throw new Error('Usage: node scripts/local-service-runner.cjs <admin-ui|ai-gateway|control-plane|knowledge-base>');
  }

  const service = getService(serviceName);
  await cleanupPort(service.port);

  console.log(`[local-service-runner] starting ${service.label}`);
  const child = spawn(service.command[0], service.command.slice(1), {
    cwd: service.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      ...sharedEnv,
      ...(service.env || {}),
    },
  });

  forwardTerminationSignals(child);

  const healthy = await waitForHealthy(child, service);
  if (!healthy) {
    if (child.exitCode == null) {
      child.kill('SIGTERM');
    }
    throw new Error(`${service.label} failed to become healthy at ${service.healthUrl}`);
  }

  console.log(`[local-service-runner] ${service.label} is healthy at ${service.healthUrl}`);

  const exitCode = await new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      if (typeof code === 'number') {
        resolve(code);
        return;
      }
      resolve(signal ? 1 : 0);
    });
  });
  process.exit(Number(exitCode || 0));
}

main().catch((error) => {
  console.error(`[local-service-runner] ${error?.message || error}`);
  process.exit(1);
});
