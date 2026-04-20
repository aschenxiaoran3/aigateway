const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const test = require('node:test');

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

test('resolveRuntimeSource prefers local absolute repo path without remote preflight', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-local-repo-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: tempRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'codex@example.com'], { cwd: tempRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Codex'], { cwd: tempRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(tempRoot, 'README.md'), '# temp repo\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: tempRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: tempRoot, stdio: 'ignore' });

  clearModule('../src/db/mysql');
  clearModule('../src/deepwiki/repository');
  clearModule('../src/harness/store');

  const store = require('../src/harness/store');
  const result = await store._test.resolveRuntimeSource({
    repo_url: tempRoot,
    repo_branch: '',
    deepwiki_run_id: null,
  });

  assert.equal(result.repo_url, tempRoot);
  assert.equal(result.repo_branch, 'main');
  assert.equal(result.source_path, tempRoot);
  assert.match(result.repo_key, /^local:/);
  assert.match(String(result.commit_sha_before || ''), /^[0-9a-f]{40}$/);
});

test('loadCardDetail returns consistent runtime and checkpoint projection', async () => {
  const fakeDb = {
    getPool() {
      return {
        execute(sql) {
          const text = String(sql);
          if (text.includes('FROM gateway_harness_cards')) {
            return [[{
              id: 8,
              card_code: 'REQ-2026-123456',
              title: 'Runtime projection check',
              card_type: '需求',
              priority: '高优先',
              stage_key: 'uat_wait',
              sub_status: 'waiting_uat',
              trace_id: 'trace-harness-abc',
              repo_url: '/tmp/demo',
              repo_slug: 'tmp-demo',
              repo_branch: 'main',
              deepwiki_run_id: 5,
              bundle_id: 9,
              summary_text: 'summary',
              latest_ai_action: '开发与单测完成，等待 UAT',
              latest_human_action: '已确认设计',
              blocked_reason: null,
              metadata_json: '{}',
              created_at: '2026-04-16 09:00:00',
              updated_at: '2026-04-16 09:10:00',
            }], []];
          }
          if (text.includes('FROM gateway_harness_messages')) {
            return [[
              {
                id: 1,
                actor: 'human',
                content_text: '需求已确认',
                created_at: '2026-04-16 09:01:00',
                tab_key: 'demand',
                status: null,
                stage_key: 'demand_confirm_wait',
              },
            ], []];
          }
          if (text.includes('FROM gateway_harness_logs')) {
            return [[
              {
                id: 2,
                runtime_run_id: 13,
                content_text: '工作区已准备',
                created_at: '2026-04-16 09:02:00',
                log_level: 'info',
                stage_key: 'development_coding',
              },
            ], []];
          }
          if (text.includes('FROM gateway_harness_summaries')) {
            return [[
              {
                id: 21,
                title: 'REQ-2026-123456 · AI Runtime 变更总结',
                content_text: 'runtime summary',
              },
            ], []];
          }
          if (text.includes('FROM gateway_harness_human_checkpoints')) {
            return [[
              {
                id: 34,
                checkpoint_type: 'uat_acceptance',
                stage_key: 'uat_wait',
                status: 'waiting',
                resume_token: 'cp-demo',
                payload_json: JSON.stringify({ runtime_run_id: 13, summary_artifact_id: 21 }),
                expires_at: '2026-04-20 09:00:00',
                created_at: '2026-04-16 09:05:00',
                updated_at: '2026-04-16 09:05:00',
              },
            ], []];
          }
          if (text.includes('FROM gateway_harness_human_prompts')) {
            return [[
              {
                id: 55,
                prompt_code: 'HP-TEST0001',
                source_type: 'harness_checkpoint',
                source_ref: 'card:8:checkpoint:uat_acceptance',
                card_id: 8,
                checkpoint_id: 34,
                checkpoint_type: 'uat_acceptance',
                status: 'pending',
                channel: 'feishu',
                question_text: '请给出 UAT 结论',
                instructions_text: '回复格式：HP-TEST0001 通过 [备注] 或 HP-TEST0001 打回 [备注]',
                prompt_payload_json: JSON.stringify({ resume_token: 'cp-demo' }),
                answer_text: null,
                answer_payload_json: '{}',
                answered_by: null,
                answered_at: null,
                expires_at: '2026-04-20 09:00:00',
                created_at: '2026-04-16 09:05:00',
                updated_at: '2026-04-16 09:05:00',
              },
            ], []];
          }
          if (text.includes('FROM gateway_harness_runtime_runs')) {
            return [[
              {
                id: 13,
                card_id: 8,
                trace_id: 'trace-runtime-13',
                status: 'completed',
                repo_key: 'local:tmp-demo',
                repo_url: '/tmp/demo',
                repo_branch: 'main',
                workspace_path: '/tmp/ai-harness-runtime/card-8/run-13',
                commit_sha_before: 'abc123',
                commit_sha_after: null,
                test_command: 'npm test',
                test_result: 'skipped',
                retry_count: 0,
                logs_json: JSON.stringify([{ type: 'stdout', content: 'ok' }]),
                summary_artifact_id: 21,
                metadata_json: JSON.stringify({ trigger: 'design_confirmation' }),
                created_at: '2026-04-16 09:04:00',
                updated_at: '2026-04-16 09:06:00',
              },
            ], []];
          }
          throw new Error(`Unexpected SQL in test: ${text}`);
        },
      };
    },
  };

  const fakeRepository = {
    preflightRepository: async () => {
      throw new Error('preflightRepository should not be called in loadCardDetail test');
    },
    prepareRepositorySnapshot: async () => {
      throw new Error('prepareRepositorySnapshot should not be called in loadCardDetail test');
    },
    deriveRepoSlug: (value) => String(value || '').replaceAll('/', '-'),
  };

  const dbPath = require.resolve('../src/db/mysql');
  const repositoryPath = require.resolve('../src/deepwiki/repository');
  const storePath = require.resolve('../src/harness/store');

  delete require.cache[storePath];
  require.cache[dbPath] = { exports: fakeDb };
  require.cache[repositoryPath] = { exports: fakeRepository };

  const store = require('../src/harness/store');
  const detail = await store._test.loadCardDetail(8);

  assert.equal(detail.stage_key, 'uat_wait');
  assert.equal(detail.active_checkpoint?.checkpoint_type, 'uat_acceptance');
  assert.equal(detail.active_checkpoint?.payload_json?.runtime_run_id, 13);
  assert.equal(detail.summary_artifact?.id, 21);
  assert.equal(detail.runtime_runs?.[0]?.id, 13);
  assert.equal(detail.runtime_runs?.[0]?.status, 'completed');
  assert.equal(detail.runtime_runs?.[0]?.test_result, 'skipped');
  assert.equal(detail.runtime_runs?.[0]?.summary_artifact_id, 21);
  assert.equal(detail.active_prompt?.prompt_code, 'HP-TEST0001');
  assert.equal(detail.active_prompt?.checkpoint_type, 'uat_acceptance');
});
