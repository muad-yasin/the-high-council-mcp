// T1-10 (0.8.3 M6, Builder D; Batch 2 audit item 10): a policy file whose key was misspelt or whose value had the wrong type was not enforced and nothing said so (`{"max_usd_per_runs": 5}` let any spend through,
// `{"allowed_providers": "openrouter"}` admitted every provider, `{"refuse_unpriced_seats": "true"}` refused nothing, a top-level `[]`, `null`, `0` or `false` read as "no policy" because the callers test `if (policy)`).
// The rule now (C&C ruling 13 Oct 2026): a policy fails CLOSED. A top level that is not a JSON object is a load error (COUNCIL-E005, its own sentence); inside evaluatePolicy every unknown key and every wrong type is a
// REASON that names the key, so the run is refused on every path that evaluates a policy (the run, handoff, the advice send path, the gate answer). The one carve-out: a top-level key that starts with "$" or "_"
// (`$schema`, `_comment`) is metadata and is ignored; a misspelt policy key never starts with either. `advice_sensitivity_floor` is accepted as a key and its VALUE stays read by src/advice-tier.js (documented: a value
// that is not one of the three levels is read as confidential), so it is not type-checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadPolicy, evaluatePolicy, POLICY_CAPABILITIES } from '../src/policy.js';
import { formatCouncilError } from '../src/errors.js';

const made = [];
process.on('exit', () => { for (const d of made) { try { rmSync(d, { recursive: true, force: true }); } catch { /* a leftover is a nuisance */ } } });
const dirWith = content => { const d = mkdtempSync(join(tmpdir(), 'thc-policy-strict-')); made.push(d); if (content !== undefined) writeFileSync(join(d, 'policy.json'), content); return d; };
const CTX = { config: { name: 'c' }, allSeats: [{ provider: 'anthropic', model: 'm' }], worstCaseUsd: 1, maximumUsd: 2, monthToDateUsd: 0 };
const check = policy => evaluatePolicy(policy, CTX);
const KNOWN = [...Object.keys(POLICY_CAPABILITIES), 'advice_sensitivity_floor'];

test('PST-1 a misspelt key refuses and names the key and the known keys (the audit\'s max_usd_per_runs case)', () => {
  const r = check({ max_usd_per_runs: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 1);
  assert.match(r.reasons[0], /"max_usd_per_runs" is not a policy key/);
  for (const k of KNOWN) assert.ok(r.reasons[0].includes(k), `the reason lists ${k}`);
  assert.match(check({ allowed_provider: ['anthropic'] }).reasons[0], /"allowed_provider" is not a policy key/);
});

test('PST-2 a wrong type refuses and names the field: a string where a list belongs, a string for a boolean, a negative or non-finite number, a list holding a non-string', () => {
  const cases = [
    [{ allowed_providers: 'openrouter' }, /^allowed_providers: /],
    [{ allowed_regions: { eu: true } }, /^allowed_regions: /],
    [{ required_chain_tags: 'x' }, /^required_chain_tags: /],
    [{ required_signoff_paths: 'src/**' }, /^required_signoff_paths: /],
    [{ required_signoff_paths: ['src/**', 42] }, /^required_signoff_paths: every entry must be a non-empty glob string; got \[42\]/],   // the sentence policy.test.js already pins, now with or without a change request
    [{ required_signoff_paths: ['  '] }, /^required_signoff_paths: every entry must be a non-empty glob string/],
    [{ allowed_providers: ['anthropic', 7] }, /^allowed_providers: /],
    [{ refuse_unpriced_seats: 'true' }, /^refuse_unpriced_seats: /],
    [{ max_usd_per_run: '5' }, /^max_usd_per_run: /],
    [{ max_usd_per_run: -1 }, /^max_usd_per_run: /],
    [{ max_usd_per_run: 1e999 }, /^max_usd_per_run: /],   // JSON.parse('1e999') is Infinity: "no limit" by accident
    [{ max_usd_per_month: null }, /^max_usd_per_month: /],
  ];
  for (const [policy, re] of cases) {
    const r = check(policy);
    assert.equal(r.ok, false, JSON.stringify(policy));
    assert.match(r.reasons.join(' '), re, JSON.stringify(policy));
  }
});

test('PST-3 every problem is its own reason, in one pass (two mistakes = two reasons), and the other checks do not run on a refused file', () => {
  const r = check({ max_usd_per_runs: 5, allowed_providers: 'openrouter', required_chain_tags: ['never-matched'] });
  assert.equal(r.ok, false);
  assert.equal(r.reasons.length, 2, r.reasons.join(' | '));
  assert.ok(!r.reasons.some(x => x.startsWith('required_chain_tags:')), 'the file is refused on its shape first: the tag check did not run');
});

test('PST-4 the carve-out and the controls: "$"/"_" keys are ignored; {} and the full documented set are fine; advice_sensitivity_floor is accepted as a key whatever its value', () => {
  assert.equal(check({ $schema: 'https://example.invalid/policy.json', _comment: 'ours', _note: ['x'] }).ok, true);
  assert.equal(check({}).ok, true, 'a file with no fields is a real file that enforces nothing (docs/policy.md)');
  const full = { allowed_providers: ['anthropic'], allowed_regions: ['eu'], max_usd_per_run: 5, max_usd_per_month: 50, required_chain_tags: ['t'], refuse_unpriced_seats: true, required_signoff_paths: ['src/**'], advice_sensitivity_floor: 'confidential' };
  const r = check({ ...full, allowed_regions: ['eu'] });
  assert.ok(!r.reasons.some(x => /not a policy key|^[a-z_]+: must/.test(x)), r.reasons.join(' | '));
  for (const v of ['public', 'weird', 7, null]) assert.ok(!check({ advice_sensitivity_floor: v }).reasons.some(x => /advice_sensitivity_floor/.test(x)), `value ${JSON.stringify(v)} stays advice-tier.js's business`);
  assert.equal(check({ max_usd_per_run: 0 }).reasons.some(x => /^max_usd_per_run: must/.test(x)), false, 'zero is a number of dollars, zero or more');
});

test('PST-5 loadPolicy: a top level that is not an object is a load error, never "no policy" (null, 0, "", false, [], a string); an object loads; no file is still {policy:null,error:null}', () => {
  for (const content of ['[]', 'null', '0', '""', 'false', '"x"', '42', '[{"allowed_providers":["a"]}]']) {
    const r = loadPolicy(dirWith(content));
    assert.equal(r.policy, null, content);
    assert.match(String(r.error), /^the top level must be a JSON object, but the file holds /, content);
  }
  assert.deepEqual(loadPolicy(dirWith()), { policy: null, error: null });
  assert.deepEqual(loadPolicy(dirWith('{"max_usd_per_run": 5}')), { policy: { max_usd_per_run: 5 }, error: null });
  assert.match(loadPolicy(dirWith('{oops')).error, /JSON/, 'a syntax error is still the parser\'s message');
});

test('PST-6 COUNCIL-E005: a non-object top level reads as "valid JSON but not a policy"; a real syntax error keeps its sentence (policy.test.js pins it)', () => {
  const notObj = loadPolicy(dirWith('[]')).error;
  const text = formatCouncilError('COUNCIL-E005', { path: '/p/policy.json', parseError: notObj });
  assert.match(text, /valid JSON but not a policy/);
  assert.doesNotMatch(text, /isn't valid JSON/);
  assert.doesNotMatch(text, /Fix the JSON syntax/);
  const syntax = formatCouncilError('COUNCIL-E005', { path: '/p/policy.json', parseError: loadPolicy(dirWith('{oops')).error });
  assert.match(syntax, /isn't valid JSON/);
});

test('PST-7 a very long or hostile key name is shown quoted and cut (policy.json is project-writable text)', () => {
  const r = check({ ['k'.repeat(500) + '\u001b[31m']: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.reasons[0].length < 700, `reason is ${r.reasons[0].length} characters`);
  assert.ok(!r.reasons[0].includes('\u001b'), 'no raw escape character in the reason');
});
