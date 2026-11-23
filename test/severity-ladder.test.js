// B3 prep, JUDGE lane: the LADDER AS BUILT (his word, 1 Nov 2026: "yes, undo it": the strict climb was taken out; the ladder works as built for B2/B3). The ladder's count takes the plan up a layer after the block of layer-1 passes whether or not a 4+ is open; the rating demand changes
// what a seat READS and how a pass SIGNS OFF, not where the ladder goes. These tests pin what stays: the floor jump fires with a 4+ open, the cycle with the demand held, a below-4 judge climbing in pass 1, the typed --next-pass-layer-3 and layer 3's re-tag (unit 4a) with the in-force dispute line.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runChain, RoundStopped, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { LADDER_BLOCK, LADDER_VISITS } from '../src/ladder.js';
import { objectionId } from '../src/objection-ids.js';
import { promptHashOf } from '../src/cache-integrity.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

// two seats per layer (the fixture of the --next-pass-layer-3 test below keeps its one seat per layer, which is valid): layer 1's first seat is the one that keeps objecting
const seatsOf = (first, id) => [
  { provider: 'mock', model: `mock-critic-script-${first}-${id}1`, lab: 'l1a', layer: 1 }, { provider: 'mock', model: `mock-critic-script-o-${id}1b`, lab: 'l1b', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-o-${id}2`, lab: 'l2a', layer: 2 }, { provider: 'mock', model: `mock-critic-script-o-${id}2b`, lab: 'l2b', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-o-${id}3`, lab: 'l3a', layer: 3 }, { provider: 'mock', model: `mock-critic-script-o-${id}3b`, lab: 'l3b', layer: 3 }];
const chainOf = (critics, over = {}) => ({
  name: 'strict', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 7, 2: 5 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
// CHANGED ACCEPTED (0.8.4 S19; replaces `project`, which wrote the chain to a temp project and ran the CLI in a child process). OLD: tests 1, 2 and 4 drove `council --ladder` and read report.json; the chain's `severity: { enabled: true }` decided whether a rating was read. NEW: runChain in THIS process with the ladder that `--ladder` types ({ block: 3, visits: 3, credit: 0, exchange: 0 }) and the rating demand injected (DEMAND) or forced out (NO_DEMAND); the report's `layers` are read off the result (or off the partial of a stopped run). WHY: the demand is a held word and setHeldForTest reaches only this process: a child never has it, and after the release re-record would always have it. The ladder's own CLI flags are covered by test/ladder.test.js, b3-controls.test.js and mcp-start-ladder.test.js.
const runLadder = async (config, demand) => {
  const lines = []; const seen = [];
  setHeldForTest(demand); setPromptSpy(p => seen.push(p));
  try {
    try { return { r: await runChain({ request: '# A plan\n', log: m => lines.push(m), runId: 'r-strict-ladder', config, ladder: { block: LADDER_BLOCK, visits: LADDER_VISITS, credit: 0, exchange: 0 } }), lines, seen }; }
    catch (e) { if (e instanceof RoundStopped && e.partial) return { r: e.partial, lines, seen }; throw e; }   // a stopped run still reports the layers it asked
  } finally { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); }
};
const DEMAND_SENTENCE = /carries a severity: a number from 1 to 10/;   // the sentence the blind-review prompt carries once the demand is in force (test/ratings-record.test.js, MARKERS)
const askedOf = report => { const by = {}; for (const r of report.layers) if (r.state !== 'not_asked') (by[r.round] ||= []).push(r.layer); return Object.keys(by).map(Number).sort((a, b) => a - b).map(n => by[n]); };

// CHANGED ACCEPTED (0.8.4 S19). OLD: the CLI in a child process on a chain with `severity: { enabled: true }`. NEW: runLadder with DEMAND; the chain names no switch; that the demand really reached the judges (and the 5 was read) is asserted from the prompts and the verdicts. WHY: no switch is left to set; a child process cannot be given the demand. RED ON OLD SRC: the old src has no ratingDemand, so no prompt carries the sentence and the first assertion fails.
test('the floor jump FIRES with a 4+ open: with the rating demand in force and a 5 kept at layer 1 the ladder takes the plan up after its block of three layer-1 passes, as built (pass 4 starts at layer 2)', async () => {
  // ADDED (the ladder unit, commit 2): `maxRounds: 4` is this row's own pass bound (a ladder run has no derived ceiling now); the run ends by the ladder sign-off at pass 4, before the bound is reached
  const { r, lines, seen } = await runLadder(chainOf(seatsOf('x-sev5', 'j'), { maxOverseerRounds: 1, maxRounds: 4 }), DEMAND);
  assert.equal(seen.some(p => DEMAND_SENTENCE.test(String(p.system ?? ''))), true, 'the demand reached the judges');
  assert.equal(r.panelVerdicts.some(v => v.verdict === 'unheard'), false, 'the 5 was read: nobody was refused for a missing rating');
  assert.deepEqual(askedOf(r).map(a => a[0]).slice(0, 4), [1, 1, 1, 2], lines.slice(-40).join('\n'));
  assert.equal(r.layers.some(l => l.state === 'not_asked' && l.layer === 1 && l.round === 4), true, 'layer 1 was not asked in pass 4');
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: "switch OFF" - the CLI on the same chain without the switch. NEW: runLadder with NO_DEMAND (forced out, so it keeps proving the HELD path after the release re-record): the parser drops the 5, the objection is unrated and an unrated one holds, so the cycle is the same. WHY: no switch to leave off; what is held is the demand. RED ON OLD SRC: none - green on old src too (the ladder's count reads no rating). KNOWN-BAD INPUT for its one red: run it with DEMAND in place of NO_DEMAND; the 'no prompt asks for a rating' assertion then fails.
test('demand held, same objections (the 5 is dropped, so the objection is unrated and holds like any other): the ladder climbs on the count, pass 4 starts at layer 2', async () => {
  const { r, lines, seen } = await runLadder(chainOf(seatsOf('x-sev5', 'm'), { maxOverseerRounds: 1, maxRounds: 4 }), NO_DEMAND);
  assert.equal(seen.some(p => DEMAND_SENTENCE.test(String(p.system ?? ''))), false, 'held: no prompt asks for a rating');
  assert.deepEqual(askedOf(r).map(a => a[0]).slice(0, 4), [1, 1, 1, 2], lines.slice(-40).join('\n'));   // the lowest layer asked per pass: layers 2 and 3 here sign off, so pass 4 goes on to layer 3 in the same pass
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: the config carried `severity: { enabled: true }`. NEW: the key is removed (chain-lint refuses it) and the rating demand is injected (DEMAND) for the run, then cleared in the finally. WHY: no switch; the demand is the held word. The fixture keeps ONE seat per layer, which is valid (FEATURE_SPECS Q4(d)). RED ON OLD SRC: the earlier assertions hold, then with no ledger `r.severityRun` is undefined and `r.severityRun.retags` throws.
test('--next-pass-layer-3 still starts a pass at layer 3 with a 5 open at layer 1 (the typed control overrides the floor), and layer 3\'s re-tag of that objection below 4 (unit 4a) is shown in the dispute record AND the severity record as the value in force: a ladder sign-off that is not agreement', async () => {
  const CRITERION = 'The plan defines a retry limit.'; const DRAFT = 'The worker retries failed requests.'; const EV = 'Section two sets the retry limit to five attempts.';
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failure carried no relation. NEW: relation 'new' (a first raise by la). WHY: relationRule is recorded (src/chain.js:5462).
  const F = { criterion: CRITERION, problem: 'No retry limit is specified.', fix: 'Specify one.', severity: 5, relation: 'new' }; const ID = objectionId('la', F);
  const signoff = extra => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: EV }], failures: [], verdict_line: 'ok', ...extra });
  const replies = label => (label === 'panel-1-la' ? JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [F], verdict_line: 'no' })
    : label === 'panel-2-lc' ? signoff({ retags: [{ id: ID, severity: 2, reason: 'It does not change what is built.' }] }) : undefined);
  const hashes = new Map(); const served = []; setPromptSpy(p => hashes.set(p.label, promptHashOf(p.system, p.user)));
  setCache({ invalidate: () => {}, get(label) { served.push(label); const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? (replies(label) ?? signoff()) : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT; return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0, promptHash: hashes.get(label) }; } });
  const seat = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const config = { name: 'fixture-strict-l3', criteria: [CRITERION], maxRounds: 4, maxOverseerRounds: 3, layerRevisions: { 1: 7, 2: 5 }, signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true },
    seats: { builder: seat(['writer']), reviser: seat(['writer']), critics: [['la', 1], ['lb', 2], ['lc', 3]].map(seat) } };
  try {
    setHeldForTest(DEMAND);
    const r = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-strict-l3', log: () => {}, config, ladder: { block: 3, visits: 3, credit: 0, exchange: 0 }, ladderSteps: [{ pass: 2, floor: 3, at: '2026-11-01T00:00:00.000Z', via: 'cli' }] });
    assert.equal(served.includes('panel-2-la') || served.includes('panel-2-lb'), false, 'pass 2 asked layer 3 only, with the 5 still open at layer 1');
    assert.equal(r.passed, false, 'a ladder sign-off is not agreement');
    assert.deepEqual(r.severityRun.retags.map(x => [x.id, x.from, x.to, x.applied_to, x.pass]), [[ID, 5, 2, 2, 2]]);
    assert.deepEqual(r.severityRun.swept.map(o => [o.lab, o.original, o.severity]), [['la', 5, 2]], 'the severity record shows the value in force and the original');
    assert.deepEqual((r.dispute?.open_objections || []).filter(o => o.id === ID).map(o => o.severity), [2], 'the dispute record shows the same number, read from the value in force (the older snapshot says 5)');
  } finally { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); }
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: the CLI, switch on; the title ended with a comparison to the run without the switch. NEW: runLadder with DEMAND; the closing comparison is dropped from the title, because with the demand held a 3 would be unrated and would hold (layer 1 would object and pass 1 would ask layer 1 only), and it was never asserted. WHY: no switch; the claim was about a state that does not exist any more. RED ON OLD SRC: the 3 is not read on old src (no demand), so the objection holds and pass 1 asks [1], not [1, 2, 3].
test('a rating below 4 does not hold the sign-off: with the rating demand in force and a layer-1 judge whose only objection is rated 3, layer 1 signs off and the plan climbs in the same pass (layers 2 and 3 are asked in pass 1)', async () => {
  const { r, lines } = await runLadder(chainOf(seatsOf('x-sev3', 'w'), { maxOverseerRounds: 1 }), DEMAND);
  assert.deepEqual(askedOf(r)[0], [1, 2, 3], lines.slice(-40).join('\n'));
});
