# 飞书事件订阅接入清单

本文档用于把 `ai-platform` 当前已经跑通的 `Feishu -> callback -> control-plane -> Harness` 回流链路正式接到飞书开放平台。

## 当前可用配置

- 事件回调地址：
  `https://tamil-bacteria-muze-republic.trycloudflare.com/api/v1/feishu/callbacks`
- 事件校验 Token：
  `9ff7e30f8b5469aa9e051a09f9f2dc59`
- 本地目标服务：
  - `ai-gateway`: `http://127.0.0.1:3001`
  - `control-plane`: `http://127.0.0.1:3104`

注意：

- 当前公网地址来自 `cloudflared quick tunnel`
- 只要本机的 tunnel 进程停止，地址就会失效
- 如果后续要长期稳定使用，建议改成固定域名 / named tunnel

## 飞书控制台配置

建议在飞书开放平台中，针对当前机器人或应用完成以下设置。

### 1. 机器人能力

- 确认应用已启用机器人能力
- 确认机器人允许接收消息
- 确认机器人允许给当前测试用户发消息

### 2. 事件订阅

- 打开应用的事件订阅配置
- 请求地址填入：
  `https://tamil-bacteria-muze-republic.trycloudflare.com/api/v1/feishu/callbacks`
- Token 填入：
  `9ff7e30f8b5469aa9e051a09f9f2dc59`
- 保存后，飞书会先发一次 `challenge`
- 当前接口已经验证通过，会原样返回 `challenge`

### 3. 事件项

至少勾选：

- `im.message.receive_v1`

这是当前代码实际消费的事件类型，见：
[feishu-callbacks.js](/Users/xiaoran/.openclaw/workspace/projects/ai-platform/ai-gateway/src/routes/feishu-callbacks.js:77)

### 4. 权限建议

最小建议：

- 允许机器人接收用户消息
- 允许应用发送消息给用户

如果飞书控制台提示还需要补消息相关权限，按控制台最小要求补齐即可。

## 当前回复体验

当前回流链路已经支持“按钮优先，文本兜底”：

- Harness checkpoint 会优先发交互卡片
- 多条待确认同时存在时，建议直接点各自卡片上的按钮
- 文本回复仍然保留，用来补充备注或兜底
- 对通用 `Codex` 确认题，也已经支持自定义按钮卡片
- 如果当前只有一条待确认，你也可以直接回：
  - `确认，可以开始`
  - `通过，收口吧`
  - `打回，补一下 xxx`
- 如果同时挂着多条待确认，又没有点按钮，系统仍可能要求你补 `HP-xxxx`

当前实现位置：

- Prompt 存储与自动推进：
  [store.js](/Users/xiaoran/.openclaw/workspace/projects/ai-platform/control-plane/src/harness/store.js:192)
- 飞书回调解析：
  [feishu-callbacks.js](/Users/xiaoran/.openclaw/workspace/projects/ai-platform/ai-gateway/src/routes/feishu-callbacks.js:67)
- 出站消息格式：
  [internal-notifications.js](/Users/xiaoran/.openclaw/workspace/projects/ai-platform/ai-gateway/src/routes/internal-notifications.js:71)

## 验收步骤

推荐按下面顺序验收。

### A. 挑战握手

验证公网回调地址健康：

```bash
curl -sS https://tamil-bacteria-muze-republic.trycloudflare.com/health
```

验证 `challenge` 握手：

```bash
curl -sS -X POST https://tamil-bacteria-muze-republic.trycloudflare.com/api/v1/feishu/callbacks \
  -H 'content-type: application/json' \
  -d '{"challenge":"codex-feishu-challenge"}'
```

期望结果：

- 返回 `{"challenge":"codex-feishu-challenge"}`

### B. 出站消息

创建或推进一张 Harness 卡片，让它进入人工确认点。

期望结果：

- 飞书收到交互卡片
- 卡片里包含问题说明、按钮和文本回复提示

也可以直接创建一条通用 `Codex` 确认题：

```bash
node /Users/xiaoran/.openclaw/workspace/scripts/codex-feishu-prompt.cjs create \
  --question "是否继续执行当前操作？" \
  --option "是|是|primary" \
  --option "否|否|danger"
```

### C. 按钮点击或自然回复

在飞书里直接：

- 点击卡片按钮
- 或回复：
  - `确认，可以开始`
  - `通过，收口吧`

期望结果：

- 对应 prompt 状态从 `pending` 变成 `answered`
- Harness 卡片自动推进到下一阶段

### D. 本地核对

查看待确认队列：

```bash
curl -sS 'http://127.0.0.1:3104/api/v1/harness/human-prompts?status=pending&limit=10'
```

查看单条 prompt：

```bash
curl -sS http://127.0.0.1:3104/api/v1/harness/human-prompts/HP-xxxx
```

查看卡片：

```bash
curl -sS http://127.0.0.1:3104/api/v1/harness/cards/8
```

## 本轮已验证结果

本地已完成的真实验证：

- 公网 tunnel 可访问
- 公网 `challenge` 握手可访问
- 通过公网 callback 模拟真实飞书事件：
  - 交互卡片按钮点击
  - `确认，可以开始`
  - `通过，收口吧`
- Harness 测试卡 `REQ-FEISHU-REPLY-001` 已从设计确认推进到 Runtime，再从 `uat_wait` 推进到 `deploy_pending`
- `Codex` 测试卡 `REQ-FEISHU-BUTTON-001` 已通过三次按钮点击推进到 `deploy_pending`

## 已知边界

- `quick tunnel` 不是固定地址
- 目前这套能力覆盖的是“我们自定义的确认问题”和 Harness checkpoint
- Codex 桌面端原生权限弹窗不属于这条飞书回流链路
- 如果飞书控制台对交互卡片有额外开关或审批项，需要一并开启；当前服务端已兼容按钮回调 payload

## 下一步建议

优先顺序建议：

1. 先在飞书控制台接好当前 quick tunnel，完成一次真人回流验收
2. 再把 tunnel 升级成固定域名
3. 把更多非 Harness 的 Codex 业务确认统一接进这套 prompt 队列
