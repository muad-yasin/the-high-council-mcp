// 0.8.4 (the ladder unit, commit 6; C&C 10 Nov 2026, Muad's "b is OK"): a judge still silent after its in-pass re-asks gets ONE more call on its own inside the pass (label `-solo`), its layer waits for it, and a judge that is still silent ends the pass `unheard` and
// STOPS the run at the existing silent-judge stop at once (the solo ask replaces the two repeated full passes). TRACE (C&C asked for layers 2 and 3 before any code): layers 1, 2 and 3 all go through the ONE function over a set of seats in src/chain.js (the one that holds the in-pass re-ask loop,
// reading only the verdicts of its own call), so the solo ask sits in it and applies to every layer; the top layer's sign-off re-ask (-reask3, SIGNOFF_REASK_TAG) is a different call with its own label and is untouched. Offline, mock seats, $0.
// WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides. NAMED: a judge silent in a pass where another judge OBJECTED stays unheard that pass and is not asked again (the same condition as the re-asks); the solo sentence is held A-DRAFT (LAD-R37).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, ExternalPause } from '../src/chain.js';
import { baseLabelOf } from '../src/cost.js';
import { setHeldForTest } from '../src/held-roles.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';
import { estimateChainRows, SOLO_ASKS_PER_SEAT } from '../src/cost.js';
import { UNHEARD_PASSES_BEFORE_STOP, passCeiling, advance, newRoundState } from '../src/overseer-rounds.js';
import * as HC from './held-prompts/held-084-cache-order.js';
import * as HD from './held-prompts/held-084-d27.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

afterEach(() => { setHeldForTest(null); });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
async function silentTop(lab, layer) {
  const critics = [['la', 1], ['lb', 2], ['lc', 3]].map(c => (c[0] === lab ? [c[0], c[1], 'mock-critic-silent'] : c));
  // the fixture's layer-1 judge objects in pass 1 by default; here every judge that answers SIGNS OFF, so the silent judge is the only thing the pass waits for (heardClean holds) and it is asked in pass 1
  try { await scenario({ critics, silentLabs: [lab], overrides: { 'panel-1-la': MET }, extra: { maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 } } }); return { done: true }; }
  catch (e) { if (e instanceof RoundStopped) return { stop: e.stop, served: e.served, prompts: e.prompts }; throw e; }
}

for (const [lab, layer] of [['la', 1], ['lb', 2], ['lc', 3]]) {
  test(`SOLO-1 (a silent judge on layer ${layer}): the judge never answers; after its two re-asks it is asked ONCE more on its own (panel-1-${lab}-solo), the pass ends unheard and the run STOPS at the silent-judge stop at once: no second pass, no -reask3`, async () => {
    const r = await silentTop(lab, layer);
    assert.deepEqual([r.stop?.kind, r.stop?.why, r.stop?.layer], ['layer_bound', 'unheard', layer], `the premise: the run stops at the silent-judge stop: ${JSON.stringify(r.stop)}`);
    const served = r.served ?? []; const pass = r.stop?.pass;
    assert.ok(Number.isInteger(pass), `the stop names its pass: ${JSON.stringify(r.stop)}`);
    for (const l of [`panel-${pass}-${lab}-reask1`, `panel-${pass}-${lab}-reask2`, `panel-${pass}-${lab}-solo`]) assert.ok(served.includes(l), `${l} was asked: ${served.filter(x => x.includes(lab)).join(' ')}`);
    assert.ok(!served.includes(`panel-${pass}-${lab}-reask3`), 'the solo ask is not a third numbered re-ask');
    assert.equal(served.filter(l => l === `panel-${pass}-${lab}-solo`).length, 1, 'ONE solo ask');
    assert.ok(!served.some(l => new RegExp(`^panel-${pass + 1}-`).test(l)), 'no further pass: the solo ask replaced the repeated passes');
  });
}

// CHANGED ACCEPTED (0.8.4 ladder unit; the owner's "silent judge being asked twice" for the lone-heard case, 10 Nov 2026). OLD bar (as committed in the solo-ask unit): pass ceiling 2 x (2 + 1 + 1) x 1 = 8. NEW: 2 x (2 + 1 + 1) x 3 = 24: the lone-heard pass of layer 1 (one judge heard and objecting, its peer silent) keeps two re-ask passes, so the ceiling, a backstop, counts them again.
test('SOLO-2 (the pass count before the stop, pure): a silent seat costs no repeated pass before the stop (UNHEARD_PASSES_BEFORE_STOP 0); the lone-heard pass keeps two (the pass ceiling counts them); a --continue at the stop still adds passes (defaultAdd)', () => {
  assert.equal(UNHEARD_PASSES_BEFORE_STOP, 0);
  assert.equal(passCeiling({ maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 } }), 2 * (2 + 1 + 1) * 3);
  const cfg = { maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, reasks: UNHEARD_PASSES_BEFORE_STOP };
  const run = pass => { let st = newRoundState(); const out = []; for (let i = 0; i < 4; i++) { const r = advance(cfg, st, pass); out.push(r.action); st = r.state; if (r.action === 'stop') return [out, r.stop.passes, r.stop.reasks]; } return [out]; };
  assert.deepEqual(run({ outcome: 'unheard', layer: 1 }), [['stop'], 1, 0], 'an ordinary silent judge: its first unheard pass stops (it had its solo ask inside the pass)');
  assert.deepEqual(run({ outcome: 'unheard', layer: 1, lone: true }), [['ask_again', 'ask_again', 'stop'], 3, 2], 'the lone-heard pass: two re-ask passes, then the stop');
});

test('SOLO-3 (the preview row, at the re-ask price): the maximum figure carries one `-solo` row per judge per pass beside its `-reask` row, priced like it (same input tokens), counted SOLO_ASKS_PER_SEAT times per pass; the expected figure carries none', () => {
  const critics = [['la', 1], ['lb', 1], ['lc', 2]].map(([lab, layer]) => ({ provider: 'mock', model: 'mock-priced', lab, layer, maxTokens: 3000 }));
  const config = { name: 'solo-preview', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 }, seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics } };
  const max = estimateChainRows(config, { maximum: true }); const exp = estimateChainRows(config, { maximum: false });
  const reask = max.find(r => /^panel-L1-la-reask$/.test(r.label)); const solo = max.find(r => /^panel-L1-la-solo$/.test(r.label));
  assert.ok(reask && solo, 'both rows exist in the maximum');
  assert.equal(solo.times, SOLO_ASKS_PER_SEAT * (max.find(r => r.label === 'panel-L1-la').times ?? 1), 'one solo ask per pass');
  assert.equal(solo.input / (solo.times ?? 1), reask.input / (reask.times ?? 1), 'priced at the re-ask price: the same input per call');
  assert.ok(!exp.some(r => /-solo$/.test(r.label)), 'the expected figure has none');
});

test('SOLO-4 (SOURCE PINS): the solo ask sits in the one function over a set of seats, after the re-ask loop and under the same conditions (only while every heard judge is clean; not for a refused table or unanswered objections), and every label pattern that recognises a re-ask recognises -solo', () => {
  const src = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  assert.match(src, /reviewSeat\(seatToAsk, prior, log, '-solo'/);
  assert.match(src, /const soloable = v => v\.abstained && v\.reasonCode !== 'INCOMPLETE_TABLE' && !v\.unansweredFallback && !v\.severityGap;/);
  assert.match(src, /if \(verdicts\.slice\(start\)\.some\(soloable\) && heardClean\(\)\)/);
  assert.equal((src.match(/\/\^-\(\?:reask\\d\+\|solo\)\$\/\.test\(tag\)/g) ?? []).length, 4, 'the four re-ask tag tests also take -solo');
});

test('SOLO-5 (commit 6\'s obligation, LADDER_GO lines 49-51): the solo ask goes through the same layout as the seat\'s other judge calls: the prompt spy shows its system text and head byte-equal to the seat\'s panel call of the same pass (the re-ask note, if any, only follows the head)', async () => {
  const r = await silentTop('lb', 2);
  const pass = r.stop?.pass; assert.ok(Number.isInteger(pass), JSON.stringify(r.stop));
  const first = r.prompts?.get(`panel-${pass}-lb`); const solo = r.prompts?.get(`panel-${pass}-lb-solo`);
  assert.ok(first && solo, `both prompts were spied: ${[...(r.prompts?.keys() ?? [])].filter(k => k.includes('lb')).join(' ')}`);
  assert.equal(solo.system, first.system, 'the system text is the seat\'s panel call\'s');
  assert.equal(solo.cacheHead, first.cacheHead, 'the head is the same');
  const head = first.cacheHead ?? first.user.slice(0, 200);
  assert.ok(solo.user.startsWith(head) && first.user.startsWith(head), 'the user text starts with that head in both');
});

// 0.8.4 (cache part (b)2 merged into the ladder; owed by the second of the two to merge). The prompt order hands judgePrompt the ARGUMENTS the head is built from (`headArgs`) and refuses a call with the draft boundary on that does not (src/cache-order.js). The solo ask is not a site of its own: it is the same
// reviewSeat call as the seat's first ask and its re-asks (tag `-solo`), so the one panel site carries the arguments for it too. This row drives a real solo call with the boundary words RECORDED and the order live, and reads what the call sent.
test('SOLO-8 (the draft boundary on, the order live): a solo ask is built with the head arguments, so it is sent, and its head carries the boundary lines and is byte-equal to the seat\'s first call\'s head', async () => {
  setHeldForTest({ ...HC, draftStartLine: HD.draftStartLine, draftBoundarySentence: HD.draftBoundarySentence });
  let r;
  try {
    const critics = [['la', 1], ['lb', 2, 'mock-critic-silent'], ['lc', 3]];
    try { await scenario({ critics, silentLabs: ['lb'], overrides: { 'panel-1-la': MET }, extra: { maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, prompt_cache: { enabled: true }, draft_end_marker: { enabled: true } } }); assert.fail('the premise: the silent judge stops the run'); }
    catch (e) { if (!(e instanceof RoundStopped)) throw e; r = { stop: e.stop, served: e.served, prompts: e.prompts }; }
  } finally { setHeldForTest(null); }
  assert.deepEqual([r.stop?.kind, r.stop?.why, r.stop?.layer], ['layer_bound', 'unheard', 2], `the premise: ${JSON.stringify(r.stop)}`);
  const pass = r.stop?.pass; assert.ok(Number.isInteger(pass), JSON.stringify(r.stop));
  const first = r.prompts?.get(`panel-${pass}-lb`); const solo = r.prompts?.get(`panel-${pass}-lb-solo`);
  assert.ok(first && solo, `both prompts were sent: ${[...(r.prompts?.keys() ?? [])].filter(k => k.includes('lb')).join(' ')}`);
  assert.equal(typeof solo.cacheHead, 'string', 'the order is live: the solo call names its head');
  assert.ok(solo.cacheHead.includes(HC.draftEndLineNeutral()) && solo.cacheHead.includes(HD.draftStartLine()), 'the head carries the recorded boundary lines');
  assert.equal(solo.cacheHead, first.cacheHead, 'the solo head is the first call\'s head');
});

test('SOLO-6 (every reader of panel file names treats -solo like a re-ask): the pricing base label strips it, and the readers that skip re-ask stage files (the UI run browser, route-layer, spans, verdict-stats) name -solo beside -reaskN', () => {
  assert.equal(baseLabelOf('panel-1-lb-solo'), 'panel-1-lb'); assert.equal(baseLabelOf('panel-1-lb-reask2'), 'panel-1-lb');
  for (const f of ['src/ui/server.js', 'src/route-layer.js', 'src/spans.js', 'src/verdict-stats.js']) assert.match(readFileSync(join(root, f), 'utf8'), /solo/, `${f} knows -solo`);
  assert.match(readFileSync(join(root, 'src', 'ui', 'server.js'), 'utf8'), /\/-\(\?:reask\\d\+\|solo\)\\\.md\$\/\.test\(f\)/, 'the run browser does not show "<seat>-solo" as a seat');
});

test('SOLO-7 (an external seat\'s solo ask names the right file): the session seat answers unreadably through its two re-asks; its solo ask pauses (ExternalPause) and the note names the seat\'s LAST unreadable reply of the pass, panel-<pass>-<seat>-reask2.md, never a file that does not exist (reask-1)', async () => {
  const mock = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const seats = { builder: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'writer' }, critics: [mock('la', 1), mock('lb', 2), { provider: 'external', model: 'claude-code-session', lab: 'lc', layer: 3 }] };
  const garbage = 'this is not a verdict';
  let paused = null;
  try {
    await scenario({ critics: null, extra: { maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, seats }, overrides: { 'panel-1-la': MET, 'panel-1-lc': garbage, 'panel-1-lc-reask1': garbage, 'panel-1-lc-reask2': garbage }, cutLabels: ['panel-1-lc-solo'] });
  } catch (e) { if (e instanceof ExternalPause) paused = e; else if (!(e instanceof RoundStopped)) throw e; }
  assert.equal(paused?.label, 'panel-1-lc-solo', `the solo ask of the session seat pauses: ${paused?.label}`);
  assert.match(paused.user, /panel-1-lc-reask2\.md/, 'the note names the last unreadable reply');
  assert.doesNotMatch(paused.user, /reask-1/);
});
