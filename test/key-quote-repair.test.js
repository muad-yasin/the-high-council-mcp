// 3 Nov 2026 (owner's pick "Auto + handler tool": "punctuation fixes that keep every word in the same order"): one more automatic repair, a key whose opening quote is missing (B2, 29 Oct 2026, mimo-v2.6-pro's
// proposal-stage debate reply: `, stance": "merge"`, read as "no posts counted"), and a guard over every automatic repair: none may change a word (near-json.js repairAcceptance, the handler's own check, is the measure).
// Synthetic shapes built from the replies' structure (run output never enters the repo).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../src/chain.js';
import { repairAcceptance } from '../src/near-json.js';

// One assertion per test (C&C, units 4 to 8): each fails on its own on the tree without the repair (R-1a to R-1c, R-2a) or on the known-bad tree with a word-changing entry (R-2b).
test('R-1a a key whose opening quote is missing is read on the tolerant path (a debate reply\'s posts)', () => {
  assert.deepEqual(parseJson('{ "posts": [ { "on": "B-2", stance": "merge", "text": "B-2 and A-2 are the same part." } ] }'), { posts: [{ on: 'B-2', stance: 'merge', text: 'B-2 and A-2 are the same part.' }] });
});

test('R-1b a key whose opening quote is missing is read on the verdict path', () => {
  assert.deepEqual(parseJson('{"meets": true, criteria": [], "failures": []}', { verdict: true }), { meets: true, criteria: [], failures: [] });
});

test('R-1c only the key outside a string is repaired: a string value that holds the same characters (an escaped quote) is left as it is', () => {
  assert.deepEqual(parseJson('{"text": "a, word\\": b", stance": "merge"}'), { text: 'a, word": b', stance: 'merge' });
});

const SHAPES = [
  '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "x"},], "failures": []}',   // a trailing comma
  '{"failures": [{"criterion": "C1", "reason: the plan names no owner for step four"}]}',                                 // a key written inside its value's string
  '{"verdict_line": "The judge said "fine" and moved on.", "meets": true}',                                              // a stray quote inside a string
  '{"verdict_line": "line one\nline two", "meets": true}',                                                                // a raw line break inside a string
  '{"meets": false, "criteria": [{"criterion": "C1", "verdict": "FAILED", "evidence": "no owner"}]], "failures": []}',   // a closer with no opener
  '{ "posts": [ { "on": "B-2", stance": "merge", "text": "the same part" } ] }',                                         // a key that lost its opening quote
  '{"meets": true, "criteria": []}, "failures": [{"criterion": "C1", "problem": "p"}], "verdict_line": "v"}',            // an object closed too early (no repair may read it)
];

test('R-2a the list of automatic repairs is exported (for the guard below)', async () => {
  const { PARSE_REPAIRS } = await import('../src/chain.js');   // imported here, so a tree without the export fails this test alone, not the file
  assert.ok(Array.isArray(PARSE_REPAIRS) && PARSE_REPAIRS.length >= 6, 'PARSE_REPAIRS is an exported list');
});

test('R-2b guard: every automatic repair keeps every word in its place (the check a handler\'s repair must pass); a repair that changed a word fails here', async () => {
  const { PARSE_REPAIRS = [] } = await import('../src/chain.js');
  const offences = [];
  let changed = 0;
  for (const [i, repair] of PARSE_REPAIRS.entries()) for (const shape of SHAPES) {
    const out = repair(shape.trim());
    if (out === shape.trim()) continue;
    changed++;
    if (!repairAcceptance(shape, out).ok) offences.push(`repair ${i} changed a word of ${JSON.stringify(shape.slice(0, 60))}: ${JSON.stringify(out.slice(0, 80))}`);
  }
  assert.deepEqual({ offences, exercised: changed >= 6 }, { offences: [], exercised: true });
});
