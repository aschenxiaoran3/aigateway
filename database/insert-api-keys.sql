-- 插入示例 API Key
-- 执行时间：2026-04-09

-- 清空现有数据（可选）
-- DELETE FROM gateway_api_keys;

-- 插入 DeepSeek 和千问的 API Key 示例
INSERT INTO `gateway_api_keys` 
(`api_key`, `type`, `name`, `description`, `quota_daily`, `quota_monthly`, `allowed_models`, `status`, `created_at`)
VALUES
-- DeepSeek API Key
('sk-your-deepseek-api-key', 'team', 'DeepSeek 官方', 'DeepSeek 官方 API Key，用于 DeepSeek Chat 模型调用', 500000, 15000000, '["deepseek"]', 'active', NOW()),

-- 千问 API Key
('sk-your-qwen-api-key', 'team', '通义千问官方', '阿里云通义千问 API Key，用于 Qwen 模型调用', 500000, 15000000, '["qwen"]', 'active', NOW()),

-- 技术部统一 Key（同时支持 DeepSeek 和千问）
('team_deepseek_qwen_001', 'team', '技术部 - AI 网关', '技术部专用，支持 DeepSeek 和 Qwen 模型', 500000, 15000000, '["deepseek", "qwen"]', 'active', NOW());

-- 验证插入结果
SELECT 
  id,
  api_key,
  type,
  name,
  quota_daily,
  quota_monthly,
  allowed_models,
  status,
  created_at
FROM gateway_api_keys
ORDER BY created_at DESC;
