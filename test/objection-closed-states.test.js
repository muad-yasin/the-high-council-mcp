// 0.8.4 S4 (M1), U4: the identity of an objection that an UPPER layer or a RE-TAG closed (Q12, W6; T12g, T12n, NEW-A1-1, NEW-A1-2) and what an adoption leaves on the record (D20; T12j, T12o, T20k, T20x). Offline, $0: a cache stub answers every stage by its label
// (the stall-escalation tests' pattern), so the judges object, rule, re-tag and sign off exactly when the script says. The relation wording W6 and the ruling words are HELD (test/held-prompts/held-084-b.js, held-escalation.js) and the rating demand is a held word
// (test/helpers/rating-demand.js): every run injects all three. The ids a seat may RE-OPEN are its own withdrawn ones and, since this unit, the ones an upper layer overruled (rated below 4, never 7 or above), an upper layer adopted, or a re-tag put below 4.
// The rating gate on an overrule is built (0.8.4 S5 U-B: an overrule closes an objection rated below 4 only; T5d and T20j below read it). Not claimed: how a model answers the W6 wording (the mock ignores prompt text).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import * as ASN from '../src/objection-assign.js';   // a namespace import, so a tree without the new export fails that row alone and not the whole file
const { assignIds } = ASN;
import * as IDS from '../src/objection-ids.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HESC from './held-prompts/held-escalation.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); IDS.setIdCriteria?.(null); });
const HELD = { ...DEMAND, relationRule: HB084.relationRule, escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection };

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const LOW = 'raiser-alpha';
const X = { criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests', fix: 'State a limit.', severity: 3 };       // swept: rated below 4
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker', fix: 'Name an owner.', severity: 8 };                 // holding: rated 7 or above
const idX = objectionId(LOW, X); const idY = objectionId(LOW, Y);
const row = verdict => ({ criterion: CRITERION, verdict, evidence: 'Section two.' });
const meets = () => JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok' });
const objects = (...fs) => JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: fs, verdict_line: 'no' });
const rules = list => JSON.stringify({ rulings: list });

// ---- the pure assigner: every closed state may be re-opened, and only a closed one ----
const F = (problem, relation) => ({ criterion: CRITERION, problem, quote: 'retries failed requests', relation });
const BID = objectionId('a', F('No limit on retries.'));   // the id the failure derives (its base): the closed id and the new id share it
const own = state => new Map([[BID, { base: BID, problemNorm: 'no limit on retries.', state }]]);
test('assignIds: `reopens` an id in ANY closed state (withdrawn, overruled, adopted, cleared by a re-tag) mints a linked #r2; a standing id is not closed', () => {
  assert.deepEqual([...(ASN.GONE_STATES ?? [])].sort(), ['adopted', 'cleared_retag', 'overruled', 'withdrawn']);
  for (const state of ['withdrawn', 'overruled', 'adopted', 'cleared_retag']) {
    const a = assignIds({ lab: 'a', failures: [F('No limit on retries.', `reopens ${BID}`)], own: own(state) });
    assert.equal(a.unreadable, null, state);
    assert.deepEqual([a.failures[0].id, a.failures[0].reopens], [`${BID}#r2`, BID], state);
  }
  const standing = assignIds({ lab: 'a', failures: [F('No limit on retries.', `reopens ${BID}`)], own: own('standing') });
  assert.equal(standing.unreadable?.why, 'reopens_not_closed', 'a standing objection is continued, never reopened');
});

// NEW (0.8.4, Muad 11 Nov 2026: a lowering below 4 holds even when the judge answers again, the handling session's and the top layer's): an own entry cleared by a re-tag of the HANDLER or of LAYER 3 keeps its id for `continues`, `reopens` and the same text as `new`, with no suffix and no reopens note; a different text under the same key is still `#2`; the same entry without `by` (a re-tag of unknown source), and every other closed state, read as before.
// CHANGED ACCEPTED (0.8.4, the top layer's lowering holds like the handler's). OLD: the row held the HANDLER's entry only and asserted that an entry without `by` was "the top layer's" and read continues_not_standing. NEW: the loop runs both sources (`by: 'handler'`, `by: 'layer3'`: the two values the re-tag rows carry), and the refusal is asserted for an entry with NO `by`. WHY: the top layer's re-tag now carries `by: 'layer3'` and holds; the old comment named a premise (no `by` = top layer) that is no longer true.
test('assignIds: an objection a re-tag lowered below 4 (by the handler or by layer 3) keeps its id when the judge answers on it again (continues, reopens, the same text as new); a different text takes #2; a re-tag with no `by` is unchanged', () => {
  for (const by of ['handler', 'layer3']) {
    const held = new Map([[BID, { base: BID, problemNorm: ASN.normProblem('No limit on retries.'), state: 'cleared_retag', by }]]);
    for (const rel of [`continues ${BID}`, `reopens ${BID}`, 'new']) {
      const a = assignIds({ lab: 'a', failures: [F('No limit on retries.', rel)], own: held });
      assert.equal(a.unreadable, null, `${by} ${rel}`);
      assert.deepEqual([a.failures.length, a.failures[0].id, a.failures[0].reopens, a.failures[0].same_key], [1, BID, undefined, undefined], `${by} ${rel}`);
    }
    const other = assignIds({ lab: 'a', failures: [F('A different complaint about the same passage.', 'new')], own: held });
    assert.deepEqual([other.unreadable, other.failures[0].id, other.failures[0].same_key], [null, `${BID}#2`, true], `${by}: a different text under the same key is a new objection`);
  }
  const unknown = assignIds({ lab: 'a', failures: [F('No limit on retries.', `continues ${BID}`)], own: own('cleared_retag') });
  assert.equal(unknown.unreadable?.why, 'continues_not_standing', 'a re-tag with no `by` (unknown source) reads as before');
});

// ---- the run: an upper layer overrules one objection and adopts the other (T12g, T12n) ----
async function run({ script, maxRounds = 4, critics, retags, stall = 2 }) {   // `stall` = dispute.stall_rounds (0.8.4 S5: a row whose objection must stand through two verdicts of a lone top-layer judge raises it above the number of passes it runs)
  const served = []; const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
  setHeldForTest(HELD);
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-closed-states', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: stall }, maxRounds,
    seats: { builder, reviser: builder, critics: critics.map(seat) } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-closed', log: () => {}, config, ...(retags ? { retags } : {}) });
  return { result, served, prompts };
}
const withRelation = (f, relation) => ({ ...f, relation });
const Z = { criterion: CRITERION, problem: 'No back-off is named.', quote: 'failed requests', fix: 'Name one.', severity: 8 };   // the top layer's own objection: it makes the writer revise, so the floor resets and layer 1 is asked again
const STALL = {   // layer 1 raises X (rated 3) and Y (rated 8) in passes 1 and 2: the stall passes both up to layer 2, which reviews blind and then rules
  'panel-1-raiser-alpha': objects(withRelation(X, 'new'), withRelation(Y, 'new')),
  'panel-2-raiser-alpha': objects(withRelation(X, `continues ${idX}`), withRelation(Y, `continues ${idY}`)),
};
const rulesOn = (a, b) => rules([{ id: idX, ruling: a, reason: 'Section two sets the limit.' }, { id: idY, ruling: b, reason: 'Nobody owns the worker.' }]);
const CRITICS = [[LOW, 1], ['mid-beta', 2], ['top-gamma', 3]];
const lastOf = (result, lab) => result.lastCritique?.failures.find(f => f.lab === lab);
// Layer 2 overrules both and signs off; the top layer objects (Z), the writer revises, the floor resets: pass 4 asks layer 1 again.
// `reask` (0.8.4 S5 U-B fix-up): the reply to the one re-ask a pass-4 reply gets when it leaves Y (rated 8, overruled but still open) unanswered and is otherwise swept (X, rated 3): the re-ask's reply REPLACES the first one, so a row that reads the re-raise must give the re-ask the same reply.
const afterOverrule = (reply, { first = STALL, reask = null } = {}) => run({ critics: CRITICS, maxRounds: 4, script: { ...first, 'rule-3-mid-beta': rulesOn('overrule', 'overrule'), 'panel-3-top-gamma': objects(withRelation(Z, 'new')), 'panel-4-raiser-alpha': reply, ...(reask ? { 'panel-4-raiser-alpha-reask1': reask } : {}) } });
// CHANGED (0.8.4 S5 U-B fix-up). OLD: the re-raise was the only failure of LOW in lastCritique (lastOf), because an overrule closed Y too and dropped it. NEW: Y (rated 8) stays open, so LOW also carries Y; exactly one failure is not Y, and that is the re-raise. The re-ask (see afterOverrule's `reask`) is what makes the re-raise survive: its reply replaces the first reply, and a default sign-off there would leave only Y. WHY: the premise (a closed id raised again) is unchanged.
const reRaised = result => { const fs = (result.lastCritique?.failures ?? []).filter(f => f.lab === LOW && f.id !== idY); assert.equal(fs.length, 1, `exactly one failure of LOW besides the carried Y: ${JSON.stringify(fs.map(f => f.id))}`); return fs[0]; };
const afterReRaise = reply => afterOverrule(reply, { reask: reply });

test('T12g: a judge re-raises an objection rated below 4 that an upper layer overruled and closed: a NEW id #r2 linked to the closed one, not the overruled id again', async () => {
  const { result, served } = await afterReRaise(objects(withRelation({ ...X, problem: 'The retry limit is still missing.' }, `reopens ${idX}`)));
  assert.ok(served.includes('panel-4-raiser-alpha'), 'pass 4 asked layer 1 again');
  const f = reRaised(result);
  assert.deepEqual([f.id, f.reopens], [`${idX}#r2`, idX]);
});
test('T12g: ... the same text with no declaration is recorded as reopens too (RU-S2-18 for an overruled id)', async () => {
  const { result } = await afterReRaise(objects(withRelation(X, 'new')));
  const f = reRaised(result);
  assert.deepEqual([f.id, f.reopens], [`${idX}#r2`, idX]);
});
test('T12g: ... a DIFFERENT text under the overruled key, declared new, is a new objection #2 (same key), not a reopens', async () => {
  const { result } = await afterReRaise(objects(withRelation({ ...X, problem: 'A different problem entirely.' }, 'new')));
  const f = reRaised(result);
  assert.deepEqual([f.id, f.same_key, f.reopens], [`${idX}#2`, true, undefined]);
});
// NEW (0.8.4, C&C 12 Nov 2026: the no-lowering reopen, pinned as it runs; no class is claimed): X is FIRST rated 3 (no re-tag anywhere), passed up with Y, overruled and closed by layer 2, and in pass 4 its raiser brings it back with `reopens` AT 5 and, in the same reply, withdraws Y (rated 8, overruled but open), so that X is the ONLY thing layer 1 could hold on. The reopen is the ordinary Q12 one: a new linked id (X#r2) at the judge's own rating; at 5 it is open in the severity record and layer 1 objects in pass 4; the same reply with X reopened at 3 leaves layer 1 signing off.
test('T12g at 5 (no lowering, Y withdrawn): a judge reopens an objection first rated 3 that an upper layer overruled and closed, at a rating of 5: the new id X#r2 is linked to X, stands OPEN (rated 5) and layer 1 objects in pass 4; the same reopen at 3 is swept and layer 1 signs off', async () => {
  // The top judge answers its own pass-3 objection in pass 4 (withdrawing it with a passage the draft holds, as topWithdrawsZ at the end of this file does), so that when layer 1 signs off the climb does not stop on the top layer's unchanged objection (the first build of this row stopped there: stall_stop, top_layer, passes 3 and 4).
  const reopenAt = async severity => { const reply = JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: [withRelation({ ...X, severity, problem: 'The retry limit is still missing.' }, `reopens ${idX}`)], verdict_line: 'no', answers: [{ id: idY, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] }); return (await run({ critics: CRITICS, maxRounds: 4, script: { ...STALL, 'rule-3-mid-beta': rulesOn('overrule', 'overrule'), 'panel-3-top-gamma': objects(withRelation(Z, 'new')), 'panel-4-raiser-alpha': reply, 'panel-4-raiser-alpha-reask1': reply, 'panel-4-top-gamma': topWithdrawsZ } })).result; };
  const stateOf = result => (result.layers ?? []).find(r => r.round === 4 && r.layer === 1)?.state;
  const high = await reopenAt(5);
  assert.deepEqual(high.lastCritique.failures.filter(f => f.lab === LOW).map(f => f.id), [`${idX}#r2`], 'premise: Y is withdrawn, the only failure of layer 1 is the reopen (the linked X#r2)');
  assert.ok(high.severityRun.open.some(o => (o.id ?? o) === `${idX}#r2`), `X#r2 rated 5 is open: ${JSON.stringify(high.severityRun.open.map(o => [o.id ?? o, o.value ?? o.severity]))}`);
  assert.equal(stateOf(high), 'objected', 'X#r2 rated 5 holds layer 1 in pass 4');
  const low = await reopenAt(3);
  assert.ok(!low.severityRun.open.some(o => (o.id ?? o) === `${idX}#r2`), 'the same reopen at 3 is swept, not open');
  assert.equal(stateOf(low), 'signed_off', 'rated 3 it holds nothing: layer 1 signs off in pass 4');
});
// NEW (0.8.4, C&C 12 Nov 2026: one row on the quoted pair): X is first rated 3, passed up with Y, overruled and closed by layer 2, and in pass 4 its raiser raises a SECOND problem on the SAME quoted passage and criterion, declared `new`, at 5, while withdrawing Y. The key is the same (the lab, the criterion and the quoted passage), so the second problem takes the suffix #2 (same_key). The question this row answers: is X#2 COUNTED as a standing objection (holds layer 1), or is it filed as a repeat of the closed X (the raiser filter looks an id up by its derived id) and dropped from the verdict?
test("T12g new at 5 (quoted pair): a second problem on the quoted passage of an objection that layer 2 overruled and closed, declared new at 5, is X#2 (same key), COUNTED and standing: layer 1 objects in pass 4 and no repeat of X is recorded", async () => {
  const reply = JSON.stringify({ meets: false, criteria: [row("FAILED")], failures: [withRelation({ ...X, severity: 5, problem: "The retry limit is still missing." }, "new")], verdict_line: "no", answers: [{ id: idY, status: "withdrawn", evidence: "It reads \"The worker retries failed requests.\"" }] });
  const { result } = await run({ critics: CRITICS, maxRounds: 4, script: { ...STALL, "rule-3-mid-beta": rulesOn("overrule", "overrule"), "panel-3-top-gamma": objects(withRelation(Z, "new")), "panel-4-raiser-alpha": reply, "panel-4-raiser-alpha-reask1": reply, "panel-4-top-gamma": topWithdrawsZ } });
  const own = result.lastCritique.failures.filter(f => f.lab === LOW);
  assert.deepEqual(own.map(f => [f.id, f.same_key, f.reopens]), [[`${idX}#2`, true, undefined]], "premise: Y is withdrawn, the only failure of layer 1 is the second problem under X's key (X#2, same_key, no reopens)");
  assert.ok(result.severityRun.open.some(o => (o.id ?? o) === `${idX}#2`), `X#2 rated 5 is open: ${JSON.stringify(result.severityRun.open.map(o => [o.id ?? o, o.value ?? o.severity]))}`);
  assert.equal((result.layers ?? []).find(r => r.round === 4 && r.layer === 1)?.state, "objected", "X#2 holds layer 1 in pass 4: it was not filed as a repeat of the closed X");
  assert.deepEqual((result.escalations ?? []).flatMap(e => e.raised_again ?? []), [], "no repeat of X was recorded on any escalation");
});
test('T20j (was a PIN until S5 U-B): an overruled objection rated 7 or above is NOT closed for its raiser (an overrule closes only a rating below 4, N25): `continues` names it, the reply is read (no re-ask), and the repeat is COUNTED under the SAME id (no #r2), because the objection stayed open', async () => {
  const { result, served } = await afterOverrule(objects(withRelation(Y, `continues ${idY}`)));
  assert.equal(served.some(l => l.startsWith('panel-4-raiser-alpha-reask')), false, 'the reply was readable');
  assert.equal(lastOf(result, LOW)?.id, idY, 'the id a ruling did NOT close is a live objection again, under its own id (before S5 U-B the raised-again filter dropped it)');
});
test('PIN: the line is 4.0: an overruled objection rated exactly 4 is not closed (continues is read), one rated 3.9 is (continues is unreadable)', async () => {
  for (const [sev, closed] of [[4, false], [3.9, true]]) {
    const f = { ...X, severity: sev }; const id = objectionId(LOW, f);
    const rl = rules([{ id, ruling: 'overrule', reason: 'Section two sets the limit.' }, { id: idY, ruling: 'overrule', reason: 'Nobody owns the worker.' }]);
    const { served } = await run({ critics: CRITICS, maxRounds: 4, script: { 'panel-1-raiser-alpha': objects(withRelation(f, 'new'), withRelation(Y, 'new')), 'panel-2-raiser-alpha': objects(withRelation(f, `continues ${id}`), withRelation(Y, `continues ${idY}`)),
      'rule-3-mid-beta': rl, 'panel-3-top-gamma': objects(withRelation(Z, 'new')), 'panel-4-raiser-alpha': objects(withRelation(f, `continues ${id}`)) } });
    assert.equal(served.includes('panel-4-raiser-alpha-reask1'), closed, `rated ${sev}`);
  }
});
test('an overruled objection rated below 4 is closed: `continues` naming it is an unreadable reply (one re-ask), because the id is no longer the raiser\'s standing one', async () => {
  const { served } = await afterOverrule(objects(withRelation(X, `continues ${idX}`)));
  assert.ok(served.includes('panel-4-raiser-alpha-reask1'), 'the judge is asked again');
});
test('T12n: a judge re-raises its own objection that an upper layer sustained and ADOPTED, as `reopens`: W6 offers it and a new id is minted (the adopted id is closed for its first owner)', async () => {
  // pass 3: layer 2 overrules X, sustains Y (adopts it as its own, mid-beta) and objects; pass 4: layer 2 withdraws the adopted one and signs off, the top layer objects (Z); pass 5: layer 1 is asked again
  const idYm = objectionId('mid-beta', Y);
  const withdrawn = JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok', answers: [{ id: idYm, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests." now.' }] });
  const { result, served, prompts } = await run({ critics: CRITICS, maxRounds: 5, script: { ...STALL, 'rule-3-mid-beta': rulesOn('overrule', 'sustain'), 'panel-4-mid-beta': withdrawn, 'panel-4-top-gamma': objects(withRelation(Z, 'new')),
    'panel-5-raiser-alpha': objects(withRelation({ ...Y, problem: 'Still nobody is named.' }, `reopens ${idY}`)) } });
  assert.ok(served.includes('panel-5-raiser-alpha'), 'pass 5 asked layer 1 again');
  const w6 = HB084.relationRule();
  assert.match(w6, /sustained and adopted/);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: /cleared by a re-tag below 4/. NEW: /that a re-tag below 4 cleared/. WHY: the relation rule now reads "... that an upper layer sustained and adopted, or that a re-tag below 4 cleared." (src/prompts/recorded-084-b.js relationRule, apply f60ebad2).
  assert.match(w6, /that a re-tag below 4 cleared/);   // the recorded W6 offers both new cases
  assert.ok(prompts.get('panel-5-raiser-alpha').includes(w6), 'and the blind-review prompt of the judge carries it');
  const f = lastOf(result, LOW);
  assert.deepEqual([f.id, f.reopens], [`${idY}#r2`, idY]);
});

// ---- a re-tag below 4 clears an objection that stood at 4 or above (NEW-A1-1, NEW-A1-2; N25) ----
// pass 1: la raises X5 (rated 5, it blocks). The handler re-tags it to 3 at the top of pass 2 (a recorded act of its own), so the objection is cleared; in pass 2 la raises it again. A re-tag by layer 3 counts from the pass AFTER the one it settles.
const X5 = { ...X, severity: 5 }; const idX5 = objectionId('la', X5);
const afterRetag = (reply, { retags = [{ pass: 2, id: idX5, severity: 3, reason: 'A missing limit does not change what is built.' }], stall = 2 } = {}) => run({ critics: [['la', 1]], maxRounds: 2, retags, stall, script: { 'panel-1-la': objects(withRelation(X5, 'new')), 'panel-2-la': reply } });
const lastLa = result => result.lastCritique?.failures.find(f => f.lab === 'la');

// CHANGED ACCEPTED (0.8.4, Muad 11 Nov 2026: "Yes it holds, even when the judge disagrees"; two rows). OLD: an objection the HANDLER re-tagged below 4 and the judge raised again (same key, same text: `new` or a declared `reopens`) got a new linked id <id>#r2 at the judge's own rating, `reopens` set. NEW: the same objection keeps its own id, with no #r2 and no reopens link, and the handler's rating stays in force (the re-tag is on the record as before). WHY: the handling session's lowering holds when the judge answers again; a re-tag by layer 3, and every other closed state, still mint #r2 (the rows above and R-a). RED BEFORE: the old code gives <id>#r2.
test('NEW-A1-1: an objection rated 5 and lowered below 4 by the HANDLER'+"'"+'s re-tag, raised again by the same seat with the same key and the same text: it is the same objection under its own id (no #r2, no reopens link)', async () => {
  const { result } = await afterRetag(objects(withRelation(X5, 'new')));
  assert.deepEqual(result.severityRun.retags.map(x => [x.id, x.from, x.to, x.by, x.pass]), [[idX5, 5, 3, 'handler', 2]], 'the re-tag is on the record');
  assert.deepEqual([lastLa(result).id, lastLa(result).reopens], [idX5, undefined]);
});
test('NEW-A1-1: ... declared `reopens` by the judge it is the same: the same objection under its own id', async () => {
  const { result } = await afterRetag(objects(withRelation(X5, `reopens ${idX5}`)));
  assert.deepEqual([lastLa(result).id, lastLa(result).reopens], [idX5, undefined]);
});
test('NEW-A1-2: ... with a DIFFERENT text under the same key, declared new: a new objection #2 (same key), not a reopens', async () => {
  const { result } = await afterRetag(objects(withRelation({ ...X5, problem: 'A different problem entirely.' }, 'new')));
  assert.deepEqual([lastLa(result).id, lastLa(result).same_key, lastLa(result).reopens], [`${idX5}#2`, true, undefined]);
});
// CHANGED (0.8.4 S5 U-C fix-up, 08 Nov 2026): the call passes `stall: 3`. OLD: the window was 2 and the run ended at the round cap. NEW: the lone layer-1 judge is the top layer, its objection (re-tagged to 6, so it still holds the sign-off) stands through its verdicts of passes 1 and 2, and with a window of 2 that is a stall at the last pass: a stall_stop. WHY: the row is about which id the repeat is counted under, not about the stall; a window of 3 cannot be reached in two passes.
test('PIN: a re-tag to a value of 4 or above clears nothing: the seat continues its objection under the same id (declared continues is read, no re-ask)', async () => {
  const { result, served } = await afterRetag(objects(withRelation(X5, `continues ${idX5}`)), { retags: [{ pass: 2, id: idX5, severity: 6, reason: 'Worse than rated.' }], stall: 3 });
  assert.equal(served.some(l => l.startsWith('panel-2-la-reask')), false, 'the reply was readable');
  assert.equal(lastLa(result).id, idX5);
});
test('PIN: an objection that was ever rated 7 or above is not a cleared id after a re-tag below 4: the seat continues it under the same id (where the record places such an objection is T19e\'s open row, not claimed here)', async () => {
  const X8 = { ...X, severity: 8 }; const idX8 = objectionId('la', X8);
  const { result, served } = await run({ critics: [['la', 1]], maxRounds: 2, retags: [{ pass: 2, id: idX8, severity: 3, reason: 'No effect on what is built.' }], script: { 'panel-1-la': objects(withRelation(X8, 'new')), 'panel-2-la': objects(withRelation(X8, `continues ${idX8}`)) } });
  assert.equal(served.some(l => l.startsWith('panel-2-la-reask')), false, 'the reply was readable: the id is still the seat\'s standing one');
  assert.equal(lastLa(result).id, idX8);
});

// ---- what an adoption leaves on the record (T12j, T12o, T20k, T20x; D20). PINS: these hold on the tip before this unit; they name sustained_from and adopted_as as the code writes them (the copy says adopted_from, Q-k: no rename) ----
test('T12j / T12o / T20k / T20x (PIN): layer 2 sustains a sent-up objection rated 8: a new id under the layer-2 seat linked to the original, the original retired as adopted, the objection still OPEN at 8 under the new id and nothing recorded as cleared', async () => {
  const { result } = await run({ critics: CRITICS, maxRounds: 3, script: { ...STALL, 'rule-3-mid-beta': rulesOn('overrule', 'sustain') } });
  const idYm = objectionId('mid-beta', Y);
  const out = result.escalations[0].outcome.find(o => o.id === idY);
  assert.deepEqual([out.result, out.adopted_as.map(a => [a.lab, a.id])], ['sustained', [['mid-beta', idYm]]], 'the original is retired as adopted, naming the new id');
  const f = lastOf(result, 'mid-beta');
  assert.deepEqual([f.id, f.sustained_from.id, f.sustained_from.lab, f.severity], [idYm, idY, LOW, 8], 'the new id is linked to the original and carries its rating');
  assert.deepEqual(result.severityRun.open.map(o => [o.id, o.lab, o.severity, o.state]), [[idYm, 'mid-beta', 8, 'unresolved']], 'open under the new id at the original rating; the original id is not kept open beside it');
  assert.deepEqual(result.severityRun.withdrawn, [], 'nothing is recorded as cleared by the adoption');
});

// ---- the severity ledger's own answer: which objections a re-tag cleared ----
const Sev = await import('../src/severity.js');
test('clearedByRetag (pure): the row that CROSSED the line decides: 5 -> 6 -> 3 and 3 -> 5 -> 3 are cleared (pass of the crossing row), 3 -> 5 is not, a value ever 7 or above is not, a handler row counts from its own pass', () => {
  const ledger = (id, severity) => new Map([[id, { lab: 'la', status: 'active', severity }]]);
  const r = Sev.createSeverityRun();
  r.commit('la', 'O-aaaaaaaa', 5, 1);
  r.applyRetags(2, [{ seat: 's', retags: [{ id: 'O-aaaaaaaa', severity: 6, reason: 'up' }] }], ledger('O-aaaaaaaa', 5));
  assert.deepEqual(r.clearedByRetag('la'), [], 'still 4 or above');
  r.applyRetags(3, [{ seat: 's', retags: [{ id: 'O-aaaaaaaa', severity: 3, reason: 'down' }] }], ledger('O-aaaaaaaa', 6));
  assert.deepEqual(r.clearedByRetag('la'), [{ id: 'O-aaaaaaaa', pass: 3, by: 'layer3' }]);
  const q = Sev.createSeverityRun();
  q.commit('la', 'O-bbbbbbbb', 3, 1);
  q.applyRetags(2, [{ seat: 's', retags: [{ id: 'O-bbbbbbbb', severity: 5, reason: 'up' }] }], ledger('O-bbbbbbbb', 3));
  assert.deepEqual(q.clearedByRetag('la'), [], '3 -> 5 clears nothing');
  q.applyRetags(4, [{ seat: 's', retags: [{ id: 'O-bbbbbbbb', severity: 3, reason: 'down' }] }], ledger('O-bbbbbbbb', 5));
  assert.deepEqual(q.clearedByRetag('la'), [{ id: 'O-bbbbbbbb', pass: 4, by: 'layer3' }], '3 -> 5 -> 3: it stood at 5 and a re-tag put it below 4');
  const h = Sev.createSeverityRun();
  h.commit('la', 'O-cccccccc', 8, 1); h.applyHandlerRetags(2, [{ id: 'O-cccccccc', severity: 3, reason: 'down' }]);
  assert.deepEqual(h.clearedByRetag('la'), [], 'ever rated 7 or above: not cleared');
  const g = Sev.createSeverityRun();
  g.commit('la', 'O-dddddddd', 5, 1); g.applyHandlerRetags(2, [{ id: 'O-dddddddd', severity: 3, reason: 'down' }]);
  assert.deepEqual(g.clearedByRetag('la'), [{ id: 'O-dddddddd', pass: 2, by: 'handler' }]);
  assert.equal(g.closesOnOverrule('la', 'O-dddddddd'), true); assert.equal(g.closesOnOverrule('la', 'O-cccccccc'), false);
});

// ---- T5d: the overrule of a sent-up objection rated below 4 closes it on the record ----
test('T5d: a sent-up objection rated 3.0 that layer 2 overruled is closed on the record, gone from its raiser\'s list, and the raiser\'s sign-off is computed on its next blind verdict', async () => {
  const { result, prompts } = await afterOverrule(meets());
  const out = result.escalations[0].outcome.find(o => o.id === idX);
  assert.equal(out.result, 'overruled', 'closed on the record by the ruling');
  assert.equal(prompts.get('panel-4-raiser-alpha').includes(idX), false, 'gone from the raiser\'s list: its answer-back entry left at the ruling');
  // CHANGED (0.8.4 S5 U-B): Y (rated 8) was overruled in the same ruling and, rated 4 or above, STAYS OPEN: the raiser's clean reply leaves it unanswered, so the verdict computed on its next blind reply is objected. (Before: an overrule closed any rating, the verdict was signed_off.)
  assert.equal(result.panelVerdicts.find(v => v.round === 4 && v.lab === LOW).verdict, 'objected', 'computed on the next blind verdict: Y stays open and is unanswered');
  assert.equal(result.severityRun.swept.some(o => o.id === idX), false, 'a closed objection is not carried as a swept one');
  assert.equal(result.severityRun.open.some(o => o.id === idX), false);
});

// ---- T19e / T19n: layer 3 re-tags an objection rated 8.0 to 3.0 and nothing else happens ----
// Layer 1 raises X8 (rated 8) in passes 1 and 2 (a stall); with no ruling words recorded the objection is passed up to layer 2 and stays standing there; layer 2 signs off, the top layer (layer 3) is asked in pass 3, re-tags it to 3.0 and objects (Z) so the plan is revised and the floor resets;
// pass 4 asks layer 1 again.
const X8 = { ...X, severity: 8 }; const idX8 = objectionId(LOW, X8);
const retagReply = JSON.stringify({ meets: false, criteria: [row('FAILED')], failures: [withRelation(Z, 'new')], verdict_line: 'no', retags: [{ id: idX8, severity: 3, reason: 'A missing limit does not change what is built.' }] });
const NO_RULING_WORDS = { ...DEMAND, relationRule: HB084.relationRule };
// 0.8.4 S5 (U-C): the top judge answers its OWN pass-3 objection (Z) in pass 4 by withdrawing it with a quote the revised draft holds. Without it a clean sign-off leaves Z unanswered, Z stands again, and a top-layer objection that stood through two of its verdicts (passes 3, 4) is a stall at the last pass: a stall_stop, not a finished run.
const idZTop = objectionId('top-gamma', Z);
const topWithdrawsZ = JSON.stringify({ meets: true, criteria: [row('MET')], failures: [], verdict_line: 'ok', answers: [{ id: idZTop, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
async function retagRun(pass4) {
  const served = []; const prompts = new Map();
  setPromptSpy(p => prompts.set(p.label, `${p.system}\n${p.user}`));
  setHeldForTest(NO_RULING_WORDS);
  const script = { 'panel-1-raiser-alpha': objects(withRelation(X8, 'new')), 'panel-2-raiser-alpha': objects(withRelation(X8, `continues ${idX8}`)), 'panel-3-top-gamma': retagReply, 'panel-4-raiser-alpha': pass4, 'panel-4-top-gamma': topWithdrawsZ };
  setCache({ invalidate() {}, get(label) {
    served.push(label);
    const text = label in script ? script[label] : (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-retag-down', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 4, seats: { builder, reviser: builder, critics: CRITICS.map(seat) } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-retag-down', log: () => {}, config });
  return { result, served, prompts };
}
test('T19e: layer 3 re-tags an objection rated 8.0 to 3.0 and nothing else happens: the re-tag is recorded (old, new, who, reason) and the objection is NOT cleared by it', async () => {
  const { result } = await retagRun(objects(withRelation(X8, `continues ${idX8}`)));
  assert.deepEqual(result.severityRun.retags.map(x => [x.id, x.from, x.to, x.by, x.pass, x.reason]), [[idX8, 8, 3, 'layer3', 3, 'A missing limit does not change what is built.']], 'old, new, who, pass and reason');
  // CHANGED (0.8.4 S5 U-C fix-up). OLD: `withdrawn` is empty. NEW: its one row is the top judge's own Z, withdrawn in pass 4 (the fixture's answer, see topWithdrawsZ); there is still no row for the re-tagged X8. WHY: the assertion's meaning is that the re-tag cleared nothing; a withdrawal by someone else is recorded, and the exact list says so.
  assert.deepEqual(result.severityRun.withdrawn.map(w => [w.id, w.lab]), [[idZTop, 'top-gamma']], 'nothing is recorded as cleared by the re-tag: the only withdrawn row is the top judge\'s own Z');
  // CHANGED ACCEPTED (0.8.4 S17, C&C's Q3 ruling of 09 Nov, RU-S19-10 / RT). OLD: the READING of this row put the re-tagged X8 in `swept` (`const row8 = ...swept.find(...)`) and asserted `open.some(...) === false` ("it blocks nothing any more"). NEW: it is in `open` (open_at_end) with its first rating kept, rated 3 now, and in no `swept` list; the "blocks nothing" half is kept as `layer 1 signs off` by T19n below. WHY: an objection once rated 7 or above is never closed by a re-tag below 4 (N25), so it stays open on the record, and the dispute list already said so; only the severity section put it in `swept`. RED ON THE PARENT: the parent lists it in `swept`, so `row8` is undefined here.
  const row8 = result.severityRun.open.find(o => o.id === idX8);
  assert.deepEqual([row8?.original, row8?.severity], [8, 3], 'rated 3.0 now, 8.0 originally, kept as an OPEN row (once rated 7 or above, never closed by a re-tag)');
  assert.equal(result.severityRun.swept.some(o => o.id === idX8), false, 'and not as a swept one');
});
test('T19n: the objection of T19e after the re-tag, its raiser\'s layer asked to sign off: it is rated 3.0 and does not hold the sign-off (N23)', async () => {
  // the raiser lists it again at its own first tag (8): the value in force (3) is the one that counts
  const { result } = await retagRun(objects(withRelation(X8, `continues ${idX8}`)));
  assert.equal(result.panelVerdicts.find(v => v.round === 4 && v.lab === LOW).verdict, 'signed_off', 'pass 4: the objection does not hold layer 1');
});
