# `gateway_usage_logs.user_id` 语义与迁移说明

## 期望语义（当前版本）

| 字段 | 含义 |
|------|------|
| `api_key_id` | `gateway_api_keys.id`，每次请求使用的 Key 行主键 |
| `user_id` | **`gateway_users.id`**（平台用户），来自 **`gateway_api_keys.created_by`**；若 Key 无创建人则为 `NULL` |
| `team_id` | **`gateway_teams.id`**（若 Key 行有 `team_id` 列）；不再用 API Key 行主键冒充团队 ID |

## 兼容与历史数据

- **旧日志**：升级网关前写入的 `user_id` 可能与 `api_key_id` 相同（历史 bug）；新请求按上表语义写入。
- **旧 Key**：`created_by` 为 `NULL` 时，新日志里 `user_id` 为 `NULL`，归因请继续用 `api_key_id` JOIN `gateway_api_keys`。
- **管理 API**（`/v1/teams` 等）的 `created_by` 现与用量日志一致：均为 **`gateway_users.id`**（由当前请求所用 Key 的 `created_by` 推导）。

## 数据库

团队 Key 路径依赖 `gateway_api_keys.team_id`（与 `team-manager` 插入语句一致）。若库表缺列，需执行：

```sql
ALTER TABLE gateway_api_keys
  ADD COLUMN team_id INT NULL COMMENT '所属团队 gateway_teams.id' AFTER created_by,
  ADD INDEX idx_team_id (team_id);
```

（若列已存在可跳过。）

## 代码入口

- `src/middleware/auth.js`：`req.apiKeyId`、`req.gatewayUserId`、`req.userId`、`req.teamId`
- `src/routes/model-router.js`：`persistCompletionUsage` → `logUsage`
