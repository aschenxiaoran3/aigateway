-- AI Gateway 数据库表结构
-- 数据库：aiplan_erp_test
-- 创建时间：2026-04-09

-- ========== 1. API Key 管理表 ==========
CREATE TABLE IF NOT EXISTS `gateway_api_keys` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键 ID',
  `api_key` VARCHAR(64) NOT NULL UNIQUE COMMENT 'API Key',
  `type` ENUM('team', 'user', 'proj') NOT NULL DEFAULT 'team' COMMENT '类型',
  `name` VARCHAR(100) NOT NULL COMMENT '名称',
  `description` TEXT COMMENT '描述',
  `quota_daily` BIGINT NOT NULL DEFAULT 100000 COMMENT '日配额 (Token 数)',
  `quota_monthly` BIGINT NOT NULL DEFAULT 3000000 COMMENT '月配额 (Token 数)',
  `used_daily` BIGINT NOT NULL DEFAULT 0 COMMENT '日用量',
  `used_monthly` BIGINT NOT NULL DEFAULT 0 COMMENT '月用量',
  `allowed_models` JSON COMMENT '允许的模型列表',
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  `created_by` INT COMMENT '创建人 gateway_users.id',
  `team_id` INT NULL COMMENT '所属团队 gateway_teams.id（团队 Key 等）',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  `last_used_at` DATETIME COMMENT '最后使用时间',
  INDEX `idx_api_key` (`api_key`),
  INDEX `idx_type` (`type`),
  INDEX `idx_status` (`status`),
  INDEX `idx_team_id` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='API Key 管理表';

-- ========== 2. 团队信息表 ==========
CREATE TABLE IF NOT EXISTS `gateway_teams` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键 ID',
  `name` VARCHAR(100) NOT NULL COMMENT '团队名称',
  `description` TEXT COMMENT '描述',
  `members_count` INT NOT NULL DEFAULT 0 COMMENT '成员数',
  `quota_daily` BIGINT NOT NULL DEFAULT 150000 COMMENT '日配额',
  `quota_monthly` BIGINT NOT NULL DEFAULT 4500000 COMMENT '月配额',
  `used_daily` BIGINT NOT NULL DEFAULT 0 COMMENT '日用量',
  `used_monthly` BIGINT NOT NULL DEFAULT 0 COMMENT '月用量',
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_name` (`name`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='团队信息表';

-- ========== 3. 用户信息表 ==========
CREATE TABLE IF NOT EXISTS `gateway_users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键 ID',
  `username` VARCHAR(50) NOT NULL UNIQUE COMMENT '用户名',
  `email` VARCHAR(100) COMMENT '邮箱',
  `team_id` INT COMMENT '所属团队 ID',
  `role` ENUM('admin', 'member', 'viewer') NOT NULL DEFAULT 'member' COMMENT '角色',
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_username` (`username`),
  INDEX `idx_team_id` (`team_id`),
  FOREIGN KEY (`team_id`) REFERENCES `gateway_teams`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用户信息表';

-- ========== 4. 用量日志表 ==========
CREATE TABLE IF NOT EXISTS `gateway_usage_logs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键 ID',
  `api_key_id` INT NOT NULL COMMENT 'API Key ID',
  `request_id` VARCHAR(64) NOT NULL COMMENT '请求 ID',
  `model` VARCHAR(50) NOT NULL COMMENT '使用的模型',
  `provider` VARCHAR(50) NOT NULL COMMENT 'Provider',
  `prompt_tokens` INT NOT NULL DEFAULT 0 COMMENT '输入 Token 数',
  `completion_tokens` INT NOT NULL DEFAULT 0 COMMENT '输出 Token 数',
  `total_tokens` INT NOT NULL DEFAULT 0 COMMENT '总 Token 数',
  `cost_cny` DECIMAL(10,6) NOT NULL DEFAULT 0.000000 COMMENT '成本 (CNY)',
  `purpose` VARCHAR(100) COMMENT '用途',
  `pipeline` VARCHAR(50) COMMENT '管道',
  `user_id` INT COMMENT '平台用户 gateway_users.id（来自 api_keys.created_by；无则 NULL）',
  `team_id` INT COMMENT '团队 gateway_teams.id',
  `status` ENUM('success', 'failed') NOT NULL DEFAULT 'success' COMMENT '状态',
  `error_message` TEXT COMMENT '错误信息',
  `response_time_ms` INT COMMENT '响应时间 (ms)',
  `client_app` VARCHAR(64) NULL COMMENT '客户端标识 cursor/openclaw/hermes 等',
  `user_agent` VARCHAR(512) NULL COMMENT '请求 User-Agent 摘要',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  INDEX `idx_api_key_id` (`api_key_id`),
  INDEX `idx_model` (`model`),
  INDEX `idx_created_at` (`created_at`),
  INDEX `idx_team_id` (`team_id`),
  FOREIGN KEY (`api_key_id`) REFERENCES `gateway_api_keys`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='用量日志表';

-- ========== 5. 成本记录表 ==========
CREATE TABLE IF NOT EXISTS `gateway_cost_records` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键 ID',
  `team_id` INT COMMENT '团队 ID',
  `api_key_id` INT COMMENT 'API Key ID',
  `model` VARCHAR(50) NOT NULL COMMENT '模型',
  `date` DATE NOT NULL COMMENT '日期',
  `total_tokens` BIGINT NOT NULL DEFAULT 0 COMMENT '总 Token 数',
  `total_cost` DECIMAL(10,6) NOT NULL DEFAULT 0.000000 COMMENT '总成本',
  `request_count` INT NOT NULL DEFAULT 0 COMMENT '请求次数',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  UNIQUE KEY `uk_date_team_model` (`date`, `team_id`, `model`),
  INDEX `idx_date` (`date`),
  INDEX `idx_team_id` (`team_id`),
  INDEX `idx_model` (`model`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='成本记录表';

-- ========== 6. 门禁规则表 ==========
CREATE TABLE IF NOT EXISTS `gateway_gate_rules` (
  `id` INT AUTO_INCREMENT PRIMARY KEY COMMENT '主键 ID',
  `gate_type` VARCHAR(50) NOT NULL COMMENT '门禁类型 (prd/tech/code)',
  `gate_name` VARCHAR(100) NOT NULL COMMENT '门禁名称',
  `version` VARCHAR(20) NOT NULL COMMENT '版本号',
  `rules_config` JSON NOT NULL COMMENT '规则配置 (JSON)',
  `status` ENUM('active', 'disabled') NOT NULL DEFAULT 'active' COMMENT '状态',
  `created_by` INT COMMENT '创建人 ID',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  INDEX `idx_gate_type` (`gate_type`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='门禁规则表';

-- ========== 7. 门禁执行记录表 ==========
CREATE TABLE IF NOT EXISTS `gateway_gate_executions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY COMMENT '主键 ID',
  `gate_type` VARCHAR(50) NOT NULL COMMENT '门禁类型',
  `gate_name` VARCHAR(100) NOT NULL COMMENT '门禁名称',
  `document_name` VARCHAR(200) COMMENT '文档名称',
  `author` VARCHAR(100) COMMENT '作者',
  `total_score` INT NOT NULL DEFAULT 0 COMMENT '总分',
  `max_score` INT NOT NULL DEFAULT 0 COMMENT '满分',
  `passed` TINYINT(1) NOT NULL DEFAULT 0 COMMENT '是否通过',
  `failed_checks` JSON COMMENT '失败检查项',
  `check_results` JSON COMMENT '检查结果详情',
  `client_run_id` VARCHAR(64) NULL COMMENT '客户端幂等键',
  `execution_meta` JSON NULL COMMENT 'rule_id/rule_version/artifact_fingerprint/source/duration_ms/trace_id',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  UNIQUE KEY `uk_client_run_id` (`client_run_id`),
  INDEX `idx_gate_type` (`gate_type`),
  INDEX `idx_passed` (`passed`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='门禁执行记录表';
