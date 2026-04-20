CREATE TABLE IF NOT EXISTS `gateway_code_repositories` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `repo_key` VARCHAR(64) NOT NULL UNIQUE,
  `project_code` VARCHAR(64) NULL,
  `name` VARCHAR(255) NOT NULL,
  `local_path` VARCHAR(1024) NOT NULL,
  `default_branch` VARCHAR(128) NULL,
  `language` VARCHAR(64) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_gateway_code_repositories_project_code` (`project_code`),
  INDEX `idx_gateway_code_repositories_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='平台注册代码仓库目录';

CREATE TABLE IF NOT EXISTS `gateway_doc_bundle_contexts` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `workflow_mode` VARCHAR(32) NOT NULL DEFAULT 'upload_existing',
  `code_repository_id` BIGINT NULL,
  `knowledge_scope_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_doc_bundle_contexts_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_doc_bundle_contexts_code_repository_id` FOREIGN KEY (`code_repository_id`) REFERENCES `gateway_code_repositories`(`id`) ON DELETE SET NULL,
  UNIQUE KEY `uk_gateway_doc_bundle_contexts_bundle_id` (`bundle_id`),
  INDEX `idx_gateway_doc_bundle_contexts_workflow_mode` (`workflow_mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='文档任务上下文（模式/仓库/知识范围）';

CREATE TABLE IF NOT EXISTS `gateway_repo_context_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `code_repository_id` BIGINT NOT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'ready',
  `summary_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_repo_context_runs_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_repo_context_runs_code_repository_id` FOREIGN KEY (`code_repository_id`) REFERENCES `gateway_code_repositories`(`id`) ON DELETE CASCADE,
  INDEX `idx_gateway_repo_context_runs_bundle_id` (`bundle_id`),
  INDEX `idx_gateway_repo_context_runs_repo_id` (`code_repository_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技术方案生成前的仓库上下文抽取结果';

CREATE TABLE IF NOT EXISTS `gateway_tech_spec_generation_runs` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `bundle_id` BIGINT NOT NULL,
  `repo_context_run_id` BIGINT NULL,
  `draft_artifact_id` BIGINT NULL,
  `final_artifact_id` BIGINT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'draft',
  `generation_summary_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_tech_spec_generation_runs_bundle_id` FOREIGN KEY (`bundle_id`) REFERENCES `gateway_doc_bundles`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_tech_spec_generation_runs_repo_context_id` FOREIGN KEY (`repo_context_run_id`) REFERENCES `gateway_repo_context_runs`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_tech_spec_generation_runs_draft_artifact_id` FOREIGN KEY (`draft_artifact_id`) REFERENCES `gateway_doc_artifacts`(`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_gateway_tech_spec_generation_runs_final_artifact_id` FOREIGN KEY (`final_artifact_id`) REFERENCES `gateway_doc_artifacts`(`id`) ON DELETE SET NULL,
  INDEX `idx_gateway_tech_spec_generation_runs_bundle_id` (`bundle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='技术方案生成运行记录';
