-- 修复数据库权限
-- 执行方式：mysql -h <db-host> -P 3306 -u <db-admin-user> -p <db-name> < fix-permissions.sql

-- 方案 1: 给现有用户授权（需要 root 权限）
-- GRANT ALL PRIVILEGES ON aiplan_erp_test.* TO 'erp_test'@'%';
-- FLUSH PRIVILEGES;

-- 方案 2: 创建新用户（推荐）
-- 注意：需要在阿里云 RDS 控制台执行，或者用 root 用户执行

-- 创建新用户 gateway_user
CREATE USER IF NOT EXISTS 'gateway_user'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

-- 授权
GRANT SELECT, INSERT, UPDATE, DELETE ON aiplan_erp_test.* TO 'gateway_user'@'%';
GRANT CREATE, ALTER, INDEX ON aiplan_erp_test.* TO 'gateway_user'@'%';
FLUSH PRIVILEGES;

-- 验证权限
SHOW GRANTS FOR 'gateway_user'@'%';

-- 测试插入
INSERT INTO gateway_api_keys 
(api_key, type, name, description, quota_daily, quota_monthly, allowed_models, status)
VALUES
('test_key_001', 'user', '测试 Key', '测试用', 100000, 3000000, '["deepseek", "qwen"]', 'active');

-- 清理测试数据
DELETE FROM gateway_api_keys WHERE api_key = 'test_key_001';

-- 显示结果
SELECT '权限修复完成！' as result;
