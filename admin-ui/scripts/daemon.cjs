#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 3000;
const START_TIMEOUT_MS = 30000;
const STOP_TIMEOUT_MS = 10000;
const projectRoot = path.resolve(__dirname, '..');
const launcher = path.join(projectRoot, 'scripts/start-dev.cjs');
const runtimeDir = path.join(projectRoot, '.runtime');
const pidFile = path.join(runtimeDir, 'admin-ui.pid');
const logFile = path.join(runtimeDir, 'admin-ui.log');

function log(message) {
  console.log(`[admin-ui daemon] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureRuntimeDir() {
  fs.mkdirSync(runtimeDir, { recursive: true });
}

function readPid() {
  try {
    const value = fs.readFileSync(pidFile, 'utf8').trim();
    const pid = Number(value);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePid(pid) {
  ensureRuntimeDir();
  fs.writeFileSync(pidFile, `${pid}\n`, 'utf8');
}

function removePidFile() {
  try {
    fs.unlinkSync(pidFile);
  } catch {
    /* ignore */
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
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

async function waitFor(predicate, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await predicate()) {
      return true;
    }
    await sleep(400);
  }
  return false;
}

function appendLogDivider(action) {
  ensureRuntimeDir();
  const stamp = new Date().toISOString();
  fs.appendFileSync(logFile, `\n[${stamp}] ${action}\n`, 'utf8');
}

function readLogTail(maxLines = 30) {
  try {
    const lines = fs.readFileSync(logFile, 'utf8').trimEnd().split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch {
    return '';
  }
}

async function start() {
  if (await checkHealth()) {
    const pid = readPid();
    log(`服务已可访问: http://${HOST}:${PORT}/deepwiki?project=1${pid ? ` (pid ${pid})` : ''}`);
    return;
  }

  const stalePid = readPid();
  if (stalePid && !isPidAlive(stalePid)) {
    removePidFile();
  }

  if (!fs.existsSync(launcher)) {
    throw new Error(`启动脚本不存在: ${launcher}`);
  }

  ensureRuntimeDir();
  appendLogDivider('starting detached dev server');
  const logFd = fs.openSync(logFile, 'a');
  const child = spawn(process.execPath, [launcher], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  fs.closeSync(logFd);
  child.unref();
  writePid(child.pid);

  const healthy = await waitFor(checkHealth, START_TIMEOUT_MS);
  if (!healthy) {
    throw new Error(
      `前端未在 ${Math.round(START_TIMEOUT_MS / 1000)} 秒内启动成功，日志见 ${logFile}\n${readLogTail()}`
    );
  }

  log(`已后台启动: pid=${child.pid}`);
  log(`访问地址: http://${HOST}:${PORT}/deepwiki?project=1`);
  log(`日志文件: ${logFile}`);
}

async function stop() {
  const pid = readPid();
  if (!pid) {
    if (await checkHealth()) {
      log('3000 端口仍有服务，但未找到当前 daemon 的 pid 文件；未强制停止未知进程。');
      return;
    }
    log('当前没有记录中的 admin-ui daemon。');
    return;
  }

  if (!isPidAlive(pid)) {
    removePidFile();
    log(`发现陈旧 pid 文件，已清理: ${pid}`);
    return;
  }

  process.kill(pid, 'SIGTERM');
  const stopped = await waitFor(async () => !isPidAlive(pid) && !(await checkHealth()), STOP_TIMEOUT_MS);
  if (!stopped) {
    process.kill(pid, 'SIGKILL');
    const killed = await waitFor(async () => !isPidAlive(pid) && !(await checkHealth()), 3000);
    if (!killed) {
      throw new Error(`已发送 SIGKILL，但 3000 端口仍未释放，请检查 ${logFile}`);
    }
  }

  removePidFile();
  log(`已停止 admin-ui daemon (pid ${pid})`);
}

async function status() {
  const pid = readPid();
  const pidAlive = pid ? isPidAlive(pid) : false;
  const healthy = await checkHealth();

  if (healthy) {
    log(`运行中: http://${HOST}:${PORT}/deepwiki?project=1${pidAlive ? ` (pid ${pid})` : ''}`);
    log(`日志文件: ${logFile}`);
    return;
  }

  if (pid && !pidAlive) {
    log(`未运行，发现陈旧 pid 文件: ${pid}`);
    return;
  }

  log('未运行。');
}

async function main() {
  const command = String(process.argv[2] || 'status').trim();
  if (command === 'start') {
    await start();
    return;
  }
  if (command === 'stop') {
    await stop();
    return;
  }
  if (command === 'restart') {
    await stop();
    await start();
    return;
  }
  if (command === 'status') {
    await status();
    return;
  }
  throw new Error(`不支持的命令: ${command}`);
}

main().catch((error) => {
  console.error(`[admin-ui daemon] ${error?.message || error}`);
  process.exit(1);
});
