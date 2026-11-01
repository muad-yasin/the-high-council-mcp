// B2 (debate-084/b2, A-DRAFT wording): the exchange inside layer 1 (src/layer-debate.js, runChain's layerExchange). Offline, mock seats only, $0. `mock-exch-<post>-<reply>` (src/providers.js) objects like the default scripted
// critic and, in the exchange, posts <post> on every objection it is shown and answers its own posts with <reply>.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setProgressHook, setPromptSpy } from '../src/chain.js';
import { readPosts, readReplies, outcomeOf, exchangeObjections } from '../src/layer-debate.js';
import { objectionId } from '../src/objection-ids.js';
import { reportJsonShape } from '../src/report-shape.js';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { promptHashOf } from '../src/cache-integrity.js';
import { estimateChainRows } from '../src/cost.js';
import { lintChain } from '../src/chain-lint.js';
import { objectionLedger } from '../src/objection-ledger.js';
import { overseerLedgerSection } from '../src/roles.js';
import { escalatedSignoffBlock } from '../src/escalation.js';

afterEach(() => { setCache(null); setBudget(null); setProgressHook(null); setPromptSpy(null); });

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
const ON = { layer_debate: { enabled: true } };
const TABLE = { signoff_table: { required: true } };
const RETAINED = { answer_back: { enabled: true }, ...TABLE };

test('exchange: a withdrawn objection leaves the pass, its raiser counts as signed off after the exchange, the other stays and reaches the reviser with the posts', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-withdraw', 'e2', 1), seat('mock-critic-x', 'e3', 2)], ON));
  assert.deepEqual(labels(r).filter(l => /^(ldebate|lreply)-/.test(l)).sort(), ['ldebate-1-e1', 'ldebate-1-e2', 'lreply-1-e1', 'lreply-1-e2']);
  const d = r.layerDebates[0];
  assert.equal(d.pass, 1); assert.equal(d.layer, 1);
  const byRaiser = Object.fromEntries(d.objections.map(o => [o.raised_by, o]));
  assert.equal(byRaiser.e2.outcome, 'withdrawn', 'e1 contested it with a quote and a reason; e2 withdrew with a reason');
  assert.equal(byRaiser.e1.outcome, 'upheld', 'e2 supported it, so nothing stands against it');
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
  assert.equal(exch.length, 4);
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
  assert.ok(r.layerDebates[0].objections.every(o => o.outcome === 'upheld'));
  assert.equal(r.layerDebates[0].cleared, undefined);
});

test('exchange: a contested objection its raiser keeps is recorded unresolved, with both sides', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], ON));
  const o = r.layerDebates[0].objections[0];
  assert.equal(o.outcome, 'unresolved');
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
  assert.equal(named.outcome, 'not_debated', 'named in the last (here the only) round: no other judge read it');
});

test('exchange: an unreadable post reply counts no posts and every objection stands', async () => {
  const { r, log } = await go(chainOf([seat('mock-exch-garbled-keep', 'e1', 1), seat('mock-exch-garbled-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  assert.match(log, /unreadable exchange reply - no posts counted/);
  // CHANGED ACCEPTED (B2 fix-up A, 29 Okt 2026). OLD: outcome 'upheld'. NEW: 'not_debated'. WHY: an objection nobody posted on was reported as upheld with 0 supporters and 0 contests, which reads to the writer as nobody disagreed; it was not debated.
  assert.ok(r.layerDebates[0].objections.every(o => o.outcome === 'not_debated' && o.posts.length === 0), 'nobody posted, so nobody debated it: it is not "upheld"');
  assert.ok(!labels(r).some(l => l.startsWith('lreply-')), 'nobody posted, so nobody is asked to answer');
});

test('exchange: off by default - no exchange label, no layerDebates, the verdicts are the blind ones', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-contest-withdraw', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { maxRounds: 1 }));
  assert.ok(!labels(r).some(l => /^(ldebate|lreply)-/.test(l)));
  assert.equal(r.layerDebates, undefined);
  assert.deepEqual(r.layers.filter(x => x.round === 1).map(x => `${x.layer}:${x.state}`), ['1:objected', '2:not_asked']);
});

test('exchange: a single heard judge has nobody to read its objection - no exchange, and the writer is told it was not debated', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 2 }));
  assert.equal(r.layerDebates, undefined);
  assert.match(seen.find(p => p.label === 'revise-1').user, /\(not debated\): no other reviewer of its layer has posted support, contest or insufficient evidence on it against this draft/);
});

test('exchange: a defect named in a post in the last allowed round reaches the writer marked as not debated', async () => {
  const { seen } = await go(chainOf([seat('mock-exch-new-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 2 }));
  assert.match(seen.find(p => p.label === 'revise-1').user, /\(not debated\)/);
});

test('report.json: layer_debates is additive and present only when an exchange ran', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 1 }));
  const shape = reportJsonShape({ runId: 'r-layer-debate', chain: 'layer-debate-test', task: 'task.md', result: r });
  assert.ok(Array.isArray(shape.layer_debates) && shape.layer_debates.length === 1);
});

test('exchange: a judge whose objections were all withdrawn counts as signed off only with a complete table - without one it is an abstention', async () => {
  const { r, log } = await go(chainOf([seat('mock-exch-contest-withdraw-short', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...TABLE, maxRounds: 1 }));
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
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 2 }));
  const gone = r.layerDebates[0].objections.find(o => o.raised_by === 'e1');
  assert.equal(gone.outcome, 'withdrawn');
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
  assert.equal(outcomeOf([{ counted: true, stance: 'contest' }], out[0]), 'unresolved');
  assert.equal(outcomeOf([{ counted: true, stance: 'contest' }], { action: 'withdraw', text: 'r' }), 'withdrawn');
  assert.equal(outcomeOf([{ counted: false, stance: 'contest' }, { counted: true, stance: 'support' }], null), 'upheld');
});

test('exchangeObjections: two problems under one id are one objection', () => {
  const out = exchangeObjections([{ key: 'a', failures: [{ criterion: 'C1', problem: 'p1' }, { criterion: 'C1', problem: 'p2' }] }], objectionId);
  assert.equal(out.length, 1); assert.equal(out[0].problem, 'p1 / p2');
});

test('dry-run estimate: with layer_debate the layer-1 judges get an ldebate row and an lreply row, on the layer-1 pass count; off, none', () => {
  const critics = [seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  const base = { maxOverseerRounds: 2, layerRevisions: { 1: 3, 2: 1 } };
  for (const maximum of [false, true]) {
    const on = estimateChainRows(chainOf(critics, { ...base, ...ON }), { maximum }).map(r => r.label);
    const off = estimateChainRows(chainOf(critics, base), { maximum }).map(r => r.label);
    assert.deepEqual(on.filter(l => /^l(debate|reply)-/.test(l)), ['ldebate-L1-e1', 'lreply-L1-e1', 'ldebate-L1-e2', 'lreply-L1-e2']);
    assert.deepEqual(off.filter(l => /^l(debate|reply)-/.test(l)), []);
  }
  const rows = estimateChainRows(chainOf(critics, { ...base, ...ON }), { maximum: true });
  assert.equal(rows.find(r => r.label === 'ldebate-L1-e1').times, rows.find(r => r.label === 'panel-L1-e1').times, 'the same pass count as the layer-1 review');
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

const R2 = n => ({ layer_debate: { enabled: true, rounds: n } });
const exLabels = r => labels(r).filter(l => /^(ldebate|lreply)-/.test(l));

test('rounds: a second round runs only after a disposition changed; a stance flip in round 2 earns round 3, and round 3 with nothing changed ends it', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-amendonce', 'e1', 1), seat('mock-exch-flip-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...R2(5), maxRounds: 1 }));
  const d = r.layerDebates[0];
  assert.deepEqual(d.rounds.map(x => [x.round, x.changed, x.stance_changed]), [[1, true, false], [2, true, true], [3, false, false]], 'round 1: an amendment; round 2: e2 flipped to support; round 3: nothing moved');
  assert.deepEqual(exLabels(r).filter(l => /-x3-/.test(l)).sort(), ['ldebate-1-x3-e1', 'ldebate-1-x3-e2', 'lreply-1-x3-e1', 'lreply-1-x3-e2'], 'later rounds carry -x<k> in the label');
  assert.ok(exLabels(r).includes('ldebate-1-e1') && exLabels(r).includes('ldebate-1-x2-e1'));
  const again = seen.find(p => p.label === 'ldebate-1-x2-e2');
  assert.match(again.system, /This is a later round of the exchange/);
  assert.match(again.user, /Earlier in this exchange:\nRound 1, your own post \(contest\)/, 'a judge sees which earlier post was its own');
  assert.match(again.user, /the reviewer who raised it answered "amend"/, 'and the raiser\'s earlier answer');
  const mine = d.objections.find(o => o.raised_by === 'e1');
  assert.equal(mine.original_problem, 'No assumptions section.'); assert.match(mine.problem, /Narrowed once/);
});

test('rounds: no disposition changed in round 1 -> no second round, however many are allowed', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...R2(7), maxRounds: 1 }));
  assert.deepEqual(r.layerDebates[0].rounds.map(x => x.round), [1]);
  assert.ok(!exLabels(r).some(l => /-x2-/.test(l)));
});

test('rounds: the safety net - a judge that amends every round is stopped at `rounds`', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-amend', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...R2(3), maxRounds: 1 }));
  assert.deepEqual(r.layerDebates[0].rounds.map(x => [x.round, x.changed]), [[1, true], [2, true], [3, true]]);
});

test('rounds: an objection withdrawn in round 2 leaves the pass; the other stays unresolved with both rounds on record', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-amendonce', 'e1', 1), seat('mock-exch-contest-keepthenwithdraw', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...R2(5), maxRounds: 1 }));
  const d = r.layerDebates[0];
  const by = Object.fromEntries(d.objections.map(o => [o.raised_by, o]));
  assert.equal(by.e2.outcome, 'withdrawn'); assert.equal(by.e2.replies.length, 2); assert.deepEqual(by.e2.replies.map(x => [x.round, x.action]), [[1, 'keep'], [2, 'withdraw']]);
  assert.equal(by.e1.outcome, 'unresolved');
  assert.deepEqual(d.cleared, ['e2']);
  assert.ok(by.e1.posts.every(p => typeof p.by === 'string' && p.round >= 1), 'every post keeps its poster and round');
});

test('lint and estimate: rounds outside 1-7 are refused; the maximum figure counts every allowed round, the expected one round', () => {
  const critics = [seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  const base = { maxOverseerRounds: 2, layerRevisions: { 1: 3, 2: 1 } };
  const timesOf = (n, maximum) => estimateChainRows(chainOf(critics, { ...base, ...R2(n) }), { maximum }).find(r => r.label === 'ldebate-L1-e1').times ?? 1;
  assert.equal(timesOf(3, true), timesOf(1, true) * 3);
  const kinds = n => lintChain(chainOf(critics, { ...R2(n) }), 'x.json').map(f => f.kind);
  assert.ok(kinds(8).includes('layer-debate-rounds') && kinds(0).includes('layer-debate-rounds'));
  assert.ok(!kinds(7).includes('layer-debate-rounds') && !kinds(1).includes('layer-debate-rounds'));
  assert.equal(timesOf(3, false), timesOf(1, false));
});

test('rounds: a defect named in round 1 is read by the other judges in round 2 and then counts as debated', async () => {
  const { r } = await go(chainOf([seat('mock-exch-new-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...R2(3), maxRounds: 1 }));
  const named = r.layerDebates[0].objections.find(o => o.from_exchange);
  assert.equal(named.added_round, 1);
  assert.deepEqual(named.posts.map(p => [p.by, p.round, p.stance]), [['e2', 2, 'support']]);
  assert.equal(named.outcome, 'upheld');
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
  const { r } = await go(chainOf([seat('mock-exch-newlater-withdraw-id-ra2', 'e1', 1), seat('mock-exch-contest-withdraw', 'e2', 1), seat('mock-exch-contest-keep-late-ra2', 'e3', 1), seat('mock-critic-x', 'e4', 2)], { ...ON, maxRounds: 2 }));
  const pass2 = r.panelVerdicts.filter(v => v.round === 2 && v.layer === 1);
  const e1 = pass2.find(v => v.lab === 'e1');
  assert.equal(e1.exchange_changed, true, 'e1 was carried from pass 1, and pass 2\'s exchange gave it a new objection');
  assert.equal(e1.verdict, 'objected');
});

test('resume: replaying a finished run through the stage cache re-asks nothing - every exchange prompt is byte-identical to the first run\'s', async () => {
  const first = new Map(); const stages = new Map();
  setPromptSpy(p => first.set(p.label, promptHashOf(p.system, p.user)));
  const cfg = () => chainOf([seat('mock-exch-contest-amendonce', 'e1', 1), seat('mock-exch-flip-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...R2(4), maxRounds: 2 });
  const a = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-replay', config: cfg() });
  for (const s of a.stages) stages.set(s.label, s);
  const second = new Map();
  setPromptSpy(p => second.set(p.label, promptHashOf(p.system, p.user)));
  setCache({ get: label => (stages.has(label) ? { ...stages.get(label), promptHash: first.get(label) } : null) });
  const b = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-replay', config: cfg() });
  const ex = m => [...m.keys()].filter(l => /^(ldebate|lreply)-/.test(l)).sort();
  assert.ok(ex(first).length >= 8, 'the first run really ran several exchange rounds');
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
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 2 }));
  const gone = r.layerDebates[0].objections.find(o => o.raised_by === 'e1');
  assert.equal(gone.outcome, 'withdrawn');
  const p2 = seen.find(p => p.label === 'panel-2-e1').user;
  assert.match(p2, /# Objections you withdrew in your layer's exchange/);
  assert.ok(p2.includes(`- ${gone.id} (round 1):`) && p2.includes('You said: The quoted passage settles it.'), 'the id and its own reason');
  assert.ok(!seen.find(p => p.label === 'panel-2-e2').user.includes('Objections you withdrew'), 'a judge that withdrew nothing reads nothing new');
  assert.ok(!seen.find(p => p.label === 'panel-1-e1').user.includes('Objections you withdrew'), 'and nobody reads it before the pass after the withdrawal');
});

test('withdrawn ids shown back are information only: a judge that ignores the block is not asked again and owes no answer', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw-noanswers', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 3 }));
  // e1 reads the block in pass 2 and gives no answers at all (the -noanswers mock): if the withdrawn id were among the objections it owes an answer for, it would be unanswered and re-asked.
  assert.ok(labels(r).includes('panel-2-e1'), 'pass 2 asked e1');
  assert.ok(!labels(r).some(l => /^panel-\d+-e1-reask/.test(l)), 'e1 was never re-asked');
  assert.ok(!r.answerBackReplies.some(x => x.lab === 'e1' && (x.effect === 'unanswered' || x.effect === 'unknown_id')), 'no answer was owed for the withdrawn id');
});

test('a re-raise: a judge raises again what it withdrew; the record marks it, and it is debated again', async () => {
  const { r, seen } = await go(chainOf([seat('mock-exch-contest-withdraw-always', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, maxRounds: 2 }));
  assert.equal(r.layerDebates.length, 2);
  const first = r.layerDebates[0].objections.find(o => o.raised_by === 'e1'); const again = r.layerDebates[1].objections.find(o => o.raised_by === 'e1');
  assert.equal(first.outcome, 'withdrawn'); assert.equal(first.re_raise, undefined);
  assert.equal(again.id, first.id); assert.equal(again.re_raise, true, 'marked as a re-raise'); assert.ok(again.posts.length > 0, 'and debated again on the new draft');
});

test('withdrawn block: a long reason and criterion are cut with a visible marker, so up to 20 entries stay small', async () => {
  const { exchangeWithdrawnSection } = await import('../src/roles.js');
  const text = exchangeWithdrawnSection({ items: [{ id: 'O-aaaaaaaa', pass: 2, criterion: 'c'.repeat(5000), reason: 'r'.repeat(5000) }] });
  assert.ok(text.length < 1200 && text.includes('[cut]'), `length ${text.length}`);
});

test('report.json with an exchange withdrawal (answer_back on) validates against the schema, its closed effect enum included', async () => {
  const { r } = await go(chainOf([seat('mock-exch-contest-withdraw', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)], { ...ON, ...RETAINED, maxRounds: 2 }));
  assert.ok(r.answerBackReplies.some(x => x.effect === 'withdrawn_exchange'), 'the run wrote the new effect');
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8')));
  const shape = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-layer-debate', chain: 'layer-debate-test', task: 'task.md', result: r })));
  assert.equal(validate(shape), true, JSON.stringify((validate.errors || []).slice(0, 3)));
});
