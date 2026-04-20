# Codex 飞书确认工作流

本文档说明如何把 `Codex` 在工作中需要你拍板的事项，统一发到飞书，并通过按钮或回复把答案回流到本地。

## 适用范围

当前这条链适合：

- 业务确认
- 产品取舍
- 实施路径选择
- Harness checkpoint 之外的通用 `Codex` 确认题

当前不适合直接改造成飞书审批的：

- Codex 桌面端原生权限弹窗
- 本地沙箱提权确认
- 任何必须在 Codex 客户端 UI 内点选的系统级审批

一句话说，就是“我们自己定义的问题”可以走飞书，“Codex 客户端自己定义的弹窗”暂时还不行。

如果目标是进一步逼近“所有批准都在飞书里完成”，请继续看：

- [Codex 飞书审批代理设计稿](/Users/xiaoran/.openclaw/workspace/projects/ai-platform/docs/codex-feishu-approval-broker-design.md)

那份设计稿给出的路线不是直接替换原生弹窗，而是把多数高风险动作前移成飞书审批代理。

## 当前链路

```text
Codex / 本地脚本
  -> control-plane (/api/v1/harness/human-prompts/local)
  -> ai-gateway (/api/v1/internal/notifications/human-prompts)
  -> 飞书交互卡片
  -> 飞书回调 (/api/v1/feishu/callbacks)
  -> control-plane 回写 prompt answer
  -> Codex 轮询结果并继续执行
```

## 当前交互方式

### 1. 单个事项

推荐直接发一张飞书交互卡片，带 2-3 个按钮。

例如：

- `是`
- `是，且后续同类默认继续`
- `否，请调整后再来`

### 2. 多个事项同时待确认

每条待确认发独立卡片。

你直接点击对应卡片上的按钮即可，不需要手工记 `HP-xxxx`。

### 3. 需要补充备注

仍然可以在飞书里直接回复：

- `HP-xxxx + 备注`
- 或自然语言回复，如果当前只有一条待确认

## 本地脚本

工作区里已经提供了一个给 Codex 用的脚本：

`/Users/xiaoran/.openclaw/workspace/scripts/codex-feishu-prompt.cjs`

### 创建一条确认题

```bash
node /Users/xiaoran/.openclaw/workspace/scripts/codex-feishu-prompt.cjs create \
  --question "是否继续执行本地 Harness cards 查询？" \
  --instructions "优先点按钮；需要补充说明时直接回飞书消息" \
  --option "是|是|primary" \
  --option "是，且同类问题后续默认继续|是，且同类问题后续默认继续|primary" \
  --option "否，请先告诉我应该怎么调整|否，请先告诉我应该怎么调整|danger"
```

### 创建并等待飞书回复

```bash
node /Users/xiaoran/.openclaw/workspace/scripts/codex-feishu-prompt.cjs ask \
  --question "这个发布前校验是否现在就做？" \
  --option "现在就做|现在就做|primary" \
  --option "先做别的，稍后再做|先做别的，稍后再做" \
  --option "先别做，请解释原因|先别做，请解释原因|danger" \
  --timeout-seconds 900
```

### 等待已有 prompt

```bash
node /Users/xiaoran/.openclaw/workspace/scripts/codex-feishu-prompt.cjs wait \
  --prompt-code HP-XXXXXXX
```

## 按钮卡片约定

脚本中的每个 `--option` 使用下面格式：

`label|answer_text|type|action`

字段说明：

- `label`：飞书按钮上显示什么
- `answer_text`：点击后回写给 prompt 的标准答案
- `type`：`primary / default / danger`
- `action`：可选，自定义动作名；不填会自动生成

最常用的是前三段，第四段通常可以省略。

## 对 Codex 的默认建议

后续当 Codex 遇到“需要你拍板才能继续”的问题时，默认建议这样处理：

1. 如果是业务/产品/执行策略问题，直接发飞书确认卡片
2. 如果是普通单选或双选题，优先用按钮，不先发长文本
3. 如果任务被这个决定阻塞，就等待飞书回复后再继续
4. 如果是 Codex 客户端原生提权/权限弹窗，仍然走客户端原生确认

## 默认执行规范

为了让这件事变成稳定工作流，而不是临时约定，后续默认按下面的规则执行：

### 1. 默认发飞书

只要同时满足下面两点，就默认发飞书确认卡：

- 这个决定会影响 Codex 下一步要不要继续或怎么继续
- 这个决定不是 Codex 客户端原生审批

常见例子：

- 是否继续某项实现
- 先做 A 还是先做 B
- 当前方案直接推进，还是先回滚到更稳的方案
- UAT 通过还是打回
- 是否允许执行一个业务层面的高风险动作

### 2. 默认卡片结构

优先使用 2-3 个按钮，不要把问题做成开放式问答。

推荐按钮结构：

- 推荐继续
- 暂缓或延后
- 拒绝或调整后再来

如果用户还需要补充说明，再让文本回复承担备注功能。

### 3. 默认继续方式

如果任务被这个决定阻塞：

- 发飞书确认卡
- 等待飞书回流结果
- 在聊天里简短同步“已收到飞书确认：xxx”
- 按结果继续执行

如果任务不被阻塞：

- 可以先继续做不依赖该决定的部分
- 等飞书结果回来后再收口分支动作

### 4. 默认不走飞书的场景

下面这些仍然不要改造成飞书审批：

- Codex 桌面端原生提权弹窗
- 沙箱外执行审批
- 必须在当前客户端里即时确认的系统级动作
- 用户明确要求“直接在聊天里决定”

## 推荐模板

### 模板一：继续 / 延后 / 调整

```bash
bash /Users/xiaoran/.openclaw/workspace/scripts/codex-feishu-prompt.sh ask \
  --question "这个动作是否现在继续执行？" \
  --instructions "优先点按钮；如果要补充背景，直接回复飞书消息。" \
  --option "继续执行|继续执行|primary" \
  --option "稍后再做|稍后再做" \
  --option "先调整方案|先调整方案|danger"
```

### 模板二：方案 A / 方案 B / 我先重做

```bash
bash /Users/xiaoran/.openclaw/workspace/scripts/codex-feishu-prompt.sh ask \
  --question "这一步你希望我按哪个方案推进？" \
  --option "方案 A|方案 A|primary" \
  --option "方案 B|方案 B" \
  --option "都不要，我先重做方案|都不要，我先重做方案|danger"
```

## 当前依赖

- `control-plane` 本地运行在 `3104`
- `ai-gateway` 本地运行在 `3001`
- 飞书公网回调当前使用：
  `https://tamil-bacteria-muze-republic.trycloudflare.com/api/v1/feishu/callbacks`

## 当前已实现的审批代理 MVP

当前仓库已经有第一期审批代理骨架：

- 审批任务 API：
  - `POST /api/v1/approval-tasks/local`
  - `GET /api/v1/approval-tasks`
  - `GET /api/v1/approval-tasks/:id`
- Broker 回写 API：
  - `POST /api/v1/internal/approval-tasks/:id/execution-start`
  - `POST /api/v1/internal/approval-tasks/:id/execution-result`
- 本地 broker 脚本：
  - `/Users/xiaoran/.openclaw/workspace/projects/ai-platform/scripts/codex-approval-broker.cjs`
- 根项目 npm script：
  - `npm run approval:broker`
  - `npm run approval:broker:watch`

当前白名单模板：

- `git_pull`
- `git_push_current_branch`
- `npm_run_deploy`

## 本地共享配置

- 项目根目录新增了共享本地配置约定：
  - 示例文件：[.env.shared.local.example](/Users/xiaoran/.openclaw/workspace/projects/ai-platform/.env.shared.local.example)
  - 本地实际文件：`.env.shared.local`
  - 忽略规则：[.gitignore](/Users/xiaoran/.openclaw/workspace/projects/ai-platform/.gitignore)
- 这份共享配置主要承接：
  - `HARNESS_NOTIFY_TOKEN`
  - `FEISHU_EVENT_VERIFY_TOKEN`
  - `HUMAN_PROMPT_NOTIFY_URL`
  - `FEISHU_REPLY_FORWARD_URL`
  - `FEISHU_PROMPT_LIST_URL`
- 推荐做法：
  - 飞书 `APP_ID / APP_SECRET` 继续放在你本机 secrets 文件里
  - `control-plane`、`ai-gateway`、`approval broker` 共用的内部联调参数放在 `.env.shared.local`
  - 这样服务重启后不会再出现内部 token 漂移

## 2026-04-18 收口结果

- `approval broker once` 的 `400` 已修复
  - 根因：broker 的 `GET` 请求错误地带了 `null` JSON body
  - 修复后不会再给 `GET /api/v1/approval-tasks?...` 发送 body
- human prompt 通知链已加重试和更详细的错误日志
- 本轮 live 验证任务：
  - `AT-90788B7E`
  - `HP-80F329EC`
  - 最终状态：`executed_success`
- 本轮实测链路：
  - `control-plane` 创建 approval task
  - `ai-gateway` 成功投递飞书确认卡
  - `Feishu callback` 回写 prompt
  - `approval broker once` 执行 `npm run deploy`
  - `control-plane` 回写 `executor_logs_json / result_payload_json`

## 已知边界

- 当前公网入口是 `cloudflared quick tunnel`，不是固定地址
- 自定义 prompt 已支持按钮，但“点击后回写原卡片为已处理样式”还可以继续增强
- 文本回复仍保留，是按钮方案的兜底，不是主路径
