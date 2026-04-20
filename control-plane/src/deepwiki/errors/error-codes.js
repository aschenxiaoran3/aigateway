'use strict';

const SEVERITY = Object.freeze({
  FATAL: 'fatal',
  RETRYABLE: 'retryable',
  WARNING: 'warning',
});

const ERROR_CODES = Object.freeze({
  DW_E_KB_UNREACHABLE: {
    code: 'DW_E_KB_UNREACHABLE',
    severity: SEVERITY.RETRYABLE,
    message_zh: '知识库服务无法连接',
    remediation_zh: 'KB 服务未启动或端口被占用。检查 KNOWLEDGE_BASE_SEARCH_URL 指向的进程是否存在。',
    remediation_cmd: 'curl -sf "$KNOWLEDGE_BASE_SEARCH_URL/../healthz" || echo "KB down"',
  },
  DW_E_KB_VERSION_MISMATCH: {
    code: 'DW_E_KB_VERSION_MISMATCH',
    severity: SEVERITY.FATAL,
    message_zh: 'KB 健康接口返回的元信息与 control-plane 期望不符',
    remediation_zh: '升级/降级 KB 服务到与 control-plane 兼容的版本，或修改 KNOWLEDGE_BASE_MIN_VERSION 环境变量。',
  },
  DW_E_KB_VENV_MISSING: {
    code: 'DW_E_KB_VENV_MISSING',
    severity: SEVERITY.FATAL,
    message_zh: 'KB 后端 Python venv 缺失或不可用',
    remediation_zh: '在 knowledge-base 目录执行 `python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`。',
    remediation_cmd: 'ls -la "$KNOWLEDGE_BASE_VENV_PATH"',
  },
  DW_E_DB_WRITE_FAIL: {
    code: 'DW_E_DB_WRITE_FAIL',
    severity: SEVERITY.FATAL,
    message_zh: 'MySQL 不可写入',
    remediation_zh: '检查 MySQL 是否运行、连接池是否耗尽、gateway_pipeline_runs 表是否存在。',
    remediation_cmd: 'mysql -e "SELECT 1" --defaults-group-suffix=_aigateway',
  },
  DW_E_REPO_UNREADABLE: {
    code: 'DW_E_REPO_UNREADABLE',
    severity: SEVERITY.FATAL,
    message_zh: '源码目录不可访问',
    remediation_zh: '确认项目 clone_path 存在且当前进程有读取权限。',
  },
  DW_E_BRANCH_MISSING: {
    code: 'DW_E_BRANCH_MISSING',
    severity: SEVERITY.FATAL,
    message_zh: '指定分支在本地仓库中不存在',
    remediation_zh: '在仓库目录 `git fetch origin && git branch -a`，确认分支名拼写正确。',
  },
  DW_E_LLM_ENDPOINT_DOWN: {
    code: 'DW_E_LLM_ENDPOINT_DOWN',
    severity: SEVERITY.RETRYABLE,
    message_zh: 'LLM 上游不可达或返回 5xx',
    remediation_zh: '检查 LLM_BASE_URL、API key、余额、速率限制。',
  },
  DW_E_STAGE_TIMEOUT: {
    code: 'DW_E_STAGE_TIMEOUT',
    severity: SEVERITY.RETRYABLE,
    message_zh: '阶段执行超时',
    remediation_zh: '检查阶段日志定位慢点；可在环境变量 DEEPWIKI_STAGE_TIMEOUT_MS_<STAGE> 覆盖默认上限。',
  },
  DW_E_INGEST_PARTIAL: {
    code: 'DW_E_INGEST_PARTIAL',
    severity: SEVERITY.RETRYABLE,
    message_zh: 'rag_ingest 入库数量与预期不符',
    remediation_zh: '查看 KB 服务日志，确认是否有分块/embedding 失败；必要时清空 collection 后重跑。',
  },
  DW_E_CONFIG_DRIFT: {
    code: 'DW_E_CONFIG_DRIFT',
    severity: SEVERITY.FATAL,
    message_zh: '配置与运行时状态不一致（端口/路径/版本漂移）',
    remediation_zh: '比对 .env 与实际进程监听端口、KB 自报 endpoint，确认一致。',
  },
  DW_E_PREFLIGHT_FAILED: {
    code: 'DW_E_PREFLIGHT_FAILED',
    severity: SEVERITY.FATAL,
    message_zh: '前置依赖校验未通过',
    remediation_zh: '按 failures 列表逐项修复，或设置 DEEPWIKI_PREFLIGHT_DISABLE 跳过特定检查（不推荐）。',
  },
});

function isKnownErrorCode(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(ERROR_CODES, code);
}

function getErrorCode(code) {
  return ERROR_CODES[code] || null;
}

function listErrorCodes() {
  return Object.values(ERROR_CODES);
}

class DeepWikiError extends Error {
  constructor(code, detail, extras = {}) {
    const entry = getErrorCode(code);
    const message = entry ? `${code}: ${entry.message_zh}${detail ? ' — ' + detail : ''}` : code;
    super(message);
    this.name = 'DeepWikiError';
    this.code = code;
    this.severity = entry ? entry.severity : SEVERITY.FATAL;
    this.detail = detail || null;
    this.remediation_zh = entry ? entry.remediation_zh : null;
    this.remediation_cmd = entry ? entry.remediation_cmd || null : null;
    Object.assign(this, extras);
  }

  toJSON() {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      detail: this.detail,
      remediation_zh: this.remediation_zh,
      remediation_cmd: this.remediation_cmd,
    };
  }
}

function wrapError(error, fallbackCode = 'DW_E_PREFLIGHT_FAILED') {
  if (error instanceof DeepWikiError) return error;
  const detail = error && (error.message || String(error));
  return new DeepWikiError(fallbackCode, detail);
}

module.exports = {
  SEVERITY,
  ERROR_CODES,
  DeepWikiError,
  isKnownErrorCode,
  getErrorCode,
  listErrorCodes,
  wrapError,
};
