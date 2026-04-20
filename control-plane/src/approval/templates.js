const path = require('path');

function normalizeText(value) {
  return String(value || '').trim();
}

const APPROVAL_TEMPLATES = {
  git_pull: {
    key: 'git_pull',
    label: 'Git Pull',
    risk_level: 'high',
    description: '拉取远端分支到当前工作区',
  },
  git_push_current_branch: {
    key: 'git_push_current_branch',
    label: 'Git Push',
    risk_level: 'high',
    description: '把当前分支推送到远端',
  },
  npm_run_deploy: {
    key: 'npm_run_deploy',
    label: 'NPM Deploy',
    risk_level: 'high',
    description: '执行部署脚本',
  },
};

function getApprovalTemplate(templateKey) {
  return APPROVAL_TEMPLATES[normalizeText(templateKey)] || null;
}

function listApprovalTemplates() {
  return Object.values(APPROVAL_TEMPLATES);
}

function ensureAbsoluteWorkspacePath(workspacePath) {
  const resolved = normalizeText(workspacePath) ? path.resolve(workspacePath) : '';
  if (!resolved || !path.isAbsolute(resolved)) {
    throw new Error('workspace_path must be an absolute path');
  }
  return resolved;
}

function normalizeTemplateArgs(templateKey, rawArgs = {}) {
  const key = normalizeText(templateKey);
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  if (key === 'git_pull' || key === 'git_push_current_branch') {
    return {
      remote: normalizeText(args.remote) || 'origin',
      branch: normalizeText(args.branch),
    };
  }
  if (key === 'npm_run_deploy') {
    return {
      script: normalizeText(args.script) || 'deploy',
    };
  }
  throw new Error(`unsupported approval template: ${key || 'unknown'}`);
}

function resolveTemplateExecution(templateKey, workspacePath, rawArgs = {}) {
  const template = getApprovalTemplate(templateKey);
  if (!template) {
    throw new Error(`unsupported approval template: ${normalizeText(templateKey) || 'unknown'}`);
  }
  const cwd = ensureAbsoluteWorkspacePath(workspacePath);
  const args = normalizeTemplateArgs(template.key, rawArgs);

  if (template.key === 'git_pull') {
    if (!args.branch) {
      throw new Error('git_pull requires command_args_json.branch');
    }
    return {
      command: 'git',
      args: ['pull', '--ff-only', args.remote, args.branch],
      cwd,
      summary: `git pull --ff-only ${args.remote} ${args.branch}`,
      normalized_args: args,
    };
  }

  if (template.key === 'git_push_current_branch') {
    if (!args.branch) {
      throw new Error('git_push_current_branch requires command_args_json.branch');
    }
    return {
      command: 'git',
      args: ['push', args.remote, args.branch],
      cwd,
      summary: `git push ${args.remote} ${args.branch}`,
      normalized_args: args,
    };
  }

  if (template.key === 'npm_run_deploy') {
    return {
      command: 'npm',
      args: ['run', args.script],
      cwd,
      summary: `npm run ${args.script}`,
      normalized_args: args,
    };
  }

  throw new Error(`unsupported approval template: ${template.key}`);
}

module.exports = {
  APPROVAL_TEMPLATES,
  getApprovalTemplate,
  listApprovalTemplates,
  normalizeTemplateArgs,
  resolveTemplateExecution,
};
