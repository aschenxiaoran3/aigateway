const fs = require('fs');
const path = require('path');

function createDeepWikiAlgorithmVisibleStore(deps = {}) {
  const {
    query,
    normalizeText,
    stringifyJson,
    upsertKnowledgeAsset,
    buildDeepWikiAssetKey,
    buildDeepWikiPageFilePath,
    toWorkspaceRelativePath,
    replaceDeepWikiSnapshotDiagrams,
    replaceDeepWikiThreads,
  } = deps;

  async function applyVisibleProjection({ run, snapshot, repoSource, outputRoot, visibleProjection }) {
    if (!run?.id || !snapshot?.id || !visibleProjection) return null;
    const pages = Array.isArray(visibleProjection.pages) ? visibleProjection.pages : [];
    const diagrams = Array.isArray(visibleProjection.diagrams) ? visibleProjection.diagrams : [];
    const threads = Array.isArray(visibleProjection.threads) ? visibleProjection.threads : [];

    await query('DELETE FROM gateway_deepwiki_pages WHERE run_id = ?', [Number(run.id)]);

    for (const page of pages) {
      const sourceUri = buildDeepWikiPageFilePath(outputRoot, page);
      fs.mkdirSync(path.dirname(sourceUri), { recursive: true });
      fs.writeFileSync(sourceUri, String(page.content || ''), 'utf8');
      const storedSourceUri = toWorkspaceRelativePath(sourceUri);
      const asset = await upsertKnowledgeAsset({
        asset_key: buildDeepWikiAssetKey(repoSource.repo_slug || run.repo_slug || 'deepwiki', snapshot.commit_sha || run.commit_sha || String(run.id), page.page_slug),
        name: `${repoSource.repo_slug || run.repo_slug || 'Deep Wiki'} · ${page.title}`,
        asset_type: 'deep_wiki_page',
        asset_category: '代码库类',
        version: String(snapshot.commit_sha || run.commit_sha || run.id).slice(0, 12),
        owner: 'deepwiki-algorithm-projection',
        source_uri: storedSourceUri,
        metadata_json: {
          ...(page.metadata_json || {}),
          title: page.title,
          run_id: run.id,
          snapshot_id: snapshot.id,
          render_source: normalizeText(page.metadata_json?.render_source) || 'stage_assets_algorithmic',
        },
      });
      await query(
        `INSERT INTO gateway_deepwiki_pages
         (run_id, page_slug, title, page_type, source_uri, knowledge_asset_id, ingest_status, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
        [
          Number(run.id),
          normalizeText(page.page_slug),
          normalizeText(page.title) || normalizeText(page.page_slug),
          normalizeText(page.page_type) || 'page',
          storedSourceUri,
          asset?.id || null,
          'ready',
          stringifyJson(page.metadata_json || {}, '{}'),
        ]
      );
    }

    await replaceDeepWikiSnapshotDiagrams(
      Number(snapshot.id),
      diagrams.map((diagram, index) => ({
        diagram_type: normalizeText(diagram.diagram_type) || 'overview',
        diagram_key: normalizeText(diagram.diagram_key) || `${normalizeText(diagram.scope_key) || 'project'}:${normalizeText(diagram.diagram_type) || index + 1}`,
        scope_type: normalizeText(diagram.scope_type) || 'project',
        scope_key: normalizeText(diagram.scope_key) || 'project',
        parent_scope_key: normalizeText(diagram.parent_scope_key) || null,
        sort_order: Number(diagram.sort_order || (index + 1) * 10),
        title: normalizeText(diagram.title) || `图 ${index + 1}`,
        format: 'mermaid',
        content: diagram.content || '',
        render_status: 'ready',
        metadata_json: {
          render_source: 'stage_assets_algorithmic',
          diagram_summary: normalizeText(diagram.summary || diagram.title),
          covered_evidence: Array.isArray(diagram.covered_evidence) ? diagram.covered_evidence : [],
          missing_evidence: Array.isArray(diagram.missing_evidence) ? diagram.missing_evidence : [],
          quality_notes: Array.isArray(diagram.quality_notes) ? diagram.quality_notes : [],
          scope_type: normalizeText(diagram.scope_type) || 'project',
          scope_key: normalizeText(diagram.scope_key) || 'project',
          parent_scope_key: normalizeText(diagram.parent_scope_key) || null,
        },
      }))
    );

    await replaceDeepWikiThreads(Number(snapshot.id), threads);

    const manifestPath = path.join(outputRoot, 'manifest.json');
    const nextManifest = {
      generated_at: new Date().toISOString(),
      page_count: pages.length,
      diagram_count: diagrams.length,
      algorithm_projection: true,
      pages: pages.map((page) => ({
        page_slug: page.page_slug,
        title: page.title,
        page_type: page.page_type,
      })),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2), 'utf8');
    return {
      pageCount: pages.length,
      diagramCount: diagrams.length,
      threadCount: threads.length,
    };
  }

  return {
    applyVisibleProjection,
  };
}

module.exports = {
  createDeepWikiAlgorithmVisibleStore,
};
