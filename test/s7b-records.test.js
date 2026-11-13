// 0.8.4 S7b, commit A4 (records): what layer 2's ordinary-call rulings leave on the report. `layers[].rulings_in_call` (one entry per objection layer 2 was asked to rule on, `stays_open` added when the report is written), `layers[].layer_one_open.not_shown`
// (the ids the size budget cut), and the one run.log line when something was cut. All of it exists only with the five gate names recorded; held, the record is exactly what it was. $0, offline, runChain direct. Fixture and held map as test/s7b-rulings.test.js and s7b-prompt.test.js.
// Rows RR-1 (overrule: closed, stays_open false, by[]), RR-2 (sustain: adopted_as, no stays_open), RR-3 (no rulings array: undecided with a why), RR-4 (the budget: not_shown, the log line, the schema), RR-5 (held: the four keys, no rulings_in_call, no new line, no escalations[] row).
// NOT DRIVEN here (named): the several-sustainers entry and a revise round run for another reason are driven in test/s7b-gaps.test.js (G-2, G-1); `not_shown` and the log line with NO row fitting (the empty-rulable edge: reachable only through a not_debated row, see test/s7b-gaps.test.js).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import * as HB from './held-prompts/held-084-b.js';
import { scenario, CRITERION, idOf } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const schema = JSON.parse(readFileSync(resolve(root, 'schemas', 'report-v1.json'), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateLayers = ajv.compile({ $defs: schema.$defs, ...schema.properties.layers });

const LIVE = Object.freeze({ ...DEMAND, relationRule: HB.relationRule, layerOneRulingsSection: HB.layerOneRulingsSection, layerOneRulingsReplyTail: HB.layerOneRulingsReplyTail, layerOneRulingsLedgerSection: HB.layerOneRulingsLedgerSection });
const HELD = Object.freeze({ ...LIVE, layerOneRulingsLedgerSection: undefined });   // one of the five names held: the recorded section, the recorded record
const ID = idOf(3);
const failure = (criterion, severity, quote, problem = 'No retry limit is specified.') => ({ criterion, problem, fix: 'Specify one.', quote, severity, relation: 'new' });
const raiseOf = failures => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures, verdict_line: 'no' });
const sign = rulings => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', ...(rulings ? { rulings } : {}) });
const L1 = { 'panel-1-la': raiseOf([failure(CRITERION, 3, 'retries failed requests')]) };
const refsOf = text => [...text.matchAll(/<prior-review ref="([^"]+)">/g)].map(m => m[1]);
const rowOf = (result, layer = 2) => result.layers.find(l => l.round === 1 && l.layer === layer);
const BIG_FAILURE = (n, severity) => failure(n === undefined ? CRITERION : `${CRITERION} ${n}`, severity, n === undefined ? 'retries failed requests' : `q${n}`, n === undefined ? 'No retry limit is specified.' : `Problem ${n}: ${'x'.repeat(1700)}`);

const run = async (lbReply, held = LIVE, extra = {}) => {
  setHeldForTest(held);
  return scenario({ answerBack: true, l1Severity: 3, overrides: { ...L1, 'panel-1-lb': lbReply }, ...extra });
};

test('RR-1: an overrule of the rated-3 objection is recorded on the layer-2 row: closed (stays_open false), who ruled and why; the layers[] rows validate against the schema; no escalations[] row', async () => {
  const { result } = await run(sign([{ id: ID, ruling: 'overrule', reason: 'The plan already sets one in section two.' }]));
  const entries = rowOf(result).rulings_in_call;
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], { id: ID, lab: 'la', layer: 1, rated: 3, outcome: 'overruled', by: [{ seat: 'lb', ruling: 'overrule', reason: 'The plan already sets one in section two.' }], stays_open: false });
  assert.equal(rowOf(result, 1).rulings_in_call, undefined, 'only the ruling layer carries it');
  assert.equal((result.escalations ?? []).length, 0, 'no new trigger: the in-call ruling is not an escalation');
  assert.ok(validateLayers(result.layers), JSON.stringify(validateLayers.errors));
  assert.equal(validateLayers(result.layers.map(r => (r.rulings_in_call ? { ...r, rulings_in_call: r.rulings_in_call.map(e => ({ ...e, outcome: 'closed' })) } : r))), false, 'the schema rejects an outcome it does not list (so this row can fail)');
});

test('RR-2: a sustain is recorded with the new id it was adopted under, and carries no stays_open', async () => {
  const { result } = await run(sign([{ id: ID, ruling: 'sustain' }]));
  const e = rowOf(result).rulings_in_call[0];
  assert.equal(e.outcome, 'sustained');
  assert.equal(e.id, ID);
  assert.deepEqual(e.adopted_as.map(a => a.lab), ['lb']);
  assert.ok(typeof e.adopted_as[0].id === 'string' && e.adopted_as[0].id !== ID, 'under its own new id');
  assert.equal('stays_open' in e, false);
  assert.deepEqual(e.by, [{ seat: 'lb', ruling: 'sustain' }]);
  assert.ok(validateLayers(result.layers), JSON.stringify(validateLayers.errors));
});

test('RR-3: a layer-2 reply with no rulings array is recorded as undecided, with a reason for each judge', async () => {
  const { result } = await run(sign(undefined));
  const e = rowOf(result).rulings_in_call[0];
  assert.equal(e.outcome, 'undecided');
  assert.equal(e.by[0].ruling, null);
  assert.equal(typeof e.by[0].why, 'string');
  assert.equal('stays_open' in e, false);
  assert.ok(validateLayers(result.layers), JSON.stringify(validateLayers.errors));
});

test('RR-4: over the size budget the cut ids are recorded under layer_one_open.not_shown and are not in the prompt; the run.log says so; at or under the budget there is no not_shown and no line', async () => {
  const lines = [];
  const many = [BIG_FAILURE(undefined, 3), ...Array.from({ length: 25 }, (_, i) => BIG_FAILURE(i, 3.1))];
  setHeldForTest(LIVE);
  const big = await scenario({ answerBack: true, l1Severity: 3, overrides: { 'panel-1-la': raiseOf(many) }, runExtra: { log: l => lines.push(l) } });
  const rec = rowOf(big.result).layer_one_open;
  assert.ok(rec.left_out > 0 && rec.shown + rec.left_out === 26, JSON.stringify(rec));
  assert.equal(rec.not_shown.length, rec.left_out);
  const refs = refsOf(big.prompts.get('panel-1-lb').user);
  assert.equal(rec.not_shown.some(id => refs.includes(id)), false, 'a cut id is not among the refs the judge was shown');
  assert.equal(new Set([...refs, ...rec.not_shown]).size, 26, 'every open objection is either shown or named');
  assert.equal(rowOf(big.result).rulings_in_call.length, rec.shown, 'one entry per objection it was asked to rule on');
  assert.equal(lines.filter(l => l.includes(`layer 2: ${rec.left_out} lower-rated open objection(s) of layer 1 did not fit the section its judges rule on, so they are not ruled on and stay open as they were (their ids are recorded in the run's report).`)).length, 1, lines.join('\n'));
  assert.ok(validateLayers(big.result.layers), JSON.stringify(validateLayers.errors));
  const lines2 = [];
  setHeldForTest(LIVE);
  const small = await scenario({ answerBack: true, l1Severity: 3, overrides: { 'panel-1-la': raiseOf([BIG_FAILURE(undefined, 3), BIG_FAILURE(1, 3), BIG_FAILURE(2, 3)]) }, runExtra: { log: l => lines2.push(l) } });
  const sRec = rowOf(small.result).layer_one_open;
  assert.deepEqual([sRec.shown, sRec.left_out, 'not_shown' in sRec], [3, 0, false]);
  assert.equal(lines2.some(l => l.includes('did not fit the section its judges rule on')), false);
});

test('RR-5: PIN - with one of the five names held the record is what it was: the four layer_one_open keys, no rulings_in_call, none of the new line', async () => {
  const lines = [];
  const many = [BIG_FAILURE(undefined, 3), ...Array.from({ length: 25 }, (_, i) => BIG_FAILURE(i, 3.1))];
  setHeldForTest(HELD);
  const { result } = await scenario({ answerBack: true, l1Severity: 3, overrides: { 'panel-1-la': raiseOf(many) }, runExtra: { log: l => lines.push(l) } });
  const row = rowOf(result);
  assert.deepEqual(Object.keys(row.layer_one_open).sort(), ['chars', 'left_out', 'shown', 'tokens_est']);
  assert.ok(row.layer_one_open.left_out > 0, 'something was cut, so a live run would have named it');
  assert.equal(result.layers.some(r => 'rulings_in_call' in r), false);
  assert.equal(lines.some(l => l.includes('did not fit the section its judges rule on')), false);
});
