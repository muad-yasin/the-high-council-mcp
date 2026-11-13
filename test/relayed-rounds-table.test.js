// 0.8.4 (the ladder unit, relayed accept commit; C&C 10 Nov, "typed = relayed" for the number): ONE table, keyed by stop kind. At every stop where the command line takes a typed `--continue --rounds N`, a relayed continue with rounds N ends in the SAME run state:
// the same saved limit (run.json ladderRounds), the same next stop, and a reply that names only the limit run.json holds (none off the ladder, where the number changes nothing and the run prints that it was not used). A number the terminal would
// refuse (not above the reads made) is refused BEFORE the ledger line is written, with the count, and the run is left as it was. Offline, $0. WRITTEN WITHOUT A RUN (no tests on the laptop): the first run on the box decides; the stall fixture is a
// PREDICTION (a ladder chain whose top layer holds one objection stops at a stall; a ladder chain with an unreadable layer-2 seat stops at layer_bound; an old-key cap stop with the chain edited to the ladder key is resumed as a ladder): a red premise assert there is a wrong prediction, not a defect.
// RR-2 (the refused number) is registered for the ladder kinds only: off the ladder there is no count to be above, and RR-1 shows the number changes nothing there.
// Kind not in the table, with the reason: the final-read stop has no command-line fixture (it is reached only in-process, test/finish-now.test.js atFinalReadStop); it takes the same two code paths as every row (applyTypedRounds in src/cli.js for both entry
// points, and the tool's reads check, which is kind-blind). The silent-seat row and the adopted-at-resume row are PREDICTIONS like the stall row.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEDGER_FILE } from '../src/gate-ledger.js';
import { stoppedProject, untilRunIdle } from './helpers/round-stop-project.js';
import { session } from './helpers/mcp-stdio-session.js';
import * as LR from '../src/ladder-resume.js';
import * as OR from '../src/overseer-rounds.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projects = [];
afterEach(() => { while (projects.length) projects.pop().done(); });
const WORDS = 'Go on; the limit is mine to set.';

const ladderCritics = (id, pattern3 = 'x') => [1, 2, 3].map(l => ({ provider: 'mock', model: l === 3 ? `mock-critic-script-${pattern3}-${id}${l}` : `mock-critic-script-x-${id}${l}`, lab: `l${l}`, layer: l }));
const base = id => ({ name: 'lad', signoff: 'unanimous', ladder: { block: 1, visits: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: ladderCritics(id) } });
const stallChain = id => ({ ...base(id), maxRounds: 12, answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 },
  seats: { ...base(id).seats, critics: [{ provider: 'mock', model: 'mock-exch-support-keep-clean', lab: `${id}1`, layer: 1 }, { provider: 'mock', model: 'mock-exch-support-keep-clean', lab: `${id}2`, layer: 2 }, { provider: 'mock', model: 'mock-exch-support-keep-always', lab: `${id}3`, layer: 3 }] } });

function project(config, firstArgs) {
  const dir = mkdtempSync(join(tmpdir(), 'rr-table-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', `${config.name}.json`), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', config.name, '--task', 'tasks/t.md', ...firstArgs]);
  if (first.status !== 23) throw new Error(`the fixture was meant to stop at exit 23, got ${first.status}: ${first.stdout}${first.stderr}`);
  const id = readdirSync(join(dir, 'runs'))[0]; const runDir = join(dir, 'runs', id);
  const p = { dir, runDir, id, run, config, runJson: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), partial: () => JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop, done: () => rmSync(dir, { recursive: true, force: true }) };
  projects.push(p);
  return p;
}
const ledgerLines = p => (existsSync(join(p.runDir, LEDGER_FILE)) ? readFileSync(join(p.runDir, LEDGER_FILE), 'utf8').split('\n').filter(Boolean).length : 0);
const call = (p, args) => session(p.dir, [{ name: 'stop_decide', arguments: { run: p.id, ...args } }]).then(a => a[0]);
const shape = s => ({ kind: s.kind, rounds: s.rounds, cap: s.cap, pass: s.pass, overseer_round: s.overseer_round });

const silentChain = id => ({ ...base(id), maxRounds: 12, seats: { ...base(id).seats, critics: [{ provider: 'mock', model: `mock-critic-script-o-${id}1`, lab: `${id}1`, layer: 1 }, { provider: 'mock', model: 'mock-unreadable', lab: `${id}2`, layer: 2 }, { provider: 'mock', model: `mock-critic-script-x-${id}3`, lab: `${id}3`, layer: 3 }] } });
/** An old-key run (overseer rounds, no ladder key) stopped at its cap, whose chain file is then edited to the ladder key, as test/ladder-resume.test.js R-1 does: the stop was raised before the ladder was adopted. */
function adoptedAtResume(tag) {
  const p = stoppedProject(tag); projects.push(p);
  const file = join(p.dir, 'chains', 'ovc.json'); const old = JSON.parse(readFileSync(file, 'utf8'));
  const { maxOverseerRounds, layerRevisions, ...rest } = old;
  p.config = { ...rest, ladder: { block: 1, visits: 1 } };
  writeFileSync(file, JSON.stringify(p.config));
  return p;
}
const KINDS = [
  { name: 'ladder typed-limit cap', ladder: true, make: id => project(base(id), ['--rounds', '2']), kind: 'overseer_cap' },
  { name: 'ladder stall', ladder: true, make: id => project(stallChain(id), []), kind: 'stall_stop' },
  { name: 'ladder layer_bound (a silent seat)', ladder: true, make: id => project(silentChain(id), []), kind: 'layer_bound' },
  { name: 'a stop raised before the ladder was adopted at a resume', ladder: true, make: id => adoptedAtResume(id), kind: 'overseer_cap' },
  { name: 'off-ladder cap on a chain with no ladder key', ladder: false, make: id => { const p = stoppedProject(id); projects.push(p); return p; }, kind: 'overseer_cap' },
];

for (const K of KINDS) {
  test(`RR-1 (${K.name}): a relayed continue with rounds N ends in the same run state as the typed --continue --rounds N: the same saved limit, the same next stop, and a reply that names only the limit run.json holds`, async () => {
    const typed = K.make('rrt'); const rel = K.make('rrr');
    const partialOf = p => JSON.parse(readFileSync(join(p.runDir, 'report-partial.json'), 'utf8')).stop;
    assert.equal(partialOf(typed).kind, K.kind, 'the premise: the stop the command raised');
    const made = K.ladder ? LR.topLayerReadsMade(rel.runDir, rel.config) : null;
    const N = K.ladder ? made + 2 : 5;
    const typedRun = typed.run(['--resume', typed.runDir, '--continue', '--rounds', String(N)]);
    assert.notEqual(typedRun.status, 2, typedRun.stdout + typedRun.stderr);
    const q = await call(rel, { step: 'quote' });
    const r = await call(rel, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS, rounds: N });
    assert.equal(r.error, undefined, JSON.stringify(r).slice(0, 400));
    await untilRunIdle(rel.runDir, 180_000);
    const savedT = typed.runJson().ladderRounds; const savedR = rel.runJson().ladderRounds;
    assert.equal(savedR, savedT, 'the same saved limit');
    if (K.ladder) assert.equal(savedR, N, 'the limit is the number');
    assert.deepEqual(shape(partialOf(rel)), shape(partialOf(typed)), 'the same next stop');
    assert.equal(r.recorded.rounds, K.ladder ? savedR : undefined, 'the reply names only the limit run.json holds (none off the ladder)');
  });

  if (K.ladder) test(`RR-2 (${K.name}, refused number): a number the terminal would refuse (not above the reads made) is refused before the ledger line is written, with the count; the typed command refuses it too and the run is left as it was`, async () => {
    const typed = K.make('rrx'); const rel = K.make('rry');
    const made = LR.topLayerReadsMade(rel.runDir, rel.config);
    const q = await call(rel, { step: 'quote' });
    const lines = ledgerLines(rel); const before = JSON.stringify(rel.runJson());
    const r = await call(rel, { step: 'answer', gate: q.gate, shown: q.shown, choice: 'continue', person_words: WORDS, rounds: made });
    assert.match(r.error, new RegExp(`this run has already made ${made} top-layer read`), JSON.stringify(r).slice(0, 300));
    assert.equal(r.recorded, undefined);
    assert.equal(ledgerLines(rel), lines, 'nothing on the ledger');
    assert.equal(JSON.stringify(rel.runJson()), before, 'the run is as it was');
    const t = typed.run(['--resume', typed.runDir, '--continue', '--rounds', String(made)]);
    assert.equal(t.status, 2, t.stdout + t.stderr);
    // with no read made (made 0: the silent-seat row never asks layer 3) the terminal refuses `--rounds 0` earlier, at its parse; the count sentence is the terminal's only from one read on
    if (made >= 1) assert.match(t.stderr, new RegExp(`this run has already made ${made} top-layer read`));
  });
}

test('RR-3 (pure): the tool\'s check and the gate\'s use ONE sentence and ONE rule (limitReachable, roundsUnreachableSentence); the sentence carries the count and asks for a number above it', () => {
  assert.equal(OR.limitReachable(5, 4), true); assert.equal(OR.limitReachable(4, 4), false); assert.equal(OR.limitReachable(4.5, 4), false);
  assert.equal(OR.roundsUnreachableSentence(3, 3), 'rounds 3: this run has already made 3 top-layer reads, so 3 is not a limit it can still reach. Give a whole number above 3, or no number. Nothing was recorded.');
  assert.match(OR.roundsUnreachableSentence(1, 1), /already made 1 top-layer read, so/);
});
