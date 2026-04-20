'use strict';

const fs = require('node:fs');

const DEFAULT_MODE = process.env.DEEPWIKI_CITATION_MODE === 'strict' ? 'strict' : 'lenient';

function normalizePath(value) {
  if (!value && value !== 0) return '';
  return String(value).trim().replace(/^\.\//, '').replace(/\\/g, '/');
}

function normalizePositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const asNumber = Number(value);
  if (!Number.isFinite(asNumber)) return null;
  if (asNumber <= 0) return null;
  const asInt = Math.floor(asNumber);
  return asInt > 0 ? asInt : null;
}

function buildEnforcerContext(options = {}) {
  const allowedFiles = new Set();
  const lineCounts = new Map();

  if (Array.isArray(options.readableFiles)) {
    for (const entry of options.readableFiles) {
      if (typeof entry === 'string') {
        const normalized = normalizePath(entry);
        if (normalized) allowedFiles.add(normalized);
      } else if (entry && typeof entry === 'object') {
        const normalized = normalizePath(entry.path);
        if (normalized) {
          allowedFiles.add(normalized);
          if (Number.isFinite(entry.line_count) && entry.line_count > 0) {
            lineCounts.set(normalized, Math.floor(entry.line_count));
          } else if (entry.absolute_path && options.resolveLineCounts !== false) {
            const count = countLinesSafely(entry.absolute_path);
            if (count !== null) {
              lineCounts.set(normalized, count);
            }
          }
        }
      }
    }
  }

  if (Array.isArray(options.allowedPaths)) {
    for (const p of options.allowedPaths) {
      const normalized = normalizePath(p);
      if (normalized) allowedFiles.add(normalized);
    }
  }

  return {
    mode: options.mode === 'strict' ? 'strict' : DEFAULT_MODE,
    allowedFiles,
    lineCounts,
    pathValidation: options.pathValidation !== false,
    allowMissingLines: options.allowMissingLines !== false,
  };
}

function countLinesSafely(absolutePath) {
  try {
    if (!absolutePath) return null;
    const buf = fs.readFileSync(absolutePath, 'utf8');
    if (!buf) return 0;
    return buf.split(/\r?\n/).length;
  } catch (_err) {
    return null;
  }
}

function validateCitation(citation, ctx) {
  const context = ctx && typeof ctx === 'object' ? ctx : buildEnforcerContext({});
  if (!citation || typeof citation !== 'object') {
    return { valid: false, reason: 'missing_citation', severity: 'error' };
  }

  const rawPath = normalizePath(citation.path);
  if (!rawPath) {
    return { valid: false, reason: 'missing_path', severity: 'error' };
  }

  const lineStart = normalizePositiveInteger(citation.line_start);
  const lineEnd = normalizePositiveInteger(citation.line_end);

  if (lineStart !== null && lineEnd !== null && lineEnd < lineStart) {
    return {
      valid: false,
      reason: 'line_range_inverted',
      severity: 'error',
      citation: { path: rawPath, line_start: lineStart, line_end: lineEnd },
    };
  }

  if (context.pathValidation && context.allowedFiles.size > 0 && !context.allowedFiles.has(rawPath)) {
    if (context.mode === 'strict') {
      return { valid: false, reason: 'path_not_in_allowlist', severity: 'error', citation: { path: rawPath } };
    }
    return {
      valid: true,
      reason: 'path_not_in_allowlist',
      severity: 'warning',
      downgraded: true,
      citation: { path: rawPath, line_start: lineStart || undefined, line_end: lineEnd || undefined },
    };
  }

  const expectedLineCount = context.lineCounts.get(rawPath);
  if (expectedLineCount && lineStart && lineStart > expectedLineCount) {
    if (context.mode === 'strict') {
      return {
        valid: false,
        reason: 'line_out_of_range',
        severity: 'error',
        citation: { path: rawPath, line_start: lineStart, line_end: lineEnd || lineStart },
      };
    }
    return {
      valid: true,
      reason: 'line_out_of_range',
      severity: 'warning',
      downgraded: true,
      citation: { path: rawPath },
    };
  }

  if (lineStart === null) {
    if (!context.allowMissingLines && context.mode === 'strict') {
      return { valid: false, reason: 'missing_line_number', severity: 'error', citation: { path: rawPath } };
    }
    return {
      valid: true,
      reason: 'file_level_only',
      severity: 'info',
      downgraded: true,
      citation: { path: rawPath },
    };
  }

  return {
    valid: true,
    severity: 'ok',
    citation: {
      path: rawPath,
      line_start: lineStart,
      line_end: lineEnd && lineEnd >= lineStart ? lineEnd : lineStart,
    },
  };
}

function enforceCitations(citations, ctx) {
  const context = ctx && typeof ctx === 'object' ? ctx : buildEnforcerContext({});
  const accepted = [];
  const rejected = [];
  const downgraded = [];
  const findings = [];

  if (!Array.isArray(citations)) {
    return { accepted, rejected, downgraded, findings, has_any_valid: false };
  }

  for (const raw of citations) {
    const result = validateCitation(raw, context);
    findings.push(result);
    if (!result.valid) {
      rejected.push({ citation: raw, reason: result.reason, severity: result.severity });
      continue;
    }
    accepted.push(result.citation);
    if (result.downgraded) {
      downgraded.push({ citation: result.citation, reason: result.reason, severity: result.severity });
    }
  }

  return {
    accepted,
    rejected,
    downgraded,
    findings,
    has_any_valid: accepted.length > 0,
  };
}

function enforceSlot({ text, citations, minCitations = 1, ctx }) {
  const enforced = enforceCitations(citations, ctx);
  const requiredMin = Math.max(0, Number(minCitations) || 0);
  const hasEnoughCitations = enforced.accepted.length >= requiredMin;
  const mode = ctx && ctx.mode === 'strict' ? 'strict' : DEFAULT_MODE;
  const shouldDrop = mode === 'strict' && !hasEnoughCitations;
  return {
    text: shouldDrop ? '' : text,
    accepted_citations: enforced.accepted,
    downgraded_citations: enforced.downgraded,
    rejected_citations: enforced.rejected,
    findings: enforced.findings,
    dropped: shouldDrop,
    drop_reason: shouldDrop ? 'insufficient_valid_citations' : null,
    mode,
  };
}

function formatCitationString(citation, { style } = {}) {
  if (!citation || typeof citation !== 'object') return '';
  const p = normalizePath(citation.path);
  if (!p) return '';
  const ls = normalizePositiveInteger(citation.line_start);
  const le = normalizePositiveInteger(citation.line_end);
  const opener = style === 'github' ? '#L' : ':L';
  if (ls && le && le > ls) return `${p}${opener}${ls}-L${le}`;
  if (ls) return `${p}${opener}${ls}`;
  return p;
}

module.exports = {
  DEFAULT_MODE,
  buildEnforcerContext,
  validateCitation,
  enforceCitations,
  enforceSlot,
  formatCitationString,
  _internal: { normalizePath, normalizePositiveInteger, countLinesSafely },
};
