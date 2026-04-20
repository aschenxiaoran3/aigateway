function normalizeText(value) {
  return String(value || '').trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min = 0, max = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
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

function inferBusinessWeight(type, source) {
  const normalizedType = normalizeText(type).toLowerCase();
  const normalizedSource = normalizeText(source).toLowerCase();
  if (normalizedType === 'event') return 0.95;
  if (normalizedType === 'api') return 0.92;
  if (normalizedType === 'table') return 0.88;
  if (normalizedType === 'page') return 0.84;
  if (normalizedType === 'journey') return 0.86;
  if (/flow|journey|stream|submit|preview|feedback|settlement|inventory|order|bill|finance|warehouse|customer|product|category|session|chat/.test(normalizedSource)) {
    return 0.82;
  }
  return 0.64;
}

function inferCentrality(item) {
  const explicit = Number(item.centrality);
  if (Number.isFinite(explicit)) {
    return clamp(explicit);
  }
  const source = normalizeText(item.source || item.source_uri).toLowerCase();
  let score = 0.35;
  if (source.includes('/api/')) score += 0.25;
  if (source.includes('/views/')) score += 0.18;
  if (source.includes('/sql/')) score += 0.16;
  if (source.includes('/ai/')) score += 0.08;
  if (source.includes('/bill') || source.includes('/finance') || source.includes('/inventory')) score += 0.08;
  return clamp(score);
}

function inferApiLink(item) {
  const explicit = Number(item.apiLink || item.api_link);
  if (Number.isFinite(explicit)) {
    return clamp(explicit);
  }
  const source = normalizeText(item.source || item.source_uri).toLowerCase();
  const type = normalizeText(item.type || item.evidence_type).toLowerCase();
  let score = type === 'api' ? 1 : 0.28;
  if (source.includes('/api/')) score += 0.3;
  if (source.includes('/views/')) score += 0.12;
  if (source.includes('controller')) score += 0.14;
  if (source.includes('table') || source.includes('/sql/')) score += 0.1;
  return clamp(score);
}

function inferNoisePenalty(source) {
  const normalized = normalizeText(source).toLowerCase();
  if (/mock|fixture|sample|demo/.test(normalized)) return 0.2;
  if (/dto|entity|config|util|helper|mapper|vo\b/.test(normalized)) return 0.08;
  return 0;
}

function inferTestBoost(source) {
  const normalized = normalizeText(source).toLowerCase();
  // Mock / fixture / sample / demo stubs are still penalized via inferNoisePenalty.
  // Genuine tests (Given-When-Then test methods, spec files, integration tests)
  // are a high-signal source of business rules: invert the historical penalty
  // into a modest positive weight so business evidence anchored in tests is
  // surfaced rather than suppressed.
  // Exclude mock/fixture/sample/demo/stub paths from the boost, but allow
  // MockMvc integration tests (which happen to contain "mock" as a substring)
  // through — they are genuine tests and should still score.
  if (/mock|fixture|sample|demo|stub/.test(normalized) && !/mockmvc/.test(normalized)) return 0;
  return /\btest\b|\bspec\b|mockmvc|__tests__|itest|\.test\.|\.spec\.|\/tests?\//i.test(normalizeText(source)) ? 1 : 0;
}

function scoreEvidence(item, index) {
  const source = normalizeText(item.source || item.source_uri);
  const type = normalizeText(item.type || item.evidence_type).toLowerCase();
  const businessWeight = clamp(item.businessWeight ?? item.business_weight ?? inferBusinessWeight(type, source));
  const centrality = inferCentrality(item);
  const apiLink = inferApiLink(item);
  const diversityBoost = clamp(item.diversityBoost ?? item.diversity_boost ?? (type === 'event' || type === 'table' ? 0.1 : 0.04), 0, 0.2);
  const repoSpan = clamp(item.repoSpan ?? item.repo_span ?? (normalizeText(item.repoId || item.repo_id) ? 0.06 : 0), 0, 0.12);
  const testBoost = inferTestBoost(source);
  const noisePenalty = inferNoisePenalty(source);
  const freshnessDecay = clamp(index * 0.003, 0, 0.08);
  const finalScore = Number(
    (
      businessWeight * 0.4 +
      centrality * 0.2 +
      apiLink * 0.2 +
      diversityBoost +
      repoSpan +
      testBoost * 0.15 -
      noisePenalty -
      freshnessDecay
    ).toFixed(4)
  );
  return {
    ...item,
    type,
    source,
    finalScore,
    factors: {
      business_weight: businessWeight,
      centrality,
      api_link: apiLink,
      diversity_boost: diversityBoost,
      repo_span: repoSpan,
      test_boost: testBoost ? 0.15 : 0,
      test_penalty: 0, // kept for back-compat (runtime.js reads it); tests are no longer penalized.
      noise_penalty: noisePenalty ? -noisePenalty : 0,
      freshness_decay: freshnessDecay ? -freshnessDecay : 0,
    },
  };
}

function rankEvidence(evidence) {
  const deduped = uniqueBy(
    toArray(evidence).filter((item) => normalizeText(item && (item.source || item.source_uri))),
    (item) => `${normalizeText(item.type || item.evidence_type).toLowerCase()}:${normalizeText(item.repoId || item.repo_id)}:${normalizeText(item.source || item.source_uri)}`
  );
  return deduped
    .map((item, index) => scoreEvidence(item, index))
    .sort((a, b) => {
      const scoreDiff = Number(b.finalScore || 0) - Number(a.finalScore || 0);
      if (scoreDiff) return scoreDiff;
      return normalizeText(a.source).localeCompare(normalizeText(b.source));
    });
}

module.exports = {
  rankEvidence,
};
