// B2 (debate-084/b2, A-DRAFT wording): the exchange inside layer 1 (src/layer-debate.js, runChain's layerExchange). Offline, mock seats only, $0. `mock-exch-<post>-<reply>` (src/providers.js) objects like the default scripted
// critic and, in the exchange, posts <post> on every objection it is shown and answers its own posts with <reply>.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, exchangeRound, RoundStopped, setCache, setBudget, setProgressHook, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { readPosts, readReplies, outcomeOf, exchangeObjections } from '../src/layer-debate.js';
import * as LD from '../src/layer-debate.js';   // the 0.8.4 exports (minorityNotesOf, OUTCOMES) are read through the namespace, so a tree without them fails those tests alone and not the whole file
import { objectionId, recordAssignedId, resetAssignedIds } from '../src/objection-ids.js';
import { reportJsonShape } from '../src/report-shape.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { promptHashOf } from '../src/cache-integrity.js';
import { estimateChainRows } from '../src/cost.js';
import { lintChain } from '../src/chain-lint.js';
import { chainLintLines } from '../src/run-preflight.js';
import { objectionLedger } from '../src/objection-ledger.js';
import { overseerLedgerSection } from '../src/roles.js';
import { escalatedSignoffBlock } from '../src/escalation.js';
import { effectiveLimits, roundChoiceEntry } from '../src/overseer-rounds.js';

afterEach(() => { setCache(null); setBudget(null); setProgressHook(null); setPromptSpy(null); setHeldForTest(null); });

const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = (critics, extra = {}) => ({
  name: 'layer-debate-test', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
  ...extra,
});
const go = async (config) => {
  const lines = []; const seen = [];
  setPromptSpy(p => seen.push(p));
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-layer-debate', config });
  return { r, log: lines.join('\n'), seen };
};
const labels = r => r.stages.map(s => s.label);
// CHANGED ACCEPTED (0.8.4 N9, C&C's ruling 4, and the removal of `layer_debate.enabled`). OLD: the file had constants R1, R2(n) and R7 that set `layer_debate.rounds` (1, n and 7 rounds), and ON = { layer_debate: { enabled: true } }. NEW: the rounds constants are gone and ON is the plain chain `{}`: the exchange has no switch and no number of rounds, it is part of every layered chain with "signoff": "unanimous" and runs N9's own loop. WHY: there is nothing to set; `ON` stays as the name of the tests' extra config so every call site reads as before, and a test that needs the exchange NOT to run builds a chain where it cannot (one judge on the lowest layer, or no standing objection). Covers the tests that read R2(n) / R7 / R1: the rounds, T3a/T3c, T22al, RU-S3-60/66/71/83/88, NEW-A2-1 and the rest.
const ON = {};
const TABLE = { signoff_table: { required: true } };
const RETAINED = { answer_back: { enabled: true }, ...TABLE };

test('exchange: a withdrawn objection leaves the pass, its raiser counts as signed off after the exchange, the other stays and reaches the reviser with the posts', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-withdraw', 'e2', 1), seat('mock-critic-x', 'e3', 2)], ON));
  // CHANGED ACCEPTED (0.8.4 S3, Q1(b), T1a / T4f; RU-S3-19). OLD: lreply-1-e1 was called although e1's objection drew only a support post (a reply followed any post but no view). NEW: a layer-1 raiser is asked to reply only after a counted contest or insufficient-evidence post, so e1, supported by e2 and contested by nobody, is not asked. WHY: Q1(b) names the contest and the insufficient-evidence post; a head count of supports asks for nothing.
  // CHANGED ACCEPTED (0.8.4 N9, C&C's ruling 4: the exchange runs round after round until a round changes nothing, and always a second round on layer 1). OLD: three exchange calls. NEW: four: ['ldebate-1-e1', 'ldebate-1-e2', 'ldebate-1-x2-e2', 'lreply-1-e2']. WHY: e2's withdrawal changed round 1, so a second round ran, in which e2 read e1's objection again (e1 has nothing left to read).
  assert.deepEqual(labels(r).filter(l => /^(ldebate|lreply)-/.test(l)).sort(), ['ldebate-1-e1', 'ldebate-1-e2', 'ldebate-1-x2-e2', 'lreply-1-e2']);
  const d = r.layerDebates[0];
  assert.equal(d.pass, 1); assert.equal(d.layer, 1);
  const byRaiser = Object.fromEntries(d.objections.map(o => [o.raised_by, o]));
  assert.equal(byRaiser.e2.outcome, 'withdrawn_argued', 'e1 contested it with a quote and a reason; e2 withdrew with a reason');
  assert.equal(byRaiser.e1.outcome, 'stands_uncontested', 'e2 supported it, so nothing stands against it');
  assert.deepEqual(d.cleared, ['e2']);
  const e2v = r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e2');
  assert.deepEqual([e2v.verdict, e2v.exchange_cleared], ['signed_off', true], 'the verdict enum stays closed; the marker says how it came about');
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e1').verdict, 'objected');
  assert.equal(r.signoff.find(s => s.lab === 'e2')?.exchange_cleared, undefined, 'the final pass is a clean one; the marker belongs to the pass it happened in');
  const revise = seen.find(p => p.label === 'revise-1');
  assert.match(revise.user, /# What the other reviewers of the layer said about these objections/);
  const e1id = objectionId('e1', { criterion: 'It states the assumptions it was written under.' });
  assert.ok(revise.user.includes(e1id), 'the standing objection is listed by id');
  assert.ok(!revise.user.includes(objectionId('e2', { criterion: 'It states the assumptions it was written under.' }) + ' ('), 'a withdrawn objection is not in the reviser note');
});

test('exchange: the raiser is hidden - no lab or model name reaches a judge in the exchange prompts', async () => {
  const { seen } = await go(chainOf([seat('mock-exch-contest-keep', 'zz-lab-one', 1), seat('mock-exch-support-withdraw', 'zz-lab-two', 1), seat('mock-critic-x', 'e3', 2)], ON));
  const exch = seen.filter(p => /^(ldebate|lreply)-/.test(p.label));
  assert.equal(exch.length, 4);   // CHANGED ACCEPTED (0.8.4 S3, Q1(b)). OLD: 4 exchange calls. NEW: 3 (two posts and one reply: e1's objection drew only a support). WHY: a reply follows a counted contest or insufficient-evidence post only (T1a). CHANGED ACCEPTED AGAIN (0.8.4 N9, ruling 4). OLD: 3. NEW: 4 (the withdrawal changed round 1, so e2 reads e1's objection once more in a second round). WHY: the loop runs until a round changes nothing.
  for (const p of exch) { assert.ok(!/zz-lab|mock-exch/.test(p.system + p.user), `${p.label} names a lab or a model`); }
});

test('exchange: every objection withdrawn -> the layer signs off in the same pass and layer 2 is asked', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-withdraw', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  assert.deepEqual(r.layerDebates[0].cleared.sort(), ['e1', 'e2']);
  assert.deepEqual(r.layers.filter(x => x.round === 1).map(x => `${x.layer}:${x.state}`), ['1:signed_off', '2:objected']);
  assert.ok(labels(r).includes('panel-1-e3'), 'layer 2 was asked');
});

test('exchange: a head count closes nothing - three supporters and a raiser who keeps it: the objection stands', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-exch-support-keep', 'e3', 1), seat('mock-critic-x', 'e4', 2)], { ...ON, maxRounds: 1 }));
  assert.ok(r.layerDebates[0].objections.every(o => o.outcome === 'stands_uncontested'));
  assert.equal(r.layerDebates[0].cleared, undefined);
});

test('exchange: a contested objection its raiser keeps is recorded stands_contested, with both sides', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], ON));
  const o = r.layerDebates[0].objections[0];
  assert.equal(o.outcome, 'stands_contested');
  assert.equal(o.posts[0].stance, 'contest'); assert.equal(o.posts[0].counted, true); assert.equal(o.reply.action, 'keep');
  assert.match(seen.find(p => p.label === 'revise-1')?.user ?? '', /contested it/);
});

test('exchange: a new material defect named in a post becomes that judge\'s own objection, recorded for the next pass', async () => {
  const { r } = await go(chainOf([seat('mock-exch-new-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  const d = r.layerDebates[0];
  assert.equal(d.new_objections.length, 1); assert.equal(d.new_objections[0].by, 'e1');
  const e1 = r.signoff.find(s => s.lab === 'e1');
  assert.ok(e1.objections.some(f => f.from_exchange === true), 'the new objection is among e1\'s failures');
  const named = d.objections.find(o => o.from_exchange);
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: 'not_debated' (named in the only round, no judge read it). NEW: 'stands_uncontested': a new objection is a change, so a second round runs and e2 reads it and supports it. WHY: with no number of rounds to set, a defect is named in the last round only when the stop at seven is reached (T3c, the seventh round).
  assert.equal(named.outcome, 'stands_uncontested', 'named in round 1, read by e2 in round 2');
});

test('exchange: an unreadable post reply counts no posts and every objection stands', async () => {
  const { r, log } = await go(chainOf([seat('mock-exch-garbled-keep', 'e1', 1), seat('mock-exch-garbled-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  assert.match(log, /unreadable exchange reply - no posts counted/);
  // CHANGED ACCEPTED (B2 fix-up A, 29 Okt 2026). OLD: outcome 'upheld'. NEW: 'not_debated'. WHY: an objection nobody posted on was reported as upheld with 0 supporters and 0 contests, which reads to the writer as nobody disagreed; it was not debated.
  // CHANGED ACCEPTED AGAIN (0.8.4 S3, RU-S1-15 and Q4(a); Mini-C&C ruling 7 of 4 Nov 2026). OLD: 'not_debated'. NEW: 'stands_uncontested', with every omitted post listed on the row (`omitted`, reason 'unreadable'). WHY: the Q1 outcome table gives not_debated only to an objection "raised or amended in a round with no round after it"; an omitted post counts as no view, flagged (Q4(a)). The handler is not left to read 'uncontested' as 'read': the row names each judge whose reply could not be read.
  assert.ok(r.layerDebates[0].objections.every(o => o.outcome === 'stands_uncontested' && o.posts.length === 0 && o.omitted.length === 2 && o.omitted.every(x => x.why === 'unreadable')), 'nobody posted (an omitted post in each of the two rounds, CHANGED ACCEPTED 0.8.4 N9: the second round always runs): the outcome is the table\'s, and each missing post is listed with its reason');
  assert.ok(!labels(r).some(l => l.startsWith('lreply-')), 'nobody posted, so nobody is asked to answer');
});

// CHANGED ACCEPTED (0.8.4, `layer_debate.enabled` removed). OLD: 'off by default - no exchange label, no layerDebates, the verdicts are the blind ones' (two layer-1 judges that object, a chain with no switch). NEW: the case where the exchange cannot run that still exists: no standing objection. Both layer-1 judges sign off, so there is nothing to read: no exchange label, no layerDebates, the verdicts are the blind ones; layer 1 signs off and layer 2 is asked. WHY: a layered unanimous chain with two judges and an objection now runs the exchange, so "off by default" has no chain to describe; the single-judge case is the next test.
test('exchange: with no standing objection there is nothing to read - no exchange label, no layerDebates, the verdicts are the blind ones', async () => {
  const { r } = await go(chainOf([seat('mock-critic-script-o-nox1', 'e1', 1), seat('mock-critic-script-o-nox2', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { maxRounds: 1 }));
  assert.ok(!labels(r).some(l => /^(ldebate|lreply)-/.test(l)));
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: `r.layerDebates` was undefined where no layer-1 judge stands (also in T4a). NEW: layer 2's one judge now gets the shortened exchange's row with `not_run: 'fewer_than_two_heard'` (layer 2, no post, no call); no exchange label is made (K6; WAITING list: none). WHY: shortExchangeRule and signoffLineRule are recorded (shortExchangeOn(), chain.js:5816).
  assert.ok(r.layerDebates.length >= 1 && r.layerDebates.every(d => d.layer === 2 && d.not_run === 'fewer_than_two_heard'));
  assert.deepEqual(r.layers.filter(x => x.round === 1).map(x => `${x.layer}:${x.state}`), ['1:signed_off', '2:objected']);
});

test('exchange: a single heard judge has nobody to read its objection - no exchange, and the writer is told it was not debated', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 2 }));
  // CHANGED ACCEPTED (0.8.4 S3, Q4(d), T22ae). OLD: `r.layerDebates` was undefined (no exchange, no row). NEW: one row with `not_run: 'fewer_than_two_heard'` that lists the objection flagged not_debated, no post, in pass 1 (a layer of one seat is the same case: NEW-A2-1). WHY: where the exchange cannot run for want of two heard judges the standing objections are recorded flagged not_debated and never claimed debated; the writer's note below is unchanged.
  assert.deepEqual(r.layerDebates?.[0] && [r.layerDebates[0].pass, r.layerDebates[0].not_run, r.layerDebates[0].objections.map(o => [o.raised_by, o.outcome, o.posts.length])], [1, 'fewer_than_two_heard', [['e1', 'not_debated', 0]]]);
  assert.match(seen.find(p => p.label === 'revise-1').user, /\(not debated\): no other reviewer of its layer has posted support, contest or insufficient evidence on it against this draft/);
});

// CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: `new-keep` named the defect in round 1 with at most two passes. NEW: the T3c scenario (a defect first named in round 7, the last round that runs) with two passes, so the writer is asked. WHY: a defect named in round 1 is read in round 2; only one named at the stop is not debated.
test('exchange: a defect named in a post in the last allowed round (the seventh) reaches the writer marked as not debated', async () => {
  const { seen } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-alt-keep-id-t10-clean', 'e2', 1), seat('mock-exch-new7-keep-id-t10-clean', 'e3', 1), seat('mock-critic-x', 'e9', 2)], { ...ON, maxRounds: 2 }));
  assert.match(seen.find(p => p.label === 'revise-1').user, /\(not debated\)/);
});

test('report.json: layer_debates is additive and present only when an exchange ran', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  const shape = reportJsonShape({ runId: 'r-layer-debate', chain: 'layer-debate-test', task: 'task.md', result: r });
  assert.ok(Array.isArray(shape.layer_debates) && shape.layer_debates.length === 1);
});

test('exchange: a judge whose objections were all withdrawn counts as signed off only with a complete table - without one it is an abstention', async () => {
  const { r, log } = await go(chainOf([seat('mock-exch-contest-withdraw-short', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...TABLE, maxRounds: 1 }));
  assert.match(log, /every objection was withdrawn, but its table is incomplete/);
  assert.equal(r.panelVerdicts.find(v => v.lab === 'e1').verdict, 'unheard');
  assert.ok(r.signoffTableGaps.some(g => g.lab === 'e1' && g.stage === 'exchange'));
  assert.equal(r.panelVerdicts.find(v => v.lab === 'e1').exchange_cleared, undefined);
});

test('exchange: with a complete table the cleared judge is recorded signed_off with exchange_cleared, and the layer signs off', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-withdraw', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...TABLE, maxRounds: 1 }));
  const rows = r.panelVerdicts.filter(v => v.round === 1 && v.layer === 1);
  assert.deepEqual(rows.map(v => [v.lab, v.verdict, v.exchange_cleared]), [['e1', 'signed_off', true], ['e2', 'signed_off', true]]);
  assert.equal(r.layers.find(x => x.round === 1 && x.layer === 1).state, 'signed_off');
});

test('exchange (answer_back on): a withdrawn objection is a reply row from the exchange, and its raiser is not shown it in the next pass', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 2 }));
  const gone = r.layerDebates[0].objections.find(o => o.raised_by === 'e1');
  assert.equal(gone.outcome, 'withdrawn_argued');
  assert.ok(r.answerBackReplies.some(x => x.id === gone.id && x.lab === 'e1' && x.effect === 'withdrawn_exchange'));
  const next = seen.find(p => p.label === 'panel-2-e1');
  assert.ok(next, 'pass 2 asked e1');
  // CHANGED ACCEPTED (B2 fix-up C, 29 Okt 2026). OLD: the id appears nowhere in the next prompt. NEW: it appears only in the information block 'Objections you withdrew in your layer's exchange', never among the open objections. WHY: C&C ruling 4 (a judge sees its withdrawn ids with its own reason, so a re-raise is a knowing one).
  assert.ok(!next.user.split('# Objections you withdrew')[0].includes(gone.id), 'the withdrawn objection is not put back to its raiser as an open objection');
});

test('readPosts: a contest counts only with a reason and a quote found in the plan (spacing next to punctuation ignored)', () => {
  const shown = [{ id: 'O-aaaaaaaa' }, { id: 'O-bbbbbbbb' }, { id: 'O-cccccccc' }, { id: 'O-dddddddd' }];
  const draft = 'The service uses {2, 2} replicas and a queue.';
  const { posts, dropped } = readPosts({ posts: [
    { on: 'O-aaaaaaaa', stance: 'contest', quote: 'uses {2,2} replicas', text: 'Settled there.' },
    { on: 'O-bbbbbbbb', stance: 'contest', quote: 'it says so somewhere', text: 'Settled.' },
    { on: 'O-cccccccc', stance: 'contest', text: 'No quote at all.' },
    { on: 'O-dddddddd', stance: 'contest', quote: 'uses {2,2} replicas', text: '' },
    { on: 'O-zzzzzzzz', stance: 'support', text: 'x' },
    { on: 'O-aaaaaaaa', stance: 'support', text: 'second post on one id' },
  ] }, { shown, draft });
  assert.deepEqual(posts.map(p => [p.on, p.counted, p.why]), [['O-aaaaaaaa', true, undefined], ['O-bbbbbbbb', false, 'quote_not_in_plan'], ['O-cccccccc', false, 'no_quote'], ['O-dddddddd', false, 'no_reason']]);
  assert.deepEqual(dropped.map(d => d.reason), ['unknown_id', 'second_post']);
});

test('readReplies: a withdrawal with no reason is a keep, recorded unargued; ids the raiser does not hold are ignored', () => {
  const own = [{ id: 'O-aaaaaaaa' }, { id: 'O-bbbbbbbb' }];
  const out = readReplies({ replies: [{ id: 'O-aaaaaaaa', action: 'withdraw', text: '' }, { id: 'O-bbbbbbbb', action: 'amend', text: 'part', problem: 'narrower' }, { id: 'O-other', action: 'withdraw', text: 'x' }] }, { own });
  assert.deepEqual(out.map(r => [r.id, r.action, r.unargued === true, r.problem]), [['O-aaaaaaaa', 'keep', true, undefined], ['O-bbbbbbbb', 'amend', false, 'narrower']]);
  assert.equal(outcomeOf([{ counted: true, stance: 'contest' }], out[0]), 'stands_contested');
  assert.equal(outcomeOf([{ counted: true, stance: 'contest' }], { action: 'withdraw', text: 'r' }), 'withdrawn_argued');
  assert.equal(outcomeOf([{ counted: false, stance: 'contest' }, { counted: true, stance: 'support' }], null), 'stands_uncontested');
});

test('exchangeObjections: two problems under one id are one objection', () => {
  const out = exchangeObjections([{ key: 'a', failures: [{ criterion: 'C1', problem: 'p1' }, { criterion: 'C1', problem: 'p2' }] }], objectionId);
  assert.equal(out.length, 1); assert.equal(out[0].problem, 'p1 / p2');
});

// CHANGED ACCEPTED (0.8.4, `layer_debate.enabled` removed). OLD: 'with layer_debate the layer-1 judges get an ldebate row and an lreply row ...; off, none' (the `off` half was the same chain without the switch). NEW: a layered unanimous chain with two judges on the lowest layer always gets the rows; the `off` half is a chain whose lowest layer has ONE judge, where the exchange cannot run, and it gets none. WHY: there is no switch; the dry run prices the exchange where it can run (cost.js: two judges on the lowest layer).
test('dry-run estimate: a lowest layer with two judges gets an ldebate row and an lreply row per judge, on the layer-1 pass count; with one judge, none', () => {
  const critics = [seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  const base = { maxOverseerRounds: 2, layerRevisions: { 1: 3, 2: 1 } };
  for (const maximum of [false, true]) {
    const on = estimateChainRows(chainOf(critics, { ...base, ...ON }), { maximum }).map(r => r.label);
    const off = estimateChainRows(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-critic-x', 'e3', 2)], base), { maximum }).map(r => r.label);
    // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the four ordinary exchange rows in both figures. NEW: the same four, and in the MAXIMUM the four ending-exchange rows after them (ldebate-end-L1-e1, lreply-end-L1-e1, ldebate-end-L1-e2, lreply-end-L1-e2); the expected figure carries none (K6). WHY: lateFindingRule (W26) is recorded, so endingExchangeOn() is true (src/cost.js:850-858).
    assert.deepEqual(on.filter(l => /^l(debate|reply)-/.test(l)), maximum ? ['ldebate-L1-e1', 'lreply-L1-e1', 'ldebate-L1-e2', 'lreply-L1-e2', 'ldebate-end-L1-e1', 'lreply-end-L1-e1', 'ldebate-end-L1-e2', 'lreply-end-L1-e2'] : ['ldebate-L1-e1', 'lreply-L1-e1', 'ldebate-L1-e2', 'lreply-L1-e2']);
    assert.deepEqual(off.filter(l => /^l(debate|reply)-/.test(l)), []);
  }
  const rows = estimateChainRows(chainOf(critics, { ...base, ...ON }), { maximum: true });
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: the exchange rows have the layer-1 review's pass count (one round per pass). NEW: seven times it (the maximum counts every round N9 allows per pass). WHY: the number of rounds is not a setting any more; the expected figure stays one round.
  // MOVED BAR (exchange idea 2, C&C 10 Nov): the layer-1 exchange stops after 3 rounds, so the maximum counts three per layer-1 pass (it was seven)
  assert.equal(rows.find(r => r.label === 'ldebate-L1-e1').times, rows.find(r => r.label === 'panel-L1-e1').times * 3, 'three rounds per layer-1 pass');
});

test('ledger: an id raised in pass 1 and withdrawn in the exchange of pass 2 is CLOSED in the ledger the top layer reads (the reply row the exchange writes, fed as it is)', () => {
  const id = 'O-11111111';
  const reply = { round: 2, lab: 'e1', id, status: 'withdrawn', effect: 'withdrawn_exchange' };
  const base = { openByRound: [{ round: 1, failures: [{ lab: 'e1', id, criterion: 'C', problem: 'p' }] }], reviserByRound: { 1: { declined: [], draftChanged: true } }, draftShaByRound: { 1: 'aaaaaaaaaaaa', 2: 'bbbbbbbbbbbb' },
    heardByRound: { 1: ['e1'], 2: ['e1'] }, notAskedByRound: {}, layerOf: { e1: 1 }, currentRound: 3 };
  assert.equal(objectionLedger({ ...base, replies: [] }).find(r => r.id === id).status, 'active', 'without the reply row the id stays active');
  const closed = objectionLedger({ ...base, replies: [reply] }).find(r => r.id === id);
  assert.equal(closed.status, 'closed');
  // what the top layer reads must not claim a quote was checked: the closing words say the withdrawal was made in the exchange, with a reason
  const text = overseerLedgerSection({ rows: [closed], omitted: null });
  assert.match(text, /withdrew it in its layer's exchange, giving a reason/);
  assert.match(text, /or in its layer's exchange, giving a reason\. Every other objection in it is open/);
  assert.match(overseerLedgerSection({ rows: [{ ...closed, compact: true }], omitted: null }), /withdrawn in its layer's exchange, with a reason\./);
  const quoted = objectionLedger({ ...base, replies: [{ ...reply, effect: 'withdrawn' }] }).find(r => r.id === id);
  assert.ok(!/exchange/.test(overseerLedgerSection({ rows: [quoted], omitted: null })), 'a quote-validated withdrawal reads exactly as before');
});

test('escalated sign-off block: an objection withdrawn in the exchange after it was passed up says so, and does not claim a quote', () => {
  const esc = [{ pass: 2, to_layer: 2, ids: ['O-aaaaaaaa'], rulings: [], outcome: [{ id: 'O-aaaaaaaa', lab: 'e1', layer: 1, result: 'undecided', problem: 'p' }] }];
  const block = (effect) => escalatedSignoffBlock({ end: { pass: 4 }, escalations: esc, replies: [{ round: 3, lab: 'e1', id: 'O-aaaaaaaa', status: 'withdrawn', effect }], signoff: [], standing: new Set() });
  assert.match(block('withdrawn_exchange'), /withdrawn by e1 in round 3, in its layer's exchange, giving a reason/);
  assert.match(block('withdrawn'), /withdrawn by e1 in round 3, quoting the draft/);
});

test('exchange: a post reply cut off at the cap is asked once more under <label>-retry; the retry counts', async () => {
  const { r } = await go(chainOf([seat('mock-exch-cut-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  assert.ok(labels(r).includes('ldebate-1-e1') && labels(r).includes('ldebate-1-e1-retry'), labels(r).join(','));
  assert.ok(r.layerDebates[0].objections.some(o => o.posts.length > 0), 'the retry\'s posts were read');
});

test('exchange: a post far past the field cap is cut before other models read it', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-long-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON }));
  const p = r.layerDebates[0].objections.flatMap(o => o.posts).find(x => x.text.length > 1000);
  assert.ok(p && p.text.length < 300000 && /\[truncated, 300000 chars total\]/.test(p.text), 'the stored post is cut and says so');
  const next = seen.find(x => x.label === 'lreply-1-e2' || x.label === 'revise-1');
  assert.ok(next && !next.user.includes('y'.repeat(100000)), 'the cut text, not the full text, reaches the next prompt');
});

const exLabels = r => labels(r).filter(l => /^(ldebate|lreply)-/.test(l));

test('rounds: a second round always runs while an objection stands; a stance flip in round 2 does not earn round 3 (the exchange goes on only after a withdrawal or a new objection)', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-amendonce', 'e1', 1), seat('mock-exch-flip-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  const d = r.layerDebates[0];
  // FINDING (not on the owed list of the ladder unit; found by the set, 10 Nov 2026; exchange idea 1, LADDER_GO line 16). OLD bar: [[1,true,false],[2,true,true],[3,false,false]] (round 1's amendment and round 2's flip each earned the next round, labels -x3- carried ldebate-1-x3-e1, ldebate-1-x3-e2, lreply-1-x3-e2). NEW: [[1,false,false],[2,true,true]]: a reworded amend no longer counts as a change, and a flip keeps no further round (nobody withdrew and nobody named a new objection), so the exchange ends after round 2 and has no -x3- label. `changed` is still true for the flip in round 2.
  assert.deepEqual(d.rounds.map(x => [x.round, x.changed, x.stance_changed]), [[1, false, false], [2, true, true]], 'round 1: a reworded amendment (no change); round 2: e2 flipped to support (a change, but no further round)');
  // CHANGED ACCEPTED (0.8.4 S3, Q1(b)). OLD: round 3 called lreply-1-x3-e1. NEW: it does not: from round 2 e2 supports e1's amended objection and nobody contests it, and a layer-1 raiser is asked only after a counted contest or insufficient-evidence post.
  assert.deepEqual(exLabels(r).filter(l => /-x3-/.test(l)), [], 'no round 3 (see the FINDING above)');
  assert.ok(exLabels(r).includes('ldebate-1-e1') && exLabels(r).includes('ldebate-1-x2-e1'));
  const again = seen.find(p => p.label === 'ldebate-1-x2-e2');
  assert.match(again.system, /This is a later round of the exchange/);
  assert.match(again.user, /Earlier in this exchange:\nRound 1, your own post \(contest\)/, 'a judge sees which earlier post was its own');
  assert.match(again.user, /the reviewer who raised it answered "amend"/, 'and the raiser\'s earlier answer');
  const mine = d.objections.find(o => o.raised_by === 'e1');
  assert.equal(mine.original_problem, 'No assumptions section.'); assert.match(mine.problem, /Narrowed once/);
});

test('rounds: no disposition changed in round 1 -> round 2 still runs (it always runs while an objection stands), is quiet, and ends the exchange', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  // CHANGED ACCEPTED (0.8.4 S3, Q4(b), RU-S3-65, T3a). OLD: 'no disposition changed in round 1 -> no second round, however many are allowed' (rounds [1], no -x2- label). NEW: a pass with a standing objection runs at least two rounds; round 2 here changes nothing, so the exchange ends after it (rounds [1, 2], no -x3- label). WHY: N9's rule as the request states it: convergence is a round that changes nothing relative to the round before, so a first round has nothing to be compared with.
  assert.deepEqual(r.layerDebates[0].rounds.map(x => [x.round, x.changed]), [[1, false], [2, false]]);
  assert.ok(exLabels(r).some(l => /-x2-/.test(l)) && !exLabels(r).some(l => /-x3-/.test(l)));
});

test('rounds: a judge that repeats the same amendment every round changes nothing after the first: round 2 is quiet and ends the exchange (the safety stop itself is T3c)', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-amend', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  // CHANGED ACCEPTED (0.8.4 S3, Q4(a), RU-S3-59 / RU-S3-60). OLD: 'the safety net - a judge that amends every round is stopped at `rounds`' (rounds [[1,true],[2,true],[3,true]]: every amend counted as a change, and e1 was asked after a mere support). NEW: e2 contests, so e1 is asked each round; an amend changes the disposition only when it changes the objection's text, and the same text twice is no change, so the exchange ends in round 2: [[1,true],[2,false]]. WHY: Q4(a): a reply is a change only if its kind differs from the previous reply or it amends the objection's text. The safety stop's own test is T3c, where a stance flips in every round.
  // FINDING (not on the owed list; 10 Nov 2026; LADDER_GO line 16 (1): a reworded amend no longer counts as a change). OLD bar [[1,true],[2,false]]. NEW [[1,false],[2,false]]: the exchange still ends in round 2, so the title holds; round 1's amend is not a change.
  assert.deepEqual(r.layerDebates[0].rounds.map(x => [x.round, x.changed]), [[1, false], [2, false]]);
});

test('rounds: an objection withdrawn in round 2 leaves the pass; the other stays unresolved with both rounds on record', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-amendonce', 'e1', 1), seat('mock-exch-contest-keepthenwithdraw', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  const d = r.layerDebates[0];
  const by = Object.fromEntries(d.objections.map(o => [o.raised_by, o]));
  assert.equal(by.e2.outcome, 'withdrawn_argued'); assert.equal(by.e2.replies.length, 2); assert.deepEqual(by.e2.replies.map(x => [x.round, x.action]), [[1, 'keep'], [2, 'withdraw']]);
  assert.equal(by.e1.outcome, 'stands_contested');
  assert.deepEqual(d.cleared, ['e2']);
  assert.ok(by.e1.posts.every(p => typeof p.by === 'string' && p.round >= 1), 'every post keeps its poster and round');
});

// CHANGED ACCEPTED (0.8.4 N9, C&C's ruling 4: `layer_debate.rounds` is removed; and the removal of `layer_debate.enabled`). OLD: 'lint and estimate: rounds outside 1-7 are refused; the maximum figure counts every allowed round, the expected one round' (it set the key to 1..8). NEW: the estimate half is kept (the maximum counts seven rounds per pass, N9's stop; the expected figure one), the lint half is the next test (a chain that still names the removed block is refused). WHY: there is no number of rounds to set.
test('estimate: the maximum figure counts three exchange rounds per layer-1 pass (was seven: exchange idea 2), the expected one round', () => {
  const critics = [seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  const base = { maxOverseerRounds: 2, layerRevisions: { 1: 3, 2: 1 } };
  const rowsOf = maximum => estimateChainRows(chainOf(critics, { ...base, ...ON }), { maximum });
  const timesOf = (maximum, label) => rowsOf(maximum).find(r => r.label === label).times ?? 1;
  assert.equal(timesOf(true, 'ldebate-L1-e1'), timesOf(true, 'panel-L1-e1') * 3, 'the maximum counts every allowed round: three per layer-1 pass');
  assert.equal(timesOf(false, 'ldebate-L1-e1'), timesOf(false, 'panel-L1-e1'), 'the expected figure counts one round');
});

// 0.8.4 (H15 widened by the removal of the switch; its own red). DERIVATION: the chain has no overseer rounds, so the dry run takes the plain per-pass branch (maxRounds 2: passes 1 and 2); in each pass, after the panel rows, it prices the exchange of the lowest layer's judges: one ldebate and one lreply row per judge, in judge order, labelled with the pass (ldebate-1-e1, lreply-1-e1, ldebate-1-e2, lreply-1-e2, then pass 2); each row counts the exchange's rounds: seven in the maximum (N9's stop), one in the expected figure. With ONE judge on the lowest layer the exchange cannot run, so no row. Before this change the plain branch priced no exchange row at all.
test('estimate: a layered unanimous chain WITHOUT overseer rounds prices its exchange too, per pass; a lowest layer with one judge prices none', () => {
  const two = [seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: every ldebate-/lreply- row of the estimate. NEW: the ordinary per-pass rows only; the ending exchange's rows (`-end-`, once per run, seven rounds, in the maximum) are asserted in test/ending-exchange-cost.test.js (K6). WHY: lateFindingRule (W26) is recorded.
  const labelsOf = rows => rows.filter(r => /^l(debate|reply)-/.test(r.label) && !r.label.includes('-end-'));
  // FINDING (not on the owed list; 10 Nov 2026; exchange idea 2): OLD bar [[false,1],[true,7]]. NEW [[false,1],[true,3]]: the maximum counts every round the layer-1 exchange is allowed (LAYER_ONE_EXCHANGE_ROUNDS, 3); the neighbouring estimate test above was moved to 3 and this one was missed.
  for (const [maximum, rounds] of [[false, 1], [true, 3]]) {
    const ex = labelsOf(estimateChainRows(chainOf(two, { ...ON, maxRounds: 2 }), { maximum }));
    assert.deepEqual(ex.map(r => r.label), ['ldebate-1-e1', 'lreply-1-e1', 'ldebate-1-e2', 'lreply-1-e2', 'ldebate-2-e1', 'lreply-2-e1', 'ldebate-2-e2', 'lreply-2-e2'], `maximum ${maximum}`);
    assert.deepEqual([...new Set(ex.map(r => r.times ?? 1))], [rounds], `maximum ${maximum}: the rounds each row counts`);
  }
  assert.deepEqual(labelsOf(estimateChainRows(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 2 }), { maximum: true })), []);
});

// 0.8.4 (the removal of the layer_debate block; its own red). DERIVATION: the block left FLAG_BLOCKS, so nothing but the new top-level finding can refuse it: a chain that names `layer_debate` in any form (enabled, enabled false, a leftover `rounds`, an empty object) adds exactly one finding of kind layer-debate-removed, naming layer_debate; a chain that does not adds none; the consumer (the CLI start) turns every finding into a refusal. By DIFFERENCE with the plain chain, so the other findings of the fixture do not matter.
test('lint: a chain that still names the removed layer_debate block, in any form, is refused at load by one finding that names it', () => {
  const critics = [seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  const plain = lintChain(chainOf(critics, ON), 'x.json');
  assert.ok(!plain.some(f => f.kind === 'layer-debate-removed'), 'a chain without the block gets no such finding');
  for (const block of [{ enabled: true }, { enabled: false }, { enabled: true, rounds: 3 }, { rounds: 2 }, {}]) {
    const keyed = chainOf(critics, { layer_debate: block });
    const added = lintChain(keyed, 'x.json').filter(f => !plain.some(g => g.kind === f.kind));
    assert.deepEqual(added.map(f => f.kind), ['layer-debate-removed'], JSON.stringify(block));
    assert.match(added[0].message, /layer_debate is not a setting any more/);
    assert.match(added[0].fix, /Remove "layer_debate" from x\.json/);
    const lines = chainLintLines(keyed, 'x.json');   // the consumer (the CLI start, exit 1): every finding is a refusal
    assert.ok(lines && /will not run/.test(lines[0]) && lines.some(l => l.includes('[layer-debate-removed]')), 'the run is refused, not warned');
  }
  assert.ok(!(chainLintLines(chainOf(critics, ON), 'x.json') ?? []).some(l => l.includes('layer-debate-removed')));
});

test('rounds: a defect named in round 1 is read by the other judges in round 2 and then counts as debated', async () => {
  const { r } = await go(chainOf([seat('mock-exch-new-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  const named = r.layerDebates[0].objections.find(o => o.from_exchange);
  assert.equal(named.added_round, 1);
  assert.deepEqual(named.posts.map(p => [p.by, p.round, p.stance]), [['e2', 2, 'support']]);
  assert.equal(named.outcome, 'stands_uncontested');
});

test('re-ask pass: the judge asked again on an unchanged draft is debated by the carried judges (its objection is not sent to the writer unread)', async () => {
  // Pass 1: e1 and e2 object and clear each other's... both withdraw; e3 is unheard. Pass 2 (same draft): e1 and e2 are carried, e3 answers and objects.
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-withdraw', 'e2', 1), seat('mock-exch-contest-keep-late-ra1', 'e3', 1), seat('mock-critic-x', 'e4', 2)], { ...ON, maxRounds: 2 }));
  assert.equal(r.layerDebates.length, 2, 'pass 1 (e1, e2) and pass 2 (e3 re-asked) each ran an exchange');
  const second = r.layerDebates[1];
  assert.equal(second.pass, 2);
  assert.deepEqual(second.objections.map(o => o.raised_by), ['e3'], 'only the re-asked judge\'s objection is new; e1 and e2 were debated in pass 1 and are not shown again');
  assert.deepEqual([...new Set(second.objections[0].posts.map(p => p.by))].sort(), ['e1', 'e2'], 'the carried judges posted on it');
  assert.ok(labels(r).includes('ldebate-2-e1') && labels(r).includes('ldebate-2-e2') && labels(r).includes('lreply-2-e3'));
});

test('re-ask pass: a carried judge that names a new defect in its post has its carried verdict changed, and the record says so', async () => {
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: e1's reply mode was `withdraw`. NEW: `withdrawthenkeep` (withdraws on its first reply, keeps on every later one). DERIVATION: pass 1 is unchanged (both contests draw a withdrawal in round 1, nothing stands, the exchange ends after one round, e3 is unheard so the pass is re-asked). In pass 2 e1 (carried, cleared) names its new defect N in round 1 (its second exchange call); a new objection is a change, so round 2 runs: e2 and e3 contest N, and N's raiser is asked to reply. With `withdraw` it would withdraw N itself in round 2 (the loop reads the defect before the stop, unlike the one-round exchange, where nobody ever read it), so the exchange would leave e1's verdict unchanged. With `withdrawthenkeep` its second reply keeps N: N stands, e1 carries a new objection, its verdict is changed (exchange_changed) and objected. WHY: the premise 'the defect it named stands' needs a raiser that does not withdraw it.
  // CHANGED ACCEPTED (0.8.4 S3, Q1(b)). OLD: e1 was a `newlater` judge (supports, names a new defect from its second call on). NEW: `cnl` (the same, but it CONTESTS). WHY: a layer-1 raiser is asked to reply only after a counted contest, so e2 (`contest-withdraw`) was no longer asked, no longer withdrew, the layer stayed 'objected' and the pass revised instead of re-asking; with e1 contesting, both withdraw in pass 1 as before and the premise (an unheard layer, a carried verdict) holds.
  const { r } = await go(chainOf([seat('mock-exch-cnl-withdrawthenkeep-id-ra2', 'e1', 1), seat('mock-exch-contest-withdraw', 'e2', 1), seat('mock-exch-contest-keep-late-ra2', 'e3', 1), seat('mock-critic-x', 'e4', 2)], { ...ON, maxRounds: 2 }));
  const pass2 = r.panelVerdicts.filter(v => v.round === 2 && v.layer === 1);
  const e1 = pass2.find(v => v.lab === 'e1');
  assert.equal(e1.exchange_changed, true, 'e1 was carried from pass 1, and pass 2\'s exchange gave it a new objection');
  // CHANGED ACCEPTED (M1, C&C's ruling on the clean sign-off, GO item 8). OLD: `assert.equal(e1.verdict, 'objected')`. NEW: the verdict stays 'signed_off' and says it named a defect. DERIVATION: e1's carried verdict is its pass-1 verdict after the exchange cleared it (meets:true, no objection listed); in pass 2 the exchange gives it the new defect N. A verdict that signed off with no objection and then names a defect KEEPS its sign-off: N rides on its `openOwn` (the tally still counts it, so the layer is held exactly as before) and the record says `defect_named`. `exchange_changed` is unchanged.
  assert.deepEqual([e1.verdict, e1.defect_named], ['signed_off', true]);
});

test('resume: replaying a finished run through the stage cache re-asks nothing - every exchange prompt is byte-identical to the first run\'s', async () => {
  const first = new Map(); const stages = new Map();
  setPromptSpy(p => first.set(p.label, promptHashOf(p.system, p.user)));
  const cfg = () => chainOf([seat('mock-exch-contest-amendonce', 'e1', 1), seat('mock-exch-flip-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 2 });
  const a = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-replay', config: cfg() });
  for (const s of a.stages) stages.set(s.label, s);
  const second = new Map();
  setPromptSpy(p => second.set(p.label, promptHashOf(p.system, p.user)));
  setCache({ get: label => (stages.has(label) ? { ...stages.get(label), promptHash: first.get(label) } : null) });
  const b = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-replay', config: cfg() });
  const ex = m => [...m.keys()].filter(l => /^(ldebate|lreply)-/.test(l)).sort();
  // FINDING (not on the owed list; 10 Nov 2026; exchange idea 1): OLD guard >= 8 (three rounds). NEW >= 7 and a -x2- label: the flip no longer earns round 3, so the first run has two rounds (4 + 3 labels). The replay assertions below are unchanged.
  assert.ok(ex(first).length >= 7 && ex(first).some(l => /-x2-/.test(l)), 'the first run really ran several exchange rounds');
  assert.deepEqual(ex(second), ex(first), 'the same exchange labels');
  for (const l of ex(first)) assert.equal(second.get(l), first.get(l), `${l}: the prompt differs on replay, so the cached stage would be stale and re-paid`);
  assert.deepEqual(b.layerDebates.map(d => d.objections.map(o => o.outcome)), a.layerDebates.map(d => d.objections.map(o => o.outcome)));
});

test('same draft judged again: an objection already upheld on it is not shown again, and the writer still reads its record from the pass that debated it', async () => {
  // The mock reviser returns the same text every time, so pass 3 judges exactly the draft pass 2 judged. Two judges that never sign off keep their objections.
  const { r, seen } = await go(chainOf([seat('mock-critic-holdout', 'h1', 1), seat('mock-critic-holdout', 'h2', 1), seat('mock-critic-x', 'e4', 2)], { ...ON, maxRounds: 4 }));
  assert.ok(labels(r).includes('ldebate-2-h1') && !labels(r).some(l => /^(ldebate|lreply)-3-/.test(l)), 'pass 2 debated them; pass 3 (same draft) made no exchange call');
  const note = seen.find(p => p.label === 'revise-3').user;
  assert.match(note, /\(upheld\): 1 supported it/, 'the record of the pass that debated them is in the note');
  assert.ok(!/\(not debated\)/.test(note), 'and they are not reported as undebated');
});

test('withdrawn ids are shown back to their raiser with its own reason, as information beside the answer-back; others read nothing new', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 2 }));
  const gone = r.layerDebates[0].objections.find(o => o.raised_by === 'e1');
  assert.equal(gone.outcome, 'withdrawn_argued');
  const p2 = seen.find(p => p.label === 'panel-2-e1').user;
  assert.match(p2, /# Objections you withdrew in your layer's exchange/);
  assert.ok(p2.includes(`- ${gone.id} (round 1):`) && p2.includes('You said: The quoted passage settles it.'), 'the id and its own reason');
  assert.ok(!seen.find(p => p.label === 'panel-2-e2').user.includes('Objections you withdrew'), 'a judge that withdrew nothing reads nothing new');
  assert.ok(!seen.find(p => p.label === 'panel-1-e1').user.includes('Objections you withdrew'), 'and nobody reads it before the pass after the withdrawal');
});

test('withdrawn ids shown back are information only: a judge that ignores the block is not asked again and owes no answer', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw-noanswers', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 3 }));
  // e1 reads the block in pass 2 and gives no answers at all (the -noanswers mock): if the withdrawn id were among the objections it owes an answer for, it would be unanswered and re-asked.
  assert.ok(labels(r).includes('panel-2-e1'), 'pass 2 asked e1');
  assert.ok(!labels(r).some(l => /^panel-\d+-e1-reask/.test(l)), 'e1 was never re-asked');
  assert.ok(!r.answerBackReplies.some(x => x.lab === 'e1' && (x.effect === 'unanswered' || x.effect === 'unknown_id')), 'no answer was owed for the withdrawn id');
});

test('a re-raise: a judge raises again what it withdrew; the record marks it, and it is debated again', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw-always', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 2 }));
  assert.equal(r.layerDebates.length, 2);
  const first = r.layerDebates[0].objections.find(o => o.raised_by === 'e1'); const again = r.layerDebates[1].objections.find(o => o.raised_by === 'e1');
  assert.equal(first.outcome, 'withdrawn_argued'); assert.equal(first.re_raise, undefined);
  assert.equal(again.id, first.id); assert.equal(again.re_raise, true, 'marked as a re-raise'); assert.ok(again.posts.length > 0, 'and debated again on the new draft');
});

test('withdrawn block: a long reason and criterion are cut with a visible marker, so up to 20 entries stay small', async () => {
  const { exchangeWithdrawnSection } = await import('../src/roles.js');
  const text = exchangeWithdrawnSection({ items: [{ id: 'O-aaaaaaaa', pass: 2, criterion: 'c'.repeat(5000), reason: 'r'.repeat(5000) }] });
  assert.ok(text.length < 1200 && text.includes('[cut]'), `length ${text.length}`);
});

test('report.json with an exchange withdrawal (answer_back on) validates against the schema, its closed effect enum included', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 2 }));
  assert.ok(r.answerBackReplies.some(x => x.effect === 'withdrawn_exchange'), 'the run wrote the new effect');
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')));
  const shape = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-layer-debate', chain: 'layer-debate-test', task: 'task.md', result: r })));
  assert.equal(validate(shape), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});

// ---- 0.8.4 S1 (M0, first slice): the record of an objection, its five outcomes and its minority notes (Q1(d); T1b, T1d). Offline, mock seats, $0. Each assertion is a test (or subtest) of its own, so one red run shows each failing. ----
const CONTEST_REASON = 'The plan already answers this where it says so.';   // what a `mock-exch-contest-*` judge writes as its reason (src/providers.js)
const t1b = () => go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], ON)).then(({ r }) => r.layerDebates[0].objections.find(o => o.raised_by === 'e1'));

test('T1b: a contest with a found quote and a reason, the raiser keeps: the objection is stands_contested', async () => {
  const o = await t1b();
  assert.equal(o.outcome, 'stands_contested');
});
test('T1b: ... and the contest reason is in that objection\'s minority notes, verbatim', async () => {
  const o = await t1b();
  assert.deepEqual(o.minority_notes.map(n => n.text), [CONTEST_REASON]);
});
test('T1b: ... the minority note names the contesting judge, not the raiser, and the round', async () => {
  const o = await t1b();
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: round 1. NEW: round 2: the notes are the judges' LATEST posts, and the second round always runs. WHY: the note names the round of the contest as it stands at the end.
  assert.deepEqual(o.minority_notes.map(n => [n.by, n.round, n.stance]), [['e2', 2, 'contest']]);
});
test('T1b: ... the minority note keeps the quote the contest was found by', async () => {
  const o = await t1b();
  assert.ok(typeof o.minority_notes[0]?.quote === 'string' && o.minority_notes[0].quote.length >= 8);
});
test('T1b: the contest reason also reaches the reviser\'s note, under the words the note printed before the five outcomes (its bytes do not move in this slice)', async () => {
  const { seen } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], ON));
  const note = seen.find(p => p.label === 'revise-1').user;
  assert.ok(note.includes(CONTEST_REASON) && /\(unresolved\): 0 supported it, 1 contested it/.test(note));
});

test('T1d: K = 4, three judges post support on one objection and nobody contests: no objection is closed by the count - every one is stands_uncontested', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-exch-support-keep', 'e3', 1), seat('mock-exch-support-keep', 'e4', 1), seat('mock-critic-x', 'e5', 2)], { ...ON, maxRounds: 1 }));
  assert.deepEqual(r.layerDebates[0].objections.map(o => o.outcome), ['stands_uncontested', 'stands_uncontested', 'stands_uncontested', 'stands_uncontested']);
});
test('T1d: ... an objection that stands uncontested has an empty minority notes list', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-exch-support-keep', 'e3', 1), seat('mock-exch-support-keep', 'e4', 1), seat('mock-critic-x', 'e5', 2)], { ...ON, maxRounds: 1 }));
  assert.ok(r.layerDebates[0].objections.every(o => Array.isArray(o.minority_notes) && o.minority_notes.length === 0));
});

const withdrawnOver = () => go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-withdraw', 'e2', 1), seat('mock-exch-contest-keep', 'e3', 1), seat('mock-critic-x', 'e4', 2)], { ...ON, maxRounds: 1 })).then(({ r }) => r.layerDebates[0].objections.find(x => x.raised_by === 'e2'));   // e1 supports e2's objection, e3 contests it: e2 is asked, and withdraws over e1's view
test('minority notes: an objection its raiser withdrew over a supporter is withdrawn_argued', async () => {
  const o = await withdrawnOver();
  assert.equal(o.outcome, 'withdrawn_argued');
});
test('minority notes: ... and keeps the supporter\'s reason, verbatim (the contest that moved the raiser is in posts, not in the notes)', async () => {
  const o = await withdrawnOver();
  assert.deepEqual(o.minority_notes.map(n => [n.by, n.stance, n.text]), [['e1', 'support', 'It holds against the criteria.']]);
});

test('minorityNotesOf: one rule per case', async t => {
  const posts = [
    { by: 'a', round: 1, stance: 'contest', text: 'No.', quote: 'a passage long enough', counted: true },
    { by: 'b', round: 1, stance: 'support', text: 'Yes.', counted: true },
    { by: 'c', round: 1, stance: 'contest', text: 'Cut.', counted: false, why: 'quote_not_in_plan' },
  ];
  await t.test('an objection that stands: the counted contest reasons, with the quote', () => assert.deepEqual(LD.minorityNotesOf(posts, 'stands_contested'), [{ by: 'a', round: 1, stance: 'contest', text: 'No.', quote: 'a passage long enough' }]));
  await t.test('an objection its raiser withdrew: the counted support reasons', () => assert.deepEqual(LD.minorityNotesOf(posts, 'withdrawn_argued'), [{ by: 'b', round: 1, stance: 'support', text: 'Yes.' }]));
  await t.test('an uncounted contest is never a note', () => assert.ok(!LD.minorityNotesOf(posts, 'stands_contested').some(n => n.by === 'c')));
  await t.test('stands_uncontested has none', () => assert.deepEqual(LD.minorityNotesOf(posts, 'stands_uncontested'), []));
  await t.test('not_debated has none', () => assert.deepEqual(LD.minorityNotesOf(posts, 'not_debated'), []));
  await t.test('no posts at all is an empty list, not an error', () => assert.deepEqual(LD.minorityNotesOf(null, 'stands_contested'), []));
});

test('outcomes: exactly the five words of the Q1 table', () => {
  assert.deepEqual(LD.OUTCOMES, ['withdrawn_argued', 'stands_uncontested', 'stands_contested', 'not_debated', 'unresolved_at_stop']);
});
test('outcomes: outcomeOf only ever returns one of them', () => {
  for (const [posts, reply] of [[[], null], [[{ counted: true, stance: 'contest' }], null], [[{ counted: true, stance: 'insufficient_evidence' }], { action: 'keep' }], [[], { action: 'withdraw', text: 'r' }]]) assert.ok(LD.OUTCOMES.includes(outcomeOf(posts, reply)));
});

const t1bShape = () => go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], ON)).then(({ r }) => JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-layer-debate', chain: 'layer-debate-test', task: 'task.md', result: r }))));
test('report.json: a layer_debates row with an outcome and minority_notes validates against the schema', async () => {
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')));
  const shape = await t1bShape();
  assert.equal(validate(shape), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});
test('report.json: every layer_debates objection carries an outcome of the five and a minority_notes list', async () => {
  const shape = await t1bShape();
  assert.ok(shape.layer_debates[0].objections.every(o => LD.OUTCOMES.includes(o.outcome) && Array.isArray(o.minority_notes)));
});

// ---- 0.8.4 S3 (M0, chunk C2): the exchange loop's rules on the trial form (Q1, Q4; T1a, T1c, T1e, T2*, T3a, T3c, T4a, T4b, T4f, T22ac, T22al, T22am) and the two blocking obligations of the S1 record (RU-S1-15, RU-S1-07 / RU-S1-12). Offline, mock seats, $0. ----
const exchangeCalls = r => labels(r).filter(l => /^(ldebate|lreply)-/.test(l));
const rowOf = (r, raiser) => r.layerDebates[0].objections.find(o => o.raised_by === raiser);
// one raiser (e1) whose objection draws posts from three judges that signed off blind (`-clean`), so only e1 has an objection
const oneRaiser = (posters, extra = ON) => go(chainOf([seat('mock-exch-support-keep', 'e1', 1), ...posters.map((m, i) => seat(`${m}-clean`, `p${i + 1}`, 1), ), seat('mock-critic-x', 'e9', 2)], extra));

test('T1a: K = 4, three judges post support on one objection and nobody contests: no reply call is made', async () => {
  const { r } = await oneRaiser(['mock-exch-support-keep', 'mock-exch-support-keep', 'mock-exch-support-keep']);
  assert.deepEqual(exchangeCalls(r).filter(l => l.startsWith('lreply-')), []);
});
test('T1a: ... and the objection is stands_uncontested, not closed', async () => {
  const { r } = await oneRaiser(['mock-exch-support-keep', 'mock-exch-support-keep', 'mock-exch-support-keep']);
  assert.equal(rowOf(r, 'e1').outcome, 'stands_uncontested');
});
test('T4f: a converged two-round exchange in which every post on the standing objection is support: no raiser reply call, the calls equal the posts alone (2 x (K1 - 1) with one raiser)', async () => {
  const { r } = await oneRaiser(['mock-exch-support-keep', 'mock-exch-support-keep', 'mock-exch-support-keep'], ON);
  assert.deepEqual([exchangeCalls(r).length, exchangeCalls(r).filter(l => l.startsWith('lreply-')).length, r.layerDebates[0].rounds.length], [6, 0, 2]);
});
test('T4f: ... and with two or more raisers it is 2 x K1 posts and no reply (K1 = 4, every judge raises, all support)', async () => {
  const { r } = await go(chainOf([1, 2, 3, 4].map(i => seat('mock-exch-support-keep', `e${i}`, 1)).concat(seat('mock-critic-x', 'e9', 2)), ON));
  assert.deepEqual([exchangeCalls(r).length, exchangeCalls(r).filter(l => l.startsWith('lreply-')).length], [8, 0]);
});

test('T1c: the raiser withdraws with a reason that names a passage: withdrawn_argued, the objection, its posts and the reasons are on the row', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const o = rowOf(r, 'e1');
  assert.deepEqual([o.outcome, o.posts.map(p => [p.by, p.stance]), o.reply.action, typeof o.reply.text, typeof o.reply.quote], ['withdrawn_argued', [['e2', 'contest']], 'withdraw', 'string', 'string']);
});

test('T1e: an objection about a part the draft lacks (it quotes nothing of its own) and a contest that quotes the passage holding it: the contest is accepted by the quote check', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const o = rowOf(r, 'e1');
  assert.deepEqual([o.quote, o.posts[0].counted], [undefined, true]);
});

// T2a: a contest whose quote is not in the plan is recorded as NO VIEW with the refusal reason; no retry, no extra call
const t2a = () => go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contestbad-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
test('T2a: a contest whose quote is not in the plan is recorded as no view with the refusal reason, and the stance it asked for', async () => {
  const { r } = await t2a();
  const p = rowOf(r, 'e1').posts[0];
  assert.deepEqual([p.stance, p.counted, p.why, p.asked], ['no_view', false, 'quote_not_in_plan', 'contest']);
});
test('T2a: ... with zero extra calls: no retry label, and no reply to a refused post', async () => {
  const { r } = await t2a();
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: one call. NEW: the same post is asked once per round, two rounds, and still no retry label and no reply.
  assert.deepEqual(exchangeCalls(r), ['ldebate-1-e2', 'ldebate-1-x2-e2']);
});
test('T2a: ... and a refused post is no stance: the objection is stands_uncontested', async () => {
  const { r } = await t2a();
  assert.equal(rowOf(r, 'e1').outcome, 'stands_uncontested');
});

// T2b: an exchange reply that does not parse counts no posts and is no abstention; Q4(a): the omitted post is a flagged no view (RU-S1-15 is about the round, not about a missing post)
const t2b = () => go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-garbled-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
test('T2b: an exchange reply that does not parse: the poster is not an abstention, its verdict stays the blind one', async () => {
  const { r } = await t2b();
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e2').verdict, 'signed_off');
});
test('T2b: ... its post counts as no view, listed as omitted on the row (Q4(a)) with the reason the reply could not be read (unreadable), and the objection it should have read is stands_uncontested, not not_debated', async () => {
  const { r } = await t2b();
  const o = rowOf(r, 'e1');
  assert.deepEqual([o.outcome, o.posts, o.omitted], ['stands_uncontested', [], [{ by: 'e2', round: 1, why: 'unreadable' }, { by: 'e2', round: 2, why: 'unreadable' }]]);   // CHANGED ACCEPTED (0.8.4 N9, ruling 4): the post is omitted in each of the two rounds
});

// T2c / T2p: a raiser reply that does not parse counts as no reply; the objection stands under the outcome its posts give, flagged unparsed, and is not closed
const t2c = () => go(chainOf([seat('mock-exch-support-garbled', 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
test('T2c/T2p: a raiser reply that does not parse, on an objection whose posts hold a contest: stands_contested, not closed', async () => {
  const { r } = await t2c();
  assert.deepEqual([rowOf(r, 'e1').outcome, rowOf(r, 'e1').reply], ['stands_contested', undefined]);
});
test('T2c/T2p: ... flagged "raiser reply unparsed" on the row', async () => {
  const { r } = await t2c();
  // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: one flag, round 1. NEW: one per round: the second round asks the raiser again and the reply is again unreadable.
  assert.deepEqual(rowOf(r, 'e1').flags, [{ kind: 'raiser_reply_unparsed', round: 1 }, { kind: 'raiser_reply_unparsed', round: 2 }]);
});

// T2d, T2h, T2i, T2l, T2f, T2n: a raiser reply that parses but fails the requirement of its kind counts as no reply, flagged invalid with the failed requirement, never retried, never a withdrawal
const W2 = { layerReplyAnchorRule: HB084.layerReplyAnchorRule };   // the drafted W2 injected: once it is recorded the tool asks for an anchor and demands one (src/layer-debate.js readReplies `strict`); DORMANT until the one re-record
const invalidOf = (reply, inject = false) => { if (inject) setHeldForTest(W2); return go(chainOf([seat(`mock-exch-support-${reply}`, 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON)).then(({ r }) => ({ r, o: rowOf(r, 'e1') })); };
const CASES = [['T2d', 'withdraw-bare', 'withdraw', 'withdraw_no_anchor', true], ['T2h', 'keep-noreason', 'keep', 'keep_no_reason'], ['T2i', 'amend-notext', 'amend', 'amend_no_text'], ['T2l', 'amend-othercrit', 'amend', 'amend_other_criterion'], ['T2f', 'amend-badpassage', 'amend', 'amend_passage_not_found'], ['T2n', 'withdraw-badpassage', 'withdraw', 'withdraw_passage_not_found']];
for (const [id, reply, action, requirement, inject] of CASES) {
  test(`${id}: a ${reply} reply is flagged "raiser reply invalid" with the failed requirement (${requirement})`, async () => {
    const { o } = await invalidOf(reply, inject);
    // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: one flag, round 1. NEW: one per round (the invalid reply changes nothing, so the second round asks again and is flagged again).
    assert.deepEqual(o.flags, [1, 2].map(round => ({ kind: 'raiser_reply_invalid', round, action, requirement })));
  });
  test(`${id}: ... it counts as no reply: the objection stands under its posts (stands_contested), is not closed, and the text and criterion stay as raised`, async () => {
    const { r, o } = await invalidOf(reply, inject);
    assert.deepEqual([o.outcome, o.reply, o.problem, o.criterion, o.original_problem, r.layerDebates[0].cleared], ['stands_contested', undefined, 'No assumptions section.', 'It states the assumptions it was written under.', undefined, undefined]);
  });
  test(`${id}: ... and it is not retried: one reply call per round, no -retry label`, async () => {
    const { r } = await invalidOf(reply, inject);
    // CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: ['lreply-1-e1'] (one reply call). NEW: one per round, two rounds, and no -retry label: the count discipline stays (an invalid reply is asked again only by the next round).
    assert.deepEqual(exchangeCalls(r).filter(l => l.startsWith('lreply-')), ['lreply-1-e1', 'lreply-1-x2-e1']);
  });
}

// CHANGED ACCEPTED (M0 FIX 5, C&C's ruling 4 Nov 2026: T2e is MOOT; T18h the same, at S14/M3). OLD: 'a contest quote and a withdrawal anchor are checked by the plan's own quote check only: the run asks nobody, waits for nobody and adds no stop', asserting the stage labels and `r.stopped ?? null`: it could not fail on an approval gate (an approval wait is not a stage label; runChain has no `stopped` key). NEW: the privacy switch for quotes that T2e names (FEATURE_SPECS l.433) exists nowhere: RU-B0-23 says E3's quote approval 'bears on no step of it', the copy adds no approval gate, and src has no such switch. The test is kept as a NEGATIVE PIN that says so, and it can fail: the exchange modules and exchangeRound import and mention no approval gate, send path or advice module, and the run still adds no stage outside its own.
test('T2e (moot): there is no privacy switch for quotes - the quote check of F7 is the plan\'s own, the exchange reaches no approval gate, send path or advice module, and the run waits for nobody and adds no stop', async () => {
  const text = f => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  const noComments = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
  for (const f of ['layer-debate.js', 'post-quotes.js']) assert.doesNotMatch(noComments(text(f)), /from '\.\/(gate|gate-ledger|gate-cli|send-path|send-path-refusals|send-profiles|advice[a-z-]*)\.js'/, `${f} imports no gate, send path or advice module`);
  const chain = noComments(text('chain.js')); const from = chain.indexOf('export async function exchangeRound'); const body = chain.slice(from, chain.indexOf('\n}\n', from));
  assert.ok(body.length > 2000, 'the scan found exchangeRound');
  assert.doesNotMatch(body, /\b(gate|gateAnswer|approval|approve|approved|sendPath|advice|privacySwitch|quoteApproval)\b/i, 'exchangeRound mentions no approval, gate or advice');
  const { r } = await go(chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  assert.deepEqual([labels(r).filter(l => !/^(criteria|build|revise|panel|ldebate|lreply|skeleton|handoff)/.test(l)), r.stopped ?? null], [[], null]);
});

// T3a: round 2 always runs while an objection stands after round 1 (Q4(b), N9); it makes the same posts, changes nothing and ends the exchange
const t3a = () => go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-exch-contest-keep-clean', 'e3', 1), seat('mock-exch-support-keep-clean', 'e4', 1), seat('mock-critic-x', 'e9', 2)], ON));
test('T3a: one raiser keeps, two contest, one supports: round 1 of 3 posts and 1 reply, round 2 the same and quiet: 8 calls', async () => {
  const { r } = await t3a();
  assert.equal(exchangeCalls(r).length, 8);
});
test('T3a: ... two rounds, the second quiet, and the objection is stands_contested', async () => {
  const { r } = await t3a();
  assert.deepEqual([r.layerDebates[0].rounds.map(x => [x.round, x.changed]), rowOf(r, 'e1').outcome], [[[1, false], [2, false]], 'stands_contested']);
});

// T3c / T22ac / T22am / T22al: the safety stop. e2 flips its stance in every round (the objection keeps changing), e3 names a new defect in round 2 (the progress that earns round 3) and another in round 3, the last round the layer-1 exchange is allowed (0.8.4 exchange ideas 1 and 2; it was round 7).
let t3cRun; const t3c = () => (t3cRun ??= go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-alt-keep-clean', 'e2', 1), seat('mock-exch-new7-keep-clean', 'e3', 1), seat('mock-critic-x', 'e9', 2)], { ...ON, maxRounds: 1 })));   // one run for the four T3c / T22 tests: the new7 and alt mocks count their asks in the process
test('T3c: one objection keeps changing through round 3 after drawing posts, and a new objection is first named in round 3: exactly 3 rounds', async () => {
  const { r } = await t3c();
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list: T3c; exchange idea 2, LADDER_GO line 16 (2)). OLD bar [7, true] (the stop at the seventh round). NEW [3, true]: the layer-1 exchange stops after 3 rounds; the fixture's progress in round 2 (e3's first new objection) earns round 3, and the stop is on the record.
  assert.deepEqual([r.layerDebates[0].rounds.length, r.layerDebates[0].safety_stop], [3, true]);
});
test('T3c: ... the first objection is unresolved_at_stop, the new one not_debated', async () => {
  const { r } = await t3c();
  // CHANGED ACCEPTED (owed list: T3c). OLD: the new objection was first named in round 7. NEW: round 3; the objection named in round 2 was debated in round 3, so the not_debated one is found by its round.
  const fromExchange = r.layerDebates[0].objections.find(o => o.from_exchange && o.added_round === 3);
  assert.deepEqual([rowOf(r, 'e1').outcome, fromExchange.outcome, fromExchange.added_round], ['unresolved_at_stop', 'not_debated', 3]);
});
test('T22ac: a layer-1 pass whose exchange reaches its third round runs no further exchange round', async () => {
  const { r } = await t3c();
  // CHANGED ACCEPTED (owed list: T22ac). OLD bar 7 (the seventh round). NEW 3 (LAYER_ONE_EXCHANGE_ROUNDS).
  assert.equal(Math.max(...r.layerDebates[0].rounds.map(x => x.round)), 3);
});
test('T22am: ... and no second exchange in the pass: one layer_debates row for pass 1', async () => {
  const { r } = await t3c();
  assert.equal(r.layerDebates.filter(d => d.pass === 1).length, 1);
});
test('T22al: a pass whose layer-1 exchange runs its three rounds is priced at most 24 exchange calls (K1 = 4, every judge raising; MOVED BAR: it was seven rounds and 56, exchange idea 2)', () => {
  const config = chainOf([1, 2, 3, 4].map(i => seat('mock-exch-support-keep', `e${i}`, 1)).concat(seat('mock-critic-x', 'e9', 2)), ON);
  const rows = estimateChainRows({ ...config, maxOverseerRounds: 2, layerRevisions: { 1: 3, 2: 1 } }, { maximum: true });
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: every row whose label starts with the id counted. NEW: the ending exchange's rows (`-end-`, one set per run, not per pass) are left out, so the bar of 24 calls per layer-1 pass stands (K6; the ratio over passes would otherwise read 29.6). WHY: lateFindingRule (W26) is recorded (src/cost.js:850-858).
  const times = id => rows.filter(x => x.label?.startsWith?.(id) && !x.label.includes('-end-')).reduce((a, x) => a + (x.times ?? 1), 0);
  const passes = rows.find(x => x.label === 'panel-L1-e1').times ?? 1;
  assert.equal((times('ldebate') + times('lreply')) / passes, 24);
});

test('T4a: a pass with no standing objection at layer 1 (every judge signs off blind): zero exchange calls and no layer-1 layer_debates row', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep-clean', 'e1', 1), seat('mock-exch-support-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: no layer_debates row. NEW: only layer 2's `fewer_than_two_heard` row (the lone layer-2 judge e9 objects); no exchange call (K6). WHY: shortExchangeOn() (shortExchangeRule + signoffLineRule recorded).
  assert.deepEqual(exchangeCalls(r), []);
  assert.ok(r.layerDebates.length >= 1 && r.layerDebates.every(d => d.layer === 2 && d.not_run === 'fewer_than_two_heard'));
});
// CHANGED ACCEPTED (M0 FIX 4, KB-8 tree): OLD: only the calls (`exchangeCalls(r)` is []). NEW: also the record of why there are none, `not_run: 'fewer_than_two_heard'` on the pass's first row. WHY: the only guard break that does not turn the calls red is a lowered threshold (`judges.length < 1`), which leaves the lone heard judge unable to read its own objection; it does change this record, so the record is asserted too.
test('T4b: a layer with one heard judge: zero exchange calls, and the pass records that the exchange did not run', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-unreadable', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  assert.deepEqual([exchangeCalls(r), r.layerDebates[0].not_run], [[], 'fewer_than_two_heard']);
});

// The two blocking obligations of the S1 record
// The last-round fixture (0.8.4 exchange ideas 1 and 2: a layer-1 exchange goes on only after a withdrawal or a new objection and stops after 3 rounds; it was seven rounds, the name `last7` stays): e1 raises X; e2 (signed off blind) alternates contest and support on every ask and names a new objection in round 2 (the progress that earns round 3); e1 keeps its first reply (round 1) and AMENDS on the second, which is round 3's. X is amended in the last round that runs: not debated, carried. Each run has its own model suffix (the mock counts its asks in the process).
const last7 = id => [seat(`mock-exch-support-keepamend2-id-${id}`, 'e1', 1), seat(`mock-exch-altp-keep-id-${id}-clean`, 'e2', 1), seat('mock-critic-x', 'e9', 2)];
let carry7Run; const carry7 = () => (carry7Run ??= go(chainOf(last7('c7a'), { ...ON, maxRounds: 3 })));
// CHANGED ACCEPTED (0.8.4 N9, ruling 4). OLD: e1 amended in round 1, the only round (`contest-amend`). NEW: the seven-round fixture: e1 amends in round 7, the last round that runs (the stop). WHY: with the second round always run, an amendment in round 1 is debated in round 2 (outcome stands_contested); 'amended in the last round' now exists only at the stop.
test('RU-S1-15: an objection amended in the last round (the third) is not_debated (its final text drew no posts), with no minority notes, and the stop is recorded', async () => {
  const { r } = await carry7();
  const o = rowOf(r, 'e1');
  // CHANGED ACCEPTED (owed list: RU-S1-15). OLD bar rounds 7. NEW 3: e1 amends on its second reply, round 3's, the last round the layer-1 exchange runs; the fixture's round-2 progress (e2's new objection) earns that round.
  assert.deepEqual([o.outcome, o.minority_notes, r.layerDebates[0].rounds.length, r.layerDebates[0].safety_stop], ['not_debated', [], 3, true]);
});
// RU-S1-07 / RU-S1-12: the outcome and the minority notes fit the objection's FINAL text. e1's objection is contested in round 1 by e2 and amended by e1 in round 1; in round 2 e2's reply cannot be read, so NO judge posted on the new text. (The old rule read each judge's latest post of any round: e2's round 1 contest, about text that no longer exists.)
let amendedRun; const amendedEarly = () => (amendedRun ??= go(chainOf([seat('mock-exch-contest-amendonce', 'e1', 1), seat('mock-exch-cg-keep-b', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON)));   // one run: the cg mock counts its asks in the process
test('RU-S1-07/12: an objection amended in round 1, with no judge posting on the new text, is not stands_contested on the old text\'s contest: it is stands_uncontested', async () => {
  const { r } = await amendedEarly();
  assert.deepEqual([rowOf(r, 'e1').outcome, rowOf(r, 'e1').problem !== rowOf(r, 'e1').original_problem], ['stands_uncontested', true]);
});
test('RU-S1-07/12: ... and its minority notes are empty: the round 1 contest was about the old text', async () => {
  const { r } = await amendedEarly();
  assert.deepEqual(rowOf(r, 'e1').minority_notes, []);
});
test('RU-S1-07/12 and RU-S1-05: ... and the writer\'s note reads the same final-text slice as the row: no counted post on the new text, so "(not debated)", never the round 1 contest about the old text', async () => {
  const { r, seen } = await amendedEarly();
  const note = seen.find(p => p.label === 'revise-1').user;
  // CHANGED ACCEPTED (Mini-C&C's FIX of C2, B2 fix-up A). OLD: `(upheld): 0 supported it, 0 contested it, 0 said the evidence was insufficient.` NEW: `(not debated)`. WHY: the final text drew no counted post (e2's reply was unreadable); an "upheld, nobody disagreed" line for it is the defect B2 fix-up A fixed. The record row stays stands_uncontested.
  assert.ok(note.includes(`- ${rowOf(r, 'e1').id} (not debated):`) && !note.includes(`- ${rowOf(r, 'e1').id} (upheld)`));
});
test('RU-S1-07/12: ... while the round 1 contest stays in the record\'s posts, and the judge\'s missing round 2 post is listed as omitted (not carried across the amendment)', async () => {
  const { r } = await amendedEarly();
  assert.deepEqual([rowOf(r, 'e1').posts.map(p => [p.by, p.round, p.stance]), rowOf(r, 'e1').omitted], [[['e2', 1, 'contest']], [{ by: 'e2', round: 2, why: 'unreadable' }]]);
});

// Q4(a): a later omitted post carries the judge's position forward, flagged, and is not a change
let carriedRun; const carried = () => (carriedRun ??= go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-cg-keep', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON)));   // one run: the cg mock counts its asks in the process
test('Q4(a): a post omitted in round 2 carries the judge\'s round 1 position forward, flagged omitted and carried', async () => {
  const { r } = await carried();
  const p = rowOf(r, 'e1').posts.find(x => x.round === 2 && x.by === 'e2');
  assert.deepEqual([p.stance, p.counted, p.omitted, p.carried, p.omitted_why], ['contest', true, true, true, 'unreadable']);
});
test('Q4(a): ... and it is not a change: the exchange ends after the quiet round 2', async () => {
  const { r } = await carried();
  assert.deepEqual(r.layerDebates[0].rounds.map(x => [x.round, x.changed]), [[1, false], [2, false]]);
});

// W2 (held): the anchor is asked for, and demanded, only once its wording is recorded
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'W2 injected ... without it the prompt has none' compared the prompt with and without the injected W2, and 'before W2 is recorded a judge is not flagged for an anchor it was never asked for' asserted the held state. NEW: the raiser's reply prompt is asserted to carry the anchor sentence (K7: the `without` half is removed); the second row is removed (K7, SIBLING: the CASES rows above, T2d among them, assert the flag `withdraw_no_anchor` as recorded). WHY: layerReplyAnchorRule (W2) is recorded.
test('W2: the raiser\'s reply prompt carries the W2 sentence', async () => {
  const withIt = (await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON))).seen.find(p => p.label === 'lreply-1-e1').system;
  assert.equal(withIt.includes('names the post, or the passage of the draft'), true);
});

// Mini-C&C's FIX of 1bd733b5: a row whose final text drew no counted post (every poster unreadable) was not debated. The RECORD says stands_uncontested (ruling 7), but the writer's note keeps the base's word (B2 fix-up A) and the row is not settled on that draft.
test('FIX 1: an objection whose every poster was unreadable reaches the writer as "(not debated)", not as "(upheld): 0 supported it, 0 contested it" (B2 fix-up A; the record row still says stands_uncontested)', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-garbled-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const note = seen.find(p => p.label === 'revise-1').user;
  assert.deepEqual([rowOf(r, 'e1').outcome, note.includes(`- ${rowOf(r, 'e1').id} (not debated):`), note.includes(`- ${rowOf(r, 'e1').id} (upheld)`)], ['stands_uncontested', true, false]);
});
test('FIX 2: ... and such a row is not settled on that draft: the same draft judged again shows it to the exchange again', async () => {
  const { r } = await go(chainOf([seat('mock-exch-garbled-keep-always', 'e1', 1), seat('mock-exch-garbled-keep-always', 'e2', 1), seat('mock-critic-x', 'e9', 2)], { ...ON, maxRounds: 3 }));
  assert.ok(labels(r).some(l => /^ldebate-3-/.test(l)), `pass 3 judges the draft pass 2 judged: its exchange ran again, labels ${exchangeCalls(r).join(' ')}`);
});

// ---- 0.8.4 S3 (M0, chunk C3): the lone heard judge (Q4(d); T4d, T4e, T4h, T22ae) and the carry-forward (Q1(g); T22aa, T22ad). Offline, mock seats, $0. ----
const OV = { maxOverseerRounds: 5, layerRevisions: { 1: 3, 2: 1 } };
const goErr = async config => {
  const lines = []; const stages = [];
  setCache(null); setBudget(null);
  try { const result = await runChain({ request: 'A mock task.', log: m => lines.push(m), onStage: s => stages.push(s.label), runId: 'r-lone', config }); return { result, stages, log: lines.join('\n') }; }
  catch (err) { return { err, stages, log: lines.join('\n') }; }
};
// e1 is heard and objects; e2 never returns a readable verdict: the exchange needs two heard judges and never runs
let loneRun; const lone = () => (loneRun ??= goErr(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-unreadable', 'e2', 1), seat('mock-critic-x', 'e3', 2)], OV)));
test('T4d/T4h: one heard judge, the re-ask bound spent: the run stops at F4\'s stop for a seat that gave no usable reply (layer_bound / unheard, three passes, two re-asks), and no continue ran by itself', async () => {
  const { err } = await lone();
  assert.ok(err instanceof RoundStopped, String(err?.stack || err));
  assert.deepEqual({ kind: err.stop.kind, why: err.stop.why, layer: err.stop.layer, passes: err.stop.passes, reasks: err.stop.reasks }, { kind: 'layer_bound', why: 'unheard', layer: 1, passes: 3, reasks: 2 });
});
test('T4d: ... nothing was revised in between (no revise stage), and nothing climbed (layer 2 was never asked)', async () => {
  const { stages } = await lone();
  assert.deepEqual([stages.filter(l => /^revise-/.test(l)), stages.filter(l => /^panel-\d+-e3/.test(l))], [[], []]);
});
test('T4d/T22ae: ... the heard judge\'s objection is recorded flagged not_debated in every pass, with no post, and the exchange made no call', async () => {
  const { err, stages } = await lone();
  assert.deepEqual([err.partial.layerDebates.map(d => [d.pass, d.not_run, d.objections.map(o => [o.raised_by, o.outcome, o.posts.length])]), stages.filter(l => /^(ldebate|lreply)-/.test(l))],
    [[[1, 'fewer_than_two_heard', [['e1', 'not_debated', 0]]], [2, 'fewer_than_two_heard', [['e1', 'not_debated', 0]]], [3, 'fewer_than_two_heard', [['e1', 'not_debated', 0]]]], []]);
});

// T4e: the unheard judge is asked again on the same draft and is heard; the judge heard before keeps its verdict and the exchange then runs on both
let reaskRun; const reask = () => (reaskRun ??= goErr(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-keep-late-t4e', 'e2', 1), seat('mock-critic-x', 'e3', 2)], OV)));
test('T4e: a pass with one heard judge is followed by a re-ask pass: the judge heard before is not asked again (its verdict is carried), the unheard one is, and the exchange runs only then', async () => {
  const { result, stages } = await reask();
  assert.deepEqual([stages.some(l => l === 'panel-1-e1'), stages.some(l => l === 'panel-2-e1'), stages.some(l => l === 'panel-2-e2'), stages.filter(l => /^ldebate-1/.test(l)), stages.filter(l => /^ldebate-2/.test(l)).sort(), stages.some(l => l === 'revise-1'), stages.some(l => l === 'revise-2')],
    [true, false, true, [], ['ldebate-2-e1', 'ldebate-2-e2', 'ldebate-2-x2-e1', 'ldebate-2-x2-e2'], false, true], JSON.stringify(stages));   // CHANGED ACCEPTED (0.8.4 N9, ruling 4): the exchange of pass 2 runs a second round (x2)   // pass 1 re-asked and revised nothing; pass 2 debated and revised
  assert.ok(result.layerDebates.length >= 2);
});
test('T4e: ... the first pass\'s record says the exchange did not run, the re-ask pass\'s record carries the posts', async () => {
  const { result } = await reask();
  assert.deepEqual([result.layerDebates[0].not_run, result.layerDebates[1].not_run, result.layerDebates[1].objections.every(o => o.posts.length > 0)], ['fewer_than_two_heard', undefined, true]);
});

// T22aa / T22ad: the carry-forward
// CHANGED ACCEPTED (0.8.4 N9, ruling 4) for the T22aa pair and the carry-withdrawn pair below. OLD: the fixture `contest-amend` amended in round 1, the only round, so the objection was not debated. NEW: the seven-round fixture (e1's amendment comes in round 7). WHY: see RU-S1-15 above.
const carry = carry7;
test('T22aa: an objection amended in the last round (not_debated) is debated from round 1 of the NEXT pass\'s exchange, with its raiser\'s blind review no longer raising it', async () => {
  const { r } = await carry();
  assert.equal(rowOf(r, 'e1').outcome, 'not_debated');   // pass 1
  const second = r.layerDebates[1].objections;
  const x = second.find(o => o.raised_by === 'e1');
  assert.deepEqual([second.length, x.carried_from, x.posts[0].by, x.posts[0].round], [1, 1, 'e2', 1], 'carried from pass 1, debated from round 1 of this pass');
});
test('T22aa: ... the carried objection holds its raiser\'s sign-off in that pass (the verdict is objected), and it is carried once: pass 3 has no exchange', async () => {
  const { r } = await carry();
  assert.deepEqual([r.panelVerdicts.find(v => v.round === 2 && v.lab === 'e1').verdict, r.layerDebates.length], ['objected', 2]);
});
let nothingRun; const nothing = () => (nothingRun ??= go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e9', 2)], { ...ON, maxRounds: 3 })));
test('T22ad: a pass whose exchange leaves nothing not_debated carries nothing: the next pass makes no exchange call', async () => {
  const { r } = await nothing();
  assert.deepEqual(r.layerDebates[0].objections.filter(o => o.outcome === 'not_debated'), [], 'the premise: pass 1 left nothing not_debated (M0 FIX 4: without it the test could pass on a drifted fixture)');
  assert.deepEqual([r.layerDebates.length, r.layerDebates.flatMap(d => d.objections).filter(o => o.carried_from).length, labels(r).filter(l => /^(ldebate|lreply)-[23]/.test(l))], [1, 0, []]);
});

test('T4d with answer_back on (the shipped shape): the same stop, three passes, nothing revised', async () => {
  const { err, stages } = await goErr(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-unreadable', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...OV, ...RETAINED }));
  assert.ok(err instanceof RoundStopped, String(err?.stack || err));
  assert.deepEqual([err.stop.why, err.stop.passes, stages.filter(l => /^revise-/.test(l))], ['unheard', 3, []]);
});

// Mini-C&C's FIX of C3 (RU-S3-55): an overrule cannot close a carried objection, but its RAISER can: with answer_back on (the shipped shape) the raiser's pass-2 answer withdraws the carried id with a quote of the revised plan. That is the raiser closing its own objection with a reason: it is recorded as withdrawn and the objection is NOT carried into the exchange again.
let carryWithdrawnRun; const carryWithdrawn = () => (carryWithdrawnRun ??= go(chainOf(last7('c7b'), { ...ON, ...RETAINED, maxRounds: 3 })));
test('FIX (RU-S3-55): a carried objection its raiser withdraws in its answer-back is recorded as withdrawn by the raiser...', async () => {
  const { r } = await carryWithdrawn();
  const first = rowOf(r, 'e1');
  assert.equal(first.outcome, 'not_debated');   // pass 1: amended in the last round, carried
  assert.ok(r.answerBackReplies.some(x => x.round === 2 && x.lab === 'e1' && x.id === first.id && x.effect === 'withdrawn'));
});
test('FIX (RU-S3-55): ... and is not injected into pass 2\'s exchange again: its raiser signs off in pass 2', async () => {
  const { r } = await carryWithdrawn();
  assert.deepEqual([r.layerDebates.flatMap(d => d.objections).filter(o => o.carried_from).length, r.panelVerdicts.find(v => v.round === 2 && v.lab === 'e1').verdict], [0, 'signed_off']);
});

// Q4(d), ruled 4 Nov 2026: a stated pass is a HEARD judge (a usable reply). An objecting judge and a stated-pass peer are two heard judges: the exchange runs and the peer posts. (The base's filter `!v.abstained && v.critique` dropped the stated pass, whose critique is null.)
const PASSING = { ...ON, freedoms: { pass: true } };   // the chain lets a judge state a pass (config.freedoms.pass); without it a pass reply is an unreadable reply
let passerRun; const passer = () => (passerRun ??= go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-critic-passer', 'e2', 1), seat('mock-critic-x', 'e9', 2)], PASSING)));
test('stated pass: an objecting judge and a stated-pass peer: the exchange runs and the peer posts on the objection', async () => {
  const { r } = await passer();
  assert.deepEqual([labels(r).filter(l => /^ldebate-1/.test(l)), r.layerDebates[0].not_run], [['ldebate-1-e2', 'ldebate-1-x2-e2'], undefined]);   // CHANGED ACCEPTED (0.8.4 N9, ruling 4): the peer posts in each of the two rounds
});
test('stated pass: ... the peer\'s support is on the objection\'s row, and the peer is still recorded as having passed', async () => {
  const { r } = await passer();
  assert.deepEqual([rowOf(r, 'e1').posts.map(p => [p.by, p.stance]), r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e2').verdict], [[['e2', 'support'], ['e2', 'support']], 'passed']);   // CHANGED ACCEPTED (0.8.4 N9, ruling 4): one support per round
});
let passerNewRun; const passerNew = () => (passerNewRun ??= go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-critic-passer-new', 'e2', 1), seat('mock-critic-x', 'e9', 2)], PASSING)));
// CHANGED ACCEPTED (M0 FIX 8, C&C's ruling on 5a99ff81: the conversion is REMOVED; no ruling id or copy line makes a stated pass an objecting verdict, and it would record a verdict the seat did not give, against R054's 'no record value change'). OLD: a stated-pass judge that names a material defect in its post 'is not a pass any more: the defect is its own objection and its verdict objects' ([from_exchange, verdict, log line] = [true, 'objected', true]). NEW: the stated pass STAYS a pass (verdict 'passed', no log line about it), and the objection it named stands in the exchange record as minted (Q1(c), RU-S3-40/41: a row raised by e2, from_exchange). WHY: C&C's verdict item 8 (the heard half, R046/R054, stands). Red first on 193be374, where the conversion makes it 'objected'.
test('stated pass: a stated-pass judge that names a material defect in its post STAYS a pass; the objection it named stands in the exchange record as minted AND reaches the writer\'s revise list (M0 FIX 10)', async () => {
  const { r, log, seen } = await passerNew();
  const e2 = r.layerDebates[0].objections.find(o => o.raised_by === 'e2');
  assert.deepEqual([e2?.from_exchange, r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e2').verdict, /stated a pass, then named/.test(log)], [true, 'passed', false]);
  assert.ok(seen.find(p => p.label === 'revise-1').user.includes('The plan names a second deliverable nobody asked for.'), 'the minted objection is on the writer\'s revise list, not only in the exchange record');
});
// M0 FIX 10 (C&C, 4 Nov 2026, opened by item 8's consequence): by RU-S3-41 the defect a judge names in a post "becomes the judge's own objection". For a stated pass that objection rides on the verdict as `openOwn`, the path a stated pass's own open objections already take: the sign-off tally counts it, the reviser's list carries it, and the recorded verdict word stays 'passed'. The discriminating case: the raiser is CLEARED by the exchange (it withdraws), so the minted objection is the only thing that holds the layer.
test('stated pass (M0 FIX 10): when the only other objection is withdrawn in the exchange, the objection a stated pass named holds the layer: its verdict stays `passed`, layer 1 is objected, layer 2 is not asked, and the writer is given the objection', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-critic-passer-new', 'e2', 1), seat('mock-critic-x', 'e9', 2)], PASSING));
  assert.deepEqual(r.layerDebates[0].cleared, ['e1'], 'the fixture: e1 withdrew its objection in the exchange, so it holds nothing');
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e2').verdict, 'passed', 'the recorded verdict word is still the pass');
  assert.equal(labels(r).includes('panel-1-e9'), false, 'layer 2 is not asked in pass 1: layer 1 is held by the stated pass\'s own objection');
  assert.ok(seen.find(p => p.label === 'revise-1')?.user.includes('The plan names a second deliverable nobody asked for.'), 'the writer is given it');
});
// M0 FIX-UP 2, item 5 (C&C's second review: the stall-signature destination of M0 FIX 10 was traced, never tested). The objection a stated pass named joins the round's failures at the fold point, so the stall rule reads it: the same objection standing in two passes running is a stall. The discriminating case is #120's: e1 is cleared by the exchange in pass 1, so the minted objection is the ONLY failure of each pass (pass 2: the stated pass holds it from its answer-back entry, carried), and with it missing from the signature the signature would be empty and no stall could fire. (The first build of this test left answer_back off, so pass 2 held nothing and the run signed off: a fixture error found on tree A, where the test was meant to be green.)
test('stated pass (M0 FIX-UP 2): the objection a stated pass named is in the stall signature: the same one in two passes running stops the revise loop as a stall', async () => {
  const lines = [];
  const config = chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-critic-passer-new', 'e2', 1)], { ...PASSING, answer_back: { enabled: true }, dispute: { enabled: true }, maxRounds: 5 });   // answer_back: without it a stated pass's minted objection lapses at the next pass (a named limit), so the second pass would hold nothing; with it the pass keeps it (an entry built from the first pass's failures)
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-layer-debate-stall', config }).catch(e => e);
  // CHANGED ACCEPTED (0.8.4 S5 U-C fix-up, 08 Nov 2026). OLD: the stall ended the revise loop with the log line "the same 1 objection(s) ... for 2 rounds running" and the run finished. NEW: all three seats sit on layer 1, so it is the top layer: a stall that cannot be passed up is a STOP for the person on every layered chain, a RoundStopped of kind stall_stop at pass 2 that names the stalled objection; the old log line is the unlayered chain's. WHY: the row pins that the objection a stated pass named is IN the stall count (it alone stalls, in pass 2); the stop's `stalled` list says it better than a log line.
  const minted = objectionId('e2', { criterion: 'It adds no scope the request did not ask for.' });   // the objection the stated pass named in its post (providers.js new_objections): no quote, so the id is the criterion's
  assert.ok(r instanceof RoundStopped, `the run stopped for the person (it ended: ${r?.message ?? 'normally'})`);
  assert.deepEqual([r.stop.kind, r.stop.why, r.stop.pass, r.stop.stalled.map(s => [s.id, s.lab, s.layer, s.passes])], ['stall_stop', 'top_layer', 2, [[minted, 'e2', 1, [1, 2]]]], 'the stated pass\'s minted objection alone stalled, in pass 2');
  assert.doesNotMatch(lines.join('\n'), /Round 3:/, 'and it fired in pass 2: the signature held the minted objection in BOTH passes (an entry carried from the answer-back is not marked from_exchange, so a signature that leaves out only the marked ones would stall a pass later)');
});
// M0 FIX-UP 2, item 2 (C&C's second review): the writer's exchange note listed only the ids in judges' critique failures, so the objection a STATED PASS named in a post (it has no critique; the objection is on its `openOwn`) reached the writer's revise list (M0 FIX 10) but not the note that says what the other reviewers made of it. It is listed now, by the same path as an objecting judge's minted one.
test('stated pass (M0 FIX-UP 2): the objection a stated pass named in a post is listed in the writer\'s exchange note, with what the other reviewers said, like an objecting judge\'s', async () => {
  const { r, seen } = await passerNew();
  const e2 = r.layerDebates[0].objections.find(o => o.raised_by === 'e2');
  assert.ok(e2?.from_exchange && e2.id, 'the fixture: e2 is a stated pass and its minted objection has a row');
  const note = seen.find(p => p.label === 'revise-1').user;
  assert.ok(note.includes('# What the other reviewers of the layer said about these objections'), 'the fixture: the pass has an exchange note');
  assert.match(note, new RegExp(`\n- ${e2.id} \\(`), 'the minted objection has its own line in the note');
});
// M0 FIX-UP 2, item 3 (C&C's second review; the record field `raised_in`, C&C's ruling 4 Nov 2026): the row says which STAGE produced the objection, so the report can name the answerer of THAT stage (a session seat's maker). The old report-time rule guessed `panel-<carried_from ?? pass>-<seat>` and could name another stage's answerer (an objection first named in an exchange post, or raised in a re-ask).
test('raised_in (M0 FIX-UP 2): an objection raised in a blind review names that stage; one named in an exchange post names the post\'s stage', async () => {
  const { r } = await passerNew();
  const e1 = r.layerDebates[0].objections.find(o => o.raised_by === 'e1');
  const e2 = r.layerDebates[0].objections.find(o => o.raised_by === 'e2');
  assert.deepEqual([e1?.raised_in, e2?.from_exchange, e2?.raised_in], ['panel-1-e1', true, 'ldebate-1-e2'], 'e1 raised its in its blind review; e2 (a stated pass) named its in its round-1 post');
  assert.ok(r.stages.some(s => s.label === 'panel-1-e1') && r.stages.some(s => s.label === 'ldebate-1-e2'), 'both labels are stages of the run');
});
let raisedInRun; const raisedIn = () => (raisedInRun ??= go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-alt-keep-id-ri3-clean', 'e2', 1), seat('mock-exch-new7-keep-id-ri3-clean', 'e3', 1), seat('mock-critic-x', 'e9', 2)], { ...ON, maxRounds: 2 })));   // the T3c scenario (a defect first named in round 7, not debated, carried into pass 2): one run, the new7 and alt mocks count their asks
test('raised_in (M0 FIX-UP 2): an objection first named in an exchange post and carried into the next pass keeps the stage it was named in, not the stage of the pass it is carried into', async () => {
  const { r } = await raisedIn();
  // CHANGED ACCEPTED (0.8.4 ladder unit, owed list: the `ldebate-1-x7` raised_in row). OLD: the defect was first named in round 7, label ldebate-1-x7-<judge>. NEW: round 3 (LAYER_ONE_EXCHANGE_ROUNDS), label ldebate-1-x3-<judge>; the objection named in round 2 (the progress that earns round 3) is debated in round 3 and not carried, so the carried one is found by its round.
  const named = r.layerDebates[0].objections.find(o => o.from_exchange && o.added_round === 3);
  const again = r.layerDebates.find(d => d.pass === 2)?.objections.find(o => o.carried_from === 1 && o.id === named?.id);
  assert.ok(named && again, `the fixture: a defect named in pass 1 is carried into pass 2: ${JSON.stringify(r.layerDebates.map(d => [d.pass, d.objections.map(o => [o.raised_by, o.from_exchange, o.carried_from])]))}`);
  assert.deepEqual([named.raised_in, again.raised_in], [`ldebate-1-x3-${named.raised_by}`, `ldebate-1-x3-${named.raised_by}`]);
});
// M0 FIX 10: the mock exchange judges read ids with a pattern that accepts the schema's suffix (#N, #rN), so an exchange over a suffixed id draws posts instead of passing vacuously (zero posts). No current test ran an exchange over a suffixed id.
test('mock id readers (M0 FIX 10): an exchange over an objection with a suffixed id (#2) draws posts', async () => {
  const f = { criterion: 'It lists the steps.', problem: 'No pour step.' };
  const id = `${objectionId('x1', f)}#2`;
  recordAssignedId('x1', f, id);
  try {
    const { rows } = await exchangeRound({ judges: [{ key: 'x1', seat: seat('mock-exch-support-keep', 'x1', 1), failures: [f] }, { key: 'x2', seat: seat('mock-exch-support-keep-clean', 'x2', 1), failures: [] }], request: 'A mock task.', criteria: [f.criterion], draft: '# Plan\n\nBake a cake. Sell it at the fair.', round: 1, record: x => x, rounds: 3, layerOne: true });
    const o = rows.find(x => x.raised_by === 'x1');
    assert.equal(o.id, id, 'the fixture: the objection carries the suffixed id');
    assert.ok(o.posts.length >= 1 && o.posts.every(p => p.by === 'x2'), 'the other judge posted on it');
  } finally { resetAssignedIds(); }
});

// ---- 0.8.4 S3 (M0, chunk C6): the Q4 rules that had code and no test, NEW-A2-1's direct guard, and the safety-stop flag (RU-S3-67). Offline, mock seats, $0. There is no number of rounds to set: each scenario runs the exchange's own loop, which ends when a round changes nothing and stops at seven (`EXCHANGE_ROUNDS`).
// KB-8 = the row holds on the code as it was (no red is possible without breaking the code on purpose): RU-S3-60, 66, 71, 78, 80, 83, 88 and NEW-A2-1. RU-S3-67 is the one with a red.
// RU-S3-60 (KB-8): the wording of a raiser's reason is never compared. `keep-varying` keeps in every round and says it in other words each time.
test('RU-S3-60: a keep that is worded differently in round 2 is no change: round 2 is quiet and the exchange ends there (the reply texts differ, two rounds ran)', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep-varying', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const row = rowOf(r, 'e1');
  assert.deepEqual([r.layerDebates[0].rounds.map(x => x.changed), new Set(row.replies.map(x => x.text)).size, row.replies.map(x => x.action)], [[false, false], 2, ['keep', 'keep']]);
});
// RU-S3-66 (KB-8): nothing stands after a round, so the next round makes no call (the plan's own test, T3b, is S4's).
test('RU-S3-66: the only objection is withdrawn in round 1: no second round is asked (no -x2 label) and the record has one round', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-critic-x', 'e9', 2)], ON));
  assert.deepEqual([r.layerDebates[0].rounds.length, exchangeCalls(r).filter(l => /-x\d/.test(l)), rowOf(r, 'e1').outcome], [1, [], 'withdrawn_argued']);
});
// RU-S3-67 (RED on the code as it was): the safety stop is recorded only if an objection that still stands changed in the last allowed round. Everything withdrawn in it is a convergence.
// CHANGED ACCEPTED (0.8.4 N9, ruling 4; again 0.8.4 ladder unit, owed list: RU-S3-67 x2). OLD (N9): e1 withdrew the only objection on its fourth reply, round 7's, with the `alt` poster. NEW (exchange ideas 1 and 2): the last allowed round is the third. A layer-1 exchange runs round 3 only after a withdrawal or a new objection in round 2, so the fixture has two raisers: e3's objection is withdrawn in round 2 (its second reply: the progress that earns round 3) and e1's in round 3 (its third reply); the poster e2 contests both in every round. Everything is withdrawn in the last round, so it is a convergence, not a stop.
test('RU-S3-67: everything withdrawn in the last allowed round (the third) is not a safety stop: no safety_stop on the row, three rounds on the record', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keepwd3-id-t67a', 'e1', 1), seat('mock-exch-contest-keep-id-t67c-clean', 'e2', 1), seat('mock-exch-support-keepwd2-id-t67b', 'e3', 1), seat('mock-critic-x', 'e9', 2)], ON));
  assert.deepEqual([r.layerDebates[0].safety_stop, rowOf(r, 'e1').outcome, rowOf(r, 'e3').outcome, r.layerDebates[0].rounds.length], [undefined, 'withdrawn_argued', 'withdrawn_argued', 3]);
});

// RU-S3-71 (KB-8): an unheard judge is not asked in the exchange. Two heard judges and one that never gives a usable reply: the exchange runs between the heard ones only.
test('RU-S3-71: two heard judges and one unheard: the exchange runs, and no exchange call goes to the unheard judge', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-unreadable', 'e3', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const calls = exchangeCalls(r);
  assert.deepEqual([calls.some(l => l === 'ldebate-1-e2'), calls.filter(l => l.endsWith('-e3'))], [true, []]);
});
// RU-S3-78 (KB-8, holds by the absence of a cap): no number limits the person's own continues.
test('RU-S3-78: twenty-five continues at the same stops add up without a ceiling (the unheard re-asks and the overseer rounds)', () => {
  const cfg = { maxOverseerRounds: 4, layerRevisions: { 1: 3, 2: 2 } };
  const unheard = Array.from({ length: 25 }, (_, i) => ({ stop: `u${i}`, choice: 'continue', kind: 'layer_bound', why: 'unheard', layer: 1, overseer_round: 2, add: 2 }));
  const caps = Array.from({ length: 25 }, (_, i) => ({ stop: `c${i}`, choice: 'continue', kind: 'overseer_cap', overseer_round: 4, add: 1 }));
  // FINDING (not on the owed list of the ladder unit; 10 Nov 2026). OLD bar [2 + 50, 4 + 25]: the base silent-seat bound was 2. NEW [0 + 50, 4 + 25]: the ordinary silent judge has its solo ask inside the pass and the base bound is UNHEARD_PASSES_BEFORE_STOP (0); each continue still adds 2. The lone-heard pass adds its own two passes in advance(), not in the base.
  assert.deepEqual([effectiveLimits(cfg, unheard).advanceConfigAt(2).reasks, effectiveLimits(cfg, caps).overseer], [0 + 50, 4 + 25]);
});
// RU-S3-80 (KB-8): a finish at the lone-heard stop hands the objection over marked not_debated. The record is what is handed over (report.json layer_debates); the revision-outside half is the person's own act outside the Council.
test('RU-S3-80: finishing at the lone-heard stop ends the run not agreed, and the record keeps the heard judge\'s objection as not_debated in every pass, with no post', async () => {
  const { err } = await lone();
  const lines = [];
  setCache(null); setBudget(null);
  const result = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-lone-finish', config: chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-unreadable', 'e2', 1), seat('mock-critic-x', 'e3', 2)], OV), roundChoices: [roundChoiceEntry(err.stop, 'finish')] });
  assert.deepEqual([result.stop?.chosen, result.layerDebates.map(d => [d.pass, d.not_run, d.objections.map(o => [o.raised_by, o.outcome, o.posts.length])])],
    ['finish', [[1, 'fewer_than_two_heard', [['e1', 'not_debated', 0]]], [2, 'fewer_than_two_heard', [['e1', 'not_debated', 0]]], [3, 'fewer_than_two_heard', [['e1', 'not_debated', 0]]]]]);
});
// RU-S3-83 (KB-8, holds by construction): the blind verdicts come first.
test('RU-S3-83: every blind panel call of layer 1 is recorded before the first exchange call of the pass', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const ls = labels(r);
  const lastBlind = Math.max(...ls.map((l, i) => (/^panel-1-(e1|p1)(-|$)/.test(l) ? i : -1)));
  const firstExchange = ls.findIndex(l => /^ldebate-1-/.test(l));
  assert.ok(lastBlind >= 0 && firstExchange > lastBlind, JSON.stringify({ lastBlind, firstExchange }));
});
// RU-S3-88 (KB-8, holds by absence): a stance is not tested for independence - three identical supporters are three counted posts, and nothing on the row weighs or discounts them.
test('RU-S3-88: three judges that post the very same support are three counted posts; the row carries no independence, weight or discount', async () => {
  const { r } = await oneRaiser(['mock-exch-support-keep', 'mock-exch-support-keep', 'mock-exch-support-keep'], ON);
  const row = rowOf(r, 'e1');
  assert.deepEqual([row.posts.length, row.posts.every(p => p.counted === true && p.stance === 'support'), /independen|weight|discount/i.test(JSON.stringify(row))], [6, true, false]);   // CHANGED ACCEPTED (0.8.4 N9, ruling 4): three judges post in each of the two rounds
});
// NEW-A2-1 (KB-8): a layer of one seat whose judge answered: no re-ask pass and no stop (the lone path needs an unheard peer).
test('NEW-A2-1: a layer-1 of one seat whose judge answered: no re-ask label, no stop, and the pass records that the exchange did not run', async () => {
  const { err, result, stages } = await goErr(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-critic-x', 'e2', 2)], OV));
  assert.equal(err, undefined, String(err?.stack || err));
  assert.deepEqual([stages.filter(l => /reask/.test(l)), result.layerDebates[0].not_run], [[], 'fewer_than_two_heard']);
  // CHANGED ACCEPTED (M0 FIX 4, KB-8 tree): NEW: the direct half of 'no re-ask pass'. The lone-heard re-ask makes no `-reask` label, so the assertion above cannot fire on it; what it does do is revise nothing and ask the layer again. The objecting judge of a one-seat layer is revised on at once.
  assert.ok(stages.includes('revise-1'), 'the objection reaches the writer in pass 1: the pass is not a re-ask pass');
});
// RU-S3-67, the case that tells reading A from reading B (Mini-C&C's pick A; KB-8 on the code as it was): A is withdrawn in the last allowed round while B stands unchanged. The safety stop is recorded (the exchange did not converge: a disposition changed in the last round), B stays standing under its posts, and nothing is marked unresolved_at_stop (B did not change).
// CHANGED ACCEPTED (0.8.4 N9, ruling 4; again 0.8.4 ladder unit, owed list: RU-S3-67 x2). OLD (N9): seven rounds, A = e1's objection withdrawn in round 7. NEW (exchange ideas 1 and 2): three rounds, the last the layer-1 exchange runs: A = e1's objection, withdrawn on its second reply, round 3's (the `altp` poster e3 contests it in rounds 1 and 3); B = e3's objection, whose only poster is e1, who supports it in every round (constant, so B never changes); e3 is the poster, so it never posts on its own B. e3 also names a new objection in round 2 (the progress that earns round 3). WHY: the stop exists only at the layer-1 limit, three rounds.
test('RU-S3-67 (A against B): one objection withdrawn in the last allowed round (the third), another standing unchanged: safety_stop is recorded, the standing one is stands_uncontested and carries no unresolved_at_stop mark', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-keepwd2-id-tab', 'e1', 1), seat('mock-exch-altp-keep-id-tab', 'e3', 1), seat('mock-critic-x', 'e9', 2)], ON));
  assert.deepEqual([r.layerDebates[0].safety_stop, rowOf(r, 'e1').outcome, rowOf(r, 'e3').outcome, r.layerDebates[0].rounds.length], [true, 'withdrawn_argued', 'stands_uncontested', 3]);
  assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e3').verdict, 'objected', 'B is still standing when the pass ends: its raiser is held by it');
});

// ---- M0 FIX 2 (C&C's verdict item 2, 4 Nov 2026; Q4(a), FEATURE_SPECS l.283): "a judge's position on an objection differs from the same judge's position in the previous round" is a changed disposition. An EXPLICIT no_view is a position (Q1(a) names it as one of the four), so a move between a stance and an explicit no_view is a change; an omitted post is not (it carries the position of the round before, or counts as no view in round 1) and a post the tool refused (counted:false) is not a position. ----
// Each test first pins what its mock judge did (stance by round), so a misspelt model suffix, which falls back to `support`, fails there and not as a quiet pass.
const roundsOf = r => r.layerDebates[0].rounds.map(x => [x.round, x.changed]);
const givenBy = (row, by) => row.posts.filter(p => p.by === by).map(p => [p.round, p.stance, p.counted, ...(p.omitted ? ['omitted'] : [])]);
test('Q4(a): support, then an explicit no_view from the second round on, is a change of position: round 2 changed, no third round (a changed stance keeps no further round), nobody is asked to reply', async () => {
  const { r } = await oneRaiser(['mock-exch-nvlate-keep']);
  const row = rowOf(r, 'e1');
  assert.deepEqual(givenBy(row, 'p1').slice(0, 2), [[1, 'support', true], [2, 'no_view', true]], 'the fixture: what the mock judge posted in the first two rounds (the third round is the behaviour under test)');
  // FINDING (not on the owed list of the ladder unit; 10 Nov 2026; exchange idea 1, LADDER_GO line 16 (1)). OLD bar rounds [[1,false],[2,true],[3,false]], calls through ldebate-1-x3-p1, and p1's third post [3,'no_view',true]. NEW: [[1,false],[2,true]] and two calls: the change of position still marks round 2 as changed, but only a withdrawal or a new objection earns another round.
  assert.deepEqual(roundsOf(r), [[1, false], [2, true]]);
  assert.deepEqual(exchangeCalls(r), ['ldebate-1-p1', 'ldebate-1-x2-p1'], 'a stance <-> no_view round asks no raiser: only the posts are called');
  assert.equal(row.outcome, 'stands_uncontested');
});
test('Q4(a): an explicit no_view in round 1, then a support, is a change of position too (the other direction)', async () => {
  const { r } = await oneRaiser(['mock-exch-nvearly-keep']);
  assert.deepEqual(givenBy(rowOf(r, 'e1'), 'p1').slice(0, 2), [[1, 'no_view', true], [2, 'support', true]], 'the fixture: the first two rounds');
  // FINDING (not on the owed list; 10 Nov 2026; exchange idea 1). OLD bar rounds [[1,false],[2,true],[3,false]] and p1's third post [3,'support',true]. NEW: [[1,false],[2,true]], no third round: a changed stance keeps no further round.
  assert.deepEqual(roundsOf(r), [[1, false], [2, true]]);
});
test('Q4(a): no_view in every round is no change (the guard that holds before and after): two rounds, two calls, no reply', async () => {
  const { r } = await oneRaiser(['mock-exch-noview-keep']);
  assert.deepEqual(givenBy(rowOf(r, 'e1'), 'p1'), [[1, 'no_view', true], [2, 'no_view', true]], 'the fixture');
  assert.deepEqual(roundsOf(r), [[1, false], [2, false]]);
  assert.deepEqual(exchangeCalls(r), ['ldebate-1-p1', 'ldebate-1-x2-p1']);
});
test('Q4(a) (C&C: omitted posts never update the last explicit position): an explicit no_view, then an omitted post, then a stance IS a change against the no_view; the omitted post itself is listed, not carried', async () => {
  // FINDING (not on the owed list; 10 Nov 2026; exchange ideas 1 and 2). OLD: p1: no_view (round 1), prose that cannot be read (round 2), support (round 3 on); p2 flipped contest -> support in round 2 so round 3 ran, and p1's round-3 support was the change that earned round 4 (rounds [[1,false],[2,true],[3,true],[4,false]], p1's support at round 4 in `givenBy(...)[2]`). NEW: the layer-1 exchange has three rounds at most and round 3 needs a withdrawal or a new objection in round 2, so e3 (`new7`) names one in round 2; p2 contests in every round (no change from it); p1's support in round 3 is the only change of position in the last round.
  const { r } = await go(chainOf([seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-nvgap-keep-clean', 'p1', 1), seat('mock-exch-contest-keep-clean', 'p2', 1), seat('mock-exch-new7-keep-id-nvg-clean', 'e3', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const row = rowOf(r, 'e1');
  assert.deepEqual(givenBy(row, 'p1').slice(0, 2), [[1, 'no_view', true], [3, 'support', true]], 'the fixture: round 2 has no post of p1');
  assert.deepEqual(row.omitted, [{ by: 'p1', round: 2, why: 'unreadable' }], 'the omitted post is listed, not carried (an explicit no_view is not carried forward)');
  assert.deepEqual([roundsOf(r).map(x => x[0]), roundsOf(r)[2][1]], [[1, 2, 3], true], 'three rounds, and the last one changed (p1: no_view -> support)');
});

// ---- M0 FIX 5 (C&C's verdict item 5): five rows whose tests could not fail in the plan's own failing case. Each new test pins its fixture first (a misspelt mock suffix falls back to `keep` or `support` and would pass quietly). Green on 193be374 (the behaviour was there; only the tests were weak); each has a known-bad break in the KB-8 tree. ----
// T1c, a NAMED post: the raiser withdraws by naming the post that moved it (no passage). W2 injected, so the tool demands an anchor: a post number is one. The posts shown to a layer-1 raiser are the contests and doubts on its objection: p2's contest is Post 1.
test('T1c (a named post): the raiser withdraws naming Post 1 and no passage: withdrawn_argued, the reply keeps the post number, the anchor rule is met (nothing flagged), the supporter\'s view is the minority note', async () => {
  setHeldForTest(W2);
  const { r } = await go(chainOf([seat('mock-exch-support-withdraw-post', 'e1', 1), seat('mock-exch-support-keep-clean', 'p1', 1), seat('mock-exch-contest-keep-clean', 'p2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const o = rowOf(r, 'e1');
  assert.deepEqual([o.reply?.action, o.reply?.post, o.reply?.quote], ['withdraw', 1, undefined], 'the fixture: the reply names a post and quotes no passage');
  assert.deepEqual([o.outcome, o.flags], ['withdrawn_argued', undefined]);
  assert.deepEqual(o.minority_notes.map(n => [n.by, n.stance]), [['p1', 'support']], 'the view the withdrawal went against');
  assert.equal(r.layerDebates[0].cleared.includes('e1'), true);
});
test('T1c (a named post, the boundary): naming the LAST post listed (Post 2 of 2) is valid; the post number is checked against the posts that were shown', async () => {
  setHeldForTest(W2);
  const { r } = await go(chainOf([seat('mock-exch-support-withdraw-postlast', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-exch-contest-keep-clean', 'p2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const o = rowOf(r, 'e1');
  assert.deepEqual([o.reply?.action, o.reply?.post], ['withdraw', 2], 'the fixture: two contests were shown, the reply names the second');
  assert.deepEqual([o.outcome, o.flags], ['withdrawn_argued', undefined]);
});

// T2c, both branches and a contest that is followed by a support. The raiser's reply does not parse; the objection stands under the outcome its posts give and is not closed.
test('T2c (the uncontested branch): at an upper layer a support post is answered too; when that answer does not parse the objection is stands_uncontested (no contest on its final text), flagged unparsed, not closed', async () => {
  const failure = { criterion: 'It states the assumptions it was written under.', problem: 'No assumptions section.' };
  const { rows } = await exchangeRound({ judges: [{ key: 'e1', seat: seat('mock-exch-support-garbled', 'e1', 2), failures: [failure] }, { key: 'e2', seat: seat('mock-exch-support-keep-clean', 'e2', 2), failures: [] }], request: 'A mock task.', criteria: [failure.criterion], draft: '# Plan\n\nBake a cake. Sell it at the fair.', round: 1, record: x => x, rounds: 3, layerOne: false });
  const o = rows.find(x => x.raised_by === 'e1');
  assert.deepEqual(o.posts.map(p => [p.by, p.stance]), [['e2', 'support']], 'the fixture: the only post is a support');
  assert.deepEqual([o.outcome, o.reply, o.flags.map(f => f.kind)], ['stands_uncontested', undefined, ['raiser_reply_unparsed']]);
});
// CHANGED ACCEPTED (M0 FIX-UP 2, item 6; Muad's pick of 4 Nov 2026 relayed by C&C, "follow each judge's latest position"; copy correction 10, CHANGE_LOG 10g). OLD (M0 FIX 2): the contest stays on the final text, so the objection is stands_contested although its judge supports it afterwards; the minority note is the judge's contest; the writer's note counts the judge as one supporter AND one contester and lists the contest. NEW: the judge's LATEST position is its support, so the objection is stands_uncontested, there is no minority note, and the writer's note counts the reviewer once ("1 supported it, 0 contested it") and lists no contest. WHY: the recorded note sentence counts reviewers, and a contest the same reviewer dropped by supporting is not a contest that stands.
test('T2c (a contest, then a support): the judge\'s latest position is the support, so the objection is stands_uncontested; the unparsed reply is flagged; there is no minority note; the writer\'s note counts the reviewer once and lists no contest', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-support-garbled', 'e1', 1), seat('mock-exch-flip-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const o = rowOf(r, 'e1');
  // FINDING (not on the owed list; 10 Nov 2026; exchange idea 1). OLD bar: three posts, [3,'support',true] included (the flip earned round 3). NEW: two posts: the flip in round 2 keeps no third round. The outcome, the flags and the note below are read from the two posts.
  assert.deepEqual(givenBy(o, 'e2'), [[1, 'contest', true], [2, 'support', true]], 'the fixture: contest in round 1, support after');
  assert.deepEqual([o.outcome, o.reply, o.flags], ['stands_uncontested', undefined, [{ kind: 'raiser_reply_unparsed', round: 1 }]]);
  assert.deepEqual(o.minority_notes, [], 'the judge no longer contests: nothing to keep');
  const note = seen.find(p => p.label === 'revise-1').user;
  assert.ok(note.includes(`- ${o.id} (upheld): 1 supported it, 0 contested it, 0 said the evidence was insufficient.`), 'one reviewer, counted once, by its latest position');
  assert.equal(note.includes('  - contest'), false, 'and no contest is listed: the reviewer dropped it');
});
// M0 FIX-UP 2, item 6 (C&C: ONE NEW RED, "contest then no_view = uncontested"): an explicit no_view is a judge's latest position and holds no stance, so a contest the judge then withdrew by having no view no longer decides. Offline mock `cnvlate`: contest in round 1, an explicit no_view from round 2 on.
test('T2c (a contest, then no view): the judge\'s latest position is no view, so the objection is stands_uncontested, with no minority note, and the writer\'s note counts the reviewer in no bucket but does not call the objection "not debated" (a contest was posted on it)', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-support-garbled', 'e1', 1), seat('mock-exch-cnvlate-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const o = rowOf(r, 'e1');
  assert.deepEqual(givenBy(o, 'e2').slice(0, 2), [[1, 'contest', true], [2, 'no_view', true]], 'the fixture: a contest in round 1, an explicit no_view after');
  assert.deepEqual([o.outcome, o.minority_notes], ['stands_uncontested', []]);
  assert.ok(seen.find(p => p.label === 'revise-1').user.includes(`- ${o.id} (upheld): 0 supported it, 0 contested it, 0 said the evidence was insufficient.`), 'no reviewer holds a position on the final text, but one was posted: the note reads like the record word, not "not debated"');
});

// T2f, a quoted objection: an amend whose quoted passage is not found is refused, and the objection keeps its OLD passage as its anchor (the id is made from it); nothing writes the amended passage over it.
test('T2f (a quoted objection): the refused amend leaves the objection\'s own passage as its anchor, in the record and in the round-2 prompts, and its id is the one made from that passage', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-support-amend-badpassage-quoted', 'e1', 1), seat('mock-exch-contest-keep-clean', 'e2', 1), seat('mock-critic-x', 'e9', 2)], ON));
  const o = rowOf(r, 'e1');
  assert.ok(typeof o.quote === 'string' && o.quote.length >= 8, 'the fixture: the objection carries a passage of its own');
  assert.equal(o.posts.find(p => p.by === 'e2').quote, o.quote, 'it is the draft\'s first line, which the contest quotes too');
  assert.equal(o.id, objectionId('e1', { criterion: o.criterion, quote: o.quote }), 'its id is made from the old passage');
  assert.deepEqual([o.reply, o.problem, o.original_problem, o.flags.map(f => [f.round, f.requirement])], [undefined, 'No assumptions section.', undefined, [[1, 'amend_passage_not_found'], [2, 'amend_passage_not_found']]]);
  assert.equal(o.quote === 'A passage that the plan does not contain at all.', false, 'the amended passage is not the anchor');
  for (const label of ['lreply-1-x2-e1', 'ldebate-1-x2-e2']) {
    const p = seen.find(x => x.label === label);
    assert.ok(p && p.user.includes(`Quoted passage: ${o.quote}`) && !p.user.includes('A passage that the plan does not contain at all.'), `${label} prints the old passage, not the refused one`);
  }
});

// T22aa, a concurrent objection: the carried objection is debated from round 1 TOGETHER with the objection the next pass raises (it does not wait for the others to be settled). e3 signs off in pass 1 and objects in pass 2 (script 'ox').
test('T22aa (a concurrent objection): in pass 2 the carried objection and e3\'s new one are both shown in round 1, and both draw their first post in round 1', async () => {
  const [e1, e2, e9] = last7('c7c');
  const { r, seen } = await go(chainOf([e1, e2, seat('mock-critic-script-ox-c7c', 'e3', 1), e9], { ...ON, maxRounds: 3 }));
  const d2 = r.layerDebates.find(d => d.pass === 2);
  const x = d2?.objections.find(o => o.raised_by === 'e1' && o.carried_from === 1);
  const y = d2?.objections.find(o => o.raised_by === 'e3');
  assert.ok(x && y, `the fixture: pass 2 holds the carried objection and e3's own: ${JSON.stringify(d2?.objections.map(o => [o.raised_by, o.carried_from]))}`);
  assert.deepEqual([Math.min(...x.posts.map(p => p.round)), Math.min(...y.posts.map(p => p.round))], [1, 1], 'neither waits for the other');
  const first = seen.find(p => p.label === 'ldebate-2-e2');
  assert.ok(first && first.user.includes(`Objection ${x.id}`) && first.user.includes(`Objection ${y.id}`), 'e2\'s round-1 prompt shows both');
});

// ---- M0 FIX 2 -> M0 FIX-UP 2 item 6, the pure functions: ONE definition of a position for the outcome, the minority notes and the writer's note (C&C 4 Nov 2026; Muad's pick "follow each judge's latest position", copy correction 10, CHANGE_LOG 10g). ----
// CHANGED ACCEPTED (M0 FIX-UP 2, item 6). OLD (M0 FIX 2): any counted contest or insufficient-evidence post on the final text decided the outcome, whatever the same judge posted after it; the minority note took each judge's latest post OF THE WANTED STANCE; positionPosts listed a judge once per stance. NEW: each judge counts ONCE, by its latest counted post (latestPosts), an explicit no_view included (it holds no stance); the outcome, the minority notes and the writer's note all read that. A refused (counted:false) post is no position and is skipped. WHY: Muad's pick, relayed by C&C: the recorded note sentence counts reviewers.
test('outcome and notes (M0 FIX-UP 2): each judge counts once, by its latest counted post: a contest later followed by a support or by no view no longer decides; a refused post is skipped; withdrawn, contested and uncontested cases', () => {
  const post = (by, round, stance, extra = {}) => ({ by, round, stance, text: `${by}${round}`, counted: true, ...extra });
  const posts = [post('a', 1, 'contest'), post('a', 2, 'support'), post('b', 1, 'no_view'), post('c', 1, 'contest', { counted: false }), post('d', 1, 'insufficient_evidence'), post('d', 2, 'contest'), post('f', 1, 'contest'), post('f', 2, 'no_view')];
  assert.equal(outcomeOf(posts, null), 'stands_contested', 'd\'s latest position is a contest');
  assert.equal(outcomeOf([post('a', 1, 'contest'), post('a', 2, 'support')], null), 'stands_uncontested', 'a contest followed by the same judge\'s support');
  assert.equal(outcomeOf([post('a', 1, 'contest'), post('a', 2, 'no_view')], null), 'stands_uncontested', 'a contest followed by the same judge\'s no view (the step past B3\'s code)');
  assert.equal(outcomeOf([post('a', 1, 'support'), post('b', 1, 'no_view'), post('c', 1, 'contest', { counted: false })], null), 'stands_uncontested', 'support, no_view and a refused contest: none against it');
  assert.equal(outcomeOf([post('a', 1, 'insufficient_evidence')], null), 'stands_contested', 'a doubt is a position against');
  assert.equal(outcomeOf(posts, { action: 'withdraw' }), 'withdrawn_argued');
  assert.deepEqual(LD.minorityNotesOf(posts, 'stands_contested').map(n => [n.by, n.round, n.stance]), [['d', 2, 'contest']], 'only d still contests; a and f dropped their contest, c\'s was refused');
  assert.deepEqual(LD.minorityNotesOf(posts, 'withdrawn_argued').map(n => [n.by, n.round, n.stance]), [['a', 2, 'support']]);
  assert.deepEqual(LD.minorityNotesOf(posts, 'stands_uncontested'), []);
  assert.deepEqual(LD.latestPosts(posts).map(p => `${p.by}${p.round}:${p.stance}`), ['a2:support', 'b1:no_view', 'd2:contest', 'f2:no_view'], 'a judge once, its latest counted post; no_view is a position; the refused post is skipped');
});
// C&C's word (Option B, 4 Nov 2026, "ONE RED for B's own case"): what the writer's note reads. `posted` (is the objection "debated", and so settled on that draft) keeps its meaning from before M0 FIX 2: some reviewer left a counted post other than no_view. The counts and the listed posts follow each reviewer's latest position. A reviewer who contested and then had no view leaves `posted` TRUE and every count 0, so the objection reads "(upheld): 0 ..." and stays settled (a re-ask pass does not show it again); a later edit of latestPosts cannot drag it along.
test('note positions (M0 FIX-UP 2, Option B): contest then no view stays posted (settled) with every count 0; the pure no_view case is not posted; the counts and the listed posts are the latest positions', () => {
  const post = (by, round, stance, extra = {}) => ({ by, round, stance, text: `${by}${round}`, counted: true, ...extra });
  const read = x => { const n = LD.notePositionsOf(x); return [n.posted, n.support, n.contest, n.doubt, n.posts.map(p => `${p.by}${p.round}:${p.stance}`)]; };
  assert.deepEqual(read([post('a', 1, 'contest'), post('a', 2, 'no_view')]), [true, 0, 0, 0, []], 'contest then no view: posted, no bucket, nothing listed');
  assert.deepEqual(read([post('a', 1, 'support'), post('a', 2, 'no_view')]), [true, 0, 0, 0, []], 'support then no view');
  assert.deepEqual(read([post('a', 1, 'no_view'), post('b', 1, 'no_view')]), [false, 0, 0, 0, []], 'only no_view: nobody posted');
  assert.deepEqual(read([post('a', 1, 'contest', { counted: false })]), [false, 0, 0, 0, []], 'a refused post is not a post');
  assert.deepEqual(read([post('a', 1, 'contest'), post('a', 2, 'support'), post('b', 1, 'insufficient_evidence'), post('c', 1, 'support')]), [true, 2, 0, 1, ['a2:support', 'b1:insufficient_evidence', 'c1:support']], 'each reviewer once, by its latest position; a contest dropped by supporting is not listed');
});

// ---- M1: a clean sign-off that names a defect in an exchange post (C&C's ruling, copy-silent; GO item 8) ----
// OLD: a judge that signed off blind (meets:true, no objection) and then named a defect in a post was turned into an objecting verdict (meets:false); report.json kept its blind sign-off nowhere. NEW: the blind sign-off is kept in panelVerdicts (experimental: `signed_off` + `defect_named`) and the defect is the judge's OWN open objection, riding on `openOwn` as a stated pass's does (M0 FIX 10): it holds the layer and reaches the writer, the answer-back and the stall signature. signoff[] is a STABLE field (`true` means signed off), so the row reads as before: `signedOff: false`, the defect in `objections`, no `holds_layer` (that is for a stated pass, whose row says nothing).
// The fixture is #120's with a clean sign-off in place of the stated pass: e1 is cleared by the exchange (it withdraws), so the defect e2 names is the only thing that holds the layer.
const FLIP_CRITERION = 'It adds no scope the request did not ask for.';
const flipChain = (extra, withLayer2 = true) => chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-exch-new-keep-clean', 'e2', 1), ...(withLayer2 ? [seat('mock-critic-x', 'e9', 2)] : [])], extra);
let flipRun; const flip = () => (flipRun ??= go(flipChain(ON)));   // two passes: the writer is asked (revise-1) and pass 2 runs
let flip1Run; const flip1 = () => (flip1Run ??= go(flipChain({ ...ON, maxRounds: 1 })));   // ONE pass, so signoff[] is pass 1's rows (signoff[] lists the final pass only; on a revised draft the mock judges sign off and name nothing)
test('M1 flip: a clean sign-off that names a defect in a post keeps its signed_off word in panelVerdicts and says so; the defect holds the layer; signoff[] reads as before', async () => {
  const { r } = await flip1();
  const N = objectionId('e2', { criterion: FLIP_CRITERION });
  assert.deepEqual(r.layerDebates[0].cleared, ['e1'], 'the fixture: e1 withdrew in the exchange, so the defect e2 named is the only thing that holds the layer');
  const pv = r.panelVerdicts.find(v => v.round === 1 && v.lab === 'e2');
  assert.deepEqual([pv.verdict, pv.defect_named, pv.exchange_changed], ['signed_off', true, undefined], 'the blind sign-off is kept in the record');
  assert.equal(r.layers.find(l => l.round === 1 && l.layer === 1).state, 'objected', 'the layer is not signed off');
  assert.equal(labels(r).includes('panel-1-e9'), false, 'layer 2 is not asked in pass 1: the defect holds layer 1');
  const row = r.signoff.find(s => s.lab === 'e2');
  assert.deepEqual([row.signedOff, row.holds_layer, row.objections?.map(o => [o.id, o.from_exchange])], [false, undefined, [[N, true]]], 'signoff[] is a stable field: the row reads objected, with the defect in objections, as before the sign-off was kept in panelVerdicts');
  assert.match(r.history.join('\n'), /mock-exch-new-keep-clean: 1 failure\(s\)/, 'the panel history (the finalist\'s prompt input) is byte-identical to what the old flip printed: no new wording reaches a model');
});
test('M1 flip (the writer\'s note): the defect a clean sign-off named is listed in the exchange note like an objecting judge\'s', async () => {
  const { seen } = await flip();
  const N = objectionId('e2', { criterion: FLIP_CRITERION });
  const note = seen.find(p => p.label === 'revise-1').user;
  assert.ok(note.includes('# What the other reviewers of the layer said about these objections'), 'the fixture: the pass has an exchange note');
  assert.match(note, new RegExp(`\n- ${N} \\(`), 'the defect has its own line in the note');
});
test('M1 flip (the reviser and the answer-back): the defect reaches the writer\'s revise list and the judge\'s answer-back in the next pass', async () => {
  const { seen } = await go(flipChain({ ...ON, ...RETAINED }));
  const N = objectionId('e2', { criterion: FLIP_CRITERION });
  assert.ok(seen.find(p => p.label === 'revise-1'), 'the fixture: pass 1 ends in a revision');
  assert.ok(seen.find(p => p.label === 'revise-1').user.includes('The plan names a second deliverable nobody asked for.'), 'the reviser is given it');
  assert.ok(seen.find(p => p.label === 'panel-2-e2').user.includes(N), 'pass 2 shows e2 the defect it named, among the objections it is asked about');
});
// (No stall test for the flip: the stall signature is a pure function of the round's `allFailures`, the array the reviser test above reads. On a revised draft the mock judge answers its answer-back entry as withdrawn, so a mock fixture cannot keep the defect in two passes running without a second mechanism. The reviser test fails if the fold drops the defect, and the signature would lose it the same way.)
// GO item 9: a stated pass that holds its layer read signedOff null and objections null and said nothing about what held the layer.
test('M1 (GO item 9): a stated pass that holds the layer keeps signedOff null and objections null, and signoff[] names what holds the layer under holds_layer', async () => {
  const { r } = await go(chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-critic-passer-new', 'e2', 1), seat('mock-critic-x', 'e9', 2)], { ...PASSING, maxRounds: 1 }));   // one pass: signoff[] is pass 1's rows
  const N = objectionId('e2', { criterion: FLIP_CRITERION });
  const row = r.signoff.find(s => s.lab === 'e2');
  assert.deepEqual([row.signedOff, row.objections, row.passed, row.holds_layer?.map(h => [h.id, h.from_exchange])], [null, null, true, [[N, true]]]);
  assert.equal(r.signoff.find(s => s.lab === 'p1').holds_layer, undefined, 'a seat that holds nothing has no holds_layer');
});
test('M1 (the record): a report whose clean sign-off named a defect (defect_named) and a report with a stated pass that holds the layer (holds_layer) validate against the schema', async () => {
  const shapeOf = r => JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-layer-debate', chain: 'layer-debate-test', task: 'task.md', result: r })));
  const flipped = shapeOf((await flip1()).r);
  const passed = shapeOf((await go(chainOf([seat('mock-exch-support-withdraw', 'e1', 1), seat('mock-exch-contest-keep-clean', 'p1', 1), seat('mock-critic-passer-new', 'e2', 1), seat('mock-critic-x', 'e9', 2)], { ...PASSING, maxRounds: 1 }))).r);
  assert.ok(flipped.panelVerdicts.some(v => v.defect_named === true) && passed.signoff.some(s => s.holds_layer?.length), 'the fixture: the reports carry the two new fields');
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')));
  for (const shape of [flipped, passed]) assert.equal(validate(shape), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});

// The challenge stage (config.challenge) runs after the critic/revise rounds whether or not they ended in a sign-off, and its prompt (model input, in a frozen file) lists each seat's word from signoff[]. A seat that signed off and then named a defect that holds its layer reads `objected` there, because its signoff[] row reads signedOff false. A GUARD (green before and after); it fails if that row's word moves.
test('M1 flip (the challenge stage): the challenger is told a seat that holds its layer objected, byte for byte as before the sign-off was kept in the record', async () => {
  const config = flipChain({ ...ON, maxRounds: 1, challenge: { enabled: true } });
  config.seats.challenger = { provider: 'mock', model: 'mock-challenge-no', lab: 'mock-challenger' };   // a challenger that declines (src/providers.js: every model but mock-challenge-yes does)
  const { seen } = await go(config);
  const prompt = seen.find(p => p.label === 'challenge');
  assert.ok(prompt, 'the fixture: the challenge stage ran');
  assert.match(prompt.user, /e2\/mock-exch-new-keep-clean: objected/);
});
