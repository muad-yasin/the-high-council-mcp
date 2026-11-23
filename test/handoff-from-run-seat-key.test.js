// `council handoff --from-run` and the seat key (0.8.4 seats unit; C&C's obligation after the same-layer follow-up): the HANDOFF.md of an early-finished run names the builder tasks by the shown name (the lab plus the note), never by the internal seat key.
// The command registers the seat keys from the run's chain config before it prints (src/cli.js). A twin run: layer 1 seats the same model twice; the report's open objection names the second twin by its key. An old run with no twins: the chain has no repeated model and the
// command prints exactly what it printed before (registering never throws there). Offline: the chain is the shipped mock-layered chain with a mock handoff seat, $0 (nothing here is a paid chain).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src/cli.js');
const RUN = '2026-09-29T09-00-00-000Z';
const BUILD = '# Plan\n\n## Decisions\n\nWe use SQLite.\n';
const run = (cwd, args) => spawnSync(process.execPath, [cli, 'handoff', ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: cwd }, timeout: 90_000 });

// a workspace holding one early-finished run of the chain `name`; `twin` seats the first layer-1 model a second time on layer 1
function workspace({ twin }) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-hskey-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'runs', RUN), { recursive: true });
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small reading list app.\n');
  const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-layered.json'), 'utf8'));
  const critics = cfg.seats.critics.map(c => ({ ...c }));
  if (twin) critics.splice(1, 0, { ...critics[0] });   // [a, a, b, ...]: the same provider, model and lab twice on layer 1
  writeFileSync(join(dir, 'chains', 'hs.json'), JSON.stringify({ ...cfg, name: 'hs', seats: { ...cfg.seats, handoff: { provider: 'mock', model: 'mock-builder' }, critics } }));
  writeFileSync(join(dir, 'runs', RUN, 'run.json'), JSON.stringify({ chain: 'hs', task: join(dir, 'tasks', 't.md'), cwd: dir, label: 't' }));
  const objection = twin ? { id: 'O-aaaaaaaa', lab: 'mock-a', seat: 'mock-a-l1-2', criterion: 'It names a limit.', problem: 'No limit.' } : { id: 'O-aaaaaaaa', lab: 'mock-a', criterion: 'It names a limit.', problem: 'No limit.' };
  const stop = { kind: 'early_finish', pass: 2, overseer_round: 1, chosen: 'early', items: [{ id: 'O-aaaaaaaa', lab: twin ? 'mock-a-l1-2' : 'mock-a', handled: 'declined' }], overseer: ['mock-e'] };
  writeFileSync(join(dir, 'runs', RUN, 'build.md'), BUILD);
  writeFileSync(join(dir, 'runs', RUN, 'criteria.md'), JSON.stringify({ criteria: ['The plan names a limit.'] }));
  writeFileSync(join(dir, 'runs', RUN, 'report.json'), JSON.stringify({ passed: false, stop, dispute: { ran: true, reason: 'early_finish', open_objections: [objection] } }));
  return dir;
}

test('HS-1 A TWIN RUN: the rebuilt HANDOFF.md names the second twin by the lab and the note, never by the internal key', () => {
  const dir = workspace({ twin: true });
  try {
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = readFileSync(join(dir, 'runs', RUN, 'HANDOFF.md'), 'utf8');
    assert.match(text, /BT-1 \(O-aaaaaaaa, raised by mock-a \(layer 1, the model's second seat on this layer\)/);
    assert.equal(/mock-a-l1-2/.test(text), false, 'the internal seat key is not printed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('HS-2 AN OLD RUN WITH NO TWINS: the builder tasks print exactly as before (registering the keys changes nothing and never throws there)', () => {
  const dir = workspace({ twin: false });
  try {
    const r = run(dir, ['--from-run', join('runs', RUN)]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const text = readFileSync(join(dir, 'runs', RUN, 'HANDOFF.md'), 'utf8');
    assert.match(text, /BT-1 \(O-aaaaaaaa, raised by mock-a; the reviser declined it\)/);
    assert.equal(/layer 1, the model's/.test(text), false, 'no note for a lab that sits once');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
