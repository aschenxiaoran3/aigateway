ALTER TABLE `gateway_knowledge_assets`
  MODIFY COLUMN `source_uri` TEXT NULL;

ALTER TABLE `gateway_deepwiki_pages`
  MODIFY COLUMN `source_uri` TEXT NOT NULL;

ALTER TABLE `gateway_wiki_evidence`
  MODIFY COLUMN `source_uri` TEXT NULL;
