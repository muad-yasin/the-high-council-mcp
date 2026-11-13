// 0.8.4 S2 (Q12; RU-S2-10..25, D10, D18; T12a-T12p, G4): the identity of a blind-review failure and the relation a judge declares for it. Offline, $0: a cache stub answers every stage by its label (the stall-escalation tests' pattern), so
// the judges object, withdraw and sign off exactly when the script says. The relation wording W6 is HELD (test/held-prompts/held-084-b.js `relationRule`): every row that needs the assigner injects it. Without it ids are the pure derived key (pinned below).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as IDS from '../src/objection-ids.js';
import { objectionId } from '../src/objection-ids.js';
import { idSlipsOf } from '../src/near-json.js';
import { parseDisputes } from '../src/draft-disputes.js';
import * as HB084 from './held-prompts/held-084-b.js';

afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); IDS.setIdCriteria?.(null); });
const W6 = { relationRule: HB084.relationRule };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried a `relation` but no `severity`. NEW: each carries `severity: 5` (the chain is layered and unanimous, so the rating demand refuses a failure with none; 5 holds the sign-off as an unrated one did; the ids do not read it). WHY: ratingDemand recorded (src/ratings-demand.js, chain.js:1237).
const Q = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', severity: 5 };       // a quoted objection
const U1 = { criterion: CRITERION, problem: 'The limit is not stated.', severity: 5 };                                       // two unquoted complaints under one criterion
const U2 = { criterion: CRITERION, problem: 'The back-off is not stated.', severity: 5 };
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const meets = (answers) => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], ...(answers ? { answers } : {}), verdict_line: 'ok' });
const withdraws = id => [{ id, status: 'withdrawn', evidence: 'The plan now reads "Revision 1." at its end.' }];

async function run({ script, maxRounds = 3, held = W6, critics = ['a'], mid = true, answerBack = true } = {}) {
  const served = [];
  setHeldForTest(held);
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-ids', criteria: [CRITERION], signoff: 'unanimous', ...(answerBack ? { answer_back: { enabled: true } } : {}), maxRounds,
    seats: { builder, reviser: builder, critics: [...critics.map(l => seat(l, 1)), ...(mid ? [seat('mid', 2), seat('top', 3)] : [])] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-ids', log: () => {}, config });
  return { result, served };
}
const idsOf = (result, lab = 'a') => result.lastCritique.failures.filter(f => f.lab === lab).map(f => f.id);
const idQ = objectionId('a', Q); const idU = objectionId('a', U1);

test('T12a: two different unquoted complaints under one criterion in one reply get two ids (the second takes #2, "same key")', async () => {
  const { result } = await run({ maxRounds: 1, script: { 'panel-1-a': objects({ ...U1, relation: 'new' }, { ...U2, relation: 'new' }) } });
  assert.deepEqual(idsOf(result), [idU, `${idU}#2`]);
  assert.deepEqual(result.lastCritique.failures.map(f => f.same_key), [undefined, true]);
});
test('T12f: two new quoted objections of one seat that derive the same key: the second takes #2', async () => {
  const { result } = await run({ maxRounds: 1, script: { 'panel-1-a': objects({ ...Q, relation: 'new' }, { ...Q, problem: 'No back-off either.', relation: 'new' }) } });
  assert.deepEqual(idsOf(result), [idQ, `${idQ}#2`]);
});
// RESTORED (C&C GO "answer back off", 5d5a5ca5): the row that held on the base ('before W6 is recorded the ids are the pure derived key') describes a SHIPPED path again: a unanimous panel chain with answer_back off is not asked for a relation and the assigner does not run, so its ids are the pure derived key (the 0.8.3 way). OLD: setHeldForTest(null). NEW: the chain has answer_back off; the recorded relationRule is live and changes nothing there.
test('answer_back off: the ids are the pure derived key: one id for both complaints, no suffix, no relation read (the 0.8.3 way)', async () => {
  const { result } = await run({ maxRounds: 1, answerBack: false, script: { 'panel-1-a': objects({ ...U1 }, { ...U2 }) } });
  assert.deepEqual([idsOf(result), result.lastCritique.failures.map(f => f.same_key)], [[idU, idU], [undefined, undefined]]);
});

const badReply = relation => objects({ ...Q, relation });
const unreadableRun = relation => run({ maxRounds: 1, script: { 'panel-1-a': badReply(relation), 'panel-1-a-reask1': badReply(relation), 'panel-1-a-reask2': badReply(relation), 'panel-1-a-solo': badReply(relation) } });   // every ask of the seat repeats the bad reply, the ladder's one solo ask included
test('T12b: "continues" naming an id that is not this seat\'s own standing one: an unreadable reply on the EXISTING bound (one ask and two counted re-asks, no separate allowance for the relation), then the one solo ask of a silent judge, no fifth; the seat ends unheard', async () => {
  const { served, result } = await unreadableRun('continues O-ffffffff');
  assert.deepEqual([served.filter(l => /^panel-1-a/.test(l)), result.panelVerdicts.find(v => v.round === 1 && v.lab === 'a').verdict], [['panel-1-a', 'panel-1-a-reask1', 'panel-1-a-reask2', 'panel-1-a-solo'], 'unheard']);
});
test('T12b: ... a relation that cannot be read at all is the same unreadable reply', async () => {
  const { served } = await unreadableRun('maybe');
  assert.ok(served.includes('panel-1-a-reask1'));
});
test('RU-S2-20 (D18): once W6 is recorded, a failure with no relation field is an unreadable reply too', async () => {
  const { served } = await run({ maxRounds: 1, script: { 'panel-1-a': objects({ ...Q }) } });
  assert.ok(served.includes('panel-1-a-reask1'));
});

// the timeline of a withdrawal: pass 1 a objects Q; pass 2 a withdraws it (a quote of the revised plan) and mid objects to something else; pass 3 is the one under test
const afterWithdrawal = (pass3) => ({ maxRounds: 3, script: {
  'panel-1-a': objects({ ...Q, relation: 'new' }),
  'panel-2-a': meets(withdraws(idQ)),
  'panel-2-mid': objects({ criterion: CRITERION, problem: 'Something else.', severity: 5, relation: 'new' }),
  'panel-3-a': pass3,
} });
test('T12c: "reopens" an id the seat withdrew: a new linked id (#r2); the withdrawal stays on the record', async () => {
  const { result } = await run(afterWithdrawal(objects({ ...Q, problem: 'No limit again.', relation: `reopens ${idQ}` })));
  const f = result.lastCritique.failures.find(x => x.lab === 'a');
  assert.deepEqual([f.id, f.reopens], [`${idQ}#r2`, idQ]);
});
test('T12c: ... and the withdrawal row is still there (never undone silently)', async () => {
  const { result } = await run(afterWithdrawal(objects({ ...Q, problem: 'No limit again.', relation: `reopens ${idQ}` })));
  assert.ok(result.answerBackReplies.some(r => r.id === idQ && r.lab === 'a' && r.effect === 'withdrawn'));
});
test('T12h: a new quoted objection that shares the criterion and the quoted passage of a withdrawn one but has a DIFFERENT problem text, declared new: the suffix #2, not reopens', async () => {
  const { result } = await run(afterWithdrawal(objects({ ...Q, problem: 'A different problem entirely.', relation: 'new' })));
  const f = result.lastCritique.failures.find(x => x.lab === 'a');
  assert.deepEqual([f.id, f.same_key, f.reopens], [`${idQ}#2`, true, undefined]);
});
test('RU-S2-18: the SAME problem text under a withdrawn key, with no declaration, is recorded as reopens and linked (#r2)', async () => {
  const { result } = await run(afterWithdrawal(objects({ ...Q, relation: 'new' })));
  const f = result.lastCritique.failures.find(x => x.lab === 'a');
  assert.deepEqual([f.id, f.reopens], [`${idQ}#r2`, idQ]);
});

// the same reply withdraws an id and raises it again (G4, ruled 4 Nov 2026: option B)
const sameReply = failure => run({ maxRounds: 2, script: { 'panel-1-a': objects({ ...Q, relation: 'new' }), 'panel-2-a': JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: [failure], answers: withdraws(idQ), verdict_line: 'no' }) } });
test('T12d: a reply that withdraws an id and raises it again (the same text, declared new): an unreadable reply, and nothing reaches the withdrawal record', async () => {
  const { served, result } = await sameReply({ ...Q, relation: 'new' });
  assert.deepEqual([served.includes('panel-2-a-reask1'), result.answerBackReplies.some(r => r.effect === 'withdrawn')], [true, false]);
});
test('T12d: ... declared "reopens" of the id it withdraws: unreadable too', async () => {
  const { served } = await sameReply({ ...Q, relation: `reopens ${idQ}` });
  assert.ok(served.includes('panel-2-a-reask1'));
});
test('G4: ... declared "continues" of the id it withdraws: unreadable too (continues names an id this reply makes not-standing)', async () => {
  const { served } = await sameReply({ ...Q, relation: `continues ${idQ}` });
  assert.ok(served.includes('panel-2-a-reask1'));
});
test('G4: ... a failure with the key of the id the reply withdraws but a DIFFERENT text, declared new, is a new objection #2; the withdrawal stands', async () => {
  const { result } = await sameReply({ ...Q, problem: 'A different problem entirely.', relation: 'new' });
  const f = result.lastCritique.failures.find(x => x.lab === 'a');
  assert.deepEqual([f.id, f.same_key, result.answerBackReplies.some(r => r.id === idQ && r.effect === 'withdrawn')], [`${idQ}#2`, true, true]);
});

test('T12i: two unquoted failures of one seat and criterion in different passes, the second declared new: the second takes #2 with the note "same key"', async () => {
  const { result } = await run({ maxRounds: 2, script: { 'panel-1-a': objects({ ...U1, relation: 'new' }), 'panel-2-a': objects({ ...U2, relation: 'new' }) } });
  const f = result.lastCritique.failures.find(x => x.lab === 'a' && x.problem === U2.problem);
  assert.deepEqual([f.id, f.same_key], [`${idU}#2`, true]);
});
// M0 FIX 5 (C&C's ruling (C), 4 Nov 2026): the row (FEATURE_SPECS l.235) says 'one id and the count kept'. The ID half is M0's and is asserted here; the COUNT is Q13's per-objection stall count, built at S5/M2 (T7a, T7f), and the M0 stall signature ignores ids (objection-ids.js objectionKey: lab + criterion + quote), so no stall figure can show it yet. The count half goes with T7f.
test('T12p: ... declared "continues" instead: one id, no suffix', async () => {
  const { result } = await run({ maxRounds: 2, script: { 'panel-1-a': objects({ ...U1, relation: 'new' }), 'panel-2-a': objects({ ...U2, relation: `continues ${idU}` }) } });
  const f = result.lastCritique.failures.find(x => x.lab === 'a' && x.problem === U2.problem);
  assert.deepEqual([f.id, f.same_key], [idU, undefined]);
});

test('T12e: a supporter raises the withdrawn objection\'s defect with the relation new: its own id and a see-also pointer to the withdrawn one, never a merge', async () => {
  const { result } = await run({ critics: ['a', 'b'], maxRounds: 3, script: {
    'panel-1-a': objects({ ...Q, relation: 'new' }), 'panel-1-b': meets(),
    'panel-2-a': meets(withdraws(idQ)), 'panel-2-b': meets(), 'panel-2-mid': objects({ criterion: CRITERION, problem: 'Something else.', severity: 5, relation: 'new' }),
    'panel-3-a': meets(), 'panel-3-b': objects({ ...Q, relation: 'new' }),
  } });
  const f = result.lastCritique.failures.find(x => x.lab === 'b');
  assert.deepEqual([f.id === idQ, f.id === objectionId('b', Q), f.see_also], [false, true, idQ]);
});

test('resume: the same script run twice in one process mints the same suffixed ids (the assigned ids are rebuilt by the replay, not carried over)', async () => {
  const again = () => run({ maxRounds: 1, script: { 'panel-1-a': objects({ ...U1, relation: 'new' }, { ...U2, relation: 'new' }) } }).then(({ result }) => idsOf(result));
  assert.deepEqual(await again(), await again());
});

// RU-S2-10 (C&C's repair-lane ruling; NOT gated on W6): a retyped criterion hashes the LIST criterion it resolves to
const LIST = ['The plan defines a retry limit.', 'The plan names its owner.', 'The plan states what happens on a timeout.'];
const idFor = criterion => objectionId('a', { criterion, problem: 'p' });
test('RU-S2-10: with the list registered, an exact match, a unique loose match (a trimmed or extended text) and a leading number that agrees all give the id of the list criterion', () => {
  IDS.setIdCriteria(LIST);
  const want = idFor(LIST[0]);
  assert.deepEqual([idFor('the plan defines a retry limit'), idFor('The plan defines a retry limit'), idFor('1. The plan defines a retry limit'), idFor('The plan defines a retry limit. (It must also be small.)')], [want, want, want, want]);
});
test('RU-S2-10: ... text that fits no criterion, or several, keeps its own text (a different id)', () => {
  IDS.setIdCriteria(LIST);
  assert.deepEqual([idFor('The plan uses a queue.') !== idFor(LIST[0]), idFor('The plan') !== idFor(LIST[0]), idFor('The plan') !== idFor(LIST[1])], [true, true, true]);   // 'The plan' fits all three criteria loosely, so it resolves to none and keeps its own text
});
test('RU-S2-10: ... with no list registered the id reads the typed text, as before', () => {
  IDS.setIdCriteria(null);
  assert.notEqual(idFor('The plan defines a retry limit. (It must also be small.)'), idFor(LIST[0]));   // the same extended text resolves to the list criterion when the list is registered (the first RU-S2-10 test)
});

// the suffix as structure
test('idSlipsOf: a suffix is structure, never a slipped letter: #3 against a shown #2 is no slip, a slipped base with the same suffix is', () => {
  assert.deepEqual(idSlipsOf(['O-aaaaaaaa#3'], ['O-aaaaaaaa#2']), []);
  assert.deepEqual(idSlipsOf(['O-aaaaaaa0#2'], ['O-aaaaaaa1#2']), [{ from: 'O-aaaaaaa0#2', to: 'O-aaaaaaa1#2' }]);
});
test('a DECLINED line may name a suffixed id', () => {
  const d = parseDisputes('Revised text.\n\nDECLINED: O-aaaaaaaa#2: out of scope.', { withIds: true });
  assert.deepEqual([d.disputeIds, d.disputes], [['O-aaaaaaaa#2'], ['out of scope.']]);
});
