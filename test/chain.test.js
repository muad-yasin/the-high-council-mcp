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
import { parseJson, classifyUnreadable } from '../src/chain.js';

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
