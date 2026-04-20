#!/usr/bin/env node
/**
 * 批量将 active 知识资产入库到 knowledge-base，并回写 gateway_knowledge_indexes。
 * 用法：node scripts/ingest-knowledge-assets.cjs
 */

async function main() {
  const db = require('../control-plane/src/db/mysql');
  const assets = await db.listKnowledgeAssets();
  const activeAssets = assets.filter((asset) => asset.status === 'active');

  console.log(`Found ${activeAssets.length} active knowledge assets`);

  for (const asset of activeAssets) {
    try {
      const result = await db.ingestKnowledgeAsset(asset.id);
      console.log(
        `OK ${asset.asset_key}: collection=${result.index?.index_meta?.collection || 'unknown'} chunks=${
          result.index?.index_meta?.chunks_ingested || 0
        }`
      );
    } catch (error) {
      console.error(`FAIL ${asset.asset_key}: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
