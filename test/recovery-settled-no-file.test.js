// 0.8.4 item 9a (money path; Sol's recovery accounting, row 2 of SuperHelper's trace): a call whose `settled` line is in spend-reservations.jsonl but whose usage file never got written (the process ended between the settle
// line and the file) was paid for and is in no file. `--spend` and the reports count it (src/counted-spend.js, `settledWithoutFileOf`) and the MAIN `--resume` seeds the live limit with it, so a resume cannot spend past the limit
// by that call. `--rematch` and `--replay` (`armSideRun`) did not: their live count started without it, so a sitting could finish above the limit the person typed while the report and `--spend` said otherwise.
// Real verbs on the all-mock chain `mock-budget` (fixture price $1000 per million tokens, no key, no network, $0). The settled line is SYNTHETIC (a call the crash cost, written by hand into the side folder's own
// reservation file: a crash inside the write window is the only way to make one, and it is not reproducible on demand); it has the shape `settle` writes and no usage file. Every figure the checks compare is READ from
// a run's own STOPPED-budget.json (the figure the limit counted at the stop), never typed, because fixture figures move with the prompt wording.
//   RED on the unchanged tip: the three "stops where the main resume stops" tests (rematch, replay, tree member): each finished with exit 0 and a report.
//   PIN (they pass on the old source too, by design): the main resume's own figure (the reference the side runs now match), the control that a call with a settled line AND its usage file counts once, the finished-folder control.
//   The last test drives a tree member's sitting (the root node run as a member on mock-budget, resumed after a person accepted the accounting gate's problem): the member block of src/cli.js re-arms the counters (setBudget), so it seeds the record again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from '../src/api.js';
import { settledWithoutFileOf } from '../src/counted-spend.js';
import { runSpentUsd } from '../src/spend.js';
import { acceptAccounting, gateTree } from '../src/tree-budget.js';
import { registerRoot } from '../src/tree-register.js';
import { GATE_FIELDS, ROOT_ID, lineageFile, newTree, reservedLine, settledLine, writeLines } from './helpers/tree-fixture.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: got ${a}, expected ${b}`);
const RECORD_USD = 100;          // the call the crash cost: far above anything the chain spends, so "counted" and "not counted" cannot be mistaken
const LIMIT_USD = 100.01;        // just above the record: the record alone is under it, the record plus the stage already on disk is over it
const EXIT_BUDGET = 4;
const LABEL = 'synthetic-paid-no-file';

/** A working folder with a task and one FINISHED original run of mock-budget (no ceiling). */
function original() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-recovery-nofile-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'Plan a retry limit for an HTTP client.');
  const r = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/smoke.md', '--max-usd', 'none']);
  assert.equal(r.status, 0, `fixture run failed: ${r.stdout.slice(-300)}${r.stderr.slice(-300)}`);
  const runId = readdirSync(join(dir, 'runs'))[0];
  return { dir, runId, runDir: join(dir, 'runs', runId) };
}
/** The side verbs: the argv that makes (and, typed again, continues) the same side folder, and the folder it writes. */
const SIDES = {
  rematch: o => ({ args: ['--rematch', join('runs', o.runId), '--rematch-seed', '1'], side: `${o.runDir}.rematch-1` }),
  replay: o => ({ args: ['--replay', join('runs', o.runId), '--replay-date', '2026-09-23'], side: `${o.runDir}.replay-2026-09-23` }),
};
const stopOf = side => JSON.parse(readFileSync(join(side, 'STOPPED-budget.json'), 'utf8'));
const lines = side => readFileSync(join(side, 'spend-reservations.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
/** SYNTHETIC: a call the crash cost: a `reserved` and a `settled` line of one fresh id, the settle recorded, no usage file for it (what `settle` leaves when the process ends before the file is written). */
function addSettledNoFile(side, usd) {
  const id = `r${1 + Math.max(0, ...lines(side).map(l => Number(String(l.id).slice(1))).filter(Number.isFinite))}`;
  const at = new Date().toISOString();
  appendFileSync(join(side, 'spend-reservations.jsonl'), `${JSON.stringify({ schema: 'spend-reservations/1', event: 'reserved', id, label: LABEL, seat: 'mock/mock-priced', usd, at })}\n${JSON.stringify({ schema: 'spend-reservations/1', event: 'settled', id, outcome: 'recorded', usd, at })}\n`);
  assert.deepEqual(settledWithoutFileOf(side), [{ label: LABEL, usd }], 'the fixture is the state under test: exactly one settled call with no usage file, and the criteria call (line AND file) is not one');
}
/** A side run stopped at its first sitting's ceiling ($1: it ends after the stage that fits); returns what that sitting counted. */
function stoppedSide(kind) {
  const o = original(); const s = SIDES[kind](o);
  const first = run(o.dir, [...s.args, '--max-usd', '1']);
  assert.equal(first.status, EXIT_BUDGET, `the first sitting must stop at its $1 ceiling: ${first.stdout.slice(-300)}`);
  const spent = stopOf(s.side).spentUsd;
  assert.ok(spent > 0 && spent < 1, `the first sitting paid for the stage it could afford (${spent})`);
  return { ...o, ...s, firstSpent: spent };
}

for (const kind of ['rematch', 'replay']) {
  test(`--${kind} stops where the main resume stops on a settled call with no usage file: the limit counts the call the crash cost, before any new call (RED: the old source finished it, exit 0, a report)`, () => {
    const c = stoppedSide(kind);
    addSettledNoFile(c.side, RECORD_USD);
    const reservedBefore = lines(c.side).filter(l => l.event === 'reserved').length;
    const r = run(c.dir, [...c.args, '--max-usd', String(LIMIT_USD)]);
    assert.equal(r.status, EXIT_BUDGET, `the sitting must stop at the typed limit ($${LIMIT_USD}), got exit ${r.status}: ${r.stdout.slice(-400)}`);
    assert.ok(!existsSync(join(c.side, 'report.json')), 'a stopped sitting must not look finished');
    assert.equal(lines(c.side).filter(l => l.event === 'reserved').length, reservedBefore, 'it stopped BEFORE another call: no new reservation was written');
    // the figure the limit counted at the stop = the call the crash cost + the stage the first sitting paid for (replayed from its file, counted at the replay): each ONCE
    const stop = stopOf(c.side);
    near(stop.spentUsd, RECORD_USD + c.firstSpent, 'what the limit counted');
    assert.equal(stop.capUsd, LIMIT_USD);
    near(runSpentUsd(c.side), stop.spentUsd, 'the live count and what --spend reads for the folder agree (the record is in neither twice)');
  });
}

test('PIN, the reference: the MAIN --resume counts the same record the same way (the figure the side runs now match; the old source passes this too)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-recovery-nofile-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'smoke.md'), 'Plan a retry limit for an HTTP client.');
  const first = run(dir, ['--chain', 'mock-budget', '--task', 'tasks/smoke.md', '--max-usd', '1']);
  assert.equal(first.status, EXIT_BUDGET, first.stdout.slice(-300));
  const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const firstSpent = stopOf(runDir).spentUsd;
  addSettledNoFile(runDir, RECORD_USD);
  const r = run(dir, ['--resume', runDir, '--max-usd', String(LIMIT_USD)]);
  assert.equal(r.status, EXIT_BUDGET, `the main resume stops at the typed limit: ${r.stdout.slice(-400)}`);
  near(stopOf(runDir).spentUsd, RECORD_USD + firstSpent, 'what the main resume counted');
});

for (const kind of ['rematch', 'replay']) {
  test(`PIN, counted once (control): with NO such record, a second --${kind} sitting counts the stage that has BOTH a settled line and its usage file once, not twice (the old source passes this too)`, () => {
    const c = stoppedSide(kind);
    assert.deepEqual(settledWithoutFileOf(c.side), [], 'the stage has a usage file carrying its reservation id: it is not a call with no file');
    const r = run(c.dir, [...c.args, '--max-usd', '1']);
    assert.equal(r.status, EXIT_BUDGET, r.stdout.slice(-300));
    near(stopOf(c.side).spentUsd, c.firstSpent, 'the second sitting counted the stage once');
  });

  test(`PIN, no phantom record (control): a --${kind} that ran to the end leaves no settled call without a usage file, so the seed adds nothing on any later sitting (the old source passes this too)`, () => {
    const o = original(); const s = SIDES[kind](o);
    const r = run(o.dir, [...s.args, '--max-usd', 'none']);
    assert.equal(r.status, 0, r.stdout.slice(-300));
    assert.ok(existsSync(join(s.side, 'report.json')));
    assert.ok(lines(s.side).some(l => l.event === 'settled'), 'the folder holds settled calls (the control is not empty)');
    assert.deepEqual(settledWithoutFileOf(s.side), [], 'every settled call of a finished side run has its usage file');
  });
}

test('a tree member\'s sitting stops where the main resume stops too: the root node, stopped at its cap, then a settled call with no usage file (SYNTHETIC, mirrored in the tree record as a member writes it), the accounting problem accepted by a person, then the resume (RED: the old source finished it, exit 0)', { timeout: 80_000 }, async () => {
  const t = newTree({ cap: 100, rootChain: 'mock-budget' }); registerRoot(t.rootDir);
  const first = await api.run({ chain: 'mock-budget', task: 'tasks/x.md', cwd: t.work, runId: ROOT_ID, treeNode: lineageFile(t.work, 'R'), maxUsd: 1 });
  assert.equal(first.exitCode, EXIT_BUDGET, first.outputTail);
  const runDir = join(t.runsDir, ROOT_ID);
  const firstSpent = stopOf(runDir).spentUsd;
  const id = `r${1 + Math.max(...lines(runDir).map(l => Number(String(l.id).slice(1))).filter(Number.isFinite))}`;
  const MEMBER_RECORD_USD = 30;   // under the tree's $100 for this node, so the node still has room: only the typed limit below can stop it
  writeLines(t, ROOT_ID, 'R', [{ ...reservedLine(id, MEMBER_RECORD_USD, LABEL), seat: 'mock/mock-priced' }, settledLine(id, 'recorded', MEMBER_RECORD_USD)]);
  assert.deepEqual(settledWithoutFileOf(runDir), [{ label: LABEL, usd: MEMBER_RECORD_USD }], 'the fixture: one settled call with no usage file');
  // the tree's accounting gate fails closed on exactly that state until a person accepts it (the state is reachable only that way); the acceptance records the problem, it changes no figure
  const g = gateTree(t.rootDir);
  assert.deepEqual(g.problems.map(p => p.code), ['settlement_without_evidence'], 'the gate names the one call, and nothing else');
  acceptAccounting(t.rootDir, { keys: [`${ROOT_ID}:${id}`], ...GATE_FIELDS });
  const reservedBefore = lines(runDir).filter(l => l.event === 'reserved').length;
  const second = await api.resume({ runDir, cwd: t.work, maxUsd: MEMBER_RECORD_USD + 0.01 });
  assert.equal(second.exitCode, EXIT_BUDGET, `the member sitting must stop at its typed limit, got ${second.exitCode}: ${second.outputTail}`);
  assert.equal(lines(runDir).filter(l => l.event === 'reserved').length, reservedBefore, 'it stopped BEFORE another call');
  near(stopOf(runDir).spentUsd, MEMBER_RECORD_USD + firstSpent, 'what the member sitting counted: the record once, the stage on disk once');
});
