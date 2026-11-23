// 0.8.4 S5 (Q13, Q8, D16, RU-S5-01/02, R9; T7a-T7f): the PER-OBJECTION stall and the ONE-PASS escalation, through runChain. Offline, $0: a cache stub answers every stage by its label (test/stall-escalation.test.js's pattern),
// so the judges object, rule and sign off exactly when the script says. The ruling words, the relation wording W6 and the rating demand are HELD words (test/held-prompts, test/helpers/rating-demand.js): each row says what it injects.
//   PO-1  T7a   the same id and quote for w = 3 passes, the problem reworded each pass, the writer declining with a reworded reason each time: the first escalation is at pass 3 and layer 2 is not asked before it   [injects: ruling words]
//   PO-2  T7b   an unrelated objection added in pass 2 does not restart X's count: X is escalated at pass 2 ALONE (Y stays with its judge); the row records the passes   [injects: ruling words]
//   PO-3  T7c   a "continues" amendment that rewords the problem keeps the count: escalation at pass 2   [injects: ruling words + W6]
//   PO-4  T7d   the writer changes the quoted passage in pass 2: the count restarts, so there is NO escalation at pass 2   [injects: ruling words]
//   PO-5  T7f   a "continues" amendment that carries a DIFFERENT normalised passage keeps the id and restarts the count: no escalation at pass 2, one at pass 3   [injects: ruling words + W6]
//   PO-6  Q-a   the escalation lasts ONE pass: after a sustain at layer 2 the next pass starts at layer 1 (SE-2 said "layer 1 waits for the top layer's verdict")   [injects: ruling words]
//   PO-7  T7e   layer 2, in the escalation pass, raises an objection of its own rated 5.0: a revision, layer 3 is NOT asked in that pass, and the next pass starts at layer 1   [injects: ruling words + the rating demand; fixture ratings 5 and 5.0]
//   PO-8  R9    layer 2 objects Y in pass 1, sits out pass 2 (layer 1 objected), objects Y again in pass 3: two VERDICTS of layer 2 reach w = 2, so the stall fires at pass 3 and goes to layer 3   [injects: ruling words]
//   PO-9  R10 (C&C: the whole run is ONE round on a chain without overseer rounds): an id sent up once is never sent up again in the run, and layer 1 is asked on in every later pass   [injects: ruling words; an UNDECIDED ruling: the overruled variant waits for U-B]
//   PO-10 w = 2 on a chain WITHOUT layers (the shape of daily7-sub-a at a window of 2: shipped until 0.8.4, now in chains/outdated/ with a window of 3; this row builds its own config; C&C 05 Nov 2026): X quoted and present in rounds 1 and 2: the stall ends the review at round 2 as dispute.reason 'stalled'   [injects: nothing]
// RED BASE 6805be01 (whole-pass signature; layers below the floor parked until the top layer objects): PO-2, PO-4, PO-6, PO-7, PO-8 and PO-9 fail at their first assertion; PO-1, PO-3, PO-5 and PO-10 PASS there (the old signature also ignores the problem text
// and the writer's reason, and a changed quote also changes the old key): they pin that the new count keeps those properties.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import * as HESC from './held-prompts/held-escalation.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });
const INJECT = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };
const W6 = { relationRule: HB084.relationRule };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const X = { severity: 5, criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const Y = { severity: 5, criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
const Z = { severity: 5, criterion: CRITERION, problem: 'The failure case is not named.', quote: 'failed requests' };
const LOW = 'raiser-alpha';
const idX = objectionId(LOW, X);
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = (answers) => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], ...(answers ? { answers } : {}), verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const rules = list => JSON.stringify({ rulings: list });
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub replies of PO-1, PO-2, PO-4, PO-6 to PO-10 carried failures with no relation (PO-3 and PO-5 already did). NEW: a first raise carries relation 'new' (N), a raise of the same failure by the same seat in a later pass `continues <id>` (again). WHY: relationRule is recorded (NS-0193): a judge failure without its relation is an unreadable reply, and a `new` on a standing id mints #2, so the stall would never fire.
const N = f => ({ ...f, relation: 'new' });
const again = (f, lab = LOW) => ({ ...f, relation: `continues ${objectionId(lab, f)}` });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }];

// 0.8.4 SG-1 (C&C 08 Nov 2026): the stall goes up only with the ledger AND the rating demand, so the default held map carries DEMAND and the objections are rated 5 (holds the sign-off, never closes on an overrule: what the unrated ones did).
async function run({ held = { ...INJECT, ...DEMAND }, script = {}, maxRounds = 6, upper = ['mid-beta'], stall } = {}) {   // `stall` (w) is always passed explicitly: C&C 05 Nov 2026, the rows pin w = 2 (3 only in PO-1)
  if (!Number.isInteger(stall)) throw new Error('every row names its stall window');
  const served = [];
  setPromptSpy(() => {});
  setHeldForTest(held);
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-per-objection', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: stall }, maxRounds,
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), ...upper.map(l => seat(l, 2)), seat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-po', log: () => {}, config });
  return { result, served, config, report: JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-po', chain: 'fixture-per-objection', task: 't.md', result, config }))) };
}
const states = r => r.layers.map(x => `${x.round}.${x.layer}:${x.state}`).join(' ');
const rounds = report => (report.escalations ?? []).map(e => e.round);

test('PO-1 T7a: the same id and quote for w = 3 passes, the problem reworded each pass and the writer declining with a reworded reason: the first escalation is at pass 3, and layer 2 is not asked before it', async () => {
  const worded = n => objects((n === 1 ? N : again)({ ...X, problem: `No limit on retries (wording ${n}).` }));
  const { report, served } = await run({ stall: 3, script: {
    'panel-1-raiser-alpha': worded(1), 'panel-2-raiser-alpha': worded(2), 'panel-3-raiser-alpha': worded(3),
    'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idX}: The limit is set in section two.`,
    'revise-2': `${DRAFT}\n\nRevision 2.\n\nDECLINED: ${idX}: Section two states the limit; see its third sentence.`,
  } });
  assert.equal(rounds(report)[0], 3, 'escalated at pass w = 3, not before');
  assert.equal(served.includes('panel-2-mid-beta') || served.includes('panel-3-mid-beta'), false, 'layer 2 was not asked in the passes before the escalation');
});

test('PO-2 T7b: an unrelated objection added in pass 2 does not restart X\'s count: X is escalated at pass 2 ALONE, Y stays with its judge, and the row records the passes', async () => {
  const idY = objectionId(LOW, Y);
  const { report } = await run({ stall: 2, script: { 'panel-1-raiser-alpha': objects(N(X)), 'panel-2-raiser-alpha': objects(again(X), N(Y)), 'revise-1': `${DRAFT}\n\nRevision 1.` } });
  const e = report.escalations[0];
  assert.equal(e.round, 2);
  assert.deepEqual(e.ids, [idX], 'only the stalled objection went up');
  assert.equal(e.ids.includes(idY), false);
  assert.deepEqual(e.stalled, [{ id: idX, lab: LOW, layer: 1, passes: [1, 2] }]);
});

test('PO-3 T7c: a "continues" amendment that rewords the problem keeps the count: the escalation is at pass 2', async () => {
  const { report } = await run({ stall: 2, held: { ...INJECT, ...W6, ...DEMAND }, script: {
    'panel-1-raiser-alpha': objects({ ...X, relation: 'new' }),
    'panel-2-raiser-alpha': objects({ ...X, problem: 'Retries have no stated limit.', relation: `continues ${idX}` }),
  } });
  assert.equal(rounds(report)[0], 2);
  assert.deepEqual(report.escalations[0].ids, [idX], 'one id throughout the amendment');
});

test('PO-4 T7d: the writer changes the quoted passage in pass 2: the count restarts, so there is NO escalation at pass 2', async () => {
  const { report } = await run({ stall: 2, script: { 'panel-1-raiser-alpha': objects(N(X)), 'panel-2-raiser-alpha': objects(again(X)), 'revise-1': 'The worker caps its attempts at three.' } });
  assert.equal(rounds(report).includes(2), false, 'the passage the objection quotes is gone from the draft: not an unchanged response');
});

test('PO-5 T7f: a "continues" amendment with a DIFFERENT normalised passage keeps the id and restarts the count: no escalation at pass 2, one at pass 3', async () => {
  const amended = { ...Y, problem: 'The owner is not named, and neither is the retry owner.', relation: `continues ${idX}` };
  const { report } = await run({ stall: 2, held: { ...INJECT, ...W6, ...DEMAND }, script: {
    'panel-1-raiser-alpha': objects({ ...X, relation: 'new' }), 'panel-2-raiser-alpha': objects(amended), 'panel-3-raiser-alpha': objects(amended),
  } });
  assert.equal(rounds(report).includes(2), false, 'restarted by the new passage');
  assert.equal(rounds(report)[0], 3, 'the count of the amended passage reaches w at pass 3');
  assert.deepEqual(report.escalations[0].ids, [idX], 'the id was kept');
});

test('PO-6 Q-a: the escalation lasts ONE pass: after a sustain at layer 2 the next pass starts at layer 1 again', async () => {
  const idB = objectionId('mid-beta', X);
  const { report, served } = await run({ stall: 2, upper: ['mid-beta', 'mid-delta'], script: {
    'panel-1-raiser-alpha': objects(N(X)), 'panel-2-raiser-alpha': objects(again(X)), 'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idX}: The limit is set in section two.`,
    'rule-3-mid-beta': rules([{ id: idX, ruling: 'sustain', reason: 'The limit is not stated.' }]), 'rule-3-mid-delta': rules([{ id: idX, ruling: 'overrule', reason: 'It is stated.' }]),
    'panel-4-mid-beta': meets(withdraws(idB)),
  } });
  assert.equal(served.includes('panel-4-raiser-alpha'), true, 'layer 1 is asked in pass 4');
  assert.equal(/4\.1:escalated/.test(states(report)), false, 'layer 1 is not parked: SE-2 pinned "4.1:escalated"');
  assert.match(states(report), /3\.1:escalated 3\.2:objected/, 'pass 3 was the escalation pass: layer 1 was passed over in it');
});

test('PO-7 T7e: layer 2, in the escalation pass, raises an objection of its own rated 5.0: a revision, layer 3 is NOT asked in that pass, and pass 4 starts at layer 1', async () => {
  const rated = { ...X, severity: 5 };
  const own = { ...Y, severity: 5.0 };
  const { report, served } = await run({ stall: 2, held: { ...INJECT, ...DEMAND }, script: {
    'panel-1-raiser-alpha': objects(N(rated)), 'panel-2-raiser-alpha': objects(again(rated)), 'panel-3-mid-beta': objects(N(own)),
  } });
  assert.match(states(report), /3\.1:escalated 3\.2:objected 3\.3:not_asked/);
  assert.equal(served.includes('panel-3-top-gamma'), false, 'layer 3 was not asked in the pass');
  assert.equal(served.includes('revise-3'), true, 'the writer revised for layer 2\'s own objection');
  assert.equal(served.includes('panel-4-raiser-alpha'), true, 'the restart is at layer 1');
});

test('PO-8 R9: layer 2 objects Y in pass 1, sits out pass 2 (layer 1 objected), objects Y again in pass 3: two verdicts of layer 2 reach w = 2, the stall fires at pass 3 and goes to layer 3', async () => {
  const idZ = objectionId(LOW, Z);
  const { report } = await run({ stall: 2, script: {
    'panel-1-mid-beta': objects(N(Y)),
    'panel-2-raiser-alpha': objects(N(Z)),
    'panel-3-raiser-alpha': meets(withdraws(idZ)), 'panel-3-mid-beta': objects(again(Y, 'mid-beta')),
  } });
  assert.deepEqual(report.escalations.map(e => [e.round, e.from_layer, e.to_layer]), [[3, 2, 3]]);
  assert.deepEqual(report.escalations[0].stalled.map(s => [s.layer, s.passes]), [[2, [1, 3]]], 'the passes are those of layer 2\'s own verdicts');
});

test('PO-9 R10: on a layered chain WITHOUT overseer rounds the whole run is one round: an id sent up once is not sent up again, and layer 1 is asked in every later pass (an undecided ruling; the shape of chains/mock-layered.json)', async () => {
  const { report, served, config } = await run({ stall: 2, script: {
    'panel-1-raiser-alpha': objects(N(X)), 'panel-2-raiser-alpha': objects(again(X)), 'panel-3-top-gamma': objects(N(Z)),
    'panel-4-raiser-alpha': objects(again(X)), 'panel-5-raiser-alpha': objects(again(X)), 'panel-6-raiser-alpha': objects(again(X)),
  } });
  assert.equal(config.maxOverseerRounds, undefined, 'fixture: layered, dispute.enabled, no overseer rounds (mock-layered\'s shape)');
  assert.equal(config.dispute.enabled, true);
  assert.equal(report.escalations.length, 1, 'X was sent up once (pass 2) and stands unchanged in passes 4 to 6: not sent up again');
  assert.equal(served.includes('panel-6-raiser-alpha'), true, 'layer 1 was asked in pass 6: the layers below are not parked after the escalation pass');
});

test('PO-10 w = 2 on a chain WITHOUT layers (the shape of daily7-sub-a at a window of 2, now in chains/outdated/; this row builds its own config): X is quoted and present in the draft of rounds 1 and 2, so the stall ends the review at round 2 as dispute.reason "stalled"', async () => {
  setPromptSpy(() => {});
  setCache({ invalidate() {}, get(label) {
    const text = label === 'panel-1-raiser-alpha' ? objects(N(X)) : label === 'panel-2-raiser-alpha' ? objects(again(X)) : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-unlayered', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 6,
    seats: { builder, reviser: builder, critics: [{ provider: 'mock', model: 'mock-review-fixture', lab: LOW, maxTokens: 3000 }] } };
  assert.equal(config.seats.critics.some(c => c.layer !== undefined), false, 'fixture: no layers');
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-po-unlayered', log: () => {}, config });
  assert.equal(result.dispute.reason, 'stalled');
  assert.equal(result.dispute.stopped_at_round, 2);
});
