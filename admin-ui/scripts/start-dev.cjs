#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

const HOST = '127.0.0.1';
const PORT = 3000;
const START_TIMEOUT_MS = 30000;
const HEALTHCHECK_INTERVAL_MS = 800;
const projectRoot = path.resolve(__dirname, '..');
const viteCacheDir = path.join(projectRoot, 'node_modules/.vite');
const viteBin = path.join(projectRoot, 'node_modules/vite/bin/vite.js');

function log(message) {
  console.log(`[admin-ui dev] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      .filter((pid) => Number.isFinite(pid) && pid > 0);
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
    await sleep(250);
  }
  return false;
}

async function cleanupPort(port) {
  const existingPids = await listListeningPids(port);
  if (!existingPids.length) {
    return;
  }

  log(`端口 ${port} 已被占用，准备清理旧进程: ${existingPids.join(', ')}`);
  existingPids.forEach((pid) => {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
  });

  if (await waitUntilPortReleased(port, 4000)) {
    return;
  }

  const remainingPids = await listListeningPids(port);
  if (remainingPids.length) {
    log(`旧进程未在超时内退出，升级强制清理: ${remainingPids.join(', ')}`);
    remainingPids.forEach((pid) => {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    });
  }

  if (!(await waitUntilPortReleased(port, 3000))) {
    throw new Error(`端口 ${port} 仍被占用，无法启动前端`);
  }
}

function checkHealth() {
  return new Promise((resolve) => {
    const request = http.get(
      {
        host: HOST,
        port: PORT,
        path: '/',
        timeout: 1500,
      },
      (response) => {
        response.resume();
        resolve(Number(response.statusCode || 0) >= 200 && Number(response.statusCode || 0) < 500);
      }
    );
    request.on('error', () => resolve(false));
    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForHealthy(child, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode != null) {
      return false;
    }
    if (await checkHealth()) {
      return true;
    }
    await sleep(HEALTHCHECK_INTERVAL_MS);
  }
  return false;
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

async function main() {
  const argv = new Set(process.argv.slice(2));
  if (argv.has('--clean')) {
    fs.rmSync(viteCacheDir, { recursive: true, force: true });
    log('已清理 Vite 本地缓存 node_modules/.vite');
  }

  await cleanupPort(PORT);

  const childArgs = [viteBin, 'dev', '--host', HOST, '--port', String(PORT), '--strictPort'];
  if (argv.has('--force')) {
    childArgs.push('--force');
  }

  log(`启动 Vite，本地固定入口 http://${HOST}:${PORT}/`);
  const child = spawn(process.execPath, childArgs, {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
  forwardTerminationSignals(child);

  const healthy = await waitForHealthy(child, START_TIMEOUT_MS);
  if (!healthy) {
    if (child.exitCode == null) {
      child.kill('SIGTERM');
    }
    throw new Error(`前端未启动：http://${HOST}:${PORT}/ 在 ${Math.round(START_TIMEOUT_MS / 1000)} 秒内未通过 health check`);
  }

  log(`前端已就绪：http://${HOST}:${PORT}/`);

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
  console.error(`[admin-ui dev] ${error?.message || error}`);
  process.exit(1);
});
