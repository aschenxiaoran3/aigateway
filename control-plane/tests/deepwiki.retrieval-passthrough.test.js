'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildKnowledgeAssetIngestMetadata,
  KNOWLEDGE_ASSET_INGEST_PASSTHROUGH_KEYS,
} = require('../src/db/mysql');

test('E-A · passthrough keys include object_keys and domain structure', () => {
  assert.ok(Array.isArray(KNOWLEDGE_ASSET_INGEST_PASSTHROUGH_KEYS));
  for (const required of ['object_keys', 'thread_key', 'thread_level', 'domain_key', 'page_slug', 'run_id']) {
    assert.ok(
      KNOWLEDGE_ASSET_INGEST_PASSTHROUGH_KEYS.includes(required),
      `passthrough keys must include "${required}" for retrieval_eval hit detection`
    );
  }
});

test('E-A · buildKnowledgeAssetIngestMetadata carries object_keys from asset metadata to KB payload', () => {
  const asset = {
    id: 42,
    asset_key: 'deepwiki:repo:abcd:overview',
    name: 'repo · 概览',
    asset_category: '代码库类',
    domain: null,
    module: null,
    version: 'abcd123',
    owner: 'deepwiki-pipeline',
    source_uri: '/tmp/overview.md',
  };
  const assetMeta = {
    repo_slug: 'owner/repo',
    page_slug: '00-overview',
    page_type: 'overview',
    run_id: 50,
    object_keys: ['订单', '出库单', '对账单'],
    thread_key: 'overview-thread',
    thread_level: 'project',
    domain_key: 'order',
    unrelated_noise: 'should-not-appear',
  };
  const metadata = buildKnowledgeAssetIngestMetadata(asset, assetMeta);
  assert.deepEqual(metadata.object_keys, ['订单', '出库单', '对账单']);
  assert.equal(metadata.page_slug, '00-overview');
  assert.equal(metadata.run_id, 50);
  assert.equal(metadata.thread_key, 'overview-thread');
  assert.equal(metadata.thread_level, 'project');
  assert.equal(metadata.domain_key, 'order');
  assert.equal(metadata.knowledge_asset_id, 42);
  assert.equal(metadata.unrelated_noise, undefined, 'passthrough must allowlist explicit keys only');
});

test('E-A · buildKnowledgeAssetIngestMetadata tolerates missing assetMeta', () => {
  const metadata = buildKnowledgeAssetIngestMetadata({ id: 1, asset_key: 'k', name: 'n' }, null);
  assert.equal(metadata.knowledge_asset_id, 1);
  assert.equal(metadata.object_keys, undefined);
});
