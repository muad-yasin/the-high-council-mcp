// 0.8.3 overseer stop words (Builder C, 24 Okt 2026; C&C thcmcp-cd order, D's finding; plan note Review/Build_0.8.3/m8/C_StopSentence_Plan_2026-10-24.md; A-DRAFT words): the stop sentence said "(more rounds; you type a new spending limit)" for all three overseer stops.
// Both halves were false. `--continue` adds ONE overseer round at the cap, the layer's own bound again at a revision stop and REASKS_NO_REVISE passes for a silent seat (defaultAdd, src/overseer-rounds.js; a layer or silent-pass extension belongs to the
// overseer round it was made in, effectiveLimits); and it asks for no new limit: a run that holds a typed limit continues under it (src/start-cap.js authorizeStart, 'continued'), so the run's spending limit still applies. Every row reads the REAL stop
// (runChain's RoundStopped, or the CLI) and ties the numbers in the words to defaultAdd, so a sentence can not drift from what --continue adds. The tree member's tail, the sitting line and the usage text carry the same claim. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, RoundStopped, setCache, setBudget } from '../src/chain.js';
import { advance, defaultAdd, effectiveLimits, newRoundState, roundChoiceEntry, stopSentence } from '../src/overseer-rounds.js';
import { appendTreeEvent } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { sittingLines } from '../src/tree-resume.js';
import { memberStopContinue } from '../src/tree-redirect.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';
import { IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = (critics, over = {}) => ({
  name: 'ov-words', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...over,
});
/** The REAL stop of a mock chain (the in-process harness of test/overseer-wiring.test.js). */
const stopOf = async config => {
  setCache(null); setBudget(null);
  try { await runChain({ request: 'A mock task.', log: () => {}, onStage: () => {}, runId: 'r-ovw', config }); } catch (err) { assert.ok(err instanceof RoundStopped, String(err?.stack || err)); return err.stop; }
  return assert.fail('the chain was meant to stop at an overseer limit');
};
/** the parenthesis after `--continue` in the stop sentence */
const continueClause = sentence => { const m = /--continue \((.*?)\)\. To end it here/.exec(sentence); assert.ok(m, `the "To go on" sentence names --continue: ${sentence}`); return m[1]; };
const TAIL = "the run's spending limit still applies";
const OLD = /more rounds|you type a new spending limit/;

test('cap stop: --continue adds one overseer round (defaultAdd 1), and the sentence says that, not "more rounds", and that the run\'s limit still applies', async () => {
  const c = chainOf([judge('o', 'swa', 'l1', 1), judge('o', 'swb', 'l2', 2), judge('x', 'swc', 'l3', 3)], { maxOverseerRounds: 2 });
  const stop = await stopOf(c);
  assert.equal(stop.kind, 'overseer_cap');
  assert.equal(defaultAdd(stop, c), 1, 'what --continue adds at the cap');
  const s = stopSentence(stop, { runDir: 'runs/x' });
  assert.equal(continueClause(s), `one more overseer round; ${TAIL}`);
  assert.doesNotMatch(s, OLD);
  // BACKSTOP TEXT (no live route builds such a stop today: the member path that stands in for a missing partial report never reaches this tail): a stop that carries no figures says it generally. Hand-made on purpose.
  assert.equal(continueClause(stopSentence({ kind: 'layer_bound' }, { runDir: 'runs/x' })), `it extends the limit that was reached; ${TAIL}`);
});

test('revision stop: --continue gives the layer its own bound again for this overseer round (defaultAdd), the number is the real one, plural and singular', async () => {
  const c2 = chainOf([judge('x', 'swd', 'l1', 1), judge('o', 'swe', 'l2', 2), judge('o', 'swf', 'l3', 3)]);          // layer 1 objects past its bound of 2
  const stop2 = await stopOf(c2);
  assert.deepEqual([stop2.kind, stop2.why, stop2.layer, stop2.bound], ['layer_bound', 'revisions', 1, 2]);
  const add2 = defaultAdd(stop2, c2); assert.equal(add2, stop2.bound, 'defaultAdd and the stop agree on the layer\'s bound');
  const s2 = stopSentence(stop2, { runDir: 'runs/x' });
  assert.equal(continueClause(s2), `layer 1 gets ${add2} more revisions in this overseer round; ${TAIL}`);
  assert.doesNotMatch(s2, OLD);
  const c1 = chainOf([judge('o', 'swg', 'l1', 1), judge('x', 'swh', 'l2', 2), judge('o', 'swi', 'l3', 3)]);          // layer 2 objects past its bound of 1
  // CHANGED (0.8.4 S7, Q7): a REAL run whose layer 2 objects past its bound no longer stops there - the plan goes up to layer 3 instead (test/s7-go-up.test.js GU-2). The stop sentence, defaultAdd and the continue clause still serve a recorded stop of an older run and the no-pass-left
  // case, so this half builds the stop the way advance() and chain.js build it (the layer-1 half above still runs for real).
  const stop1 = { kind: 'layer_bound', why: 'revisions', layer: 2, used: 1, bound: 1, overseer_round: 1, pass: 3 };
  assert.deepEqual([stop1.kind, stop1.why, stop1.layer, stop1.bound], ['layer_bound', 'revisions', 2, 1]);
  const add1 = defaultAdd(stop1, c1); assert.equal(add1, 1);
  assert.equal(continueClause(stopSentence(stop1, { runDir: 'runs/x' })), `layer 2 gets ${add1} more revision in this overseer round; ${TAIL}`, 'one revision is singular');
});

/** Drive advance() with layer-1 objections from a fresh overseer round until it stops; the stop gets the two fields chain.js adds (overseer_round, pass). */
const layerOneStop = config => {
  let state = newRoundState();
  for (let pass = 1; pass <= 20; pass++) {
    const step = advance(config, state, { outcome: 'layer_objected', layer: 1 });
    if (step.action === 'stop') { const { overseerRound, ...rest } = step.stop; return { ...rest, overseer_round: overseerRound, pass }; }
    state = step.state;
  }
  return assert.fail('layer 1 was meant to stop');
};

test('revision stop, SECOND stop of one layer in one overseer round (BUG-D-010): the sentence says what --continue adds (the chain\'s base bound), not the extended bound; without `add` the stop\'s own bound is read as before', () => {
  const base = chainOf([judge('x', 'swp', 'l1', 1), judge('o', 'swq', 'l2', 2), judge('o', 'swr', 'l3', 3)]);          // layer 1: base bound 2
  const first = layerOneStop(base);
  assert.deepEqual([first.kind, first.why, first.layer, first.bound, first.overseer_round], ['layer_bound', 'revisions', 1, 2, 1]);
  assert.equal(continueClause(stopSentence(first, { runDir: 'runs/x', add: defaultAdd(first, base) })), `layer 1 gets 2 more revisions in this overseer round; ${TAIL}`, 'a first stop reads the same with and without `add`');
  assert.equal(continueClause(stopSentence(first, { runDir: 'runs/x' })), `layer 1 gets 2 more revisions in this overseer round; ${TAIL}`);
  const entry = roundChoiceEntry(first, 'continue', base);
  assert.equal(entry.add, 2, '--continue records the chain\'s base bound');
  // the replay: the SAME base config (what defaultAdd reads) and the round's extended advance config (what advance() reads) are two different objects
  const extended = effectiveLimits(base, [entry]).advanceConfigAt(first.overseer_round);
  assert.equal(extended.layerRevisions[1], 4, 'the replay allows base + the recorded continue');
  const second = layerOneStop(extended);
  assert.deepEqual([second.kind, second.why, second.layer, second.bound, second.overseer_round], ['layer_bound', 'revisions', 1, 4, 1], 'the second stop carries the EXTENDED bound');
  assert.equal(defaultAdd(second, base), 2, 'a second --continue would add the base bound again');
  assert.equal(continueClause(stopSentence(second, { runDir: 'runs/x', add: defaultAdd(second, base) })), `layer 1 gets 2 more revisions in this overseer round; ${TAIL}`, 'the sentence names the amount --continue adds');
  assert.equal(continueClause(stopSentence(second, { runDir: 'runs/x' })), `layer 1 gets 4 more revisions in this overseer round; ${TAIL}`, 'a caller that passes no `add` gets the stop\'s own bound, unchanged');
  assert.equal(continueClause(stopSentence(second, { runDir: 'runs/x', add: 0 })), `layer 1 gets 4 more revisions in this overseer round; ${TAIL}`, 'an add that is not a positive whole number is ignored');
  assert.equal(continueClause(stopSentence({ kind: 'layer_bound' }, { runDir: 'runs/x', add: 2 })), `it extends the limit that was reached; ${TAIL}`, 'a stop without a layer still says it generally');
});

test('silent-seat stop: --continue gives the silent seat REASKS_NO_REVISE more passes in this overseer round (defaultAdd), not "more rounds"', async () => {
  const c = chainOf([judge('o', 'swj', 'l1', 1), judge('o', 'swk', 'l2', 2), { provider: 'mock', model: 'mock-unreadable', lab: 'l2b', layer: 2 }, judge('o', 'swl', 'l3', 3)], { maxOverseerRounds: 5 });
  const stop = await stopOf(c);
  assert.deepEqual([stop.kind, stop.why], ['layer_bound', 'unheard']);
  const add = defaultAdd(stop, c);
  const s = stopSentence(stop, { runDir: 'runs/x' });
  assert.equal(continueClause(s), `the silent seat gets ${add} more passes in this overseer round; ${TAIL}`);
  assert.doesNotMatch(s, OLD);
});

test('the real CLI: a run stopped at the overseer cap prints "one more overseer round" and --continue records add 1 (the words and the behaviour agree)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ovw-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'ovw.json'), JSON.stringify({ ...chainOf([judge('o', 'swm', 'l1', 1), judge('o', 'swn', 'l2', 2), judge('x', 'swo', 'l3', 3)], { maxOverseerRounds: 2 }), name: 'ovw' }));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    const first = run(['--chain', 'ovw', '--task', 'tasks/t.md']);
    assert.equal(first.status, 23, first.stdout + first.stderr);
    assert.match(first.stdout + first.stderr, /THE RUN STOPPED, NOT AGREED, and is waiting for your choice/);
    assert.ok((first.stdout + first.stderr).includes(`--continue (one more overseer round; ${TAIL}).`), first.stdout + first.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    run(['--resume', runDir, '--continue']);
    const entry = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')).roundChoices?.[0];
    assert.deepEqual([entry?.choice, entry?.kind, entry?.add], ['continue', 'overseer_cap', 1], 'the choice the words describe');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// CHANGED (0.8.4 S5 U-C1, A-DRAFT): the title said \"... name all three stops, and --continue \"extends the limit that was reached\"\"; the row now asserts four stops and what --continue does at each.
test('the tree member\'s tail and the sitting line name all four stops, and --continue says what it does (extends the limit that was reached, or counts the stalled objections afresh)', () => {
  const tail = memberStopContinue({ treeId: ROOT_ID, node: 'R/M1', generation: 1 }, 'round_stop');
  // CHANGED (0.8.4 S5 U-C1, A-DRAFT, C&C's grants H-S5-e / H-S5-e1): the member's sentence names the fourth stop (a stall that cannot be passed up) and says what --continue does there (a stall below the cap adds no round: it counts the stalled objections afresh). OLD: the three-stop sentence and 'it extends the limit that was reached, under its own grant'. The sentence is built from src/overseer-rounds.js roundStopsInWords(), shared with the sitting line below.
  assert.ok(tail.includes("It stopped at its overseer-round limit, at a layer's revision limit, because a seat of a layer stayed silent for too many passes in a row, because no seat of the top layer could read the final plan, or because an objection stood unchanged and could not be passed up, and is NOT agreed."), tail);
  assert.ok(tail.includes('to go on (it extends the limit that was reached, counts the stalled objections afresh, or has the top layer read the final plan once more when none of its seats could read it, under its own grant):'), tail);
  assert.doesNotMatch(tail, /more rounds/);
  const line = sittingLines({ status: 'awaiting_choice', started: [], node: 'R/M1', runId: 'r1' }, ROOT_ID).join('\n');
  // CHANGED (0.8.4 S5 U-C1, A-DRAFT, H-S5-e1): the sitting line names the fourth stop; OLD: "stopped at its overseer-round limit, at a layer's revision limit, or because a seat of a layer stayed silent for too many passes in a row, and is NOT agreed: it waits for YOUR choice."
  assert.ok(line.includes("stopped at its overseer-round limit, at a layer's revision limit, because a seat of a layer stayed silent for too many passes in a row, because no seat of the top layer could read the final plan, or because an objection stood unchanged and could not be passed up, and is NOT agreed: it waits for YOUR choice."), line);
});

/** R/M1 started (its claim's process is gone) and stopped at its overseer limit (the fixture of test/tree-member-choice.test.js). */
function stoppedMember(stop = { kind: 'overseer_cap', overseer_round: 7, pass: 3 }, file = 'STOPPED-overseer_cap.json') {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  const dir = syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  writeFileSync(join(dir, file), '{}');
  writeFileSync(join(dir, 'report-partial.json'), JSON.stringify({ stop }));
  return t;
}
test('the decide screen: `decide --continue-node` records the choice and says it extends the limit that was reached, not "with more rounds"', async () => {
  const t = stoppedMember();
  const io = terminal([], {}); io.stdin.end();
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { 'continue-node': 'R/M1' }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), facts: { pidAlive: () => false } });
  assert.equal(code, 0, io.shown() + io.errors());
  const printed = `${io.shown()}${io.errors()}`;
  // CHANGED (0.8.4 S5 U-C1, A-DRAFT, H-S5-e1): OLD "will continue (it extends the limit that was reached) when it is resumed"; a continue at a stall below the cap adds no round, so the word says both.
  assert.match(printed, /Recorded: R\/M1@g1 will continue \(it extends the limit that was reached, counts the stalled objections afresh, or has the top layer read the final plan once more when none of its seats could read it\) when it is resumed/);   // the word is the shared CONTINUE_WORDS
  assert.doesNotMatch(printed, /with more rounds/);
});

test('the usage text: --continue extends the limit that was reached and the run\'s spending limit still applies (no new limit is typed)', () => {
  const work = mkdtempSync(join(tmpdir(), 'ovw-help-'));
  const r = spawnSync(process.execPath, [cli, '--help'], { cwd: work, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: work }, timeout: 60_000 });
  rmSync(work, { recursive: true, force: true });
  const text = `${r.stdout}${r.stderr}`;
  const at = text.indexOf('council --resume <run folder> --continue | --finish');
  assert.ok(at >= 0, `the usage text is printed: ${text.slice(0, 200)}`);
  const block = text.slice(at, text.indexOf('council --resume <run folder> [--skip-seat]', at)).replace(/\s+/g, ' ');
  // CHANGED (0.8.4 S5 U-C1 fix-up, A-DRAFT, H-S5-c1): the usage entry is built from the shared maps (roundStopsInWords, CONTINUE_WORDS). OLD: "answers a run that stopped at an overseer limit (exit 23): --continue goes on (it extends the limit that was reached; the run's spending limit still applies), --finish ends it here, NOT agreed (the dispute stage and the handoff run)".
  assert.ok(block.includes("answers a run that stopped at its overseer-round limit, at a layer's revision limit, because a seat of a layer stayed silent for too many passes in a row, because no seat of the top layer could read the final plan, or because an objection stood unchanged and could not be passed up (exit 23): --continue goes on (it extends the limit that was reached, counts the stalled objections afresh, or has the top layer read the final plan once more when none of its seats could read it; the run's spending limit still applies), --finish ends it here, NOT agreed (the dispute stage and the handoff run)"), block);
  assert.doesNotMatch(block, /you type a new spending limit/);
});

// ---- 0.8.4 S5 U-C1 fix-up (C&C's rule: at a stall --continue is offered while a pass is left; his phrase only where true). A-DRAFT words; each row says what it uses.
const STALL = (extra = {}) => ({ kind: 'stall_stop', why: 'top_layer', top_layer: 3, stalled: [{ id: 'O-aaaaaaaa', lab: 'x', layer: 3, passes: [1, 2] }], pass: 2, overseer_round: 0, pass_left: true, ...extra });
test('FU-4 the member sentence: with a pass left it names the true continue clause and his phrase; with none it leaves the "to go on" paragraph out; a kind-only stop says neither; a handler_not_yet stop has no phrase', () => {
  const m = { treeId: ROOT_ID, node: 'R/M1', generation: 1 };
  const left = memberStopContinue({ ...m, stop: STALL() }, 'round_stop');
  assert.ok(left.includes('to go on (it counts the stalled objections afresh, under its own grant):'), left);
  assert.ok(left.includes('the result stays "not agreed", and layer 3 did not sign off on this plan)'), left);
  const none = memberStopContinue({ ...m, stop: STALL({ pass_left: false }) }, 'round_stop');
  assert.doesNotMatch(none, /to go on/); assert.ok(none.includes('No pass is left, so it cannot go on. Your choice goes through the tree: to end it here ('), none);
  assert.ok(none.includes('did not sign off on this plan'), none);
  const kindOnly = memberStopContinue({ ...m, stop: { kind: 'overseer_cap' } }, 'round_stop');
  assert.ok(kindOnly.includes('to go on (it extends the limit that was reached, counts the stalled objections afresh, or has the top layer read the final plan once more when none of its seats could read it, under its own grant):'), kindOnly); assert.doesNotMatch(kindOnly, /did not sign off/);
  const notYet = memberStopContinue({ ...m, stop: { kind: 'overseer_cap', overseer_round: 3, pass: 3, handler_not_yet: true } }, 'round_stop');
  assert.ok(notYet.includes('to go on (it extends the limit that was reached, under its own grant):'), notYet); assert.doesNotMatch(notYet, /did not sign off/);
  assert.ok(memberStopContinue(m, 'round_stop').includes('to go on (it extends the limit that was reached, counts the stalled objections afresh, or has the top layer read the final plan once more when none of its seats could read it, under its own grant):'), 'no stop: the shared words');
});
test('FU-5 the tree refuses `decide --continue-node` at a stall with no pass left (nothing written) and offers the way out; --finish-node is accepted there; with a pass left --continue-node is accepted', async () => {
  const deciding = async (t, flags) => { const io = terminal([], {}); io.stdin.end(); const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), facts: { pidAlive: () => false } }); return { code, printed: `${io.shown()}${io.errors()}` }; };
  const none = await deciding(stoppedMember(STALL({ pass_left: false }), 'STOPPED-stall_stop.json'), { 'continue-node': 'R/M1' });
  assert.equal(none.code, 1, none.printed); assert.match(none.printed, /stopped at a stall and no pass is left, so it cannot go on; to give the node up use/); assert.match(none.printed, /Nothing was written/);
  const fin = await deciding(stoppedMember(STALL({ pass_left: false }), 'STOPPED-stall_stop.json'), { 'finish-node': 'R/M1' });
  assert.equal(fin.code, 0, fin.printed);
  const left = await deciding(stoppedMember(STALL(), 'STOPPED-stall_stop.json'), { 'continue-node': 'R/M1' });
  assert.equal(left.code, 0, left.printed);
});
