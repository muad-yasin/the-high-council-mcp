// B3-only run controls, part (a): `--next-pass-layer-3` on a resume (src/ladder-steps.js; run.json `ladderSteps`; chain.js sets a pass's first layer from it). Offline, $0: mock judges scripted by how many times they are asked
// (`mock-critic-script-<xo>-<id>`), an external writer and reviser (so the run pauses at every revise-N, as B3's does), run through the real CLI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stagesOfPass, pauseBefore, stepOk, stepOf } from '../src/ladder-steps.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const critics = (l1, l2, l3, id) => [
  { provider: 'mock', model: `mock-critic-script-${l1}-${id}1`, lab: 'l1', layer: 1 },
  { provider: 'mock', model: `mock-critic-script-${l2}-${id}2`, lab: 'l2', layer: 2 },
  { provider: 'mock', model: `mock-critic-script-${l3}-${id}3`, lab: 'l3', layer: 3 }];
const writer = { provider: 'external', model: 'claude-code-session' };
const chainOf = critic => ({
  name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: critic },
});
const project = config => {
  const dir = mkdtempSync(join(tmpdir(), 'b3c-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify(config));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const answer = (name, text) => writeFileSync(join(runDir(), `${name}.md`), text);
  const files = () => readdirSync(runDir());
  const saved = () => JSON.parse(readFileSync(join(runDir(), 'run.json'), 'utf8'));
  return { dir, run, runDir, answer, files, saved, done: () => rmSync(dir, { recursive: true, force: true }) };
};
const plan = n => `# Plan v${n}\n\n1. Boil.\n2. Steep.\n3. Pour.\n\nAssumptions: black tea${'.'.repeat(n)}\n`;
// The run, at its first revise pause: layer 1 (ladder, credit 0) has objected to the build; NEEDS-revise-1 waits, revise-1 is not written yet.
const atRevise1 = (p, extra = ['--ladder']) => {
  assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', ...extra]).status, 3);
  p.answer('build', plan(1));
  const r = p.run(['--resume', p.runDir()]);
  assert.equal(r.status, 3, r.stdout + r.stderr);
  assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-1.md')));
};

test('N1: the pure helpers: which stage files belong to a pass (every label family, no neighbour), which pause is being answered, which run.json entries are usable', () => {
  const fam = ['panel-2-l1.md', 'panel-2-l1-retry.md', 'panel-2-l1-answered.md', 'panel-2-l1-question.md', 'ldebate-2-l1.md', 'ldebate-2-x2-l1.md', 'lreply-2-l1.md', 'lreply-2-x3-l1.md', 'rule-2-1.md', 'critique-2.md', 'critique-2-retry.md'];
  for (const f of fam) assert.deepEqual(stagesOfPass([f, 'unrelated.md'], 2), [f], `${f} belongs to pass 2`);
  assert.deepEqual(stagesOfPass(['panel-1-l1.md', 'panel-12-l1.md', 'panel-21-l1.md', 'revise-2.md', 'NEEDS-revise-2.md', 'ldebate-3-l1.md', 'build.md'], 2), [], 'neighbours, the pass-2 reviser and pause files are not pass-2 stages');
  assert.deepEqual(pauseBefore(['build.md', 'NEEDS-revise-1.md', 'revise-1.md', 'NEEDS-revise-2.md', 'revise-2.md', 'NEEDS-revise-2-full.md', 'revise-2-full.md']), { ok: true, after: 2, pass: 3 });
  assert.deepEqual(pauseBefore(['NEEDS-revise-1.md', 'revise-1.md', 'NEEDS-revise-2.md']), { ok: false, why: 'pending', label: 'revise-2' });
  assert.deepEqual(pauseBefore(['NEEDS-revise-1.md', 'revise-1.md', 'NEEDS-conflict-1.md']), { ok: false, why: 'pending', label: 'conflict-1' });
  assert.deepEqual(pauseBefore(['build.md', 'panel-1-l1.md']), { ok: false, why: 'none' });
  assert.equal(stepOk({ pass: 2, floor: 3 }), true);
  for (const bad of [null, 'x', {}, { pass: 0, floor: 3 }, { pass: 2.5, floor: 3 }, { pass: 2, floor: 2 }, { pass: '2', floor: 3 }]) assert.equal(stepOk(bad), false);
  assert.equal(stepOf([{ pass: 2, floor: 3 }, { pass: 5, floor: 3 }], 5)?.pass, 5);
  assert.equal(stepOf([{ pass: 2, floor: 2 }], 2), null);
});

test('N2: the next pass starts at layer 3 and layer 3 signing off ends the run as a ladder sign-off (exit 22); layers 1 and 2 do not read that text; one entry is recorded', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'a')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 22, r.stdout + r.stderr);
    assert.match(r.stdout, /--next-pass-layer-3: pass 2 is recorded to start at layer 3\./);
    assert.match(r.stdout, /ladder: pass 2 starts at layer 3 because the pass before it was answered with a request to ask layer 3 next/);
    const files = p.files();
    assert.ok(files.includes('panel-1-l1.md') && files.includes('panel-2-l3.md'));
    assert.equal(files.some(f => /^panel-2-l[12]/.test(f)), false, 'pass 2 asked layer 3 only');
    const rep = JSON.parse(readFileSync(join(p.runDir(), 'report.json'), 'utf8'));
    assert.deepEqual(rep.escalated_signoff, { pass: 2, layer: 3, overseer_round: 1, below: [1, 2], ladder: true, requested: true }, 'the end entry says a request, not the count, put the pass at layer 3');
    assert.deepEqual(rep.layers.filter(r => r.floor_by).map(r => r.round), [2, 2, 2], 'the three rows of pass 2 carry the marker, no other pass does');
    assert.equal(rep.passed, false);
    const steps = p.saved().ladderSteps;
    assert.equal(steps.length, 1);
    assert.deepEqual({ pass: steps[0].pass, floor: steps[0].floor, via: steps[0].via }, { pass: 2, floor: 3, via: 'cli' });
  } finally { p.done(); }
});

test('N3: layer 3 objecting is one layer-3 visit and the plan goes back to layer 1 (layer 2 needs its three visits again); a later plain resume replays the forced pass at $0 and keeps the entry', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'b')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 3, r.stdout + r.stderr);
    assert.ok(existsSync(join(p.runDir(), 'NEEDS-revise-2.md')));
    assert.equal(p.files().some(f => /^panel-2-l[12]/.test(f)), false);
    p.answer('revise-2', plan(3));
    const next = p.run(['--resume', p.runDir()]);
    assert.equal(next.status, 3, next.stdout + next.stderr);
    assert.match(next.stdout, /ladder: pass 3 starts at layer 1 \(layer-1 revisions in this block 0 of 3, layer-2 visits 0 of 3, layer-3 visits 1 of 3\)/);
    assert.match(next.stdout, /panel-2-l3: mock\/mock-critic-script-x-b3 - from disk/, 'the forced pass was replayed from disk, not asked again');
    assert.equal(p.saved().ladderSteps.length, 1);
    assert.equal(existsSync(join(p.runDir(), 'superseded')), false, 'nothing went stale');
  } finally { p.done(); }
});

// One test per refusal: each is asserted on its own message, and each records nothing (a refused command must not leave an entry for the next plain resume to find).
const refusal = (id, name, { extra, setup, args = ['--next-pass-layer-3'], message, code = 2 }) => test(`${id}: refused, recorded nothing: ${name}`, () => {
  const p = project(chainOf(critics('x', 'x', 'x', id.toLowerCase())));
  try {
    atRevise1(p, extra);
    if (setup) setup(p);
    const r = p.run(['--resume', p.runDir(), ...args]);
    assert.equal(r.status, code, r.stdout + r.stderr);
    assert.match(r.stderr, message);
    assert.equal(p.saved().ladderSteps, undefined, 'nothing was recorded');
    assert.equal(p.files().some(f => /^panel-2/.test(f)), false, 'nothing was asked');
  } finally { p.done(); }
});
const answered = p => p.answer('revise-1', plan(2));
refusal('N4a', 'a run with no ladder', { extra: [], setup: answered, message: /--next-pass-layer-3: this run has no ladder, so there is no first layer to change\. Nothing was recorded, run or spent\./ });
refusal('N4b', 'the revise pause has not been answered', { message: /the run waits for an answer to revise-1; give that first\./ });
refusal('N4c', 'a stage of the next pass is already on disk', { setup: p => { answered(p); writeFileSync(join(p.runDir(), 'ldebate-2-x2-l1.md'), 'x'); }, message: /pass 2 already has a stage on disk \(ldebate-2-x2-l1\.md\), so starting the pass at layer 3 would change what that stage was asked\. Nothing was recorded, run or spent\./ });
refusal('N4d', 'a credited pass (plain rules)', { extra: ['--ladder', '--ladder-credit', '2'], setup: answered, message: /pass 2 is one of the first 2 passes, the ladder's credit, which run under the plain rules and not the ladder; so it has no first layer to change\. Nothing was recorded, run or spent\./ });
refusal('N4e', 'a run stopped at a round limit', { setup: p => { answered(p); writeFileSync(join(p.runDir(), 'STOPPED-overseer_cap.json'), '{}'); }, message: /this run is stopped at a limit that waits for --continue or --finish; answer that first\./ });
refusal('N4f', 'a conflict stop is judged by its pending pause, not called a limit', { setup: p => { answered(p); writeFileSync(join(p.runDir(), 'STOPPED-conflict.json'), '{}'); writeFileSync(join(p.runDir(), 'NEEDS-conflict-1.md'), 'x'); }, message: /the run waits for an answer to conflict-1; give that first\./ });
test('N4g: refused: at the first pause (the build) there is no next pass to change; and the flag is not a start flag', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'n4g')));
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3);
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 2); assert.match(r.stderr, /the run waits for an answer to build; give that first\./);
    const s = project(chainOf(critics('x', 'x', 'x', 'n4h')));
    try {
      const t = s.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder', '--next-pass-layer-3']);
      assert.equal(t.status, 2); assert.match(t.stderr, /it answers a paused run: use it with --resume <run folder>\./);
    } finally { s.done(); }
  } finally { p.done(); }
});

test('N5a: the same pass twice records one entry and says so', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'n5a')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    writeFileSync(join(p.runDir(), 'run.json'), JSON.stringify({ ...p.saved(), ladderSteps: [{ pass: 2, floor: 3, at: '2026-10-30T00:00:00.000Z', via: 'cli' }] }));
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 22, r.stdout + r.stderr);
    assert.match(r.stdout, /pass 2 is already recorded to start at layer 3; nothing new was recorded\./);
    assert.equal(p.saved().ladderSteps.length, 1);
  } finally { p.done(); }
});

test('N5b: a damaged ladderSteps entry in run.json is refused before anything runs', () => {
  const q = project(chainOf(critics('x', 'x', 'o', 'n5b')));
  try {
    atRevise1(q);
    q.answer('revise-1', plan(2));
    writeFileSync(join(q.runDir(), 'run.json'), JSON.stringify({ ...q.saved(), ladderSteps: [{ pass: 2, floor: 2 }] }));
    const r = q.run(['--resume', q.runDir()]);
    assert.equal(r.status, 2); assert.match(r.stderr, /run\.json holds a ladderSteps entry that is not \{pass, floor: 3\}\. Check the file: it may have been edited by hand or damaged\. Nothing was run and nothing was spent\./);
    assert.equal(q.files().some(f => /^panel-2/.test(f)), false);
  } finally { q.done(); }
});

test('N6: a layer-3 judge not heard on the requested pass (another layer-3 judge was heard): the automatic re-ask keeps floor 3 (derived from the record), says so, and carries the marker; the ladder\'s own floor would have been layer 1', () => {
  const crit = [
    { provider: 'mock', model: 'mock-critic-script-x-k1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-x-k2', lab: 'l2', layer: 2 },
    { provider: 'mock', model: 'mock-critic-script-o-k3', lab: 'l3', layer: 3 }, { provider: 'mock', model: 'mock-unreadable', lab: 'l3b', layer: 3 }];
  const p = project(chainOf(crit));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.match(r.stdout, /ladder: pass 2 starts at layer 3 because the pass before it was answered/);
    assert.match(r.stdout, /ladder: pass 3 starts at layer 3 again: the pass before it was asked to start at layer 3, and a layer-3 judge was not heard in it\. The counts above are the ladder's own; this pass does not move them\./);
    const files = p.files();
    assert.equal(files.some(f => /^panel-3-l[12]/.test(f)), false, 'pass 3 did not fall back to layer 1');
    assert.ok(files.some(f => /^panel-3-l3/.test(f)), 'pass 3 asked layer 3 again');
    const rep = JSON.parse(readFileSync(join(p.runDir(), existsSync(join(p.runDir(), 'report.json')) ? 'report.json' : 'report-partial.json'), 'utf8'));
    const marked = new Set(rep.layers.filter(x => x.floor_by).map(x => x.round));
    assert.ok(marked.has(2) && marked.has(3) && !marked.has(1), `rows marked in rounds ${[...marked]}`);
    assert.ok(rep.layers.some(x => x.round === 3 && x.floor_by === 'request'));
  } finally { p.done(); }
});

test('N7: at the build pause, with the build answered but no reviewer pause yet, there is no next pass to change (the CLI path of that refusal)', () => {
  const p = project(chainOf(critics('x', 'x', 'x', 'n7')));
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3);
    p.answer('build', plan(1));
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /the run is not at a revise pause, so there is no next pass to change\. Nothing was recorded, run or spent\./);
    assert.equal(p.saved().ladderSteps, undefined);
  } finally { p.done(); }
});

test('N8: the recorded sentence is printed only once the entry is written: a later refusal of the same start (the task changed) prints no "recorded" and writes nothing', () => {
  const p = project(chainOf(critics('x', 'x', 'o', 'n8')));
  try {
    atRevise1(p);
    p.answer('revise-1', plan(2));
    writeFileSync(join(p.dir, 'tasks', 't.md'), '# A different plan\n');
    const r = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.notEqual(r.status, 22, r.stdout + r.stderr);
    assert.doesNotMatch(r.stdout + r.stderr, /(will start|is recorded to start) at layer 3\./);
    assert.equal(p.saved().ladderSteps, undefined, 'nothing was written');
  } finally { p.done(); }
});
