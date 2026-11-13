// 3 Nov 2026 (owner's pick "Auto + handler tool": "complete tables matched by row position instead of by retyped text (no repair needed)"; C&C's guards; src/criteria-ledger.js byPosition): a judge that retypes a
// criterion's words in its sign-off table still judged that criterion when the table is complete and in order. B3 run 5 lost about 46 judge votes to retyped rows; d2's catalog: 116 of 119 complete tables map row k to
// criterion k by best word overlap, all 27 numbered ones by their numbers. The retype used here is a SUBSTITUTION (the first word replaced): today's text match takes a contained text of 12 characters or more, or up to
// two words dropped in order from a criterion of 8 words or more, but not a changed word, so these tables are refused today.
import test from 'node:test';
import assert from 'node:assert/strict';
import { signoffTableGap, outsideCriteriaRows, missingCriteriaRows } from '../src/criteria-ledger.js';
import { runChain, normaliseCritique, setCache, setRepairPauses, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

const C = ['The plan states its assumptions about the venue.', 'Every step names who does it and by when.', 'The budget adds up and names its sources.'];
const retype = c => c.replace(/^\S+/, 'Restated');
const row = (criterion, verdict = 'MET') => ({ criterion, verdict, evidence: 'The draft covers it.' });
const signOff = rows => ({ meets: true, criteria: rows, failures: [] });

test('P-1 a complete table in list order whose criterion texts are retyped counts as a full table (no gap, no outside rows, nothing missing); numbered rows too', () => {
  for (const rows of [C.map(c => row(retype(c))), C.map((c, i) => row(`${i + 1}. ${retype(c)}`))]) {
    assert.equal(signoffTableGap(signOff(rows), C), null, `the sign-off counts: ${JSON.stringify(signoffTableGap(signOff(rows), C))}`);
    assert.equal(missingCriteriaRows(signOff(rows), C), null, 'no criterion is missing a row');
    assert.deepEqual(outsideCriteriaRows(signOff(rows), C), [], 'a row placed by position is not an outside row');
  }
});

test('P-1b through the panel: a judge that signs off with a retyped complete table (mock-retyped-table) on a chain that requires a full table is counted, and the run passes', async () => {
  const config = { name: 'position-match', signoff: 'unanimous', maxRounds: 1, criteria: C, signoff_table: { required: true }, seats: { critics: [{ provider: 'mock', model: 'mock-retyped-table', lab: 'rt' }] } };
  setRepairPauses(false); setCache(null);
  const result = await runChain({ request: 'Plan a bake sale.', config, draft: 'REVISED MOCK DELIVERABLE', log: () => {} });
  assert.equal(result.passed, true, `the retyped sign-off counts (gaps: ${JSON.stringify(result.signoffTableGaps ?? [])})`);
  assert.equal((result.signoffTableGaps ?? []).length, 0, 'no table gap is recorded');
});

test('P-2 pins: position never puts a verdict on a criterion its row does not fit: an incomplete table, swapped rows, a tie, a disagreeing number, an exact match at another position are all refused as today', () => {
  const refused = (rows, list, why) => assert.equal(signoffTableGap(signOff(rows), list)?.kind, 'missing_rows', why);
  refused(C.slice(0, 2).map(c => row(retype(c))), C, 'G1: an incomplete table (a missing row is never filled)');
  refused([row(retype(C[1])), row(retype(C[0])), row(retype(C[2]))], C, 'G2: rows 1 and 2 swapped: each row fits the other position better');
  const T = ['Alpha beta gamma delta', 'Alpha beta epsilon zeta', 'Omega psi chi phi'];
  refused([row('Alpha beta'), row('Restated beta epsilon zeta'), row('Restated psi chi phi')], T, 'G2: row 1 fits criteria 1 and 2 equally (a tie)');
  refused([row(`2. ${retype(C[0])}`), row(retype(C[1])), row(retype(C[2]))], C, 'G3: row 1 says it is criterion 2');
  refused([row(C[1]), row(retype(C[0])), row(retype(C[2]))], C, 'G4: row 1 is the exact text of criterion 2');
});

// CHANGED ACCEPTED (0.8.4 S19): OLD: the panel half ran an UNLAYERED chain with the severity switch key. NEW: the unit half is unchanged (normaliseCritique keeps its `severity` option); the panel half gives the seat `layer: 1` and injects the rating demand, because the strict reading of a rating (the thing the retyped row must not trip) exists only on a layered unanimous chain with the demand in force; a new assertion proves the demand was in the prompt. WHY: switch removed; on an unlayered chain the panel half would pass vacuously. RED ON OLD SRC: only the new prompt assertion (the old src puts no demand in a prompt without the switch); the rest passes there too. RED INPUT FOR THE BUILDER: run the panel half with NO_DEMAND (the prompt assertion fails), or strip `severity` from the stub critique's failure (strict refusal re-asks, the labels assertion fails).
test('P-3 a retyped FAILED row beside the judge\'s own failure for that criterion: THC writes no failure of its own, so the verdict stays readable with the rating demand in force (unit level, and through the panel on a layered chain)', async () => {
  const critique = { meets: false, criteria: [row(retype(C[0])), row(retype(C[1]), 'FAILED'), row(retype(C[2]))], failures: [{ criterion: C[1], problem: 'Step 4 names no owner.', fix: 'Name one.', severity: 6 }] };
  const read = normaliseCritique(structuredClone(critique), () => {}, { severity: true, criteria: C });
  assert.notEqual(read.unreadable, true, `readable: ${read.unreadableWhy ?? ''}`);
  assert.equal(read.failures.length, 1, 'only the judge\'s own failure');
  assert.equal(read.failures[0].criterion, C[1], 'its words unchanged');
  // through the panel: the call site passes the run's criteria (a stubbed OpenRouter seat with a fake key; the seat is not re-asked)
  const A = { provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 20000, lab: 'seat-a', layer: 1 };   // layer 1: a layered unanimous chain records ratings and, with the demand, reads a missing one strictly (one seat in the layer: runChain does not lint, and no exchange runs with a single judge)
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  const original = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { const body = JSON.parse(opts.body); return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: JSON.stringify(critique) }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) }; };
  const labels = [];
  const sent = []; setPromptSpy(p => sent.push(p)); setHeldForTest(DEMAND);
  let result;
  try {
    setRepairPauses(false); setCache(null);
    result = await runChain({ request: 'Plan a bake sale.', config: { name: 'position-match-sev', signoff: 'unanimous', maxRounds: 1, criteria: C, seats: { critics: [A] } }, draft: 'REVISED MOCK DELIVERABLE', log: () => {}, onStage: s => labels.push(s.label) });
  } finally { setHeldForTest(null); setPromptSpy(null); globalThis.fetch = original; if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
  assert.ok(sent.some(p => p.label === 'panel-1-seat-a' && /carries a severity: a number from 1 to 10/.test(p.system)), 'the rating demand was in the judge prompt, so the strict reading of its verdict is what the criteria were passed to');
  // one critic, so a re-ask can only come from an unreadable verdict (never from another judge objecting): no re-ask stage AND the recorded outcome is the seat's objection
  assert.deepEqual(labels.filter(l => l.startsWith('panel-1-seat-a')), ['panel-1-seat-a'], `the verdict was read at once, no re-ask (${labels})`);
  assert.equal((result.panelVerdicts || []).find(v => v.lab === 'seat-a')?.verdict, 'objected', `the seat's objection is recorded (${JSON.stringify(result.panelVerdicts)})`);
});

test('P-4 outsideCriteriaRows reads the same assignment: a retyped complete table has no outside rows, a row that fits nothing in an incomplete table still is one', () => {
  assert.deepEqual(outsideCriteriaRows(signOff(C.map(c => row(retype(c)))), C), []);
  assert.deepEqual(outsideCriteriaRows(signOff([row(C[0]), row('Something else entirely about parking')]), C), ['Something else entirely about parking']);
});

test('P-5 pin (G5): a row shorter than 12 characters is never placed by position, the floor the text match puts on a contained text; a row the text match placed (its id) is not judged by length', () => {
  const S = ['The plan names a data store.', 'The plan lists the API routes with their methods.', 'The plan says how it is deployed.'];
  assert.equal(signoffTableGap(signOff([row('plan'), row(retype(S[1])), row(retype(S[2]))]), S)?.kind, 'missing_rows', '"plan" does not stand for criterion 1, even in a complete table at position 1');
  assert.equal(signoffTableGap(signOff([row('C1'), row(retype(S[1])), row(retype(S[2]))]), S), null, 'the id "C1" is a text match, and the other two rows are placed by position');
});
