# Codex 飞书审批代理设计稿

## 1. 目标

这份设计稿解决的问题不是“修改 Codex 客户端原生审批弹窗”，而是：

- 让大多数原本会在工作中触发高风险确认的动作，先走飞书审批
- 让审批通过后的执行，交给一个本地审批代理完成
- 让 Codex 继续作为编排者，而不是直接承担所有高风险执行

一句话说，就是：

`原生弹窗不能直接改写，但可以被大多数业务级高风险动作的飞书审批代理所前置替代。`

## 2. 结论先行

想要真正接近“AI 办公”，推荐的路线不是试图拦截 Codex 客户端原生弹窗，而是新增一层：

`Codex -> Feishu Approval Broker -> Local Executor`

这样可以把大量高风险动作前移成飞书审批，从体验上尽量接近“全部发到飞书确定”。

## 3. 不能直接做到的部分

当前明确不能直接替代的是：

- Codex 桌面端原生提权弹窗
- 沙箱外命令的客户端内建审批 UI
- 任何必须由 Codex 客户端本体决定是否执行的系统级动作

原因很简单：

- 这一层不在当前工作区代码里
- 不是 `control-plane` / `ai-gateway` / `scripts` 能直接接管的
- 也不是飞书回调链路能直接劫持的

所以这里的方案是“旁路替代”，不是“底层接管”。

## 4. 能做到的目标形态

### 4.1 用户侧体验

用户体验目标是：

1. Codex 判断某个动作风险较高
2. 不直接执行，不先撞到原生弹窗
3. 先发一张飞书审批卡
4. 用户在飞书里点“批准 / 拒绝 / 稍后”
5. 如果批准，由审批代理在本地代为执行
6. Codex 读取结果后继续编排

### 4.2 适合纳入审批代理的动作

优先覆盖这些动作：

- `git pull`
- `git push`
- 部署命令
- 带外部副作用的脚本
- 会改共享环境的任务
- 调内网 / 调生产 / 调准生产接口
- 数据迁移、批量写入、批量回填
- 长时任务启动

### 4.3 不适合第一期纳入的动作

- 任意 shell 命令开放执行
- 用户桌面 UI 控制
- 文件删除、系统设置修改这类强系统级动作
- 无明确命令模板的自由执行

第一期一定要“白名单化”，不要一上来做通用远程命令执行器。

## 5. 推荐架构

```text
Codex
  -> create approval prompt
  -> control-plane
    -> ai-gateway
      -> Feishu interactive card
        -> user approves / rejects
      <- callback
    <- approval result persisted
  -> approval broker watches approved actions
  -> approval broker executes whitelisted command
  -> control-plane stores execution result
  -> Codex continues
```

## 6. 组件拆分

推荐拆成 4 个部件。

### 6.1 Prompt Layer

已经存在：

- `control-plane` 的 human prompt 队列
- `ai-gateway` 的飞书交互卡片发送
- `feishu callbacks` 回流

这一层继续负责：

- 发审批卡
- 收用户决定
- 落库存档

### 6.2 Approval Broker

新增本地服务或脚本进程，例如：

- `scripts/codex-approval-broker.cjs`
- 或 `projects/ai-platform/approval-broker/`

职责：

- 轮询或订阅“已批准待执行”的审批任务
- 验证任务是否属于白名单模板
- 在本地执行对应命令
- 回写执行结果

### 6.3 Approval Task Store

在 `control-plane` 增加一张任务表，例如：

`gateway_codex_approval_tasks`

建议字段：

- `id`
- `task_code`
- `prompt_code`
- `task_type`
- `status`
- `workspace_path`
- `command_template`
- `command_args_json`
- `risk_level`
- `requested_by`
- `approved_by`
- `approved_at`
- `executor_status`
- `executor_logs_json`
- `result_payload_json`
- `created_at`
- `updated_at`

### 6.4 Command Templates

新增白名单模板定义，例如：

- `git_pull`
- `git_push_current_branch`
- `npm_run_deploy`
- `node_script_migration`
- `curl_internal_api`

每个模板固定：

- 可执行命令前缀
- 可变参数范围
- 允许的工作目录
- 风险等级
- 飞书展示文案

## 7. 关键原则

### 7.1 白名单优先

审批代理不能是“你点了批准我就执行任意命令”。

第一期必须做到：

- 仅允许模板化任务
- 不允许自由 shell 拼接
- 不允许 heredoc
- 不允许任意重定向
- 不允许模糊工作目录

### 7.2 审批和执行分离

飞书只做“是否批准”的人机确认。

真正执行命令的是本地 broker，不是飞书回调本身。

这样好处是：

- 回调更轻
- 执行可以重试
- 日志更容易留痕

### 7.3 Codex 只发任务，不直接越权

Codex 后续如果遇到高风险动作：

- 不直接执行
- 先创建审批任务
- 等待审批结果
- 再由 broker 代执行

这样才能最大程度减少原生弹窗出现频次。

## 8. 任务流转设计

### 8.1 创建任务

Codex 想执行高风险动作时，向 `control-plane` 提交：

`POST /api/v1/approval-tasks`

请求体示例：

```json
{
  "task_type": "git_push_current_branch",
  "workspace_path": "/Users/xiaoran/.openclaw/workspace/projects/ai-platform",
  "command_template": "git_push_current_branch",
  "command_args_json": {
    "remote": "origin",
    "branch": "main"
  },
  "risk_level": "high",
  "summary": "把当前分支推送到 origin/main",
  "question": "是否允许我把当前分支推送到 origin/main？"
}
```

### 8.2 发飞书审批卡

`control-plane` 创建：

- approval task
- 关联 prompt

然后复用现有飞书卡片链路发出审批卡。

按钮建议：

- `批准执行`
- `稍后处理`
- `拒绝`

### 8.3 用户点击批准

飞书回调把 prompt 标记为 `answered`，同时把 task 状态改成：

- `approved_pending_execution`

### 8.4 Broker 执行

审批代理拉取：

`GET /api/v1/approval-tasks?status=approved_pending_execution`

执行前再次验证：

- 模板是否合法
- 参数是否合法
- 工作目录是否合法

验证通过后执行，并回写：

`POST /api/v1/approval-tasks/:id/execution-result`

### 8.5 Codex 继续

Codex 可以通过：

- 轮询任务状态
- 或轮询 prompt + task 关联状态

拿到：

- `approved`
- `rejected`
- `executed_success`
- `executed_failed`

然后继续下一步。

## 9. 推荐 API

### 9.1 创建审批任务

`POST /api/v1/approval-tasks`

### 9.2 查询审批任务

`GET /api/v1/approval-tasks`

### 9.3 查询单个审批任务

`GET /api/v1/approval-tasks/:id`

### 9.4 Broker 回写执行结果

`POST /api/v1/approval-tasks/:id/execution-result`

### 9.5 Broker 拉取白名单模板

可选：

`GET /api/v1/approval-templates`

## 10. 飞书卡片文案建议

### 标题

`Codex 待审批 · 高风险动作`

### 内容

- 任务编号
- 动作摘要
- 工作目录
- 命令模板
- 风险等级
- 如果批准，将由本地审批代理执行
- 这不是 Codex 客户端原生弹窗，而是飞书审批代理

### 按钮

- `批准执行`
- `稍后处理`
- `拒绝`
- `查看工作目录`

## 11. 状态机建议

审批任务建议状态：

- `pending_approval`
- `approved_pending_execution`
- `rejected`
- `expired`
- `executing`
- `executed_success`
- `executed_failed`
- `cancelled`

Prompt 状态继续沿用现有：

- `pending`
- `answered`

## 12. 第一阶段 MVP

第一期只做最小闭环：

### 范围

- 支持 3 个模板：
  - `git_pull`
  - `git_push_current_branch`
  - `npm_run_deploy`
- 支持飞书批准 / 拒绝
- 支持 broker 本地执行
- 支持结果回写

### 不做

- 不做任意命令
- 不做并发调度
- 不做复杂重试队列
- 不做多执行器竞争

### 成功标准

1. Codex 创建一条高风险动作审批任务
2. 飞书收到审批卡
3. 用户点“批准执行”
4. 本地 broker 执行白名单命令
5. 结果回写到平台
6. Codex 感知结果并继续

## 13. 第二阶段增强

后续可以再做：

- 固定域名 / named tunnel
- 审批代理服务常驻化
- 命令输出流式回写
- 飞书卡片点击后状态更新
- 审批超时自动过期
- “批准并记住同类策略”
- 审计报表

## 14. 风险与边界

### 风险 1：误把审批代理做成远程执行后门

规避：

- 只允许模板化任务
- 只允许固定参数
- 只允许白名单工作目录

### 风险 2：用户误以为所有原生弹窗都能消失

规避：

- 在文档和卡片里明确写清楚：
  这是“飞书审批代理”，不是“Codex 客户端原生审批替换”

### 风险 3：审批通过后执行环境不一致

规避：

- broker 只跑在当前机器
- 明确记录 `workspace_path`
- 明确记录实际执行命令

## 15. 推荐落地顺序

1. 先在 `control-plane` 增加 `approval_tasks` 表和 API
2. 复用现有 `human_prompts` 发飞书审批卡
3. 新增本地 `approval-broker` 脚本
4. 只接 2-3 个白名单模板
5. 用真实 `git pull / push / deploy` 跑一轮验收

## 16. 最终结论

如果目标是“尽量让审批都发生在飞书里”，那么最现实、最稳、最可交付的路径不是修改 Codex 原生弹窗，而是：

`把大多数高风险动作改造成飞书审批代理前置。`

这样虽然不是底层彻底替换，但对真实办公流已经足够接近“所有批准都在飞书里完成”。

## 17. 当前实现状态

截至当前仓库版本，第一期 MVP 已有基础落地：

- `control-plane` 已新增 `gateway_codex_approval_tasks` 表与 API
- 已复用 `human_prompts + Feishu callbacks` 作为审批卡收发链路
- 已新增本地 broker 脚本 `scripts/codex-approval-broker.cjs`
- 已支持 3 个白名单模板：
  - `git_pull`
  - `git_push_current_branch`
  - `npm_run_deploy`

当前仍有两个收尾项：

- broker 自跑时还需要再补一轮稳定性排查
- 审批卡自动通知偶发会受本地服务启动时序影响，需要进一步稳住
