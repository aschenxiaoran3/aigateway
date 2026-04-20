const { getStageContract } = require('../../contracts/contracts');
const { ensureBuiltinSkillsRegistered } = require('../../skills/builtin-skills');
const { resolveTransitionPath } = require('../../snapshot-state-machine');
const {
  getSkill,
  findProducer,
  getStageKeysInOrder,
} = require('./registry');

const META_OUTPUT_KEYS = new Set([
  'project_scores',
  'snapshot_scores',
  'domain_scores',
  'capability_scores',
  'flow_scores',
  'journey_scores',
  'page_scores',
  'diagram_scores',
  'solution_scores',
  'score_breakdowns',
  'ranking_views',
  'score_regressions',
  'health_indices',
  'algorithm_visible_projection',
]);

const CONTEXT_INPUT_KEYS = new Set([
  'project.config',
  'project',
  'snapshot',
  'published_snapshot',
  'execution_context',
]);

function normalizeText(value) {
  return String(value || '').trim();
}

function uniqueStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((item) => normalizeText(item)).filter(Boolean))];
}

function isContextInput(inputKey) {
  return CONTEXT_INPUT_KEYS.has(normalizeText(inputKey));
}

function buildExecutionContext(ctx) {
  const snapshot = ctx.snapshot || ctx.config?.snapshot || {};
  const project = ctx.project || ctx.config?.project || {};
  return {
    project_id: project.id || ctx.config?.projectId || null,
    snapshot_id: snapshot.id || ctx.config?.snapshotId || null,
    mode: normalizeText(snapshot.publish_status) === 'published' ? 'published' : 'draft',
  };
}

function resolveContextInput(ctx, inputKey) {
  const key = normalizeText(inputKey);
  if (key === 'project.config') return ctx.config || {};
  if (key === 'project') return ctx.project || ctx.config?.project || null;
  if (key === 'snapshot') return ctx.snapshot || ctx.config?.snapshot || { id: ctx.config?.snapshotId || null, status: ctx.status || 'draft' };
  if (key === 'published_snapshot') {
    const snapshot = ctx.snapshot || ctx.config?.snapshot || null;
    return snapshot && normalizeText(snapshot.publish_status) === 'published' ? snapshot : null;
  }
  if (key === 'execution_context') return buildExecutionContext(ctx);
  return null;
}

function getTargetAssetsForStage(stageKey) {
  const normalizedStageKey = normalizeText(stageKey);
  const order = getStageKeysInOrder();
  const stageIndex = order.indexOf(normalizedStageKey);
  const scopedStages = stageIndex >= 0 ? order.slice(0, stageIndex + 1) : order;
  return {
    stageKeys: scopedStages,
    targetAssets: uniqueStrings(
      scopedStages.flatMap((key) => {
        const contract = getStageContract(key);
        return contract ? contract.projectionTargets : [];
      })
    ),
  };
}

function getFullBuildTargets() {
  const { stageKeys, targetAssets } = getTargetAssetsForStage('solution_derivation');
  return {
    stageKeys,
    targetAssets: uniqueStrings([
      ...targetAssets,
      'project_scores',
      'snapshot_scores',
      'domain_scores',
      'capability_scores',
      'flow_scores',
      'journey_scores',
      'page_scores',
      'diagram_scores',
      'solution_scores',
      'score_breakdowns',
      'ranking_views',
      'score_regressions',
      'health_indices',
      'algorithm_visible_projection',
    ]),
  };
}

function planDag(targetAssets = []) {
  ensureBuiltinSkillsRegistered();
  const nodes = new Map();
  const visiting = new Set();

  function ensureNode(skillKey) {
    const existing = nodes.get(skillKey);
    if (existing) return existing;
    const skill = getSkill(skillKey);
    if (!skill) {
      throw new Error(`Skill not registered: ${skillKey}`);
    }
    const node = {
      node_id: skillKey,
      skill_key: skillKey,
      stage_key: skill.stageKey,
      inputs: [...skill.inputs],
      outputs: [...skill.outputs],
      upstream: [],
      downstream: [],
      status: 'pending',
    };
    nodes.set(skillKey, node);
    return node;
  }

  function visitSkill(skillKey) {
    if (visiting.has(skillKey)) {
      throw new Error(`Cycle detected while planning DAG at skill ${skillKey}`);
    }
    const existing = nodes.get(skillKey);
    if (existing && existing._planned) return existing;
    visiting.add(skillKey);
    const node = ensureNode(skillKey);
    node.inputs.forEach((inputKey) => {
      if (isContextInput(inputKey)) return;
      const producer = findProducer(inputKey);
      if (!producer) return;
      const upstreamNode = visitSkill(producer.skillKey);
      if (!node.upstream.includes(upstreamNode.skill_key)) {
        node.upstream.push(upstreamNode.skill_key);
      }
      if (!upstreamNode.downstream.includes(node.skill_key)) {
        upstreamNode.downstream.push(node.skill_key);
      }
    });
    node._planned = true;
    visiting.delete(skillKey);
    return node;
  }

  uniqueStrings(targetAssets).forEach((assetKey) => {
    const producer = findProducer(assetKey);
    if (!producer) return;
    visitSkill(producer.skillKey);
  });

  nodes.forEach((node) => {
    delete node._planned;
  });

  return {
    targetAssets: uniqueStrings(targetAssets),
    nodes: Array.from(nodes.values()),
  };
}

function buildDag(plan = {}) {
  const nodes = Array.isArray(plan.nodes) ? plan.nodes.map((node) => ({ ...node })) : [];
  const nodeMap = new Map(nodes.map((node) => [node.skill_key, node]));
  const inDegree = new Map(nodes.map((node) => [node.skill_key, node.upstream.length]));
  const queue = nodes.filter((node) => (inDegree.get(node.skill_key) || 0) === 0).map((node) => node.skill_key);
  const topoOrder = [];

  while (queue.length) {
    const skillKey = queue.shift();
    topoOrder.push(skillKey);
    const node = nodeMap.get(skillKey);
    (node?.downstream || []).forEach((downstreamKey) => {
      const nextDegree = (inDegree.get(downstreamKey) || 0) - 1;
      inDegree.set(downstreamKey, nextDegree);
      if (nextDegree === 0) {
        queue.push(downstreamKey);
      }
    });
  }

  if (topoOrder.length !== nodes.length) {
    throw new Error('Cycle detected while building DAG topo order');
  }

  return {
    ...plan,
    nodeMap,
    topoOrder,
  };
}

function executeDagForTargets(ctx, targetAssets = [], options = {}) {
  ensureBuiltinSkillsRegistered();
  const dag = buildDag(planDag(targetAssets));
  const assetCache = new Map();
  const resultAssets = [];
  const skillExecutions = [];
  const stageScope = Array.isArray(options.stageKeys) ? options.stageKeys : [];
  const executionCache = new Map();
  const metaOutputs = {};

  const readAsset = (assetKey) => {
    if (assetCache.has(assetKey)) return assetCache.get(assetKey);
    if (typeof ctx.asset === 'function') {
      const existing = ctx.asset(assetKey);
      if (existing != null) {
        assetCache.set(assetKey, existing);
        return existing;
      }
    }
    return null;
  };

  for (const skillKey of dag.topoOrder) {
    const node = dag.nodeMap.get(skillKey);
    const skill = getSkill(skillKey);
    if (!skill) {
      throw new Error(`Skill not found during DAG execution: ${skillKey}`);
    }

    node.status = 'running';
    const resolvedInputs = {};
    const sourceAssets = [];
    skill.inputs.forEach((inputKey) => {
      if (isContextInput(inputKey)) {
        resolvedInputs[inputKey] = resolveContextInput(ctx, inputKey);
        return;
      }
      const payload = readAsset(inputKey);
      resolvedInputs[inputKey] = payload;
      if (payload != null) {
        sourceAssets.push(inputKey);
      }
    });

    const cacheKey = JSON.stringify({
      skill: skill.skillKey,
      inputs: resolvedInputs,
      parameters: skill.contract?.parameters || {},
      version: skill.contract?.version || '0.1.0',
    });

    let outputs;
    let cacheHit = false;
    if (executionCache.has(cacheKey)) {
      outputs = executionCache.get(cacheKey);
      cacheHit = true;
    } else {
      outputs = skill.execute({
        ctx,
        inputs: resolvedInputs,
        executionContext: buildExecutionContext(ctx),
      });
      executionCache.set(cacheKey, outputs);
    }

    const outputKeys = skill.outputs.length ? skill.outputs : Object.keys(outputs || {});
    outputKeys.forEach((assetKey) => {
      if (!outputs || typeof outputs[assetKey] === 'undefined') return;
      assetCache.set(assetKey, outputs[assetKey]);
      if (META_OUTPUT_KEYS.has(assetKey)) {
        metaOutputs[assetKey] = outputs[assetKey];
        if (typeof ctx.saveMeta === 'function') {
          ctx.saveMeta(assetKey, outputs[assetKey]);
        }
        return;
      }
      const env = typeof ctx.save === 'function'
        ? ctx.save(skill.stageKey || node.stage_key, assetKey, outputs[assetKey], {
            lineage: {
              source_assets: sourceAssets,
              skill: skill.skillKey,
            },
          })
        : null;
      resultAssets.push(env || {
        assetKey,
        stageKey: skill.stageKey || node.stage_key,
        payload: outputs[assetKey],
        lineage: {
          source_assets: sourceAssets,
          skill: skill.skillKey,
        },
      });
    });

    node.status = 'done';
    skillExecutions.push({
      stageKey: skill.stageKey || node.stage_key,
      skillKey: skill.skillKey,
      status: cacheHit ? 'cached' : 'completed',
      algorithm: skill.contract?.algorithm || null,
      inputs: [...skill.inputs],
      outputs: [...outputKeys],
      metadata_json: {
        cache_key: cacheKey,
        cache_hit: cacheHit,
        inputs: sourceAssets,
        outputs: outputKeys,
      },
    });
  }

  const stageRuns = stageScope.map((stageKey, index) => {
    const executions = skillExecutions.filter((item) => normalizeText(item.stageKey) === normalizeText(stageKey));
    const status = executions.length && executions.every((item) => ['completed', 'cached'].includes(item.status))
      ? 'completed'
      : executions.some((item) => item.status === 'failed')
        ? 'failed'
        : 'pending';
    return {
      stageKey,
      status,
      sortOrder: index + 1,
      contract: getStageContract(stageKey),
      skills: executions.map((item) => ({
        skillKey: item.skillKey,
        status: item.status,
        algorithm: item.algorithm,
        inputs: item.inputs,
        outputs: item.outputs,
      })),
    };
  });

  return {
    dag,
    stageRuns,
    skillExecutions,
    assetLineage: resultAssets.map((item) => ({
      stageKey: item.stageKey,
      assetKey: item.assetKey,
      lineage: item.lineage || item.lineage_json || null,
    })),
    assets: resultAssets,
    metaOutputs,
  };
}

function runStageDag(ctx, stageKey) {
  const { stageKeys, targetAssets } = getTargetAssetsForStage(stageKey);
  return executeDagForTargets(ctx, targetAssets, { stageKeys });
}

function runPipeline(ctx, upToStage) {
  const scope = upToStage ? getTargetAssetsForStage(upToStage) : getFullBuildTargets();
  const result = executeDagForTargets(ctx, scope.targetAssets, { stageKeys: scope.stageKeys });
  const executedStages = new Set(result.stageRuns.filter((item) => item.status === 'completed').map((item) => item.stageKey));

  if (typeof ctx.transitionTo === 'function') {
    if (executedStages.has('repo_understanding') && normalizeText(ctx.status) === 'queued') {
      ctx.transitionTo('generated');
    }
    if (executedStages.has('wiki_authoring') && !['analyzed', 'validated', 'ready', 'published'].includes(normalizeText(ctx.status))) {
      ctx.transitionTo('analyzed');
    }
    if (executedStages.has('quality_gates')) {
      const quality = typeof ctx.asset === 'function' ? ctx.asset('quality_report') : null;
      const nextStatus = normalizeText(quality?.status) === 'ready' ? 'ready' : 'needs_review';
      if (!['published'].includes(normalizeText(ctx.status))) {
        const transitionPath = resolveTransitionPath(ctx.status, nextStatus);
        const transitionContext = {
          approval_status: ctx.config?.approval_status || 'pending',
          lineage_json: ctx.config?.lineage_json || {},
        };
        for (const candidate of transitionPath.slice(1)) {
          ctx.transitionTo(candidate, transitionContext);
        }
      }
    }
  }

  return {
    ...result,
    ctx,
  };
}

module.exports = {
  META_OUTPUT_KEYS,
  planDag,
  buildDag,
  executeDagForTargets,
  runStageDag,
  runPipeline,
  getTargetAssetsForStage,
  getFullBuildTargets,
};
