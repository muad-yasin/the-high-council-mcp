// B3 prep, JUDGE lane, unit 3: the severity BANDS act on sign-off. With the rating demand in force (a layered unanimous chain, and the held word `ratingDemand` put in force by DEMAND in this file): an objection rated below 4 does not block a judge's sign-off (it is SWEPT: recorded, carried, never a paid call), an objection rated 4 or above blocks it
// until it is gone (withdrawn in the exchange or in the answer-back; the Council-accepted path is a later unit), and an objection with NO readable severity blocks (fail closed: a new objection named in an exchange post may carry none). The FIRST valid tag of an
// objection id stands for its life: a later verdict that re-lists the id with another tag is overridden, and the override is recorded with both tags and its direction. The record (`severity` in report.json) lists what is open at the end (or says
// the end was NOT computed), what was swept, every withdrawn objection with its ORIGINAL tag and how it ended, and the overrides. With the demand held (NO_DEMAND): every objection blocks as before (an unrated one holds) and a volunteered tag is dropped (unit 2). The climb rule is unit 5, the re-tag
// controls are unit 4, the Council-accepted settle path and the sweep are later units.
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { normaliseCritique, runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { objectionLedger } from '../src/objection-ledger.js';
import { reportJsonShape } from '../src/report-shape.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';
const Sev = await import('../src/severity.js');   // new exports are read off the namespace: a missing one fails the test by name

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
beforeEach(() => setHeldForTest(DEMAND));   // 0.8.4 S19: the rating demand is in force for every test below unless it forces NO_DEMAND itself (see the comment above ON)
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const C = 'It states the assumptions it was written under.';
const F = (extra = {}) => ({ criterion: C, problem: 'None stated.', fix: 'Add them.', quote: 'Steep.', ...extra });
const verdict = failures => ({ meets: false, criteria: [], failures, verdict_line: 'x' });

// CHANGED ACCEPTED (title and one assertion message only; 0.8.4 S19). OLD: the title said "with the switch" and "off, any objection blocks", and the one message began "switch off". NEW: the same cases worded for the parser option `{ severity }` (the chain sets it from the rating demand; with no option the volunteered tag is dropped). WHY: the chain switch is gone; every assertion is unchanged. RED ON OLD SRC: none needed - title and message only, green on old src too.
test('normaliseCritique with the `severity` option (set by the rating demand): all objections below 4 = the judge signs off (the objections stay on the verdict, to be swept); any rated 4 or above blocks; a mix blocks; without the option, any objection blocks and the tag is dropped', () => {
  const on = failures => normaliseCritique(verdict(failures), () => {}, { severity: true });
  const low = on([F({ severity: 3.9 }), F({ criterion: 'Other.', severity: 1 })]);
  assert.equal(low.meets, true); assert.equal(low.failures.length, 2); assert.equal(low.unreadable, undefined);
  assert.equal(on([F({ severity: 4 })]).meets, false);
  assert.equal(on([F({ severity: 9 })]).meets, false);
  assert.equal(on([F({ severity: 2 }), F({ criterion: 'Other.', severity: 6.9 })]).meets, false, 'a mix blocks: the held one decides');
  assert.equal(normaliseCritique(verdict([F({ severity: 2 })]), () => {}).meets, false, 'without the option: any objection blocks (and the tag is dropped)');
  assert.equal(normaliseCritique(verdict([F({ severity: 2 })]), () => {}, { severity: false }).meets, false);
});

test('ONE predicate decides whether a withdrawn objection counts as settled in every band (his reading, confirmed in his answers to the open picks; one place, so it can still flip)', () => {
  assert.equal(typeof Sev.withdrawalSettles, 'function');
  assert.deepEqual(['sweep', 'settle', 'fix'].map(b => Sev.withdrawalSettles(b)), [true, true, true]);
  for (const [value, want] of [[3.9, 'settled'], [5, 'settled'], [7, 'settled'], [9, 'settled']]) assert.equal(Sev.settleVerdict(value, 'withdrawn'), want, `${value}`);
  assert.equal(Sev.settleVerdict(9, 'unresolved'), 'open');
});

const seat = (model, lab, layer = 1) => ({ provider: 'mock', model, lab, ...(layer ? { layer } : {}) });   // 0.8.4 S19: layer 1 unless given another; `null` = no layer at all (an unlayered panel records no ratings)
const cfgOf = (critics, extra = {}) => ({ name: 'blocking-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });
// CHANGED ACCEPTED (0.8.4 S19; the shared fixture - each test it changes carries its own line below). OLD: ON switched ratings on for a panel that was mostly unlayered. NEW: ON is the plain chain; the `seat` helper puts every critic on layer 1 unless given another, so a chain is layered and unanimous and RECORDS ratings, and the file-level beforeEach puts the rating demand in force (DEMAND). WHY: there is no switch (chain-lint refuses the key); ratings are recorded on every layered unanimous chain and the demand to rate is the held word ratingDemand. A layered chain also runs the layer exchange between its two layer-1 judges when an objection stands, which the old unlayered fixtures never did (no label, prompt or count assertion of this file reads the exchange's calls).
const ON = {};
const go = async cfg => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-block', config: cfg }); return { r, seen }; };
const shapeOf = (r, cfg) => reportJsonShape({ runId: 'r-block', chain: 'blocking-test', task: 'task.md', result: r, config: cfg });
const rec = (r, cfg) => shapeOf(r, cfg).severity;
const verdictAt = (r, lab, round = 1) => r.panelVerdicts.find(v => v.round === round && v.lab === lab);

// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered pairs with the switch on. NEW: the same judges as layer-1 pairs of a layered chain under DEMAND; each pair now also runs the layer exchange (support posts only, so no verdict moves). WHY: ratings are recorded on layered unanimous chains only. RED ON OLD SRC: without the demand the tags are dropped, so the first assertion fails (the pair of 3s objects, `a.r.passed` is false).
test('through a real run: two objections rated 3 do not block (the pass signs off, no revision, both swept, a swept_only marker on each sign-off); a 9 blocks; a 3 beside a 9 signs off while the 9 blocks', async () => {
  const swept = cfgOf([seat('mock-exch-support-keep-sev3', 'ea'), seat('mock-exch-support-keep-sev3', 'eb')], ON);
  const a = await go(swept);
  assert.equal(a.r.passed, true, 'nothing holds the sign-off');
  assert.equal(a.seen.some(p => /^revise-/.test(p.label)), false, 'no revision runs for objections that do not block');
  assert.deepEqual([verdictAt(a.r, 'ea').verdict, verdictAt(a.r, 'eb').verdict], ['signed_off', 'signed_off']);
  assert.deepEqual([verdictAt(a.r, 'ea').swept_only, verdictAt(a.r, 'eb').swept_only], [true, true], 'a swept-only sign-off is told apart from a clean one');
  const ra = rec(a.r, swept);
  assert.deepEqual(ra.open_at_end, []); assert.equal(ra.swept.length, 2); assert.deepEqual(ra.swept.map(o => o.severity), [3, 3]); assert.ok(ra.swept.every(o => o.band === 'sweep'));
  const high = await go(cfgOf([seat('mock-exch-support-keep-sev9', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], ON));
  assert.equal(high.r.passed, false); assert.deepEqual([verdictAt(high.r, 'ea').verdict, verdictAt(high.r, 'eb').verdict], ['objected', 'objected']);
  assert.equal('swept_only' in verdictAt(high.r, 'ea'), false);
  const mixCfg = cfgOf([seat('mock-exch-support-keep-sev3', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], ON);
  const mix = await go(mixCfg);
  assert.equal(mix.r.passed, false); assert.deepEqual([verdictAt(mix.r, 'ea').verdict, verdictAt(mix.r, 'eb').verdict], ['signed_off', 'objected']);
  const rm = rec(mix.r, mixCfg);
  assert.deepEqual(rm.open_at_end.map(o => [o.lab, o.severity, o.band]), [['eb', 9, 'fix']]); assert.deepEqual(rm.swept.map(o => [o.lab, o.severity]), [['ea', 3]]);
  assert.equal(rm.computed, true, 'the end of the last pass was reached');
});

// CHANGED ACCEPTED (0.8.4 S19; its meaning is kept for now, NEW-F4-1 is a later commit). OLD: "switch OFF" - an unlayered chain without the switch, whose last line asserted the report has no `severity` section. NEW: the same two judges on a LAYERED unanimous chain with the demand forced out (NO_DEMAND): every objection still blocks, the volunteered 3 is dropped, there is no swept_only marker and no prompt asks for a rating; the report now HAS a `severity` section (a layered unanimous chain records ratings whatever the demand), in which both objections are open with severity null and band 'unreadable' and nothing is swept. WHY: no switch is left to turn off; what is held is the demand, and the section is no longer the sign of it (the no-section case is a flat chain, test/ratings-record.test.js). RED ON OLD SRC: on 864d801c a layered chain without the switch has no severity ledger, so rec() is undefined and `assert.ok(s)` fails.
test('demand held: the same judges block as before (a 3 is an unrated objection, and an unrated one holds), a volunteered tag is dropped, no swept_only marker, no prompt asks for a rating, and the severity section of the report lists both objections as open and unrated', async () => {
  setHeldForTest(NO_DEMAND);
  const off = cfgOf([seat('mock-exch-support-keep-sev3', 'ea'), seat('mock-exch-support-keep-sev3', 'eb')]);
  const g = await go(off);
  assert.equal(g.r.passed, false); assert.deepEqual([verdictAt(g.r, 'ea').verdict, verdictAt(g.r, 'eb').verdict], ['objected', 'objected']);
  assert.equal('swept_only' in verdictAt(g.r, 'ea'), false);
  assert.equal(g.seen.some(p => /carries a severity: a number from 1 to 10/.test(String(p.system ?? ''))), false, 'held: no prompt asks the judges for a rating (so the check below is not vacuous)');
  assert.deepEqual(g.r.signoff.flatMap(s => s.objections || []).filter(o => 'severity' in o), [], 'the volunteered tag (3) is dropped from the record');
  const s = rec(g.r, off);
  assert.ok(s, 'a layered unanimous chain keeps the severity section even while the demand is held');
  assert.deepEqual(s.swept, [], 'nothing is rated, so nothing is swept');
  assert.deepEqual(s.open_at_end.map(o => [o.lab, o.severity, o.band]).sort(), [['ea', null, 'unreadable'], ['eb', null, 'unreadable']]);
});

// CHANGED ACCEPTED (0.8.4 S19, environment only: the test's own lines are unchanged). OLD: ON switched the ratings on. NEW: the rating demand comes from the file's beforeEach; the chain was already layered (1, 1, 2) and ran the exchange. WHY: no switch. RED ON OLD SRC: the verdict assertions hold, then `rec(r, cfg)` is undefined and `s.withdrawn` throws.
test('settles: two judges rated 5 whose objections the layer exchange has them withdraw sign off, and the record keeps each ORIGINAL tag with how it ended', async () => {
  // CHANGED ACCEPTED (0.8.4 S3, Q1(b), T1a). OLD: `support-withdraw` x2 (each supports the other's objection). NEW: `contest-withdraw` x2 (each contests it). WHY: a layer-1 raiser is asked to reply only after a counted contest or insufficient-evidence post; two judges that only support each other are never asked, so nothing is withdrawn. The record under test is unchanged.
  const cfg = cfgOf([seat('mock-exch-contest-withdraw-sev5', 'ea', 1), seat('mock-exch-contest-withdraw-sev5', 'eb', 1), seat('mock-critic-x', 'ec', 2)], ON);
  const { r } = await go(cfg);
  assert.deepEqual(r.panelVerdicts.filter(v => v.round === 1 && v.layer === 1).map(v => [v.lab, v.verdict, v.exchange_cleared]), [['ea', 'signed_off', true], ['eb', 'signed_off', true]]);
  const s = rec(r, cfg);
  assert.deepEqual(s.withdrawn.map(w => [w.lab, w.severity, w.how]).sort(), [['ea', 5, 'exchange'], ['eb', 5, 'exchange']]);
  assert.deepEqual(s.open_at_end.filter(o => o.lab !== 'ec'), []);
});

// CHANGED ACCEPTED (0.8.4 S19 (b), NEW-F4-1; GO item 3: this test changes only to the copy's sentence). OLD: a new objection named in an exchange post by mock-exch-new-keep-sev3 carried no readable severity, was KEPT untagged and held the sign-off, so its raiser did not sign off although its own objection was rated 3. NEW: with the rating demand in force the defect is PROPOSED (layer_debates[].proposed, reason no_valid_rating), mints no id and holds nothing: ea signs off on its own swept 3 and nothing of ea is open at the end. WHY: FEATURE_SPECS l.267 (Q1(c)): "A new defect in an ordinary exchange post needs a criterion, a passage the check of F7 finds and a valid rating; one that lacks any is recorded as proposed with its refusal reason, mints no id, leaves the rest of the post valid and is not retried"; row NEW-F4-1. (A model with a `-sev` suffix writes no rating on its post defect even under the demand: src/providers.js.) RED ON THE TREE BEFORE (b) (S19 (a)): the defect is kept untagged, so ea reads 'objected' and the first assertion fails.
test('a new objection named in an exchange post with no valid rating is PROPOSED, not kept: it mints no id and holds nothing, so the judge that named it signs off on its own swept 3', async () => {
  const cfg = cfgOf([seat('mock-exch-new-keep-sev3', 'ea', 1), seat('mock-exch-support-keep-sev3', 'eb', 1), seat('mock-critic-x', 'ec', 2)], ON);
  const { r } = await go(cfg);
  assert.equal(verdictAt(r, 'ea').verdict, 'signed_off', 'the unrated defect holds nothing');
  assert.equal(verdictAt(r, 'eb').verdict, 'signed_off');
  assert.ok(r.layerDebates[0].proposed.length >= 1 && r.layerDebates[0].proposed.every(p => p.by === 'ea' && p.why === 'no_valid_rating'), 'it is recorded as proposed, with its reason');
  assert.equal(rec(r, cfg).open_at_end.find(o => o.lab === 'ea'), undefined, 'nothing of ea is open at the end');
});
// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered pairs with the switch on. NEW: the same judges as layer-1 pairs under DEMAND; in each pass the pair also runs the layer exchange (support posts), which moves no verdict. WHY: ratings are recorded on layered unanimous chains only. RED ON OLD SRC: the verdicts match, then `rec(d.r, down)` is undefined and `sd.overrides` throws.
test('the FIRST tag stands: a judge that re-lists its 9 as a 3 in the next pass is overridden to 9 and still blocks (a downgrade, recorded); one that re-lists its 3 as a 9 is overridden to 3 and still signs off (an upgrade, recorded); the report counts both by direction', async () => {
  const down = cfgOf([seat('mock-exch-support-keep-sev9then3-always', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { ...ON, maxRounds: 2 });
  const d = await go(down);
  assert.equal(verdictAt(d.r, 'ea', 2).verdict, 'objected', 'pass 2: the judge rated it 3 itself; the first tag (9) still blocks');
  assert.equal(verdictAt(d.r, 'eb', 2).verdict, 'signed_off');
  const sd = rec(d.r, down);
  assert.deepEqual(sd.overrides.by_direction, { downgrade: 1, upgrade: 0 });
  assert.deepEqual(sd.overrides.rows.map(o => [o.lab, o.first, o.claimed, o.direction, o.pass]), [['ea', 9, 3, 'downgrade', 2]]);
  assert.deepEqual(sd.open_at_end.map(o => [o.lab, o.severity]), [['ea', 9]]);
  const up = cfgOf([seat('mock-exch-support-keep-sev3then9-always', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { ...ON, maxRounds: 2 });
  const u = await go(up);
  assert.equal(verdictAt(u.r, 'eb', 1).verdict, 'objected', 'pass 1: eb holds, ea is swept');
  assert.equal(verdictAt(u.r, 'ea', 2).verdict, 'signed_off', 'pass 2: it claims 9, the first tag (3) stands, so it does not block');
  assert.equal(u.r.passed, true);
  const su = rec(u.r, up);
  assert.deepEqual(su.overrides.by_direction, { downgrade: 0, upgrade: 1 });
  assert.deepEqual(su.overrides.rows.map(o => [o.first, o.claimed, o.direction]), [[3, 9, 'upgrade']]);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered pair with the switch on. NEW: the same judges as a layer-1 pair under DEMAND; the strict refusal of a missing rating and its one re-ask now come from the demand, and the pair runs the layer exchange in each pass. WHY: no switch. RED ON OLD SRC: without the demand there is no strict refusal and no re-ask, so the first assertion fails (`verdictAt(r, 'ea', 1).reasked` is not true).
test('the first VALID tag stands: a verdict with no tag is re-asked once and the re-asked tag (6) is the one that stands for the objection; a later claim of 2 is an override (a downgrade) and the judge still blocks', async () => {
  const cfg = cfgOf([seat('mock-exch-support-keep-sevnonethen6then2-always', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { ...ON, maxRounds: 2 });
  const { r } = await go(cfg);
  assert.equal(verdictAt(r, 'ea', 1).reasked, true, 'pass 1: the untagged verdict was re-asked once');
  assert.equal(verdictAt(r, 'ea', 2).verdict, 'objected', 'pass 2: it claims 2, but the first valid tag (6) stands and blocks');
  const s = rec(r, cfg);
  assert.deepEqual(s.overrides.rows.map(o => [o.lab, o.first, o.claimed, o.direction]), [['ea', 6, 2, 'downgrade']]);
  assert.deepEqual(s.open_at_end.filter(o => o.lab === 'ea').map(o => o.severity), [6]);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered pairs with the switch on. NEW: layer-1 pairs under DEMAND. The all-error pair still stops with noHeardReviewer (the record now names its layer). In the partial pair only ONE judge is heard, so its objections cannot be debated and pass 1 takes the Q4(d) lone-heard path (the unheard judge is asked again on the unchanged draft in a later pass); maxRounds is 1, so the run ends at the round cap before that re-ask and the record is the same as before. WHY: ratings are recorded on layered unanimous chains only. RED ON OLD SRC: `r.noHeardReviewer` holds, then `rec(r, cfg)` is undefined and `s.computed` throws.
test('a pass in which no reviewer was heard computed nothing: the record says "not computed" (with no earlier pass: open_at_end null), never an empty list that reads as clean; a heard pass before it is carried with its pass number', async () => {
  const cfg = cfgOf([seat('mock-provider-error', 'ea'), seat('mock-provider-error', 'eb')], ON);
  // CHANGED ACCEPTED (0.8.4 S16, D): OLD nobody was heard and the run ended; NEW with the final read always on and no handling session a run in which no top-layer seat read STOPS, so the final read of this fixture is answered (a sign-off) and the assertions are about the panel as before
  setCache({ invalidate() {}, get: l => (l.startsWith('final-read-') ? { text: JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'ok' }), provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 } : null) });
  const { r } = await go(cfg);
  setCache(null);
  assert.ok(r.noHeardReviewer, 'the run stopped because nobody was heard');
  const s = rec(r, cfg);
  assert.equal(s.computed, false); assert.equal(s.open_at_end, null); assert.match(s.not_computed, /stopped|reached|computed/i);
  const partial = cfgOf([seat('mock-exch-support-keep-sev9', 'ea'), seat('mock-provider-error', 'eb')], ON);
  const g = await go(partial);
  const sp = rec(g.r, partial);
  assert.equal(sp.computed, true, 'a pass in which some seat was heard is computed');
  assert.deepEqual(sp.unheard_at_end, ['eb'], 'the seat that gave no usable reply is named');
  assert.deepEqual(sp.open_at_end.map(o => [o.lab, o.severity]), [['ea', 9]]);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered pair with the switch on; pass 2 followed a revision. NEW: the same judges as a layer-1 pair under DEMAND: pass 1 has ONE heard judge (eb) and one unheard (ea, refused for its table), so it takes the Q4(d) lone-heard path - nothing is revised and ea is asked again in pass 2 on the UNCHANGED draft - and pass 2 is that re-ask pass, with eb's verdict carried and the exchange run between the pair. The assertions (unheard in pass 1, objected in pass 2 on its first counted tag 8, no override, 8 open) do not read the draft. WHY: ratings are recorded on layered unanimous chains only. RED ON OLD SRC: without the demand ea's rated sign-off is an ordinary objection, so the first assertion fails (pass 1 reads 'objected', not 'unheard').
test('a thrown-away attempt pins nothing: a swept sign-off rated 3 that is refused for an incomplete table never counted, so the tag of the next pass (8) is the first valid one, and no override is recorded', async () => {
  const cfg = cfgOf([seat('mock-exch-support-keep-sev3then8-short-always', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { ...ON, maxRounds: 2, signoff_table: { required: true } });
  const { r } = await go(cfg);
  assert.equal(verdictAt(r, 'ea', 1).verdict, 'unheard', 'pass 1: the swept sign-off came with an incomplete table, so it counted for nothing');
  assert.equal(verdictAt(r, 'ea', 2).verdict, 'objected', 'pass 2: its own first counted tag, 8, holds the sign-off');
  const s = rec(r, cfg);
  assert.deepEqual(s.overrides.rows, [], 'no override: nothing was committed before');
  assert.deepEqual(s.open_at_end.filter(o => o.lab === 'ea').map(o => o.severity), [8]);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered pair with answer_back: the older answer-back path. NEW: the same judges as a layer-1 pair with answer_back under DEMAND, so the chain is 'retained' (a judge's open objections persist until it is next asked, and a swept objection it leaves unanswered is recorded swept_carried on that path); the pair also runs the layer exchange. WHY: ratings are recorded on layered unanimous chains only; the assertions are unchanged. RED ON OLD SRC: without the demand ea's 3 is an ordinary objection and its unanswered objection is carried as 'unanswered', so the swept_carried assertion fails.
test('a swept-only judge that leaves its earlier swept objection unanswered costs NO re-ask; the carried objection gets a recorded disposition (swept_carried, with its pass); the run passes', async () => {
  const cfg = cfgOf([seat('mock-exch-support-keep-sev3-noanswers', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], { ...ON, maxRounds: 2, answer_back: { enabled: true } });
  const { r, seen } = await go(cfg);
  assert.ok(seen.some(p => /^panel-2-ea/.test(p.label)), 'pass 2 asked ea (the check below is not vacuous)');
  assert.equal(seen.filter(p => p.model.includes('-noanswers') && /reask/.test(p.label)).length, 0, 'no paid call for something that blocks nothing');
  const disp = (r.answerBackReplies || []).filter(x => x.lab === 'ea' && x.round === 2);
  assert.ok(disp.some(x => x.effect === 'swept_carried' && x.path === 'answer_back'), JSON.stringify(disp));
  assert.equal(verdictAt(r, 'ea', 2).verdict, 'signed_off');
});

// CHANGED ACCEPTED (title only; 0.8.4, `layer_debate` removed). OLD: '... answer_back, layer_debate on; two passes'. NEW: '... answer_back, the layer exchange; two passes'. WHY: the exchange has no switch; the fixture and the assertions are unchanged.
// CHANGED ACCEPTED (0.8.4 S19, environment only: the chain was already layered). OLD: ON switched the ratings on. NEW: the rating demand comes from the file's beforeEach. WHY: no switch. RED ON OLD SRC: without the demand eb's 3 is dropped and eb objects, so `verdictAt(r, 'eb', 1).verdict` is not 'signed_off'.
test('a B3-shaped run (layered, signoff_table, answer_back, the layer exchange; two passes): one judge holds in pass 1, a swept judge answers its swept objection in pass 2, and the run passes with the record complete', async () => {
  const cfg = cfgOf([seat('mock-exch-support-keep-sev9', 'ea', 1), seat('mock-exch-support-keep-sev3', 'eb', 1), seat('mock-exch-support-keep-sev3', 'ec', 2), seat('mock-exch-support-keep-sev3', 'ed', 2)],
    { ...ON, maxRounds: 2, answer_back: { enabled: true }, signoff_table: { required: true } });
  const { r } = await go(cfg);
  assert.equal(verdictAt(r, 'eb', 1).verdict, 'signed_off'); assert.equal(verdictAt(r, 'eb', 1).swept_only, true);
  assert.equal(verdictAt(r, 'ea', 1).verdict, 'objected');
  assert.equal(r.passed, true, 'pass 2: the revised draft is signed by every layer');
  const s = rec(r, cfg);
  assert.deepEqual(s.open_at_end, [], 'a passed run has nothing open at the end');
  assert.deepEqual(s.withdrawn.filter(w => w.lab === 'eb').map(w => [w.severity, w.how]), [[3, 'answer_back']], 'the swept judge withdrew its objection in pass 2 against the revised draft, with its original tag');
});

test('the end record tells "no open objections" from "not computed": a run that stopped before the end of its last pass says so and never reads as clean', () => {
  assert.equal(typeof Sev.severityRecord, 'function');
  const cfg = cfgOf([seat('m1', 'ea'), seat('m2', 'eb')], ON);
  const clean = Sev.severityRecord(cfg, { severityRun: { computed: true, pass: 2, open: [], swept: [], withdrawn: [], overrides: [] } });
  assert.deepEqual([clean.computed, clean.open_at_end], [true, []]);
  const none = Sev.severityRecord(cfg, {});
  assert.equal(none.computed, false); assert.equal(none.open_at_end, null); assert.match(none.not_computed, /not|stopped|reached/i);
  const mid = Sev.severityRecord(cfg, { severityRun: { computed: false, pass: 2, open: [{ id: 'O-aaaaaaaa', lab: 'ea', severity: 8, state: 'unresolved' }], swept: [], withdrawn: [], overrides: [] } });
  assert.equal(mid.computed, false); assert.equal(mid.as_of_pass, 2); assert.equal(mid.open_at_end.length, 1, 'the last computed pass is carried, with its pass number');
  // CHANGED ACCEPTED (0.8.4 S19). OLD: a chain built like the one above but without ON read back undefined (the message said "switch off"). NEW: a chain records ratings when it is layered AND unanimous, so the no-section cases are an UNLAYERED panel (seat(..., null)) and a non-unanimous one (signoff 'first'); the default-layered chain without ON would now return a section. WHY: the switch is removed. RED ON OLD SRC: with ON = {} the old src returns undefined for `cfg` too, so the first read of `clean.computed` throws.
  const unlayered = cfgOf([seat('m1', 'ea', null), seat('m2', 'eb', null)]);
  assert.equal(Sev.severityRecord(unlayered, {}), undefined, 'an unlayered panel records no ratings: no section');
  assert.equal(Sev.severityRecord({ ...cfg, signoff: 'first' }, {}), undefined, 'a chain that is not unanimous records none either');
});

test('the ledger carries the FIRST readable tag of an objection (the same value in every copy once the first tag stands); an unreadable copy never replaces it; untagged stays untagged', () => {
  const id = 'O-aaaaaaaa';
  const base = { reviserByRound: { 1: { declined: [], draftChanged: true } }, draftShaByRound: { 1: 'aaaaaaaaaaaa', 2: 'bbbbbbbbbbbb' }, heardByRound: { 1: ['e1'], 2: ['e1'] }, notAskedByRound: {}, layerOf: { e1: 1 }, currentRound: 3, replies: [] };
  const row = (failures, extra = []) => objectionLedger({ ...base, openByRound: [{ round: 1, failures: failures.map(f => ({ lab: 'e1', id, criterion: 'C', problem: 'p', ...f })) }, ...extra] }).find(r => r.id === id);
  assert.equal(row([{ severity: 5 }], [{ round: 2, failures: [{ lab: 'e1', id, criterion: 'C', problem: 'p', severity: 8 }] }]).severity, 5, 'the first tag stands across rounds');
  assert.equal(row([{ severity: 'high' }, { severity: 4, problem: 'again' }]).severity, 4);
  assert.equal(row([{ severity: 6 }], [{ round: 2, failures: [{ lab: 'e1', id, criterion: 'C', problem: 'p' }] }]).severity, 6, 'a later copy without a tag does not erase the tag');
  assert.equal('severity' in row([{}]), false);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: an unlayered pair with the switch on. NEW: the same judges as a layer-1 pair under DEMAND; the report of a layered chain also carries layers and layer_debates, which the schema validates as in test/layer-debate.test.js. WHY: ratings are recorded on layered unanimous chains only. RED ON OLD SRC: no severity section, so `Object.keys(shape.severity)` throws.
test('report schema: the `severity` section and the swept_only marker are declared (experimental / optional); a report carrying them validates', async () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  assert.ok(schema.properties.severity, 'declared'); assert.equal(schema.required.includes('severity'), false);
  assert.ok(schema.properties.panelVerdicts.items.properties.swept_only, 'panelVerdicts.swept_only declared');
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true }); ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  const validate = ajv.compile(schema);
  const cfg = cfgOf([seat('mock-exch-support-keep-sev3', 'ea'), seat('mock-exch-support-keep-sev9', 'eb')], ON);
  const { r } = await go(cfg);
  const shape = shapeOf(r, cfg);
  assert.deepEqual(Object.keys(shape.severity).sort(), ['as_of_pass', 'asked', 'computed', 'lines', 'open_at_end', 'overrides', 'retags', 'swept', 'withdrawn'].filter(k => k in shape.severity).sort());   // CHANGED ACCEPTED (S19 follow-up F): `asked` joins the list (OLD: without it); the loop below asserts it is present, which is red before F
  for (const k of ['lines', 'open_at_end', 'swept', 'withdrawn', 'overrides', 'retags', 'computed', 'asked']) assert.ok(k in shape.severity, k);
  assert.equal(validate(shape), true, JSON.stringify(validate.errors?.slice(0, 3)));
});
