#!/usr/bin/env node
/**
 * 销售订单样板：文档包创建 → 上传四类工件 → 触发 doc-pipeline-v1 标准管道。
 * 用法：在 ai-platform 目录 CONTROL_PLANE_URL=http://127.0.0.1:3003 node scripts/e2e-sales-order-doc-gates.mjs
 *
 * 依赖：control-plane 已启动且已执行 migrations 009/010；若未配置 DOC_GATE_API_KEY，Prompt 门禁可能返回降级结果但仍应落库。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FIX = path.join(ROOT, 'fixtures', 'sales-order-e2e');
const BASE = process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:3003';

async function jfetch(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!r.ok) {
    throw new Error(`${method} ${url} -> ${r.status} ${text.slice(0, 500)}`);
  }
  return data;
}

function readFixture(name) {
  return fs.readFileSync(path.join(FIX, name), 'utf8');
}

async function main() {
  console.log(`Control plane: ${BASE}`);
  const bundleBody = {
    bundle_code: `E2E-SO-${Date.now()}`,
    title: '销售订单 E2E 文档门禁',
    module_name: '销售订单',
    project_code: process.env.E2E_PROJECT_CODE || 'C04',
    version_label: 'E2E-1.0',
    created_by: 'e2e-sales-order-doc-gates',
  };
  const created = await jfetch('POST', `${BASE}/api/v1/doc-bundles`, bundleBody);
  const bundle = created.data;
  const bundleId = bundle.id;
  console.log('Created bundle', bundle.bundle_code, 'trace', bundle.trace_id, 'id', bundleId);

  const uploads = [
    ['prd.md', 'prd', 'PRD'],
    ['tech_spec.md', 'tech_spec', '技术方案'],
    ['api_contract.md', 'api_contract', '接口契约'],
    ['ddl.md', 'ddl', 'DDL'],
  ];
  for (const [file, artifactType, title] of uploads) {
    const content_text = readFixture(file);
    await jfetch('POST', `${BASE}/api/v1/doc-bundles/${bundleId}/artifacts`, {
      artifact_type: artifactType,
      title,
      source_type: 'upload',
      content_text,
    });
    console.log('Uploaded artifact', artifactType);
  }

  const run = await jfetch('POST', `${BASE}/api/v1/runtime/pipelines/doc-pipeline-v1/runs`, {
    bundle_id: bundleId,
    project_code: bundle.project_code,
    trace_id: bundle.trace_id,
  });
  console.log('Triggered doc-pipeline-v1:', run.data?.pipeline_run_id, run.data?.trace_id);

  const detail = await jfetch('GET', `${BASE}/api/v1/doc-bundles/${bundleId}`);
  console.log('Bundle gates count:', detail.data?.gates?.length);
  console.log('Done. 在管理台「文档门禁」选择任务', bundle.bundle_code, '或使用 trace', bundle.trace_id, '在「运行编排」手动加载查看。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
