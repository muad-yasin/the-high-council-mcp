// 0.8.4 T2.1 / D1 (plan A tests/ending-derivation, UNIT 3): the dispute record's `reason` and the banner's reason sentence are DERIVED from the ending word and equal what the code wrote before the matrix, on every way a run ends.
// The oracle is the two reason expressions as src/chain.js had them (copied here verbatim, the flags being its local variables) and the banner expression of src/handoff-from-run.js finishedState. A real run per ending checks the wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from '../src/chain.js';
import { endingWordOf, disputeReasonOf, ENDING_WORDS, ENDING_MATRIX } from '../src/ending-matrix.js';
import { finishedState } from '../src/handoff-from-run.js';
import { reportJsonShape } from '../src/report-shape.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));

// THE ORACLE: src/chain.js before the matrix (site 1, `ran: true`; site 2, `ran: false`), verbatim
const legacyRan = ({ noHeardReviewer, notQuorate, finishedStop, layerStop, earlyFinish, escalatedEnd, stalled }) =>
  noHeardReviewer ? 'no_heard_reviewer' : notQuorate ? 'not_quorate' : finishedStop ? (finishedStop.chosen === 'rule' ? 'rule_no_handler' : 'finish_chosen') : layerStop ? 'layer_not_signed_off' : earlyFinish ? 'early_finish' : escalatedEnd ? 'escalated_signoff' : stalled ? 'stalled' : 'round_cap';
const legacyIdle = ({ passed, noHeardReviewer, notQuorate, finishedStop, layerStop, earlyFinish, escalatedEnd }) =>
  passed ? 'panel_signed_off' : noHeardReviewer ? 'no_heard_reviewer' : notQuorate ? 'not_quorate' : finishedStop ? (finishedStop.chosen === 'rule' ? 'rule_no_handler' : 'finish_chosen') : layerStop ? 'layer_not_signed_off' : earlyFinish ? 'early_finish' : escalatedEnd ? 'escalated_signoff' : 'no_open_objections';
// the flags, each a truthy object as the chain holds them; the chain sets ONE per run (each is set just before the pass loop's `break`)
const FLAGS = {
  noHeardReviewer: { round: 2 }, notQuorate: { round: 2 }, finishedStop: { kind: 'overseer_cap', chosen: 'finish' }, layerStop: { reason: 'top_layer_not_explicit' },
  earlyFinish: { pass: 1 }, escalatedEnd: { pass: 3 }, stalled: { rounds: 3, round: 3 },
};
const SETS = [{}, ...Object.entries(FLAGS).map(([k, v]) => ({ [k]: v })), { finishedStop: { kind: 'overseer_cap', chosen: 'rule' } }, { finishedStop: { kind: 'secret_pause', chosen: 'finish' } }];

test('D1 the dispute reason, derived from the word, equals the legacy expression at BOTH sites for every way a run ends (running, idle, and passed)', () => {
  for (const flags of SETS) {
    const label = JSON.stringify(Object.keys(flags).length ? flags : 'no flag');
    const word = endingWordOf({ passed: false, ...flags });
    assert.equal(disputeReasonOf(word, true), legacyRan(flags), `site 1 (ran) for ${label}`);
    assert.equal(disputeReasonOf(word, false), legacyIdle({ passed: false, ...flags }), `site 2 (idle) for ${label}`);
  }
  assert.equal(disputeReasonOf(endingWordOf({ passed: true }), false), legacyIdle({ passed: true }), 'a passed run, site 2');
  // passed first at site 2 even if a stale flag is also set (the legacy expression is passed-first)
  assert.equal(disputeReasonOf(endingWordOf({ passed: true, notQuorate: FLAGS.notQuorate }), false), legacyIdle({ passed: true, notQuorate: FLAGS.notQuorate }));
});

test('D1 every word the matrix has is reached by some way a run ends, and each reason it derives is one the legacy expressions can write', () => {
  const reached = new Set([...SETS.map(f => endingWordOf({ passed: false, ...f })), endingWordOf({ passed: true }), endingWordOf({ passed: true, ending: { kind: 'signed_off_at_top_not_agreed' } })]);
  assert.deepEqual([...reached].sort(), [...ENDING_WORDS].sort());
  const writable = new Set([...SETS.flatMap(f => [legacyRan(f), legacyIdle({ passed: false, ...f })]), 'panel_signed_off']);
  for (const word of ENDING_WORDS) for (const ran of [true, false]) assert.ok(writable.has(disputeReasonOf(word, ran)), `${word} ${ran}`);
});

test('D1 the banner\'s reason sentence is the legacy finishedState expression for every word and every agreed reading (degraded unchanged)', () => {
  const legacy = (passed, outcome) => { const signed = passed === true; const degraded = signed && outcome === 'degraded'; return degraded ? 'DEGRADED' : signed ? 'signed off' : 'finished with open objections'; };
  for (const word of [...ENDING_WORDS, null, undefined]) for (const passed of [true, false]) for (const outcome of ['consensus', 'no_consensus', 'degraded']) {
    const s = finishedState({ passed, outcome, delivered_text: null, ending_word: word });
    const want = legacy(passed, outcome);
    if (want === 'DEGRADED') assert.match(s.reason, /^ended degraded: /);
    else if (passed === true && word && ENDING_MATRIX[word]?.agrees === 'never') assert.equal(s.reason, 'finished with open objections', `${word}: a row that can never be agreed does not read signed off`);
    else assert.equal(s.reason, want, `${word} ${passed} ${outcome}`);
  }
  // the old call (no word) is unchanged
  assert.equal(finishedState({ passed: false, outcome: 'no_consensus', delivered_text: null }).reason, 'finished with open objections');
});

// ---- the wiring, through real runs of the mock chains (offline, $0)
const run = (config, request = 'A mock task.') => runChain({ config, request, log: () => {} });
const reportOf = (result, config) => reportJsonShape({ runId: 'x', chain: config.name ?? 'mock', task: 't.md', result, config });

test('D1 wiring: a real run that ends signed off, and one that stalls, carry the word in the result and in report.json beside the legacy reason', async () => {
  const signed = { ...chain('mock-unanimous'), dispute: { enabled: true, stall_rounds: 2 } };
  const a = await run(signed);
  assert.equal(a.passed, true);
  assert.deepEqual([a.endingWord, a.dispute.reason], ['signed_off', 'panel_signed_off']);
  const ra = reportOf(a, signed);
  assert.deepEqual([ra.ending_word, ra.dispute.reason, ra.stop_kind], ['signed_off', 'panel_signed_off', undefined]);
  const stallConfig = chain('mock-dispute');
  const b = await run(stallConfig);
  assert.deepEqual([b.endingWord, b.dispute.reason], ['stalled', 'stalled']);
  assert.equal(reportOf(b, stallConfig).ending_word, 'stalled');
});

test('D1 wiring: a run that hits its pass ceiling ends round_cap, derived to the same reason as before', async () => {
  const config = { ...chain('mock-dispute'), maxRounds: 2, dispute: { enabled: true, stall_rounds: 99 } };
  const r = await run(config);
  assert.equal(r.passed, false);
  assert.deepEqual([r.endingWord, r.dispute.reason], ['round_cap', 'round_cap']);
});
