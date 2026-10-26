// BUG-D-002 (bug audit 24 Okt 2026): a PLANNING run that stops at an overseer limit / layer bound (exit 23), at a price refusal (exit 24) or at a conflict ask (exit 25) keeps `BOARD-partial.md` beside its
// report-partial.json (CHANGELOG: "keeps report-partial.json, BOARD-partial.md and deliverable-partial.md"). renderPartialBoardMd returned '' for every cause but `budget` unless the result carried an advice
// answer, so the file was never written for these stops and the words of the price_refused and conflict entries could never print. Only an advice call's own stops (person, client, wall clock) keep returning ''
// when nothing was paid for. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderPartialBoardMd } from '../src/report-shape.js';
import { stopWhyGeneral } from '../src/overseer-rounds.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('PB-1 a planning result gets a partial board for every planning stop cause, headed with that cause\'s words', () => {
  const words = {
    overseer_cap: `${stopWhyGeneral('overseer_cap')}, and the run waits for the person to choose`,
    layer_bound: `${stopWhyGeneral('layer_bound')}, and the run waits for the person to choose`,
    price_refused: 'OpenRouter refused a seat at its price limit and the run waits for the person to choose',
    conflict: 'the conflict decider asked for the person to choose which objection takes priority and the run waits',
  };
  for (const [cause, w] of Object.entries(words)) {
    const md = renderPartialBoardMd({ runId: 'r', result: { board: 'the board' }, cause });
    assert.ok(md.startsWith(`> **Partial board.** This run did not finish: ${w}; nothing new was started. The same record as data: `), `${cause}: ${md.split('\n')[0]}`);
    assert.ok(md.includes('the board'), cause);
  }
  assert.match(stopWhyGeneral('overseer_cap'), /^all its allowed overseer rounds were used and the top layer still objected$/);
  assert.match(stopWhyGeneral('layer_bound'), /^a layer needed more than its allowed revisions, or a seat of a layer stayed silent for too many passes in a row$/);
});

test('PB-2 the advice-only causes still give no board when nothing was paid for (unchanged), and budget keeps its words', () => {
  for (const cause of ['user', 'client_cancel', 'wall_clock']) assert.equal(renderPartialBoardMd({ runId: 'r', result: { board: 'b' }, cause }), '', cause);
  assert.ok(renderPartialBoardMd({ runId: 'r', result: { board: 'b' }, stoppedAtStage: 'build' }).startsWith('> **Partial board.** This run stopped at its spend cap before stage `build`'));
});

test('PB-3 the real CLI: a chain that stops at its overseer cap (exit 23) leaves BOARD-partial.md next to report-partial.json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pb-'));
  try {
    mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
    const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
    writeFileSync(join(dir, 'chains', 'pb.json'), JSON.stringify({
      name: 'pb', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
      seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-reviser', lab: 'author' }, critics: [judge('o', 'pba', 'l1', 1), judge('o', 'pbb', 'l2', 2), judge('x', 'pbc', 'l3', 3)] },
    }));
    writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
    const r = spawnSync(process.execPath, [join(root, 'src', 'cli.js'), '--chain', 'pb', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
    assert.equal(r.status, 23, r.stdout + r.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.ok(existsSync(join(runDir, 'report-partial.json')), 'the partial report is there');
    assert.ok(existsSync(join(runDir, 'BOARD-partial.md')), 'and its board');
    assert.match(readFileSync(join(runDir, 'BOARD-partial.md'), 'utf8'), /^> \*\*Partial board\.\*\* This run did not finish: all its allowed overseer rounds were used/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
