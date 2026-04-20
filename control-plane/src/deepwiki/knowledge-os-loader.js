/**
 * Load Knowledge OS YAML specs from ai-rules/skills/knowledge-os/
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function resolveKnowledgeOsRoot() {
  return path.resolve(__dirname, '../../../ai-rules/skills/knowledge-os');
}

function safeRead(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8');
}

function loadYaml(filePath) {
  const raw = safeRead(filePath);
  if (!raw) return null;
  return yaml.load(raw);
}

function deepMerge(base, override) {
  if (!override || typeof override !== 'object') return base || {};
  const out = { ...(base && typeof base === 'object' ? base : {}) };
  for (const [k, v] of Object.entries(override)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * @param {{ repo_slug?: string }} options
 */
function loadKnowledgeOsBundle(options = {}) {
  const root = resolveKnowledgeOsRoot();
  const repoSlug = String(options.repo_slug || '').trim();
  const skillRegistry = loadYaml(path.join(root, 'skill-registry.yaml')) || {};
  const qualityGates = loadYaml(path.join(root, 'quality-gates.yaml')) || {};
  const pipelines = {
    deepwiki: loadYaml(path.join(root, 'pipelines', 'deepwiki.yaml')),
    prd_techspec: loadYaml(path.join(root, 'pipelines', 'prd-techspec.yaml')),
    techspec_testplan: loadYaml(path.join(root, 'pipelines', 'techspec-testplan.yaml')),
  };
  const docStandards = {
    deepwiki: loadYaml(path.join(root, 'doc-standards', 'deepwiki-skeleton.yaml')),
    prd: loadYaml(path.join(root, 'doc-standards', 'prd-skeleton.yaml')),
    tech_spec: loadYaml(path.join(root, 'doc-standards', 'techspec-skeleton.yaml')),
    test_plan: loadYaml(path.join(root, 'doc-standards', 'testplan-skeleton.yaml')),
    evidence: loadYaml(path.join(root, 'doc-standards', 'evidence.yaml')),
  };
  let projectOverride = null;
  if (repoSlug) {
    const overridePath = path.join(root, 'project-overrides', `${repoSlug}.yaml`);
    projectOverride = loadYaml(overridePath);
  }
  const mergedGates = deepMerge(qualityGates, projectOverride?.coverage ? { coverage: projectOverride.coverage } : {});
  return {
    version: skillRegistry.version || 'unknown',
    namespace: skillRegistry.namespace || 'knowledge-os',
    root,
    skill_registry: skillRegistry,
    quality_gates: mergedGates,
    pipelines,
    doc_standards: docStandards,
    project_override: projectOverride,
  };
}

function loadKnowledgeOsBundleSafe(options = {}) {
  try {
    return loadKnowledgeOsBundle(options);
  } catch {
    return null;
  }
}

function listKnowledgeOsEditableFiles() {
  const root = resolveKnowledgeOsRoot();
  const out = [];
  function walk(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (name === 'schemas') walk(full, rel);
        else walk(full, rel);
      } else if (/\.(ya?ml|json)$/i.test(name)) {
        out.push(rel.replace(/\\/g, '/'));
      }
    }
  }
  walk(root);
  return out.sort();
}

function readKnowledgeOsRelative(relPath) {
  const root = resolveKnowledgeOsRoot();
  const normalized = String(relPath || '').replace(/^\/+/, '').replace(/\.\./g, '');
  const full = path.join(root, normalized);
  if (!full.startsWith(root)) throw new Error('Invalid path');
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new Error('Not found');
  return { path: normalized, content: fs.readFileSync(full, 'utf8') };
}

function writeKnowledgeOsRelative(relPath, content) {
  const root = resolveKnowledgeOsRoot();
  const normalized = String(relPath || '').replace(/^\/+/, '').replace(/\.\./g, '');
  const full = path.join(root, normalized);
  if (!full.startsWith(root)) throw new Error('Invalid path');
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, String(content ?? ''), 'utf8');
  return { path: normalized };
}

module.exports = {
  resolveKnowledgeOsRoot,
  loadKnowledgeOsBundle,
  loadKnowledgeOsBundleSafe,
  listKnowledgeOsEditableFiles,
  readKnowledgeOsRelative,
  writeKnowledgeOsRelative,
  loadYaml,
};
