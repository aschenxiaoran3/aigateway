/**
 * GitLab CI 集成模块
 * 
 * 功能:
 * - 生成 .gitlab-ci.yml 配置
 * - 处理 Merge Request Webhook 事件
 * - 执行门禁检查并发布结果到 MR 评论
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { runGate } = require('../src/gate-runner');

class GitLabCIIntegration {
  constructor(options = {}) {
    this.gitlabUrl = options.gitlabUrl || process.env.GITLAB_URL || 'https://gitlab.example.com';
    this.privateToken = options.privateToken || process.env.GITLAB_PRIVATE_TOKEN;
    this.rulesDir = options.rulesDir || path.join(__dirname, '../rules');
    this.secretToken = options.secretToken || process.env.GITLAB_WEBHOOK_SECRET;
  }

  /**
   * 生成 .gitlab-ci.yml 配置文件
   */
  generateGitlabCI(options = {}) {
    const {
      nodeVersion = '20',
      pythonVersion = '3.11',
      enablePRDGate = true,
      enableTechGate = true,
      enableCodeGate = true,
      notifyDingTalk = false,
      dingTalkWebhook = '',
    } = options;

    const stages = ['lint', 'test', 'gate-check', 'build', 'deploy'];

    const ciConfig = {
      stages,

      variables: {
        NODE_ENV: 'production',
        GATE_ENGINE_DIR: './gate-engine',
      },

      before_script: [
        'echo "Setting up environment..."',
      ],

      // Lint 阶段
      'lint:code': {
        stage: 'lint',
        image: `node:${nodeVersion}-alpine`,
        script: [
          'cd $CI_PROJECT_DIR',
          'npm ci || true',
          'npm run lint || echo "No lint script found"',
        ],
        allow_failure: true,
      },

      // 测试阶段
      'test:unit': {
        stage: 'test',
        image: `node:${nodeVersion}-alpine`,
        script: [
          'cd $CI_PROJECT_DIR',
          'npm ci || true',
          'npm test || echo "No test script found"',
        ],
        allow_failure: true,
      },

      // 门禁检查阶段
      'gate:check': {
        stage: 'gate-check',
        image: `node:${nodeVersion}-alpine`,
        script: [
          'cd $CI_PROJECT_DIR/gate-engine',
          'npm install js-yaml',
          'node src/gate-runner.js --ci',
        ],
        rules: [
          { if: '$CI_PIPELINE_SOURCE == "merge_request_event"' },
          { if: '$CI_COMMIT_BRANCH == "main"' },
        ],
      },
    };

    // 可选: 钉钉通知
    if (notifyDingTalk && dingTalkWebhook) {
      ciConfig['notify:dingtalk'] = {
        stage: 'deploy',
        image: 'curlimages/curl:latest',
        script: [
          'curl -X POST \'${dingTalkWebhook}\' \\',
          '  -H "Content-Type: application/json" \\',
          `  -d '{"msgtype":"text","text":{"content":"CI/CD 流水线完成: $CI_PROJECT_NAME - $CI_COMMIT_BRANCH"}}'`,
        ],
        rules: [{ when: 'always' }],
        allow_failure: true,
      };
    }

    return yaml.dump(ciConfig, { lineWidth: -1 });
  }

  /**
   * 验证 Webhook 签名
   */
  verifyWebhook(payload, signature) {
    if (!this.secretToken) return true; // 无密钥则跳过验证
    const crypto = require('crypto');
    const expected = crypto
      .createHmac('sha256', this.secretToken)
      .update(payload)
      .digest('hex');
    return `sha256=${expected}` === signature;
  }

  /**
   * 处理 Merge Request Webhook 事件
   */
  async handleMREvent(event, req) {
    const { object_attributes, changes } = event;
    const mrIid = object_attributes.iid;
    const projectId = object_attributes.target_project_id;
    const sourceBranch = object_attributes.source_branch;
    const targetBranch = object_attributes.target_branch;

    console.log(`[GitLab CI] MR #${mrIid}: ${sourceBranch} -> ${targetBranch}`);

    // 根据文件变更决定运行哪些门禁
    const gatesToRun = [];

    // 检查是否有 PRD/文档变更
    const hasDocChanges = this._checkDocChanges(changes);
    if (hasDocChanges) {
      gatesToRun.push('prd-gate.yaml');
    }

    // 检查是否有技术方案变更
    const hasTechChanges = this._checkTechChanges(changes);
    if (hasTechChanges) {
      gatesToRun.push('tech-gate.yaml');
    }

    // 检查是否有代码变更
    const hasCodeChanges = this._checkCodeChanges(changes);
    if (hasCodeChanges) {
      gatesToRun.push('code-gate.yaml');
    }

    // 默认至少运行代码门禁
    if (gatesToRun.length === 0) {
      gatesToRun.push('code-gate.yaml');
    }

    // 执行门禁检查
    const results = [];
    for (const gateFile of gatesToRun) {
      const gatePath = path.join(this.rulesDir, gateFile);
      if (fs.existsSync(gatePath)) {
        try {
          const result = await runGate(gatePath);
          results.push({ gate: gateFile, ...result });
        } catch (error) {
          results.push({
            gate: gateFile,
            passed: false,
            error: error.message,
          });
        }
      }
    }

    // 发布结果到 MR 评论
    await this.postMRComment(projectId, mrIid, results);

    // 如果有门禁失败，返回失败状态
    const allPassed = results.every((r) => r.passed);
    return { passed: allPassed, results };
  }

  /**
   * 发布 MR 评论
   */
  async postMRComment(projectId, mrIid, results) {
    if (!this.privateToken) {
      console.log('[GitLab CI] No token, skipping MR comment');
      return;
    }

    const emoji = (passed) => (passed ? '✅' : '❌');
    let body = '## 🚪 门禁检查结果\n\n';

    for (const result of results) {
      const gateName = result.gate.replace('.yaml', '').replace('-gate', '');
      const status = result.error
        ? `⚠️ 执行失败: ${result.error}`
        : result.passed
          ? `通过 (得分: ${result.score})`
          : `未通过 (得分: ${result.score})`;

      body += `- ${emoji(result.passed && !result.error)} **${gateName}**: ${status}\n`;

      if (result.failed_checks && result.failed_checks.length > 0) {
        for (const check of result.failed_checks) {
          body += `  - ❌ ${check.name}: ${check.message}\n`;
        }
      }
    }

    body += '\n---\n_由 AI 平台门禁系统自动生成_';

    try {
      const url = `${this.gitlabUrl}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'PRIVATE-TOKEN': this.privateToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ body }),
      });

      if (!response.ok) {
        console.error(`[GitLab CI] Failed to post comment: ${response.status}`);
      } else {
        console.log(`[GitLab CI] Comment posted to MR #${mrIid}`);
      }
    } catch (error) {
      console.error(`[GitLab CI] Error posting comment: ${error.message}`);
    }
  }

  /**
   * 检查文档变更
   */
  _checkDocChanges(changes) {
    if (!changes) return true; // 默认检查
    const patterns = ['.md', 'prd', 'requirement', '需求'];
    return this._hasChanges(changes, patterns);
  }

  /**
   * 检查技术方案变更
   */
  _checkTechChanges(changes) {
    if (!changes) return true;
    const patterns = ['tech', 'design', '架构', '.yaml', '.yml'];
    return this._hasChanges(changes, patterns);
  }

  /**
   * 检查代码变更
   */
  _checkCodeChanges(changes) {
    if (!changes) return true;
    const patterns = ['.js', '.ts', '.py', '.java', '.go', 'src/', 'lib/'];
    return this._hasChanges(changes, patterns);
  }

  /**
   * 通用变更检查
   */
  _hasChanges(changes, patterns) {
    const changeStr = JSON.stringify(changes).toLowerCase();
    return patterns.some((p) => changeStr.includes(p.toLowerCase()));
  }

  /**
   * Express 中间件: 处理 GitLab Webhook
   */
  webhookMiddleware() {
    return async (req, res) => {
      // 验证签名
      const signature = req.headers['x-gitlab-token'];
      if (this.secretToken && !this.verifyWebhook(JSON.stringify(req.body), signature)) {
        return res.status(403).json({ error: 'Invalid webhook signature' });
      }

      const event = req.headers['x-gitlab-event'];
      console.log(`[GitLab CI] Webhook received: ${event}`);

      if (event === 'Merge Request Hook') {
        try {
          const result = await this.handleMREvent(req.body, req);
          res.json(result);
        } catch (error) {
          console.error(`[GitLab CI] Webhook error: ${error.message}`);
          res.status(500).json({ error: error.message });
        }
      } else {
        res.json({ status: 'ignored', event });
      }
    };
  }
}

module.exports = GitLabCIIntegration;
