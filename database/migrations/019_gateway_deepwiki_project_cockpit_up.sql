CREATE TABLE IF NOT EXISTS `gateway_wiki_project_source_bindings` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `project_id` BIGINT NOT NULL,
  `source_type` VARCHAR(64) NOT NULL,
  `source_key` VARCHAR(191) NOT NULL,
  `source_ref_id` BIGINT NULL,
  `title` VARCHAR(255) NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'active',
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_project_source_bindings_project_id`
    FOREIGN KEY (`project_id`) REFERENCES `gateway_wiki_projects`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_project_source_bindings_key` (`project_id`, `source_type`, `source_key`),
  INDEX `idx_gateway_wiki_project_source_bindings_type` (`project_id`, `source_type`, `status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki 项目输入源绑定';

CREATE TABLE IF NOT EXISTS `gateway_wiki_snapshot_document_revisions` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `source_binding_id` BIGINT NULL,
  `document_type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NULL,
  `source_uri` TEXT NULL,
  `version_label` VARCHAR(191) NULL,
  `knowledge_asset_id` BIGINT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_snapshot_document_revisions_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_gateway_wiki_snapshot_document_revisions_source_binding_id`
    FOREIGN KEY (`source_binding_id`) REFERENCES `gateway_wiki_project_source_bindings`(`id`) ON DELETE SET NULL,
  INDEX `idx_gateway_wiki_snapshot_document_revisions_snapshot` (`snapshot_id`, `document_type`),
  INDEX `idx_gateway_wiki_snapshot_document_revisions_binding` (`source_binding_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki snapshot 文档修订';

CREATE TABLE IF NOT EXISTS `gateway_wiki_snapshot_diagrams` (
  `id` BIGINT AUTO_INCREMENT PRIMARY KEY,
  `snapshot_id` BIGINT NOT NULL,
  `diagram_type` VARCHAR(64) NOT NULL,
  `title` VARCHAR(255) NOT NULL,
  `format` VARCHAR(32) NOT NULL DEFAULT 'mermaid',
  `content` MEDIUMTEXT NULL,
  `render_status` VARCHAR(32) NOT NULL DEFAULT 'ready',
  `source_page_id` BIGINT NULL,
  `metadata_json` JSON NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `fk_gateway_wiki_snapshot_diagrams_snapshot_id`
    FOREIGN KEY (`snapshot_id`) REFERENCES `gateway_wiki_snapshots`(`id`) ON DELETE CASCADE,
  UNIQUE KEY `uk_gateway_wiki_snapshot_diagrams_type` (`snapshot_id`, `diagram_type`),
  INDEX `idx_gateway_wiki_snapshot_diagrams_render` (`snapshot_id`, `render_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Deep Wiki snapshot 图表资产';
