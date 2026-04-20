# 门禁系统 - CI/CD 检查点

> 阶段一目标：PRD/技术方案门禁接入率 100%

**规则事实来源（SoT）**：管理台「文档门禁」与 `gateway_doc_gate_executions` 以 **control-plane** 为准；本目录 YAML 用于 **CI/本地 gate-check** 与清单对齐，请勿与线上文档门禁混为一谈。详见仓库内 [`docs/GATE_RULE_SOURCE_OF_TRUTH.md`](../docs/GATE_RULE_SOURCE_OF_TRUTH.md)。

## 📦 项目结构

```
gate-engine/
├── src/
│   ├── index.js           # 主入口
│   ├── gate-runner.js     # 门禁执行引擎
│   └── rules/             # 门禁规则配置
│       ├── prd-gate.yaml
│       ├── tech-gate.yaml
│       └── code-gate.yaml
├── integrations/          # CI/CD 集成
│   ├── gitlab-ci.js
│   ├── github-actions.js
│   └── dingtalk.js
├── package.json
└── README.md
```

## 🎯 门禁类型

| 门禁 | 检查点 | 触发条件 |
|------|--------|----------|
| **PRD 门禁** | AI 初稿、自检清单、价值评估 | PR 创建/更新 |
| **技术方案门禁** | AI 初稿、架构规范、接口一致性 | PR 创建/更新 |
| **代码门禁** | Code Review、单元测试、规范检查 | PR 创建/更新 |
| **测试用例门禁** | AI 生成、覆盖率、边界场景 | 提测前 |
| **发布门禁** | 自动化验收、回滚方案、监控配置 | 发布前 |

## 🔧 快速开始

### 安装依赖

```bash
cd gate-engine
npm install
```

### 运行门禁检查

```bash
# 检查 PRD 文档
npm run gate-check -- --type prd --file docs/prd/user-module.md

# 检查技术方案
npm run gate-check -- --type tech --file docs/design/api-design.md

# 检查代码
npm run gate-check -- --type code --diff git diff HEAD~1
```

### HTTP 服务（Docker / 本地探测）

```bash
PORT=3002 npm start
# GET /health
# POST /api/gate/check  JSON: { "gateType": "prd", "content": "# ...", "filename": "x.md" }
```

与 **admin-ui** 若同占 `3002` 会冲突；本地开发管理台默认见 `admin-ui/vite.config.ts`（多为 **3004**）。

### CI/CD 集成

#### GitLab CI

```yaml
# .gitlab-ci.yml
stages:
  - gate_check

prd-gate:
  stage: gate_check
  script:
    - npm run gate-check -- --type prd --file $PRD_FILE
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
      changes:
        - docs/prd/*.md
```

#### GitHub Actions

```yaml
# .github/workflows/gate-check.yml
name: Gate Check

on:
  pull_request:
    paths:
      - 'docs/prd/**'
      - 'docs/design/**'

jobs:
  prd-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install
      - run: npm run gate-check -- --type prd --file $PRD_FILE
```

## 📋 门禁规则配置

### PRD 门禁规则示例

```yaml
# rules/prd-gate.yaml
gate:
  name: PRD 门禁
  version: 1.0
  stage: product

checks:
  - name: AI 初稿检查
    type: required_field
    field: ai_generated
    required: true
    message: "PRD 必须包含 AI 生成标识和初稿内容"

  - name: 自检清单
    type: checklist
    items:
      - 需求背景清晰
      - 用户故事完整
      - 验收标准可量化
      - 字段定义规范
    min_pass: 4
    message: "自检清单至少通过 4 项"

  - name: 大数据价值评估
    type: required_field
    field: value_assessment
    required: true
    message: "必须附带大数据价值评估报告"

on_fail:
  action: block
  notify:
    - dingtalk: product_group
  retry_allowed: true
```

## 🔌 API 接口

### 执行门禁检查

```bash
POST /api/v1/gate/check

{
  "gate_type": "prd",
  "content": "PRD 内容...",
  "metadata": {
    "project": "购商云汇",
    "author": "user_001"
  }
}
```

### 查询门禁状态

```bash
GET /api/v1/gate/status?mr_id=12345
```

## 📈 核心指标

| 指标 | 目标值 | 测量方式 |
|------|--------|----------|
| 门禁接入率 | 100% | 试点项目覆盖率 |
| 门禁通过率 | >80% | 首次检查通过率 |
| 平均检查时间 | <30s | P95 延迟 |
| 人工介入率 | <20% | 需要人工复核比例 |

## 📝 待办任务

- [ ] 实现门禁执行引擎
- [ ] 编写 PRD 门禁规则
- [ ] 编写技术方案门禁规则
- [ ] 编写代码门禁规则
- [ ] GitLab CI 集成
- [ ] 钉钉通知集成
- [ ] 门禁 Dashboard
- [ ] 测试用例

---

*最后更新：2026-04-09*
