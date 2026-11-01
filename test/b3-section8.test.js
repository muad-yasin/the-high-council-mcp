// B3-only run controls, section 8 texts (31 Okt 2026): a pass that was asked to start at the top layer is credited to the request, not to the ladder. An unpressed sign-off and an unpressed board keep their sentences byte for byte. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escalatedSignoffBlock } from '../src/escalation.js';
import { renderLayersBoard } from '../src/report-shape.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('T1: the Ladder sign-off block: a pressed pass says the pass was asked to start at the top layer; an unpressed one is byte for byte the sentence it has always been', () => {
  const unpressed = escalatedSignoffBlock({ end: { ladder: true, layer: 3, pass: 3, below: [1, 2] }, escalations: [] });
  assert.equal(unpressed, '## Ladder sign-off\n\nThe top layer (layer 3) signed off on this plan in round 3. Layer 1, 2 did not read this text: the ladder asks the lower layers only at their turn. This is not consensus of the whole panel.\n\n---\n');
  const pressed = escalatedSignoffBlock({ end: { ladder: true, layer: 3, pass: 3, below: [1, 2], requested: true }, escalations: [] });
  assert.equal(pressed, '## Ladder sign-off\n\nThe top layer (layer 3) signed off on this plan in round 3. Layer 1, 2 did not read this text: the pass was asked to start at the top layer. This is not consensus of the whole panel.\n\n---\n');
});

test('T2: the Panel layers board: the header names a pressed pass only when a row says a request put it there; any other board is byte for byte unchanged', () => {
  const rows = [{ round: 2, layer: 3, labs: ['l3'], state: 'signed_off' }];
  const plain = renderLayersBoard(rows);
  assert.ok(plain.startsWith('## Panel layers\n\nA layer is asked only when every seat of the layers below it signed off on the same draft. (report.json `layers`.)\n'));
  const pressed = renderLayersBoard([{ ...rows[0], floor_by: 'request' }]);
  assert.ok(pressed.startsWith('## Panel layers\n\nA layer is asked only when every seat of the layers below it signed off on the same draft, except a pass that was asked to start at the top layer. (report.json `layers`.)\n'));
});

const writer = { provider: 'external', model: 'claude-code-session' };
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'b3s8-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'lad.json'), JSON.stringify({
    name: 'lad', signoff: 'unanimous', maxOverseerRounds: 3, layerRevisions: { 1: 3, 2: 3 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
    seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: writer, reviser: writer, critics: [
      { provider: 'mock', model: 'mock-critic-script-x-s1', lab: 'l1', layer: 1 }, { provider: 'mock', model: 'mock-critic-script-x-s2', lab: 'l2', layer: 2 }, { provider: 'mock', model: 'mock-critic-script-o-s3', lab: 'l3', layer: 3 }] },
  }));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  const runDir = () => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  return { run, runDir, answer: (n, t) => writeFileSync(join(runDir(), `${n}.md`), t), done: () => rmSync(dir, { recursive: true, force: true }) };
};

test('T3: a run whose layer-3 pass was pressed says so in its log line, its deliverable and its board', () => {
  const p = project();
  try {
    assert.equal(p.run(['--chain', 'lad', '--task', 'tasks/t.md', '--ladder']).status, 3);
    p.answer('build', '# Plan v1\n\n1. Boil.\n\nAssumptions: tea.\n');
    assert.equal(p.run(['--resume', p.runDir()]).status, 3);
    p.answer('revise-1', '# Plan v2\n\n1. Boil.\n\nAssumptions: tea..\n');
    const pressed = p.run(['--resume', p.runDir(), '--next-pass-layer-3']);
    assert.equal(pressed.status, 22, pressed.stdout + pressed.stderr);
    const deliverable = readFileSync(join(p.runDir(), 'deliverable.md'), 'utf8');
    const board = readFileSync(join(p.runDir(), 'BOARD.md'), 'utf8');
    // the three places in one assertion, so that a tree which breaks one wire shows which of them (a stacked assert would stop at the first)
    assert.deepEqual({
      log: /did not read this text \(the pass was asked to start at layer 3\): a ladder sign-off, NOT agreement of the whole panel; stopping\./.test(pressed.stdout) && !/the ladder asked the others/.test(pressed.stdout),
      deliverable: /did not read this text: the pass was asked to start at the top layer\. This is not consensus of the whole panel\./.test(deliverable) && !/only at their turn/.test(deliverable),
      board: /signed off on the same draft, except a pass that was asked to start at the top layer\./.test(board),
    }, { log: true, deliverable: true, board: true });
  } finally { p.done(); }
});
