#!/usr/bin/env node

const path = require('path');
const { loadProjectEnv } = require('./lib/load-shared-env.cjs');

loadProjectEnv({
  serviceDir: path.resolve(__dirname, '..'),
  projectRoot: path.resolve(__dirname, '..'),
});

const axios = require('axios');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { resolveTemplateExecution } = require('../control-plane/src/approval/templates');

const execFileAsync = promisify(execFile);

function normalizeText(value) {
  return String(value || '').trim();
}

function getConfig() {
  return {
    baseUrl: normalizeText(process.env.CONTROL_PLANE_BASE_URL) || 'http://127.0.0.1:3104',
    token: normalizeText(process.env.HARNESS_NOTIFY_TOKEN),
    timeoutMs: Number(process.env.APPROVAL_BROKER_TIMEOUT_MS || 30 * 60 * 1000),
    pollIntervalMs: Number(process.env.APPROVAL_BROKER_POLL_INTERVAL_MS || 5000),
    limit: Math.min(Math.max(Number(process.env.APPROVAL_BROKER_LIMIT || 10), 1), 50),
  };
}

async function requestJson(method, path, body = null, config = getConfig()) {
  try {
    const requestConfig = {
      method,
      url: `${config.baseUrl}${path}`,
      timeout: config.timeoutMs,
      headers: {
        ...(config.token ? { 'x-internal-token': config.token } : {}),
      },
    };
    if (body != null) {
      requestConfig.data = body;
      requestConfig.headers['content-type'] = 'application/json';
    }
    const response = await axios(requestConfig);
    return response.data?.data;
  } catch (error) {
    if (error.response) {
      const details = JSON.stringify(error.response.data || {});
      throw new Error(`${method.toUpperCase()} ${path} failed: ${error.response.status} ${details}`);
    }
    throw error;
  }
}

function buildExecutionLogs(error, stdout, stderr) {
  const logs = [];
  if (stdout) {
    logs.push({ type: 'stdout', content: String(stdout) });
  }
  if (stderr) {
    logs.push({ type: 'stderr', content: String(stderr) });
  }
  if (error) {
    logs.push({ type: 'error', content: error.message || String(error) });
  }
  return logs;
}

async function processTask(task, config = getConfig()) {
  const executionPlan = resolveTemplateExecution(task.template_key, task.workspace_path, task.command_args_json || {});
  await requestJson(
    'post',
    `/api/v1/internal/approval-tasks/${task.id}/execution-start`,
    {
      result_payload_json: {
        plan: {
          command: executionPlan.command,
          args: executionPlan.args,
          cwd: executionPlan.cwd,
          summary: executionPlan.summary,
        },
      },
    },
    config
  );

  try {
    const result = await execFileAsync(executionPlan.command, executionPlan.args, {
      cwd: executionPlan.cwd,
      timeout: config.timeoutMs,
      maxBuffer: 1024 * 1024 * 10,
    });
    await requestJson(
      'post',
      `/api/v1/internal/approval-tasks/${task.id}/execution-result`,
      {
        success: true,
        executor_logs_json: buildExecutionLogs(null, result.stdout, result.stderr),
        result_payload_json: {
          command: executionPlan.command,
          args: executionPlan.args,
          cwd: executionPlan.cwd,
          summary: executionPlan.summary,
          exit_code: 0,
          completed_at: new Date().toISOString(),
        },
      },
      config
    );
    console.log(`[approval-broker] executed ${task.task_code}: ${executionPlan.summary}`);
    return true;
  } catch (error) {
    await requestJson(
      'post',
      `/api/v1/internal/approval-tasks/${task.id}/execution-result`,
      {
        success: false,
        executor_logs_json: buildExecutionLogs(error, error.stdout, error.stderr),
        result_payload_json: {
          command: executionPlan.command,
          args: executionPlan.args,
          cwd: executionPlan.cwd,
          summary: executionPlan.summary,
          exit_code: Number.isFinite(error.code) ? error.code : null,
          failed_at: new Date().toISOString(),
          error_message: error.message || String(error),
        },
      },
      config
    );
    console.error(`[approval-broker] failed ${task.task_code}: ${error.message || error}`);
    return false;
  }
}

async function runOnce(config = getConfig()) {
  const tasks = await requestJson(
    'get',
    `/api/v1/approval-tasks?status=approved_pending_execution&limit=${config.limit}`,
    null,
    config
  );
  const list = Array.isArray(tasks) ? tasks : [];
  if (!list.length) {
    console.log('[approval-broker] no approved tasks');
    return 0;
  }
  let handled = 0;
  for (const task of list) {
    await processTask(task, config);
    handled += 1;
  }
  return handled;
}

async function runWatch(config = getConfig()) {
  while (true) {
    try {
      await runOnce(config);
    } catch (error) {
      console.error(`[approval-broker] watch iteration failed: ${error.message || error}`);
    }
    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

async function main() {
  const mode = normalizeText(process.argv[2] || 'once').toLowerCase();
  const config = getConfig();
  if (mode === 'once') {
    await runOnce(config);
    return;
  }
  if (mode === 'watch') {
    await runWatch(config);
    return;
  }
  throw new Error(`unsupported mode: ${mode}`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
