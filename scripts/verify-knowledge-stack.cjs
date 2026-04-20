#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const KNOWLEDGE_BASE_URL = (process.env.KNOWLEDGE_BASE_URL || 'http://127.0.0.1:8000').trim();
const QDRANT_URL = (process.env.QDRANT_URL || 'http://127.0.0.1:6333').trim();
const DASHVECTOR_ENDPOINT = (process.env.DASHVECTOR_ENDPOINT || '').trim().replace(/\/$/, '');
const DASHVECTOR_API_KEY = (process.env.DASHVECTOR_API_KEY || '').trim();
const SAMPLE_ASSET_KEYS = [
  'ka-ai-rules-readme',
  'ka-ai-manual-pm-v1',
  'ka-harness-official-plan-local',
];
const BACKEND = DASHVECTOR_ENDPOINT && DASHVECTOR_API_KEY ? 'dashvector' : 'qdrant';
const VERIFY_COLLECTION = (
  process.env.VERIFY_COLLECTION ||
  (BACKEND === 'dashvector'
    ? (process.env.KNOWLEDGE_BASE_COLLECTION || 'phase1_knowledge_assets')
    : `kb_verify_q2_${Date.now()}`)
).trim();

function assertCondition(condition, successMessage, failureMessage) {
  if (!condition) {
    throw new Error(failureMessage || successMessage);
  }
  console.log(`OK: ${successMessage}`);
}

function resolveSourcePath(sourceUri) {
  if (path.isAbsolute(sourceUri)) {
    return sourceUri;
  }
  const candidates = [
    path.join(root, sourceUri),
    path.join(path.dirname(root), sourceUri),
    path.join(path.dirname(path.dirname(root)), sourceUri),
  ];
  const hit = candidates.find((candidate) => fs.existsSync(candidate));
  if (!hit) {
    throw new Error(`Unable to resolve source path for ${sourceUri}`);
  }
  return hit;
}

async function main() {
  const db = require(path.join(root, 'control-plane/src/db/mysql.js'));
  const pool = db.getPool();

  async function fetchBackendCollections() {
    if (BACKEND === 'dashvector') {
      const endpoint = DASHVECTOR_ENDPOINT.startsWith('http') ? DASHVECTOR_ENDPOINT : `https://${DASHVECTOR_ENDPOINT}`;
      const data = (
        await axios.get(`${endpoint}/v1/collections`, {
          timeout: 10000,
          headers: {
            'dashvector-auth-token': DASHVECTOR_API_KEY,
          },
        })
      ).data;
      return data;
    }
    return (await axios.get(`${QDRANT_URL}/collections`, { timeout: 10000 })).data;
  }

  function backendCollectionNames(data) {
    if (BACKEND === 'dashvector') {
      return data.output || [];
    }
    return (data.result?.collections || []).map((item) => item.name);
  }

  try {
    console.log('--- health ---');
    const health = (await axios.get(`${KNOWLEDGE_BASE_URL}/health`, { timeout: 10000 })).data;
    assertCondition(health.status === 'healthy', 'knowledge-base health is healthy', `knowledge-base health unexpected: ${JSON.stringify(health)}`);
    console.log(JSON.stringify(health, null, 2));

    console.log(`--- ${BACKEND} before ingest ---`);
    const backendBefore = await fetchBackendCollections();
    console.log(JSON.stringify(backendBefore, null, 2));

    const allAssets = await db.listKnowledgeAssets({ status: 'active' });
    const sampleAssets = SAMPLE_ASSET_KEYS
      .map((key) => allAssets.find((asset) => asset.asset_key === key))
      .filter(Boolean);
    assertCondition(sampleAssets.length === SAMPLE_ASSET_KEYS.length, 'sample knowledge assets resolved from DB', `missing sample assets: expected ${SAMPLE_ASSET_KEYS.length}, got ${sampleAssets.length}`);

    console.log('--- ingest ---');
    const ingestResults = [];
    for (const asset of sampleAssets) {
      const result = await db.ingestKnowledgeAsset(asset.id, { collection: VERIFY_COLLECTION });
      ingestResults.push({
        asset_key: asset.asset_key,
        index_status: result.index?.status,
        collection: result.index?.index_meta?.collection,
        chunks_ingested: result.index?.index_meta?.chunks_ingested,
      });
    }
    console.log(JSON.stringify(ingestResults, null, 2));
    assertCondition(
      ingestResults.every((item) => item.index_status === 'ready' && Number(item.chunks_ingested || 0) > 0),
      'sample knowledge assets ingested successfully',
      `knowledge asset ingest failed: ${JSON.stringify(ingestResults)}`
    );

    console.log('--- collections after ingest ---');
    const collections = (await axios.get(`${KNOWLEDGE_BASE_URL}/api/v1/collections`, { timeout: 10000 })).data;
    console.log(JSON.stringify(collections, null, 2));
    const verifyCollection = (collections.collections || []).find((item) => item.name === VERIFY_COLLECTION);
    assertCondition(Boolean(verifyCollection), `${VERIFY_COLLECTION} collection is visible in knowledge-base`, `${VERIFY_COLLECTION} collection missing in knowledge-base`);
    assertCondition(Number(verifyCollection.chunk_count || 0) > 0, `${VERIFY_COLLECTION} has chunks`, `${VERIFY_COLLECTION} chunk_count is ${verifyCollection.chunk_count}`);

    console.log(`--- ${BACKEND} after ingest ---`);
    const backendAfter = await fetchBackendCollections();
    console.log(JSON.stringify(backendAfter, null, 2));
    const backendNames = backendCollectionNames(backendAfter);
    assertCondition(
      backendNames.includes(VERIFY_COLLECTION),
      `${BACKEND} contains ${VERIFY_COLLECTION} collection`,
      `${BACKEND} collections missing ${VERIFY_COLLECTION}: ${JSON.stringify(backendNames)}`
    );

    console.log('--- search ---');
    const pmManualAsset = sampleAssets.find((asset) => asset.asset_key === 'ka-ai-manual-pm-v1');
    const pmManualPath = resolveSourcePath(pmManualAsset.source_uri);
    const pmManualContent = fs.readFileSync(pmManualPath, 'utf8').trim();
    const searchPayload = {
      query: pmManualContent,
      collection: VERIFY_COLLECTION,
      top_k: 3,
      min_score: 0,
      knowledge_asset_id: pmManualAsset.id,
    };
    const searchResponse = (await axios.post(`${KNOWLEDGE_BASE_URL}/api/v1/search`, searchPayload, { timeout: 10000 })).data;
    console.log(JSON.stringify(searchResponse, null, 2));
    assertCondition(Number(searchResponse.total || 0) > 0, 'knowledge-base search returns results', `knowledge-base search returned no results for ${JSON.stringify(searchPayload)}`);
    assertCondition(
      (searchResponse.results || []).some((item) => Number(item.knowledge_asset_id) === Number(pmManualAsset.id)),
      'knowledge-base search returns the expected PM manual asset',
      'knowledge-base search did not return the expected PM manual asset'
    );

    const [indexRows] = await pool.query(
      `SELECT a.asset_key, i.status, i.index_meta
       FROM gateway_knowledge_indexes i
       INNER JOIN gateway_knowledge_assets a ON a.id = i.knowledge_asset_id
       WHERE a.asset_key IN (${SAMPLE_ASSET_KEYS.map(() => '?').join(',')})
         AND JSON_UNQUOTE(JSON_EXTRACT(i.index_meta, '$.collection')) = ?
       ORDER BY i.id DESC`,
      [...SAMPLE_ASSET_KEYS, VERIFY_COLLECTION]
    );
    console.log('--- latest index rows ---');
    console.log(
      JSON.stringify(
        indexRows.slice(0, SAMPLE_ASSET_KEYS.length).map((row) => ({
          asset_key: row.asset_key,
          status: row.status,
          index_meta: typeof row.index_meta === 'string' ? JSON.parse(row.index_meta) : row.index_meta,
        })),
        null,
        2
      )
    );

    console.log(`DONE: knowledge-base and ${BACKEND} verification passed.`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`FAILED: knowledge-base and ${BACKEND} verification failed.`);
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
