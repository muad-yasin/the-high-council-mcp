// 0.8.4 S16 FIX ROUND (C&C 09 Nov: group A, "build before the merge"): WHOLE-RUN tests for the rows that were covered only by pure functions or by one neighbouring case. Each test is a real run of runChain on the mock layered chain of
// test/helpers/layer-two-run.js, offline, $0. T21as/T15v: two layer-3 seats read in the climb, nothing changed since: the final read makes no call. T21a/T21ar and T21p/T21az: a layer-3 seat silent in the climb, the person finishes at the
// stop: only that seat is asked (one call), and when its reply is unreadable it is re-asked once, named as not having read, and the run ends with no further stop. T21o: a person's finish at the overseer-round limit with a changed text.
// Written without a run (no tests on the laptop): the first box run decides the fixtures. The reds are swapped-input variants (the one red tree of the round).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { RoundStopped, setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { roundChoiceEntry } from '../src/overseer-rounds.js';
import { scenario, CRITERION, failureOf, checkAnswerOf } from './helpers/layer-two-run.js';
import { objectionId } from '../src/objection-ids.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const OBJ5 = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });
const frLabelsOf = r => r.result.stages.map(s => s.label).filter(l => l.startsWith('final-read-'));
const choiceOf = (stop, choice) => roundChoiceEntry(stop, choice, null);

test('T21as, T15v: a pass in which every layer signed, two layer-3 seats, no handling session: the run ends agreed and the final read makes no call (both seats had read exactly this plan)', async () => {
  const r = await scenario({ answerBack: true, critics: [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]], overrides: { 'panel-1-la': MET } });
  assert.deepEqual(frLabelsOf(r), [], 'T21as, T15v: no final-read call');
  assert.deepEqual([r.result.passed, r.result.finalRead?.ran, r.result.finalRead?.reason], [true, false, 'every_top_seat_read_this_plan'], 'the record says nobody was asked');
  assert.deepEqual(r.result.panelVerdicts.filter(v => v.layer === 3).map(v => v.lab).sort(), ['lc', 'ld'], 'premise: both layer-3 seats read in the climb');
});

// A layer-3 seat 'lc' that gives no reply in the climb (a model that never answers, its panel labels cut so the real mock runs) beside 'ld', which signs. With a handling session the climb stops at layer 3 (layer_bound, unheard); a person's finish ends it.
async function climb({ critics, silent, overrides = {}, runExtra = {} }) {
  return await scenario({ answerBack: true, critics, silentLabs: silent, handler: true, extra: { maxRounds: 8 }, overrides: { 'panel-1-la': MET, ...overrides }, runExtra });
}
async function stopOf(args) {
  try { await climb(args); } catch (e) { if (e instanceof RoundStopped) return e; throw e; }
  return assert.fail('the climb was expected to stop');
}

test('T21a, T21ar: one layer-3 seat read exactly the final text and the other did not (it was unheard in the last climb read); the person finishes at the stop: the final read makes exactly ONE call, to the seat that has not read, and the other seat\'s read is reused', async () => {
  const CRITICS = [['la', 1], ['lb', 2], ['lc', 3, 'mock-unreadable'], ['ld', 3]];
  const SILENT = ['lc'];
  const MORE = {};
  const first = await stopOf({ critics: CRITICS, silent: SILENT, overrides: { 'final-read-lc': MET, ...MORE } });
  const r = await climb({ critics: CRITICS, silent: SILENT, overrides: { 'final-read-lc': MET, ...MORE }, runExtra: { roundChoices: [choiceOf(first.stop, 'finish')] } });
  assert.ok(!(r.result.finalRead?.seats ?? []).some(e => e.lab === 'ld'), 'T21a, T21ar: the other seat\'s read is reused, it has no entry among the seats asked');
  assert.deepEqual(frLabelsOf(r), ['final-read-lc'], 'T21a, T21ar: one call, to the seat that had not read');
  assert.equal(r.result.finalRead?.seats?.find(e => e.lab === 'lc')?.read, true, 'it read the plan');
  assert.deepEqual([first.stop?.kind, first.stop?.why, first.stop?.layer, r.result.passed], ['layer_bound', 'unheard', 3, false], 'premise: the climb stopped at the silent layer-3 seat, the finish ended it not agreed');
});

test('T21p, T21az: a layer-3 seat silent in the climb, a person finishes at the stop, and its reply to the final read is unreadable: it is asked once and re-asked once, named as not having read, the other seat is not asked, and the run ends not agreed with no further stop', async () => {
  const CRITICS = [['la', 1], ['lb', 2], ['lc', 3, 'mock-unreadable'], ['ld', 3]];
  const SILENT = ['lc'];
  const MORE = {};
  const first = await stopOf({ critics: CRITICS, silent: SILENT, overrides: MORE });
  let r; let stopped;
  try { r = await climb({ critics: CRITICS, silent: SILENT, overrides: MORE, runExtra: { roundChoices: [choiceOf(first.stop, 'finish')] } }); }
  catch (e) { if (e instanceof RoundStopped) stopped = e; else throw e; }
  assert.equal(stopped, undefined, 'T21az: no stop with a choice follows the read: the other seat had read the plan');
  assert.deepEqual(frLabelsOf(r).sort(), ['final-read-lc', 'final-read-lc-reask1'], 'T21p: one call and one re-ask for the silent seat, none for the other');
  const lc = r.result.finalRead?.seats?.find(e => e.lab === 'lc');
  assert.deepEqual([lc?.read, lc?.reasked], [false, true], 'T21az: named as not having read, after its one re-ask');
  assert.equal(r.result.passed, false, 'T21az: the run ends not agreed');
  assert.equal(r.result.stop?.chosen, 'finish', 'the only stop is the person\'s own finish');
});

test('T21o: a person\'s finish chosen at the overseer-round limit, the dispute rewrite changing the text: the final read runs before the finish (layer 3 reads the rewrite) and the run ends not agreed', async () => {
  const REWRITE = 'The worker retries failed requests up to five times, with a pause between tries.';
  const opts = overrides => ({ answerBack: true, handler: true, critics: [['la', 1], ['lb', 2], ['lc', 3]], extra: { maxOverseerRounds: 1, dispute: { enabled: true, stall_rounds: 2 } }, overrides: { 'panel-1-la': MET, 'panel-1-lc': OBJ5, dispute: REWRITE, 'final-read-lc': MET, 'build-check-1': checkAnswerOf([objectionId('lc', failureOf(5))]), ...overrides } });   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: no answer for the build check. NEW: the handling session answers `build-check-1` (good_to_build, its reasons naming lc's open objection): a layered run with an external reviser now waits there once layer 3 signs off. WHY: buildCheckSystem and buildCheckUser recorded (src/chain.js askBuildCheck).
  let first = null;
  try { await scenario(opts({})); } catch (e) { if (e instanceof RoundStopped) first = e; else throw e; }
  assert.equal(first?.stop?.kind, 'overseer_cap', 'premise: the climb stops at the overseer-round limit');
  const r = await scenario({ ...opts({}), runExtra: { roundChoices: [choiceOf(first.stop, 'finish')] } });
  assert.deepEqual(frLabelsOf(r), ['final-read-lc'], 'T21o: the final read ran before the finish: layer 3 read the rewrite');
  assert.deepEqual([r.result.passed, r.result.stop?.chosen, r.result.finalRead?.ran], [false, 'finish', true], 'the person\'s finish, not agreed');
  assert.equal(r.result.dispute?.ran, true, 'premise: the dispute rewrite ran');
});
