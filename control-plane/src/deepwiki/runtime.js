const fs = require('fs');
const path = require('path');
const { FileStore } = require('./core/storage/file-store');
const { listStageContracts, listSkillContracts } = require('./contracts/contracts');
const { rankEvidence } = require('./skills/evidence-ranker');
const { executeDagForTargets, getFullBuildTargets } = require('./core/pipeline/engine');
const {
  deriveLegacySnapshotFields,
  evaluatePublishEligibility,
  isPublishedSnapshot,
} = require('./snapshot-state-machine');

function normalizeText(value) {
  return String(value || '').trim();
}

function ensureObject(value, fallback = {}) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(values) {
  return [...new Set(toArray(values).map((item) => normalizeText(item)).filter(Boolean))];
}

function uniqueBy(items, selector) {
  const seen = new Set();
  return toArray(items).filter((item) => {
    const key = selector(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    return '';
  }
}

function stripQuotes(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")) || (text.startsWith('`') && text.endsWith('`'))) {
    return text.slice(1, -1);
  }
  return text;
}

function normalizeDynamicPath(value) {
  const text = stripQuotes(value)
    .replace(/\$\{[^}]+\}/g, '{param}')
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/{2,}/g, '/');
  if (!text) return '';
  if (text.length > 1 && text.endsWith('/')) return text.slice(0, -1);
  return text;
}

function repoRelativeSourcePath(value) {
  const normalized = normalizeText(value).replace(/\\/g, '/');
  const srcIndex = normalized.indexOf('/src/');
  if (srcIndex >= 0) return normalized.slice(srcIndex + 1);
  if (normalized.startsWith('src/')) return normalized;
  const docsIndex = normalized.indexOf('/docs/');
  if (docsIndex >= 0) return normalized.slice(docsIndex + 1);
  if (normalized.startsWith('docs/')) return normalized;
  return normalized.split('/').slice(-3).join('/');
}

function apiAliasKeys(relativePath) {
  const normalized = repoRelativeSourcePath(relativePath).replace(/\\/g, '/');
  const noExt = normalized.replace(/\.[^.]+$/, '');
  return uniqueStrings([
    normalized,
    noExt,
    noExt.replace(/^src\//, ''),
    noExt.replace(/^src\/api\//, 'api/'),
    normalized.replace(/^src\//, ''),
  ]);
}

function buildKeyFilePreviewMap(inventory) {
  const modules = [
    ...toArray(inventory && inventory.modules),
    ...toArray(inventory && inventory.business_modules),
    ...toArray(inventory && inventory.support_modules),
    ...toArray(inventory && inventory.noise_modules),
  ];
  const previewMap = new Map();
  modules.forEach((moduleInfo) => {
    toArray(moduleInfo && moduleInfo.key_files).forEach((file) => {
      const relativePath = repoRelativeSourcePath(file && file.path);
      if (!relativePath) return;
      const preview = normalizeText(file && file.preview);
      if (!preview) return;
      apiAliasKeys(relativePath).forEach((key) => {
        if (!previewMap.has(key)) {
          previewMap.set(key, preview);
        }
      });
    });
  });
  return previewMap;
}

function walkFilesRecursively(rootDir, allowExtensions) {
  const queue = [rootDir];
  const results = [];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch (error) {
      continue;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        return;
      }
      if (!entry.isFile()) return;
      const ext = path.extname(entry.name).toLowerCase();
      if (allowExtensions.has(ext)) {
        results.push(fullPath);
      }
    });
  }
  return results;
}

function normalizeImportAlias(value) {
  const text = normalizeText(value);
  if (!text) return '';
  return text
    .replace(/^\.\//, '')
    .replace(/^\.\.\//, '')
    .replace(/^@\//, '')
    .replace(/\.[^.]+$/, '')
    .replace(/\\/g, '/');
}

function buildFrontendImportIndex(repoRoot) {
  const importIndex = new Map();
  const searchRoots = ['src/views', 'src/components']
    .map((relativePath) => path.join(repoRoot, relativePath))
    .filter((absolutePath) => {
      try {
        return fs.existsSync(absolutePath);
      } catch (error) {
        return false;
      }
    });
  const allowExtensions = new Set(['.vue', '.js', '.ts', '.jsx', '.tsx']);
  searchRoots.forEach((searchRoot) => {
    walkFilesRecursively(searchRoot, allowExtensions).forEach((filePath) => {
      const content = safeReadFile(filePath);
      if (!content) return;
      const relativeImporter = normalizeText(path.relative(repoRoot, filePath)).replace(/\\/g, '/');
      const importRegex = /from\s+['"](@\/api\/[^'"]+|\.\.?\/[^'"]+)['"]|require\(\s*['"](@\/api\/[^'"]+|\.\.?\/[^'"]+)['"]\s*\)/g;
      let match = importRegex.exec(content);
      while (match) {
        const rawTarget = normalizeImportAlias(match[1] || match[2]);
        if (rawTarget.includes('api/')) {
          const key = rawTarget.replace(/^src\//, '');
          const existing = importIndex.get(key) || [];
          existing.push(relativeImporter);
          importIndex.set(key, existing);
        }
        match = importRegex.exec(content);
      }
    });
  });
  return importIndex;
}

function sourceLabelFromImporter(importerPath, domainKey) {
  const normalized = normalizeText(importerPath).replace(/\\/g, '/');
  if (!normalized) return '';
  if (/AIOrderingAssistant/i.test(normalized)) {
    return 'AI 协同助手面板';
  }
  if (/\/views\//i.test(normalized)) {
    const leaf = normalized.split('/').slice(-2).join('/');
    return leaf.replace(/\.[^.]+$/, '');
  }
  if (domainKey === 'ai_ordering') {
    return 'AI 协同前端入口';
  }
  return normalized.split('/').slice(-2).join('/').replace(/\.[^.]+$/, '');
}

function pageActionFromFrontendApi(relativePath, functionName, endpointPath) {
  const normalized = repoRelativeSourcePath(relativePath).toLowerCase();
  if (normalized.includes('ai-ordering-assistant')) return 'AI 协同助手';
  if (normalized.includes('/basiccategory')) return '基础资料分类维护';
  if (normalized.includes('/basiccategoryinfo')) return '基础资料查询与维护';
  if (normalized.includes('/billcommon')) return '单据公共能力';
  if (normalized.includes('/fee') || normalized.includes('/finance/')) return '财务单据处理';
  if (normalized.includes('/goods')) return '商品资料维护';
  if (normalized.includes('/company')) return '企业组织资料维护';
  if (normalized.includes('/inventory') || normalized.includes('/storehouse') || normalized.includes('/warehouse')) return '库存入出库处理';
  if (normalized.includes('/procurement')) return '采购单据处理';
  if (normalized.includes('/sale')) return '销售单据处理';
  const actionSource = normalizeText(functionName || endpointPath || relativePath);
  return actionSource
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, ' ')
    .trim() || '前端入口';
}

function extractStringConstants(sourceText) {
  const constants = new Map();
  const constantRegex = /const\s+([A-Z0-9_]+)\s*=\s*(['"`])([\s\S]*?)\2/g;
  let match = constantRegex.exec(sourceText);
  while (match) {
    constants.set(match[1], normalizeDynamicPath(match[3]));
    match = constantRegex.exec(sourceText);
  }
  return constants;
}

function resolveUrlExpression(expression, constants) {
  const text = normalizeText(expression);
  if (!text) return '';
  const joined = text.match(/^joinBaseUrl\(([^)]+)\)$/);
  if (joined) {
    return resolveUrlExpression(joined[1], constants);
  }
  if (constants.has(text)) {
    return constants.get(text);
  }
  return normalizeDynamicPath(text);
}

function extractFunctionBlocks(sourceText) {
  const blocks = [];
  const functionRegex = /export\s+(async\s+)?function\s+([A-Za-z0-9_]+)\s*\([^)]*\)\s*\{/g;
  let match = functionRegex.exec(sourceText);
  while (match) {
    const functionName = match[2];
    const openBraceIndex = functionRegex.lastIndex - 1;
    let cursor = openBraceIndex + 1;
    let depth = 1;
    while (cursor < sourceText.length && depth > 0) {
      const char = sourceText[cursor];
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      cursor += 1;
    }
    blocks.push({
      functionName,
      body: sourceText.slice(openBraceIndex + 1, cursor - 1),
    });
    match = functionRegex.exec(sourceText);
  }
  return blocks;
}

function parseRequestCallsFromSource(sourceText, relativePath, importerIndex = new Map()) {
  const constants = extractStringConstants(sourceText);
  const aliasKey = apiAliasKeys(relativePath).find((item) => item.startsWith('api/')) || apiAliasKeys(relativePath)[0] || '';
  const importerPaths = uniqueStrings(importerIndex.get(aliasKey) || importerIndex.get(aliasKey.replace(/^api\//, '')) || []);
  const calls = [];
  extractFunctionBlocks(sourceText).forEach(({ functionName, body }) => {
    const domainKeyMatch = /ai-ordering-assistant/i.test(relativePath) ? 'ai_ordering' : '';
    const pushCall = (pathValue, methodValue) => {
      const normalizedPath = resolveUrlExpression(pathValue, constants);
      const normalizedMethod = normalizeText(methodValue || 'POST').toUpperCase() || 'POST';
      if (!normalizedPath) return;
      const primaryImporter = importerPaths[0] || repoRelativeSourcePath(relativePath);
      calls.push({
        pageAction: pageActionFromFrontendApi(relativePath, functionName, normalizedPath),
        pageId: primaryImporter,
        method: normalizedMethod,
        path: normalizedPath,
        action: functionName,
        source: repoRelativeSourcePath(relativePath),
        importerPaths,
        sourceLabel: sourceLabelFromImporter(primaryImporter, domainKeyMatch),
      });
    };

    const requestMatch = body.match(/request\s*\(\s*\{[\s\S]*?url:\s*([^,\n]+)[\s\S]*?method:\s*['"`]([A-Za-z]+)['"`]/);
    if (requestMatch) {
      pushCall(requestMatch[1], requestMatch[2]);
    }
    const fallbackMatch = body.match(/postWithFallback\(\s*([^,\n]+)\s*,\s*([^,\n]+)\s*,/);
    if (fallbackMatch) {
      pushCall(fallbackMatch[1], 'POST');
      pushCall(fallbackMatch[2], 'POST');
    }
    const fetchMatch = body.match(/fetch\(\s*([^,\n]+)\s*,\s*\{[\s\S]*?method:\s*['"`]([A-Za-z]+)['"`]/);
    if (fetchMatch) {
      pushCall(fetchMatch[1], fetchMatch[2]);
    }
  });
  return uniqueBy(calls, (item) => `${item.pageId}:${item.method}:${item.path}:${item.action}`);
}

function extractFrontendApiCalls(repoRoot, apiFiles = [], inventory) {
  const previewMap = buildKeyFilePreviewMap(inventory);
  const importerIndex = buildFrontendImportIndex(repoRoot);
  return uniqueBy(
    toArray(apiFiles).flatMap((apiFile) => {
      const relativePath = repoRelativeSourcePath(apiFile);
      if (!relativePath || !relativePath.startsWith('src/api/')) return [];
      const absolutePath = path.join(repoRoot, relativePath);
      const content = safeReadFile(absolutePath) || previewMap.get(`api/${relativePath.replace(/^src\/api\//, '').replace(/\.[^.]+$/, '')}`) || previewMap.get(relativePath) || '';
      if (!content) return [];
      return parseRequestCallsFromSource(content, relativePath, importerIndex);
    }),
    (item) => `${item.pageId}:${item.method}:${item.path}:${item.action}`
  );
}

function parseSqlTableDefinition(content, targetTable = '') {
  const text = normalizeText(content);
  if (!text) {
    return {
      table: normalizeText(targetTable),
      pk: 'id',
      states: [],
      columns: [],
      tableComment: '',
    };
  }
  const escapedTable = normalizeText(targetTable).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = escapedTable
    ? new RegExp(
        `CREATE\\s+TABLE\\s+\`?${escapedTable}\`?\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE=[\\s\\S]*?(?:COMMENT\\s*=\\s*'([^']*)')?`,
        'i'
      )
    : /CREATE\s+TABLE\s+`?([A-Za-z0-9_]+)`?\s*\(([\s\S]*?)\)\s*ENGINE=[\s\S]*?(?:COMMENT\s*=\s*'([^']*)')?/i;
  const match = text.match(regex);
  if (!match) {
    return {
      table: normalizeText(targetTable),
      pk: 'id',
      states: [],
      columns: [],
      tableComment: '',
    };
  }
  const body = escapedTable ? match[1] : match[2];
  const table = normalizeText(targetTable || match[1]);
  const tableComment = normalizeText(escapedTable ? match[2] : match[3]);
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const columns = [];
  let pk = 'id';
  const states = [];
  lines.forEach((line) => {
    const cleaned = line.replace(/,$/, '');
    const columnMatch = cleaned.match(/^`([^`]+)`\s+([^\s,]+(?:\([^)]+\))?)([\s\S]*)$/);
    if (columnMatch) {
      const name = normalizeText(columnMatch[1]);
      const type = normalizeText(columnMatch[2]);
      const extras = normalizeText(columnMatch[3]);
      const commentMatch = cleaned.match(/COMMENT\s+'([^']+)'/i);
      columns.push({
        name,
        type,
        comment: normalizeText(commentMatch && commentMatch[1]),
      });
      if (/^(status|is_valid|is_deleted|submit_success|preview_generated|image_attached)$/i.test(name)) {
        states.push(name);
      }
      return;
    }
    const pkMatch = cleaned.match(/^PRIMARY\s+KEY\s+\(`([^`]+)`\)/i);
    if (pkMatch) {
      pk = normalizeText(pkMatch[1]) || pk;
    }
  });
  return {
    table,
    pk,
    states: uniqueStrings(states),
    columns,
    tableComment,
  };
}

function enrichSqlTables(repoRoot, tables = []) {
  return toArray(tables).map((entry) => {
    const value = ensureObject(entry, typeof entry === 'string' ? { table: entry } : {});
    const tableName = normalizeText(value.table_name || value.table || value.name);
    const pathValue = normalizeText(value.path || value.source || '');
    const relativePath = repoRelativeSourcePath(pathValue);
    const absolutePath = path.isAbsolute(pathValue)
      ? pathValue
      : relativePath
        ? path.join(repoRoot, relativePath)
        : '';
    const content = safeReadFile(absolutePath);
    const parsed = parseSqlTableDefinition(content, tableName);
    return {
      ...value,
      table_name: tableName || normalizeText(parsed.table),
      table: tableName || normalizeText(parsed.table),
      pk: normalizeText(value.pk || parsed.pk || 'id'),
      states: uniqueStrings([...(value.states || []), ...(parsed.states || [])]),
      columns: toArray(parsed.columns),
      tableComment: normalizeText(value.tableComment || parsed.tableComment),
      path: pathValue,
    };
  });
}

function buildStore(rootDir) {
  return new FileStore(rootDir);
}

function createProjectionExecutionContext(input, store) {
  const snapshot = input.snapshot || {};
  const snapshotId = snapshot.id;
  const savedAssets = [];
  const savedMeta = {};
  return {
    config: buildProjectionConfig(input),
    project: input.project || {},
    snapshot,
    status: normalizeText(snapshot.status || deriveLegacySnapshotFields(snapshot).publish_status || 'draft'),
    savedAssets,
    savedMeta,
    asset(assetKey) {
      const env = store.readAsset(snapshotId, assetKey);
      return env ? env.payload : null;
    },
    save(stageKey, assetKey, payload, extras = {}) {
      const env = store.saveAsset(snapshotId, assetKey, stageKey, payload, extras);
      savedAssets.push(env);
      return env;
    },
    saveMeta(key, payload) {
      const env = store.saveMeta(snapshotId, key, payload);
      savedMeta[key] = env;
      return env;
    },
    transitionTo(nextStatus, updates = {}) {
      this.status = normalizeText(nextStatus || this.status) || this.status;
      if (updates && typeof updates === 'object' && !Array.isArray(updates)) {
        this.config = {
          ...this.config,
          ...updates,
        };
        if (Object.prototype.hasOwnProperty.call(updates, 'approval_status')) {
          this.snapshot = {
            ...this.snapshot,
            approval_status: updates.approval_status,
          };
        }
        if (Object.prototype.hasOwnProperty.call(updates, 'lineage_json')) {
          this.snapshot = {
            ...this.snapshot,
            lineage_json: updates.lineage_json,
          };
        }
      }
      return this.status;
    },
  };
}

function resolveStoreRootFromSnapshot(snapshot) {
  const outputRoot = normalizeText(snapshot && snapshot.metadata_json && snapshot.metadata_json.output_root);
  return outputRoot || process.cwd();
}

function listContracts() {
  return {
    stages: listStageContracts(),
    skills: listSkillContracts(),
  };
}

function buildDefaultStageRuns(snapshotId) {
  return listStageContracts().map((contract, index) => ({
    stageKey: contract.stageKey,
    status: contract.stageKey === 'quality_gates' ? 'completed' : contract.stageKey === 'solution_derivation' ? 'completed' : 'completed',
    sortOrder: index + 1,
    contract,
  }));
}

function repoIdentityTokens(repo) {
  const repoId = normalizeText(repo && (repo.repo_slug || repo.repoId || repo.repo_source_id || repo.repo_url));
  const lastToken = repoId.split('/').filter(Boolean).pop() || repoId;
  return [repoId, lastToken, repoId.replace(/\//g, '--')].map((item) => normalizeText(item).toLowerCase()).filter(Boolean);
}

function belongsToRepo(entry, repo) {
  const text = JSON.stringify(entry || {}).toLowerCase();
  return repoIdentityTokens(repo).some((token) => token && text.includes(token));
}

function flattenControllerApis(controllers = [], repo) {
  return toArray(controllers)
    .filter((item) => belongsToRepo(item, repo))
    .flatMap((item) =>
      toArray(item.endpoints).map((endpoint) => ({
        method: normalizeText(endpoint).split(/\s+/)[0] || 'GET',
        path: normalizeText(endpoint).split(/\s+/).slice(1).join(' '),
        action: normalizeText(item.class_name || item.className),
        source: normalizeText(item.path),
      }))
    );
}

function deriveRepoEvents(input, repo) {
  const graphObjects = toArray(input.knowledgeGraph && input.knowledgeGraph.objects);
  const eventObjects = graphObjects.filter((item) => /event/i.test(normalizeText(item.object_type)) && belongsToRepo(item.payload_json || item, repo));
  return eventObjects.map((item) => ({
    event: normalizeText(item.title || item.object_key),
    topic: normalizeText(item.object_key || item.title),
    path: normalizeText(item.payload_json && item.payload_json.source_uri),
  }));
}

function buildProjectionConfig(input) {
  const inventory = ensureObject(input.inventory, {});
  const repoUnits = toArray(inventory.repo_units).length ? toArray(inventory.repo_units) : toArray(input.preparedRepoUnits);
  const repos = repoUnits.map((repo) => {
    const role = normalizeText(repo.repo_role || repo.role || 'backend');
    const repoRoot = normalizeText(repo.local_path || repo.cache_path || repo.repo_url);
    const frontendPages = role === 'frontend'
      ? uniqueBy(
          [...toArray(repo.frontend_pages || repo.frontendPages), ...toArray(inventory.frontend_pages)],
          (item) => normalizeText(item)
        )
      : [];
    const frontendApiFiles = role === 'frontend'
      ? uniqueBy(
          [
            ...toArray(repo.api_files || repo.apiFiles),
            ...toArray(inventory.api_files).filter((item) => {
              const normalized = normalizeText(item).replace(/\\/g, '/').toLowerCase();
              if (belongsToRepo(item, repo)) return true;
              return normalized.startsWith('frontend/') || normalized.includes('/src/api/');
            }),
          ],
          (item) => normalizeText(item)
        )
      : [];
    const extractedApiCalls = role === 'frontend' && repoRoot
      ? extractFrontendApiCalls(repoRoot, frontendApiFiles, inventory)
      : [];
    const enrichedFrontendPages = role === 'frontend'
      ? uniqueBy(
          [
            ...frontendPages,
            ...extractedApiCalls.map((item) => item.pageId).filter(Boolean),
          ],
          (item) => normalizeText(item)
        )
      : frontendPages;
    const controllers = toArray(inventory.controllers).filter((item) => belongsToRepo(item, repo));
    const services = toArray(inventory.services).filter((item) => belongsToRepo(item, repo));
    const repositories = toArray(inventory.repositories || inventory.mapper_models).filter((item) => belongsToRepo(item, repo));
    const entities = toArray(inventory.entities || inventory.tables).filter((item) => belongsToRepo(item, repo));
    const dtos = [...toArray(inventory.dto_models), ...toArray(inventory.vo_models)].filter((item) => belongsToRepo(item, repo));
    const utils = toArray(inventory.deploy_files).filter((item) => belongsToRepo(item, repo)).slice(0, 24).map((pathValue) => ({ path: pathValue, symbol: pathValue }));
    const tests = toArray(inventory.test_files || []).filter((item) => belongsToRepo(item, repo)).map((pathValue) => ({ path: pathValue, symbol: pathValue }));
    const apis = role === 'frontend'
      ? []
      : [
          ...flattenControllerApis(inventory.controllers, repo),
          ...toArray(inventory.api_endpoints).map((item) => {
            const endpoint = normalizeText(item);
            return {
              method: endpoint.split(/\s+/)[0] || 'GET',
              path: endpoint.split(/\s+/).slice(1).join(' '),
              action: endpoint.split('/').filter(Boolean).slice(-1)[0] || endpoint,
              source: endpoint,
            };
          }),
        ];
    const rawTables = role === 'frontend'
      ? []
      : [
          ...toArray(inventory.sql_tables).filter((item) => belongsToRepo(item, repo)),
          ...toArray(inventory.tables).map((table) => ({ table_name: table, table })),
        ];
    const tables = role === 'frontend' ? [] : enrichSqlTables(repoRoot, rawTables);
    return {
      repoId: normalizeText(repo.repo_slug || repo.repoId || repo.repo_source_id || repo.repo_url),
      repo_slug: normalizeText(repo.repo_slug || repo.repoId || repo.repo_source_id || repo.repo_url),
      role,
      root: repoRoot,
      branch: normalizeText(repo.branch || input.snapshot?.branch),
      commitSha: normalizeText(repo.commit_sha || input.snapshot?.commit_sha),
      manifests: [],
      dependencies: uniqueStrings(
        toArray(repo.dependencies).concat(
          toArray(repoUnits)
            .filter((unit) => normalizeText(unit.repo_slug) !== normalizeText(repo.repo_slug))
            .map((unit) => unit.repo_slug)
        )
      ).slice(0, 4),
      apiCalls: extractedApiCalls,
      apis,
      apiFiles: frontendApiFiles,
      frontendPages: enrichedFrontendPages.map((item) => ({ path: item, title: item, pageId: item })),
      tables,
      events: deriveRepoEvents(input, repo),
      handlers: [],
      controllers,
      services,
      repositories,
      entities,
      dtos,
      utils,
      tests,
    };
  });
  const domains = toArray(input.domains).map((item) => ({
    key: normalizeText(item.domain_key || item.key || item.domain_name || item.title),
    name: normalizeText(item.domain_name || item.title || item.key),
    capabilities: uniqueStrings([
      ...toArray(item.capabilities_json),
      ...toArray(input.flows)
        .filter((flow) => normalizeText(flow.domain_key) === normalizeText(item.domain_key))
        .map((flow) => flow.flow_name || flow.flow_code),
    ]),
  })).filter((item) => item.key || item.name);
  const requirements = uniqueStrings([
    ...(input.project && input.project.mission ? [input.project.mission] : []),
    ...toArray(input.documentRevisions).map((item) => item.title),
    ...toArray(input.flows).map((item) => item.flow_name || item.flow_code),
  ]);
  return {
    projectId: input.project && input.project.id,
    projectCode: input.project && input.project.project_code,
    projectName: input.project && input.project.project_name,
    snapshotId: input.snapshot && input.snapshot.id,
    snapshotStatus: normalizeText(input.snapshot && input.snapshot.status),
    approval_status: normalizeText(input.snapshot && input.snapshot.approval_status) || 'pending',
    lineage_json:
      input.snapshot && input.snapshot.lineage_json && typeof input.snapshot.lineage_json === 'object'
        ? input.snapshot.lineage_json
        : {},
    publish_ready: Boolean(input.snapshot && input.snapshot.publish_ready),
    quality_gate_blocked: Boolean(input.snapshot && input.snapshot.quality_gate_blocked),
    versionLine: normalizeText(input.snapshot && (input.snapshot.version_line_display_name || input.snapshot.version_line_name || input.snapshot.branch)),
    repos,
    domains,
    requirements,
  };
}

function deriveTopology(project, preparedRepoUnits, snapshot) {
  const repos = toArray(preparedRepoUnits).map((item) => ({
    repoId: normalizeText(item.repo_slug || item.repo_source_id || item.repo_url),
    repoSourceId: item.repo_source_id || null,
    role: normalizeText(item.repo_role || 'backend') || 'backend',
    root: normalizeText(item.local_path || item.cache_path || item.repo_url),
    branch: normalizeText(item.branch || snapshot.branch),
    commitSha: normalizeText(item.commit_sha || snapshot.commit_sha),
    subsystem: /front/i.test(String(item.repo_role || '')) ? 'experience' : /bff/i.test(String(item.repo_role || '')) ? 'gateway' : 'core',
  }));
  return {
    projectId: project && project.id ? project.id : null,
    projectCode: project && project.project_code ? project.project_code : null,
    projectName: project && project.project_name ? project.project_name : null,
    versionLine: normalizeText(snapshot && (snapshot.version_line_display_name || snapshot.version_line_name || snapshot.branch)),
    repos,
  };
}

function deriveStructureAssets(inventory, preparedRepoUnits, knowledgeGraph) {
  const symbols = [
    ...toArray(inventory && inventory.controllers).map((item) => ({ repoId: item.repo_unit_id || null, symbol: item.class_name || item.path, kind: 'controller' })),
    ...toArray(inventory && inventory.services).map((item) => ({ repoId: item.repo_unit_id || null, symbol: item.class_name || item.path, kind: 'service' })),
    ...toArray(inventory && inventory.entities).map((item) => ({ repoId: item.repo_unit_id || null, symbol: item.class_name || item.table_name || item.path, kind: 'entity' })),
  ];
  const callGraph = toArray(knowledgeGraph && knowledgeGraph.relations)
    .slice(0, 200)
    .map((item, index) => ({
      id: index + 1,
      from: `${item.from_object_type}:${item.from_object_key}`,
      to: `${item.to_object_type}:${item.to_object_key}`,
      edgeType: item.relation_type,
    }));
  const crossRepoEdges = [];
  const repos = toArray(preparedRepoUnits);
  for (let index = 1; index < repos.length; index += 1) {
    crossRepoEdges.push({
      fromRepo: normalizeText(repos[index - 1].repo_slug || repos[index - 1].repo_source_id),
      toRepo: normalizeText(repos[index].repo_slug || repos[index].repo_source_id),
      edgeType: 'project_manifest',
    });
  }
  return {
    symbols,
    callGraph,
    crossRepoEdges,
    layeredArchitecture: {
      layers: ['frontend', 'bff', 'application', 'domain', 'data'],
      repoCount: repos.length,
    },
  };
}

function deriveDataContractAssets(inventory, knowledgeGraph) {
  const apiContracts = toArray(inventory && inventory.api_endpoints).map((item) => ({ path: item }));
  const frontendRequestMap = toArray(knowledgeGraph && knowledgeGraph.objects)
    .filter((item) => normalizeText(item.object_type) === 'frontend_page')
    .map((item) => ({ pageAction: item.title || item.object_key, request: 'derived-from-page' }));
  const erModel = toArray(inventory && inventory.sql_tables).map((item) => ({
    table: item.table_name,
    source: item.path,
  }));
  const eventCatalog = toArray(knowledgeGraph && knowledgeGraph.objects)
    .filter((item) => /event/i.test(normalizeText(item.object_type)))
    .map((item) => ({ event: item.title || item.object_key }));
  return {
    apiContracts,
    frontendRequestMap,
    erModel,
    eventCatalog,
  };
}

function deriveSemanticAssets(domains, threads, flows) {
  return {
    businessTerms: toArray(domains).map((item) => item.domain_name || item.title || item.domain_key).filter(Boolean),
    businessActions: toArray(flows).map((item) => item.flow_name || item.flow_code).filter(Boolean),
    frontendJourneys: toArray(threads).filter((item) => normalizeText(item.thread_level) === 'frontend_journey'),
    stateMachines: toArray(flows).filter((item) => /state|status/i.test(normalizeText(item.flow_type))),
    aggregateCandidates: toArray(domains).map((item) => ({
      name: item.domain_name || item.title || item.domain_key,
      reasons: ['domain_projection'],
    })),
  };
}

function deriveDddAssets(domains, threads, preparedRepoUnits) {
  const domainModel = {
    domains: toArray(domains).map((item) => ({
      name: item.domain_name || item.title || item.domain_key,
      key: item.domain_key || item.domain_name || item.title,
      participatingRepos: toArray(preparedRepoUnits).map((repo) => repo.repo_slug).filter(Boolean),
      confidence: item.confidence || item.score || 0.7,
    })),
  };
  const capabilityMap = toArray(threads).map((item) => ({
    domain: item.domain_key || 'project',
    capability: item.title || item.thread_key,
  }));
  const contextMap = toArray(preparedRepoUnits).map((repo, index, all) => ({
    from: repo.repo_role || repo.repo_slug,
    to: all[index + 1] ? (all[index + 1].repo_role || all[index + 1].repo_slug) : 'project_boundary',
    relation: all[index + 1] ? 'calls' : 'contains',
  }));
  return {
    domainModel,
    capabilityMap,
    contextMap,
  };
}

function flattenEvidence(knowledgeGraph, pages, diagrams) {
  const fromGraph = toArray(knowledgeGraph && knowledgeGraph.objects).flatMap((item) =>
    toArray(item.evidence).map((evidence) => ({
      type: evidence.evidence_type || 'code',
      source: evidence.source_uri || evidence.source_ref || evidence.quote_text || item.title || item.object_key,
      repoId: evidence.repo_id || null,
      lines: evidence.line_span || null,
    }))
  );
  const fromPages = toArray(pages).flatMap((page) =>
    toArray(page.source_files).slice(0, 8).map((source) => ({
      type: 'code',
      source,
      repoId: null,
    }))
  );
  const fromDiagrams = toArray(diagrams).flatMap((diagram) =>
    toArray(diagram.covered_evidence).map((source) => ({
      type: 'doc',
      source,
      repoId: null,
    }))
  );
  return [...fromGraph, ...fromPages, ...fromDiagrams].filter((item) => normalizeText(item.source));
}

function deriveEvidenceAssets(knowledgeGraph, pages, diagrams) {
  const ranked = rankEvidence(flattenEvidence(knowledgeGraph, pages, diagrams));
  const top = ranked.slice(0, 12);
  const publishReadySignals = {
    multiSource: new Set(top.map((item) => item.type)).size >= 2,
    // test_penalty is retained at 0 for back-compat; tests are now a positive
    // business-rule signal (see evidence-ranker.js inferTestBoost). Flag only
    // mock/fixture noise (via noise_penalty) as pollution.
    testPollution: top.some((item) => Number((item.factors || {}).noise_penalty || 0) < -0.15),
    evidenceCount: ranked.length,
  };
  return {
    evidenceIndex: ranked,
    confidenceReport: {
      overall: ranked.length ? Number((top.reduce((sum, item) => sum + Number(item.finalScore || 0), 0) / top.length).toFixed(4)) : 0,
      reasons: [
        publishReadySignals.multiSource ? 'multi_source' : 'single_source_only',
        publishReadySignals.testPollution ? 'test_pollution_detected' : 'test_purity_ok',
      ],
    },
    qualitySignals: publishReadySignals,
  };
}

function deriveWikiAssets(pages, domains) {
  return {
    wikiPages: toArray(pages).map((page) => ({
      pageSlug: page.page_slug,
      title: page.title,
      pageType: page.page_type,
      sourceUri: page.source_uri,
      participatingRepos: toArray(page.metadata_json && page.metadata_json.participating_repos),
      evidenceAsset: 'evidence_index',
    })),
    wikiIndex: {
      domains: toArray(domains).map((item) => item.domain_name || item.title || item.domain_key).filter(Boolean),
      pageCount: toArray(pages).length,
    },
  };
}

function deriveQualityAssets(snapshot, qualityReport, evidenceAssets) {
  const qualityStatus = normalizeText(qualityReport && qualityReport.status).toLowerCase();
  const qualityBlocked = !['published', 'review', 'ready'].includes(qualityStatus || 'draft');
  const gateDecisions = evaluatePublishEligibility(
    {
      status: qualityBlocked ? 'validated' : 'ready',
      quality_gate_blocked: qualityBlocked || toArray(evidenceAssets.evidenceIndex).length === 0,
      approval_status: snapshot.approval_status || 'pending',
      lineage_json: snapshot.lineage_json || {},
    },
    [
      {
        gate_key: qualityBlocked ? 'quality_gate_blocked' : 'publish_gate',
        decision_status: qualityBlocked || toArray(evidenceAssets.evidenceIndex).length === 0 ? 'blocked' : 'pass',
        is_blocking: qualityBlocked || toArray(evidenceAssets.evidenceIndex).length === 0,
      },
    ]
  );
  return {
    qualityReport: {
      status: qualityReport && qualityReport.status ? qualityReport.status : snapshot.quality_status || 'pending',
      score: qualityReport && qualityReport.score != null ? qualityReport.score : null,
      summary: qualityReport && qualityReport.summary ? qualityReport.summary : '',
      details: ensureObject(qualityReport && qualityReport.quality_json, {}),
    },
    gateDecisions: {
      publishReady: gateDecisions.publishReady,
      qualityGateBlocked: gateDecisions.qualityGateBlocked,
      blockers: gateDecisions.blockers,
      reason: gateDecisions.reason,
      snapshotStatus: snapshot.status || deriveLegacySnapshotFields(snapshot).publish_status,
      qualityStatus: snapshot.quality_status || qualityStatus || 'pending',
    },
  };
}

function deriveDerivationAssets(snapshot, project, domains) {
  const formal = isPublishedSnapshot(snapshot);
  return {
    impactMatrix: toArray(domains).map((domain) => ({
      requirement: `${project && project.project_name ? project.project_name : '项目'} 需求影响`,
      impactedDomains: [domain.domain_name || domain.title || domain.domain_key].filter(Boolean),
    })),
    techSpecBundle: {
      mode: formal ? 'formal' : 'draft',
      summary: `${formal ? '基于 published snapshot 的正式技术方案。' : '基于未发布 snapshot 的技术方案草案。'}`,
      sourceSnapshotId: snapshot.id,
    },
    testPlanBundle: {
      mode: formal ? 'formal' : 'draft',
      summary: `${formal ? '覆盖页面、接口、表写入与事件发布的正式测试方案。' : '基于当前 snapshot 的测试方案草案。'}`,
      sourceSnapshotId: snapshot.id,
    },
  };
}

function syncTemplateProjection(input) {
  const snapshot = input.snapshot;
  if (!snapshot || !snapshot.id) return null;
  const store = buildStore(resolveStoreRootFromSnapshot(snapshot));
  const snapshotId = snapshot.id;
  const ctx = createProjectionExecutionContext(input, store);
  const fullTargets = getFullBuildTargets();
  const execution = executeDagForTargets(ctx, fullTargets.targetAssets, { stageKeys: fullTargets.stageKeys });
  const result = execution instanceof Promise ? null : execution;
  if (!result) {
    throw new Error('executeDagForTargets must resolve synchronously in template projection');
  }
  const assetsByStage = result.stageRuns.reduce((acc, stageRun) => {
    acc[stageRun.stageKey] = {};
    return acc;
  }, {});
  result.assets.forEach((asset) => {
    if (!assetsByStage[asset.stageKey]) {
      assetsByStage[asset.stageKey] = {};
    }
    assetsByStage[asset.stageKey][asset.assetKey] = asset.payload;
  });

  store.saveMeta(snapshotId, 'contracts', listContracts());
  store.saveMeta(snapshotId, 'stage_runs', result.stageRuns);
  store.saveMeta(snapshotId, 'skill_executions', result.skillExecutions);
  store.saveMeta(snapshotId, 'asset_lineage', result.assetLineage);
  store.saveMeta(snapshotId, 'snapshot_projection', {
    snapshotId,
    publishStatus: deriveLegacySnapshotFields(snapshot).publish_status,
    qualityStatus: snapshot.quality_status || 'pending',
    outputRoot: resolveStoreRootFromSnapshot(snapshot),
  });

  return {
    snapshotId,
    rootDir: resolveStoreRootFromSnapshot(snapshot),
    contracts: listContracts(),
    stageRuns: result.stageRuns,
    skillExecutions: result.skillExecutions,
    assetLineage: result.assetLineage,
    assets: ctx.savedAssets,
    assetsByStage,
    gateDecisions: assetsByStage.quality_gates?.gate_decisions || {},
    scoreOutputs: {
      project_scores: ctx.savedMeta.project_scores || null,
      snapshot_scores: ctx.savedMeta.snapshot_scores || null,
      domain_scores: ctx.savedMeta.domain_scores || null,
      capability_scores: ctx.savedMeta.capability_scores || null,
      flow_scores: ctx.savedMeta.flow_scores || null,
      journey_scores: ctx.savedMeta.journey_scores || null,
      page_scores: ctx.savedMeta.page_scores || null,
      diagram_scores: ctx.savedMeta.diagram_scores || null,
      solution_scores: ctx.savedMeta.solution_scores || null,
      score_breakdowns: ctx.savedMeta.score_breakdowns || null,
      ranking_views: ctx.savedMeta.ranking_views || null,
      score_regressions: ctx.savedMeta.score_regressions || null,
      health_indices: ctx.savedMeta.health_indices || null,
    },
    visibleProjection: ctx.savedMeta.algorithm_visible_projection || null,
    assetCount: result.assetLineage.length,
    dag: result.dag,
  };
}

function readSnapshotProjection(snapshot) {
  if (!snapshot || !snapshot.id) return null;
  const store = buildStore(resolveStoreRootFromSnapshot(snapshot));
  return {
    contracts: store.readMeta(snapshot.id, 'contracts') || listContracts(),
    stageRuns: store.readMeta(snapshot.id, 'stage_runs') || [],
    skillExecutions: store.readMeta(snapshot.id, 'skill_executions') || [],
    assetLineage: store.readMeta(snapshot.id, 'asset_lineage') || [],
    assets: store.listAssets(snapshot.id),
    scores: {
      projectScores: store.readMeta(snapshot.id, 'project_scores'),
      snapshotScores: store.readMeta(snapshot.id, 'snapshot_scores'),
      domainScores: store.readMeta(snapshot.id, 'domain_scores'),
      capabilityScores: store.readMeta(snapshot.id, 'capability_scores'),
      flowScores: store.readMeta(snapshot.id, 'flow_scores'),
      journeyScores: store.readMeta(snapshot.id, 'journey_scores'),
      pageScores: store.readMeta(snapshot.id, 'page_scores'),
      diagramScores: store.readMeta(snapshot.id, 'diagram_scores'),
      solutionScores: store.readMeta(snapshot.id, 'solution_scores'),
      scoreBreakdowns: store.readMeta(snapshot.id, 'score_breakdowns'),
      rankingViews: store.readMeta(snapshot.id, 'ranking_views'),
      scoreRegressions: store.readMeta(snapshot.id, 'score_regressions'),
      healthIndices: store.readMeta(snapshot.id, 'health_indices'),
    },
  };
}

module.exports = {
  listContracts,
  syncTemplateProjection,
  readSnapshotProjection,
  resolveStoreRootFromSnapshot,
};
