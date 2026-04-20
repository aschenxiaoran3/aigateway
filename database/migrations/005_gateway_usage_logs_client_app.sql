-- 用量日志：客户端标识（与 Header metadata 对齐），便于管理台区分 Cursor / OpenClaw / Hermes 等
-- 在已有库执行一次即可。

ALTER TABLE `gateway_usage_logs`
  ADD COLUMN `client_app` VARCHAR(64) NULL COMMENT '客户端标识 cursor/openclaw/hermes 等' AFTER `response_time_ms`,
  ADD COLUMN `user_agent` VARCHAR(512) NULL COMMENT '请求 User-Agent 摘要' AFTER `client_app`;
