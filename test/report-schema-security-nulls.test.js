// BUG-D-025: the reviewer prompt asks for `"file": "path or null"` and a finding is kept when EITHER evidence or problem exists, but
// schemas/report-v1.json types file, evidence and problem as strings only (and a 0.8.0 type is never loosened: test/addon-rework.test.js).
// So the writer (src/security-review.js normaliseFinding) must leave a missing one out, not write null. Offline, $0, no run: the parsed
// security_review block is validated on its own, against the real schema's own definition of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { parseSecurityReview } from '../src/security-review.js';
import { abstentionReasonCode } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
// The security_review property of the published schema, taken as it stands (with the shared $defs in
// case it ever references one), so a change to the real schema changes this test's verdict.
const validateReview = ajv.compile({ $defs: schema.$defs, ...schema.properties.security_review });

const parse = findings => parseSecurityReview(JSON.stringify({ verdict: 'pass', findings }), { usage: { output: 50 }, maxTokens: 8000, parseJson: JSON.parse, abstentionReasonCode });
const review = parsed => ({ label: 'security-review', seat: 'mock/mock-security-block', lab: 'mock-security', gate: 'pass', ...parsed, blocking_count: 0 });

test('a reviewer finding with file: null and no problem is written without those keys, and the block validates against the schema', () => {
  const parsed = parse([{ severity: 'low', category: 'other', file: null, line: null, evidence: 'exec(userInput)' }]);
  const f = parsed.findings[0];
  assert.ok(!('file' in f) && !('problem' in f), JSON.stringify(f));
  assert.equal(f.evidence, 'exec(userInput)');
  assert.ok(validateReview(review(parsed)), JSON.stringify(validateReview.errors, null, 2));
});

test('a finding with a problem and no evidence is written without the evidence key, and validates', () => {
  const parsed = parse([{ severity: 'low', category: 'other', file: 'src/db.js', line: 42, problem: 'User input reaches a query.' }]);
  const f = parsed.findings[0];
  assert.ok(!('evidence' in f), JSON.stringify(f));
  assert.equal(f.file, 'src/db.js');
  assert.ok(validateReview(review(parsed)), JSON.stringify(validateReview.errors, null, 2));
});

test('the schema itself is unchanged by this fix: a null file is still rejected (a 0.8.0 type is never loosened)', () => {
  const bad = { severity: 'low', category: 'other', file: null, line: null, evidence: 'x' };
  assert.equal(validateReview(review({ seat_verdict: 'pass', reason_code: null, reason: null, findings: [bad], dropped_findings: 0 })), false);
});
