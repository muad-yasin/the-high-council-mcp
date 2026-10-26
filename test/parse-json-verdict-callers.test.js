// test/parse-json-verdict-callers.test.js
//
// The reach of parseJson's `{ verdict: true }` hint (Review/Build_0.8.3/m6-closing/E_ParseJson_Decision_Table.md, "The hint's reach"): every parseJson call that feeds normaliseCritique - the
// blind and relay panel (reviewSeat), the round-robin critique, and their bigger-cap retries - must pass it. A verdict site WITHOUT the hint silently keeps the baseline fail-open (a sign-off the
// seat quoted from the draft standing in for its own verdict). parseJson's unit tests call it with the hint directly and would still pass if a call site lost it, so this scans the source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'chain.js'), 'utf8').split('\n');

test('every parseJson call that feeds normaliseCritique passes { verdict: true }', () => {
  // R1 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = sinks `normaliseCritique(parsed` (the panel sink read `parsed` until the notes lane, 0aaa6c3, split it with splitNotes) and a hint written exactly `{ verdict: true }`; new bar = the sink is `normaliseCritique(parsed` or `normaliseCritique(verdictPart` (verdictPart is splitNotes(parsed).verdictPart, of the SAME parsed value), and the hint may carry more keys after `verdict: true` (the envelope's `expect`). why = the rename moved the sink and the envelope added a key; the panel verdict reads still all pass the hint, and the count floors (>= 2 sinks, >= 4 reads) are unchanged.
  const sinks = src.map((l, i) => (/\bnormaliseCritique\((?:parsed|verdictPart)\b/.test(l) ? i : -1)).filter(i => i >= 0);
  assert.ok(sinks.length >= 2, `expected the panel and the round-robin sinks, found ${sinks.length}`);
  const verdictCalls = new Set();
  for (const sink of sinks) {
    // the parsed value is read within the same stage: look back to the previous sink or 200 lines
    if (/normaliseCritique\(verdictPart\b/.test(src[sink])) assert.ok(src.slice(Math.max(0, sink - 12), sink).some(l => /\{ verdictPart, notesReply \} = splitNotes\(parsed\)/.test(l)), `chain.js:${sink + 1}: verdictPart must come from splitNotes(parsed), the SAME parsed value the hint was given to`);
    const from = Math.max(0, sink - 200);
    const calls = [];
    for (let i = from; i < sink; i++) if (/\bparseJson\(/.test(src[i]) && !/export function parseJson/.test(src[i])) calls.push(i);
    assert.ok(calls.length >= 1, `no parseJson call found before the normaliseCritique at line ${sink + 1}`);
    for (const i of calls) {
      // only calls on a critic reply (cs.text) are verdict reads; other parseJson calls in the window (a blocking question's answer, a debate) are not
      if (!/parseJson\(cs\.text\b/.test(src[i])) continue;
      assert.match(src[i], /parseJson\(cs\.text, \{ verdict: true[,}\s]/, `chain.js:${i + 1} reads a critic reply for normaliseCritique without the verdict hint: ${src[i].trim()}`);
      verdictCalls.add(i);
    }
  }
  assert.ok(verdictCalls.size >= 4, `expected the four critic reads (panel, panel retry, round-robin, its retry), found ${verdictCalls.size}`);
});

// Amendment 2 (Astra's review, finding 3): the decision-bearing callers without a verdict polarity take `{ strict: true }`: the run's criteria (the stage and its two retries), preflight, the cold
// reader and the security review (which receives parseJson as a dependency, so chain.js hands it a strict one). A site that loses the option silently keeps the tolerant selection.
test('every decision-bearing caller passes { strict: true }', () => {
  const text = src.join('\n');
  assert.match(text, /const parsed = parseJson\(s\.text, \{ strict: true \}\);\s*\/\/ the criteria are the run's checker/, 'the criteria stage');
  assert.equal((text.match(/takeCriteria\(parseJson\(again\.text, \{ strict: true \}\)\?\.criteria\)/g) || []).length, 2, 'the two criteria retries');
  assert.match(text, /const parsed = parseJson\(s\.text, \{ strict: true \}\);\s*\/\/ Bug-audit fix, 2026-09-23 \(Review\/BugAudit_ChainParsers_2026-09-23\.md #6\)/, 'preflight');
  assert.match(text, /const parsed = parseJson\(cr\.text, \{ strict: true \}\);/, 'the cold reader');
  assert.match(text, /groundTruthPost: ground_truth_post, invoke, record, parseJson: t => parseJson\(t, \{ strict: true \}\)/, 'the security review');
});
