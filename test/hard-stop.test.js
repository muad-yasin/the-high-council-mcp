// 0.8.4 S4 (M1), C&C's in-unit items (3) and (1): the HARD STOP at seven used overseer rounds (RU-S4-35, RU-ADD-A10; T15j, T15l), the sentence of a stop the handler's not_yet reached, and the escalated sign-off block of an agreed run.
// Offline, $0. The words are A-DRAFT (WORDING rows). Not built here: the MCP quote and stop_decide path of A's #26 (that unit adds its own refusal of finish and of the session's own choice at a hard stop).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as OR from '../src/overseer-rounds.js';   // a namespace import: on a tree without the new exports each row fails by assertion and the file still loads
const { stopSentence } = OR;
const isHardStop = (...a) => OR.isHardStop(...a);
import { escalatedSignoffBlock } from '../src/escalation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cap = (rounds, extra = {}) => ({ kind: 'overseer_cap', rounds, cap: rounds, pass: rounds, overseer_round: rounds, ...extra });

// CHANGED (0.8.4 S5 U-C1 fix-up, Muad's word of 05 Nov 2026, "1: a"; amends RU-S4-35 / RU-ADD-A10): TODAY'S HEADING was "at seven used overseer rounds the stop sentence offers --continue and revising outside the Council, and NO --finish". The hard stop stays distinct (its own line: only you decide here), but --finish is OFFERED there, with the line that the top layer did not sign off on this plan, and "the run cannot be finished as it stands" is gone.
test('T15j (pure): at seven used overseer rounds the stop sentence offers --continue, --finish (with the line that the top layer did not sign off) and revising outside the Council; below seven it offers --continue and --finish as before', () => {
  assert.equal(OR.HARD_STOP_ROUNDS, 7);
  const hard = stopSentence(cap(7), { runDir: '/r' });
  assert.match(hard, /--continue/); assert.match(hard, /revise it yourself outside the Council/);
  assert.match(hard, /--finish \(the dispute stage and the handoff run, the open objections are handed over, the result stays "not agreed", and the top layer did not sign off on this plan\)/);
  assert.doesNotMatch(hard, /cannot be finished as it stands/);
  const soft = stopSentence(cap(3), { runDir: '/r' });
  assert.match(soft, /--finish/, 'below seven the chain\'s own cap rule holds: finish is offered');
  assert.deepEqual([isHardStop(cap(7)), isHardStop(cap(6)), isHardStop(cap(8)), isHardStop({ kind: 'layer_bound', why: 'revisions', rounds: 7 }), isHardStop(null)], [true, false, true, false, false]);
});
test('T15l (pure): the hard stop is the person\'s: the sentence says only the person decides; a stop a layer-bound reached at any round is never a hard stop', () => {
  assert.match(stopSentence(cap(7), { runDir: '/r' }), /only you decide here/);
  assert.doesNotMatch(stopSentence({ kind: 'layer_bound', why: 'revisions', layer: 1, used: 1, bound: 1, pass: 3, overseer_round: 7 }, { runDir: '/r' }), /hard stop/);
});
test('a stop the handler\'s not_yet reached says so (the cause of the overseer_cap stop); the figures are read from the stop, never printed as undefined', () => {
  assert.match(stopSentence(cap(3, { handler_not_yet: true }), { runDir: '/r' }), /all 3 overseer rounds were used and the handler still said not yet to the plan the top layer signed/);
  assert.match(stopSentence({ kind: 'overseer_cap', handler_not_yet: true }, { runDir: '/r' }), /all its allowed overseer rounds were used and the handler still said not yet/);
  assert.doesNotMatch(stopSentence({ kind: 'overseer_cap', handler_not_yet: true }, { runDir: '/r' }), /undefined|null/);
  assert.match(stopSentence(cap(3), { runDir: '/r' }), /the top layer still objected/, 'without the flag the sentence is what it was');
});
test('(1): an escalated sign-off block says "not consensus of the whole panel; the handler then checked the build and the run ends agreed" when the run ended agreed, and "This is not consensus." otherwise', () => {
  const end = { pass: 3, layer: 3, below: [1] };
  const esc = [{ round: 2, pass: 3, from_layer: 1, to_layer: 2, trigger: 'stall', ids: ['O-aaaaaaaa'], labs: ['a'], rulings: [], outcome: [] }];
  const plain = escalatedSignoffBlock({ end, escalations: esc, replies: [], signoff: [] });
  const agreed = escalatedSignoffBlock({ end, escalations: esc, replies: [], signoff: [], agreed: true });
  assert.match(plain, /This is not consensus\. The judges who raised/);
  assert.match(agreed, /This is not consensus of the whole panel: the handler then checked the build and the run ends agreed\./);
  assert.doesNotMatch(agreed, /This is not consensus\. The judges/);
});

// ---- the real verbs: a run stopped at seven overseer rounds, then --finish and --continue ----
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
// CHANGED (0.8.4 S5 U-C1 fix-up, Muad's word of 05 Nov 2026): TODAY'S HEADING was "... stops at the hard stop (exit 23, no --finish in the sentence); --finish is refused (exit 2, nothing recorded); --continue is accepted". --finish is now accepted and ends the run, so the two choices are taken in TWO run folders.
test('REAL VERBS: a layered run whose top layer objects in all seven overseer rounds stops at the hard stop (exit 23, --finish IS in the sentence with the line that the top layer did not sign off); --finish is accepted and ends the run not agreed; in a second folder --continue is accepted', () => {
  const config = { name: 'hs', maxOverseerRounds: 7, layerRevisions: { 1: 1, 2: 1 }, signoff: 'unanimous', answer_back: { enabled: true }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seat('mock-exch-support-keep-clean', 'e1', 1), seat('mock-exch-support-keep-clean', 'e2', 2), seat('mock-exch-support-keep-always', 'e3', 3)] } };
  const folder = () => {
    const dir = mkdtempSync(join(tmpdir(), 'hs-cli-'));
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    writeFileSync(join(dir, 'chains', 'hs.json'), JSON.stringify(config)); writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    const first = run(['--chain', 'hs', '--task', 'tasks/t.md']);
    assert.equal(first.status, 23, first.stdout + first.stderr);
    return { run, first, runDir: join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]) };
  };
  // folder 1: the stop, and --finish
  const a = folder();
  const partial = JSON.parse(readFileSync(join(a.runDir, 'report-partial.json'), 'utf8'));
  assert.deepEqual([partial.stop.kind, partial.stop.rounds], ['overseer_cap', 7], 'the premise: the 7th used overseer round');
  const said = a.first.stderr + a.first.stdout;
  assert.match(said, /hard stop after 7 overseer rounds/); assert.match(said, /--finish \(the dispute stage/); assert.match(said, /and the top layer did not sign off on this plan\)/);
  const fin = a.run(['--resume', a.runDir, '--finish']);
  assert.notEqual(fin.status, 2, 'finish is accepted at the hard stop: ' + fin.stdout + fin.stderr);
  const finished = JSON.parse(readFileSync(join(a.runDir, 'report.json'), 'utf8'));   // the fixture has no `dispute` key, so the record of the finish is the kept stop
  assert.deepEqual([finished.stop.kind, finished.stop.chosen], ['overseer_cap', 'finish']);
  assert.equal((JSON.parse(readFileSync(join(a.runDir, 'run.json'), 'utf8')).roundChoices ?? []).some(c => c.choice === 'finish'), true, 'the choice is recorded');
  // folder 2: --continue
  const b = folder();
  const cont = b.run(['--resume', b.runDir, '--continue']);
  assert.notEqual(cont.status, 2, 'continue is not refused: ' + cont.stdout + cont.stderr);
});
