'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildEnforcerContext,
  validateCitation,
  enforceCitations,
  enforceSlot,
  formatCitationString,
} = require('../src/deepwiki/citation-enforcer');

test('validateCitation accepts a well-formed citation when path is allowlisted', () => {
  const ctx = buildEnforcerContext({
    allowedPaths: ['src/Foo.java'],
    mode: 'lenient',
  });
  const result = validateCitation(
    { path: 'src/Foo.java', line_start: 10, line_end: 20 },
    ctx,
  );
  assert.equal(result.valid, true);
  assert.equal(result.severity, 'ok');
  assert.deepEqual(result.citation, { path: 'src/Foo.java', line_start: 10, line_end: 20 });
});

test('validateCitation rejects a citation missing path', () => {
  const ctx = buildEnforcerContext({ allowedPaths: ['src/Foo.java'] });
  const result = validateCitation({ line_start: 1 }, ctx);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'missing_path');
});

test('validateCitation rejects an inverted line range regardless of mode', () => {
  const ctx = buildEnforcerContext({ allowedPaths: ['src/Foo.java'], mode: 'lenient' });
  const result = validateCitation(
    { path: 'src/Foo.java', line_start: 50, line_end: 10 },
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'line_range_inverted');
});

test('validateCitation downgrades path-not-in-allowlist in lenient mode', () => {
  const ctx = buildEnforcerContext({ allowedPaths: ['src/Foo.java'], mode: 'lenient' });
  const result = validateCitation(
    { path: 'src/Unknown.java', line_start: 1 },
    ctx,
  );
  assert.equal(result.valid, true);
  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'path_not_in_allowlist');
});

test('validateCitation rejects path-not-in-allowlist in strict mode', () => {
  const ctx = buildEnforcerContext({ allowedPaths: ['src/Foo.java'], mode: 'strict' });
  const result = validateCitation(
    { path: 'src/Unknown.java', line_start: 1 },
    ctx,
  );
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'path_not_in_allowlist');
});

test('validateCitation downgrades file-only citation to info in lenient mode', () => {
  const ctx = buildEnforcerContext({ allowedPaths: ['src/Foo.java'], mode: 'lenient' });
  const result = validateCitation({ path: 'src/Foo.java' }, ctx);
  assert.equal(result.valid, true);
  assert.equal(result.downgraded, true);
  assert.equal(result.reason, 'file_level_only');
});

test('enforceCitations partitions inputs correctly', () => {
  const ctx = buildEnforcerContext({
    allowedPaths: ['src/A.java', 'src/B.java'],
    mode: 'lenient',
  });
  const result = enforceCitations(
    [
      { path: 'src/A.java', line_start: 1, line_end: 3 },
      { path: 'src/Missing.java', line_start: 1 },
      { line_start: 7 }, // no path
      { path: 'src/B.java', line_start: 9, line_end: 5 }, // inverted
      { path: 'src/A.java' }, // file-level only
    ],
    ctx,
  );
  assert.equal(result.accepted.length, 3);
  assert.equal(result.rejected.length, 2);
  assert.ok(result.has_any_valid);
  assert.equal(result.downgraded.length, 2);
});

test('enforceSlot drops text in strict mode when no citations are valid', () => {
  const ctx = buildEnforcerContext({ allowedPaths: ['src/Foo.java'], mode: 'strict' });
  const result = enforceSlot({
    text: 'some generated text',
    citations: [{ path: 'src/Other.java', line_start: 5 }],
    minCitations: 1,
    ctx,
  });
  assert.equal(result.dropped, true);
  assert.equal(result.text, '');
});

test('enforceSlot keeps text in lenient mode even when citations are downgraded', () => {
  const ctx = buildEnforcerContext({ allowedPaths: ['src/Foo.java'], mode: 'lenient' });
  const result = enforceSlot({
    text: 'some generated text',
    citations: [{ path: 'src/Other.java', line_start: 5 }],
    minCitations: 1,
    ctx,
  });
  assert.equal(result.dropped, false);
  assert.equal(result.text, 'some generated text');
  assert.equal(result.accepted_citations.length, 1);
});

test('formatCitationString supports local and github styles', () => {
  const cite = { path: 'src/Foo.java', line_start: 12, line_end: 20 };
  assert.equal(formatCitationString(cite), 'src/Foo.java:L12-L20');
  assert.equal(formatCitationString(cite, { style: 'github' }), 'src/Foo.java#L12-L20');
  assert.equal(formatCitationString({ path: 'src/Bar.java', line_start: 5 }), 'src/Bar.java:L5');
  assert.equal(formatCitationString({ path: 'src/Baz.java' }), 'src/Baz.java');
});
