# AI Gateway

独立化后的 AI 网关服务，提供统一 LLM 接入、模型路由、配额与预算控制、调用审计，以及若干内部研究与通知接口。

## 功能概览

- OpenAI 兼容聊天入口：`POST /v1/chat/completions`
- 模型列表与配额查询：`GET /v1/models`、`GET /v1/quota`
- API Key、团队、用量与设置管理接口
- 成本追踪、审计日志、预算检查、限流
- DeepWiki 研究、门禁执行与飞书通知相关接口

## 本地启动

1. 复制 `.env.example` 为 `.env`
2. 按需填写数据库和模型厂商密钥
3. 安装依赖：`npm install`
4. 启动服务：`npm start`

默认端口为 `3001`。

## 测试

- 运行测试：`npm test`
- 查看覆盖率：`npm run test:coverage`

## 说明

- 这个仓库不包含 `node_modules`、日志、覆盖率产物和本地运行数据。
- 运行时会自动创建 `logs/`、`data/` 和 `storage/` 下所需目录。
