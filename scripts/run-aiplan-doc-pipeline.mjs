#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const WORKSPACE_ROOT = process.env.AIPLAN_WORKSPACE_ROOT || path.join(ROOT, '..');
const BASE = process.env.CONTROL_PLANE_URL || 'http://127.0.0.1:3104';
const DEEPWIKI_RUN_ID = Number(process.env.DEEPWIKI_RUN_ID || 3);

const SALES_DOCS = [
  {
    file: path.join(WORKSPACE_ROOT, 'projects/wiki/demo/销售订单详细PRD.md'),
    artifact_type: 'prd',
    title: '销售订单详细PRD',
  },
  {
    file: path.join(WORKSPACE_ROOT, 'projects/wiki/demo/销售订单技术方案.md'),
    artifact_type: 'tech_spec',
    title: '销售订单技术方案',
  },
  {
    file: path.join(WORKSPACE_ROOT, 'projects/wiki/demo/销售订单-接口契约-前后端.md'),
    artifact_type: 'api_contract',
    title: '销售订单接口契约',
  },
  {
    file: path.join(WORKSPACE_ROOT, 'projects/wiki/demo/销售订单-数据库DDL.md'),
    artifact_type: 'ddl',
    title: '销售订单数据库DDL',
  },
];

async function jfetch(method, url, body) {
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`${method} ${url} -> ${response.status} ${text.slice(0, 800)}`);
  }
  return payload;
}

function readMarkdown(targetPath) {
  return fs.readFileSync(targetPath, 'utf8');
}

function artifactByType(artifacts, artifactType) {
  return (artifacts || []).find((item) => item.artifact_type === artifactType) || null;
}

async function waitForDeepWikiCompleted(runId, timeoutMs = 20 * 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const payload = await jfetch('GET', `${BASE}/api/v1/deepwiki/runs/${runId}`);
    const run = payload.data;
    if (run?.status === 'completed') {
      return run;
    }
    if (run?.status === 'failed') {
      throw new Error(`Deep Wiki run ${runId} failed at stage ${run?.current_stage || 'unknown'}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Timed out waiting for Deep Wiki run ${runId} to complete`);
}

async function uploadSalesDocs(bundleId) {
  for (const doc of SALES_DOCS) {
    await jfetch('POST', `${BASE}/api/v1/doc-bundles/${bundleId}/artifacts`, {
      artifact_type: doc.artifact_type,
      title: doc.title,
      source_type: 'upload',
      content_text: readMarkdown(doc.file),
    });
  }
}

async function main() {
  console.log(`Control plane: ${BASE}`);
  console.log(`Deep Wiki run: ${DEEPWIKI_RUN_ID}`);
  const run = await waitForDeepWikiCompleted(DEEPWIKI_RUN_ID);
  console.log(`Deep Wiki completed: ${(run.repo_slug || run.repo_source?.repo_slug || 'unknown-repo')} @ ${(run.branch || run.snapshot?.branch || 'unknown-branch')}`);

  const created = await jfetch('POST', `${BASE}/api/v1/deepwiki/runs/${DEEPWIKI_RUN_ID}/doc-bundles`, {
    project_code: 'aiplan-erp-platform',
    workflow_mode: 'upload_existing',
    create_prd_artifact: false,
    title: 'aiplan-erp-platform 销售订单测试方案',
    module_name: '销售订单',
    version_label: 'sales-order-v1',
  });
  const bundle = created.data?.bundle || created.data;
  const bundleId = bundle.id;
  console.log(`Created bundle: ${bundle.bundle_code} (#${bundleId})`);

  await uploadSalesDocs(bundleId);
  console.log('Uploaded 4 sales-order artifacts');

  const started = await jfetch('POST', `${BASE}/api/v1/runtime/pipelines/doc-pipeline-v1/runs`, {
    bundle_id: bundleId,
    project_code: 'aiplan-erp-platform',
    trace_id: bundle.trace_id,
  });
  console.log(`Triggered doc pipeline: ${started.data?.pipeline_run_id || 'n/a'}`);

  const detail = await jfetch('GET', `${BASE}/api/v1/doc-bundles/${bundleId}`);
  const finalBundle = detail.data;
  const finalArtifact =
    artifactByType(finalBundle.artifacts, 'test_plan_final') ||
    artifactByType(finalBundle.artifacts, 'test_plan_ai_draft') ||
    artifactByType(finalBundle.artifacts, 'test_plan_draft');

  console.log(JSON.stringify({
    bundle_id: bundleId,
    bundle_code: finalBundle.bundle_code,
    status: finalBundle.status,
    current_stage: finalBundle.current_stage,
    blocking_gate: finalBundle.blocking_gate,
    latest_gate_results: (finalBundle.gates || []).slice(0, 6).map((gate) => ({
      gate_type: gate.gate_type,
      status: gate.status,
    })),
    final_test_plan_artifact_id: finalArtifact?.id || null,
    final_test_plan_download_url: finalArtifact
      ? `${BASE}/api/v1/doc-bundles/${bundleId}/artifacts/${finalArtifact.id}/download`
      : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
