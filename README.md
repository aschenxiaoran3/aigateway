# AI 工程化管理平台

面向 AI 工程化落地的统一管理平台，覆盖项目治理、控制平面、文档门禁、运行编排、知识与审计、度量可观测和阶段验收。

当前仓库已按《技术中心-2026Q2-AI组织能力升级-Harness工程化项目落地方案》收敛为官方 22 项项目治理模型，并以 `ai-rules/` 作为统一规则源。

## 项目总览

- `admin-ui/`：管理台，展示项目治理、控制平面、运行编排、文档门禁、知识与审计、阶段验收等页面。
- `control-plane/`：标准节点、文档门禁、文档管道、知识资产运营和运行聚合 API。
- `ai-gateway/`：统一模型接入、调用留痕、用量与成本统计。
- `knowledge-base/`：知识入库与检索服务，支持 collection 隔离与资产维度过滤。
- `gate-engine/`：规则引擎与门禁执行适配层。
- `database/`：迁移、控制平面种子、平台通用演示种子、知识资产目录种子。
- `ai-rules/`：统一 Prompt、Rules、Skills、Contracts、Pipelines 规则源。
- `docs/`：平台总手册、测试方案模板规范、门禁规则说明、运行编排与审计说明。

## 快速启动

### 1. 基础迁移

```bash
cd /Users/xiaoran/.openclaw/workspace/projects/ai-platform
npm run phase1:migrate
```

### 2. 平台初始化包

```bash
npm run platform:init
```

初始化包默认会执行三层数据：

- `base`：项目治理、控制平面、标准节点、默认项目与默认管道定义
- `knowledge`：平台手册、门禁规则、测试模板规范等知识资产目录
- `demo`：演示项目、默认 Trace、默认文档任务、证据包、抽检记录、度量样本

如需分层执行：

```bash
node scripts/init-platform-pack.cjs --only=base
node scripts/init-platform-pack.cjs --only=knowledge
node scripts/init-platform-pack.cjs --only=demo
```

### 3. 知识资产入库

```bash
npm run knowledge:ingest
```

### 4. 启动服务

至少启动这四个服务：

- `ai-gateway`
- `control-plane`
- `knowledge-base`
- `admin-ui`

默认本地端口口径：

- `admin-ui`：`3000`
- `ai-gateway`：`3001`
- `control-plane`：`3104`
- `knowledge-base`：`8000`

### 5. macOS 开机自启

如果本机是 macOS，推荐把核心本地服务注册为 `launchd` 用户代理。这样重启电脑后，只要重新登录桌面，会自动拉起：

- `admin-ui` (`3000`)
- `ai-gateway` (`3001`)
- `control-plane` (`3104`)

知识库服务 `knowledge-base` 默认不纳入自动启动，因为不少本机会把 `8000` 端口拿去做 SSH 隧道或其他临时用途；如需纳入，可单独指定。

```bash
cd /Users/xiaoran/.openclaw/workspace/projects/ai-platform

# 安装并立即启动核心服务
npm run services:install

# 查看状态
npm run services:status

# 只看健康检查
npm run services:health

# 重启核心服务
npm run services:restart

# 查看日志路径
npm run services:logs

# 如需把 knowledge-base 也注册进去
node scripts/local-services.cjs install knowledge-base
```

生成的 LaunchAgent 会写到：

- `~/Library/LaunchAgents/com.openclaw.ai-platform.admin-ui.plist`
- `~/Library/LaunchAgents/com.openclaw.ai-platform.ai-gateway.plist`
- `~/Library/LaunchAgents/com.openclaw.ai-platform.control-plane.plist`

运行日志默认写到：

- `/Users/xiaoran/.openclaw/workspace/projects/ai-platform/.runtime/launchd/*.out.log`
- `/Users/xiaoran/.openclaw/workspace/projects/ai-platform/.runtime/launchd/*.err.log`

## 文档索引

- 平台总手册：[docs/platform-user-manual.md](./docs/platform-user-manual.md)
- 业务演示脚本：[docs/harness-business-demo-script.md](./docs/harness-business-demo-script.md)
- Harness 接线设计稿：[docs/harness-feishu-integration-design.md](./docs/harness-feishu-integration-design.md)
- 飞书事件订阅接入清单：[docs/feishu-event-subscription-checklist.md](./docs/feishu-event-subscription-checklist.md)
- Codex 飞书确认工作流：[docs/codex-feishu-approval-workflow.md](./docs/codex-feishu-approval-workflow.md)
- Codex 飞书审批代理设计稿：[docs/codex-feishu-approval-broker-design.md](./docs/codex-feishu-approval-broker-design.md)
- 测试方案模板规范：[docs/test-plan-template-spec.md](./docs/test-plan-template-spec.md)
- 测试方案门禁规则：[docs/test-plan-gate-rules.md](./docs/test-plan-gate-rules.md)
- 运行编排与可观测：[docs/runtime-observability-guide.md](./docs/runtime-observability-guide.md)
- 知识与审计说明：[docs/knowledge-audit-guide.md](./docs/knowledge-audit-guide.md)
- 度量与阶段验收口径：[docs/metrics-acceptance-guide.md](./docs/metrics-acceptance-guide.md)
- 销售订单文档管道样板：[docs/E2E_SALES_ORDER_DOC_GATES.md](./docs/E2E_SALES_ORDER_DOC_GATES.md)

## 平台默认演示内容

初始化完成后，管理台应直接可见：

- 默认平台项目：平台通用演示、文档工程化演示、知识治理演示、验收度量演示
- 默认管道：`gate-review`、`doc-pipeline-v1`
- 默认文档任务：销售订单文档工程化样板
- 默认双轨测试方案：标准模板版、AI 增强版、正式发布版
- 默认知识资产：平台手册、测试模板规范、门禁规则说明、知识审计说明
- 默认运行与验收样本：Trace、Evidence Pack、审计抽检记录、提效基线与指标样本

## 开发说明

- `phase1:migrate` 负责节点契约与双轨测试方案相关迁移。
- `platform:init` 负责产品化初始化数据，不回滚用户已有业务数据。
- `knowledge:ingest` 负责把知识资产目录写入知识库并回写索引状态。

更多使用方式与演示路径，请直接查看平台总手册。
