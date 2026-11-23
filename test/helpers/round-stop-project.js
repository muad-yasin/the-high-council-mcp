// A project whose mock layered chain stops at the overseer-round cap (exit 23, the top layer always objects), for the tests of the round-stop choice (0.8.4 D5a: stop_decide and the entry site of --continue / --finish). $0, offline.
// The same fixture test/overseer-choice.test.js uses, kept here for the new tests; the CLI makes the real stop.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const cli = join(root, 'src', 'cli.js');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chainOf = (critics, rounds = 2) => ({
  name: 'ovc', signoff: 'unanimous', maxOverseerRounds: rounds, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
});

/** Makes the project, runs the chain to its stop, and returns { dir, runDir, id, run(args), runJson(), done() }. */
export function stoppedProject(tag = 'c', { rounds = 2 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'round-stop-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ovc.json'), JSON.stringify(chainOf([judge('o', `${tag}a`, 'l1', 1), judge('o', `${tag}b`, 'l2', 2), judge('x', `${tag}c`, 'l3', 3)], rounds)));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', 'ovc', '--task', 'tasks/t.md']);
  if (first.status !== 23) throw new Error(`the mock chain was meant to stop at exit 23, got ${first.status}: ${first.stdout}${first.stderr}`);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  return { dir, runDir, id, run, runJson: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), stoppedFiles: () => readdirSync(runDir).filter(f => /^STOPPED-/.test(f)), done: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * A project whose mock layered chain stops at a STALL (0.8.4 S5, kind `stall_stop`, exit 23): the top layer's repeated objection cannot be passed up. The chain is the one of test/stall-stop.test.js (TS-9a/TS-9b): with `maxRounds` 2 no pass is left
 * (the stop offers --finish only), with 6 a pass is left (--continue and --finish). The CLI makes the real stop; the run has no overseer rounds, so the stop's overseer_round is 0. Same return shape as stoppedProject.
 */
export function stallProject(tag = 's', { maxRounds = 2 } = {}) {
  const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
  const config = { name: 'ss', maxRounds, signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
      critics: [seat('mock-exch-support-keep-clean', `${tag}1`, 1), seat('mock-exch-support-keep-clean', `${tag}2`, 2), seat('mock-exch-support-keep-always', `${tag}3`, 3)] } };
  const dir = mkdtempSync(join(tmpdir(), 'stall-stop-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'ss.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const first = run(['--chain', 'ss', '--task', 'tasks/t.md']);
  if (first.status !== 23) throw new Error(`the mock chain was meant to stall-stop at exit 23, got ${first.status}: ${first.stdout}${first.stderr}`);
  const id = readdirSync(join(dir, 'runs'))[0];
  const runDir = join(dir, 'runs', id);
  return { dir, runDir, id, run, runJson: () => JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')), stoppedFiles: () => readdirSync(runDir).filter(f => /^STOPPED-/.test(f)), done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Waits (bounded) until a detached resume has let go of the run folder, so nothing writes into it while a test removes it. */
export async function untilRunIdle(runDir, ms = 20_000) {
  for (let waited = 0; existsSync(join(runDir, '.council.lock')) && waited < ms; waited += 100) await new Promise(r => setTimeout(r, 100));
}
