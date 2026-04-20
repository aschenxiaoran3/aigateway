/**
 * Dual-write: mirror pipeline outputRoot into repo docs/deepwiki/<commitSha>/
 */
const fs = require('fs');
const path = require('path');

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
}

function walkCopy(srcRoot, destRoot) {
  if (!fs.existsSync(srcRoot)) return;
  for (const name of fs.readdirSync(srcRoot)) {
    if (name === '.git') continue;
    const src = path.join(srcRoot, name);
    const dest = path.join(destRoot, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) {
      walkCopy(src, dest);
    } else {
      copyFile(src, dest);
    }
  }
}

/**
 * @param {{ localRepoPath: string, commitSha: string, outputRoot: string }} opts
 */
function dualWriteDeepWikiMarkdownBundle(opts) {
  const { localRepoPath, commitSha, outputRoot } = opts;
  if (!localRepoPath || !fs.existsSync(localRepoPath)) {
    return { ok: false, reason: 'missing_local_repo' };
  }
  if (!outputRoot || !fs.existsSync(outputRoot)) {
    return { ok: false, reason: 'missing_output_root' };
  }
  const sha = String(commitSha || 'unknown').trim() || 'unknown';
  const destRoot = path.join(localRepoPath, 'docs', 'deepwiki', sha);
  ensureDir(destRoot);
  walkCopy(outputRoot, destRoot);

  const readme = [
    '# DeepWiki 快照（自动生成）',
    '',
    `- **Commit**: \`${sha}\``,
    '- 本目录为 control-plane `output_root` 的镜像，含 `.md` / `.mmd` / `manifest.json` 与 **document-bundle**（PRD/技术方案/测试方案草案）。',
    '- Knowledge OS 规范：`ai-rules/skills/knowledge-os/`',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(destRoot, 'README.md'), readme, 'utf8');

  const latestReadme = path.join(localRepoPath, 'docs', 'deepwiki', 'README.md');
  ensureDir(path.dirname(latestReadme));
  fs.writeFileSync(
    latestReadme,
    [`# DeepWiki`, '', `最新快照目录: [${sha}](./${sha}/)`, ''].join('\n'),
    'utf8'
  );

  return { ok: true, destRoot };
}

module.exports = {
  dualWriteDeepWikiMarkdownBundle,
};
