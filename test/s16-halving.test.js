// 0.8.4 S16 (H3; Muad 09 Nov 2026, C&C): a request the provider REFUSES for its size (the documented error_type context_length_exceeded on a 400, or payload_too_large on a 413) is a class of its own, not a cut reply and not a retry: the final read splits the part in two, asks
// each half through invoke() (its own reservation, additive labels `-h1` / `-h2`), and keeps halving down to a part of one item; a one-item part that is still refused means the judge did not read. No other error is retried. The halving works only once the part sentence
// (W42) is recorded. The refusal is made by the mock model `mock-size-refusal-<N>` (the prompt is refused above N characters), with the cache stub missing every final-read label so each is a real (mock) call. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, setCache, setBudget, setPromptSpy, setOutboundScan, FINAL_READ_SIZE_WHY } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { errorTypeOf, isSizeRefusal, halvesOnSizeRefusal } from '../src/providers.js';
import { SORTING } from './helpers/rating-demand.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';
import { finalReadPartRule } from './held-prompts/held-084-s16.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const CR = [CRITERION, 'The plan names an owner for the worker.', 'The plan states a timeout.', 'The plan names a rollback step.', 'The plan defines what is logged.'];
const fail = (n, severity) => ({ criterion: CR[n], problem: `Problem number ${n}: ${'detail '.repeat(30)}`, fix: 'Fix it.', quote: 'retries failed requests', severity, relation: 'new' });   // K1: relationRule is recorded; each failure is la's first raise
const RAISE = JSON.stringify({ meets: false, criteria: CR.map(c => ({ criterion: c, verdict: 'FAILED', evidence: 'Missing.' })), failures: [fail(0, 9), fail(1, 8), fail(2, 6), fail(3, 5), fail(4, 4)], verdict_line: 'no' });
const everyFinalRead = { includes: l => l === 'revise-1' || l.startsWith('final-read-') };   // the stub's cut test: a final-read stage is never served from disk, so the mock provider is really called
const model = n => `mock-size-refusal-${n}`;
const L3 = n => [['la', 1], ['lb', 2], ['lc', 3, model(n)], ['ld', 3, model(n)]];

async function run(held, n) {
  setHeldForTest(held); setOutboundScan({ finish: true });
  try { return await scenario({ answerBack: true, l1Severity: 9, critics: L3(n), overrides: { 'panel-1-la': RAISE }, extra: { criteria: CR }, cutLabels: everyFinalRead }); }
  catch (e) { return { error: e, served: e.served ?? [], prompts: e.prompts ?? new Map() }; }
  finally { setOutboundScan({}); }
}
const lcLabels = served => [...new Set(served.filter(l => /^final-read-lc/.test(l)))];

test('errorTypeOf / isSizeRefusal: the typed code is read from the FULL body (past the 600-character cut of the message); only the input-side size codes on their documented statuses count', () => {
  const body = type => JSON.stringify({ error: { code: 400, message: 'x'.repeat(900), metadata: { error_type: type } } });
  assert.equal(errorTypeOf(body('context_length_exceeded')), 'context_length_exceeded');
  assert.equal(errorTypeOf(`{"error":{"code":400,"message":"${'y'.repeat(700)}","metadata":{"error_type":"context_length_exceeded"`), 'context_length_exceeded', 'a body cut short is searched for the key');
  assert.equal(errorTypeOf('not json at all'), undefined);
  assert.equal(isSizeRefusal({ status: 400, errorType: 'context_length_exceeded' }), true);
  assert.equal(isSizeRefusal({ status: 413, errorType: 'payload_too_large' }), true);
  assert.equal(isSizeRefusal({ status: 400, errorType: 'invalid_request' }), false, 'a bare 400 is not a size refusal');
  assert.equal(isSizeRefusal({ status: 400 }), false);
  assert.equal(isSizeRefusal({ status: 500, errorType: 'context_length_exceeded' }), false);
  assert.equal(isSizeRefusal({ status: 400, errorType: 'max_tokens_exceeded' }), false, 'output-side codes are not a refusal of the prompt');
  assert.equal(errorTypeOf(JSON.stringify({ error: { code: 'context_length_exceeded', message: 'm' } })), 'context_length_exceeded', 'a direct OpenAI error names the code in error.code');
  // the SEAT is checked beside the error: only OpenRouter (and mock, the named stand-in) halves; a direct seat that is refused for size did not read
  assert.deepEqual(['openrouter', 'mock', 'openai', 'anthropic', 'google', 'external', 'ollama'].map(p => halvesOnSizeRefusal({ provider: p })), [true, true, false, false, false, false, false]);
});

test('a part refused for its size is read in halves under additive labels: the full prompt is refused first, a half is asked (no re-ask of the refusal), at least one second half is asked, every prompt that was ANSWERED is within the limit, and the seat reads', async () => {
  const probe = await run({ ...SORTING, finalReadPartRule }, 1e9);
  const full = probe.prompts.get('final-read-lc'); const chars = full.system.length + full.user.length;
  const r = await run({ ...SORTING, finalReadPartRule }, chars - 100);
  const labels = lcLabels(r.served);
  assert.equal(labels[0], 'final-read-lc', 'the full prompt is asked first (and refused)');
  assert.ok(labels.includes('final-read-lc-h1') && labels.some(l => /-h2$/.test(l)), labels.join(', '));
  assert.ok(!labels.some(l => /reask/.test(l)), 'a size refusal is not asked again as it was');
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc');
  assert.equal(lc.read, true);
  for (const l of labels) { const pr = r.prompts.get(l); if (l === 'final-read-lc') continue; assert.ok(pr.system.length + pr.user.length <= chars - 100 || r.result.stages.every(s => s.label !== l), `${l} was answered, so it is within the limit`); }
});

test('halving is bounded: when every prompt is refused, part 1 goes 5 -> 3 -> 2 -> 1 items and the one-item part that is still refused means the judge did not read, with the size cause; both seats unread stops the run at the final-read stop (the worst case, a list of n items asked in at most 2 x n - 1 calls, needs part 1 to be read)', async () => {
  const r = await run({ ...SORTING, finalReadPartRule }, 100);
  assert.ok(r.error instanceof RoundStopped, String(r.error));
  assert.equal(r.error.stop.why, 'final_read');
  assert.deepEqual(lcLabels(r.served), ['final-read-lc', 'final-read-lc-h1', 'final-read-lc-h1-h1', 'final-read-lc-h1-h1-h1']);
});

// REMOVED (0.8.4 apply, K7): the half of 'HELD state (the part sentence is not recorded): a refusal cannot be halved' that ran `run(SORTING, 100)` and expected `['final-read-lc']` only. Job 12: the actual list was ['final-read-lc', '-h1', '-h1-h1', '-h1-h1-h1'] (the halving ran): `finalReadPartRule` (W42) is recorded (src/roles.js), so SORTING alone falls through to it. Sibling (same file): 'halving is bounded' (the same fixture with the part rule: the one-item part refused means the judge did not read, with the size cause). KEPT: the assertion that is true in the recorded state, the size-cause sentence, as its own test.
test('the size cause sentence the unread seat carries is the recorded one (WORDING S16-w53)', () => {
  assert.match(FINAL_READ_SIZE_WHY, /^the provider refused the prompt for its size, even with one open objection or late finding in it$/);
});

// C&C 09 Nov 2026 (parts_unread {label, why}): a LATER part of ONE item that the provider refuses for its size gets its own record and log sentence. The list is read in two parts (the room is set for the test: part 1 holds the four short objections, part 2 the one long one,
// which the plan's order puts last because it has the lowest rating). The mock model refuses prompts above N characters, N a little above part 1's own prompt.
test('a later part of one item refused for its size: no re-ask, no halving (one item), the seat keeps part 1, parts_unread names the part by its label with the size cause, the log says so (and not "after one re-ask"), and the items in it stand as must-do', async () => {
  const { setFinalReadRoomsForTest } = await import('../src/chain.js');
  const { orderForParts } = await import('../src/final-read-room.js');
  const { sortingItemsOf } = await import('../src/sorting.js');
  const { objectionId } = await import('../src/objection-ids.js');
  const { layerThreeSortingItems } = await import('./held-prompts/held-084-s8.js');
  const R = await import('../src/roles.js');
  const long = { ...fail(4, 4), problem: `Problem number 4: ${'long detail '.repeat(400)}` };
  const FS = [fail(0, 9), fail(1, 8), fail(2, 6), fail(3, 5), long];
  const raise = JSON.stringify({ meets: false, criteria: CR.map(c => ({ criterion: c, verdict: 'FAILED', evidence: 'Missing.' })), failures: FS, verdict_line: 'no' });
  const ordered = orderForParts(sortingItemsOf({ open: FS.map(f => ({ id: objectionId('la', f), lab: 'la', layer: 1, severity: f.severity, first_round: 1, flags: [], problem: f.problem })), wrap: R.claimText }).items);
  const part1 = ordered.slice(0, 4); const part2 = ordered.slice(4);
  assert.equal(part2.length, 1, 'premise: the long, lowest-rated objection is alone in the last part');
  const room = layerThreeSortingItems({ items: part2 }).length + 60;   // holds the long objection ALONE (a row that fits no part is an oversize row: the seat would not be called); the four short ones fit one part and the long one does not fit beside them
  assert.ok(layerThreeSortingItems({ items: part1 }).length < room && layerThreeSortingItems({ items: [...part1, ...part2] }).length > room, 'premise: part 1 fits the room, adding the long objection does not');
  const go = async n => {
    const lines = [];
    setHeldForTest({ ...SORTING, finalReadPartRule }); setOutboundScan({ finish: true });
    setFinalReadRoomsForTest(new Map([['lc', room], ['ld', room]]));
    try { return { ...(await scenario({ answerBack: true, l1Severity: 9, critics: L3(n), overrides: { 'panel-1-la': raise }, extra: { criteria: CR }, cutLabels: everyFinalRead, lines })), lines }; }
    finally { setOutboundScan({}); setFinalReadRoomsForTest(null); }
  };
  const probe = await go(1e9);
  const p1 = probe.prompts.get('final-read-lc'); const n = p1.system.length + p1.user.length + 300;
  const r = await go(n);
  const labels = lcLabels(r.served);
  assert.deepEqual(labels, ['final-read-lc', 'final-read-lc-part2'], `part 1 answered, part 2 refused once and never asked again: ${labels.join(', ')}`);
  const lc = r.result.finalRead.seats.find(s => s.lab === 'lc');
  assert.equal(lc.read, true, 'the seat keeps part 1');
  assert.deepEqual(lc.parts_unread, [{ label: 'final-read-lc-part2', why: FINAL_READ_SIZE_WHY }]);
  assert.ok(r.lines.some(l => l.includes('the part of the list asked as "final-read-lc-part2" was refused by the provider for its size, even with one open objection or late finding in it; the objections in it have no word from this seat and stand as must-do; its late findings have no word from this seat either, and a late finding counts only with the sorting of a seat that read it.')), 'WORDING S16-w12d');
  assert.ok(!r.lines.some(l => l.includes('final-read-lc-part2') && l.includes('after one re-ask')), 'and it does not say a re-ask happened');
  assert.ok(!(lc.sorting ?? []).some(x => x.id === part2[0].id), 'the long objection has no word from lc (the combined sorting reads a seat with no word as must-do: s16-room pins that rule)');
});
