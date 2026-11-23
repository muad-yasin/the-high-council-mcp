// Unit D (B3 prep): the final read - at a layered unanimous run that ends WITHOUT agreement, the top-layer seats that have not read the plan as it ends read it once
// (src/final-read.js, runFinalRead in src/chain.js). Offline, mock seats only, $0. The end used is CODE-4 route A1: layer 1 is never heard, so layers 2 and 3 are never asked.
// The judges are scripted mock models (`mock-critic-script-o-<id>` signs off; counters live in the process, so every test gives its models its own suffix).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import Ajv from 'ajv';
import { runChain, setCache, setBudget, setProgressHook, setPromptSpy, BudgetExceeded, ExternalPause, RoundStopped } from '../src/chain.js';
import { computeOutcome } from '../src/outcome.js';
import { lintChain } from '../src/chain-lint.js';
import { estimateChainRows, expectedOutputTokensOf } from '../src/cost.js';
import { systemTextsFor } from '../src/stage-system.js';
import { critic, chainOf, neverHeardChain, snapshot } from './helpers/final-read-chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { HELD_OFF, withHeldOff } from './helpers/held-off.js';
import * as VE from '../src/verdict-envelope.js';
import * as H from './held-prompts/held-083.js';
import { oneLayerRun, CLEARS, OBJECTS } from './helpers/one-layer-stated-pass.js';
import { oneLayerCli } from './helpers/one-layer-cli.js';
import { agreedOf } from '../src/ending-matrix.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
afterEach(() => { setCache(null); setBudget(null); setProgressHook(null); setPromptSpy(null); setHeldForTest(null); VE.setEnvelopeStore(null); VE.setEnvelopeInForce(false); });
const go = async (config, opts = {}) => {
  const lines = [];
  const r = await runChain({ request: 'A mock task.', log: m => lines.push(m), runId: 'r-final-read', ...opts, config });
  return { r, log: lines.join('\n') };
};
const FR = {};   // CHANGED ACCEPTED (0.8.4 S16, N6: the final read has no switch). OLD: `{ final_read: { enabled: true } }` turned the read on; the key is now refused by the lint (src/chain-lint.js 'final-read-removed'), so the rows that were 'switch ON' pass nothing and every layered unanimous run reads.
const stageLabels = r => r.stages.map(s => s.label);

test('no switch (S16): the run is what the tree before unit D produced (captured from 82232b36) in everything the climb recorded; the final read only adds its own stages, its record and the block above the plan', async () => {
  // CHANGED ACCEPTED (0.8.4 S16, N6). OLD: 'switch OFF: the run is exactly what the tree before unit D produced', no final_read key, no final-read stage, no block. NEW: the same fixture is the control for what the read must NOT touch (passed, layers, panelVerdicts, signoff, the stages of the climb); the read's own additions are named. WHY: the read has no switch, so a run without it no longer exists.
  const { r } = await go(neverHeardChain('base'));
  const fixture = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'final-read-switch-off-82232b36.json'), 'utf8'));
  const snap = JSON.parse(JSON.stringify(snapshot(r)));
  for (const k of ['passed', 'layers', 'panelVerdicts', 'signoff']) assert.deepEqual(snap[k], fixture[k], `${k}: the final read must not touch what the climb recorded (draftShaByRound is now filled for every layered round, and nothing persists it)`);
  assert.deepEqual(snap.stages.slice(0, fixture.stages.length), fixture.stages, 'the stages of the climb are unchanged and come first');
  // FINDING (not on the owed list of the ladder unit; the first box run, 10 Nov 2026). OLD: the stages after the captured climb were the read's own: final-read-l3a, final-read-l3b, final-read-l3b-reask1. NEW: the two silent layer-1 judges are asked once more on their own after their re-asks (the solo ask, his 10 Nov 2026 ruling), so panel-1-l1a-solo and panel-1-l1b-solo come first; the read's own stages are unchanged.
  assert.deepEqual(snap.stages.slice(fixture.stages.length).map(x => x.label), ['panel-1-l1a-solo', 'panel-1-l1b-solo', 'final-read-l3a', 'final-read-l3b', 'final-read-l3b-reask1'], 'the solo asks of the two silent judges, then exactly the read\'s own stages');
  assert.equal(snap.deliverable.endsWith(fixture.deliverable), true, 'the block sits above the plan, the plan is unchanged');
  assert.match(snap.deliverable, /^## Layer 3 on the final plan/);
  assert.equal(r.finalRead.ran, true);
});

test('a never-heard end: each unread layer-3 seat is asked once; an unreadable one is re-asked once and recorded "did NOT read"; the ending, signoff[], panelVerdicts and layers are untouched', async () => {
  const fixture = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'final-read-switch-off-82232b36.json'), 'utf8'));   // the tree before unit D: the control for what the read must not touch
  const { r, log } = await go(neverHeardChain('on', FR));
  // the precondition, asserted so the test cannot pass vacuously: nobody at layer 3 had read anything before the stage
  assert.equal(fixture.passed, false);
  assert.deepEqual(r.layers.map(x => `${x.layer}:${x.state}`), ['1:unheard', '2:not_asked', '3:not_asked']);
  assert.ok(r.finalRead.ran);
  assert.deepEqual(r.finalRead.seats.map(s => s.last_read_sha), [null, null]);
  assert.deepEqual(r.finalRead.seats.map(s => [s.lab, s.layer, s.read, s.reasked]), [['l3a', 3, true, false], ['l3b', 3, false, true]]);
  assert.equal(r.finalRead.seats[0].meets, true);
  assert.match(r.finalRead.seats[1].why, /.+/);
  assert.deepEqual(stageLabels(r).filter(l => l.startsWith('final-read-')).sort(), ['final-read-l3a', 'final-read-l3b', 'final-read-l3b-reask1']);
  // one call per unread seat (+ the one re-ask) and nothing else changed
  for (const k of ['signoff', 'panelVerdicts', 'layers', 'passed']) assert.deepEqual(JSON.parse(JSON.stringify(r[k])), fixture[k], `${k} must not be touched by the final read`);
  assert.equal(computeOutcome(r), computeOutcome({ ...r, finalRead: undefined }));
  assert.match(log, /Stage: final read/);
  assert.match(log, /l3b: did NOT read the final plan/);
  assert.match(log, /NOT EVERY LAYER-3 SEAT READ THE FINAL PLAN after its last change \(l3b did not\)/);
  assert.match(r.deliverable, /^## Layer 3 on the final plan/m);
  assert.match(r.deliverable, /### l3b: DID NOT READ/);
  assert.ok(r.deliverable.indexOf('## Layer 3 on the final plan') < r.deliverable.indexOf('MOCK DELIVERABLE'), 'the record sits above the plan, never in it');
  assert.ok(r.dispute === undefined || r.dispute.ran === false, 'no objection was open in this end, so there was no dispute rewrite');
});

test('switch ON, run ends AGREED and nothing changed after the sign-off: every layer-3 seat has read exactly this plan, so nothing is asked (ran:false)', async () => {
  const { r } = await go(chainOf([critic('mock-critic-script-o-fra1-ag', 'l1', 1), critic('mock-critic-script-o-fra2-ag', 'l2', 2), critic('mock-critic-script-o-fra3-ag', 'l3', 3)], FR));
  assert.equal(r.passed, true);
  assert.deepEqual(r.finalRead, { ran: false, reason: 'every_top_seat_read_this_plan', run_end: 'agreed', final_sha: r.finalRead.final_sha, seats: [] });
  assert.ok(!stageLabels(r).some(l => l.startsWith('final-read-')));
});

// CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026, parts 2 and 3). OLD: an AGREED end whose text changed after the sign-off (a finalist's final edit), layer 3 reading it again: a calm leg (no objection: ran true, run_end agreed, outcome consensus, the log "every layer signed off, but the plan changed after") and a hard leg (an objection: passed true, signoff[] all true, outcome no_consensus, the log "LAYER 3 OBJECTED ... every layer had signed off on an earlier text ...", the deliverable's "**Layer 3 objected ... NOT agreement.**" line).
// Red on the tip (job 128: calm c2 `ran` false); the cause, by read: the build-check wording was recorded at dc60423a, so with it `passed` true implies agreedAtPoint and the final edit never runs at an agreed end (chain.js:7660) and no top seat is owed a re-read: that end cannot be reached with a changed text (read, jobs 122 and 135: the final edit is skipped, final_read ran false). NEW: the same two claims at the one end a run CAN have (a person's own chain: one layer, `freedoms: { pass: true }`, an
// external handler; test/helpers/one-layer-stated-pass.js; printed in jobs 124, 127, 135): seat-a signs, seat-b states a pass, so seat-b's final read is owed on an UNCHANGED text. Calm leg = seat-b's final read CLEARS; hard leg = it OBJECTS. Kept: passed true on both; the final read ran and run_end 'agreed'; the seat's [lab, read, meets]; the hard leg's deliverable clause in its layer-1 form;
// signoff[] untouched by the objection (compared with the calm leg's: the pass row is signedOff null here, so "every signedOff === true" has no one-layer form). NOT asserted any more (A3: false there, the text never changed): the calm log "the plan changed after" and the hard log's "on an earlier text" half. REMOVED (bin 1: unreachable on the recorded state, FOR_085): computeOutcome no_consensus / consensus (the stated pass is an abstention: outcome 'degraded' on both legs, outcome.js:29, so outcome.js:31 is not reached). The skip is pinned by test/build-check.test.js: the 'Q-i1 (permanent)' row at :154 (the handler form: after good_to_build the challenge and the final edit are not served) and T21d at :171 (the no-handler form); the dispute rewrite's skip is read, not driven.
// WHY: the same subject (a final-read objection at an agreed end keeps passed true and ends the run not agreed; a clear read leaves it agreed) on a run that exists. RED: the two scripted replies swapped (objection to clear and clear to objection): each leg's ending assertions fail.
test('switch ON, AGREED end (one layer, a stated pass): seat-b reads the final plan; no objection leaves the ending agreed, an objection ends it NOT agreed with passed and signoff[] untouched', async () => {
  const calmLines = []; const calm = await oneLayerRun({ finalRead: CLEARS, lines: calmLines });
  assert.equal(calm.result.passed, true);
  assert.equal(calm.result.finalRead.ran, true);
  assert.equal(calm.result.finalRead.run_end, 'agreed');
  assert.deepEqual(calm.result.finalRead.seats.map(s => [s.lab, s.read, s.meets]), [['seat-b', true, true]]);
  assert.equal(agreedOf({ passed: calm.result.passed, ending: calm.result.ending, final_read: calm.result.finalRead }), true, 'a clear read leaves the run agreed');
  assert.equal(calm.result.ending?.kind, 'agreed');
  assert.doesNotMatch(calmLines.join('\n'), /NOT agreement/);
  const hardLines = []; const hard = await oneLayerRun({ finalRead: OBJECTS, lines: hardLines });
  assert.equal(hard.result.passed, true, 'passed is the panel\'s own verdict and stays');
  assert.deepEqual(hard.result.signoff, calm.result.signoff, 'signoff[] stays: the objection changes nothing of what the panel recorded');
  assert.deepEqual(hard.result.signoff.map(s => [s.lab, s.signedOff, s.passed === true]), [['seat-a', true, false], ['seat-b', null, true]], 'the panel recorded seat-a signed and seat-b stated a pass');
  assert.deepEqual(hard.result.finalRead.seats.map(s => [s.lab, s.read, s.meets]), [['seat-b', true, false]]);
  assert.equal(hard.result.finalRead.run_end, 'agreed');
  assert.equal(agreedOf({ passed: hard.result.passed, ending: hard.result.ending, final_read: hard.result.finalRead }), false, 'an objection to the final plan ends the run not agreed');
  assert.equal(hard.result.ending?.kind, 'signed_off_at_top_not_agreed');
  assert.ok(hard.result.ending?.basis?.includes('final_read_objection'), `the ending's basis names the final-read objection (and, on a one-layer chain, layer_3_sign_off: printed): ${JSON.stringify(hard.result.ending?.basis)}`);
  assert.match(hard.result.deliverable, /\*\*Layer 1 objected to the final plan with an objection that holds the sign-off, so this run is NOT agreement\.\*\*/);
});

// REMOVED (0.8.4, C&C ruling 12 Nov 2026, released after the box run of the s16 rows). OLD: an agreed end, the plan changed after the sign-off, and the sole layer-3 seat (external, then unreadable twice) did not read the final plan: the run does not end, it stops at the final-read stop (layer_bound, final_read, top layer 3). NEW: the row is gone. WHY: it is a duplicate of T21al/T21au (test/s16-final-read-stop.test.js:38: both layer-3 seats unreadable in a run with a handling session: the same stop triple, attempt 0) and T21am/aw/bh/by (:51, the no-handling-session form), all green on the tip (box job 51, tree s134-fix3: 9 of 9), and its agreed-end-with-a-changed-plan premise has no traced route on the recorded state (the final edit is skipped at an agreed end).

// CHANGED ACCEPTED TEST (0.8.4 apply, C&C ruling 12 Nov 2026, parts 2 and 3). OLD: the CLI on an AGREED chain whose final edit layer 3 objected to: exit 22, the stdout verdict "NOT agreement: every layer had signed off on an earlier text, but a layer-3 objection ... holds the sign-off", the line "final read: l3 objected (N) - the run is NOT agreed", report.passed true, outcome no_consensus, final_read.run_end agreed, the BOARD heading "## Not agreed: layer 3 objected to the final plan".
// Red on the tip (job 128: exit 0, "no build check was made", no final edit): the same unreachable end as the test above (read: the build-check wording recorded at dc60423a). NEW: the same verb on the one-layer stated-pass chain with an EXTERNAL seat-b (test/helpers/one-layer-cli.js; printed in job 136), seat-b's final read OBJECTING: exit 22, the suffix line whole ("final read: seat-b objected (1) - the run is NOT agreed"), report.passed true, final_read.run_end 'agreed', the BOARD
// heading line "## Not agreed: layer 1 objected to the final plan" ONLY (its second line says "on an earlier text, but the plan changed afterwards": false there). A clearing leg is the control (exit 0, no suffix, no "NOT agreed" heading). NOT asserted (A3): the stdout verdict line, whose only reachable form says "every layer had signed off on an earlier text" (false on this run: no revise, delivered text same as signed). REMOVED (bin 1): report.outcome 'no_consensus' (the stated pass makes it 'degraded'; outcome.js:31 is not reached). The skip is pinned by test/build-check.test.js: the 'Q-i1 (permanent)' row at :154 (the handler form: after good_to_build the challenge and the final edit are not served) and T21d at :171 (the no-handler form); the dispute rewrite's skip is read, not driven.
// WHY: the same subject (the verb's exit code, suffix line, report and BOARD for an objection at an agreed end) on a run that exists. RED: the two answers swapped in the pause loop: the objection leg's exit 22 and suffix fail.
test('real verb (one layer, a stated pass, an external seat-b): an objection at the final read exits 22, says the run is NOT agreed in the final-read line and at the top of the BOARD, and report.json keeps passed true; a clear read exits 0 with neither', () => {
  const obj = oneLayerCli('OBJ');
  assert.equal(obj.status, 22, obj.stdout + obj.stderr);
  assert.match(obj.stdout, /^final read: seat-b objected \(1\) - the run is NOT agreed$/m);
  assert.equal(obj.report.passed, true);
  assert.equal(obj.report.final_read.run_end, 'agreed');
  assert.equal(obj.report.ending.kind, 'signed_off_at_top_not_agreed');
  assert.ok(obj.report.ending.basis.includes('final_read_objection'), JSON.stringify(obj.report.ending.basis));
  assert.match(readFileSync(join(obj.runDir, 'BOARD.md'), 'utf8'), /^# Debate board[^\n]*\n\n## Not agreed: layer 1 objected to the final plan\n/);
  const clr = oneLayerCli('CLR');
  assert.equal(clr.status, 0, clr.stdout + clr.stderr);
  assert.match(clr.stdout, /^final read: seat-b no objection$/m);
  assert.doesNotMatch(clr.stdout, /the run is NOT agreed/);
  assert.equal(clr.report.final_read.run_end, 'agreed');
  assert.equal(clr.report.ending.kind, 'agreed');
  assert.doesNotMatch(readFileSync(join(clr.runDir, 'BOARD.md'), 'utf8'), /## Not agreed/);
});

test('an unread seat\'s cause is the envelope\'s when the reply parsed but carried no ids (the panel\'s own words), not "malformed JSON"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'final-read-env-'));
  setHeldForTest(withHeldOff({ verdictEnvelopeSection: H.verdictEnvelopeSection, criticEnvelopeReaskNote: H.criticEnvelopeReaskNote, criticEnvelopeUnreadableWhy: H.criticEnvelopeUnreadableWhy, criticEnvelopeUnreadableLabel: H.criticEnvelopeUnreadableLabel }));
  VE.setEnvelopeStore(VE.fileEnvelopeStore(dir)); VE.setEnvelopeInForce(true);
  // CHANGED ACCEPTED (0.8.4 S16, D): OLD l3m was the sole layer-3 seat. NEW a second layer-3 seat reads, because a run in which nobody read stops instead of ending and the entry would never be recorded.
  const config = chainOf([critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-frv2-env', 'l2a', 2), critic('mock-critic-envelope-m-fr3-env', 'l3m', 3), critic('mock-critic-script-o-frv3-env', 'l3n', 3)], FR);
  const { r } = await go(config);
  const seat = r.finalRead.seats.find(x => x.lab === 'l3m');
  assert.equal(seat.read, false);
  assert.equal(seat.why, H.criticEnvelopeUnreadableWhy({ kind: 'missing' }));
  assert.doesNotMatch(seat.why, /malformed JSON/);
});

test('a spend stop inside the final read is control flow: the run stops with BudgetExceeded (resumable), it is not swallowed into "did not read"', async () => {
  const config = chainOf([
    critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-frb2-bx', 'l2a', 2),
    { provider: 'mock', model: 'mock-priced', lab: 'l3big', layer: 3, maxTokens: 8000, estimate: { critiqueTokens: 8000 } },
  ], FR);
  setBudget(1);
  const err = await go(config).then(() => null, e => e);
  assert.ok(err instanceof BudgetExceeded, String(err));
  assert.equal(err.label, 'final-read-l3big', 'the stop is the final read\'s own call, not a stop somewhere else in the run');
  assert.ok(!err.partial?.stages?.some(s => s.label.startsWith('final-read-')), 'the gate stopped the call before it was sent');
});

test('an external layer-3 seat pauses AT the final read; the answered seat is replayed at $0 on resume, the other seat is not asked again, and the record is the same', async () => {
  const PASS = JSON.stringify({ meets: true, criteria: [], failures: [], verdict_line: 'All criteria met.' });
  const config = () => chainOf([
    critic('mock-unreadable', 'l1a', 1), critic('mock-unreadable', 'l1b', 1), critic('mock-critic-script-o-frr2-rs', 'l2a', 2),
    critic('mock-critic-script-o-frr3-rs', 'l3a', 3), { provider: 'external', model: 'claude-code-session', lab: 'ext', layer: 3 },
  ], FR);
  const saved = new Map();
  const paused = await go(config(), { onStage: s => saved.set(s.label, s) }).then(() => null, e => e);
  assert.ok(paused instanceof ExternalPause, String(paused));
  assert.equal(paused.label, 'final-read-ext');
  assert.ok(saved.has('final-read-l3a'), 'the other layer-3 seat was asked before the pause');
  setCache({ get: label => saved.get(label) ?? (label === 'final-read-ext' ? { text: PASS, provider: 'external', model: 'claude-code-session', usage: { input: 0, output: 0 }, usd: 0, promptHash: paused.promptHash } : null) });
  const { r } = await go(config());
  assert.deepEqual(r.finalRead.seats.map(s => [s.lab, s.read, s.reasked]), [['l3a', true, false], ['ext', true, false]]);
  assert.equal(r.stages.find(s => s.label === 'final-read-l3a').cached, true, 'the seat answered before the pause is replayed from disk, not asked again');
  assert.deepEqual(stageLabels(r).filter(l => l.startsWith('final-read-')).sort(), ['final-read-ext', 'final-read-l3a'], 'one call per seat, no duplicate');
  assert.equal(r.passed, false);
});

test('lint (S16): final_read is not a setting any more, on any chain; a chain without the key gets no such finding', () => {
  // CHANGED ACCEPTED (0.8.4 S16, N6; WORDING S16-w1). OLD: 'final_read is refused where it would do nothing (not layered, or not unanimous), accepted on a layered unanimous chain'. NEW: the read has no switch, so a chain that names the key is refused on every shape, as `severity` and `layer_debate` are. WHY: no setting is silently ignored.
  const layered = chainOf([critic('mock-critic-script-o-frl1', 'a', 1), critic('mock-critic-script-o-frl2', 'b', 2)], FR);
  assert.deepEqual(lintChain(layered).filter(f => /final/.test(f.kind)), [], 'a chain without the key gets no such finding');
  const unlayered = { ...layered, seats: { ...layered.seats, critics: layered.seats.critics.map(({ layer, ...c }) => c) } };
  for (const [name, cfg] of [['layered', layered], ['unlayered', unlayered], ['not unanimous', { ...layered, signoff: 'first' }]]) {
    for (const val of [{ enabled: true }, { enabled: false }, {}]) {
      const hits = lintChain({ ...cfg, final_read: val }, 'my-chain.json').filter(f => f.kind === 'final-read-removed');
      assert.equal(hits.length, 1, `${name} ${JSON.stringify(val)}: one finding`);
      assert.equal(hits[0].message, 'final_read is not a setting any more: the top layer reads the final plan at the end of every layered chain with "signoff": "unanimous", so there is nothing to switch on.');
      assert.equal(hits[0].fix, 'Remove "final_read" from my-chain.json.');
    }
  }
  assert.ok(!lintChain({ ...layered, final_read: { enabled: true } }).some(f => f.kind === 'final-read-needs-layers'), 'the old finding no longer exists');
});

test('the dry run: final-read rows have a system text and a panel-call expected size, only in the MAXIMUM figure; there is no switch (S16), so a chain that is not layered unanimous is the only one without them; a re-ask has no expected size', () => {
  const config = chainOf([critic('mock-critic-script-o-frd1', 'a', 1), critic('mock-critic-script-o-frd2', 'b', 2), critic('mock-critic-script-o-frd3', 'c', 3)], { ...FR, maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 } });
  const seat = config.seats.critics[2];
  assert.ok(systemTextsFor('final-read-L3-c', config, seat).every(t => typeof t === 'string' && t.length > 0));
  // the final read honours no freedoms (a stated pass, a blocking question): its system text does not move when the chain grants them, the panel's does
  const withFreedoms = { ...config, freedoms: { pass: true, blocking_questions: true } };
  assert.deepEqual(systemTextsFor('final-read-L3-c', withFreedoms, seat), systemTextsFor('final-read-L3-c', config, seat));
  assert.notDeepEqual(systemTextsFor('panel-L3-c', withFreedoms, seat), systemTextsFor('panel-L3-c', config, seat));
  assert.equal(expectedOutputTokensOf('final-read-c', seat, config.estimate), expectedOutputTokensOf('panel-1-c', seat, config.estimate));
  assert.equal(expectedOutputTokensOf('final-read-c-reask1', seat, config.estimate), null);
  // CHANGED ACCEPTED TEST (0.8.4 unit 4, 04 Nov 2026; his pick OWNER 6). OLD: the maximum lists one `final-read-` row per read and nothing for a re-ask. NEW: it also lists one `-reask` row per read, at the read's expected cost (the upper estimate includes a judge's re-asks); `rowsOf` below counts the reads only. WHY: "the dry run's printed upper figure for judge re-asks: Expected cost".
  const rowsOf = (cfg, maximum) => estimateChainRows(cfg, { maximum }).filter(r => r.label.startsWith('final-read-') && !/-reask$/.test(r.label));
  const reasksOf = cfg => estimateChainRows(cfg, { maximum: true }).filter(r => /^final-read-.*-reask$/.test(r.label));
  assert.equal(rowsOf(config, true).length, 1);
  assert.equal(reasksOf(config).length, 1, 'one re-ask row for the one read');
  assert.equal(reasksOf(config)[0].label, `${rowsOf(config, true)[0].label}-reask`);
  assert.deepEqual(estimateChainRows(config).filter(r => /-reask$/.test(r.label)), [], 'and none in the expected figure');
  assert.deepEqual(rowsOf(config, false), []);
  // CHANGED ACCEPTED (0.8.4 S16, N6). OLD: `rowsOf({ ...config, final_read: undefined }, true)` was [] (the switch off). NEW: the rows are there whatever the key says, and absent only when the chain is not layered unanimous.
  assert.equal(rowsOf({ ...config, final_read: { enabled: false } }, true).length, 1, 'no switch: the key changes nothing');
  assert.deepEqual(rowsOf({ ...config, signoff: 'first' }, true), [], 'a chain that is not unanimous has no final read');
  // a chain whose plan is rewritten after the sign-off (a final edit seat or a challenge) has the read in the EXPECTED figure too; B3 has neither
  assert.equal(rowsOf({ ...config, seats: { ...config.seats, finalist: { provider: 'mock', model: 'mock-finalist', lab: 'editor' } } }, false).length, 1);
  assert.equal(rowsOf({ ...config, challenge: { enabled: true } }, false).length, 1);
  // a layered unanimous chain with no maxOverseerRounds (the other estimator branch) gets the row too
  const { maxOverseerRounds, layerRevisions, ...plain } = config;
  assert.equal(rowsOf(plain, true).length, 1);
  assert.deepEqual(rowsOf(plain, false), []);
});

test('real verb: the CLI on a mock chain ends not agreed (exit 22), writes final_read into report.json (schema-valid), the BOARD section and the block above the plan', () => {
  const work = mkdtempSync(join(tmpdir(), 'final-read-cli-'));
  mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'task.md'), 'Write a one-paragraph plan for a bake sale.\n');
  const config = neverHeardChain('cli', FR);
  writeFileSync(join(work, 'chains', 'fr.json'), JSON.stringify({ ...config, summary: 'final read test' }));
  const run = spawnSync(process.execPath, [cli, '--task', 'task.md', '--chain', 'fr', '--max-usd', '1'], { cwd: work, encoding: 'utf8' });
  assert.equal(run.status, 22, run.stdout + run.stderr);
  const runDir = join(work, 'runs', readdirSync(join(work, 'runs')).sort().pop());
  const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
  assert.equal(report.final_read.ran, true);
  assert.match(run.stdout, /^final read: l3a no objection; l3b DID NOT READ$/m, 'the end-of-run summary carries the closing statement too');
  assert.deepEqual(report.final_read.seats.map(s => [s.lab, s.read]), [['l3a', true], ['l3b', false]]);
  assert.equal(report.passed, false);
  assert.match(readFileSync(join(runDir, 'BOARD.md'), 'utf8'), /## Final read by layer 3/);
  assert.match(readFileSync(join(runDir, 'deliverable.md'), 'utf8'), /^## Layer 3 on the final plan/m);
  assert.ok(readdirSync(runDir).includes('final-read-l3b-reask1.md'));
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
  assert.ok(ajv.compile(schema)(report), 'report.json must validate against schemas/report-v1.json');
});

test('chain-schema: dispute.review validates, and final_read is refused (S16: no switch, the property left the schema)', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  assert.ok(validate({ ...base, dispute: { enabled: true, review: true } }), JSON.stringify(validate.errors));
  assert.ok(!validate({ ...base, final_read: { enabled: true } }), 'the schema no longer lists final_read');
});
