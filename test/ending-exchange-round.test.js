// 0.8.4 S4b (M1), U3-2/U3-3: the LAST ROUND of the ENDING exchange (CA6, W26, D24; T22f, T22u, T22a, T22v, T22b, T22w, Q-i4, Q-i5) driven through exchangeRound with a cache stub that answers by label. Offline, $0, mock seats.
// `rounds: 1` makes round 1 the last round of the exchange (k === maxRounds), which is how a seventh-round behaviour is reached without scripting six rounds that must each keep changing; the chain passes rounds 7 (U3-4).
// LABELS (round 'end'): round 1 `ldebate-end-<seat>` / `lreply-end-<seat>`; round k > 1 `ldebate-end-x<k>-<seat>` / `lreply-end-x<k>-<seat>` (exchangeRound's labelOf: `${kind}-${round}${k > 1 ? `-x${k}` : ''}-${key}`).
// Guarded imports: namespace imports and a dynamic import, so on a tree without the option or the module each row fails by assertion and the file still loads (the red tree).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as CH from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as IDS from '../src/objection-ids.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as SS from '../src/stage-system.js';
import { DEMAND } from './helpers/rating-demand.js';
import { readFileSync } from 'node:fs';
import { severityTold } from '../src/prompts/recorded-083.js';
const EP = await import('../src/ending-exchange-prompts.js').catch(() => ({}));

afterEach(() => { setHeldForTest(null); CH.setCache(null); CH.setPromptSpy(null); });
const W26 = { lateFindingRule: HB084.lateFindingRule, lastRoundReplyRule: HB084.lastRoundReplyRule };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = '# Plan\n\nThe worker retries failed requests at most three times. Bake a cake. Sell it at the fair.';
const F = { criterion: CRITERION, problem: 'There is no back-off between retries.', quote: 'retries failed requests', fix: 'Add one.', severity: 6 };
const seat = lab => ({ provider: 'mock', model: 'mock-review-fixture', lab, layer: 1 });
const reply = (service) => JSON.stringify(service);
const textOf = (script) => label => (label in script ? script[label] : null);

async function round({ script, lastSystems = true, rounds = 1, held = W26 }) {
  const prompts = new Map(); const asked = [];
  CH.setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
  setHeldForTest(held);
  CH.setCache({ invalidate() {}, get(label) { asked.push(label); const t = textOf(script)(label); return t === null ? null : { text: t, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 }; } });
  const config = { name: 'x', signoff: 'unanimous', seats: { critics: [seat('a'), seat('b')] } };
  const ending = lastSystems ? { post: (s, again) => EP.lastRoundPostSystem(config, s, again), reply: (s, again) => EP.lastRoundReplySystem(config, s, again) } : null;
  const out = await CH.exchangeRound({ judges: [{ key: 'a', seat: seat('a'), failures: [F] }, { key: 'b', seat: seat('b'), failures: [] }], request: 'A mock task.', criteria: [CRITERION], draft: DRAFT, round: 'end', record: x => x, rounds, layerOne: true, severity: true, ...(ending ? { ending } : {}) });
  return { out, prompts, asked };
}

test('T22f: the last round of the ending exchange carries W26 in the post prompt, in place of the recorded sentence on a newly found defect, and the reply prompt carries the no-amend half', async () => {
  const cfg = { name: 'x', signoff: 'unanimous', seats: { critics: [seat('a')] } };
  setHeldForTest(W26);
  const post = EP.lastRoundPostSystem(cfg, seat('b'), false);
  assert.ok(post.includes(HB084.lateFindingRule()), 'W26 is in the last-round post prompt');
  assert.equal(post.includes(EP.NEW_DEFECT_SENTENCE), false, 'the recorded sentence is replaced, not kept beside it');
  const rep = EP.lastRoundReplySystem(cfg, seat('a'), false);
  assert.ok(rep.endsWith(HB084.lastRoundReplyRule()), 'the reply prompt ends with W26\'s reply half');
  assert.equal(EP.endingExchangeOn(), true);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: after `setHeldForTest({})` the row asserted `EP.endingExchangeOn() === false` ('held: the ending exchange is off'), and the variants row of T22f had a 'plain (rating demand not recorded)' variant. NEW: both held assertions are removed (K7: after the recording no shipped run is held; SIBLING: `endingExchangeOn() === true` just above, and the 'ratings' variants of the variants row). WHY: lateFindingRule (W26) and ratingDemand are recorded.
});
test('T22f (the round itself): in the last round b is asked with the W26 prompt; in an ordinary exchange round (no ending option) the same judge is asked with the recorded sentence and W26 is not used', async () => {
  const script = { 'ldebate-end-b': reply({ posts: [{ on: IDS.objectionId('a', F), stance: 'no_view' }] }) };
  const last = await round({ script });
  assert.ok(last.prompts.get('ldebate-end-b').includes(HB084.lateFindingRule()));
  const ordinary = await round({ script: { 'ldebate-end-b': script['ldebate-end-b'] }, lastSystems: false });
  assert.equal(ordinary.prompts.get('ldebate-end-b').includes(HB084.lateFindingRule()), false, 'W26 is not used outside the last round of the ending exchange');
  assert.ok(ordinary.prompts.get('ldebate-end-b').includes(EP.NEW_DEFECT_SENTENCE ?? 'If you find a material defect'));
});
test('T22a / T22v / T22b / T22w / Q-i4 / Q-i5: in the last round a judge\'s late_finding comes back in `late` (rating kept, 8.5; a refused rating kept unrated; an ungrounded one flagged) and mints NO objection', async () => {
  const idF2 = IDS.objectionId('a', F);
  const script = { 'ldebate-end-b': reply({ posts: [{ on: idF2, stance: 'support', text: 'It holds.' }], late_finding: [
    { criterion: CRITERION, problem: 'The delay between retries is unbounded.', quote: 'at most three times', rating: 8.5 },
    { criterion: CRITERION, problem: 'A rating the scale refuses.', quote: 'at most three times', rating: 11 },
    { problem: 'Nothing to anchor it.', rating: 5 },
  ], new_objections: [{ criterion: CRITERION, problem: 'Put where an objection goes.', quote: 'Bake a cake', severity: 4 }] }) };
  const { out } = await round({ script });
  assert.deepEqual(out.late.map(l => [l.by, l.round, l.problem, l.rating, l.flags.join('+')]), [
    ['b', 1, 'The delay between retries is unbounded.', 8.5, ''],
    ['b', 1, 'A rating the scale refuses.', null, ''],
    ['b', 1, 'Nothing to anchor it.', 5, 'ungrounded'],
    ['b', 1, 'Put where an objection goes.', 4, 'named_as_objection'],
  ]);
  assert.equal(typeof out.late[1].rating_refused, 'string', 'T22b: kept unrated, with the reason');
  assert.deepEqual(out.rows.map(r => r.id), [idF2], 'nothing was minted: the only objection is the one that was shown');
  assert.equal(out.proposed, undefined, 'and nothing went to proposed');
});
test('T22w: a refused rating is not retried: the only exchange call of the round is b\'s post (no -retry label, no second ask)', async () => {
  const idF3 = IDS.objectionId('a', F);
  const { asked } = await round({ script: { 'ldebate-end-b': reply({ posts: [{ on: idF3, stance: 'support', text: 'Yes.' }], late_finding: { criterion: CRITERION, problem: 'p', quote: 'at most three times', rating: 11 } }) } });
  assert.deepEqual(asked.filter(k => k.startsWith('ldebate-') || k.startsWith('lreply-')), ['ldebate-end-b']);
});
test('T22u: in the last round the raiser\'s amend is invalid (amend_in_last_round): no amended text is recorded and the objection stands on its text; the held-off control keeps the amend', async () => {
  const idF4 = IDS.objectionId('a', F);
  const post = reply({ posts: [{ on: idF4, stance: 'contest', text: 'It does not hold.', quote: 'retries failed requests' }] });
  const amend = reply({ replies: [{ id: idF4, action: 'amend', text: 'Right in part.', problem: 'The back-off is unbounded.' }] });
  const last = await round({ script: { 'ldebate-end-b': post, 'lreply-end-a': amend } });
  const row = last.out.rows.find(r => r.id === idF4);
  assert.equal(row.problem, F.problem, 'the objection keeps its debated text');
  assert.ok((row.flags || []).some(f => f.kind === 'raiser_reply_invalid' && f.requirement === 'amend_in_last_round'));
  const ordinary = await round({ script: { 'ldebate-end-b': post, 'lreply-end-a': amend }, lastSystems: false });
  assert.equal(ordinary.out.rows.find(r => r.id === idF4).problem, 'The back-off is unbounded.', 'control: an ordinary round takes the amend');
});

// ---- C&C's item 1: W26 under the rating demand (W26 is in the same recorded batch as ratingDemand, so once recorded every layered chain's post prompt is the ratings variant) ----
// The cut is made between two recorded anchors; a persona block is placed before the reply-format sentence, which comes AFTER the second anchor (src/stage-system.js placeBeforeReplyFormat), so it cannot fall inside the cut.
const LAYERED = JSON.parse(readFileSync(new URL('../chains/mock-layered.json', import.meta.url), 'utf8'));
const withLedger = c => ({ ...c, answer_back: { enabled: true } });
const withHandler = c => ({ ...c, seats: { ...c.seats, reviser: { provider: 'external', model: 'handler' } } });
const withPersona = c => ({ ...c, seat_personas: { enabled: true, form: 'title' }, seats: { ...c.seats, critics: c.seats.critics.map(x => ({ ...x, persona: 'Herbert' })) } });
const TITLE = { seatTitleBlock: ({ name }) => `The name is the title of your seat: ${name}.` };
const OPENING = 'If you find a material defect in the plan that is not on the list, put it in "new_objections": something the plan says or leaves out that fails the request or a criterion, not a wish to widen its scope.';
test('T22f, every variant of the post prompt (plain, ratings, ratings + ledger, ratings + handler, ratings + both, ratings + a seat title): W26 replaces the WHOLE paragraph on a newly found defect and its rating, nothing else moves; both again values', () => {
  const variants = [
    ['ratings', DEMAND, LAYERED, [false, false]],
    ['ratings + ledger', DEMAND, withLedger(LAYERED), [true, false]],
    ['ratings + handler', DEMAND, withHandler(LAYERED), [false, true]],
    ['ratings + ledger + handler', DEMAND, withHandler(withLedger(LAYERED)), [true, true]],
    ['ratings + a seat title', { ...DEMAND, ...TITLE }, withPersona(LAYERED), [false, false]],
  ];
  const ratedTexts = new Set();
  for (const [name, demand, config, flags] of variants) for (const again of [false, true]) {
    setHeldForTest({ ...demand, ...W26 });
    const where = `${name}, again=${again}`; const seat = config.seats.critics[0];
    const ordinary = SS.layerDebateSystemFor(config, seat, again);
    assert.equal(ordinary.includes('Give each new objection a severity'), flags !== null, `${where}: the premise (the ordinary prompt asks for a rating on a new objection exactly when the rating demand is recorded)`);
    if (name.endsWith('seat title')) assert.ok(ordinary.includes('title of your seat'), `${where}: the premise (the persona block is in the ordinary prompt)`);
    const cut = ordinary.indexOf(OPENING); const after = ordinary.indexOf('\nNo count of posts settles an objection');
    assert.ok(cut > 0 && after > cut, `${where}: the anchors are in the ordinary prompt`);
    const span = ordinary.slice(cut, after);   // what W26 takes the place of
    if (flags === null) assert.equal(span, EP.NEW_DEFECT_SENTENCE, `${where}: the plain span is the recorded sentence`);
    else {
      assert.ok(span.startsWith(`${OPENING} It is recorded with the other objections of this layer and follows the same rating rule.\nGive each new objection a severity`), `${where}: the rated span opens with the recorded sentences`);
      assert.ok(span.endsWith(severityTold(...flags)), `${where}: the rated span ends with the told sentence of this variant`);
      if (!again && !name.endsWith('seat title')) ratedTexts.add(ordinary);
    }
    const last = EP.lastRoundPostSystem(config, seat, again);
    assert.equal(last, ordinary.slice(0, cut) + HB084.lateFindingRule() + ordinary.slice(after), `${where}: W26 stands in place of the span and the rest is byte-identical`);
    for (const gone of ['If you find a material defect', 'follows the same rating rule', 'Give each new objection a severity', 'is never dropped']) assert.equal(last.includes(gone), false, `${where}: "${gone}" is not in the last round`);
    if (name.endsWith('seat title')) assert.ok(last.includes('title of your seat'), `${where}: the persona block survives the cut`);
  }
  assert.equal(ratedTexts.size, 4, 'the four rated variants (plain, ledger, handler, both) are four different texts: none collapsed into another');
});
