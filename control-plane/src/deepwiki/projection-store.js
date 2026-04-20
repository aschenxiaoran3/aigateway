function createDeepWikiProjectionStore(deps = {}) {
  const {
    query,
    parseJson,
    stringifyJson,
    normalizeText,
    uniqueStrings,
    getRecordLike,
    STAGE_CONTRACTS,
    SKILL_CONTRACTS,
    deriveLegacySnapshotFields,
    isPublishedSnapshot,
  } = deps;

  function isMissingTableError(error) {
    return String(error?.code || '') === 'ER_NO_SUCH_TABLE';
  }

  function mapDeepWikiStageRunRow(row) {
    if (!row) return null;
    return {
      ...row,
      contract: parseJson(row.stage_contract_json, null),
      metadata_json: parseJson(row.metadata_json, {}),
    };
  }

  function mapDeepWikiSkillExecutionRow(row) {
    if (!row) return null;
    return {
      ...row,
      contract: parseJson(row.skill_contract_json, null),
      metadata_json: parseJson(row.metadata_json, {}),
    };
  }

  function mapDeepWikiStageAssetRow(row) {
    if (!row) return null;
    const metadata = parseJson(row.metadata_json, {});
    return {
      id: row.id,
      assetKey: row.asset_key,
      stageKey: row.stage_key,
      snapshotId: String(row.snapshot_id || ''),
      schemaVersion: row.schema_version || metadata.schemaVersion || '0.1.0',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...metadata,
      payload: parseJson(row.payload_json, {}),
    };
  }

  function mapDeepWikiGateDecisionRow(row) {
    if (!row) return null;
    return {
      ...row,
      is_blocking: Boolean(Number(row.is_blocking || 0)),
      decision_json: parseJson(row.decision_json, {}),
      detail_json: parseJson(row.detail_json, {}),
    };
  }

  function mapDeepWikiScoreRecordRow(row) {
    if (!row) return null;
    return {
      score_id: row.score_id,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      snapshot_id: row.snapshot_id,
      overall_score: Number(row.overall_score || 0),
      dimensions: parseJson(row.dimensions_json, {}),
      penalties: parseJson(row.penalties_json, []),
      grader_versions: parseJson(row.grader_versions_json, {}),
      explanations: parseJson(row.explanations_json, []),
      score_group: row.score_group,
      metadata_json: parseJson(row.metadata_json, {}),
    };
  }

  function mapDeepWikiHealthIndexRow(row) {
    if (!row) return null;
    return {
      ...parseJson(row.payload_json, {}),
      health_key: row.health_key,
      health_level: row.health_level || null,
      numeric_value: Number.isFinite(Number(row.numeric_value)) ? Number(row.numeric_value) : null,
    };
  }

  function buildDeepWikiGateDecisionRows(snapshot = {}, projection = {}) {
    const gateDecisions = getRecordLike(projection.gateDecisions, {});
    const legacySnapshotFields = deriveLegacySnapshotFields ? deriveLegacySnapshotFields(snapshot) : {
      publish_status: snapshot.publish_status || 'draft',
      quality_status: snapshot.quality_status || 'pending',
    };
    const rows = [
      {
        gate_key: 'publish_gate',
        scope_type: 'snapshot',
        scope_key: '__snapshot__',
        source_type: 'stage',
        source_ref: 'quality_gates',
        source_stage_key: 'quality_gates',
        decision_status: gateDecisions.publishReady ? 'pass' : 'blocked',
        is_blocking: gateDecisions.publishReady ? 0 : 1,
        reason: gateDecisions.reason || null,
        decision_json: {
          ...gateDecisions,
          snapshot_status: snapshot.status || legacySnapshotFields.publish_status,
          quality_status: snapshot.quality_status || legacySnapshotFields.quality_status,
        },
        detail_json: {
          blockers: gateDecisions.blockers || [],
          published_snapshot: Boolean(isPublishedSnapshot && isPublishedSnapshot(snapshot)),
        },
      },
    ];
    uniqueStrings([...(snapshot.publish_blockers || []), ...(gateDecisions.blockers || [])]).forEach((blocker) => {
      rows.push({
        gate_key: `blocker:${blocker}`,
        scope_type: 'snapshot',
        scope_key: '__snapshot__',
        source_type: 'checker',
        source_ref: blocker,
        source_stage_key: 'quality_gates',
        decision_status: 'blocked',
        is_blocking: 1,
        reason: blocker,
        decision_json: {
          blocker,
          label: blocker,
        },
        detail_json: {
          blocker,
        },
      });
    });
    uniqueStrings([...(snapshot.publish_warnings || []), ...(gateDecisions.warnings || [])]).forEach((warning) => {
      rows.push({
        gate_key: `warning:${warning}`,
        scope_type: 'snapshot',
        scope_key: '__snapshot__',
        source_type: 'checker',
        source_ref: warning,
        source_stage_key: 'quality_gates',
        decision_status: 'warn',
        is_blocking: 0,
        reason: warning,
        decision_json: {
          warning,
          label: warning,
        },
        detail_json: {
          warning,
        },
      });
    });
    return rows;
  }

  function flattenDeepWikiScoreRecords(scoreOutputs = {}) {
    const groups = [
      'project_scores',
      'snapshot_scores',
      'domain_scores',
      'capability_scores',
      'flow_scores',
      'journey_scores',
      'page_scores',
      'diagram_scores',
      'solution_scores',
    ];
    const records = groups.flatMap((groupKey) =>
      (Array.isArray(scoreOutputs[groupKey]) ? scoreOutputs[groupKey] : []).map((record) => ({
        score_group: groupKey,
        ...record,
      }))
    );
    const deduped = new Map();
    records.forEach((record, index) => {
      const key = [
        normalizeText(record.score_group),
        normalizeText(record.entity_type),
        normalizeText(record.entity_id) || `__index_${index}`,
      ].join('::');
      deduped.set(key, record);
    });
    return Array.from(deduped.values());
  }

  async function persistDeepWikiTemplateProjection(snapshot, runId, projection = {}) {
    const snapshotId = Number(snapshot?.id || 0);
    if (!snapshotId) return null;
    const projectId = Number(snapshot?.project_id || 0) || null;
    const stageRuns = Array.isArray(projection.stageRuns) ? projection.stageRuns : [];
    const skillExecutions = Array.isArray(projection.skillExecutions) ? projection.skillExecutions : [];
    const assets = Array.isArray(projection.assets) ? projection.assets : [];
    const contracts = projection.contracts || { stages: STAGE_CONTRACTS, skills: SKILL_CONTRACTS };
    const skillContractMap = new Map((contracts.skills || []).map((item) => [item.skillKey, item]));
    const gateRows = buildDeepWikiGateDecisionRows(snapshot, projection);

    try {
      await query('DELETE FROM gateway_wiki_skill_executions WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_gate_decisions WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_stage_assets WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_stage_runs WHERE snapshot_id = ?', [snapshotId]);

      for (const stageRun of stageRuns) {
        await query(
          `INSERT INTO gateway_wiki_stage_runs
           (snapshot_id, project_id, run_id, stage_key, sort_order, status, stage_contract_json, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
          [
            snapshotId,
            projectId,
            Number(runId || 0) || null,
            normalizeText(stageRun.stageKey),
            Number(stageRun.sortOrder || 0),
            normalizeText(stageRun.status || 'completed') || 'completed',
            stringifyJson(stageRun.contract || {}, '{}'),
            stringifyJson({}, '{}'),
          ]
        );
      }

      for (const skillExecution of skillExecutions) {
        await query(
          `INSERT INTO gateway_wiki_skill_executions
           (snapshot_id, project_id, run_id, stage_key, skill_key, status, skill_contract_json, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
          [
            snapshotId,
            projectId,
            Number(runId || 0) || null,
            normalizeText(skillExecution.stageKey),
            normalizeText(skillExecution.skillKey),
            normalizeText(skillExecution.status || 'completed') || 'completed',
            stringifyJson(skillContractMap.get(skillExecution.skillKey) || {}, '{}'),
            stringifyJson({}, '{}'),
          ]
        );
      }

      for (const asset of assets) {
        const assetMetadata = {
          createdAt: asset.createdAt || null,
        };
        if (asset.schemaVersion) {
          assetMetadata.schemaVersion = asset.schemaVersion;
        }
        await query(
          `INSERT INTO gateway_wiki_stage_assets
           (snapshot_id, project_id, run_id, stage_key, asset_key, schema_version, payload_json, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
          [
            snapshotId,
            projectId,
            Number(runId || 0) || null,
            normalizeText(asset.stageKey),
            normalizeText(asset.assetKey),
            normalizeText(asset.schemaVersion) || '0.1.0',
            stringifyJson(asset.payload, '{}'),
            stringifyJson(assetMetadata, '{}'),
          ]
        );
      }

      for (const gateRow of gateRows) {
        try {
          await query(
            `INSERT INTO gateway_wiki_gate_decisions
             (snapshot_id, project_id, run_id, gate_key, scope_type, scope_key, source_type, source_ref, source_stage_key,
              decision_status, is_blocking, reason, decision_json, detail_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
            [
              snapshotId,
              projectId,
              Number(runId || 0) || null,
              normalizeText(gateRow.gate_key),
              normalizeText(gateRow.scope_type) || 'snapshot',
              normalizeText(gateRow.scope_key) || '__snapshot__',
              normalizeText(gateRow.source_type) || 'stage',
              normalizeText(gateRow.source_ref) || '',
              normalizeText(gateRow.source_stage_key) || null,
              normalizeText(gateRow.decision_status) || 'review',
              gateRow.is_blocking ? 1 : 0,
              normalizeText(gateRow.reason) || null,
              stringifyJson(gateRow.decision_json || {}, '{}'),
              stringifyJson(gateRow.detail_json || {}, '{}'),
            ]
          );
        } catch (error) {
          if (String(error?.code || '') !== 'ER_BAD_FIELD_ERROR') {
            throw error;
          }
          await query(
            `INSERT INTO gateway_wiki_gate_decisions
             (snapshot_id, project_id, run_id, gate_key, source_stage_key, decision_status, is_blocking, decision_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
            [
              snapshotId,
              projectId,
              Number(runId || 0) || null,
              normalizeText(gateRow.gate_key),
              normalizeText(gateRow.source_stage_key) || null,
              normalizeText(gateRow.decision_status) || 'review',
              gateRow.is_blocking ? 1 : 0,
              stringifyJson(
                {
                  ...(gateRow.decision_json || {}),
                  scope_type: normalizeText(gateRow.scope_type) || 'snapshot',
                  scope_key: normalizeText(gateRow.scope_key) || '__snapshot__',
                  source_type: normalizeText(gateRow.source_type) || 'stage',
                  source_ref: normalizeText(gateRow.source_ref) || '',
                  reason: normalizeText(gateRow.reason) || null,
                  detail: gateRow.detail_json || {},
                },
                '{}'
              ),
            ]
          );
        }
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }

    return {
      snapshot_id: snapshotId,
      stage_run_count: stageRuns.length,
      asset_count: assets.length,
      gate_count: gateRows.length,
    };
  }

  async function persistDeepWikiScoreProjection(snapshot, runId, scoreOutputs = {}) {
    const snapshotId = Number(snapshot?.id || 0);
    if (!snapshotId) return null;
    const projectId = Number(snapshot?.project_id || 0) || null;
    const scoreRecords = flattenDeepWikiScoreRecords(scoreOutputs);
    const summary = {
      project_score: scoreOutputs.project_scores?.[0]?.overall_score ?? null,
      snapshot_score: scoreOutputs.snapshot_scores?.[0]?.overall_score ?? null,
      health_index: scoreOutputs.health_indices?.knowledge_health_index ?? null,
    };

    let scoreRunId = null;
    try {
      await query('DELETE FROM gateway_wiki_grader_versions WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_health_indices WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_ranking_views WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_score_regressions WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_score_breakdowns WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_score_records WHERE snapshot_id = ?', [snapshotId]);
      await query('DELETE FROM gateway_wiki_score_runs WHERE snapshot_id = ?', [snapshotId]);

      const result = await query(
        `INSERT INTO gateway_wiki_score_runs
         (snapshot_id, project_id, run_id, scorer_key, status, summary_json, metadata_json)
         VALUES (?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON))`,
        [
          snapshotId,
          projectId,
          Number(runId || 0) || null,
          'knowledge_scoring_engine',
          'completed',
          stringifyJson(summary, '{}'),
          stringifyJson({}, '{}'),
        ]
      );
      scoreRunId = Number(result.insertId || 0);

      for (const record of scoreRecords) {
        await query(
          `INSERT INTO gateway_wiki_score_records
           (score_run_id, snapshot_id, project_id, score_group, entity_type, entity_id, score_id, overall_score,
            dimensions_json, penalties_json, grader_versions_json, explanations_json, metadata_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON), CAST(? AS JSON))`,
          [
            scoreRunId,
            snapshotId,
            projectId,
            normalizeText(record.score_group),
            normalizeText(record.entity_type),
            normalizeText(record.entity_id),
            normalizeText(record.score_id) || null,
            Number(record.overall_score || 0),
            stringifyJson(record.dimensions || {}, '{}'),
            stringifyJson(record.penalties || [], '[]'),
            stringifyJson(record.grader_versions || {}, '{}'),
            stringifyJson(record.explanations || [], '[]'),
            stringifyJson({}, '{}'),
          ]
        );
      }

      await query(
        `INSERT INTO gateway_wiki_score_breakdowns
         (score_run_id, snapshot_id, project_id, breakdown_key, payload_json)
         VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
        [
          scoreRunId,
          snapshotId,
          projectId,
          'default',
          stringifyJson(scoreOutputs.score_breakdowns || {}, '{}'),
        ]
      );

      for (const [index, regression] of (Array.isArray(scoreOutputs.score_regressions) ? scoreOutputs.score_regressions : []).entries()) {
        await query(
          `INSERT INTO gateway_wiki_score_regressions
           (score_run_id, snapshot_id, project_id, regression_key, payload_json)
           VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
          [
            scoreRunId,
            snapshotId,
            projectId,
            normalizeText(regression?.regression_key || regression?.key || regression?.metric || `regression_${index + 1}`),
            stringifyJson(regression || {}, '{}'),
          ]
        );
      }

      for (const [viewKey, payload] of Object.entries(getRecordLike(scoreOutputs.ranking_views, {}))) {
        await query(
          `INSERT INTO gateway_wiki_ranking_views
           (score_run_id, snapshot_id, project_id, view_key, payload_json)
           VALUES (?, ?, ?, ?, CAST(? AS JSON))`,
          [
            scoreRunId,
            snapshotId,
            projectId,
            normalizeText(viewKey),
            stringifyJson(payload || {}, '{}'),
          ]
        );
      }

      if (scoreOutputs.health_indices && typeof scoreOutputs.health_indices === 'object') {
        await query(
          `INSERT INTO gateway_wiki_health_indices
           (score_run_id, snapshot_id, project_id, health_key, health_level, numeric_value, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
          [
            scoreRunId,
            snapshotId,
            projectId,
            'knowledge_health_index',
            normalizeText(scoreOutputs.health_indices.health_level) || null,
            Number(scoreOutputs.health_indices.knowledge_health_index || 0),
            stringifyJson(scoreOutputs.health_indices, '{}'),
          ]
        );
      }

      const graderVersionMap = new Map();
      scoreRecords.forEach((record) => {
        Object.entries(getRecordLike(record.grader_versions, {})).forEach(([graderKey, versionLabel]) => {
          if (!graderVersionMap.has(graderKey)) {
            graderVersionMap.set(graderKey, versionLabel);
          }
        });
      });
      for (const [graderKey, versionLabel] of graderVersionMap.entries()) {
        await query(
          `INSERT INTO gateway_wiki_grader_versions
           (score_run_id, snapshot_id, project_id, grader_key, version_label, metadata_json)
           VALUES (?, ?, ?, ?, ?, CAST(? AS JSON))`,
          [
            scoreRunId,
            snapshotId,
            projectId,
            normalizeText(graderKey),
            normalizeText(versionLabel) || 'unknown',
            stringifyJson({}, '{}'),
          ]
        );
      }
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }

    return {
      snapshot_id: snapshotId,
      score_run_id: scoreRunId,
      score_record_count: scoreRecords.length,
    };
  }

  async function getDeepWikiTemplateProjectionBySnapshotId(snapshotId) {
    const normalizedSnapshotId = Number(snapshotId || 0);
    if (!normalizedSnapshotId) return null;
    try {
      const [
        stageRunRows,
        skillExecutionRows,
        stageAssetRows,
        gateDecisionRows,
        scoreRecordRows,
        scoreBreakdownRows,
        scoreRegressionRows,
        rankingViewRows,
        healthIndexRows,
      ] = await Promise.all([
        query('SELECT * FROM gateway_wiki_stage_runs WHERE snapshot_id = ? ORDER BY sort_order ASC, id ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_skill_executions WHERE snapshot_id = ? ORDER BY stage_key ASC, id ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_stage_assets WHERE snapshot_id = ? ORDER BY stage_key ASC, asset_key ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_gate_decisions WHERE snapshot_id = ? ORDER BY id ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_score_records WHERE snapshot_id = ? ORDER BY score_group ASC, entity_type ASC, entity_id ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_score_breakdowns WHERE snapshot_id = ? ORDER BY id ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_score_regressions WHERE snapshot_id = ? ORDER BY id ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_ranking_views WHERE snapshot_id = ? ORDER BY id ASC', [normalizedSnapshotId]),
        query('SELECT * FROM gateway_wiki_health_indices WHERE snapshot_id = ? ORDER BY id ASC', [normalizedSnapshotId]),
      ]);

      if (!stageRunRows.length && !stageAssetRows.length && !scoreRecordRows.length) {
        return null;
      }

      const assets = stageAssetRows.map(mapDeepWikiStageAssetRow).filter(Boolean);
      const groupedScoreRecords = scoreRecordRows.reduce((acc, row) => {
        const mapped = mapDeepWikiScoreRecordRow(row);
        const key = row.score_group;
        if (!acc[key]) acc[key] = [];
        acc[key].push(mapped);
        return acc;
      }, {});

      const rankingViews = rankingViewRows.reduce((acc, row) => {
        acc[row.view_key] = parseJson(row.payload_json, []);
        return acc;
      }, {});
      const scoreBreakdownPayload =
        scoreBreakdownRows.length === 1 && scoreBreakdownRows[0].breakdown_key === 'default'
          ? parseJson(scoreBreakdownRows[0].payload_json, {})
          : scoreBreakdownRows.reduce((acc, row) => {
              acc[row.breakdown_key] = parseJson(row.payload_json, {});
              return acc;
            }, {});
      const healthPayload =
        healthIndexRows.length === 1
          ? mapDeepWikiHealthIndexRow(healthIndexRows[0])
          : healthIndexRows.map(mapDeepWikiHealthIndexRow).filter(Boolean);

      return {
        contracts: {
          stages: STAGE_CONTRACTS,
          skills: SKILL_CONTRACTS,
        },
        stageRuns: stageRunRows.map(mapDeepWikiStageRunRow).filter(Boolean),
        skillExecutions: skillExecutionRows.map(mapDeepWikiSkillExecutionRow).filter(Boolean),
        assetLineage: assets.map((asset) => ({
          stageKey: asset.stageKey,
          assetKey: asset.assetKey,
        })),
        assets,
        gateDecisions: gateDecisionRows.map(mapDeepWikiGateDecisionRow).filter(Boolean),
        scores: {
          projectScores: groupedScoreRecords.project_scores || [],
          snapshotScores: groupedScoreRecords.snapshot_scores || [],
          domainScores: groupedScoreRecords.domain_scores || [],
          capabilityScores: groupedScoreRecords.capability_scores || [],
          flowScores: groupedScoreRecords.flow_scores || [],
          journeyScores: groupedScoreRecords.journey_scores || [],
          pageScores: groupedScoreRecords.page_scores || [],
          diagramScores: groupedScoreRecords.diagram_scores || [],
          solutionScores: groupedScoreRecords.solution_scores || [],
          scoreBreakdowns: scoreBreakdownPayload,
          rankingViews,
          scoreRegressions: scoreRegressionRows.map((row) => parseJson(row.payload_json, {})),
          healthIndices: healthPayload,
        },
      };
    } catch (error) {
      if (isMissingTableError(error)) {
        return null;
      }
      throw error;
    }
  }

  return {
    persistDeepWikiTemplateProjection,
    persistDeepWikiScoreProjection,
    getDeepWikiTemplateProjectionBySnapshotId,
  };
}

module.exports = {
  createDeepWikiProjectionStore,
};
