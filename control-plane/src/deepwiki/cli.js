#!/usr/bin/env node
const { PipelineContext } = require('./core/context');
const { runPipeline } = require('./core/pipeline/engine');
const { STAGE_CONTRACTS, SKILL_CONTRACTS } = require('./contracts/contracts');

require('./stages/repo/run');
require('./stages/structure/run');
require('./stages/data/run');
require('./stages/semantic/run');
require('./stages/ddd/run');
require('./stages/evidence/run');
require('./stages/diagram/run');
require('./stages/wiki/run');
require('./stages/quality/run');
require('./stages/derivation/run');

function getOption(args, key) {
  const index = args.indexOf(key);
  if (index < 0 || index === args.length - 1) return '';
  return String(args[index + 1] || '').trim();
}

async function main(argv) {
  const args = argv.slice(2);
  const command = String(args[0] || '').trim();
  if (command === 'contracts') {
    process.stdout.write(`${JSON.stringify({ stages: STAGE_CONTRACTS, skills: SKILL_CONTRACTS }, null, 2)}\n`);
    return;
  }
  const configPath = getOption(args, '--config');
  if (!configPath) {
    throw new Error('Missing --config <path>');
  }
  const ctx = PipelineContext.fromConfigFile(configPath);
  if (command === 'scan') {
    await runPipeline(ctx, 'repo_understanding');
    process.stdout.write(`scan done: ${ctx.config.snapshotId}\n`);
    return;
  }
  if (command === 'build') {
    await runPipeline(ctx);
    process.stdout.write(`build done: status=${ctx.status}\n`);
    return;
  }
  if (command === 'audit') {
    process.stdout.write(`${JSON.stringify({
      quality: ctx.asset('quality_report'),
      gates: ctx.asset('gate_decisions'),
    }, null, 2)}\n`);
    return;
  }
  throw new Error(`Unknown command: ${command}`);
}

main(process.argv).catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
