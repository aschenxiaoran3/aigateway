# Harness 与飞书/外部执行器接线设计稿

## 1. 目标

这份设计稿解决两个问题：

1. 当前 `ai-platform` 里的 Harness V1 如何接入飞书通知
2. 后续如果要把 Harness Runtime 委派给你本地已打通飞书的外部执行链，应该怎么接

本文优先给出一条最短可落地的方案，不追求一步到位做成“大一统平台”。

## 2. 当前现状

### 2.1 当前运行拓扑

本机当前实际拓扑如下：

- `3000`：`admin-ui`
- `3104`：`control-plane`
- `3001`：`ai-gateway`
- `8790`：`ding-bridge`

### 2.2 当前 Harness 在哪里

当前 Harness 已经接入平台 UI，但后端归属是 `control-plane`：

- 前端代理 `'/api/v1/harness' -> control-plane`
- Harness 路由定义在 `control-plane/src/index.js`
- Harness 状态、checkpoint、runtime、summary 都存 `gateway_harness_*` 表

### 2.3 当前飞书在什么地方

当前仓库里飞书相关能力分成两类：

- `ai-gateway/src/notifications/feishu-notifier.js`
  - 用于网关预算告警、报告、限流通知
  - 通过 `FEISHU_WEBHOOK_URL` 发飞书机器人消息
- `projects/ding-bridge`
  - 主要是 OpenClaw/钉钉桥接
  - 另有 `feishuFallbackAlert.ts` 监听 OpenClaw 日志并给飞书发告警

### 2.4 当前真正缺的是什么

当前 Harness V1 缺的是这条链：

`Harness 卡片/Runtime 事件 -> 飞书通知`

以及这条更远的链：

`Harness Runtime -> 外部执行器（你本地那套 harness/openclaw 服务）`

## 3. 结论先行

建议分两阶段做：

### 阶段 A：先接飞书通知

目标：

- 让 Harness 的关键节点事件能发飞书
- 不改变现有 Runtime 执行模式
- 不破坏当前 `admin-ui + control-plane + ai-gateway` 结构

### 阶段 B：再接外部执行器

目标：

- 保留 `control-plane` 作为状态源和卡片编排器
- 把真正的执行逻辑从本地文件系统 Runtime，切换为外部 Harness/OpenClaw worker

这是我推荐的顺序，因为阶段 A 改动小、收益大，而且能为阶段 B 提前沉淀事件模型和通知模型。

## 4. 推荐方案

## 4.1 阶段 A 推荐方案：`control-plane -> ai-gateway -> 飞书`

### 为什么推荐这一条

因为当前飞书机器人能力已经在 `ai-gateway` 里存在，而 `control-plane` 目前没有飞书模块。

如果直接在 `control-plane` 里再写一套飞书发送器，会带来这些问题：

- 飞书配置分散
- 发送格式重复
- 后续还要维护两套通知逻辑

所以阶段 A 最合理的接法是：

1. `control-plane` 在 Harness 关键事件发生时，向 `ai-gateway` 发一个内部通知请求
2. `ai-gateway` 复用现有 `feishu-notifier`
3. `ai-gateway` 负责消息模板、飞书 webhook、重试和日志

### 阶段 A 拓扑

```text
admin-ui
  -> control-plane (/api/v1/harness/*)
    -> internal notification request
      -> ai-gateway (/api/v1/internal/notifications/harness)
        -> feishu-notifier
          -> 飞书群 / 飞书机器人
```

## 4.2 阶段 B 推荐方案：`control-plane -> 外部执行器 adapter`

阶段 B 不建议直接让 `admin-ui` 去连你外部 harness 服务。

建议保持单一状态源：

- `control-plane` 继续管理卡片状态、checkpoint、summary、runtime 记录
- `control-plane` 在 `startRuntime()` 时不再直接 `executeRuntimeRun()`
- 改为：
  - 生成 runtime run
  - 调用外部执行器 webhook / API
  - 等外部执行器回调结果

### 阶段 B 拓扑

```text
admin-ui
  -> control-plane
    -> create runtime run
    -> call external harness worker
      -> 你本地 harness / openclaw / 飞书链
    <- callback runtime status / logs / summary
  -> control-plane persists state
```

## 5. 阶段 A 详细设计

## 5.1 要发哪些 Harness 事件

先只发高价值事件，不要把所有日志都推到飞书。

推荐首批事件：

- `card.created`
- `checkpoint.waiting`
- `runtime.started`
- `runtime.failed`
- `runtime.completed`
- `uat.waiting`
- `uat.passed`
- `uat.failed`
- `summary.generated`

其中最有价值的 5 个其实是：

- `checkpoint.waiting`
- `runtime.failed`
- `uat.waiting`
- `uat.failed`
- `summary.generated`

## 5.2 飞书消息模板建议

建议统一使用“卡片摘要 + 当前动作 + 跳转信息”的简模板。

### 示例 1：等待人工确认

标题：

`Harness 待处理：等待需求/设计/UAT`

内容：

- 卡片编号
- 标题
- 当前阶段
- checkpoint 类型
- 仓库
- 最近 AI 动作
- 最近人工动作

### 示例 2：Runtime 失败

标题：

`Harness 异常：Runtime 失败`

内容：

- 卡片编号
- 标题
- runtime_run_id
- 阶段
- 错误摘要
- blocked_reason

### 示例 3：UAT 通过

标题：

`Harness 收口：UAT 已通过`

内容：

- 卡片编号
- 标题
- 当前阶段 `deploy_pending`
- summary_artifact_id

## 5.3 新增内部通知 API

建议在 `ai-gateway` 新增内部路由：

`POST /api/v1/internal/notifications/harness`

请求头：

- `x-internal-token: <HARNESS_NOTIFY_TOKEN>`

请求体建议：

```json
{
  "event_type": "runtime.failed",
  "trace_id": "trace-harness-runtime-abc123",
  "card": {
    "id": 8,
    "card_code": "REQ-2026-123456",
    "title": "Harness 本地仓库回归验收",
    "stage_key": "exception",
    "repo_url": "/Users/xiaoran/.openclaw/workspace/projects/ai-platform",
    "repo_branch": "main",
    "latest_ai_action": "Runtime 执行失败",
    "latest_human_action": "已确认设计",
    "blocked_reason": "单元测试三次失败"
  },
  "runtime_run": {
    "id": 13,
    "status": "failed",
    "test_command": "npm test",
    "test_result": "failed"
  },
  "checkpoint": {
    "checkpoint_type": "uat_acceptance",
    "status": "waiting"
  },
  "summary_artifact": {
    "id": 21,
    "title": "REQ-2026-123456 · AI Runtime 变更总结"
  }
}
```

响应：

```json
{
  "success": true,
  "data": {
    "delivered": true
  }
}
```

## 5.4 control-plane 如何调用

在 `control-plane` 中新增一个轻量 adapter，例如：

- `control-plane/src/integrations/harnessNotifier.js`

职责：

- 组装 payload
- 调 `ai-gateway` 内部通知接口
- 异常只记日志，不阻断主链路

建议环境变量：

- `HARNESS_NOTIFY_ENABLED=true`
- `HARNESS_NOTIFY_URL=http://127.0.0.1:3001/api/v1/internal/notifications/harness`
- `HARNESS_NOTIFY_TOKEN=...`

## 5.5 触发点建议

在 `control-plane/src/harness/store.js` 中，建议在这些位置触发：

- `createCard()` 完成后
- `createCheckpoint()` 后
- `startRuntime()` 后
- `executeRuntimeRun()` 成功结束时
- `executeRuntimeRun()` catch 时
- `submitUatResult()` pass/fail 分支中

注意：

不要在 `appendLog()` 每次调用时都推飞书，否则消息会炸群。

## 5.6 阶段 A 改动文件建议

### control-plane

- 新增 `src/integrations/harnessNotifier.js`
- 更新 `src/harness/store.js`
- 可选：更新 `src/index.js` 注入 logger/config

### ai-gateway

- 新增 `src/routes/internal-notifications.js`
- 更新 `src/index.js` 注册路由
- 可选：增强 `src/notifications/feishu-notifier.js`，新增 Harness 专用格式化函数

## 6. 阶段 B 详细设计

## 6.1 阶段 B 的核心原则

阶段 B 不要让外部执行器直接改 Harness 主表状态。

推荐原则：

- `control-plane` 是唯一状态源
- 外部执行器是无状态 worker
- 外部执行器只接受任务、执行任务、回调结果

## 6.2 新增外部执行器 API

建议定义两类接口：

### 1. 下发执行任务

`POST /api/v1/internal/harness/runtime-dispatch`

由 `control-plane` 调外部执行器。

请求体：

```json
{
  "runtime_run_id": 13,
  "card_id": 8,
  "trace_id": "trace-harness-runtime-abc123",
  "repo_url": "/Users/xiaoran/.openclaw/workspace/projects/ai-platform",
  "repo_branch": "main",
  "change_request": "修复本地仓库回归问题并重新执行测试",
  "target_file": null
}
```

### 2. 回调执行结果

`POST /api/v1/harness/runtime-runs/:id/callback`

由外部执行器回调 `control-plane`。

请求体：

```json
{
  "status": "completed",
  "test_command": "npm test",
  "test_result": "passed",
  "logs": [
    { "level": "info", "content": "工作区已准备" },
    { "level": "info", "content": "已执行单元测试" }
  ],
  "summary": {
    "title": "REQ-2026-123456 · AI Runtime 变更总结",
    "content": "..."
  },
  "changed_files": [
    "src/index.ts",
    "tests/foo.test.ts"
  ]
}
```

## 6.3 为什么不建议直接复用当前 `ding-bridge`

因为当前 `ding-bridge` 的职责是：

- 接收钉钉消息
- 调用 OpenClaw
- 回消息

它不是一个适合承接 `Harness runtime callback` 的通用任务执行器。

如果硬复用，会出现职责混乱：

- 即时聊天桥
- Runtime worker
- 飞书回调监控

建议是：

- `ding-bridge` 继续做聊天桥
- 新增 `harness-executor-adapter` 或在现有本地 harness 服务里暴露标准回调接口

## 6.4 阶段 B 改动文件建议

### control-plane

- `src/harness/store.js`
  - 把 `setImmediate(() => executeRuntimeRun())` 改成 dispatch 模式
- `src/index.js`
  - 新增 callback route
- 新增 `src/integrations/harnessExecutorClient.js`

### 外部执行器

- 新增 dispatch 接口
- 新增 callback 客户端
- 统一 `trace_id / runtime_run_id / card_id`

## 7. 推荐实施顺序

### 第 1 步

先做阶段 A：

- Harness 关键事件推飞书
- 让业务和项目经理能实时看到待确认、失败、UAT 结果

这是最小见效路径。

### 第 2 步

验证事件模型稳定后，再做阶段 B：

- 把 Runtime 执行器抽出去

### 第 3 步

最后才考虑更深的整合：

- 飞书交互式卡片回写
- 在飞书里直接点“确认需求 / 确认设计 / UAT 通过”

这是锦上添花，不是第一优先级。

## 8. 风险点

### 8.1 通知风暴

如果把日志级事件都推飞书，会造成刷屏。

控制方式：

- 只推关键状态事件
- 同一 `runtime_run_id` 的重复失败可做去重

### 8.2 状态不一致

如果阶段 B 让外部执行器直接改库，很容易失控。

控制方式：

- 外部执行器只回调
- 由 `control-plane` 最终落库

### 8.3 飞书配置散落

如果 `control-plane` 和 `ai-gateway` 都各自直连飞书，后面会难维护。

控制方式：

- 飞书统一收口在 `ai-gateway`

## 9. 最终推荐

我推荐你们现在就按下面这条走：

### 推荐正式方案

`Harness 卡片/Runtime 事件 -> control-plane 通知适配器 -> ai-gateway 内部通知接口 -> 飞书`

原因：

- 最贴合当前代码结构
- 不需要推翻现有 Harness V1
- 能复用 `ai-gateway` 已有飞书能力
- 后续还能自然升级到“外部执行器模式”

## 10. 对应任务拆分

可以直接拆成 4 个开发任务：

1. `ai-gateway` 新增 Harness 内部通知路由
2. `control-plane` 新增 Harness 通知适配器
3. `control-plane` 在关键事件处触发通知
4. 联调飞书消息模板与去重策略

如果要继续到阶段 B，再追加：

5. `control-plane` Runtime dispatch 抽象
6. 外部执行器 callback 协议实现
