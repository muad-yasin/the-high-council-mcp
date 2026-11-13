// 0.8.4 S4b (M1), T15g and T15t (CA4, Q1(g), D19): an objection rated 3.0 that layer 1's exchange left not_debated (named in round 7) and that layer 1 otherwise signed off with, stands OPEN and FLAGGED through layer 3's sign-off: it is listed in the build
// check with its rating and the flag "not debated", the handler's answer has to name it, and the record never claims it was debated. Offline, mock seats, $0. WRITTEN WITHOUT A RUN (overnight, no box).
// PINS of behaviour that S3 and S4a built (the copy's rows written down): they hold on 6cd85763, so they cannot be red on the old tree; a source change that broke one would turn it red. The fixture is the T22z one (test/layer-rule-rows.test.js) with a handling session,
// so the run waits at the build check. `new7`/`alt` count asks per model string for the life of the process: every run here has its own model suffix.
// WHICH PATH THE ROWS PIN: e3 signs off clean, then names a defect in a round-7 post: it rides on the verdict as `openOwn` (chain.js layerExchange, the clean sign-off ruling), joins `allFailures` at the fold point and reaches the check through `askBuildCheck({ failures })`; the chain has no answer_back, so the ledger path is not involved.
// The probe run learns the ids the answer must name: an id is a hash of the seat key, the criterion and the QUOTE (src/objection-ids.js problemKey = the normalised quote); the default mock critic's objection has no quote, its criterion is picked from the chain's criteria and its text is fixed unless the model string carries `-selfname-` (ours do not), so the ids do not depend on the model suffix.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy, ExternalPause } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';
import { CHECK, answer } from './helpers/build-check.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const PLAN = '# Plan\n\nThe worker retries failed requests at most three times. Bake a cake. Sell it at the fair.';
const SESSION = { provider: 'external', model: 'claude-code-session', lab: 'handler' };
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const FIRST = 'It adds no scope the request did not ask for.';
const ROUND2 = JSON.stringify({ posts: [], new_objections: [{ criterion: FIRST, problem: 'The plan names a deliverable nobody asked for in round two.', quote: 'A passage that round two names.', severity: 3 }] });   // 0.8.4: the progress that earns round 3, the last the layer-1 exchange allows (the rated one used to be named in round 7)
const LATE = JSON.stringify({ posts: [], new_objections: [{ criterion: FIRST, problem: 'The plan names a second deliverable nobody asked for.', severity: 3 }] });
const chainOf = tag => ({
  name: 'not-debated-for-the-build', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: SESSION, reviser: SESSION,
    critics: [seat(`mock-exch-support-keep-sev3-${tag}`, 'e1', 1), seat(`mock-exch-alt-keep-${tag}-clean`, 'e2', 1), seat('mock-exch-support-keep-clean', 'e3', 1), seat('mock-exch-support-keep-clean', 'e9', 2), seat('mock-exch-support-keep-clean', 'e10', 3)] },
});
async function runIt(tag, extra = {}) {
  const served = [];
  setHeldForTest({ ...DEMAND, ...CHECK });
  const scripted = { build: PLAN, 'ldebate-1-x2-e3': ROUND2, 'ldebate-1-x3-e3': LATE, ...extra };
  setCache({ invalidate() {}, get: label => { served.push(label); return label in scripted ? { text: scripted[label], provider: 'mock', model: 'm', usage: { input: 30, output: 30 }, usd: 0 } : null; } });
  const out = { served };
  try { out.r = await runChain({ request: 'A mock task.', log() {}, runId: 'r-not-debated-for-the-build', config: chainOf(tag) }); } catch (e) { out.error = e; }
  return out;
}
const idsOf = text => [...text.matchAll(/^- (O-[0-9a-f]{8}(?:#r?\d+)?) \(/gm)].map(m => m[1]);

test('T15g: layer 3 signs off with the objection rated 3.0 (named in round 7, not debated) standing: the build check lists it open, with its rating and the flag "not debated", and the run waits for the handler', async () => {
  const { error } = await runIt('g1');
  assert.ok(error instanceof ExternalPause, String(error?.stack || error));
  assert.equal(error.label, 'build-check-1');
  const flagged = error.user.split('\n').filter(l => l.startsWith('- O-') && l.includes('; not debated;'));
  assert.equal(flagged.length, 1, 'exactly one open objection is flagged not debated: ' + error.user);
  assert.match(flagged[0], /raised in layer 1; rated 3\.0; not debated; not yet sorted by layer 3/);
  assert.ok(idsOf(error.user).length >= 1);
});

test('T15t: the same case, answered good_to_build: the run ends agreed, the check had to name the not-debated objection, and no record claims it was debated', async () => {
  const probe = await runIt('t1');
  assert.ok(probe.error instanceof ExternalPause, 'the probe waits at the check: ' + String(probe.error?.stack || probe.error));
  const ids = idsOf(probe.error.user);
  const { r, error, served } = await runIt('t2', { 'build-check-1': answer('good_to_build', ids.map(id => `${id}: The build can do it.`).join(' ')) });
  assert.equal(error, undefined, String(error?.stack || error));
  assert.deepEqual([r.passed, r.ending?.kind, r.ending?.handler_check], [true, 'agreed', 'good_to_build']);
  assert.equal(r.layerDebates.filter(x => x.pass === 1).length, 1, 'no second exchange runs in the pass (T15g\'s failing case)');
  const minted = r.layerDebates.flatMap(d => d.objections).find(o => o.from_exchange && o.added_round === 3);
  assert.ok(minted && ids.includes(minted.id), 'the premise: the minted objection is among the open ids the check listed');
  assert.ok(r.buildChecks[0].required.includes(minted.id), 'the handler\'s answer had to name it');
  assert.equal(r.layerDebates.flatMap(d => d.objections).filter(o => o.id === minted.id).every(o => o.outcome === 'not_debated'), true, 'no record claims it was debated');
  assert.equal(r.endingExchange, undefined, 'the ending exchange is not recorded: W26 is not injected here and the run was agreed');
  assert.equal(served.some(l => /^(ldebate|lreply)-end/.test(l)), false);
});
