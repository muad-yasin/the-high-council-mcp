// B3 prep, JUDGE lane, unit 3 (C&C ruling 1): an objection rated below the settle line is RECORDED, not litigated. With the rating demand in force (M1/S19, no switch any more: a layered unanimous chain records ratings, the held word ratingDemand, injected below, demands them), the dispute stage's calls (its reviser prompt and the dispute review) and the claims stage take only the objections that hold
// the plan; the dissent block and `dispute.open_objections` still list every open one. Demand held: a volunteered rating is dropped, every objection reads as unrated and holds the plan, so every objection reaches them, as before. Every fixture is LAYERED (all judges on layer 1): a flat panel records nothing since M1, and the layer-1 exchange runs between the heard judges.
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

beforeEach(() => setHeldForTest(DEMAND));   // M1 (S19): the rating demand is in force unless a test proves the held path (NO_DEMAND)
afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const seat = (model, lab) => ({ provider: 'mock', model, lab, layer: 1 });   // M1 (S19): every judge is on layer 1, so the chain records ratings (a flat panel records nothing) and the layer-1 exchange runs between the heard judges
const cfgOf = (critics, extra = {}) => ({ name: 'downstream-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });
const go = async cfg => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-down', config: cfg }); return { r, seen }; };
const SWEPT = seat('mock-exch-support-keep-sev3-selfname-Swept', 'ea'); const HELD = seat('mock-exch-support-keep-sev9-selfname-Held', 'eb');
const DISPUTE = { dispute: { enabled: true } };
const withClaims = cfg => ({ ...cfg, seats: { ...cfg.seats, claims: { provider: 'mock', model: 'mock-claims-good' } } });

// CHANGED ACCEPTED (0.8.4 S19, ratings without a switch). OLD: an UNLAYERED unanimous panel with severity: { enabled: true }. NEW: the same two judges on layer 1 of a layered unanimous chain, no key, the rating demand injected (DEMAND, the file-level beforeEach); the layer-1 exchange now runs between them (both only support, so both objections stand and no assertion moves). WHY: the switch is removed; ratings are recorded on layered unanimous chains and demanded by the held word ratingDemand. RED ON OLD SRC: the old src reads no ratingDemand and the config carries no switch, so the parser drops the 3, it holds the plan and doesNotMatch(/Swept reports/) fails.
test('the dispute stage takes only the objections that hold the plan: its prompt names the 9, not the 3; the report still lists both as open', async () => {
  const cfg = cfgOf([SWEPT, HELD], DISPUTE);
  const { r, seen } = await go(cfg);
  const prompt = seen.find(p => p.label === 'dispute');
  assert.ok(prompt, 'the dispute stage ran (a 9 is open)');
  assert.match(prompt.user, /Held reports/); assert.doesNotMatch(prompt.user, /Swept reports/);
  assert.deepEqual((r.dispute.open_objections || []).map(o => o.lab).sort(), ['ea', 'eb'], 'recorded: both are still open objections of the run');
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: "switch OFF" = no severity key on an unlayered chain. NEW: the layered chain with the demand forced out (NO_DEMAND): the ratings the mocks write (-sev3, -sev9) are dropped by the parser, both objections are unrated (an unrated objection holds the plan) and reach the dispute prompt. WHY: the held path is what "off" means now; NO_DEMAND keeps it proven after the release re-record. GREEN ON OLD SRC BY DESIGN (it pins the held path, which equals the old switch-off).
test('rating demand HELD: the volunteered 3 and 9 are dropped, both objections read as unrated and reach the dispute prompt, as before', async () => {
  setHeldForTest(NO_DEMAND);
  const { seen } = await go(cfgOf([SWEPT, HELD], DISPUTE));
  const prompt = seen.find(p => p.label === 'dispute');
  assert.match(prompt.user, /Held reports/); assert.match(prompt.user, /Swept reports/);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered panel, severity: { enabled: true }. NEW: both judges on layer 1, no key, the demand injected. On a layered chain this is the LONE-HEARD route (one heard judge with an objection, one unheard seat: the exchange does not run, its layer_debates row reads not_run fewer_than_two_heard, nothing is revised); maxRounds 1 ends the run at the cap, so the assertions (not agreed, no dispute call, the swept objection listed in dispute.open_objections) are unchanged. WHY: the switch is removed. RED ON OLD SRC: the 3 is dropped by the parser, holds the plan, and the dispute call is made.
test('a not-agreed end with only swept objections open makes NO dispute call (nothing holds the plan; the unheard seat is why it is not agreed)', async () => {
  const cfg = cfgOf([SWEPT, seat('mock-provider-error', 'eb')], DISPUTE);
  const { r, seen } = await go(cfg);
  assert.equal(r.passed, false);
  assert.equal(seen.some(p => p.label === 'dispute'), false, 'no paid call for objections that block nothing');
  assert.ok(r.dispute && (r.dispute.open_objections || []).some(o => o.lab === 'ea'), 'the record is still written: the swept objection is listed as open in dispute.open_objections')
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: unlayered panels, severity: { enabled: true } for the two ON legs, no key for the OFF leg. NEW: layered panels (layer 1), no key; the two ON legs run with the demand injected (file-level beforeEach), the OFF leg forces NO_DEMAND first. WHY: the switch is removed. RED ON OLD SRC: the 3s are dropped as ratings and hold the plan, so the first leg does not pass (assert.equal(r.passed, true) fails) and the claims call is made.
test('the claims stage takes only the objections that hold the plan: a PASSED run with swept objections extracts nothing (no call); with the demand held, a run with the same objections extracts them', async () => {
  const cfg = withClaims(cfgOf([SWEPT, seat('mock-exch-support-keep-sev3-selfname-Other', 'eb')], { claims: { enabled: true } }));
  const { r, seen } = await go(cfg);
  assert.equal(r.passed, true);
  assert.equal(seen.some(p => p.label === 'claims'), false, 'no extraction call over swept objections');
  const held = withClaims(cfgOf([SWEPT, HELD], { claims: { enabled: true } }));
  const h = await go(held);
  const call = h.seen.find(p => p.label === 'claims');
  assert.ok(call, 'a held objection is extracted'); assert.match(call.user, /Held reports/); assert.doesNotMatch(call.user, /Swept reports/);
  setHeldForTest(NO_DEMAND);   // the held path: the volunteered ratings are dropped, so both objections read as unrated and are extracted
  const off = await go(withClaims(cfgOf([SWEPT, HELD], { claims: { enabled: true } })));
  const offCall = off.seen.find(p => p.label === 'claims');
  assert.match(offCall.user, /Swept reports/); assert.match(offCall.user, /Held reports/);
});

// CHANGED ACCEPTED (REPLACED, 0.8.4 S19; was "unlayered, severity on: ..."). OLD: an unlayered panel of the swept judge and an unheard seat, switch on vs off. NEW: a layered panel (all on layer 1) of the swept judge, the unheard seat and a THIRD judge that is heard and clean, demand injected vs forced out. WHY: a flat panel records nothing since M1; and the plain layered form (swept judge + unheard seat) takes the lone-heard route (re-ask the unheard seat, revise nothing) whatever the rating, so its held half would never revise and the test would stop discriminating. With two heard judges the "every heard judge clean, one unheard" rule is the one in play again, and an unrated objection holds, so the held half revises. RED ON OLD SRC: the 3 is dropped as a rating and holds the plan, so revise-1 is made in the ON half and "no revise" fails.
test('layered, ratings demanded: a swept-only judge and a clean judge beside an unheard seat are asked again on the unchanged draft and never revised (the existing "every heard judge clean, one unheard" rule applies, since a swept-only judge is clean); with the demand held, the same objection is unrated, holds the plan and is revised', async () => {
  // This test pins behaviour the existing branch already gives once swept objections count as clean; it discriminates through the demand-held half. The THIRD judge (ec, heard and clean) is needed: with only the swept judge heard, a layered chain's lone-heard rule (one heard judge with an objection, one unheard seat: ask the unheard seat again, revise nothing) applies whatever the rating, and the held half would not revise either.
  const mk = () => cfgOf([SWEPT, seat('mock-provider-error', 'eb'), seat('mock-exch-support-keep-clean', 'ec')], { maxRounds: 2 });
  const on = await go(mk());
  assert.equal(on.seen.some(p => /^revise/.test(p.label)), false, 'no revise: nothing holds the plan');
  assert.ok(on.seen.some(p => /^panel-2-eb/.test(p.label)) && !on.seen.some(p => /^panel-2-ea/.test(p.label)), 'round 2 asked the unheard seat again on the unchanged draft (the judge that signed off is carried, not asked): the check above is not vacuous');
  setHeldForTest(NO_DEMAND);   // the held path: the 3 is dropped, so the objection is unrated and holds the plan
  const off = await go(mk());
  assert.equal(off.seen.some(p => /^revise/.test(p.label)), true, 'demand held: the 3 is dropped, the objection is unrated and ordinary, and is revised');
});
