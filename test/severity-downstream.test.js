// B3 prep, JUDGE lane, unit 3 (C&C ruling 1): an objection rated below the settle line is RECORDED, not litigated. With the chain's severity switch on, the dispute stage's calls (its reviser prompt and the dispute review) and the claims stage take only the objections that hold
// the plan; the dissent block and `dispute.open_objections` still list every open one. Switch off: every objection reaches them, as before.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); });
const seat = (model, lab) => ({ provider: 'mock', model, lab });
const cfgOf = (critics, extra = {}) => ({ name: 'downstream-test', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra });
const go = async cfg => { const seen = []; setPromptSpy(p => seen.push(p)); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-down', config: cfg }); return { r, seen }; };
const SWEPT = seat('mock-exch-support-keep-sev3-selfname-Swept', 'ea'); const HELD = seat('mock-exch-support-keep-sev9-selfname-Held', 'eb');
const DISPUTE = { dispute: { enabled: true } };
const withClaims = cfg => ({ ...cfg, seats: { ...cfg.seats, claims: { provider: 'mock', model: 'mock-claims-good' } } });

test('the dispute stage takes only the objections that hold the plan: its prompt names the 9, not the 3; the report still lists both as open', async () => {
  const cfg = cfgOf([SWEPT, HELD], { ...DISPUTE, severity: { enabled: true } });
  const { r, seen } = await go(cfg);
  const prompt = seen.find(p => p.label === 'dispute');
  assert.ok(prompt, 'the dispute stage ran (a 9 is open)');
  assert.match(prompt.user, /Held reports/); assert.doesNotMatch(prompt.user, /Swept reports/);
  assert.deepEqual((r.dispute.open_objections || []).map(o => o.lab).sort(), ['ea', 'eb'], 'recorded: both are still open objections of the run');
});

test('switch OFF: both objections reach the dispute prompt, as before', async () => {
  const { seen } = await go(cfgOf([SWEPT, HELD], DISPUTE));
  const prompt = seen.find(p => p.label === 'dispute');
  assert.match(prompt.user, /Held reports/); assert.match(prompt.user, /Swept reports/);
});

test('a not-agreed end with only swept objections open makes NO dispute call (nothing holds the plan; the unheard seat is why it is not agreed)', async () => {
  const cfg = cfgOf([SWEPT, seat('mock-provider-error', 'eb')], { ...DISPUTE, severity: { enabled: true } });
  const { r, seen } = await go(cfg);
  assert.equal(r.passed, false);
  assert.equal(seen.some(p => p.label === 'dispute'), false, 'no paid call for objections that block nothing');
  assert.ok(r.dispute && (r.dispute.open_objections || []).some(o => o.lab === 'ea'), 'the record is still written: the swept objection is listed as open in dispute.open_objections')
});

test('the claims stage takes only the objections that hold the plan: a PASSED run with swept objections extracts nothing (no call); switch off, a run with the same objections extracts them', async () => {
  const cfg = withClaims(cfgOf([SWEPT, seat('mock-exch-support-keep-sev3-selfname-Other', 'eb')], { claims: { enabled: true }, severity: { enabled: true } }));
  const { r, seen } = await go(cfg);
  assert.equal(r.passed, true);
  assert.equal(seen.some(p => p.label === 'claims'), false, 'no extraction call over swept objections');
  const held = withClaims(cfgOf([SWEPT, HELD], { claims: { enabled: true }, severity: { enabled: true } }));
  const h = await go(held);
  const call = h.seen.find(p => p.label === 'claims');
  assert.ok(call, 'a held objection is extracted'); assert.match(call.user, /Held reports/); assert.doesNotMatch(call.user, /Swept reports/);
  const off = await go(withClaims(cfgOf([SWEPT, HELD], { claims: { enabled: true } })));
  const offCall = off.seen.find(p => p.label === 'claims');
  assert.match(offCall.user, /Swept reports/); assert.match(offCall.user, /Held reports/);
});

test('unlayered, severity on: a swept-only judge beside an unheard seat is asked again on the unchanged draft and never revised (the existing "every heard judge clean, one unheard" rule applies, since a swept-only judge is clean); switch off, the same objection is revised', async () => {
  // This test pins behaviour the existing branch already gives under the switch: it is GREEN on the tree without the unit-3 fix-ups too (stated in the report), and it discriminates through the switch-off half.
  const mk = extra => cfgOf([SWEPT, seat('mock-provider-error', 'eb')], { ...extra, maxRounds: 2 });
  const on = await go(mk({ severity: { enabled: true } }));
  assert.equal(on.seen.some(p => /^revise/.test(p.label)), false, 'no revise: nothing holds the plan');
  assert.ok(on.seen.some(p => /^panel-2-eb/.test(p.label)) && !on.seen.some(p => /^panel-2-ea/.test(p.label)), 'round 2 asked the unheard seat again on the unchanged draft (the judge that signed off is carried, not asked): the check above is not vacuous');
  const off = await go(mk({}));
  assert.equal(off.seen.some(p => /^revise/.test(p.label)), true, 'switch off: the 3 is an ordinary objection and is revised');
});
