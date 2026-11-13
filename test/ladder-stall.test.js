// The stall stop on ladder passes (0.8.4, the ladder unit, commit 1). His end list for a ladder run: "agreement, the stall stop, the spending limit or his own stop"; his decision 4 of 28 Okt 2026: a top-layer stall stops and asks.
// OLD: the stall rule was off on every ladder pass (chain.js `!ladderLive`), so a judge that repeated itself could never end a ladder run. NEW: it runs on ladder passes for the TOP layer only; a lower layer's objection standing unchanged through a block
// goes up with the ladder's own climb and does not stop the run. A ladder run has no layer-3 count, so its stall stop carries no `rounds` and the 7-round hard stop does not apply to it (C&C, Q-D).
// Offline, $0: scripted mock judges (`mock-critic-script-<xo>-<id>`) through the real CLI. Small chains of this test, not the shipped ones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const critics = (l1, l2, l3, id) => [
  { provider: 'mock', model: `mock-critic-script-${l1}-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-${l2}-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-${l3}-${id}3`, lab: 'l3', layer: 3 }];
const chainOf = critic => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 7, layerRevisions: { 1: 3, 2: 3 }, dispute: { enabled: true, stall_rounds: 2 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: critic },
});
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 'lad-stall-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { dir, run, runDir, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const reportOf = dir => JSON.parse(readFileSync(join(dir, existsSync(join(dir, 'report.json')) ? 'report.json' : 'report-partial.json'), 'utf8'));
const askedOf = report => { const by = {}; for (const r of report.layers) if (r.state !== 'not_asked') (by[r.round] ||= []).push(r.layer); return Object.keys(by).map(Number).sort((a, b) => a - b).map(n => by[n]); };

test('LS-1 (L-4a): a judge at the TOP layer that repeats its objection ends a ladder run at the stall stop (exit 23, why top_layer) at its second layer-3 verdict; the stop carries no `rounds` (a ladder run has no hard stop)', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'a')));
  try {
    const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']);
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const rep = reportOf(p.runDir());
    // the ladder asks layer 3 at passes 16 and 32 (three blocks of three layer-1 passes and a layer-2 visit each, then layer 3); its second verdict on the same objection is the window of 2
    assert.deepEqual({ kind: rep.stop.kind, why: rep.stop.why, pass: rep.stop.pass, overseer_round: rep.stop.overseer_round, top_layer: rep.stop.top_layer, pass_left: rep.stop.pass_left }, { kind: 'stall_stop', why: 'top_layer', pass: 32, overseer_round: 2, top_layer: 3, pass_left: true });
    assert.deepEqual(rep.stop.stalled.map(s => ({ layer: s.layer, passes: s.passes })), [{ layer: 3, passes: [16, 32] }]);
    assert.equal('rounds' in rep.stop, false, 'a ladder run has no layer-3 count, so its stall stop carries no rounds (C&C Q-D: no count-based hard stop; the session-may-continue test comes with the commit that removes the cap)');
  } finally { p.done(); }
});

test('LS-2 (L-4b): a LOWER layer that repeats itself through whole blocks does not stop a ladder run: the climb goes on to layer 3, which signs, and the run ends as a ladder sign-off', () => {
  // The same chain as LS-1 with layer 3 signing instead of repeating: layers 1 and 2 object with the same objection at every ask (their stall window of 2 is reached at pass 2), and the run still reaches layer 3 at pass 16.
  const p = project(chainOf(critics('x', 'x', 'o', 'b')));
  try {
    const r = p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']);
    assert.equal(r.status, 22, r.stdout + r.stderr);
    const rep = reportOf(p.runDir());
    assert.equal(rep.stop, undefined, 'no stop: a lower-layer repeat is not the run\'s end');
    assert.deepEqual(rep.escalated_signoff, { pass: 16, layer: 3, overseer_round: 1, below: [1, 2], ladder: true });
    assert.equal(askedOf(rep).length, 16);
    assert.deepEqual(askedOf(rep).at(-1), [3]);
  } finally { p.done(); }
});

test('LS-3: the schema says what a ladder run\'s stall stop carries: `rounds` is described, and the stop_kind text says a ladder run has no hard stop', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const text = JSON.stringify(schema);
  assert.match(text, /A run on the ladder has no layer-3 count and so no hard stop: its stall stop carries no `rounds` field/);
  assert.match(text, /Absent on a ladder run's stall stop: a ladder has no layer-3 count and no hard stop/);
});
