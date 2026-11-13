// B3 prep, JUDGE lane, unit S: ONE PIN PER RELEASE ROUTE on B3's shape (layered, answer_back, the layer exchange). An objection rated 4 or above holds the sign-off, and the SAME routes release it whether it is rated 4 to 6.9 or 7 to 10: the raiser's answered
// withdrawal (a quote found in the revised draft) and the raiser's withdrawal in its layer's exchange (a reason). Each pin runs a 5 and an 8: the objection is HELD first, then released; the record keeps the ORIGINAL tag and how it ended. The re-tag routes (layer 3, the
// handler) are pinned with units 5 and 4b. These pins describe behaviour that exists since unit 3: they are green on the tree before S by design (stated in unit S's red list). M1 (S19): there is no severity switch any more; every pin runs on a layered unanimous chain (ratings recorded) with the rating demand injected (DEMAND), which is what the switch meant. Some layers here hold one seat, which is valid (FEATURE_SPECS Q4(d): a layer of one seat follows Q3, no exchange, sign-off by F2).
import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND } from './helpers/rating-demand.js';

beforeEach(() => setHeldForTest(DEMAND));   // M1 (S19): both routes are pinned with the rating demand in force (the chains below are layered unanimous chains, so ratings are recorded)
afterEach(() => { setPromptSpy(null); setCache(null); setBudget(null); setHeldForTest(null); });
const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const EV = 'Section two sets the retry limit to five attempts.';
const objecting = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [f], verdict_line: 'no' });
const signoff = (extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok', ...extra });
const seat = ([lab, layer, model = 'mock-review-fixture']) => ({ provider: 'mock', model, lab, maxTokens: 3000, layer });

async function runScripted(replies) {
  const hashes = new Map(); setPromptSpy(p => hashes.set(p.label, promptHashOf(p.system, p.user)));
  setCache({ invalidate: () => {}, get(label) {
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) };
  } });
  const config = { name: 'fixture-routes', criteria: [CRITERION], maxRounds: 3, signoff: 'unanimous', answer_back: { enabled: true },
    seats: { builder: seat(['writer']), reviser: seat(['writer']), critics: [seat(['la', 1]), seat(['lb', 2])] } };
  return runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-routes', log: () => {}, config });
}

for (const sev of [5, 8]) {
  // CHANGED ACCEPTED (0.8.4 S19). OLD: the chain config carried severity: { enabled: true }. NEW: no key; the chain is the same layered unanimous chain (ratings recorded) and the rating demand is injected by the file-level beforeEach (DEMAND). WHY: the switch is removed; the demand (the rating sentences and the strict parse) is the held word ratingDemand. RED ON OLD SRC: the old src reads no ratingDemand and the config has no switch, so the tags are dropped and r.severityRun is undefined (TypeError on r.severityRun.open).
  test(`route 1, an ANSWERED WITHDRAWAL: an objection rated ${sev} holds the sign-off, the writer fixes the draft, the raiser withdraws it with a quote from the revised draft, and it no longer holds (the record keeps the original tag)`, async () => {
    const F = { criterion: CRITERION, problem: 'No retry limit is specified.', fix: 'Specify one.', severity: sev, relation: 'new' }; const ID = objectionId('la', F);
    const r = await runScripted(label => (label === 'panel-1-la' ? objecting(F) : label === 'panel-2-la' ? signoff({ answers: [{ id: ID, status: 'withdrawn', evidence: '`The worker retries failed requests.`' }] }) : undefined));
    assert.equal(r.panelVerdicts.find(v => v.round === 1 && v.lab === 'la').verdict, 'objected', 'held first');
    assert.equal(r.passed, true, 'released after the withdrawal');
    assert.deepEqual(r.severityRun.open, []);
    assert.deepEqual(r.severityRun.withdrawn.map(w => [w.lab, w.severity, w.how]), [['la', sev, 'answer_back']]);
  });

  // CHANGED ACCEPTED (0.8.4 S19). OLD: base carried severity: { enabled: true }. NEW: no key, the same layered chain, the demand injected (DEMAND). WHY: the switch is removed (the two CHANGED ACCEPTED notes inside this test stand). RED ON OLD SRC: no switch in the config, so the ratings are dropped and withExchange.severityRun is undefined (TypeError on severityRun.withdrawn).
  test(`route 2, a WITHDRAWAL IN THE LAYER EXCHANGE: two layer-1 judges rate an objection ${sev} and the raisers withdraw it on a reason and sign off; with ONE judge on the layer, where no exchange can run, the same objection stays`, async () => {
    // CHANGED ACCEPTED (0.8.4, `layer_debate.enabled` removed). OLD: the held half ran the same two judges on a chain WITHOUT the switch ('without it the same judges stay objecting'). NEW: the held half is the case where the exchange cannot run that still exists: ONE judge on layer 1 (a single heard judge has nobody to read its objection), so its objection stays and the verdict is objected. WHY: a layered unanimous chain with two judges now always runs the exchange, so there is no chain 'without it' for the same two judges. The exchange half is unchanged.
    // CHANGED ACCEPTED (0.8.4 S3, Q1(b), T1a). OLD: both layer-1 judges were `support-withdraw` (each SUPPORTS the other's objection and withdraws its own). NEW: `contest-withdraw` (each CONTESTS the other's objection and withdraws its own). WHY: a layer-1 raiser is asked to reply only after a counted contest or insufficient-evidence post; two judges that only support each other are never asked, so nothing is withdrawn. The route under test (a withdrawal in the layer exchange releases a rated objection) is unchanged.
    const critics = [['ea', 1, `mock-exch-contest-withdraw-sev${sev}`], ['eb', 1, `mock-exch-contest-withdraw-sev${sev}`], ['ec', 2, 'mock-critic-x']];
    const base = { name: 'fixture-routes-exch', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: critics.map(([lab, layer, model]) => ({ provider: 'mock', model, lab, layer })) } };
    const one = { ...base, seats: { ...base.seats, critics: base.seats.critics.filter(c => c.lab !== 'eb') } };
    const without = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-exch-off', config: one });
    assert.deepEqual(without.panelVerdicts.filter(v => v.round === 1 && v.layer === 1).map(v => v.verdict), ['objected'], 'held first: one judge, no exchange');
    const withExchange = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-exch-on', config: base });
    assert.deepEqual(withExchange.panelVerdicts.filter(v => v.round === 1 && v.layer === 1).map(v => [v.verdict, v.exchange_cleared]), [['signed_off', true], ['signed_off', true]], 'released by the exchange');
    assert.deepEqual(withExchange.severityRun.withdrawn.map(w => [w.lab, w.severity, w.how]).sort(), [['ea', sev, 'exchange'], ['eb', sev, 'exchange']]);
    assert.deepEqual(withExchange.severityRun.open.filter(o => o.lab !== 'ec'), []);
  });
}
