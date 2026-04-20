const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { createBuildDeepWikiPages } = require('./page-builder');

const execFileAsync = promisify(execFile);

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  '.next',
  '.turbo',
  '.idea',
  '.vscode',
  '.cache',
  '.pytest_cache',
  '__pycache__',
  'target',
  'out',
]);

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'composer.lock',
  'poetry.lock',
  'Cargo.lock',
]);

const SOURCE_CODE_EXTENSIONS = new Set([
  '.java',
  '.kt',
  '.groovy',
  '.scala',
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.py',
  '.rb',
  '.go',
  '.php',
]);

const COMMON_ENTRY_FILES = [
  'README.md',
  'README.zh-CN.md',
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'settings.gradle',
  'settings.gradle.kts',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  'Makefile',
  'requirements.txt',
  'go.mod',
  'Cargo.toml',
];

const NOISE_MODULE_DIRS = new Set([
  '.cursor',
  '.github',
  '.husky',
  'plans',
  'plan',
  'testcases',
  'archives',
  'examples',
  'samples',
  'fixtures',
  'mock',
  'mocks',
]);

const SUPPORT_MODULE_DIRS = new Set([
  'gradle',
  'docs',
  'doc',
  'scripts',
  'script',
  'config',
  'configs',
  'deploy',
  'deployment',
  'k8s',
  'ops',
  'infra',
  'database',
  'db',
  'sql',
  'openapi',
  'swagger',
]);

const EXTENSION_LANGUAGE_MAP = {
  '.js': 'JavaScript',
  '.cjs': 'JavaScript',
  '.mjs': 'JavaScript',
  '.jsx': 'JavaScript',
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.py': 'Python',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.go': 'Go',
  '.rs': 'Rust',
  '.php': 'PHP',
  '.rb': 'Ruby',
  '.swift': 'Swift',
  '.scala': 'Scala',
  '.sql': 'SQL',
  '.md': 'Markdown',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.json': 'JSON',
  '.xml': 'XML',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.zsh': 'Shell',
  '.dockerfile': 'Dockerfile',
};

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function slugifySegment(value, fallback = 'default') {
  const text = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9/_-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const finalValue = text || fallback;
  return finalValue.length > 80 ? `${finalValue.slice(0, 48)}-${hashText(finalValue).slice(0, 8)}` : finalValue;
}

function sanitizePathSegment(value, fallback = 'default') {
  return slugifySegment(String(value || '').replace(/\//g, '--'), fallback).replace(/\//g, '--');
}

function normalizeRepoUrl(repoUrl) {
  return String(repoUrl || '').trim();
}

function deriveRepoSlug(repoUrl) {
  const trimmed = normalizeRepoUrl(repoUrl);
  if (!trimmed) return 'repo';
  const cleaned = trimmed.replace(/\.git$/i, '');
  const sshLike = cleaned.match(/^([^@]+@)?([^:]+):(.+)$/);
  if (sshLike && !cleaned.startsWith('http')) {
    return slugifySegment(`${sshLike[2]}/${sshLike[3]}`, 'repo');
  }
  try {
    const parsed = new URL(cleaned);
    return slugifySegment(`${parsed.host}${parsed.pathname}`, 'repo');
  } catch {
    return slugifySegment(cleaned, 'repo');
  }
}

function normalizeBranchName(branch, fallbackBranch = 'main') {
  const normalized = String(branch || '').trim().replace(/^origin\//, '');
  return normalized || fallbackBranch;
}

async function runGit(args, options = {}) {
  const { cwd, timeout = 120000 } = options;
  const result = await execFileAsync('git', args, {
    cwd,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
    encoding: 'utf8',
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function parseLsRemoteOutput(output, requestedBranch) {
  const lines = String(output || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  let defaultBranch = null;
  const refs = [];
  for (const line of lines) {
    if (line.startsWith('ref:')) {
      const match = line.match(/^ref:\s+refs\/heads\/([^\s]+)\s+HEAD$/);
      if (match) {
        defaultBranch = match[1];
      }
      continue;
    }
    const [sha, refName] = line.split(/\s+/);
    if (sha && refName && refName.startsWith('refs/heads/')) {
      refs.push({
        branch: refName.replace('refs/heads/', ''),
        commit_sha: sha,
      });
    }
  }

  const branchLookup = new Map(refs.map((item) => [item.branch, item]));
  const resolvedBranch =
    (requestedBranch && branchLookup.get(requestedBranch)?.branch) ||
    defaultBranch ||
    refs[0]?.branch ||
    null;
  const commitSha = resolvedBranch ? branchLookup.get(resolvedBranch)?.commit_sha || null : null;

  return {
    default_branch: defaultBranch || resolvedBranch,
    resolved_branch: resolvedBranch,
    commit_sha: commitSha,
    available_branches: refs.map((item) => item.branch),
  };
}

async function preflightRepository(repoUrl, branch) {
  const normalizedUrl = normalizeRepoUrl(repoUrl);
  if (!normalizedUrl) {
    throw new Error('repo_url is required');
  }

  const requestedBranch = String(branch || '').trim();
  const queryRefs = async (refsToCheck) => {
    try {
      const result = await runGit(
        ['ls-remote', '--symref', normalizedUrl, 'HEAD', ...refsToCheck],
        { timeout: 30000 }
      );
      return result.stdout;
    } catch (error) {
      const detail = error.stderr || error.stdout || error.message || '';
      if (/could not read|authentication|permission denied|access denied/i.test(detail)) {
        const authError = new Error(`Git authentication failed: ${detail.trim() || 'permission denied'}`);
        authError.code = 'GIT_AUTH_FAILED';
        throw authError;
      }
      if (/not found|repository .* does not exist/i.test(detail)) {
        const repoError = new Error(`Git repository not found: ${detail.trim() || normalizedUrl}`);
        repoError.code = 'GIT_REPO_NOT_FOUND';
        throw repoError;
      }
      throw error;
    }
  };

  let stdout = await queryRefs(requestedBranch ? [`refs/heads/${requestedBranch}`] : ['refs/heads/*']);
  let parsed = parseLsRemoteOutput(stdout, requestedBranch);
  if (requestedBranch && (!parsed.resolved_branch || !parsed.commit_sha)) {
    stdout = await queryRefs(['refs/heads/*']);
    parsed = parseLsRemoteOutput(stdout, requestedBranch);
  }
  if (!parsed.resolved_branch || !parsed.commit_sha) {
    const availableBranches = Array.isArray(parsed.available_branches) ? parsed.available_branches.slice(0, 20).join(', ') : '';
    throw new Error(
      `Unable to resolve branch for repository: ${normalizedUrl}${requestedBranch ? ` @ ${requestedBranch}` : ''}${
        availableBranches ? ` (available: ${availableBranches})` : ''
      }`
    );
  }

  return {
    repo_url: normalizedUrl,
    repo_slug: deriveRepoSlug(normalizedUrl),
    requested_branch: requestedBranch || null,
    resolved_branch: parsed.resolved_branch,
    default_branch: parsed.default_branch || parsed.resolved_branch,
    commit_sha: parsed.commit_sha,
    available_branches: parsed.available_branches,
    auth_mode: 'local_git',
  };
}

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function prepareRepositorySnapshot({ repoUrl, branch, storageRoot, repoSlug }) {
  const cachesRoot = path.join(storageRoot, 'repos-cache');
  const worktreesRoot = path.join(storageRoot, 'repos-worktree');
  ensureDirectory(cachesRoot);
  ensureDirectory(worktreesRoot);

  const cachePath = path.join(cachesRoot, `${repoSlug}.git`);
  const branchName = normalizeBranchName(branch);

  if (!fs.existsSync(cachePath)) {
    await runGit(['clone', '--mirror', repoUrl, cachePath], { timeout: 300000 });
  } else {
    await runGit(['--git-dir', cachePath, 'remote', 'set-url', 'origin', repoUrl], { timeout: 30000 });
    await runGit(['--git-dir', cachePath, 'fetch', '--prune', 'origin'], { timeout: 300000 });
  }

  let commitSha = '';
  try {
    const result = await runGit(['--git-dir', cachePath, 'rev-parse', `refs/remotes/origin/${branchName}`], {
      timeout: 30000,
    });
    commitSha = result.stdout.trim();
  } catch {
    const fallback = await preflightRepository(repoUrl, branchName);
    commitSha = fallback.commit_sha;
  }

  const worktreePath = path.join(worktreesRoot, repoSlug, commitSha);
  ensureDirectory(path.dirname(worktreePath));

  if (!fs.existsSync(worktreePath)) {
    await runGit(['clone', '--shared', cachePath, worktreePath], { timeout: 300000 });
    await runGit(['-C', worktreePath, 'checkout', '--detach', commitSha], { timeout: 120000 });
  }

  return {
    branch: branchName,
    commit_sha: commitSha,
    cache_path: cachePath,
    local_path: worktreePath,
  };
}

function isIgnoredPath(relPath) {
  const parts = relPath.split(path.sep);
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function isLikelyBinaryFile(filePath, stat) {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.tar', '.gz', '.woff', '.woff2', '.ttf', '.eot'].includes(ext)) {
    return true;
  }
  if (stat.size === 0) return false;
  const sample = fs.readFileSync(filePath, { encoding: null, flag: 'r' }).subarray(0, Math.min(stat.size, 512));
  return sample.includes(0);
}

function readFilePreview(filePath, limit = 1200) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return content.slice(0, limit);
  } catch {
    return '';
  }
}

function parseJavaClassName(preview) {
  const match = String(preview || '').match(/\b(class|interface|enum)\s+([A-Za-z0-9_]+)/);
  return match ? match[2] : '';
}

function escapeRegExpLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findLineOfMatch(preview, regex) {
  const text = String(preview || '');
  if (!text) return null;
  const match = text.match(regex);
  if (!match) return null;
  const offset = typeof match.index === 'number' ? match.index : text.indexOf(match[0]);
  if (offset < 0) return null;
  return text.slice(0, offset).split(/\r?\n/).length;
}

function findJavaClassDefinitionLine(preview, className) {
  if (!className) {
    return findLineOfMatch(preview, /\b(class|interface|enum)\s+[A-Za-z0-9_]+/);
  }
  const safeName = escapeRegExpLiteral(className);
  return findLineOfMatch(preview, new RegExp(`\\b(class|interface|enum)\\s+${safeName}\\b`));
}

function findSqlTableDefinitionLine(preview, tableName) {
  if (!tableName) return null;
  const safeName = escapeRegExpLiteral(tableName);
  return findLineOfMatch(
    preview,
    new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?[\`"]?${safeName}[\`"]?`, 'i'),
  );
}

function annotateWithClassLine(file, className) {
  const lineStart = findJavaClassDefinitionLine(file.preview, className);
  if (lineStart && lineStart > 0) {
    return { line_start: lineStart, line_end: lineStart };
  }
  return {};
}

function hasSourceCodeExtension(filePath) {
  return SOURCE_CODE_EXTENSIONS.has(path.extname(String(filePath || '')).toLowerCase());
}

function isApiRelevantFilePath(filePath) {
  const normalizedPath = String(filePath || '');
  return (
    /(route|router|controller|handler|api|openapi|swagger)/i.test(normalizedPath) &&
    (hasSourceCodeExtension(normalizedPath) || /\.(json|ya?ml)$/i.test(normalizedPath))
  );
}

function isDataRelevantFilePath(filePath) {
  const normalizedPath = String(filePath || '');
  return (
    /(schema|model|entity|migration|prisma|sql|ddl)/i.test(normalizedPath) &&
    (
      hasSourceCodeExtension(normalizedPath) ||
      /\.(sql|ddl|prisma)$/i.test(normalizedPath) ||
      /(schema|migration)\.(json|ya?ml)$/i.test(normalizedPath)
    )
  );
}

function normalizePathSegment(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function joinRequestMappingPath(rootPath, childPath) {
  const normalizedRoot = normalizePathSegment(rootPath);
  const normalizedChild = normalizePathSegment(childPath);
  if (!normalizedRoot) return normalizedChild || '/待确认';
  if (!normalizedChild) return normalizedRoot;
  if (normalizedChild === normalizedRoot || normalizedChild.startsWith(`${normalizedRoot}/`)) {
    return normalizedChild;
  }
  return `${normalizedRoot}${normalizedChild}`.replace(/\/+/g, '/');
}

function parseRequestMappings(preview) {
  const text = String(preview || '');
  const rootMatch =
    text.match(/@RequestMapping\s*\(\s*["']([^"']+)["']/) ||
    text.match(/@RequestMapping\s*\(\s*path\s*=\s*["']([^"']+)["']/) ||
    text.match(/@RequestMapping\s*\(\s*value\s*=\s*["']([^"']+)["']/);
  const rootPath = rootMatch ? rootMatch[1] : '';
  const endpoints = [];
  const pattern = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*\(([\s\S]*?)\)/g;
  let match;
  while ((match = pattern.exec(text))) {
    const annotation = match[1];
    const body = match[2] || '';
    const pathMatch =
      body.match(/["']([^"']+)["']/) ||
      body.match(/path\s*=\s*["']([^"']+)["']/) ||
      body.match(/value\s*=\s*["']([^"']+)["']/);
    const methodMatch = body.match(/RequestMethod\.([A-Z]+)/);
    const method =
      annotation === 'GetMapping' ? 'GET'
        : annotation === 'PostMapping' ? 'POST'
          : annotation === 'PutMapping' ? 'PUT'
            : annotation === 'DeleteMapping' ? 'DELETE'
              : annotation === 'PatchMapping' ? 'PATCH'
                : (methodMatch ? methodMatch[1] : 'REQUEST');
    const pathValue = pathMatch ? pathMatch[1] : '';
    if (annotation === 'RequestMapping' && !methodMatch && pathValue && pathValue === rootPath) {
      continue;
    }
    const fullPath = joinRequestMappingPath(rootPath, pathValue);
    endpoints.push(`${method} ${fullPath}`);
  }
  return Array.from(new Set(endpoints)).slice(0, 12);
}

function parseSqlTableNames(preview) {
  const text = String(preview || '');
  const matches = Array.from(text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?[`"]?([A-Za-z0-9_]+)[`"]?/gi));
  return Array.from(new Set(matches.map((item) => item[1]).filter(Boolean))).slice(0, 20);
}

function parseSqlTableDefinitions(preview) {
  const text = String(preview || '');
  const results = [];
  const pattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?[`"]?([A-Za-z0-9_]+)[`"]?\s*\(([\s\S]*?)\)\s*(?:engine|comment|partition|;|$)/gi;
  let match;
  while ((match = pattern.exec(text))) {
    const tableName = String(match[1] || '').trim();
    const body = String(match[2] || '');
    if (!tableName) continue;
    const lines = body
      .split('\n')
      .map((line) => line.trim().replace(/,$/, ''))
      .filter(Boolean);
    const columns = [];
    const references = [];
    for (const line of lines) {
      if (/^(primary|unique|key|index|constraint)\b/i.test(line)) {
        const refMatch = line.match(/references\s+[`"]?([A-Za-z0-9_]+)[`"]?/i);
        if (refMatch?.[1]) {
          references.push(refMatch[1]);
        }
        continue;
      }
      const columnMatch = line.match(/^[`"]?([A-Za-z0-9_]+)[`"]?\s+[A-Za-z]+/);
      if (columnMatch?.[1] && !/^(primary|unique|key|index|constraint|foreign)$/i.test(columnMatch[1])) {
        columns.push(columnMatch[1]);
      }
      const inlineRefMatch = line.match(/references\s+[`"]?([A-Za-z0-9_]+)[`"]?/i);
      if (inlineRefMatch?.[1]) {
        references.push(inlineRefMatch[1]);
      }
    }
    results.push({
      table_name: tableName,
      columns: Array.from(new Set(columns)).slice(0, 16),
      references: Array.from(new Set(references)).filter(Boolean).slice(0, 8),
    });
  }
  return results.slice(0, 20);
}

function parseEntityTableName(preview) {
  const text = String(preview || '');
  const explicit =
    text.match(/@Table\s*\(\s*name\s*=\s*["']([^"']+)["']/) ||
    text.match(/@TableName\s*\(\s*["']([^"']+)["']/);
  if (explicit) return explicit[1];
  return '';
}

function detectFrameworks(packageJson, files) {
  const frameworks = new Set();
  const deps = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {}),
  };

  if (deps.react) frameworks.add('React');
  if (deps.next) frameworks.add('Next.js');
  if (deps.vue) frameworks.add('Vue');
  if (deps.nuxt) frameworks.add('Nuxt');
  if (deps.express) frameworks.add('Express');
  if (deps.nestjs || deps['@nestjs/core']) frameworks.add('NestJS');
  if (deps.koa) frameworks.add('Koa');
  if (deps.fastify) frameworks.add('Fastify');
  if (deps.vite) frameworks.add('Vite');
  if (deps.antd) frameworks.add('Ant Design');
  if (deps.prisma) frameworks.add('Prisma');
  if (deps.sequelize) frameworks.add('Sequelize');
  if (deps.typeorm) frameworks.add('TypeORM');
  if (
    deps.spring ||
    files.some((file) => /(^|\/)pom\.xml$/i.test(file)) ||
    files.some((file) => /(^|\/)(build|settings)\.gradle(\.kts)?$/i.test(file)) ||
    files.some((file) => /(^|\/)[A-Za-z0-9]+Application\.(java|kt|groovy|scala)$/i.test(file))
  ) {
    frameworks.add('Spring');
  }
  if (
    files.some((file) => /(^|\/)(build|settings)\.gradle(\.kts)?$/i.test(file))
  ) {
    frameworks.add('Gradle');
  }
  if (files.some((file) => /(^|\/)pom\.xml$/i.test(file))) {
    frameworks.add('Maven');
  }
  if (files.some((file) => /(^|\/)application[-.\w]*\.(ya?ml|properties)$/i.test(file))) {
    frameworks.add('Spring Boot');
  }
  if (files.some((file) => /(^|\/)bootstrap[-.\w]*\.(ya?ml|properties)$/i.test(file))) {
    frameworks.add('Spring Cloud');
  }
  if (deps['spring-cloud-starter-openfeign'] || files.some((file) => /FeignClient\.(java|kt|groovy|scala)$/i.test(file))) {
    frameworks.add('OpenFeign');
  }
  if (deps['mybatis-spring-boot-starter'] || deps['mybatis-plus-boot-starter']) {
    frameworks.add('MyBatis');
  }
  if (files.some((file) => file.endsWith('docker-compose.yml') || file.endsWith('docker-compose.yaml'))) {
    frameworks.add('Docker Compose');
  }
  return Array.from(frameworks);
}

function detectPackageManager(allFiles) {
  if (allFiles.includes('pnpm-lock.yaml')) return 'pnpm';
  if (allFiles.includes('yarn.lock')) return 'yarn';
  if (allFiles.includes('package-lock.json')) return 'npm';
  if (allFiles.includes('build.gradle') || allFiles.includes('build.gradle.kts') || allFiles.includes('settings.gradle') || allFiles.includes('settings.gradle.kts')) {
    return 'gradle';
  }
  if (allFiles.includes('pom.xml')) return 'maven';
  if (allFiles.includes('poetry.lock')) return 'poetry';
  if (allFiles.includes('requirements.txt')) return 'pip';
  if (allFiles.includes('go.mod')) return 'go';
  if (allFiles.includes('Cargo.toml')) return 'cargo';
  return 'unknown';
}

function isLikelyBusinessDocFile(relPath) {
  return /\.(md|mdx|adoc|rst|txt)$/i.test(relPath) || /(^|\/)docs?\//i.test(relPath);
}

function isLikelyConfigFile(relPath) {
  return /(^|\/)(application|bootstrap)[-.\w]*\.(ya?ml|properties)$/i.test(relPath);
}

function isLegalSourcePath(filePath) {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  if (!hasSourceCodeExtension(normalizedPath)) return false;
  if (/(^|\/)(docs?|plans?|testcases?|archives|samples?|fixtures?|scripts?)\//i.test(normalizedPath)) {
    return false;
  }
  return (
    /(^|\/)src\//i.test(normalizedPath) ||
    /(^|\/)(app|server|services?|modules?|packages?|libs?|lib)\//i.test(normalizedPath)
  );
}

function deriveModuleName(filePath) {
  const normalizedPath = String(filePath || '').replace(/\\/g, '/');
  const segments = normalizedPath.split('/').filter(Boolean);
  if (!segments.length) return null;
  const head = String(segments[0] || '').trim();
  if (!head) return null;
  if (segments.length === 1) return null;
  if (head === 'src') {
    return 'application';
  }
  if (['app', 'packages', 'services', 'modules', 'server', 'apps'].includes(head) && segments[1]) {
    return String(segments[1] || '').trim() || null;
  }
  return head;
}

function classifyModuleBucket(name, files = []) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (!normalizedName) return 'noise';
  if (NOISE_MODULE_DIRS.has(normalizedName)) return 'noise';
  if (normalizedName === 'gradle') {
    const hasBuildLogic = files.some((file) => /(buildsrc|conventions?|plugins?|catalog)/i.test(file.path));
    return hasBuildLogic ? 'support' : 'noise';
  }
  if (SUPPORT_MODULE_DIRS.has(normalizedName)) return 'support';
  const sourceLikeFiles = files.filter((file) => isLegalSourcePath(file.path));
  if (!sourceLikeFiles.length) {
    if (files.some((file) => isLikelyConfigFile(file.path) || /(docker|compose|helm|k8s|deploy|sql|ddl)/i.test(file.path))) {
      return 'support';
    }
    if (files.every((file) => isLikelyBusinessDocFile(file.path) || /\.(json|ya?ml|properties|sh|sql|ddl)$/i.test(file.path))) {
      return 'noise';
    }
    return 'support';
  }
  return 'business';
}

function collectRepositoryInventory(repoPath) {
  const allFiles = [];
  const readableFiles = [];
  const docs = [];
  const manifests = [];
  const entryCandidates = [];
  const apiFiles = [];
  const dataFiles = [];
  const testFiles = [];
  const frontendPages = [];
  const languageCounts = new Map();

  const walk = (currentPath) => {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentPath, entry.name);
      const relPath = path.relative(repoPath, absolutePath);
      if (!relPath) continue;
      if (isIgnoredPath(relPath)) continue;
      if (entry.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      allFiles.push(relPath);
      const stat = fs.statSync(absolutePath);
      const ext = path.extname(entry.name).toLowerCase();
      const language = EXTENSION_LANGUAGE_MAP[ext] || (entry.name === 'Dockerfile' ? 'Dockerfile' : 'Other');
      languageCounts.set(language, (languageCounts.get(language) || 0) + 1);

      const isDocFile = /(^|\/)(readme|docs?\/|.+\.(md|mdx|adoc|rst|txt)$)/i.test(relPath);
      if (isDocFile) docs.push(relPath);

      if (
        COMMON_ENTRY_FILES.includes(entry.name) ||
        /^(build|settings)\.gradle(\.kts)?$/i.test(entry.name) ||
        /^pom\.xml$/i.test(entry.name) ||
        /^(application|bootstrap)[-.\w]*\.(ya?ml|properties)$/i.test(entry.name) ||
        /^tsconfig.*\.json$/i.test(entry.name) ||
        /^vite\.config\./i.test(entry.name) ||
        /^next\.config\./i.test(entry.name) ||
        /^nuxt\.config\./i.test(entry.name)
      ) {
        manifests.push(relPath);
      }

      if (
        /(^|\/)(main|index|app|server|cli|manage|bootstrap)\.(js|ts|tsx|jsx|py|go|java|rb)$/i.test(relPath) ||
        /(^|\/)[A-Za-z0-9]+Application\.(java|kt|groovy|scala)$/i.test(relPath) ||
        /^src\/main\./i.test(relPath) ||
        /^src\/index\./i.test(relPath) ||
        isLikelyConfigFile(relPath)
      ) {
        entryCandidates.push(relPath);
      }

      if (isApiRelevantFilePath(relPath)) {
        apiFiles.push(relPath);
      }
      if (isDataRelevantFilePath(relPath)) {
        dataFiles.push(relPath);
      }
      if (/(^|\/)(__tests__|tests?|specs?)\/|(\.|-|_)(test|spec)\./i.test(relPath)) {
        testFiles.push(relPath);
      }
      if (/(^|\/)(pages|views|screens|routes|app)\//i.test(relPath) && /\.(tsx?|jsx?|vue)$/i.test(relPath)) {
        frontendPages.push(relPath);
      }

      const tooLarge = stat.size > 256 * 1024;
      const skippedLockfileBody = LOCKFILE_NAMES.has(entry.name);
      const binary = isLikelyBinaryFile(absolutePath, stat);
      if (!tooLarge && !binary && !skippedLockfileBody) {
        readableFiles.push({
          path: relPath,
          absolute_path: absolutePath,
          size: stat.size,
          preview: readFilePreview(absolutePath, 4000),
        });
      }
    }
  };

  walk(repoPath);

  const packageJsonPath = path.join(repoPath, 'package.json');
  let packageJson = null;
  if (fs.existsSync(packageJsonPath)) {
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
      packageJson = null;
    }
  }

  const moduleBuckets = new Map();
  for (const file of readableFiles) {
    const moduleName = deriveModuleName(file.path);
    if (!moduleName) continue;
    if (!moduleBuckets.has(moduleName)) {
      moduleBuckets.set(moduleName, []);
    }
    moduleBuckets.get(moduleName).push(file);
  }

  const sourceCodeFiles = readableFiles.filter((file) => hasSourceCodeExtension(file.path));

  const ruleComments = collectRuleCommentRecords(readableFiles);
  const testMethods = collectTestMethodRecords(readableFiles);

  const categorizedModules = Array.from(moduleBuckets.entries())
    .map(([name, files]) => {
      const sorted = files.slice().sort((a, b) => a.path.localeCompare(b.path));
      const keyFiles = sorted
        .filter((item) => /(index|main|app|service|controller|route|router|model|schema)/i.test(path.basename(item.path)))
        .slice(0, 6);
      const sourceFiles = sorted
        .filter((item) => isLegalSourcePath(item.path) || isLikelyConfigFile(item.path))
        .slice(0, 16)
        .map((item) => item.path);
      return {
        name,
        module_kind: classifyModuleBucket(name, sorted),
        file_count: files.length,
        source_files: sourceFiles,
        key_files: (keyFiles.length ? keyFiles : sorted.slice(0, 4)).map((item) => ({
          path: item.path,
          preview: item.preview,
        })),
      };
    })
    .sort((a, b) => {
      const rank = { business: 0, support: 1, noise: 2 };
      const rankDiff = Number(rank[a.module_kind] || 9) - Number(rank[b.module_kind] || 9);
      if (rankDiff !== 0) return rankDiff;
      return b.file_count - a.file_count;
    });

  const businessModules = categorizedModules
    .filter((item) => item.module_kind === 'business')
    .slice(0, 12);
  const supportModules = categorizedModules
    .filter((item) => item.module_kind === 'support')
    .slice(0, 8);
  const modules = [...businessModules, ...supportModules];
  const noiseModules = categorizedModules
    .filter((item) => item.module_kind === 'noise')
    .map((item) => item.name)
    .slice(0, 24);

  const controllers = readableFiles
    .filter((file) => {
      if (!isLegalSourcePath(file.path)) return false;
      if (!hasSourceCodeExtension(file.path)) return false;
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return (
        /@(RestController|Controller)\b/.test(file.preview) ||
        /Controller$/.test(className) ||
        /(^|\/)controllers?\//i.test(file.path)
      );
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return {
        path: file.path,
        class_name: className,
        endpoints: parseRequestMappings(file.preview),
        ...annotateWithClassLine(file, className),
      };
    })
    .slice(0, 24);

  const services = sourceCodeFiles
    .filter((file) => {
      if (!isLegalSourcePath(file.path)) return false;
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      if (!className) return false;
      return (
        /@Service\b/.test(file.preview) ||
        /(Service|ServiceImpl)$/.test(className) ||
        /(^|\/)services?\//i.test(file.path)
      );
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 24);

  const repositories = sourceCodeFiles
    .filter((file) => {
      if (!isLegalSourcePath(file.path)) return false;
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      if (!className) return false;
      return (
        /@(Repository|Mapper)\b/.test(file.preview) ||
        /(Repository|Dao|Mapper)$/.test(className) ||
        /(^|\/)(repositories|repository|dao|mapper)s?\//i.test(file.path)
      );
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 24);

  const requestModels = sourceCodeFiles
    .filter((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return /(^|\/)requests?\//i.test(file.path) || /Request$/.test(className);
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 36);

  const dtoModels = sourceCodeFiles
    .filter((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return /(^|\/)dtos?\//i.test(file.path) || /Dto$/.test(className);
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 36);

  const voModels = sourceCodeFiles
    .filter((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return /(^|\/)vos?\//i.test(file.path) || /VO$/.test(className) || /Vo$/.test(className);
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 36);

  const criteriaModels = sourceCodeFiles
    .filter((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return /(^|\/)criteria\//i.test(file.path) || /Criteria$/.test(className);
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 36);

  const mapperModels = sourceCodeFiles
    .filter((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return /(^|\/)mappers?\//i.test(file.path) || /Mapper$/.test(className);
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 36);

  const entities = sourceCodeFiles
    .filter((file) => {
      if (!isLegalSourcePath(file.path)) return false;
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      if (!className) return false;
      return (
        /@(Entity|TableName|Table)\b/.test(file.preview) ||
        /(^|\/)(entity|entities)\//i.test(file.path) ||
        /Entity$/.test(className) ||
        Boolean(parseEntityTableName(file.preview))
      );
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return {
        path: file.path,
        class_name: className,
        table_name: parseEntityTableName(file.preview) || '',
        ...annotateWithClassLine(file, className),
      };
    })
    .slice(0, 36);

  const feignClients = sourceCodeFiles
    .filter((file) => {
      if (!isLegalSourcePath(file.path)) return false;
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      if (!className) return false;
      return (
        /@FeignClient\b/.test(file.preview) ||
        /(Feign|Client)$/.test(className) ||
        /(^|\/)(feign|clients?)\//i.test(file.path)
      );
    })
    .map((file) => {
      const className = parseJavaClassName(file.preview) || path.basename(file.path, path.extname(file.path));
      return { path: file.path, class_name: className, ...annotateWithClassLine(file, className) };
    })
    .slice(0, 24);

  const sqlTables = readableFiles
    .filter((file) => /\.(sql|ddl)$/i.test(file.path))
    .flatMap((file) => {
      const parsed = parseSqlTableDefinitions(file.preview);
      if (parsed.length) {
        return parsed.map((definition) => {
          const lineStart = findSqlTableDefinitionLine(file.preview, definition.table_name);
          return {
            path: file.path,
            table_name: definition.table_name,
            columns: definition.columns,
            references: definition.references,
            ...(lineStart ? { line_start: lineStart, line_end: lineStart } : {}),
          };
        });
      }
      return parseSqlTableNames(file.preview).map((tableName) => {
        const lineStart = findSqlTableDefinitionLine(file.preview, tableName);
        return {
          path: file.path,
          table_name: tableName,
          columns: [],
          references: [],
          ...(lineStart ? { line_start: lineStart, line_end: lineStart } : {}),
        };
      });
    })
    .slice(0, 40);

  const apiEndpoints = Array.from(
    new Set(
      controllers.flatMap((item) => item.endpoints || [])
    )
  ).slice(0, 40);

  const deployFiles = Array.from(
    new Set(
      allFiles.filter((file) =>
        /(docker|compose|deployment|helm|chart|k8s|application\.(ya?ml|properties)|bootstrap\.(ya?ml|properties))/i.test(file)
      )
    )
  ).slice(0, 30);

  const tableNames = Array.from(
    new Set([
      ...sqlTables.map((item) => item.table_name),
      ...entities.map((item) => item.table_name).filter(Boolean),
    ])
  ).slice(0, 40);

  const topLanguages = Array.from(languageCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([language, count]) => ({ language, count }));

  return {
    repo_path: repoPath,
    total_files: allFiles.length,
    readable_files: readableFiles.length,
    package_manager: detectPackageManager(allFiles),
    frameworks: detectFrameworks(packageJson, allFiles),
    entry_candidates: Array.from(new Set(entryCandidates)).slice(0, 15),
    manifest_files: Array.from(new Set(manifests)).slice(0, 20),
    docs: Array.from(new Set(docs)).slice(0, 20),
    api_files: Array.from(new Set(apiFiles)).slice(0, 20),
    data_files: Array.from(new Set(dataFiles)).slice(0, 20),
    test_files: Array.from(new Set(testFiles)).slice(0, 40),
    frontend_pages: Array.from(new Set(frontendPages)).slice(0, 40),
    top_languages: topLanguages,
    package_json: packageJson
      ? {
          name: packageJson.name || null,
          scripts: packageJson.scripts || {},
        }
      : null,
    modules,
    business_modules: businessModules,
    support_modules: supportModules,
    noise_modules: noiseModules,
    controllers,
    services,
    repositories,
    request_models: requestModels,
    dto_models: dtoModels,
    vo_models: voModels,
    criteria_models: criteriaModels,
    mapper_models: mapperModels,
    entities,
    feign_clients: feignClients,
    sql_tables: sqlTables,
    api_endpoints: apiEndpoints,
    deploy_files: deployFiles,
    tables: tableNames,
    rule_comments: ruleComments,
    test_methods: testMethods,
    sample_tree: allFiles.slice(0, 200),
  };
}

const RULE_TRIGGER_REGEX = /必须|不得|禁止|只允许|仅限|至少|至多|最多|最少|不能|不允许|必填|应当|约束|\bmust\s+not\b|\bmust\b|\brequired\b|\bmandatory\b|\bforbidden\b|\bonly\b\s+(?:if|when|allow)|\bcannot\b|\bat\s+least\b|\bat\s+most\b/i;

function collectRuleCommentRecords(readableFiles) {
  const records = [];
  const MAX_RECORDS = 200;
  const MAX_LINE_LENGTH = 300;
  for (const file of readableFiles) {
    if (records.length >= MAX_RECORDS) break;
    const ext = path.extname(file.path).toLowerCase();
    if (!['.java', '.kt', '.scala', '.groovy', '.ts', '.tsx', '.js', '.jsx', '.go', '.py', '.rb', '.cs', '.sql'].includes(ext)) {
      continue;
    }
    const preview = typeof file.preview === 'string' ? file.preview : '';
    if (!preview) continue;
    const lines = preview.split(/\r?\n/);
    for (let i = 0; i < lines.length && records.length < MAX_RECORDS; i += 1) {
      const raw = lines[i];
      if (raw.length > MAX_LINE_LENGTH) continue;
      const text = extractCommentText(raw, ext);
      if (!text) continue;
      if (!RULE_TRIGGER_REGEX.test(text)) continue;
      records.push({
        text: text.trim(),
        path: file.path,
        line_start: i + 1,
        line_end: i + 1,
        source_type: ext === '.sql' ? 'sql_comment' : 'code_comment',
      });
    }
  }
  return records;
}

function extractCommentText(line, ext) {
  const trimmed = line.trim();
  if (!trimmed) return '';
  if (ext === '.py' || ext === '.rb') {
    const m = trimmed.match(/^#\s*(.+)$/);
    if (m) return m[1];
    return '';
  }
  if (ext === '.sql') {
    const dash = trimmed.match(/^--\s*(.+)$/);
    if (dash) return dash[1];
    const hash = trimmed.match(/^#\s*(.+)$/);
    if (hash) return hash[1];
    const blockInline = trimmed.match(/\/\*+\s*(.+?)\s*\*+\//);
    if (blockInline) return blockInline[1];
    const commentEq = trimmed.match(/\bCOMMENT\s*[:=]?\s*['"](.+?)['"]/i);
    if (commentEq) return commentEq[1];
    return '';
  }
  const lineComment = trimmed.match(/^\/\/\s*(.+)$/);
  if (lineComment) return lineComment[1];
  const blockStar = trimmed.match(/^\*\s*(.+)$/);
  if (blockStar) return blockStar[1];
  const blockInline = trimmed.match(/\/\*+\s*(.+?)\s*\*+\//);
  if (blockInline) return blockInline[1];
  return '';
}

const JUNIT_METHOD_REGEX = /@Test\b[\s\S]{0,160}?\b(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)?(\w+)\s*\(/g;
const JEST_IT_REGEX = /(?:\bit|\btest)\s*\(\s*['"`]([^'"`\n]{3,200})['"`]/g;
const PYTEST_REGEX = /^\s*def\s+(test_[A-Za-z0-9_]+)\s*\(/gm;

function collectTestMethodRecords(readableFiles) {
  const records = [];
  const MAX_RECORDS = 200;
  for (const file of readableFiles) {
    if (records.length >= MAX_RECORDS) break;
    if (!/(^|\/)(__tests__|tests?|specs?)\/|(\.|-|_)(test|spec)\./i.test(file.path)) continue;
    const preview = typeof file.preview === 'string' ? file.preview : '';
    if (!preview) continue;
    const ext = path.extname(file.path).toLowerCase();
    if (ext === '.java' || ext === '.kt' || ext === '.groovy') {
      let m;
      while ((m = JUNIT_METHOD_REGEX.exec(preview)) && records.length < MAX_RECORDS) {
        const name = m[1];
        if (!name || /^(setUp|tearDown|before|after)/i.test(name)) continue;
        const lineNo = preview.slice(0, m.index).split(/\r?\n/).length;
        records.push({ name, path: file.path, line_start: lineNo, line_end: lineNo, framework: 'junit' });
      }
      JUNIT_METHOD_REGEX.lastIndex = 0;
    } else if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
      let m;
      while ((m = JEST_IT_REGEX.exec(preview)) && records.length < MAX_RECORDS) {
        const name = m[1];
        if (!name || name.length < 3) continue;
        const lineNo = preview.slice(0, m.index).split(/\r?\n/).length;
        records.push({ name, path: file.path, line_start: lineNo, line_end: lineNo, framework: 'jest' });
      }
      JEST_IT_REGEX.lastIndex = 0;
    } else if (ext === '.py') {
      let m;
      while ((m = PYTEST_REGEX.exec(preview)) && records.length < MAX_RECORDS) {
        const name = m[1];
        if (!name) continue;
        const lineNo = preview.slice(0, m.index).split(/\r?\n/).length;
        records.push({ name, path: file.path, line_start: lineNo, line_end: lineNo, framework: 'pytest' });
      }
      PYTEST_REGEX.lastIndex = 0;
    }
  }
  return records;
}

function prefixInventoryPaths(inventory, prefix) {
  const prefixPath = (value) => {
    const normalized = String(value || '').trim();
    if (!normalized) return normalized;
    return `${prefix}/${normalized}`.replace(/\/+/g, '/');
  };
  const prefixObjectArray = (items = [], key = 'path') =>
    Array.isArray(items)
      ? items.map((item) => ({
          ...item,
          [key]: prefixPath(item[key]),
        }))
      : [];

  return {
    ...inventory,
    repo_path: prefixPath(path.basename(inventory.repo_path || prefix)),
    entry_candidates: normalizeArray(inventory.entry_candidates).map(prefixPath),
    manifest_files: normalizeArray(inventory.manifest_files).map(prefixPath),
    docs: normalizeArray(inventory.docs).map(prefixPath),
    api_files: normalizeArray(inventory.api_files).map(prefixPath),
    data_files: normalizeArray(inventory.data_files).map(prefixPath),
    test_files: normalizeArray(inventory.test_files).map(prefixPath),
    frontend_pages: normalizeArray(inventory.frontend_pages).map(prefixPath),
    sample_tree: normalizeArray(inventory.sample_tree).map(prefixPath),
    modules: Array.isArray(inventory.modules)
      ? inventory.modules.map((module) => ({
          ...module,
          source_files: normalizeArray(module.source_files).map(prefixPath),
          key_files: Array.isArray(module.key_files)
            ? module.key_files.map((file) => ({
                ...file,
                path: prefixPath(file.path),
              }))
            : [],
        }))
      : [],
    business_modules: Array.isArray(inventory.business_modules)
      ? inventory.business_modules.map((module) => ({
          ...module,
          source_files: normalizeArray(module.source_files).map(prefixPath),
          key_files: Array.isArray(module.key_files)
            ? module.key_files.map((file) => ({
                ...file,
                path: prefixPath(file.path),
              }))
            : [],
        }))
      : [],
    support_modules: Array.isArray(inventory.support_modules)
      ? inventory.support_modules.map((module) => ({
          ...module,
          source_files: normalizeArray(module.source_files).map(prefixPath),
          key_files: Array.isArray(module.key_files)
            ? module.key_files.map((file) => ({
                ...file,
                path: prefixPath(file.path),
              }))
            : [],
        }))
      : [],
    noise_modules: normalizeArray(inventory.noise_modules),
    controllers: prefixObjectArray(inventory.controllers),
    services: prefixObjectArray(inventory.services),
    repositories: prefixObjectArray(inventory.repositories),
    request_models: prefixObjectArray(inventory.request_models),
    dto_models: prefixObjectArray(inventory.dto_models),
    vo_models: prefixObjectArray(inventory.vo_models),
    criteria_models: prefixObjectArray(inventory.criteria_models),
    mapper_models: prefixObjectArray(inventory.mapper_models),
    entities: prefixObjectArray(inventory.entities),
    feign_clients: prefixObjectArray(inventory.feign_clients),
    sql_tables: prefixObjectArray(inventory.sql_tables),
    rule_comments: prefixObjectArray(inventory.rule_comments),
    test_methods: prefixObjectArray(inventory.test_methods),
  };
}

function mergeUniqueObjects(items = [], keyBuilder) {
  const result = [];
  const seen = new Set();
  items.forEach((item, index) => {
    const key = keyBuilder(item, index);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

const DEEPWIKI_MODULES_PER_REPO = Math.max(2, Number(process.env.DEEPWIKI_MODULES_PER_REPO_CAP || 8));
const DEEPWIKI_MODULES_TOTAL_MAX = Math.max(DEEPWIKI_MODULES_PER_REPO, Number(process.env.DEEPWIKI_MODULES_TOTAL_CAP || 48));

function collectProjectManifestInventory(repoUnits = []) {
  const inventories = repoUnits.map((unit) => {
    const baseInventory = collectRepositoryInventory(unit.local_path);
    const prefix = [sanitizePathSegment(unit.repo_role || 'repo', 'repo'), sanitizePathSegment(unit.repo_slug || 'repo', 'repo')].join('/');
    const tagged = prefixInventoryPaths(baseInventory, prefix);
    return {
      ...tagged,
      repo_role: unit.repo_role || 'service',
      repo_slug: unit.repo_slug,
      repo_url: unit.repo_url || null,
      branch: unit.branch,
      commit_sha: unit.commit_sha,
      local_path: unit.local_path,
    };
  });

  const packageManager = inventories.map((item) => item.package_manager).find((item) => item && item !== 'unknown') || 'unknown';
  const mergedLanguages = new Map();
  inventories.forEach((inventory) => {
    (inventory.top_languages || []).forEach((item) => {
      mergedLanguages.set(item.language, Number(mergedLanguages.get(item.language) || 0) + Number(item.count || 0));
    });
  });

  return {
    repo_path: 'project-manifest',
    total_files: inventories.reduce((sum, item) => sum + Number(item.total_files || 0), 0),
    readable_files: inventories.reduce((sum, item) => sum + Number(item.readable_files || 0), 0),
    package_manager: packageManager,
    frameworks: uniqueBy(inventories.flatMap((item) => item.frameworks || []), (item) => item),
    entry_candidates: uniqueBy(inventories.flatMap((item) => item.entry_candidates || []), (item) => item).slice(0, 40),
    manifest_files: uniqueBy(inventories.flatMap((item) => item.manifest_files || []), (item) => item).slice(0, 40),
    docs: uniqueBy(inventories.flatMap((item) => item.docs || []), (item) => item).slice(0, 40),
    api_files: uniqueBy(inventories.flatMap((item) => item.api_files || []), (item) => item).slice(0, 60),
    data_files: uniqueBy(inventories.flatMap((item) => item.data_files || []), (item) => item).slice(0, 60),
    test_files: uniqueBy(inventories.flatMap((item) => item.test_files || []), (item) => item).slice(0, 80),
    frontend_pages: uniqueBy(inventories.flatMap((item) => item.frontend_pages || []), (item) => item).slice(0, 60),
    top_languages: Array.from(mergedLanguages.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([language, count]) => ({ language, count })),
    package_json: null,
    modules: mergeUniqueObjects(
      inventories.flatMap((item) =>
        (item.modules || []).slice(0, DEEPWIKI_MODULES_PER_REPO).map((module) => ({
          ...module,
          name: `${item.repo_role}:${module.name}`,
        })),
      ),
      (item) => item.name
    ).slice(0, DEEPWIKI_MODULES_TOTAL_MAX),
    business_modules: mergeUniqueObjects(
      inventories.flatMap((item) =>
        (item.business_modules || []).slice(0, DEEPWIKI_MODULES_PER_REPO).map((module) => ({
          ...module,
          name: `${item.repo_role}:${module.name}`,
        }))
      ),
      (item) => item.name
    ).slice(0, DEEPWIKI_MODULES_TOTAL_MAX),
    support_modules: mergeUniqueObjects(
      inventories.flatMap((item) =>
        (item.support_modules || []).slice(0, 6).map((module) => ({
          ...module,
          name: `${item.repo_role}:${module.name}`,
        }))
      ),
      (item) => item.name
    ).slice(0, 24),
    noise_modules: uniqueBy(
      inventories.flatMap((item) => (item.noise_modules || []).map((moduleName) => `${item.repo_role}:${moduleName}`)),
      (item) => item
    ).slice(0, 40),
    controllers: mergeUniqueObjects(inventories.flatMap((item) => item.controllers || []), (item) => `${item.path}:${item.class_name}`).slice(0, 60),
    services: mergeUniqueObjects(inventories.flatMap((item) => item.services || []).map((service) => ({
      ...service,
      repo_role: repoUnits.find((unit) => service.path.startsWith(`${sanitizePathSegment(unit.repo_role || 'repo', 'repo')}/${sanitizePathSegment(unit.repo_slug || 'repo', 'repo')}/`))?.repo_role || null,
    })), (item) => `${item.path}:${item.class_name}`).slice(0, 60),
    repositories: mergeUniqueObjects(inventories.flatMap((item) => item.repositories || []), (item) => `${item.path}:${item.class_name}`).slice(0, 60),
    request_models: mergeUniqueObjects(inventories.flatMap((item) => item.request_models || []), (item) => `${item.path}:${item.class_name}`).slice(0, 80),
    dto_models: mergeUniqueObjects(inventories.flatMap((item) => item.dto_models || []), (item) => `${item.path}:${item.class_name}`).slice(0, 80),
    vo_models: mergeUniqueObjects(inventories.flatMap((item) => item.vo_models || []), (item) => `${item.path}:${item.class_name}`).slice(0, 80),
    criteria_models: mergeUniqueObjects(inventories.flatMap((item) => item.criteria_models || []), (item) => `${item.path}:${item.class_name}`).slice(0, 80),
    mapper_models: mergeUniqueObjects(inventories.flatMap((item) => item.mapper_models || []), (item) => `${item.path}:${item.class_name}`).slice(0, 80),
    entities: mergeUniqueObjects(inventories.flatMap((item) => item.entities || []), (item) => `${item.path}:${item.class_name}:${item.table_name}`).slice(0, 80),
    feign_clients: mergeUniqueObjects(inventories.flatMap((item) => item.feign_clients || []), (item) => `${item.path}:${item.class_name}`).slice(0, 40),
    sql_tables: mergeUniqueObjects(inventories.flatMap((item) => item.sql_tables || []), (item) => `${item.path}:${item.table_name}`).slice(0, 80),
    rule_comments: mergeUniqueObjects(
      inventories.flatMap((item) => item.rule_comments || []),
      (item) => `${item.path}:${item.line_start || ''}:${(item.text || '').slice(0, 60)}`
    ).slice(0, 200),
    test_methods: mergeUniqueObjects(
      inventories.flatMap((item) => item.test_methods || []),
      (item) => `${item.path}:${item.name || ''}:${item.line_start || ''}`
    ).slice(0, 200),
    api_endpoints: uniqueBy(inventories.flatMap((item) => item.api_endpoints || []), (item) => item).slice(0, 80),
    deploy_files: uniqueBy(inventories.flatMap((item) => item.deploy_files || []), (item) => item).slice(0, 40),
    tables: uniqueBy(inventories.flatMap((item) => item.tables || []), (item) => item).slice(0, 80),
    sample_tree: uniqueBy(inventories.flatMap((item) => item.sample_tree || []), (item) => item).slice(0, 240),
    repo_units: inventories.map((item) => ({
      repo_role: item.repo_role,
      repo_slug: item.repo_slug,
      repo_url: item.repo_url,
      branch: item.branch,
      commit_sha: item.commit_sha,
      local_path: item.local_path,
      readable_files: item.readable_files,
      frontend_pages: item.frontend_pages || [],
      frameworks: item.frameworks || [],
    })),
    repo_roles: uniqueBy(inventories.map((item) => item.repo_role).filter(Boolean), (item) => item),
    missing_repo_roles: inventories.some((item) => ['frontend', 'bff'].includes(String(item.repo_role || '').toLowerCase()))
      ? []
      : ['frontend_view'],
    module_merge_policy: {
      per_repo_cap: DEEPWIKI_MODULES_PER_REPO,
      total_cap: DEEPWIKI_MODULES_TOTAL_MAX,
    },
  };
}

function buildRepositoryContext(inventory) {
  const languageSummary = inventory.top_languages.map((item) => `${item.language}:${item.count}`).join(', ') || 'unknown';
  const moduleSummary =
    (inventory.business_modules?.length ? inventory.business_modules : inventory.modules)
      .map((module) => `${module.name}(${module.file_count})`)
      .slice(0, 12)
      .join(', ') || 'none';

  return [
    `Package manager: ${inventory.package_manager}`,
    `Frameworks: ${inventory.frameworks.join(', ') || 'unknown'}`,
    `Languages: ${languageSummary}`,
    `Entry candidates: ${inventory.entry_candidates.join(', ') || 'none'}`,
    `Manifest files: ${inventory.manifest_files.join(', ') || 'none'}`,
    `API files: ${inventory.api_files.join(', ') || 'none'}`,
    `Data files: ${inventory.data_files.join(', ') || 'none'}`,
    `Modules: ${moduleSummary}`,
    `Noise modules: ${(inventory.noise_modules || []).join(', ') || 'none'}`,
  ].join('\n');
}

function buildModuleDigestPrompt(moduleInfo, inventory) {
  const previews = moduleInfo.key_files
    .map((file) => `### ${file.path}\n${file.preview.slice(0, 1000)}`)
    .join('\n\n');

  return [
    '你是资深代码库分析助手，请基于模块文件和仓库上下文生成简洁中文摘要。',
    '输出要求：',
    '1. 用 4-6 条 bullet，总结模块职责、入口、依赖、主要数据对象、风险点。',
    '2. 不要虚构不存在的实现。',
    '3. 若信息不足，明确写“待确认”。',
    '',
    '仓库上下文：',
    buildRepositoryContext(inventory),
    '',
    `模块名：${moduleInfo.name}`,
    `文件数：${moduleInfo.file_count}`,
    `源文件：${moduleInfo.source_files.join(', ')}`,
    '',
    '关键文件片段：',
    previews || '无',
  ].join('\n');
}

function summarizeResearchReport(report) {
  const lines = String(report || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const highSignalLines = lines.filter(
    (line) => !/^(Entry candidates|Manifest files|API files|Data files|Docs|Deploy files|Tests?):/i.test(line)
  );
  return highSignalLines.slice(0, 10).join('\n');
}

function toMarkdownList(items) {
  return items && items.length ? items.map((item) => `- ${item}`).join('\n') : '- 暂无';
}

function buildMermaidBlock(type, body) {
  return ['```mermaid', `${type}`, body].filter(Boolean).join('\n') + '\n```';
}

/** 去掉 LLM 可能返回的围栏，供纯 .mmd 页使用 */
function stripMermaidFences(text) {
  let s = String(text || '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```mermaid\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  return s;
}

/** 宽松校验：避免把明显无效内容写入产物 */
function isValidMermaidBody(text) {
  const s = stripMermaidFences(text)
    .replace(/^%%[^\n]*\n?/gm, '')
    .trim();
  if (s.length < 12) return false;
  return /\b(flowchart|sequenceDiagram|erDiagram|classDiagram|stateDiagram|graph)\b/i.test(s);
}

function normalizeSynthesizedDiagram(raw) {
  if (!raw) return null;
  if (typeof raw === 'string') {
    return isValidMermaidBody(raw)
      ? {
          mermaid_source: stripMermaidFences(raw),
          diagram_summary: '',
          covered_evidence: [],
          missing_evidence: [],
          quality_notes: [],
          render_source: 'llm_structured',
        }
      : null;
  }
  if (typeof raw !== 'object') return null;
  const mermaidSource = raw.mermaid_source || raw.content || raw.body || raw.diagram || raw.mermaid;
  if (!isValidMermaidBody(mermaidSource)) return null;
  return {
    mermaid_source: stripMermaidFences(mermaidSource),
    diagram_summary: String(raw.diagram_summary || raw.summary || '').trim(),
    covered_evidence: Array.isArray(raw.covered_evidence) ? raw.covered_evidence.map((item) => String(item || '').trim()).filter(Boolean) : [],
    missing_evidence: Array.isArray(raw.missing_evidence) ? raw.missing_evidence.map((item) => String(item || '').trim()).filter(Boolean) : [],
    quality_notes: Array.isArray(raw.quality_notes) ? raw.quality_notes.map((item) => String(item || '').trim()).filter(Boolean) : [],
    render_source: String(raw.render_source || 'llm_structured').trim() || 'llm_structured',
  };
}

function pickSynthesizedDiagram(synthesizedDiagrams, key, fallbackFn, inventory) {
  if (!synthesizedDiagrams || typeof synthesizedDiagrams !== 'object') {
    return {
      body: fallbackFn(inventory),
      source: 'fallback_heuristic',
      summary: '',
      coveredEvidence: [],
      missingEvidence: [],
      qualityNotes: [],
    };
  }
  const normalized = normalizeSynthesizedDiagram(synthesizedDiagrams[key]);
  if (normalized) {
    return {
      body: normalized.mermaid_source,
      source: normalized.render_source,
      summary: normalized.diagram_summary,
      coveredEvidence: normalized.covered_evidence,
      missingEvidence: normalized.missing_evidence,
      qualityNotes: normalized.quality_notes,
    };
  }
  return {
    body: fallbackFn(inventory),
    source: 'fallback_heuristic',
    summary: '',
    coveredEvidence: [],
    missingEvidence: [],
    qualityNotes: [],
  };
}

function joinPathSegments(...parts) {
  return parts.filter(Boolean).join(' / ');
}

const localSourceIndexCache = new WeakMap();
const sqlTableLookupCache = new WeakMap();
const localTableCatalogCache = new WeakMap();
const controllerCompanionCache = new WeakMap();
const controllerFacetBundlesCache = new WeakMap();

function normalizeTableToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isPlausibleTableName(value) {
  const normalized = normalizeTableToken(value);
  if (!normalized) return false;
  if (normalized.length < 3) return false;
  if (
    new Set([
      'id',
      'ids',
      'name',
      'status',
      'type',
      'code',
      'value',
      'item',
      'items',
      'record',
      'records',
      'entity',
      'table',
      'data',
      'result',
      'query',
    ]).has(normalized)
  ) {
    return false;
  }
  return true;
}

function uniqueNames(items, field = 'class_name', limit = 4) {
  return uniqueBy(
    (Array.isArray(items) ? items : [])
      .map((item) => (item && typeof item === 'object' ? item[field] : item))
      .map((item) => String(item || '').trim())
      .filter(Boolean),
    (item) => item
  ).slice(0, limit);
}

function formatMermaidLabel(items, fallback, limit = 4) {
  const values = uniqueNames(items, 'class_name', limit).slice(0, limit);
  if (!values.length) return fallback;
  return values.map((item) => item.replace(/"/g, "'")).join('<br/>');
}

function normalizeRepoSlugSegment(repoSlug = '') {
  return String(repoSlug || '').trim().replace(/[\\/]+/g, '--');
}

function resolveInventoryLocalPath(inventory, inventoryPath = '') {
  const normalizedPath = String(inventoryPath || '').trim();
  if (!normalizedPath) return '';
  const repoUnits = Array.isArray(inventory?.repo_units) ? inventory.repo_units : [];
  for (const unit of repoUnits) {
    const localPath = String(unit?.local_path || '').trim();
    const repoRole = String(unit?.repo_role || '').trim();
    const repoSlug = normalizeRepoSlugSegment(unit?.repo_slug || '');
    if (!localPath || !repoRole || !repoSlug) continue;
    const prefix = `${repoRole}/${repoSlug}/`;
    if (normalizedPath.startsWith(prefix)) {
      return path.join(localPath, normalizedPath.slice(prefix.length));
    }
  }
  return '';
}

function buildLocalSourceIndex(inventory) {
  if (!inventory || typeof inventory !== 'object') return new Map();
  const cached = localSourceIndexCache.get(inventory);
  if (cached) return cached;
  const index = new Map();
  const repoUnits = Array.isArray(inventory.repo_units) ? inventory.repo_units : [];
  const stack = repoUnits
    .map((unit) => String(unit?.local_path || '').trim())
    .filter(Boolean)
    .filter((item) => fs.existsSync(item));
  const allowedExt = new Set(['.java', '.groovy', '.kt']);
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === 'build' || entry.name === '.git') {
          return;
        }
        stack.push(fullPath);
        return;
      }
      if (!entry.isFile()) return;
      const ext = path.extname(entry.name).toLowerCase();
      if (!allowedExt.has(ext)) return;
      const baseName = path.basename(entry.name, ext);
      if (!baseName) return;
      const existing = index.get(baseName) || [];
      if (!existing.includes(fullPath)) {
        existing.push(fullPath);
        index.set(baseName, existing);
      }
    });
  }
  localSourceIndexCache.set(inventory, index);
  return index;
}

function extractReferencedTableNames(sourceText = '') {
  const text = String(sourceText || '');
  const tables = [];
  const regex = /\b(?:from|join|update|into|delete\s+from)\s+[`"]?([A-Za-z0-9_]+)[`"]?/gi;
  let match;
  while ((match = regex.exec(text))) {
    const tableName = String(match[1] || '').trim();
    if (!tableName || /^(select|set|values|where)$/i.test(tableName) || !isPlausibleTableName(tableName)) continue;
    tables.push(tableName);
  }
  return uniqueStrings(tables, 100);
}

function buildLocalTableCatalog(inventory) {
  if (!inventory || typeof inventory !== 'object') return [];
  const cached = localTableCatalogCache.get(inventory);
  if (cached) return cached;
  const catalog = new Map();
  const addTable = (tableName, filePath = '', columns = [], references = []) => {
    const normalized = normalizeTableToken(tableName);
    if (!normalized || !isPlausibleTableName(tableName)) return;
    const existing = catalog.get(normalized) || {
      table_name: String(tableName || '').trim(),
      path: filePath,
      columns: [],
      references: [],
    };
    if (filePath && (!existing.path || existing.path.endsWith('.xml'))) {
      existing.path = filePath;
    }
    if (String(tableName || '').trim()) {
      existing.table_name = String(tableName || '').trim();
    }
    existing.columns = uniqueStrings([...(existing.columns || []), ...(Array.isArray(columns) ? columns : [])], 120);
    existing.references = uniqueStrings([...(existing.references || []), ...(Array.isArray(references) ? references : [])], 60);
    catalog.set(normalized, existing);
  };

  const repoUnits = Array.isArray(inventory.repo_units) ? inventory.repo_units : [];
  const stack = repoUnits
    .map((unit) => String(unit?.local_path || '').trim())
    .filter(Boolean)
    .filter((item) => fs.existsSync(item));
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.forEach((entry) => {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'target' || entry.name === 'build' || entry.name === '.git' || entry.name === 'node_modules') {
          return;
        }
        stack.push(fullPath);
        return;
      }
      if (!entry.isFile()) return;
      const ext = path.extname(entry.name).toLowerCase();
      if (!['.sql', '.xml'].includes(ext)) return;
      const text = readLocalSourceFile(fullPath);
      if (!text) return;
      const definitions = ext === '.sql' ? parseSqlTableDefinitions(text) : [];
      if (definitions.length) {
        definitions.forEach((definition) => {
          addTable(definition.table_name, fullPath, definition.columns || [], definition.references || []);
        });
      } else if (ext === '.sql') {
        parseSqlTableNames(text).forEach((tableName) => addTable(tableName, fullPath));
      }
      extractReferencedTableNames(text).forEach((tableName) => addTable(tableName, fullPath));
    });
  }
  const result = Array.from(catalog.values());
  localTableCatalogCache.set(inventory, result);
  return result;
}

function readLocalSourceFile(filePath = '') {
  const normalized = String(filePath || '').trim();
  if (!normalized || !fs.existsSync(normalized)) return '';
  try {
    return fs.readFileSync(normalized, 'utf8');
  } catch {
    return '';
  }
}

function extractImportedClasses(sourceText = '') {
  const text = String(sourceText || '');
  const results = [];
  const importRegex = /import\s+([\w.]+)\.([A-Z][A-Za-z0-9_]*)\s*;/g;
  let match;
  while ((match = importRegex.exec(text))) {
    results.push({
      fqcn: `${match[1]}.${match[2]}`,
      packageName: match[1],
      className: match[2],
    });
  }
  return results;
}

function extractJavaTypeIdentifiers(sourceText = '') {
  const text = String(sourceText || '');
  const results = new Set();
  const ignored = new Set([
    'Api',
    'ApiLog',
    'ApiOperation',
    'Autowired',
    'Date',
    'GetMapping',
    'Integer',
    'List',
    'Long',
    'Object',
    'Override',
    'PostMapping',
    'PutMapping',
    'RequestBody',
    'RequestMapping',
    'RequestParam',
    'RequestPart',
    'RestController',
    'Slf4j',
    'String',
    'Validated',
    'Value',
    'PathVariable',
    'GenericResponse',
    'PagingResponse',
  ]);
  const regex = /\b([A-Z][A-Za-z0-9_]+)\b/g;
  let match;
  while ((match = regex.exec(text))) {
    const token = String(match[1] || '').trim();
    if (!token || ignored.has(token)) continue;
    results.add(token);
  }
  return Array.from(results);
}

function pickReferencedClassNames(items = [], typeNames = [], predicate = () => true, limit = 8) {
  const typeSet = new Set(uniqueStrings(typeNames, 120));
  return uniqueStrings(
    (Array.isArray(items) ? items : [])
      .filter((item) => {
        const className = String(item?.class_name || '').trim();
        return className && typeSet.has(className) && predicate(item);
      })
      .map((item) => item.class_name),
    limit
  );
}

function uniqueStrings(items, limit = 6) {
  return uniqueBy(
    (Array.isArray(items) ? items : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean),
    (item) => item
  ).slice(0, limit);
}

function toSnakeCase(value = '') {
  return String(value || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toLowerCase()
    .replace(/^_+|_+$/g, '');
}

function stripArchitectureSuffixes(symbol = '') {
  let current = String(symbol || '').trim();
  const suffixes = [
    'QueryServiceImpl',
    'QueryService',
    'ServiceImpl',
    'RepositoryImpl',
    'Controller',
    'Repository',
    'Validation',
    'Validator',
    'Convert',
    'Criteria',
    'Request',
    'Response',
    'Mapper',
    'Service',
    'Entity',
    'RpcImpl',
    'Rpc',
    'Client',
    'Helper',
    'DTO',
    'Dto',
    'VO',
    'Vo',
    'BO',
    'Bo',
  ];
  let changed = true;
  while (changed && current) {
    changed = false;
    for (const suffix of suffixes) {
      if (current.endsWith(suffix) && current.length > suffix.length) {
        current = current.slice(0, -suffix.length);
        changed = true;
        break;
      }
    }
  }
  return current;
}

function buildSymbolBases(symbol = '') {
  const raw = String(symbol || '').trim();
  if (!raw) return [];
  const values = [raw];
  const stripped = stripArchitectureSuffixes(raw);
  if (stripped && stripped !== raw) values.push(stripped);
  const trimmedErp = raw.startsWith('Erp') && /[A-Z]/.test(raw[3] || '') ? raw.slice(3) : '';
  if (trimmedErp) values.push(trimmedErp);
  if (trimmedErp) {
    const strippedTrimmedErp = stripArchitectureSuffixes(trimmedErp);
    if (strippedTrimmedErp) values.push(strippedTrimmedErp);
  }
  return uniqueStrings(values, 12);
}

function inferTableCandidatesFromSymbol(symbol = '') {
  const candidates = [];
  buildSymbolBases(symbol).forEach((base) => {
    const snake = toSnakeCase(base);
    if (!snake) return;
    candidates.push(snake);
    candidates.push(`bill_${snake}`);
    candidates.push(`basic_${snake}`);
    candidates.push(`finance_${snake}`);
    candidates.push(`wms_${snake}`);
    if (snake.endsWith('_bill')) {
      candidates.push(`bill_${snake}`);
    }
    if (snake.endsWith('_category')) {
      candidates.push(`basic_${snake}`);
    }
  });
  return uniqueStrings(candidates, 30);
}

function buildSqlTableLookup(inventory) {
  if (!inventory || typeof inventory !== 'object') {
    return {
      byName: new Map(),
      entityTableBySymbol: new Map(),
      tables: [],
    };
  }
  const cached = sqlTableLookupCache.get(inventory);
  if (cached) return cached;
  const mergedTables = new Map();
  const mergeTable = (table) => {
    if (!table?.table_name) return;
    const normalized = normalizeTableToken(table.table_name);
    if (!normalized) return;
    const existing = mergedTables.get(normalized) || {
      table_name: String(table.table_name || '').trim(),
      path: String(table.path || '').trim(),
      columns: [],
      references: [],
    };
    if (String(table.path || '').trim() && (!existing.path || existing.path.endsWith('.xml'))) {
      existing.path = String(table.path || '').trim();
    }
    existing.columns = uniqueStrings([...(existing.columns || []), ...(Array.isArray(table.columns) ? table.columns : [])], 120);
    existing.references = uniqueStrings([...(existing.references || []), ...(Array.isArray(table.references) ? table.references : [])], 60);
    mergedTables.set(normalized, existing);
  };
  [
    ...buildLocalTableCatalog(inventory),
    ...(Array.isArray(inventory.sql_tables) ? inventory.sql_tables : []),
    ...(Array.isArray(inventory.tables) ? inventory.tables : []).map((tableName) => ({ table_name: tableName, path: '' })),
  ].forEach(mergeTable);
  const sqlTables = Array.from(mergedTables.values());
  const byName = new Map();
  sqlTables.forEach((table) => {
    const normalized = normalizeTableToken(table.table_name);
    if (!normalized || byName.has(normalized)) return;
    byName.set(normalized, table);
  });
  const entityTableBySymbol = new Map();
  (Array.isArray(inventory.entities) ? inventory.entities : []).forEach((entity) => {
    const tableName = String(entity?.table_name || '').trim();
    const className = String(entity?.class_name || '').trim();
    if (!tableName || !className) return;
    buildSymbolBases(className).forEach((symbolBase) => {
      if (!entityTableBySymbol.has(symbolBase)) {
        entityTableBySymbol.set(symbolBase, tableName);
      }
    });
  });
  const lookup = {
    byName,
    entityTableBySymbol,
    tables: sqlTables,
  };
  sqlTableLookupCache.set(inventory, lookup);
  return lookup;
}

function matchInventoryTables(inventory, candidates = [], facetKey = '') {
  const lookup = buildSqlTableLookup(inventory);
  const matches = [];
  const seen = new Set();
  uniqueStrings(candidates, 40).forEach((candidate) => {
    const normalized = normalizeTableToken(candidate);
    if (!normalized) return;
    const table = lookup.byName.get(normalized);
    if (!table) return;
    const key = `${table.table_name}:${table.path || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    matches.push(table);
  });
  return matches.sort((left, right) => {
    const leftFacet = classifyArchitectureFacet(left.path, left.table_name);
    const rightFacet = classifyArchitectureFacet(right.path, right.table_name);
    const leftScore = (facetKey && leftFacet.key === facetKey ? 200 : 0) + leftFacet.priority;
    const rightScore = (facetKey && rightFacet.key === facetKey ? 200 : 0) + rightFacet.priority;
    if (rightScore !== leftScore) return rightScore - leftScore;
    return String(left.table_name || '').localeCompare(String(right.table_name || ''), 'zh-CN');
  });
}

function inferCompanionTables(inventory, companion = null, facetKey = '', extraSymbols = []) {
  const symbols = [
    ...(extraSymbols || []),
    ...(companion?.entities || []),
    ...(companion?.repositories || []),
    ...(companion?.mappers || []),
    ...(companion?.criteria || []),
    ...(companion?.converts || []),
    ...(companion?.appServices || []),
    ...(companion?.queryServices || []),
  ];
  const lookup = buildSqlTableLookup(inventory);
  const candidates = [];
  uniqueStrings(symbols, 40).forEach((symbol) => {
    buildSymbolBases(symbol).forEach((base) => {
      const explicitTable = lookup.entityTableBySymbol.get(base);
      if (explicitTable) {
        candidates.push(explicitTable);
      }
    });
    candidates.push(...inferTableCandidatesFromSymbol(symbol));
  });
  return matchInventoryTables(inventory, candidates, facetKey);
}

function isRpcLikeName(value = '') {
  return /(Rpc|Feign|Client)/i.test(String(value || ''));
}

function scoreServiceCandidate(item, companion = null, facetKey = '') {
  const className = String(item?.class_name || '');
  const filePath = String(item?.path || '').toLowerCase();
  const facet = classifyArchitectureFacet(item?.path, className);
  let score = 0;
  if ((companion?.appServices || []).includes(className)) score += 140;
  if ((companion?.queryServices || []).includes(className)) score += 132;
  if ((companion?.serviceImpls || []).includes(className)) score += 108;
  if ((companion?.queryServiceImpls || []).includes(className)) score += 100;
  if (facetKey && facet.key === facetKey) score += 24;
  if (/\/application\/service\//.test(filePath)) score += 36;
  if (/QueryService$/i.test(className)) score += 20;
  if (/Service$/i.test(className) && !/Impl$/i.test(className)) score += 18;
  if (/ServiceImpl$/i.test(className)) score += 12;
  if (/Verify|Validation|Validator/i.test(className)) score += 6;
  if (isRpcLikeName(className) || /\/application\/rpc\//.test(filePath)) score -= 120;
  return score;
}

function rankServicesForFacet(items = [], companion = null, facetKey = '') {
  return uniqueBy(items, (item) => `${item?.class_name || ''}:${item?.path || ''}`)
    .slice()
    .sort((left, right) => {
      const scoreRight = scoreServiceCandidate(right, companion, facetKey);
      const scoreLeft = scoreServiceCandidate(left, companion, facetKey);
      if (scoreRight !== scoreLeft) return scoreRight - scoreLeft;
      return String(left?.class_name || '').localeCompare(String(right?.class_name || ''), 'zh-CN');
    });
}

function pickBusinessServiceHint(bucket, companion = null, relatedServices = []) {
  const ranked = rankServicesForFacet(relatedServices, companion, bucket?.key || '');
  const preferred = ranked.find((item) => !isRpcLikeName(item?.class_name || '')) || ranked[0];
  return preferred?.class_name || `${bucket?.label || '当前业务域'}应用服务`;
}

function scoreRepresentativeController(inventory, bucket, controllerItem, companions = null) {
  if (!controllerItem) return Number.NEGATIVE_INFINITY;
  const companion = companions || inferControllerCompanions(inventory, controllerItem);
  const endpoints = normalizeArray(controllerItem?.endpoints);
  const pathValue = String(controllerItem?.path || '').toLowerCase();
  const className = String(controllerItem?.class_name || '');
  const relatedTables = inferCompanionTables(
    inventory,
    companion,
    bucket?.key || '',
    [controllerItem?.class_name, bucket?.label]
  );
  let score = endpoints.length * 18;
  score += (companion?.appServices?.length || 0) * 32;
  score += (companion?.queryServices?.length || 0) * 30;
  score += (companion?.serviceImpls?.length || 0) * 18;
  score += (companion?.queryServiceImpls?.length || 0) * 16;
  score += (companion?.repositories?.length || 0) * 14;
  score += (companion?.mappers?.length || 0) * 12;
  score += (companion?.criteria?.length || 0) * 10;
  score += relatedTables.length * 10;
  if (companion?.hasTransactional) score += 8;
  if (bucket?.key === 'finance_bill' && /\/rest\/bill\/finance\//.test(pathValue)) score += 90;
  if (bucket?.key === 'inventory_bill' && /\/rest\/bill\/inventory\//.test(pathValue)) score += 90;
  if (bucket?.key === 'bill_common' && /\/rest\/bill\/common\//.test(pathValue)) score += 90;
  if (bucket?.key === 'warehouse_stock' && /\/rest\/wms\//.test(pathValue)) score += 82;
  if (/commoncontroller/i.test(className) && bucket?.key !== 'bill_common') score -= 18;
  if (!(companion?.appServices?.length || companion?.queryServices?.length) && (companion?.rpcs?.length || 0)) score -= 32;
  return score;
}

function pickDiagramSqlTables(inventory, limit = 10) {
  const sqlTables = buildSqlTableLookup(inventory).tables;
  if (!sqlTables.length) return [];
  const prioritized = [];
  const seen = new Set();
  const addTable = (table) => {
    if (!table?.table_name) return;
    const key = `${table.table_name}:${table.path || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    prioritized.push(table);
  };
  buildControllerFacetBundles(inventory, 8).forEach((bundle) => {
    inferCompanionTables(
      inventory,
      bundle.companions,
      bundle.bucket?.key || '',
      [bundle.controller?.class_name, bundle.bucket?.label]
    ).slice(0, 3).forEach(addTable);
  });
  const relations = inferSqlTableRelations(sqlTables);
  prioritized.slice(0, 8).forEach((table) => {
    relations
      .filter((relation) => relation.from === table.table_name || relation.to === table.table_name)
      .slice(0, 3)
      .forEach((relation) => {
        const relatedName = relation.from === table.table_name ? relation.to : relation.from;
        const relatedTable = sqlTables.find((item) => item.table_name === relatedName);
        if (relatedTable) addTable(relatedTable);
      });
  });
  sqlTables
    .slice()
    .sort((left, right) => {
      const leftFacet = classifyArchitectureFacet(left.path, left.table_name);
      const rightFacet = classifyArchitectureFacet(right.path, right.table_name);
      const leftPenalty = leftFacet.key === 'platform' || leftFacet.key === 'general' ? -40 : 0;
      const rightPenalty = rightFacet.key === 'platform' || rightFacet.key === 'general' ? -40 : 0;
      const leftScore = leftFacet.priority + leftPenalty;
      const rightScore = rightFacet.priority + rightPenalty;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return String(left.table_name || '').localeCompare(String(right.table_name || ''), 'zh-CN');
    })
    .forEach(addTable);
  return prioritized.slice(0, limit);
}

function pickErDiagramTables(inventory, limit = 16) {
  const sqlTables = buildSqlTableLookup(inventory).tables;
  if (!sqlTables.length) return [];
  const bundles = buildControllerFacetBundles(inventory, 8);
  const businessBundles = bundles.filter((bundle) => !['platform', 'general'].includes(bundle?.bucket?.key || ''));
  const nonAiBusinessBundles = businessBundles.filter((bundle) => (bundle?.bucket?.key || '') !== 'ai_ordering');
  const activeBundles = nonAiBusinessBundles.length >= 3 ? nonAiBusinessBundles : businessBundles;
  const activeFacetKeys = new Set(activeBundles.map((bundle) => bundle?.bucket?.key).filter(Boolean));
  const hasStrongErpFocus = Array.from(activeFacetKeys).some((key) => !['ai_ordering', 'platform', 'general'].includes(key));
  const prioritized = [];
  const seen = new Set();
  const addTable = (table) => {
    if (!table?.table_name) return;
    const key = `${table.table_name}:${table.path || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    prioritized.push(table);
  };

  activeBundles.forEach((bundle) => {
    inferCompanionTables(
      inventory,
      bundle.companions,
      bundle.bucket?.key || '',
      [bundle.controller?.class_name, bundle.bucket?.label]
    )
      .slice(0, 4)
      .forEach(addTable);
  });

  const relations = inferSqlTableRelations(sqlTables);
  prioritized.slice(0, 12).forEach((table) => {
    relations
      .filter((relation) => relation.from === table.table_name || relation.to === table.table_name)
      .slice(0, 4)
      .forEach((relation) => {
        const relatedName = relation.from === table.table_name ? relation.to : relation.from;
        const relatedTable = sqlTables.find((item) => item.table_name === relatedName);
        if (relatedTable) addTable(relatedTable);
      });
  });

  sqlTables
    .slice()
    .sort((left, right) => {
      const leftFacet = classifyArchitectureFacet(left.path, left.table_name);
      const rightFacet = classifyArchitectureFacet(right.path, right.table_name);
      const score = (table, facet) => {
        const tableName = String(table?.table_name || '').toLowerCase();
        let value = facet.priority;
        if (activeFacetKeys.has(facet.key)) value += 100;
        if (/^(bill_|finance_|wms_|basic_)/.test(tableName)) value += 18;
        if (facet.key === 'basic_master') value += 10;
        if (hasStrongErpFocus && facet.key === 'ai_ordering') value -= 60;
        if (hasStrongErpFocus && /^ai_/.test(tableName)) value -= 50;
        if (facet.key === 'platform' || facet.key === 'general') value -= 80;
        if (/^sys_/.test(tableName)) value -= 30;
        return value;
      };
      const rightScore = score(right, rightFacet);
      const leftScore = score(left, leftFacet);
      if (rightScore !== leftScore) return rightScore - leftScore;
      return String(left.table_name || '').localeCompare(String(right.table_name || ''), 'zh-CN');
    })
    .forEach(addTable);

  return prioritized.slice(0, limit);
}

function summarizeClassNames(items = [], fallback = '') {
  const values = uniqueStrings(items, 3);
  return values.length ? values.join('<br/>') : fallback;
}

function pickRepresentativeRequestName(companion = null, endpoint = '') {
  const requests = uniqueStrings(companion?.requests || [], 8);
  if (!requests.length) return '';
  const normalizedEndpoint = String(endpoint || '').toLowerCase();
  if (/(list|get|page|query|top)/.test(normalizedEndpoint)) {
    return requests.find((item) => /(QueryRequest|BaseQueryRequest)$/i.test(item)) || requests[0];
  }
  if (/(insert|add|create|post)/.test(normalizedEndpoint)) {
    return requests.find((item) => /^Add[A-Z]/.test(item)) || requests[0];
  }
  if (/(update|modify|put)/.test(normalizedEndpoint)) {
    return requests.find((item) => /^Modify[A-Z]/.test(item)) || requests[0];
  }
  return requests[0];
}

function pickRepresentativeResponseName(companion = null, endpoint = '') {
  const vos = uniqueStrings(companion?.vos || [], 8);
  const dtos = uniqueStrings(companion?.dtos || [], 8);
  const normalizedEndpoint = String(endpoint || '').toLowerCase();
  if (/(list|get|page|query|top)/.test(normalizedEndpoint)) {
    return dtos[0] || vos[0] || '';
  }
  return vos[0] || dtos[0] || '';
}

function findCompanionSourcePaths(inventory, classNames = []) {
  const index = buildLocalSourceIndex(inventory);
  const paths = [];
  uniqueStrings(classNames, 12).forEach((className) => {
    const matches = index.get(className) || [];
    matches.forEach((filePath) => {
      if (!paths.includes(filePath)) {
        paths.push(filePath);
      }
    });
  });
  return paths;
}

function inferControllerCompanions(inventory, controllerItem) {
  const cacheKey = `${String(controllerItem?.path || '')}:${String(controllerItem?.class_name || '')}`;
  const cachedByInventory = controllerCompanionCache.get(inventory);
  if (cachedByInventory?.has(cacheKey)) {
    return cachedByInventory.get(cacheKey);
  }
  const controllerLocalPath = resolveInventoryLocalPath(inventory, controllerItem?.path || '');
  const controllerText = readLocalSourceFile(controllerLocalPath);
  const imports = extractImportedClasses(controllerText);
  const referencedTypes = extractJavaTypeIdentifiers(controllerText);
  const serviceItems = Array.isArray(inventory.services) ? inventory.services : [];
  const rpcAdapters = inferRpcAdapters(inventory);
  const repositoryItems = Array.isArray(inventory.repositories) ? inventory.repositories : [];
  const mapperItems = Array.isArray(inventory.mapper_models) ? inventory.mapper_models : [];
  const criteriaItems = Array.isArray(inventory.criteria_models) ? inventory.criteria_models : [];
  const entityItems = Array.isArray(inventory.entities) ? inventory.entities : [];
  const requests = imports
    .filter((item) => /\.request\./.test(item.fqcn) && /Request$/i.test(item.className))
    .map((item) => item.className);
  const dtos = imports
    .filter((item) => /\.dto\./.test(item.fqcn) && /Dto$/i.test(item.className))
    .map((item) => item.className);
  const vos = imports
    .filter((item) => /\.vo\./.test(item.fqcn) && /VO$/i.test(item.className))
    .map((item) => item.className);
  const appServices = imports
    .filter((item) => /\.service\./.test(item.fqcn) && /Service$/.test(item.className) && !/QueryService$/i.test(item.className))
    .map((item) => item.className);
  const queryServices = imports
    .filter((item) => /\.service\./.test(item.fqcn) && /QueryService$/i.test(item.className))
    .map((item) => item.className);
  const directRpc = imports.filter((item) => /\.rpc\./.test(item.fqcn)).map((item) => item.className);
  const directConvert = imports.filter((item) => /\.convert\./.test(item.fqcn)).map((item) => item.className);
  const directValidation = imports.filter((item) => /\.validation\./.test(item.fqcn)).map((item) => item.className);
  const serviceImpls = [];
  const queryServiceImpls = [];
  const repositories = [];
  const mappers = [];
  const criteria = [];
  const entities = [];
  const rpcs = [...directRpc];
  const converts = [...directConvert];
  const validations = [...directValidation];
  requests.push(
    ...pickReferencedClassNames(inventory.request_models || [], referencedTypes, () => true, 8)
  );
  dtos.push(
    ...pickReferencedClassNames(inventory.dto_models || [], referencedTypes, () => true, 8)
  );
  vos.push(
    ...pickReferencedClassNames(inventory.vo_models || [], referencedTypes, () => true, 8)
  );
  appServices.push(
    ...pickReferencedClassNames(
      serviceItems,
      referencedTypes,
      (item) =>
        /Service$/i.test(item.class_name || '') &&
        !/QueryService$/i.test(item.class_name || '') &&
        !/\/application\/rpc\//i.test(item.path || '') &&
        !/Rpc/i.test(item.class_name || ''),
      8
    )
  );
  queryServices.push(
    ...pickReferencedClassNames(
      serviceItems,
      referencedTypes,
      (item) => /QueryService$/i.test(item.class_name || ''),
      8
    )
  );
  entities.push(
    ...pickReferencedClassNames(
      entityItems,
      referencedTypes,
      () => true,
      8
    )
  );
  repositories.push(
    ...pickReferencedClassNames(
      repositoryItems,
      referencedTypes,
      (item) => /Repository$/i.test(item.class_name || ''),
      8
    )
  );
  mappers.push(
    ...pickReferencedClassNames(
      mapperItems,
      referencedTypes,
      (item) => /Mapper$/i.test(item.class_name || ''),
      8
    )
  );
  criteria.push(
    ...pickReferencedClassNames(
      criteriaItems,
      referencedTypes,
      (item) => /Criteria$/i.test(item.class_name || ''),
      8
    )
  );
  rpcs.push(
    ...pickReferencedClassNames(rpcAdapters, referencedTypes, () => true, 6)
  );
  const companionSources = findCompanionSourcePaths(inventory, [
    ...appServices.map((item) => `${item}Impl`),
    ...queryServices.map((item) => `${item}Impl`),
  ]);
  let hasTransactional = false;
  companionSources.forEach((filePath) => {
    const text = readLocalSourceFile(filePath);
    if (!text) return;
    const className = path.basename(filePath, path.extname(filePath));
    const typeIdentifiers = extractJavaTypeIdentifiers(text);
    if (/QueryServiceImpl$/i.test(className)) {
      queryServiceImpls.push(className);
    } else if (/ServiceImpl$/i.test(className)) {
      serviceImpls.push(className);
    }
    if (/@Transactional\b/.test(text)) {
      hasTransactional = true;
    }
    extractImportedClasses(text).forEach((item) => {
      if (/\.repository\./.test(item.fqcn)) {
        if (/Repository$/i.test(item.className)) repositories.push(item.className);
        if (/Mapper$/i.test(item.className)) mappers.push(item.className);
      }
      if (/\.mapper\./.test(item.fqcn) && /Mapper$/i.test(item.className)) {
        mappers.push(item.className);
      }
      if (/\.criteria\./.test(item.fqcn) && /Criteria$/i.test(item.className)) {
        criteria.push(item.className);
      }
      if (/\.entity\./.test(item.fqcn) && !/BaseEntity$/i.test(item.className)) {
        entities.push(item.className);
      }
      if (/\.dto\./.test(item.fqcn) && /Dto$/i.test(item.className)) {
        dtos.push(item.className);
      }
      if (/\.vo\./.test(item.fqcn) && /VO$/i.test(item.className)) {
        vos.push(item.className);
      }
      if (/\.request\./.test(item.fqcn) && /Request$/i.test(item.className)) {
        requests.push(item.className);
      }
      if (/\.rpc\./.test(item.fqcn)) {
        rpcs.push(item.className);
      }
      if (/\.convert\./.test(item.fqcn)) {
        converts.push(item.className);
      }
      if (/\.validation\./.test(item.fqcn) || /(Validation|Validator)$/i.test(item.className)) {
        validations.push(item.className);
      }
    });
    repositories.push(
      ...pickReferencedClassNames(
        repositoryItems,
        typeIdentifiers,
        (item) => /Repository$/i.test(item.class_name || ''),
        8
      )
    );
    mappers.push(
      ...pickReferencedClassNames(
        mapperItems,
        typeIdentifiers,
        (item) => /Mapper$/i.test(item.class_name || ''),
        8
      )
    );
    criteria.push(
      ...pickReferencedClassNames(
        criteriaItems,
        typeIdentifiers,
        (item) => /Criteria$/i.test(item.class_name || ''),
        8
      )
    );
    entities.push(
      ...pickReferencedClassNames(entityItems, typeIdentifiers, () => true, 8)
    );
    dtos.push(
      ...pickReferencedClassNames(inventory.dto_models || [], typeIdentifiers, () => true, 8)
    );
    vos.push(
      ...pickReferencedClassNames(inventory.vo_models || [], typeIdentifiers, () => true, 8)
    );
    requests.push(
      ...pickReferencedClassNames(inventory.request_models || [], typeIdentifiers, () => true, 8)
    );
    rpcs.push(
      ...pickReferencedClassNames(rpcAdapters, typeIdentifiers, () => true, 6)
    );
  });
  const persistenceSources = findCompanionSourcePaths(inventory, [
    ...repositories,
    ...repositories.map((item) => `${item}Impl`),
    ...mappers,
  ]);
  persistenceSources.forEach((filePath) => {
    const text = readLocalSourceFile(filePath);
    const typeIdentifiers = extractJavaTypeIdentifiers(text);
    extractImportedClasses(text).forEach((item) => {
      if (/\.entity\./.test(item.fqcn) && !/BaseEntity$/i.test(item.className)) {
        entities.push(item.className);
      }
      if (/\.mapper\./.test(item.fqcn) && /Mapper$/i.test(item.className)) {
        mappers.push(item.className);
      }
      if (/\.criteria\./.test(item.fqcn) && /Criteria$/i.test(item.className)) {
        criteria.push(item.className);
      }
    });
    entities.push(
      ...pickReferencedClassNames(entityItems, typeIdentifiers, () => true, 8)
    );
    mappers.push(
      ...pickReferencedClassNames(mapperItems, typeIdentifiers, (item) => /Mapper$/i.test(item.class_name || ''), 8)
    );
    criteria.push(
      ...pickReferencedClassNames(criteriaItems, typeIdentifiers, (item) => /Criteria$/i.test(item.class_name || ''), 8)
    );
  });
  const result = {
    appServices: uniqueStrings(appServices, 4),
    queryServices: uniqueStrings(queryServices, 4),
    serviceImpls: uniqueStrings(serviceImpls, 4),
    queryServiceImpls: uniqueStrings(queryServiceImpls, 4),
    repositories: uniqueStrings(repositories, 4),
    mappers: uniqueStrings(mappers, 4),
    criteria: uniqueStrings(criteria, 4),
    entities: uniqueStrings(entities, 4),
    requests: uniqueStrings(requests, 6),
    dtos: uniqueStrings(dtos, 6),
    vos: uniqueStrings(vos, 6),
    rpcs: uniqueStrings(rpcs, 4),
    converts: uniqueStrings(converts, 4),
    validations: uniqueStrings(validations, 4),
    hasTransactional,
  };
  const cache = cachedByInventory || new Map();
  cache.set(cacheKey, result);
  controllerCompanionCache.set(inventory, cache);
  return result;
}

function buildControllerFacetBundles(inventory, limit = 5) {
  const cacheKey = Number(limit) || 5;
  const cachedByInventory = controllerFacetBundlesCache.get(inventory);
  if (cachedByInventory?.has(cacheKey)) {
    return cachedByInventory.get(cacheKey);
  }
  const buckets = groupItemsByFacet(inventory.controllers || [], { exampleLimit: 2, maxBuckets: limit });
  const bundles = buckets.map((bucket) => {
    const candidates = Array.isArray(bucket.items) ? bucket.items.slice(0, 12) : [];
    let picked = null;
    let pickedCompanions = null;
    let pickedScore = Number.NEGATIVE_INFINITY;
    candidates.forEach((controller) => {
      const companions = controller ? inferControllerCompanions(inventory, controller) : null;
      const score = scoreRepresentativeController(inventory, bucket, controller, companions);
      if (score > pickedScore) {
        picked = controller;
        pickedCompanions = companions;
        pickedScore = score;
      }
    });
    const controller = picked || bucket.items?.[0] || null;
    return {
      bucket,
      controller,
      companions: pickedCompanions || (controller ? inferControllerCompanions(inventory, controller) : null),
    };
  });
  const cache = cachedByInventory || new Map();
  cache.set(cacheKey, bundles);
  controllerFacetBundlesCache.set(inventory, cache);
  return bundles;
}

function inferApplicationServices(inventory) {
  return uniqueBy(
    (Array.isArray(inventory.services) ? inventory.services : []).filter((item) => {
      const className = String(item.class_name || '');
      const filePath = String(item.path || '').toLowerCase();
      return (
        /\/application\/service\//.test(filePath) &&
        !/\/application\/rpc\//.test(filePath) &&
        !/queryservice$/i.test(className) &&
        !/(client|outcome)$/i.test(className)
      );
    }),
    (item) => `${item.path}:${item.class_name}`
  ).slice(0, 8);
}

function inferQueryServices(inventory) {
  return uniqueBy(
    (Array.isArray(inventory.services) ? inventory.services : []).filter((item) => /QueryService$/i.test(item.class_name || '')),
    (item) => `${item.path}:${item.class_name}`
  ).slice(0, 6);
}

function inferDomainServices(inventory) {
  const serviceItems = Array.isArray(inventory.services) ? inventory.services : [];
  const domainCandidates = serviceItems.filter((item) => {
    const className = String(item.class_name || '');
    const filePath = String(item.path || '').toLowerCase();
    return (
      !/\/application\/rpc\//.test(filePath) &&
      !/(client|controller|mapper)$/i.test(className) &&
      (/(Domain|Manager|Gateway|Logic)$/i.test(className) || /ServiceImpl$/i.test(className))
    );
  });
  return uniqueBy(domainCandidates, (item) => `${item.path}:${item.class_name}`).slice(0, 6);
}

function inferRpcAdapters(inventory) {
  const fromServices = (Array.isArray(inventory.services) ? inventory.services : []).filter((item) =>
    /\/application\/rpc\//.test(String(item.path || '').toLowerCase())
  );
  const fromFeign = Array.isArray(inventory.feign_clients) ? inventory.feign_clients : [];
  return uniqueBy([...fromServices, ...fromFeign], (item) => `${item.path}:${item.class_name}`).slice(0, 8);
}

function moduleDisplayName(moduleName = '') {
  const normalized = String(moduleName || '').toLowerCase();
  const aliasMap = [
    [/service:erp-application/, '应用编排 / AI 协同'],
    [/service:erp-basic/, '基础资料 / 主数据'],
    [/service:erp-bill/, '单据 / 财务'],
    [/service:erp-warehouse/, '库存 / 仓储'],
    [/service:erp-perm/, '权限 / 组织'],
    [/service:erp-user/, '用户 / 账号'],
    [/service:erp-print/, '打印 / 输出'],
    [/service:erp-common/, '公共基础能力'],
    [/frontend:views/, '前端页面'],
    [/frontend:api/, '前端 API 编排'],
    [/frontend:components/, '前端组件'],
    [/frontend:store/, '前端状态管理'],
    [/frontend:layout/, '前端布局'],
    [/frontend:utils/, '前端公共能力'],
    [/frontend:assets/, '前端静态资源'],
  ];
  const matched = aliasMap.find(([pattern]) => pattern.test(normalized));
  if (matched) return matched[1];
  return String(moduleName || '')
    .replace(/^frontend:/i, '前端 / ')
    .replace(/^service:/i, '服务 / ')
    .replace(/^backend:/i, '后端 / ')
    .replace(/[-_]/g, ' ');
}

function classifyArchitectureFacet(pathValue = '', symbolValue = '') {
  const normalized = `${String(pathValue || '').toLowerCase()} ${String(symbolValue || '').toLowerCase()}`;
  if (/\/rest\/bill\/finance\/|finance(pay|receive|income|fund|settlement)|billfinance/.test(normalized)) {
    return { key: 'finance_bill', label: '财务单据 / 结算', priority: 100 };
  }
  if (/\/rest\/bill\/inventory\/|inventory(other|check|move|warning|verify|profit|loss)|inventorybill|billstockinventory/.test(normalized)) {
    return { key: 'inventory_bill', label: '库存 / 入出库', priority: 98 };
  }
  if (/\/rest\/wms\/|warehouse|warehouses|wmsinventory|inventorydetail|stockinventory|wms_bill_stock_|wms_inventory_/.test(normalized)) {
    return { key: 'warehouse_stock', label: '仓储 / 库存台账', priority: 94 };
  }
  if (/\/rest\/basic\/|basic(category|product|customer|supplier|gift|department|staff)|pricepolicy/.test(normalized)) {
    return { key: 'basic_master', label: '基础资料 / 主数据', priority: 96 };
  }
  if (/\/rest\/bill\/common\/|billcommon|billcode|purchase|sale|return/.test(normalized)) {
    return { key: 'bill_common', label: '单据公共能力', priority: 92 };
  }
  if (/\/rest\/company\/|\/rest\/perm\/|department|staff|tenant|organization|org|permission|sys_role|sys_permission/.test(normalized)) {
    return { key: 'org_perm', label: '组织 / 权限', priority: 88 };
  }
  if (/customer|supplier|usercenter|account|usersaccount/.test(normalized)) {
    return { key: 'customer_account', label: '客商 / 账号', priority: 84 };
  }
  if (/\/rest\/ai\/|aichat|aiordering|knowledgevector|promptsegment/.test(normalized)) {
    return { key: 'ai_ordering', label: 'AI 协同 / 智能编排', priority: 82 };
  }
  if (/print/.test(normalized)) {
    return { key: 'print_output', label: '打印 / 输出', priority: 76 };
  }
  if (/auth|tokenvalid|common|multitenant|mybatis|daoautoconfiguration/.test(normalized)) {
    return { key: 'platform', label: '平台 / 鉴权 / 公共能力', priority: 66 };
  }
  return { key: 'general', label: '通用业务能力', priority: 40 };
}

function facetLabelForKey(facetKey = '') {
  const normalized = String(facetKey || '').trim();
  const labels = {
    finance_bill: '财务单据 / 结算',
    inventory_bill: '库存 / 入出库',
    warehouse_stock: '仓储 / 库存台账',
    basic_master: '基础资料 / 主数据',
    bill_common: '单据公共能力',
    org_perm: '组织 / 权限',
    customer_account: '客商 / 账号',
    ai_ordering: 'AI 协同 / 智能编排',
    print_output: '打印 / 输出',
    platform: '平台 / 鉴权 / 公共能力',
    general: '通用业务能力',
  };
  return labels[normalized] || normalized || '待确认业务域';
}

function groupItemsByFacet(items = [], options = {}) {
  const pathKey = options.pathKey || 'path';
  const symbolKey = options.symbolKey || 'class_name';
  const exampleLimit = Math.max(1, Number(options.exampleLimit || 3));
  const maxBuckets = Math.max(1, Number(options.maxBuckets || 6));
  const buckets = new Map();

  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!item) return;
    const pathValue = item[pathKey] || '';
    const symbolValue = item[symbolKey] || '';
    const facet = classifyArchitectureFacet(pathValue, symbolValue);
    const bucket = buckets.get(facet.key) || {
      ...facet,
      items: [],
      examples: [],
      count: 0,
    };
    bucket.items.push(item);
    bucket.count += 1;
    const example = String(symbolValue || '').trim();
    if (example && !bucket.examples.includes(example) && bucket.examples.length < exampleLimit) {
      bucket.examples.push(example);
    }
    buckets.set(facet.key, bucket);
  });

  return Array.from(buckets.values())
    .sort((left, right) => {
      if (right.priority !== left.priority) return right.priority - left.priority;
      if (right.count !== left.count) return right.count - left.count;
      return left.label.localeCompare(right.label, 'zh-CN');
    })
    .slice(0, maxBuckets);
}

function formatFacetBucketLabel(bucket, fallback = '待确认') {
  if (!bucket) return fallback;
  const examples = Array.isArray(bucket.examples) ? bucket.examples.slice(0, 3) : [];
  return `${bucket.label}${examples.length ? `<br/>${examples.join('<br/>')}` : ''}`;
}

function pickRepresentativeBusinessBucket(inventory) {
  const controllerBuckets = groupItemsByFacet(inventory.controllers || [], { exampleLimit: 2, maxBuckets: 8 });
  const preferred = controllerBuckets.find((bucket) => bucket.key !== 'platform' && bucket.key !== 'general');
  return preferred || controllerBuckets[0] || null;
}

function buildDomainModuleCards(inventory, limit = 6, moduleDigestMap = new Map()) {
  return buildControllerFacetBundles(inventory, Math.max(limit * 2, 8))
    .filter((bundle) => bundle?.bucket && bundle.bucket.key !== 'platform' && bundle.bucket.key !== 'general')
    .slice(0, limit)
    .map((bundle) => ({
      module: null,
      bucket: bundle.bucket,
      label: bundle.bucket.label,
      insight: buildFacetModuleInsight(bundle, inventory, moduleDigestMap),
    }));
}

function inferDddDomainTier(facetKey = '') {
  const normalized = String(facetKey || '').trim();
  if (['inventory_bill', 'finance_bill', 'warehouse_stock', 'basic_master'].includes(normalized)) return 'core';
  if (['bill_common', 'org_perm', 'customer_account', 'ai_ordering', 'print_output'].includes(normalized)) return 'supporting';
  if (['platform', 'general'].includes(normalized)) return 'generic';
  return 'supporting';
}

function buildBehaviorLabelFromEndpoint(endpoint = '') {
  const normalized = String(endpoint || '')
    .replace(/\{[^}]+\}/g, '')
    .split(/\s+/)
    .slice(-1)[0]
    .split('/')
    .filter(Boolean)
    .slice(-3);
  if (!normalized.length) return '待确认行为';
  const joined = normalized.join(' / ');
  return joined.length > 48 ? `${joined.slice(0, 45)}...` : joined;
}

function buildDomainBehaviorCards(domainCard = {}, inventory = {}) {
  const insight = domainCard.insight || {};
  const behaviors = [];
  const endpointCandidates = (insight.related_apis || []).slice(0, 4);
  const aggregateCandidates = uniqueStrings([
    ...(insight.related_entities || []).map((item) => item.class_name || item.table_name),
    ...(insight.related_tables || []).map((item) => item.table_name),
    ...(insight.key_objects || []),
  ]).slice(0, 4);
  const serviceCandidates = uniqueStrings((insight.related_services || []).map((item) => item.class_name)).slice(0, 4);

  endpointCandidates.forEach((endpoint, index) => {
    const behaviorLabel = buildBehaviorLabelFromEndpoint(endpoint);
    const behaviorKey = slugifySegment(`${domainCard.domain_key}-${behaviorLabel}`, `behavior-${index + 1}`);
    const aggregateName = aggregateCandidates[index % Math.max(aggregateCandidates.length, 1)] || aggregateCandidates[0] || '核心聚合';
    behaviors.push({
      behavior_key: behaviorKey,
      title: `${domainCard.label} · ${behaviorLabel}`,
      description: `${domainCard.label} 通过 ${endpoint} 驱动 ${aggregateName} 的核心业务行为，并由 ${serviceCandidates.join('、') || '应用服务'} 承接规则判断。`,
      aggregate_key: slugifySegment(`${domainCard.domain_key}-${aggregateName}`, `aggregate-${index + 1}`),
      aggregate_name: aggregateName,
      command_key: slugifySegment(`${behaviorKey}-command`, `command-${index + 1}`),
      command_name: `${behaviorLabel} 命令`,
      event_key: slugifySegment(`${behaviorKey}-event`, `event-${index + 1}`),
      event_name: `${behaviorLabel} 已执行`,
      api_endpoints: [endpoint],
      services: serviceCandidates,
      tables: uniqueStrings((insight.related_tables || []).map((item) => item.table_name)).slice(0, 4),
      objects: aggregateCandidates,
      evidence_files: uniqueStrings([
        ...(insight.related_controllers || []).map((item) => item.path),
        ...(insight.related_services || []).map((item) => item.path),
        ...(insight.related_repositories || []).map((item) => item.path),
      ]).slice(0, 8),
    });
  });

  if (!behaviors.length) {
    behaviors.push({
      behavior_key: slugifySegment(`${domainCard.domain_key}-core-behavior`, 'core-behavior'),
      title: `${domainCard.label} · 核心行为`,
      description: `${domainCard.label} 围绕 ${aggregateCandidates.join('、') || '核心对象'} 承接主干业务行为，目前仍以代码证据和对象命名反推。`,
      aggregate_key: slugifySegment(`${domainCard.domain_key}-${aggregateCandidates[0] || 'aggregate'}`, 'aggregate'),
      aggregate_name: aggregateCandidates[0] || '核心聚合',
      command_key: slugifySegment(`${domainCard.domain_key}-command`, 'domain-command'),
      command_name: `${domainCard.label} 命令`,
      event_key: slugifySegment(`${domainCard.domain_key}-event`, 'domain-event'),
      event_name: `${domainCard.label} 事件`,
      api_endpoints: endpointCandidates,
      services: serviceCandidates,
      tables: uniqueStrings((insight.related_tables || []).map((item) => item.table_name)).slice(0, 4),
      objects: aggregateCandidates,
      evidence_files: uniqueStrings([
        ...(insight.related_controllers || []).map((item) => item.path),
        ...(insight.related_services || []).map((item) => item.path),
      ]).slice(0, 8),
    });
  }

  return behaviors;
}

function inferContextRelations(domainCards = []) {
  return domainCards.map((card, index) => {
    const currentTables = new Set((card.insight.related_tables || []).map((item) => item.table_name).filter(Boolean));
    const currentApis = new Set((card.insight.related_apis || []).filter(Boolean));
    const relations = [];
    domainCards.forEach((candidate, candidateIndex) => {
      if (!candidate || candidate.domain_key === card.domain_key) return;
      const overlapCount =
        (candidate.insight.related_tables || []).filter((item) => currentTables.has(item.table_name)).length +
        (candidate.insight.related_apis || []).filter((item) => currentApis.has(item)).length;
      if (overlapCount > 0) {
        relations.push({
          direction: candidateIndex < index ? 'upstream' : 'downstream',
          domain_key: candidate.domain_key,
          domain_label: candidate.label,
          overlap_count: overlapCount,
        });
      }
    });
    return {
      ...card,
      upstream_contexts: relations.filter((item) => item.direction === 'upstream').slice(0, 4),
      downstream_contexts: relations.filter((item) => item.direction === 'downstream').slice(0, 4),
    };
  });
}

function buildDddDomainCards(inventory, moduleDigestMap = new Map(), limit = 6) {
  const baseCards = buildDomainModuleCards(inventory, limit, moduleDigestMap).map((card, index) => {
    const domainKey = slugifySegment(card.bucket?.key || card.label, `domain-${index + 1}`);
    const tier = inferDddDomainTier(card.bucket?.key);
    const behaviors = buildDomainBehaviorCards({ ...card, domain_key: domainKey }, inventory);
    const ubiquitousLanguage = uniqueStrings([
      card.label,
      ...(card.insight.key_objects || []),
      ...(card.insight.related_tables || []).map((item) => item.table_name),
      ...(card.insight.related_apis || []).map((item) => buildBehaviorLabelFromEndpoint(item)),
    ]).slice(0, 8);
    return {
      ...card,
      domain_key: domainKey,
      domain_tier: tier,
      bounded_context_name: `${card.label} 上下文`,
      ubiquitous_language: ubiquitousLanguage,
      aggregates: uniqueStrings(behaviors.map((item) => item.aggregate_name)).slice(0, 4),
      behaviors,
      repo_roles: uniqueStrings((inventory.repo_roles || []).map((item) => String(item || ''))),
    };
  });
  return inferContextRelations(baseCards);
}

function findDomainCardsForModule(moduleInfo, domainCards = []) {
  const facetKeys = inferModuleFacetKeys(moduleInfo, 3);
  return (Array.isArray(domainCards) ? domainCards : []).filter((card) => facetKeys.includes(card.bucket?.key));
}

function summarizeEvidenceAppendix(files = [], limit = 8) {
  return uniqueStrings(files)
    .slice(0, limit)
    .map((filePath) => `- ${filePath}`);
}

function inferSqlTableRelations(sqlTables = []) {
  const tables = (Array.isArray(sqlTables) ? sqlTables : []).filter((item) => item && item.table_name);
  const aliasMap = new Map();
  const addAlias = (alias, tableName) => {
    const key = normalizeTableToken(alias);
    if (!key || aliasMap.has(key)) return;
    aliasMap.set(key, tableName);
  };

  tables.forEach((table) => {
    const normalizedTable = normalizeTableToken(table.table_name);
    addAlias(normalizedTable, table.table_name);
    const tokens = normalizedTable.split('_').filter(Boolean);
    if (tokens.length) {
      addAlias(tokens[tokens.length - 1], table.table_name);
      if (tokens.length >= 2) {
        addAlias(tokens.slice(-2).join('_'), table.table_name);
      }
    }
  });

  const explicitRelations = tables.flatMap((table) =>
    (Array.isArray(table.references) ? table.references : []).map((target) => ({
      from: table.table_name,
      to: target,
      via: 'explicit_fk',
    }))
  );

  const inferredRelations = tables.flatMap((table) => {
    const columns = Array.isArray(table.columns) ? table.columns : [];
    return columns.map((columnName) => {
      const normalizedColumn = normalizeTableToken(columnName);
      if (!normalizedColumn.endsWith('_id') || normalizedColumn === 'id') return null;
      const baseName = normalizedColumn.replace(/_id$/, '');
      const candidates = [
        aliasMap.get(baseName),
        aliasMap.get(baseName.split('_').slice(-2).join('_')),
        aliasMap.get(baseName.split('_').slice(-1).join('_')),
      ].filter(Boolean);
      const target = candidates.find((item) => item && item !== table.table_name);
      if (!target) return null;
      return {
        from: table.table_name,
        to: target,
        via: columnName,
      };
    });
  });

  return uniqueBy([...explicitRelations, ...inferredRelations].filter(Boolean), (item) => `${item.from}:${item.to}:${item.via}`);
}

function buildSystemArchitectureDiagram(inventory) {
  const frontendModules = (Array.isArray(inventory.modules) ? inventory.modules : [])
    .filter((module) => /^frontend:/i.test(String(module.name || '')))
    .slice(0, 4);
  const domainCards = buildDomainModuleCards(inventory, 5);
  const controllerBundles = buildControllerFacetBundles(inventory, 5);
  const bundleInsights = controllerBundles.map((bundle) => buildFacetModuleInsight(bundle, inventory));
  const lines = ['flowchart LR'];
  lines.push('  User["业务用户 / 外部调用方"] --> Channel["交互入口"]');
  lines.push(
    `  Channel --> Front["前端工作台<br/>${frontendModules.map((item) => moduleDisplayName(item.name)).join('<br/>') || '前端页面 / API 编排'}"]`
  );
  lines.push('  Front --> Api["REST API / Controller"]');
  controllerBundles.forEach((bundle, index) => {
    lines.push(`  Api --> C${index + 1}["${formatFacetBucketLabel(bundle.bucket, 'Controller 待确认')}"]`);
  });
  lines.push('  Api --> App["应用编排层"]');
  controllerBundles.forEach((bundle, index) => {
    const serviceLabel = summarizeClassNames(
      [...(bundle.companions?.appServices || []), ...(bundle.companions?.queryServices || [])],
      'Application / Query Service 待确认'
    );
    lines.push(`  App --> A${index + 1}["${bundle.bucket.label}<br/>${serviceLabel}"]`);
  });
  if (domainCards.length) {
    lines.push('  App --> Domain["核心业务域"]');
    domainCards.forEach((card, index) => {
      lines.push(
        `  Domain --> D${index + 1}["${card.label}<br/>${card.insight.key_objects.slice(0, 2).join('<br/>') || '业务对象待确认'}"]`
      );
    });
  }
  lines.push('  App --> Persist["Repository / Mapper"]');
  controllerBundles.forEach((bundle, index) => {
    const insight = bundleInsights[index];
    const persistenceLabel = summarizeClassNames(
      [
        ...(bundle.companions?.repositories || []),
        ...(bundle.companions?.mappers || []),
        ...(bundle.companions?.criteria || []),
        ...((insight?.related_repositories || []).map((item) => item.class_name || item.table_name)),
      ],
      'Persistence 待确认'
    );
    lines.push(`  Persist --> R${index + 1}["${bundle.bucket.label}<br/>${persistenceLabel}"]`);
  });
  const rpcBundles = controllerBundles.filter((bundle) => bundle.companions?.rpcs?.length);
  if (rpcBundles.length) {
    lines.push('  App --> Ext["RPC / 外部依赖"]');
    rpcBundles.forEach((bundle, index) => {
      lines.push(
        `  Ext --> X${index + 1}["${bundle.bucket.label}<br/>${summarizeClassNames(bundle.companions?.rpcs, '外部依赖待确认')}"]`
      );
    });
  }
  lines.push('  Persist --> DB["MySQL / 核心表"]');
  controllerBundles.forEach((bundle, index) => {
    const tables = (bundleInsights[index]?.related_tables || []).slice(0, 2);
    if (!tables.length) return;
    lines.push(`  DB --> T${index + 1}["${bundle.bucket.label}<br/>${tables.map((item) => item.table_name).join('<br/>')}"]`);
  });
  return lines.join('\n');
}

function buildCodeLayeredArchitectureDiagram(inventory) {
  const controllerBundles = buildControllerFacetBundles(inventory, 4);
  const bundleInsights = controllerBundles.map((bundle) => buildFacetModuleInsight(bundle, inventory));
  const repositoryBuckets = groupItemsByFacet(
    [
      ...(Array.isArray(inventory.repositories) ? inventory.repositories : []),
      ...(Array.isArray(inventory.criteria_models) ? inventory.criteria_models : []),
      ...(Array.isArray(inventory.mapper_models) ? inventory.mapper_models : []),
    ],
    { exampleLimit: 2, maxBuckets: 4 }
  );
  const queryServices = uniqueStrings(
    controllerBundles.flatMap((bundle) => bundle.companions?.queryServices || []),
    6
  );
  const convertClasses = uniqueStrings(
    controllerBundles.flatMap((bundle) => bundle.companions?.converts || []),
    4
  );
  const validationClasses = uniqueStrings(
    controllerBundles.flatMap((bundle) => bundle.companions?.validations || []),
    4
  );
  const transactionalBundles = controllerBundles.filter((bundle) => bundle.companions?.hasTransactional);
  const requests =
    uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.requests || []), 6).length
      ? uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.requests || []), 6)
      : uniqueNames(inventory.request_models, 'class_name', 4);
  const dtos =
    uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.dtos || []), 6).length
      ? uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.dtos || []), 6)
      : uniqueNames(inventory.dto_models, 'class_name', 4);
  const vos =
    uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.vos || []), 6).length
      ? uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.vos || []), 6)
      : uniqueNames(inventory.vo_models, 'class_name', 4);
  const entities =
    uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.entities || []), 6).length
      ? uniqueStrings(controllerBundles.flatMap((bundle) => bundle.companions?.entities || []), 6)
      : uniqueNames(inventory.entities.map((item) => item.class_name || item.table_name), undefined, 4);
  const rpcClients = uniqueStrings(
    [...controllerBundles.flatMap((bundle) => bundle.companions?.rpcs || []), ...uniqueNames(inferRpcAdapters(inventory), 'class_name', 4)],
    6
  );
  const bundleTables = uniqueStrings(
    [
      ...bundleInsights.flatMap((insight) => (insight?.related_tables || []).map((item) => item.table_name)),
      ...controllerBundles.flatMap((bundle) =>
        inferCompanionTables(
          inventory,
          bundle.companions,
          bundle.bucket?.key || '',
          [bundle.controller?.class_name, bundle.bucket?.label]
        ).map((item) => item.table_name)
      ),
    ],
    8
  );
  const tables = bundleTables.length
    ? bundleTables.slice(0, 6)
    : uniqueNames(pickDiagramSqlTables(inventory, 8), 'table_name', 4);
  const lines = ['graph TB'];
  lines.push('  subgraph Client["客户端层 (Client Layer)"]');
  lines.push('    Browser["浏览器 / 移动端 / 第三方调用"]');
  lines.push('  end');
  lines.push('  subgraph ControllerLayer["Controller 层 (Rest Layer)"]');
  controllerBundles.forEach((bundle, index) => {
    lines.push(`    Ctrl${index + 1}["${formatFacetBucketLabel(bundle.bucket, 'Controller 待确认')}"]`);
  });
  lines.push('  end');
  lines.push('  subgraph ApplicationLayer["Application Service 层 (编排层)"]');
  controllerBundles.forEach((bundle, index) => {
    const appLabel = summarizeClassNames(
      [...(bundle.companions?.appServices || []), ...(bundle.companions?.queryServices || [])],
      'Application Service 待确认'
    );
    lines.push(`    AppSvc${index + 1}["${bundle.bucket.label}<br/>${appLabel}"]`);
  });
  if (queryServices.length) {
    lines.push(`    QuerySvc["${summarizeClassNames(queryServices, 'Query Service 待确认')}"]`);
  }
  lines.push(`    Convert["${summarizeClassNames(convertClasses, 'Convert / 对象转换')}"]`);
  lines.push(`    Validate["${summarizeClassNames(validationClasses, 'Validation / 业务验证')}"]`);
  if (transactionalBundles.length) {
    lines.push(
      `    Tx["事务边界<br/>${transactionalBundles.map((bundle) => bundle.bucket.label).slice(0, 3).join('<br/>')}"]`
    );
  }
  if (rpcClients.length) {
    lines.push(`    Rpc["${summarizeClassNames(rpcClients, 'RPC / 外部调用待确认')}"]`);
  }
  lines.push('  end');
  lines.push('  subgraph DomainLayer["Domain Service 层 (核心规则层)"]');
  controllerBundles.forEach((bundle, index) => {
    const domainLabel = summarizeClassNames(
      [...(bundle.companions?.serviceImpls || []), ...(bundle.companions?.queryServiceImpls || [])],
      '核心规则待确认'
    );
    lines.push(
      `    Domain${index + 1}["${bundle.bucket.label}<br/>${domainLabel}"]`
    );
  });
  lines.push('  end');
  lines.push('  subgraph RepositoryLayer["Repository 层 (数据访问层)"]');
  controllerBundles.forEach((bundle, index) => {
    const insight = bundleInsights[index];
    const persistenceLabel = summarizeClassNames(
      [
        ...(bundle.companions?.repositories || []),
        ...(bundle.companions?.criteria || []),
        ...(bundle.companions?.mappers || []),
        ...((insight?.related_repositories || []).map((item) => item.class_name || item.table_name)),
      ],
      formatFacetBucketLabel(repositoryBuckets[index], 'Repository 待确认')
    );
    lines.push(`    Repo${index + 1}["${bundle.bucket.label}<br/>${persistenceLabel}"]`);
  });
  lines.push('  end');
  lines.push('  subgraph ModelLayer["Model 层 (数据模型)"]');
  lines.push(`    Request["${requests.join('<br/>') || 'Request 待确认'}"]`);
  lines.push(`    DTO["${dtos.join('<br/>') || 'DTO 待确认'}"]`);
  lines.push(`    VO["${vos.join('<br/>') || 'VO 待确认'}"]`);
  lines.push(`    Entity["${entities.join('<br/>') || tables.join('<br/>') || 'Entity 待确认'}"]`);
  lines.push('  end');
  lines.push(`  DB["${tables.join('<br/>') || '数据库表待确认'}"]`);
  controllerBundles.forEach((bundle, index) => {
    lines.push(`  Browser -->|HTTP 请求| Ctrl${index + 1}`);
  });
  controllerBundles.forEach((bundle, index) => {
    lines.push(`  Ctrl${index + 1} -->|调用| AppSvc${index + 1}`);
  });
  if (queryServices.length) {
    lines.push('  Ctrl1 -->|查询调用| QuerySvc');
    lines.push('  QuerySvc -->|转换 / 装配| Convert');
    lines.push('  QuerySvc -->|读取| Repo1');
  }
  controllerBundles.forEach((bundle, index) => {
    lines.push(`  AppSvc${index + 1} -->|业务验证| Validate`);
    lines.push(`  AppSvc${index + 1} -->|对象转换| Convert`);
    if (transactionalBundles.some((item) => item.bucket.key === bundle.bucket.key)) {
      lines.push(`  AppSvc${index + 1} -->|事务边界| Tx`);
    }
  });
  if (rpcClients.length) {
    lines.push('  AppSvc1 -->|远程调用| Rpc');
  }
  controllerBundles.forEach((bundle, index) => {
    lines.push(`  AppSvc${index + 1} -->|执行业务规则| Domain${index + 1}`);
  });
  controllerBundles.forEach((bundle, index) => {
    lines.push(`  Domain${index + 1} -->|调用| Repo${index + 1}`);
  });
  controllerBundles.forEach((bundle, index) => {
    lines.push(`  Repo${index + 1} -->|持久化 / 查询| Entity`);
  });
  lines.push('  Entity -->|落库| DB');
  lines.push('  Convert -->|输入| Request');
  lines.push('  Convert -->|传输| DTO');
  lines.push('  Convert -->|展示| VO');
  return lines.join('\n');
}

function buildProductArchitectureDiagram(inventory) {
  const domainCards = buildDomainModuleCards(inventory, 6);
  const frontendModules = (Array.isArray(inventory.modules) ? inventory.modules : [])
    .filter((module) => /^frontend:/i.test(String(module.name || '')))
    .slice(0, 4);
  const lines = ['flowchart TD', '  Product["AIPlan ERP 产品能力地图"]'];
  if (frontendModules.length) {
    lines.push(
      `  Product --> Front["前端交互入口<br/>${frontendModules.map((item) => moduleDisplayName(item.name)).join('<br/>')}"]`
    );
  }
  domainCards.forEach((card, index) => {
    const id = `P${index + 1}`;
    const valueHint = String(card.insight.business_value || '')
      .replace(/"/g, "'")
      .split(/[。；\n]/)
      .map((item) => item.trim())
      .filter(Boolean)[0];
    lines.push(`  Product --> ${id}["${card.label}${valueHint ? `<br/>${valueHint}` : ''}"]`);
    if (card.insight.related_apis.length) {
      lines.push(
        `  ${id} --> ${id}Api["核心接口<br/>${card.insight.related_apis.slice(0, 2).map((item) => item.replace(/"/g, "'")).join('<br/>')}"]`
      );
    }
    if (card.insight.related_services.length) {
      lines.push(
        `  ${id} --> ${id}Svc["关键服务<br/>${card.insight.related_services.slice(0, 2).map((item) => item.class_name).join('<br/>')}"]`
      );
    }
    if (card.insight.key_objects.length) {
      lines.push(
        `  ${id} --> ${id}Obj["核心对象<br/>${card.insight.key_objects.slice(0, 3).join('<br/>')}"]`
      );
    }
  });
  return lines.join('\n');
}

function buildCoreFlowDiagram(inventory) {
  const controllerBundles = buildControllerFacetBundles(inventory, 6);
  const representativeBundle =
    controllerBundles.find((bundle) => bundle.bucket.key !== 'platform' && bundle.bucket.key !== 'general') ||
    controllerBundles[0] ||
    null;
  const representativeBucket = representativeBundle?.bucket || null;
  const facetKey = representativeBucket?.key || '';
  const representativeInsight = representativeBundle ? buildFacetModuleInsight(representativeBundle, inventory) : null;
  const ctrls = (inventory.controllers || []).filter((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey);
  const apis = ctrls.flatMap((item) => item.endpoints || []).slice(0, 5).map((a) => String(a).slice(0, 64));
  const companion = representativeBundle?.companions || null;
  const repositories = (inventory.repositories || []).filter((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey);
  const companionTables = inferCompanionTables(
    inventory,
    companion,
    facetKey,
    [representativeBundle?.controller?.class_name, ...apis]
  );
  const tables = companionTables.length ? companionTables : representativeInsight?.related_tables || [];
  const primaryEndpoint = apis[0] || '';
  const useQueryService = /\/(list|get|page|query)/i.test(primaryEndpoint);
  const svcName =
    (useQueryService ? companion?.queryServices?.[0] : companion?.appServices?.[0]) ||
    companion?.appServices?.[0] ||
    companion?.queryServices?.[0] ||
    representativeBucket?.label ||
    'DomainService';
  const requestName =
    pickRepresentativeRequestName(companion, primaryEndpoint) ||
    uniqueNames(inventory.request_models, 'class_name', 1)[0] ||
    'Request';
  const voName =
    pickRepresentativeResponseName(companion, primaryEndpoint) ||
    uniqueNames(inventory.vo_models, 'class_name', 1)[0] ||
    uniqueNames(inventory.dto_models, 'class_name', 1)[0] ||
    'ResponseVO';
  const repoName =
    companion?.repositories?.[0] ||
    companion?.mappers?.[0] ||
    representativeInsight?.related_repositories?.[0]?.class_name ||
    repositories[0]?.class_name ||
    inventory.mapper_models?.[0]?.class_name ||
    'Repository';
  const tableName = tables[0]?.table_name || inventory.tables[0] || inventory.entities[0]?.table_name || '核心表';
  const secondaryTableName = tables[1]?.table_name || '';
  const apiLabel = apis[0] || inventory.api_files[0] || '接口待确认';
  const lines = ['flowchart LR'];
  lines.push('  Start["触发请求"] --> Api["API 层"]');
  if (ctrls.length) {
    const c0 = String(ctrls[0].class_name || 'Controller').slice(0, 40);
    lines.push(`  Api --> C0["${c0}"]`);
    lines.push(`  C0 --> Req["${requestName}"]`);
    lines.push(`  Req --> Svc["${svcName}"]`);
  } else {
    lines.push(`  Api --> Svc["${svcName}"]`);
  }
  lines.push(
    `  Svc --> Rule["${summarizeClassNames(companion?.validations, '业务校验 / 规则判断')}"]`
  );
  if (companion?.hasTransactional && !useQueryService) {
    lines.push('  Rule --> Tx["@Transactional / 事务边界"]');
    lines.push('  Tx --> Repo');
  }
  lines.push(`  Rule --> Repo["${repoName}"]`);
  lines.push(`  Repo --> Data["${String(tableName).slice(0, 32)}"]`);
  if (secondaryTableName) {
    lines.push(`  Repo -.关联表.-> Data2["${String(secondaryTableName).slice(0, 32)}"]`);
  }
  lines.push(`  Data --> Resp["${voName}"]`);
  lines.push('  Resp --> End["响应 / 事件"]');
  if (apis.length > 1) {
    lines.push(`  Api -.路由线索.-> A1["${apis[1]}"]`);
  }
  lines.push(`  Api -.主入口.-> Note["${apiLabel}"]`);
  return lines.join('\n');
}

function buildSequenceDiagram(inventory) {
  const controllerBundles = buildControllerFacetBundles(inventory, 6);
  const representativeBundle =
    controllerBundles.find((bundle) => bundle.bucket.key !== 'platform' && bundle.bucket.key !== 'general') ||
    controllerBundles[0] ||
    null;
  const representativeBucket = representativeBundle?.bucket || null;
  const facetKey = representativeBucket?.key || '';
  const representativeInsight = representativeBundle ? buildFacetModuleInsight(representativeBundle, inventory) : null;
  const facetControllers = (inventory.controllers || []).filter((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey);
  const apis = facetControllers.flatMap((item) => item.endpoints || []).slice(0, 3);
  const endpoint = apis[0] || '接口待确认';
  const endpoint2 = apis[1] || '';
  const ctrlName = facetControllers[0]?.class_name || inventory.controllers[0]?.class_name || 'ApiController';
  const companion = representativeBundle?.companions || null;
  const useQueryService = /\/(list|get|page|query)/i.test(endpoint);
  const serviceName =
    (useQueryService ? companion?.queryServices?.[0] : companion?.appServices?.[0]) ||
    companion?.appServices?.[0] ||
    companion?.queryServices?.[0] ||
    representativeBucket?.label ||
    'DomainService';
  const repositoryName =
    companion?.repositories?.[0] ||
    companion?.mappers?.[0] ||
    representativeInsight?.related_repositories?.[0]?.class_name ||
    (inventory.repositories || []).find((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey)?.class_name ||
    inventory.mapper_models?.[0]?.class_name ||
    'Repository';
  const companionTables = inferCompanionTables(
    inventory,
    companion,
    facetKey,
    [ctrlName, repositoryName, serviceName, endpoint]
  );
  const tables = companionTables.length ? companionTables : representativeInsight?.related_tables || [];
  const tableName = tables[0]?.table_name || inventory.tables[0] || '核心表';
  const secondaryTableName = tables[1]?.table_name || '';
  const moduleName = representativeBucket?.label || inventory.modules[0]?.name || inventory.controllers[0]?.class_name || '核心业务';
  const requestName = uniqueNames(inventory.request_models, 'class_name', 1)[0] || 'Request';
  const resolvedRequestName =
    pickRepresentativeRequestName(companion, endpoint) ||
    requestName;
  const voName =
    pickRepresentativeResponseName(companion, endpoint) ||
    uniqueNames(inventory.vo_models, 'class_name', 1)[0] ||
    uniqueNames(inventory.dto_models, 'class_name', 1)[0] ||
    'ResponseVO';
  const rpcName = companion?.rpcs?.[0] || inferRpcAdapters(inventory)[0]?.class_name || null;
  const validationName = companion?.validations?.[0] || null;
  const convertName = companion?.converts?.[0] || null;
  const actionLabel =
    endpoint
      .split(/\s+/)
      .slice(-1)[0]
      .replace(/[{}]/g, '')
      .split('/')
      .filter(Boolean)
      .slice(-2)
      .join('/') || '核心动作';
  const lines = [
    'sequenceDiagram',
    `  participant User as ${moduleName}调用方`,
    `  participant Api as ${ctrlName}`,
    `  participant Req as ${resolvedRequestName}`,
    `  participant Service as ${serviceName}`,
    `  participant Repo as ${repositoryName}`,
    '  participant DB as Database',
    `  User->>Api: 发起 ${actionLabel}`,
  ];
  if (endpoint2) {
    lines.push(`  Note over User,Api: 关联入口 ${endpoint2}`);
  }
  if (secondaryTableName) {
    lines.push(`  Note over Service,DB: 关联持久化对象 ${secondaryTableName}`);
  }
  lines.push(
    `  Api->>Req: 解析并校验入参`,
    `  Req->>Service: 装配 ${moduleName} 请求`,
    `  Service->>Service: ${validationName || '执行业务规则 / 状态判断'}`,
    ...(companion?.hasTransactional && !useQueryService ? ['  Service->>Service: 开启事务边界 (@Transactional)'] : []),
    ...(convertName ? [`  Service->>Service: ${convertName} 对象转换`] : []),
    `  Service->>Repo: 查询或写入 ${tableName}`,
    `  Repo->>DB: 访问 ${tableName}`,
    `  DB-->>Repo: 返回 ${tableName} 数据`,
    `  Repo-->>Service: 聚合 ${moduleName} 结果`,
    ...(rpcName ? [`  Service->>Service: 必要时调用 ${rpcName}`] : []),
    `  Service-->>Api: 输出 ${voName}`,
    `  Api-->>User: 输出 ${actionLabel} 结果`
  );
  return lines.join('\n');
}

function buildBusinessDomainDiagram(inventory) {
  const domainCards = buildDddDomainCards(inventory, new Map(), 6);
  const lines = ['flowchart TD', '  Product["业务主干 / Domain Landscape"]'];
  domainCards.forEach((card, index) => {
    const id = `D${index + 1}`;
    const valueHint = String(card.insight.business_value || '')
      .replace(/"/g, "'")
      .split(/[。；\n]/)
      .map((item) => item.trim())
      .filter(Boolean)[0];
    const tierLabel = card.domain_tier === 'core' ? '核心域' : card.domain_tier === 'generic' ? '通用域' : '支撑域';
    lines.push(`  Product --> ${id}["${card.label}<br/>${tierLabel}${valueHint ? `<br/>${valueHint}` : ''}"]`);
    lines.push(`  ${id} --> ${id}Ctx["${card.bounded_context_name}"]`);
    if (card.behaviors.length) {
      lines.push(`  ${id}Ctx --> ${id}Behavior["核心行为<br/>${card.behaviors.slice(0, 2).map((item) => item.title.replace(/"/g, "'")).join('<br/>')}"]`);
    }
    if (card.aggregates.length) {
      lines.push(`  ${id}Ctx --> ${id}Agg["聚合 / 核心对象<br/>${card.aggregates.slice(0, 3).join('<br/>')}"]`);
    }
    if (card.upstream_contexts.length) {
      lines.push(
        `  ${id}Ctx -.上游.-> ${id}Up["上游上下文<br/>${card.upstream_contexts.slice(0, 2).map((item) => item.domain_label.replace(/"/g, "'")).join('<br/>')}"]`
      );
    }
    if (card.downstream_contexts.length) {
      lines.push(
        `  ${id}Ctx -.下游.-> ${id}Down["下游上下文<br/>${card.downstream_contexts.slice(0, 2).map((item) => item.domain_label.replace(/"/g, "'")).join('<br/>')}"]`
      );
    }
  });
  return lines.join('\n');
}

function buildModuleFlowDiagram(inventory) {
  const frontendModules = (Array.isArray(inventory.modules) ? inventory.modules : [])
    .filter((module) => /^frontend:/i.test(String(module.name || '')))
    .slice(0, 3);
  const domainCards = buildDomainModuleCards(inventory, 5);
  const lines = ['flowchart LR'];
  if (!domainCards.length) {
    lines.push('  Core["核心模块待确认"] --> Support["协同模块待确认"]');
    return lines.join('\n');
  }
  lines.push(
    `  Front["前端入口<br/>${frontendModules.map((item) => moduleDisplayName(item.name)).join('<br/>') || '前端页面 / API'}"]`
  );
  lines.push('  Front --> App["应用编排 / API 层"]');
  domainCards.forEach((card, index) => {
    const id = `M${index + 1}`;
    lines.push(`  App --> ${id}["${card.label}"]`);
    if (card.insight.related_tables.length) {
      lines.push(`  ${id} --> ${id}DB["${card.insight.related_tables.slice(0, 2).map((item) => item.table_name).join('<br/>')}"]`);
    }
  });
  return lines.join('\n');
}

function buildErDiagram(inventory) {
  const sqlTables = pickErDiagramTables(inventory, 16);
  const tables = sqlTables.map((item) => item.table_name).filter(Boolean);
  if (!tables.length) {
    return ['erDiagram', '  SYSTEM_CONTEXT {', '    string status', '  }'].join('\n');
  }
  const lines = ['erDiagram'];
  sqlTables.forEach((tableInfo, index) => {
    const tableName = tableInfo.table_name || tables[index];
    const safeName = String(tableName || 'TABLE').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    lines.push(`  ${safeName} {`);
    const columns = Array.isArray(tableInfo.columns) && tableInfo.columns.length ? tableInfo.columns : ['id', 'status'];
    columns.slice(0, 6).forEach((columnName, columnIndex) => {
      lines.push(`    string ${String(columnName || `field_${columnIndex + 1}`).replace(/[^A-Za-z0-9_]/g, '_')}`);
    });
    lines.push('  }');
  });
  const references = inferSqlTableRelations(sqlTables).map((relation) => ({
    from: String(relation.from || '').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase(),
    to: String(relation.to || '').replace(/[^A-Za-z0-9_]/g, '_').toUpperCase(),
    via: relation.via || '关联线索',
  }));
  references.slice(0, 12).forEach((relation) => {
    if (relation.from && relation.to) {
      lines.push(`  ${relation.from} ||--o{ ${relation.to} : "${String(relation.via).replace(/"/g, "'")}"`);
    }
  });
  if (!references.length && tables.length > 1) {
    const first = String(tables[0]).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    const second = String(tables[1]).replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
    lines.push(`  ${first} ||--o{ ${second} : "关联线索"`);
  }
  return lines.join('\n');
}

function buildOverviewDiagram(inventory) {
  const repoUnits = Array.isArray(inventory.repo_units) ? inventory.repo_units : [];
  const repoLabel = repoUnits.length
    ? repoUnits
        .slice(0, 4)
        .map((item) => `${item.repo_role || 'repo'}:${item.repo_slug || ''}`)
        .join('<br/>')
    : '项目代码基线';
  return [
    'flowchart TD',
    `  Project["${repoLabel || '项目代码基线'}"]`,
    '  Project --> Layered["代码分层架构"]',
    '  Project --> Tech["技术架构"]',
    '  Project --> Product["产品能力架构"]',
    '  Project --> Domain["业务域知识"]',
    '  Project --> Flow["业务总体流程"]',
    '  Project --> Module["模块依赖流"]',
    '  Project --> Logic["核心逻辑时序"]',
    '  Project --> ER["数据库 ER"]',
    '  Layered --> Tech',
    '  Product --> Domain',
    '  Domain --> Flow',
    '  Module --> Logic',
    '  Tech --> ER',
  ].join('\n');
}

function buildContextStructuredDiagram(diagramType, inventory) {
  const controllers = Array.isArray(inventory.controllers) ? inventory.controllers : [];
  const applicationServices = inferApplicationServices(inventory);
  const queryServices = inferQueryServices(inventory);
  const domainServices = inferDomainServices(inventory);
  const repositories = Array.isArray(inventory.repositories) ? inventory.repositories : [];
  const requestModels = Array.isArray(inventory.request_models) ? inventory.request_models : [];
  const dtoModels = Array.isArray(inventory.dto_models) ? inventory.dto_models : [];
  const voModels = Array.isArray(inventory.vo_models) ? inventory.vo_models : [];
  const criteriaModels = Array.isArray(inventory.criteria_models) ? inventory.criteria_models : [];
  const mapperModels = Array.isArray(inventory.mapper_models) ? inventory.mapper_models : [];
  const entities = Array.isArray(inventory.entities) ? inventory.entities : [];
  const feignClients = inferRpcAdapters(inventory);
  const sqlTables = Array.isArray(inventory.sql_tables) ? inventory.sql_tables : [];
  const apiEndpoints = Array.isArray(inventory.api_endpoints) ? inventory.api_endpoints : [];
  const domainCards = buildDomainModuleCards(inventory, 6);
  const frontendModules = (Array.isArray(inventory.modules) ? inventory.modules : [])
    .filter((module) => /^frontend:/i.test(String(module.name || '')))
    .slice(0, 4);
  const moduleNodes = (Array.isArray(inventory.modules) ? inventory.modules : []).slice(0, 8);

  const evidenceMap = {
    code_layered_architecture: [
      controllers.length ? `controllers:${controllers.length}` : '',
      applicationServices.length ? `application_services:${applicationServices.length}` : '',
      queryServices.length ? `query_services:${queryServices.length}` : '',
      domainServices.length ? `domain_services:${domainServices.length}` : '',
      repositories.length ? `repositories:${repositories.length}` : '',
      criteriaModels.length ? `criteria:${criteriaModels.length}` : '',
      mapperModels.length ? `mappers:${mapperModels.length}` : '',
      requestModels.length ? `request_models:${requestModels.length}` : '',
      dtoModels.length ? `dto_models:${dtoModels.length}` : '',
      voModels.length ? `vo_models:${voModels.length}` : '',
      entities.length ? `entities:${entities.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
    ],
    technical_architecture: [
      controllers.length ? `controllers:${controllers.length}` : '',
      applicationServices.length ? `application_services:${applicationServices.length}` : '',
      repositories.length ? `repositories:${repositories.length}` : '',
      feignClients.length ? `rpc_clients:${feignClients.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
      frontendModules.length ? `frontend_modules:${frontendModules.length}` : '',
    ],
    product_architecture: [
      domainCards.length ? `business_domains:${domainCards.length}` : '',
      apiEndpoints.length ? `api_endpoints:${apiEndpoints.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
      frontendModules.length ? `frontend_modules:${frontendModules.length}` : '',
    ],
    business_domain: [
      domainCards.length ? `business_domains:${domainCards.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
      apiEndpoints.length ? `api_endpoints:${apiEndpoints.length}` : '',
    ],
    business_flow: [
      apiEndpoints.length ? `api_endpoints:${apiEndpoints.length}` : '',
      controllers.length ? `controllers:${controllers.length}` : '',
      applicationServices.length ? `application_services:${applicationServices.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
    ],
    module_flow: [
      moduleNodes.length ? `modules:${moduleNodes.length}` : '',
      frontendModules.length ? `frontend_modules:${frontendModules.length}` : '',
      domainCards.length ? `business_domains:${domainCards.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
    ],
    core_logic: [
      apiEndpoints.length ? `api_endpoints:${apiEndpoints.length}` : '',
      controllers.length ? `controllers:${controllers.length}` : '',
      applicationServices.length ? `application_services:${applicationServices.length}` : '',
      repositories.length ? `repositories:${repositories.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
    ],
    database_er: [
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
      entities.length ? `entities:${entities.length}` : '',
      inferSqlTableRelations(sqlTables).length ? `table_relations:${inferSqlTableRelations(sqlTables).length}` : '',
      mapperModels.length ? `mappers:${mapperModels.length}` : '',
    ],
    overview: [
      controllers.length ? `controllers:${controllers.length}` : '',
      domainCards.length ? `business_domains:${domainCards.length}` : '',
      apiEndpoints.length ? `api_endpoints:${apiEndpoints.length}` : '',
      sqlTables.length ? `sql_tables:${sqlTables.length}` : '',
    ],
  };

  const summaryMap = {
    code_layered_architecture: `基于代码清单自动还原 Controller、Application、Domain、Repository、Model 五层结构，并串联验证、转换、RPC 与持久化语义。`,
    technical_architecture: `基于前端模块、REST 接口、应用服务、仓储与数据库对象还原项目技术架构主链路。`,
    product_architecture: `基于业务域模块、关键接口与核心对象生成产品能力/子系统架构图。`,
    business_domain: `基于领域模块、核心对象、数据表与接口入口提炼业务域知识图。`,
    business_flow: `基于主入口 API、请求对象、服务编排与持久化对象自动抽取业务总体流程。`,
    module_flow: `基于模块边界、前端入口与核心服务模块关系生成模块依赖流图。`,
    core_logic: `基于关键入口接口、应用服务、仓储与核心表生成核心逻辑时序图。`,
    database_er: `基于 SQL / DDL、实体、Mapper 与推断外键关系生成数据库 ER 图。`,
    overview: `基于代码分层、技术架构、业务域、流程与数据库对象聚合生成项目总图。`,
  };

  const missingMap = {
    code_layered_architecture: [
      applicationServices.length ? '' : 'application_services',
      repositories.length ? '' : 'repositories',
      sqlTables.length || entities.length ? '' : 'database_objects',
    ],
    technical_architecture: [
      frontendModules.length ? '' : 'frontend_modules',
      feignClients.length ? '' : 'rpc_clients',
    ],
    product_architecture: [
      domainCards.length ? '' : 'business_domains',
    ],
    business_domain: [
      domainCards.length ? '' : 'business_domains',
      sqlTables.length ? '' : 'sql_tables',
    ],
    business_flow: [
      apiEndpoints.length ? '' : 'api_endpoints',
      applicationServices.length ? '' : 'application_services',
    ],
    module_flow: [
      moduleNodes.length ? '' : 'modules',
    ],
    core_logic: [
      controllers.length ? '' : 'controllers',
      sqlTables.length ? '' : 'sql_tables',
    ],
    database_er: [
      sqlTables.length ? '' : 'sql_tables',
    ],
    overview: [],
  };

  const builderMap = {
    overview: buildOverviewDiagram,
    code_layered_architecture: buildCodeLayeredArchitectureDiagram,
    technical_architecture: buildSystemArchitectureDiagram,
    product_architecture: buildProductArchitectureDiagram,
    business_domain: buildBusinessDomainDiagram,
    business_flow: buildCoreFlowDiagram,
    module_flow: buildModuleFlowDiagram,
    core_logic: buildSequenceDiagram,
    database_er: buildErDiagram,
  };

  const builder = builderMap[diagramType];
  if (!builder) return null;

  return {
    mermaid_source: builder(inventory),
    diagram_summary: summaryMap[diagramType] || '基于代码上下文自动生成的结构化图谱。',
    covered_evidence: (evidenceMap[diagramType] || []).filter(Boolean),
    missing_evidence: (missingMap[diagramType] || []).filter(Boolean),
    quality_notes: [
      '当前图基于代码 inventory、接口、实体、SQL 与模块边界自动构建',
      'render_source=context_structured，可继续叠加 LLM 精修版本',
    ],
    render_source: 'context_structured',
  };
}

function extractDigestLead(digest, moduleName) {
  const lines = String(digest || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  return lines[0] || `${moduleName} 承载当前业务域的一部分能力，具体规则仍待结合真实业务确认。`;
}

function isLowValueDigestLead(lead = '') {
  const text = String(lead || '').trim();
  if (!text) return true;
  if (/^(service|frontend|backend):/i.test(text)) return true;
  if (/^[a-z0-9:_/-]+$/i.test(text) && !/[A-Z]/.test(text)) return true;
  if (/当前基于目录与文件命名推断/.test(text)) return true;
  if (/^模块职责：围绕\s+(service|frontend|backend):/i.test(text)) return true;
  if (/依赖与入口：建议从关键文件继续确认/.test(text)) return true;
  return false;
}

function resolveNamedItems(items = [], names = [], limit = 8, getName = null) {
  const resolver =
    typeof getName === 'function'
      ? getName
      : (item) => item?.class_name || item?.table_name || item?.name || '';
  const index = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = String(resolver(item) || '').trim();
    if (key && !index.has(key)) {
      index.set(key, item);
    }
  });
  return uniqueStrings(names, Math.max(limit * 2, 12))
    .map((name) => {
      const resolved = index.get(name);
      if (resolved) return resolved;
      return {
        class_name: name,
        table_name: name,
        path: '',
      };
    })
    .slice(0, limit);
}

function extractControllerEndpoints(controllerItems = [], limit = 6) {
  return uniqueStrings(
    (Array.isArray(controllerItems) ? controllerItems : []).flatMap((item) => normalizeArray(item?.endpoints)),
    limit
  );
}

function formatEndpointAction(endpoint = '') {
  const pathValue = String(endpoint || '')
    .split(/\s+/)
    .slice(-1)[0]
    .replace(/[{}]/g, '')
    .split('/')
    .filter(Boolean)
    .slice(-2)
    .join(' / ');
  return pathValue || '主链路处理';
}

function buildFacetBusinessValue(bucket, relatedApis = [], relatedTables = [], relatedServices = [], relatedEntities = []) {
  const actionHint = formatEndpointAction(relatedApis[0] || '');
  const objectHint =
    relatedTables[0]?.table_name ||
    relatedEntities[0]?.table_name ||
    relatedEntities[0]?.class_name ||
    '核心对象';
  const serviceHint = pickBusinessServiceHint(bucket, null, relatedServices);
  const extraAction = relatedApis[1] ? `，并覆盖 ${formatEndpointAction(relatedApis[1])}` : '';
  return `${bucket?.label || '当前业务域'} 主要围绕 ${objectHint} 等核心对象提供 ${actionHint}${extraAction} 能力，并通过 ${serviceHint} 串联校验、转换与持久化。`;
}

function buildFacetModuleInsight(bundle, inventory, moduleDigestMap = new Map(), digestHints = []) {
  if (!bundle?.bucket) {
    return {
      business_value: '当前业务域价值待结合真实代码与文档进一步确认。',
      facet_labels: [],
      related_controllers: [],
      related_services: [],
      related_repositories: [],
      related_entities: [],
      related_tables: [],
      related_rpc: [],
      related_apis: [],
      related_requests: [],
      related_dtos: [],
      related_vos: [],
      related_validations: [],
      related_converts: [],
      related_transactions: [],
      key_objects: [],
      matched_modules: [],
    };
  }

  const facetKey = bundle.bucket.key || '';
  const companion = bundle.companions || (bundle.controller ? inferControllerCompanions(inventory, bundle.controller) : null);
  const matchedModules = (Array.isArray(inventory.modules) ? inventory.modules : [])
    .filter((module) => inferModuleFacetKeys(module, 3).includes(facetKey))
    .slice(0, 4)
    .map((module) => module.name);
  const relatedControllers = (inventory.controllers || [])
    .filter((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey)
    .slice(0, 6);
  const relatedApis = extractControllerEndpoints(relatedControllers, 6);
  const relatedServices = uniqueBy(
    [
      ...resolveNamedItems(
        inventory.services || [],
        [
          ...(companion?.appServices || []),
          ...(companion?.queryServices || []),
          ...(companion?.serviceImpls || []),
          ...(companion?.queryServiceImpls || []),
        ],
        10
      ),
      ...((inventory.services || []).filter((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey)),
    ],
    (item) => `${item.class_name || ''}:${item.path || ''}`
  );
  const rankedServices = rankServicesForFacet(relatedServices, companion, facetKey).slice(0, 8);
  const repositoryPool = [
    ...(inventory.repositories || []),
    ...(inventory.mapper_models || []),
    ...(inventory.criteria_models || []),
  ];
  const relatedRepositories = uniqueBy(
    [
      ...resolveNamedItems(
        repositoryPool,
        [
          ...(companion?.repositories || []),
          ...(companion?.mappers || []),
          ...(companion?.criteria || []),
        ],
        10
      ),
      ...repositoryPool.filter((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey),
    ],
    (item) => `${item.class_name || item.table_name || ''}:${item.path || ''}`
  ).slice(0, 8);
  const relatedEntities = uniqueBy(
    [
      ...resolveNamedItems(
        inventory.entities || [],
        companion?.entities || [],
        10,
        (item) => item?.class_name || item?.table_name || ''
      ),
      ...((inventory.entities || []).filter((item) => classifyArchitectureFacet(item.path, item.class_name || item.table_name).key === facetKey)),
    ],
    (item) => `${item.class_name || item.table_name || ''}:${item.path || ''}`
  ).slice(0, 8);
  const fallbackTableCandidates = [
    ...rankedServices.map((item) => item.class_name),
    ...relatedRepositories.map((item) => item.class_name || item.table_name),
    ...relatedEntities.map((item) => item.class_name || item.table_name),
    ...(companion?.requests || []),
    ...(companion?.dtos || []),
    ...(companion?.vos || []),
  ].flatMap((symbol) => inferTableCandidatesFromSymbol(symbol));
  const relatedTables = uniqueBy(
    [
      ...inferCompanionTables(
        inventory,
        companion,
        facetKey,
        [bundle.controller?.class_name, bundle.bucket.label]
      ),
      ...matchInventoryTables(inventory, fallbackTableCandidates, facetKey),
      ...buildSqlTableLookup(inventory).tables.filter((item) => classifyArchitectureFacet(item.path, item.table_name).key === facetKey),
    ],
    (item) => `${item.table_name || ''}:${item.path || ''}`
  ).slice(0, 8);
  const relatedRpc = uniqueBy(
    [
      ...resolveNamedItems(inferRpcAdapters(inventory), companion?.rpcs || [], 6),
      ...inferRpcAdapters(inventory).filter((item) => classifyArchitectureFacet(item.path, item.class_name).key === facetKey),
    ],
    (item) => `${item.class_name || ''}:${item.path || ''}`
  ).slice(0, 4);
  const digestLead = [matchedModules, digestHints]
    .flat()
    .map((hint) => String(hint || '').trim())
    .filter(Boolean)
    .map((hint) => moduleDigestMap.get(hint) || hint)
    .find(Boolean);
  const digestLeadText = digestLead ? extractDigestLead(digestLead, bundle.bucket.label) : '';
  const businessValue = digestLeadText && !isLowValueDigestLead(digestLeadText)
    ? digestLeadText
    : buildFacetBusinessValue(bundle.bucket, relatedApis, relatedTables, rankedServices, relatedEntities);

  return {
    business_value: businessValue,
    facet_labels: [bundle.bucket.label],
    related_controllers: relatedControllers,
    related_services: rankedServices,
    related_repositories: relatedRepositories,
    related_entities: relatedEntities,
    related_tables: relatedTables,
    related_rpc: relatedRpc,
    related_apis: relatedApis,
    related_requests: uniqueStrings(companion?.requests || [], 8),
    related_dtos: uniqueStrings(companion?.dtos || [], 8),
    related_vos: uniqueStrings(companion?.vos || [], 8),
    related_validations: uniqueStrings(companion?.validations || [], 6),
    related_converts: uniqueStrings(companion?.converts || [], 6),
    related_transactions: companion?.hasTransactional ? ['@Transactional'] : [],
    key_objects: uniqueStrings(
      [
        ...relatedTables.map((item) => item.table_name),
        ...relatedEntities.map((item) => item.class_name || item.table_name),
        ...(companion?.dtos || []),
        ...(companion?.vos || []),
      ],
      8
    ),
    matched_modules: matchedModules,
  };
}

function inferModuleFacetKeys(moduleInfo, maxKeys = 3) {
  const scores = new Map();
  const addFacet = (facet, weight = 1) => {
    if (!facet?.key || facet.key === 'platform' || facet.key === 'general') return;
    const current = scores.get(facet.key) || { facet, score: 0 };
    current.score += Number(weight || 0);
    current.facet = facet;
    scores.set(facet.key, current);
  };

  normalizeArray(moduleInfo?.source_files)
    .slice(0, 48)
    .forEach((filePath) => addFacet(classifyArchitectureFacet(filePath, path.basename(filePath, path.extname(filePath))), 2));
  (Array.isArray(moduleInfo?.key_files) ? moduleInfo.key_files : [])
    .slice(0, 12)
    .forEach((file) => addFacet(classifyArchitectureFacet(file?.path || '', file?.path || ''), 3));
  addFacet(classifyArchitectureFacet(moduleInfo?.name || '', moduleInfo?.name || ''), 1);

  return Array.from(scores.values())
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if ((right.facet?.priority || 0) !== (left.facet?.priority || 0)) {
        return (right.facet?.priority || 0) - (left.facet?.priority || 0);
      }
      return String(left.facet?.label || '').localeCompare(String(right.facet?.label || ''), 'zh-CN');
    })
    .slice(0, Math.max(1, Number(maxKeys || 3)))
    .map((item) => item.facet.key);
}

function mergeModuleFacetInsights(moduleName, facetLabels = [], insights = [], digestLead = '') {
  const safeInsights = Array.isArray(insights) ? insights.filter(Boolean) : [];
  if (!safeInsights.length) return null;
  return {
    business_value:
      digestLead && !isLowValueDigestLead(digestLead)
        ? digestLead
        : `${moduleDisplayName(moduleName)} 主要覆盖 ${uniqueStrings(facetLabels, 4).join('、') || '当前业务域'} 等能力，具体规则由对应入口、服务与持久化对象共同承载。`,
    facet_labels: uniqueStrings([...facetLabels, ...safeInsights.flatMap((item) => item.facet_labels || [])], 6),
    related_controllers: uniqueBy(safeInsights.flatMap((item) => item.related_controllers || []), (item) => `${item.class_name || ''}:${item.path || ''}`).slice(0, 8),
    related_services: uniqueBy(safeInsights.flatMap((item) => item.related_services || []), (item) => `${item.class_name || ''}:${item.path || ''}`).slice(0, 10),
    related_repositories: uniqueBy(safeInsights.flatMap((item) => item.related_repositories || []), (item) => `${item.class_name || item.table_name || ''}:${item.path || ''}`).slice(0, 8),
    related_entities: uniqueBy(safeInsights.flatMap((item) => item.related_entities || []), (item) => `${item.class_name || item.table_name || ''}:${item.path || ''}`).slice(0, 8),
    related_tables: uniqueBy(safeInsights.flatMap((item) => item.related_tables || []), (item) => `${item.table_name || ''}:${item.path || ''}`).slice(0, 8),
    related_rpc: uniqueBy(safeInsights.flatMap((item) => item.related_rpc || []), (item) => `${item.class_name || ''}:${item.path || ''}`).slice(0, 6),
    related_apis: uniqueStrings(safeInsights.flatMap((item) => item.related_apis || []), 8),
    related_requests: uniqueStrings(safeInsights.flatMap((item) => item.related_requests || []), 10),
    related_dtos: uniqueStrings(safeInsights.flatMap((item) => item.related_dtos || []), 10),
    related_vos: uniqueStrings(safeInsights.flatMap((item) => item.related_vos || []), 10),
    related_validations: uniqueStrings(safeInsights.flatMap((item) => item.related_validations || []), 8),
    related_converts: uniqueStrings(safeInsights.flatMap((item) => item.related_converts || []), 8),
    related_transactions: uniqueStrings(safeInsights.flatMap((item) => item.related_transactions || []), 4),
    key_objects: uniqueStrings(safeInsights.flatMap((item) => item.key_objects || []), 10),
  };
}

function buildModuleInsight(moduleInfo, inventory, moduleDigestMap) {
  const moduleName = String(moduleInfo?.name || '').trim();
  const moduleDigest = moduleDigestMap.get(moduleName) || '';
  const facetKeys = inferModuleFacetKeys(moduleInfo, 3);
  if (facetKeys.length) {
    const bundleMap = new Map(
      buildControllerFacetBundles(inventory, 10).map((bundle) => [bundle.bucket?.key, bundle])
    );
    const facetInsights = facetKeys
      .map((facetKey) => {
        const bundle = bundleMap.get(facetKey);
        return bundle ? buildFacetModuleInsight(bundle, inventory, moduleDigestMap, [moduleName]) : null;
      })
      .filter(Boolean);
    const mergedFacetInsight = mergeModuleFacetInsights(
      moduleName,
      facetKeys
        .map((facetKey) => bundleMap.get(facetKey)?.bucket?.label)
        .filter(Boolean),
      facetInsights,
      moduleDigest ? extractDigestLead(moduleDigest, moduleName) : ''
    );
    if (mergedFacetInsight) {
      return mergedFacetInsight;
    }
  }

  const genericModuleTokens = new Set([
    'service',
    'frontend',
    'backend',
    'module',
    'modules',
    'repo',
    'repository',
    'erp',
    'app',
    'platform',
    'common',
  ]);
  const sourceFiles = normalizeArray(moduleInfo?.source_files);
  const sourcePrefixes = sourceFiles
    .map((filePath) => {
      const parts = String(filePath).split('/');
      return parts.slice(0, Math.min(parts.length, 4)).join('/');
    })
    .filter(Boolean);
  const moduleTokens = Array.from(
    new Set(
      moduleName
        .toLowerCase()
        .split(/[:/_-]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3 && !genericModuleTokens.has(item))
    )
  );
  const matchesPathOrToken = (pathValue = '', symbolValue = '') => {
    const normalizedPath = String(pathValue || '').toLowerCase();
    const normalizedSymbol = String(symbolValue || '').toLowerCase();
    return (
      sourcePrefixes.some((prefix) => normalizedPath.startsWith(prefix.toLowerCase())) ||
      moduleTokens.some((token) => normalizedPath.includes(token) || normalizedSymbol.includes(token))
    );
  };

  const relatedControllers = (inventory.controllers || [])
    .filter((item) => matchesPathOrToken(item.path, item.class_name))
    .slice(0, 6);
  const relatedServices = (inventory.services || [])
    .filter((item) => matchesPathOrToken(item.path, item.class_name))
    .slice(0, 8);
  const relatedRepositories = (inventory.repositories || [])
    .filter((item) => matchesPathOrToken(item.path, item.class_name))
    .slice(0, 6);
  const relatedEntities = (inventory.entities || [])
    .filter((item) => matchesPathOrToken(item.path, item.class_name || item.table_name))
    .slice(0, 8);
  const controllerBundles = relatedControllers.map((controllerItem) => ({
    bucket: classifyArchitectureFacet(controllerItem.path, controllerItem.class_name),
    controller: controllerItem,
    companions: inferControllerCompanions(inventory, controllerItem),
  }));
  const relatedTables = uniqueBy(
    [
      ...controllerBundles.flatMap((bundle) =>
        inferCompanionTables(
          inventory,
          bundle.companions,
          bundle.bucket?.key || '',
          [bundle.controller?.class_name, bundle.bucket?.label]
        )
      ),
      ...(buildSqlTableLookup(inventory).tables || []).filter((item) => matchesPathOrToken(item.path, item.table_name)),
    ],
    (item) => `${item.table_name || ''}:${item.path || ''}`
  ).slice(0, 8);
  const relatedRpc = (inventory.feign_clients || [])
    .filter((item) => matchesPathOrToken(item.path, item.class_name))
    .slice(0, 4);
  const relatedApis = extractControllerEndpoints(relatedControllers, 6).length
    ? extractControllerEndpoints(relatedControllers, 6)
    : normalizeArray(inventory.api_endpoints)
        .filter((endpoint) => moduleTokens.some((token) => endpoint.toLowerCase().includes(token)))
        .slice(0, 6);

  return {
    business_value: extractDigestLead(moduleDigest, moduleName),
    facet_labels: facetKeys.map((facetKey) => facetLabelForKey(facetKey)).filter(Boolean),
    related_controllers: relatedControllers,
    related_services: relatedServices,
    related_repositories: relatedRepositories,
    related_entities: relatedEntities,
    related_tables: relatedTables,
    related_rpc: relatedRpc,
    related_apis: relatedApis,
    related_requests: [],
    related_dtos: [],
    related_vos: [],
    related_validations: [],
    related_converts: [],
    related_transactions: [],
    key_objects: Array.from(
      new Set([
        ...relatedEntities.map((item) => item.class_name || item.table_name),
        ...relatedTables.map((item) => item.table_name),
        ...(relatedEntities.length || relatedTables.length ? [] : relatedServices.map((item) => item.class_name)),
        ...(relatedEntities.length || relatedTables.length ? [] : relatedRpc.map((item) => item.class_name)),
      ].filter(Boolean))
    ).slice(0, 8),
  };
}

function buildDeepWikiPageFilePath(outputRoot, page) {
  const extension = page.format === 'mmd' ? '.mmd' : '.md';
  return path.join(outputRoot, `${page.page_slug}${extension}`);
}

function uniqueBy(items, resolver) {
  const values = Array.isArray(items) ? items : [];
  const seen = new Set();
  const result = [];
  values.forEach((item, index) => {
    const key = resolver(item, index);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function normalizeArray(values) {
  return Array.isArray(values) ? values.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function normalizeObjectKey(value, fallback) {
  return sanitizePathSegment(String(value || '').toLowerCase(), fallback);
}

function buildDeepWikiKnowledgeGraph({
  repo,
  inventory = {},
  pages = [],
  moduleDigests = [],
  researchProvider,
  researchModel,
  outputProfile,
  diagramProfile,
}) {
  const objects = [];
  const relations = [];
  const objectByKey = new Map();
  const sharedMeta = {
    repo_url: repo.repo_url,
    repo_slug: repo.repo_slug,
    branch: repo.branch,
    commit_sha: repo.commit_sha,
    research_provider: researchProvider || null,
    research_model: researchModel || null,
    output_profile: outputProfile || 'engineering_architecture_pack',
    diagram_profile: diagramProfile || 'full',
  };
  const moduleDigestMap = new Map(
    (Array.isArray(moduleDigests) ? moduleDigests : [])
      .map((item) => [String(item?.name || '').trim(), String(item?.content || '').trim()])
      .filter((item) => item[0])
  );

  const addObject = ({
    object_type,
    object_key,
    title,
    payload_json,
    confidence,
    status,
    evidence,
  }) => {
    if (!object_type || !object_key || !title) return null;
    const mapKey = `${object_type}:${object_key}`;
    if (objectByKey.has(mapKey)) {
      return objectByKey.get(mapKey);
    }
    const safeEvidence = uniqueBy(Array.isArray(evidence) ? evidence : [], (item) => [
      item.evidence_type || '',
      item.source_uri || '',
      item.source_ref || '',
      item.quote_text || '',
    ].join('::'));
    const finalObject = {
      object_type,
      object_key,
      title,
      confidence: Number.isFinite(Number(confidence)) ? Number(Number(confidence).toFixed(4)) : 0.6,
      status: status || (safeEvidence.length ? 'ready' : 'needs_review'),
      payload_json: {
        ...sharedMeta,
        ...(payload_json || {}),
      },
      evidence: safeEvidence,
    };
    objects.push(finalObject);
    objectByKey.set(mapKey, finalObject);
    return finalObject;
  };

  const addRelation = (from, relationType, to, metaJson) => {
    if (!from || !to || !relationType) return;
    relations.push({
      from_object_type: from.object_type,
      from_object_key: from.object_key,
      relation_type: relationType,
      to_object_type: to.object_type,
      to_object_key: to.object_key,
      meta_json: metaJson || {},
    });
  };

  const modules = Array.isArray(inventory.modules) ? inventory.modules : [];
  const services = Array.isArray(inventory.services) ? inventory.services : [];
  const controllers = Array.isArray(inventory.controllers) ? inventory.controllers : [];
  const repositories = Array.isArray(inventory.repositories) ? inventory.repositories : [];
  const entities = Array.isArray(inventory.entities) ? inventory.entities : [];
  const sqlTables = Array.isArray(inventory.sql_tables) ? inventory.sql_tables : [];
  const apiEndpoints = normalizeArray(inventory.api_endpoints);
  const tableNames = normalizeArray(inventory.tables);
  const testFiles = normalizeArray(inventory.test_files);
  const packageScripts = inventory.package_json && inventory.package_json.scripts && typeof inventory.package_json.scripts === 'object'
    ? inventory.package_json.scripts
    : {};

  const featureObjects = modules.map((moduleInfo) => addObject({
    object_type: 'feature',
    object_key: normalizeObjectKey(moduleInfo.name, `feature-${objects.length + 1}`),
    title: moduleInfo.name,
    confidence: 0.82,
    payload_json: {
      module_name: moduleInfo.name,
      file_count: Number(moduleInfo.file_count || 0),
      source_files: normalizeArray(moduleInfo.source_files),
      summary: moduleDigestMap.get(moduleInfo.name) || '',
    },
    evidence: normalizeArray(moduleInfo.source_files).slice(0, 6).map((sourceUri) => ({
      evidence_type: 'code',
      source_uri: sourceUri,
      source_ref: moduleInfo.name,
      source_commit_sha: repo.commit_sha,
      })),
  })).filter(Boolean);

  const dddDomainCards = buildDddDomainCards(inventory, moduleDigestMap, 6);
  const featureByModuleName = new Map(
    featureObjects.map((item) => [String(item.payload_json?.module_name || item.title || '').trim(), item]).filter((item) => item[0])
  );
  const domainContextObjects = dddDomainCards.map((card, index) => addObject({
    object_type: 'domain_context',
    object_key: normalizeObjectKey(card.domain_key, `domain-context-${index + 1}`),
    title: card.bounded_context_name,
    confidence: 0.78,
    payload_json: {
      domain_key: card.domain_key,
      domain_label: card.label,
      domain_tier: card.domain_tier,
      ubiquitous_language: card.ubiquitous_language,
      aggregates: card.aggregates,
      upstream_contexts: card.upstream_contexts,
      downstream_contexts: card.downstream_contexts,
      behaviors: card.behaviors.map((item) => ({
        behavior_key: item.behavior_key,
        title: item.title,
      })),
      source_files: uniqueStrings([
        ...(card.insight.related_controllers || []).map((item) => item.path),
        ...(card.insight.related_services || []).map((item) => item.path),
        ...(card.insight.related_repositories || []).map((item) => item.path),
      ]).slice(0, 12),
      source_symbols: uniqueStrings([
        ...(card.insight.related_services || []).map((item) => item.class_name),
        ...(card.insight.related_entities || []).map((item) => item.class_name || item.table_name),
      ]).slice(0, 12),
    },
    evidence: uniqueStrings([
      ...(card.insight.related_controllers || []).map((item) => item.path),
      ...(card.insight.related_services || []).map((item) => item.path),
      ...(card.insight.related_repositories || []).map((item) => item.path),
      ...(card.insight.related_tables || []).map((item) => item.path),
    ]).slice(0, 10).map((sourceUri) => ({
      evidence_type: 'domain_context',
      source_uri: sourceUri,
      source_ref: card.label,
      source_commit_sha: repo.commit_sha,
    })),
  })).filter(Boolean);

  const subdomainObjects = dddDomainCards.map((card, index) => addObject({
    object_type: 'subdomain',
    object_key: normalizeObjectKey(`${card.domain_key}-${card.domain_tier}`, `subdomain-${index + 1}`),
    title: `${card.label} ${card.domain_tier === 'core' ? '核心子域' : card.domain_tier === 'generic' ? '通用子域' : '支撑子域'}`,
    confidence: 0.72,
    payload_json: {
      domain_key: card.domain_key,
      subdomain_type: card.domain_tier,
      source_files: uniqueStrings((card.insight.related_services || []).map((item) => item.path)).slice(0, 8),
      source_symbols: uniqueStrings((card.insight.related_services || []).map((item) => item.class_name)).slice(0, 8),
    },
    evidence: uniqueStrings((card.insight.related_services || []).map((item) => item.path)).slice(0, 6).map((sourceUri) => ({
      evidence_type: 'subdomain',
      source_uri: sourceUri,
      source_ref: card.label,
      source_commit_sha: repo.commit_sha,
    })),
  })).filter(Boolean);

  const aggregateObjects = [];
  const behaviorObjects = [];
  const commandObjects = [];
  const domainEventObjects = [];
  dddDomainCards.forEach((card, cardIndex) => {
    const domainContext = domainContextObjects[cardIndex];
    const subdomain = subdomainObjects[cardIndex];
    if (domainContext && subdomain) {
      addRelation(domainContext, 'contains_subdomain', subdomain, { source: 'ddd_domain_model' });
    }
    card.aggregates.forEach((aggregateName, aggregateIndex) => {
      const aggregateObject = addObject({
        object_type: 'aggregate',
        object_key: normalizeObjectKey(`${card.domain_key}-${aggregateName}`, `aggregate-${cardIndex + 1}-${aggregateIndex + 1}`),
        title: aggregateName,
        confidence: 0.7,
        payload_json: {
          domain_key: card.domain_key,
          domain_label: card.label,
          source_tables: (card.insight.related_tables || []).map((item) => item.table_name).filter(Boolean).slice(0, 6),
          source_files: uniqueStrings([
            ...(card.insight.related_entities || []).map((item) => item.path),
            ...(card.insight.related_tables || []).map((item) => item.path),
          ]).slice(0, 8),
          source_symbols: uniqueStrings((card.insight.related_entities || []).map((item) => item.class_name || item.table_name)).slice(0, 8),
        },
        evidence: uniqueStrings([
          ...(card.insight.related_entities || []).map((item) => item.path),
          ...(card.insight.related_tables || []).map((item) => item.path),
        ]).slice(0, 6).map((sourceUri) => ({
          evidence_type: 'aggregate',
          source_uri: sourceUri,
          source_ref: aggregateName,
          source_commit_sha: repo.commit_sha,
        })),
      });
      if (aggregateObject) {
        aggregateObjects.push(aggregateObject);
        if (domainContext) {
          addRelation(domainContext, 'owns_aggregate', aggregateObject, { source: 'ddd_domain_model' });
        }
      }
    });
    card.behaviors.forEach((behavior, behaviorIndex) => {
      const behaviorObject = addObject({
        object_type: 'domain_behavior',
        object_key: normalizeObjectKey(behavior.behavior_key, `domain-behavior-${cardIndex + 1}-${behaviorIndex + 1}`),
        title: behavior.title,
        confidence: 0.74,
        payload_json: {
          domain_key: card.domain_key,
          description: behavior.description,
          source_apis: behavior.api_endpoints,
          source_tables: behavior.tables,
          source_files: behavior.evidence_files,
          source_symbols: uniqueStrings([...behavior.services, ...behavior.objects]).slice(0, 12),
          aggregate_name: behavior.aggregate_name,
          command_name: behavior.command_name,
          event_name: behavior.event_name,
        },
        evidence: behavior.evidence_files.slice(0, 8).map((sourceUri) => ({
          evidence_type: 'behavior',
          source_uri: sourceUri,
          source_ref: behavior.title,
          source_commit_sha: repo.commit_sha,
        })),
      });
      const commandObject = addObject({
        object_type: 'command',
        object_key: normalizeObjectKey(behavior.command_key, `command-${cardIndex + 1}-${behaviorIndex + 1}`),
        title: behavior.command_name,
        confidence: 0.68,
        payload_json: {
          domain_key: card.domain_key,
          source_apis: behavior.api_endpoints,
          source_files: behavior.evidence_files,
          source_symbols: behavior.services,
        },
        evidence: behavior.evidence_files.slice(0, 6).map((sourceUri) => ({
          evidence_type: 'command',
          source_uri: sourceUri,
          source_ref: behavior.command_name,
          source_commit_sha: repo.commit_sha,
        })),
      });
      const domainEventObject = addObject({
        object_type: 'domain_event',
        object_key: normalizeObjectKey(behavior.event_key, `event-${cardIndex + 1}-${behaviorIndex + 1}`),
        title: behavior.event_name,
        confidence: 0.64,
        payload_json: {
          domain_key: card.domain_key,
          source_files: behavior.evidence_files,
          source_tables: behavior.tables,
          source_symbols: behavior.objects,
        },
        evidence: behavior.evidence_files.slice(0, 6).map((sourceUri) => ({
          evidence_type: 'domain_event',
          source_uri: sourceUri,
          source_ref: behavior.event_name,
          source_commit_sha: repo.commit_sha,
        })),
      });
      if (behaviorObject) {
        behaviorObjects.push(behaviorObject);
        if (domainContext) {
          addRelation(domainContext, 'owns_behavior', behaviorObject, { source: 'ddd_domain_model' });
        }
      }
      if (commandObject && behaviorObject) {
        commandObjects.push(commandObject);
        addRelation(commandObject, 'triggers_behavior', behaviorObject, { source: 'ddd_domain_model' });
      }
      if (domainEventObject && behaviorObject) {
        domainEventObjects.push(domainEventObject);
        addRelation(behaviorObject, 'emits_event', domainEventObject, { source: 'ddd_domain_model' });
      }
      if (behaviorObject) {
        const aggregateObject = aggregateObjects.find((item) => normalizeObjectKey(`${card.domain_key}-${behavior.aggregate_name}`, '') === item.object_key);
        if (aggregateObject) {
          addRelation(behaviorObject, 'acts_on_aggregate', aggregateObject, { source: 'ddd_domain_model' });
        }
      }
    });
    modules.forEach((moduleInfo) => {
      const featureObject = featureByModuleName.get(String(moduleInfo.name || '').trim());
      if (!featureObject || !domainContext) return;
      if (inferModuleFacetKeys(moduleInfo, 3).includes(card.bucket?.key)) {
        addRelation(featureObject, 'belongs_to_context', domainContext, { source: 'module_facet_match' });
      }
    });
  });

  const serviceCandidates = services.length
    ? services
    : modules.map((moduleInfo) => ({
        path: normalizeArray(moduleInfo.source_files)[0] || '',
        class_name: `${moduleInfo.name}Service`,
        module_name: moduleInfo.name,
        source_files: normalizeArray(moduleInfo.source_files),
      }));

  const serviceObjects = serviceCandidates.map((serviceInfo, index) => {
    const moduleName = String(serviceInfo.module_name || '').trim();
    const sourceFiles = normalizeArray(serviceInfo.source_files).length
      ? normalizeArray(serviceInfo.source_files)
      : normalizeArray([serviceInfo.path]);
    const title = String(serviceInfo.class_name || moduleName || `service-${index + 1}`).trim();
    return addObject({
      object_type: 'service',
      object_key: normalizeObjectKey(title, `service-${index + 1}`),
      title,
      confidence: services.length ? 0.92 : 0.68,
      payload_json: {
        module_name: moduleName || null,
        source_files: sourceFiles,
        source_symbols: normalizeArray([serviceInfo.class_name]),
        related_repositories: repositories
          .filter((item) => sourceFiles.some((file) => String(item.path || '').startsWith(file.split('/')[0] || '')))
          .map((item) => item.class_name)
          .filter(Boolean),
      },
      evidence: sourceFiles.slice(0, 6).map((sourceUri) => ({
        evidence_type: 'code',
        source_uri: sourceUri,
        source_ref: title,
        source_commit_sha: repo.commit_sha,
      })),
    });
  }).filter(Boolean);

  const apiObjects = apiEndpoints.map((endpoint, index) => {
    const matchedController = controllers.find((item) => Array.isArray(item.endpoints) && item.endpoints.includes(endpoint));
    return addObject({
      object_type: 'api',
      object_key: normalizeObjectKey(endpoint.replace(/\s+/g, '-'), `api-${index + 1}`),
      title: endpoint,
      confidence: 0.94,
      payload_json: {
        endpoint,
        source_files: normalizeArray([matchedController?.path]),
        source_symbols: normalizeArray([matchedController?.class_name]),
        source_apis: [endpoint],
      },
      evidence: [{
        evidence_type: 'api',
        source_uri: matchedController?.path || normalizeArray(inventory.api_files)[0] || 'inventory.api_endpoints',
        source_ref: endpoint,
        source_commit_sha: repo.commit_sha,
      }],
    });
  }).filter(Boolean);

  const tableObjects = tableNames.map((tableName, index) => {
    const matchedSql = sqlTables.find((item) => item.table_name === tableName);
    const matchedEntity = entities.find((item) => item.table_name === tableName);
    return addObject({
      object_type: 'table',
      object_key: normalizeObjectKey(tableName, `table-${index + 1}`),
      title: tableName,
      confidence: 0.93,
      payload_json: {
        table_name: tableName,
        source_files: normalizeArray([matchedSql?.path, matchedEntity?.path]),
        source_tables: [tableName],
        source_symbols: normalizeArray([matchedEntity?.class_name]),
      },
      evidence: uniqueBy(
        [
          matchedSql ? {
            evidence_type: 'ddl',
            source_uri: matchedSql.path,
            source_ref: tableName,
            source_commit_sha: repo.commit_sha,
          } : null,
          matchedEntity ? {
            evidence_type: 'entity',
            source_uri: matchedEntity.path,
            source_ref: matchedEntity.class_name || tableName,
            source_commit_sha: repo.commit_sha,
          } : null,
        ].filter(Boolean),
        (item) => `${item.evidence_type}:${item.source_uri}:${item.source_ref}`
      ),
    });
  }).filter(Boolean);

  const testAssetCandidates = testFiles.length
    ? testFiles.map((item) => ({
        source_uri: item,
        title: path.basename(item),
        source_ref: item,
        confidence: 0.9,
        evidence_type: 'test',
      }))
    : Object.entries(packageScripts)
        .filter(([key]) => /test|spec/i.test(key))
        .map(([key, value]) => ({
          source_uri: 'package.json',
          title: key,
          source_ref: String(value || '').trim(),
          confidence: 0.72,
          evidence_type: 'manifest',
        }));

  const testAssetObjects = testAssetCandidates.map((testAsset, index) => addObject({
    object_type: 'test_asset',
    object_key: normalizeObjectKey(testAsset.title, `test-asset-${index + 1}`),
    title: testAsset.title,
    confidence: testAsset.confidence,
    payload_json: {
      source_files: normalizeArray([testAsset.source_uri]),
      command: testAsset.source_uri === 'package.json' ? testAsset.source_ref : null,
    },
    evidence: [{
      evidence_type: testAsset.evidence_type,
      source_uri: testAsset.source_uri,
      source_ref: testAsset.source_ref,
      source_commit_sha: repo.commit_sha,
      quote_text: testAsset.source_uri === 'package.json' ? testAsset.source_ref : '',
    }],
  })).filter(Boolean);

  featureObjects.forEach((featureObject, index) => {
    const featureSourceFiles = normalizeArray(featureObject.payload_json?.source_files);
    const matchedService = serviceObjects.find((serviceObject) => {
      const serviceSourceFiles = normalizeArray(serviceObject.payload_json?.source_files);
      return featureSourceFiles.some((file) => serviceSourceFiles.some((candidate) => candidate && file.startsWith(candidate.split('/')[0] || candidate)));
    }) || serviceObjects[index % Math.max(serviceObjects.length, 1)];
    if (matchedService) {
      addRelation(featureObject, 'depends_on_service', matchedService, { source: 'module_service_overlap' });
    }
  });

  serviceObjects.forEach((serviceObject, index) => {
    const serviceSourceFiles = normalizeArray(serviceObject.payload_json?.source_files);
    const matchingApis = apiObjects.filter((apiObject) => {
      const apiSourceFiles = normalizeArray(apiObject.payload_json?.source_files);
      return apiSourceFiles.some((file) => serviceSourceFiles.some((sourceFile) => file && sourceFile && file.startsWith(sourceFile.split('/')[0] || sourceFile)));
    });
    (matchingApis.length ? matchingApis : [apiObjects[index % Math.max(apiObjects.length, 1)]])
      .filter(Boolean)
      .forEach((apiObject) => {
        addRelation(serviceObject, 'owns_api', apiObject, {
          source: matchingApis.length ? 'controller_match' : 'fallback_index',
        });
      });

    const matchingTables = tableObjects.filter((tableObject) => {
      const tableSourceFiles = normalizeArray(tableObject.payload_json?.source_files);
      return tableSourceFiles.some((file) => serviceSourceFiles.some((sourceFile) => file && sourceFile && file.startsWith(sourceFile.split('/')[0] || sourceFile)));
    });
    (matchingTables.length ? matchingTables : [tableObjects[index % Math.max(tableObjects.length, 1)]])
      .filter(Boolean)
      .forEach((tableObject) => {
        addRelation(serviceObject, 'reads_or_writes_table', tableObject, {
          source: matchingTables.length ? 'entity_repository_match' : 'fallback_index',
        });
      });
  });

  apiObjects.forEach((apiObject, index) => {
    const endpoint = String(apiObject.payload_json?.endpoint || apiObject.title || '').toLowerCase();
    const matchingTests = testAssetObjects.filter((testObject) => {
      const refs = normalizeArray([
        testObject.title,
        ...normalizeArray(testObject.payload_json?.source_files),
      ]).join(' ').toLowerCase();
      const segments = endpoint.split(/[\/\s-]+/).filter(Boolean);
      return segments.some((segment) => segment.length >= 3 && refs.includes(segment));
    });
    (matchingTests.length ? matchingTests : [testAssetObjects[index % Math.max(testAssetObjects.length, 1)]])
      .filter(Boolean)
      .forEach((testObject) => {
        addRelation(apiObject, 'covered_by_test', testObject, {
          source: matchingTests.length ? 'name_match' : 'fallback_index',
        });
      });
  });

  dddDomainCards.forEach((card) => {
    const domainContext = objectByKey.get(`domain_context:${normalizeObjectKey(card.domain_key, '')}`);
    if (!domainContext) return;
    (card.upstream_contexts || []).forEach((item) => {
      const upstream = objectByKey.get(`domain_context:${normalizeObjectKey(item.domain_key, '')}`);
      if (upstream) {
        addRelation(domainContext, 'upstream_of', upstream, {
          source: 'ddd_context_overlap',
          overlap_count: item.overlap_count || 0,
        });
      }
    });
    (card.downstream_contexts || []).forEach((item) => {
      const downstream = objectByKey.get(`domain_context:${normalizeObjectKey(item.domain_key, '')}`);
      if (downstream) {
        addRelation(domainContext, 'downstream_of', downstream, {
          source: 'ddd_context_overlap',
          overlap_count: item.overlap_count || 0,
        });
      }
    });
  });

  const pageObjectKeys = {};
  const objectEntries = Array.from(objectByKey.values());
  (Array.isArray(pages) ? pages : []).forEach((page) => {
    const pageMeta = page && typeof page.metadata_json === 'object' && page.metadata_json ? page.metadata_json : page || {};
    const sourceFiles = normalizeArray(page.source_files || pageMeta.source_files);
    const sourceApis = normalizeArray(page.source_apis || pageMeta.source_apis);
    const sourceTables = normalizeArray(page.source_tables || pageMeta.source_tables);
    const sourceSymbols = normalizeArray(page.source_symbols || pageMeta.source_symbols);
    const matchingKeys = objectEntries
      .filter((item) => {
        const payload = item.payload_json || {};
        const objectFiles = normalizeArray(payload.source_files);
        const objectApis = normalizeArray(payload.source_apis);
        const objectTables = normalizeArray(payload.source_tables);
        const objectSymbols = normalizeArray(payload.source_symbols);
        if (page.page_type === 'overview') return true;
        if (page.page_type && String(page.page_type).includes('architecture')) {
          return ['service', 'feature', 'table', 'api'].includes(item.object_type);
        }
        return (
          sourceFiles.some((file) => objectFiles.includes(file)) ||
          sourceApis.some((api) => objectApis.includes(api)) ||
          sourceTables.some((table) => objectTables.includes(table)) ||
          sourceSymbols.some((symbol) => objectSymbols.includes(symbol))
        );
      })
      .slice(0, 24)
      .map((item) => `${item.object_type}:${item.object_key}`);
    pageObjectKeys[page.page_slug] = matchingKeys;
  });

  return {
    objects,
    relations: uniqueBy(relations, (item) => [
      item.from_object_type,
      item.from_object_key,
      item.relation_type,
      item.to_object_type,
      item.to_object_key,
    ].join('::')),
    page_object_keys: pageObjectKeys,
  };
}

const buildDeepWikiPages = createBuildDeepWikiPages({
  summarizeResearchReport,
  pickSynthesizedDiagram,
  buildOverviewDiagram,
  buildCodeLayeredArchitectureDiagram,
  buildSystemArchitectureDiagram,
  buildProductArchitectureDiagram,
  buildBusinessDomainDiagram,
  buildCoreFlowDiagram,
  buildModuleFlowDiagram,
  buildSequenceDiagram,
  buildErDiagram,
  buildDddDomainCards,
  buildModuleInsight,
  findDomainCardsForModule,
  extractDigestLead,
  isLowValueDigestLead,
  inferModuleFacetKeys,
  facetLabelForKey,
  summarizeEvidenceAppendix,
  toMarkdownList,
  buildMermaidBlock,
  moduleDisplayName,
  slugifySegment,
  uniqueStrings,
  inferSqlTableRelations,
});

module.exports = {
  slugifySegment,
  sanitizePathSegment,
  normalizeRepoUrl,
  deriveRepoSlug,
  normalizeBranchName,
  preflightRepository,
  prepareRepositorySnapshot,
  collectRepositoryInventory,
  collectProjectManifestInventory,
  buildRepositoryContext,
  buildModuleDigestPrompt,
  buildDeepWikiPages,
  buildDeepWikiKnowledgeGraph,
  buildDeepWikiPageFilePath,
  buildContextStructuredDiagram,
};
