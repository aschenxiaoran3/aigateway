-- AI Gateway 初始化数据
-- 执行时间：2026-04-09

-- ========== 1. 插入初始 API Key ==========
INSERT INTO `gateway_api_keys` 
(`api_key`, `type`, `name`, `description`, `quota_daily`, `quota_monthly`, `allowed_models`, `status`)
VALUES
('team_deepseek_qwen_001', 'team', '技术部 - AI 网关', '技术部专用，支持 DeepSeek 和 Qwen 模型', 500000, 15000000, '["deepseek", "qwen"]', 'active'),
('proj_goushang_001', 'proj', '购商云汇项目', '购商云汇项目专用', 200000, 6000000, '["deepseek", "qwen"]', 'active'),
('user_admin_001', 'user', '管理员', '管理员测试用', 100000, 3000000, '["deepseek", "qwen"]', 'active');

-- ========== 2. 插入初始团队 ==========
INSERT INTO `gateway_teams` 
(`name`, `description`, `members_count`, `quota_daily`, `quota_monthly`, `status`)
VALUES
('技术部', '技术研发团队', 25, 500000, 15000000, 'active'),
('产品部', '产品团队', 8, 200000, 6000000, 'active'),
('测试部', '测试团队', 5, 100000, 3000000, 'active');

-- ========== 3. 插入管理员用户 ==========
INSERT INTO `gateway_users` 
(`username`, `email`, `team_id`, `role`, `status`)
VALUES
('admin', 'admin@goushang.com', 1, 'admin', 'active');

-- 查询验证
SELECT 'API Keys:' as table_name, COUNT(*) as count FROM gateway_api_keys
UNION ALL
SELECT 'Teams:', COUNT(*) FROM gateway_teams
UNION ALL
SELECT 'Users:', COUNT(*) FROM gateway_users;
