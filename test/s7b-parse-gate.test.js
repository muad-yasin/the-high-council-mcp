// 0.8.4 S7b, commit A3b (the parse gate): a `rulings` key counts as decision-bearing in the verdict reader ONLY for the two verdict reads of an ask that showed the S7b section (parseJson's option `rulingsDecide`, passed from reviewSeat's first ask and its cut-off retry).
// Held (the default, every other reader, every run without the section) the reading is exactly today's: two objects that differ only in `rulings` are one verdict, and a repeated `rulings` key is read last-wins. $0, offline.
// Rows S7B-6 (the gate, four of the reader's paths), S7B-7 (the option reaches exactly the two reviewSeat verdict reads), S7B-8 (PIN: the first-mode loop keeps a stray `rulings` key in report.lastCritique), S7B-9 (PIN: an unlayered unanimous run hears a seat whose two-object reply differs only in `rulings`).
// NOT DRIVEN (named): the duplicate-key calls inside the three span readers (chain.js 739, 836, 855) carry the same one-line option as the four paths driven here; they are covered by reading.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CH from '../src/chain.js';
import { runChain, setCache } from '../src/chain.js';

afterEach(() => setCache(null));
const here = dirname(fileURLToPath(import.meta.url));
const { parseJson } = CH;

const C = 'The plan defines a retry limit.';
const base = { meets: false, criteria: [{ criterion: C, verdict: 'FAILED', evidence: 'Missing.' }], failures: [{ criterion: C, problem: 'No retry limit is specified.' }], verdict_line: 'no' };
const rl = r => [{ id: 'abc', ruling: r, reason: 'x' }];
const E = { review_id: 'a1b2c3d4e5f6', draft_id: '0123456789ab' };
const obj = r => JSON.stringify({ ...base, rulings: rl(r) });
const objE = r => JSON.stringify({ ...E, ...base, rulings: rl(r) });
const LIVE = { verdict: true, rulingsDecide: true };
const HELD = { verdict: true };

test('S7B-6: held, a reply whose objects differ only in `rulings` reads as today; with the S7b section shown it is unreadable (four paths of the reader)', () => {
  const two = `${obj('overrule')}\n${obj('sustain')}`;                                                             // readSpans: two spans, one verdict
  const env = `${objE('overrule')}\n${objE('sustain')}`;                                                           // the envelope reader: two candidates that carry the pair
  const fenced = `\`\`\`json\n${obj('overrule')}\n\`\`\`\nand then ${obj('sustain')}`;                             // a fenced verdict checked against the rest of the reply
  const dup = '{"meets":false,"criteria":[{"criterion":"' + C + '","verdict":"FAILED","evidence":"Missing."}],"failures":[{"criterion":"' + C + '","problem":"No retry limit is specified."}],'
    + '"rulings":[{"id":"abc","ruling":"overrule","reason":"x"}],"rulings":[{"id":"abc","ruling":"sustain","reason":"x"}],"verdict_line":"no"}';   // one object, `rulings` twice
  assert.deepEqual(parseJson(two, HELD), JSON.parse(obj('overrule')), 'two spans, held: the first');
  assert.deepEqual(parseJson(env, { ...HELD, expect: E }), JSON.parse(objE('overrule')), 'envelope, held: the first candidate');
  assert.deepEqual(parseJson(fenced, HELD), JSON.parse(obj('overrule')), 'fence beside the rest, held: the fenced verdict');
  assert.deepEqual(parseJson(dup, HELD), JSON.parse(dup), 'a repeated key, held: last wins, as today');
  assert.equal(parseJson(two, LIVE), null, 'two spans, live');
  assert.equal(parseJson(env, { ...LIVE, expect: E }), null, 'envelope, live');
  assert.equal(parseJson(fenced, LIVE), null, 'fence beside the rest, live');
  assert.equal(parseJson(dup, LIVE), null, 'a repeated key, live');
  // control: identical rulings are one verdict in both states
  const same = `${obj('overrule')}\n${obj('overrule')}`;
  assert.deepEqual(parseJson(same, LIVE), JSON.parse(obj('overrule')), 'the same rulings twice stay readable live');
});

test('S7B-7: the option reaches exactly the two verdict reads of reviewSeat (the first ask and the cut-off retry), and no other reader', () => {
  const src = readFileSync(resolve(here, '../src/chain.js'), 'utf8').split('\n');
  const idx = src.map((l, i) => (/\bparseJson\(/.test(l) && /rulingsDecide/.test(l) && !/export function parseJson/.test(l) ? i : -1)).filter(i => i >= 0);
  assert.equal(idx.length, 2, `parseJson calls that carry rulingsDecide: ${idx.map(i => i + 1).join(', ')}`);
  for (const i of idx) assert.match(src[i], /parseJson\(cs\.text, \{ verdict: true, rulingsDecide: !!layerOneOpen\?\.ruling[,} ]/, `chain.js:${i + 1}`);
  assert.deepEqual(idx.map(i => src[i + 1].trim().replace(/;.*$/, '')), ['parsedLabel = lastCallLabel', 'parsedLabel = retryLabel'], 'the first ask, then its retry');
  assert.ok(src.some(l => /export function parseJson\(.*rulingsDecide = false/.test(l)), 'the option defaults to false');
});

const DRAFT = 'The worker retries failed requests.';
const script = replies => ({ get(label) {
  const text = label in replies ? replies[label] : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : label.startsWith('panel-') || label.startsWith('critique-') ? JSON.stringify({ meets: true, criteria: [{ criterion: C, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok' }) : DRAFT;
  return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
}, invalidate() {} });
const seat = lab => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000 });   // no `layer`: an unlayered chain
const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };

test('S7B-8: PIN - an unlayered first-mode run keeps a stray `rulings` key on report.lastCritique, as it did before S7b', async () => {
  setCache(script({ 'critique-1': obj('overrule') }));
  const config = { name: 'fixture-stray', criteria: [C], maxRounds: 1, seats: { builder, reviser: builder, critics: [seat('a')] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-stray', log: () => {}, config });
  assert.equal(result.lastCritique.meets, false);
  assert.deepEqual(result.lastCritique.rulings, rl('overrule'), 'the stray key rides, unchanged');
});

test('S7B-9: PIN - an unlayered unanimous run hears a seat whose two-object reply differs only in `rulings` (the gate is held there: today\'s reading)', async () => {
  setCache(script({ 'panel-1-a': `${obj('overrule')}\n${obj('sustain')}` }));
  const config = { name: 'fixture-two-objects', criteria: [C], signoff: 'unanimous', maxRounds: 1, seats: { builder, reviser: builder, critics: [seat('a')] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-two', log: () => {}, config });
  assert.equal(result.lastCritique.failures.filter(f => f.lab === 'a').length, 1, 'the seat was heard: its objection is on the record');
});
