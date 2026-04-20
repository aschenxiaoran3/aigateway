const { evaluatePublishEligibility } = require('../snapshot-state-machine');

function evaluatePublishGate(input) {
  const qualityBlocked = Boolean(input && input.qualityBlocked);
  const hasEvidence = Boolean(input && input.hasEvidence);
  const evaluation = evaluatePublishEligibility(
    {
      status: String((input && input.status) || 'queued'),
      quality_gate_blocked: qualityBlocked || !hasEvidence,
      approval_status: (input && input.approval_status) || 'pending',
      lineage_json: (input && input.lineage_json) || {},
    },
    [
      {
        gate_key: qualityBlocked ? 'quality_gate_blocked' : hasEvidence ? 'publish_gate' : 'missing_evidence',
        decision_status: qualityBlocked || !hasEvidence ? 'blocked' : 'pass',
        is_blocking: qualityBlocked || !hasEvidence,
      },
    ]
  );
  return {
    publishReady: evaluation.publishReady,
    reason: qualityBlocked ? 'quality_gate_blocked' : hasEvidence ? 'ok' : 'missing_evidence',
    blockers: evaluation.blockers,
    qualityGateBlocked: evaluation.qualityGateBlocked,
  };
}

module.exports = {
  evaluatePublishGate,
};
