// relay/test/chain.test.js
//
// Regression coverage for parseJson's repair pipeline (src/chain.js), added 2026-09-10 after a
// real, reproducible failure: three consecutive plan-cheap runs against the same real task all
// stopped at round 1 because Qwen3.5-9B's critique reply had an unescaped " inside a markdown-
// style 'single quoted' span (it quotes source phrases verbatim but doesn't escape a literal "
// that happens to land inside the quoted span). The old fallback silently logged "treating the
// round as a pass" while never actually marking it a pass - passed stayed false with no recorded
// reason. Fixtures below are trimmed real excerpts of the actual broken/fixed replies, not
// synthetic examples - see brand/HIGH_COUNCIL.md's sibling project (cnc-harness) DECISIONS.md,
// 2026-09-10, for the full incident.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseJson, parseDisputes, classifyUnreadable, runChain, criteriaUserPrompt } from '../src/chain.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mockConfig = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));

test('parseJson: stray unescaped quote inside a markdown-quoted span is repaired', () => {
  // Trimmed from a real Qwen3.5-9B reply (run 2026-09-10T20-02-20-992Z, critique-1.md) - the
  // inner "The Council," breaks a naive JSON.parse without the string-state-aware repair.
  const text = `{
  "meets": true,
  "criteria": [
    { "criterion": "c1", "verdict": "MET", "evidence": "Section 6 states: 'nothing else. No mention of "The Council," no round count, no per-model attribution, no objection record...'" }
  ],
  "failures": [],
  "verdict_line": "All good."
}`;
  const parsed = parseJson(text);
  assert.ok(parsed, 'expected the repair pipeline to recover valid JSON');
  assert.equal(parsed.meets, true);
  assert.equal(parsed.criteria.length, 1);
});

test('parseJson: raw newline inside a string value is repaired', () => {
  const text = `{
  "meets": false,
  "criteria": [],
  "failures": [{ "criterion": "c1", "problem": "line one
line two" }],
  "verdict_line": "v"
}`;
  const parsed = parseJson(text);
  assert.ok(parsed, 'expected the repair pipeline to recover valid JSON');
  assert.equal(parsed.failures[0].problem, 'line one\nline two');
});

test('parseJson: genuinely garbled model output still correctly fails (no false fix)', () => {
  // Trimmed from a real Qwen3.5-9B reply (run 2026-09-10T19-59-54-039Z, critique-1.md) - leaked
  // CSS-looking text and a stray semicolon, not a mechanically-fixable quoting slip. The repair
  // pipeline must not paper over genuinely nonsense content - returning null here is correct.
  const text = `{
  "meets": true,
  "criteria": [
    { "criterion": "c1", "verdict": "MET", "description": "css="font-size: 100%" font-family: 'Varta', sans-serif";
      "node:sqlite": "extra" }
  ]
}`;
  const parsed = parseJson(text);
  assert.equal(parsed, null, 'garbled content should not be silently "fixed" into something parseable');
});

test('parseJson: existing repairs (trailing comma, bare key) still work - no regression', () => {
  assert.ok(parseJson('{"a": 1, "b": [1, 2,],}'), 'trailing comma before ] or } should still repair');
  // Mistral Large, 2026-09-07: a key written as a bare "key: value" string instead of
  // "key": "value" - the pre-existing repair this test guards against regressing.
  const parsed = parseJson('{"reason: this explanation was written as one bare string"}');
  assert.ok(parsed, 'bare "key: value" string should still repair into a real key/value pair');
  assert.equal(parsed.reason, 'this explanation was written as one bare string');
});

test('parseJson: well-formed JSON parses unchanged, not mangled by the new repair', () => {
  const text = JSON.stringify({ meets: true, criteria: [{ criterion: 'c', verdict: 'MET', evidence: 'quoted "properly" already' }], failures: [] });
  const parsed = parseJson(text);
  assert.ok(parsed);
  assert.equal(parsed.criteria[0].evidence, 'quoted "properly" already');
});

test('parseJson: fenced JSON with a stray inner quote is still recovered', () => {
  const text = '```json\n{"meets": true, "note": "said \'it is "fine"\' apparently", "failures": []}\n```';
  const parsed = parseJson(text);
  assert.ok(parsed, 'expected fenced+repaired JSON to parse');
  assert.equal(parsed.meets, true);
});

// classifyUnreadable: added 2026-09-10 after GP judging run 2026-09-10T20-01-59-545Z
// (panel-1-glm.md) - GLM 5.3 Flash burned its entire token budget on thinking and returned an
// empty reply with finish_reason "error". The old two-way check (token cap vs. malformed JSON)
// labelled that "malformed JSON - read the saved reply, it may still be an objection", which is
// wrong on both counts: there's no reply to read, and it's not an objection. See src/chain.js.
test('classifyUnreadable: provider stop:"error" is its own category, not "malformed JSON"', () => {
  const why = classifyUnreadable({ output: 20, thinking: 20, stop: 'error' }, 8000);
  assert.match(why, /error/i);
  assert.doesNotMatch(why, /malformed JSON/);
});

test('classifyUnreadable: stop:"error" wins even when output also happens to be near the cap', () => {
  // A provider error can land at any output-token count, including one that would otherwise be
  // misread as "hit the token cap" - stop:"error" must take priority over the cap heuristic.
  const why = classifyUnreadable({ output: 7999, stop: 'error' }, 8000);
  assert.match(why, /error/i);
  assert.doesNotMatch(why, /hit the token cap/);
});

test('classifyUnreadable: near-cap output with no error still reads as truncation', () => {
  const why = classifyUnreadable({ output: 7999 }, 8000);
  assert.equal(why, 'hit the token cap, truncated');
});

test('classifyUnreadable: low output with no error still reads as a formatting problem', () => {
  const why = classifyUnreadable({ output: 8 }, 8000);
  assert.equal(why, 'malformed JSON - read the saved reply, it may still be an objection');
});

// v3 §4 (contract-vs-criteria fix, ~/Projects/relay/tasks/thcmcp-v3-draft-fixed.md). Real
// incident: across four runs, a criteria seat that never learned a chain's own required
// sections wrote a criterion forbidding one - a deadlock that cost rounds and, once, could not
// be resolved by any revision. The criteria seat now can't produce that conflict in the first
// place, because it's told what's required before it writes anything.
test('criteriaUserPrompt: a proposal-mode chain is told its required sections, so it cannot forbid one', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock-proposals.json'), 'utf8'));
  const prompt = criteriaUserPrompt('Do the thing.', config);
  assert.match(prompt, /# Sections this chain always adds/);
  assert.match(prompt, /Scope ledger/);
  assert.match(prompt, /Do not write a criterion that forbids this section's presence/);
});

test('criteriaUserPrompt: a chain with no required sections adds no block at all', () => {
  const config = JSON.parse(readFileSync(join(root, 'chains', 'mock.json'), 'utf8'));
  const prompt = criteriaUserPrompt('Do the thing.', config);
  assert.equal(prompt, '# Request\n\nDo the thing.');
  assert.doesNotMatch(prompt, /Sections this chain always adds/);
});

// §5 (v3 plan, MISTRAL-3 accepted): a reviser that declines an objection ends its reply with
// trailing "DECLINED: <reason>" lines (src/roles.js). Those lines must never reach the next
// round's draft and must be recorded separately, in order, in the run result's `disputes` array.
test('parseDisputes: strips trailing DECLINED lines from the draft and returns them in order', () => {
  const text = 'THE DELIVERABLE\n\nBody text.\n\nDECLINED: the critic quoted no evidence.\nDECLINED: this is a matter of taste, not a defect.';
  const { draft, disputes } = parseDisputes(text);
  assert.equal(draft, 'THE DELIVERABLE\n\nBody text.');
  assert.deepEqual(disputes, ['the critic quoted no evidence.', 'this is a matter of taste, not a defect.']);
});

test('parseDisputes: a reply with no DECLINED trailer is returned unchanged with an empty disputes array', () => {
  const text = 'THE DELIVERABLE\n\nBody text.';
  const { draft, disputes } = parseDisputes(text);
  assert.equal(draft, text);
  assert.deepEqual(disputes, []);
});

test('runChain: a fixture reviser reply ending in DECLINED lines is stripped from the draft and collected into result.disputes, in order (mock provider, mock.json revise stage)', async () => {
  const config = { ...mockConfig, signoff: undefined }; // non-panel path: mock.json's own critic/reviser cycle
  const result = await runChain({
    request: 'TRIGGER_DECLINED_TEST: write a short fixture deliverable.',
    config,
    log: () => {},
  });
  // The reviser's own DECLINED trailer must never survive into the deliverable a later critic
  // grades, or into any later round's draft.
  assert.doesNotMatch(result.deliverable, /DECLINED:/);
  assert.ok(Array.isArray(result.disputes) && result.disputes.length >= 1, 'expected at least one dispute to be recorded');
  assert.deepEqual(result.disputes.map(d => d.reason), [
    'the critic quoted no evidence for this claim.',
    'this is a matter of taste, not a defect.',
  ]);
  assert.ok(result.disputes.every(d => typeof d.round === 'number'));
});
