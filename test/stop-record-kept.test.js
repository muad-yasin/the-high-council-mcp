// 0.8.4: every stop is kept as a small flat record, `stop-<nnnn>.json`, before the next sitting clears the stop files (a bench operator had to snapshot each stop by hand). Offline, $0: the mock layered
// chain of test/overseer-choice.test.js, which stops at the overseer cap and stops again at the next limit after `--continue`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stopIdOf } from '../src/overseer-rounds.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const chain = {
  name: 'skr', signoff: 'unanimous', maxOverseerRounds: 2, layerRevisions: { 1: 2, 2: 1 }, estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics: [judge('o', 'ka', 'l1', 1), judge('o', 'kb', 'l2', 2), judge('x', 'kc', 'l3', 3)] },
};
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'skr-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'skr.json'), JSON.stringify(chain));
  writeFileSync(join(dir, 'tasks', 't.md'), '# A plan\n');
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir } });
  return { dir, run };
};

test('S1-02: stop, --continue, stop again, --continue: stop-0001.json and stop-0002.json hold the first two stops, flat and not STOPPED-*; the newest stop is kept when the next sitting begins', () => {
  const p = project();
  try {
    const r1 = p.run(['--chain', 'skr', '--task', 'tasks/t.md']);
    assert.equal(r1.status, 23, r1.stdout + r1.stderr);
    const runDir = join(p.dir, 'runs', readdirSync(join(p.dir, 'runs'))[0]);
    assert.deepEqual(readdirSync(runDir).filter(f => /^stop-/.test(f)), [], 'nothing is kept before a second sitting clears the first stop');
    const first = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop;
    assert.equal(p.run(['--resume', runDir, '--continue']).status, 23);
    const second = JSON.parse(readFileSync(join(runDir, 'report-partial.json'), 'utf8')).stop;
    assert.notEqual(stopIdOf(second), stopIdOf(first));
    assert.equal(p.run(['--resume', runDir, '--continue']).status, 23);
    const kept = readdirSync(runDir).filter(f => /^stop-\d{4}\.json$/.test(f)).sort();
    assert.deepEqual(kept, ['stop-0001.json', 'stop-0002.json']);
    for (const f of kept) assert.ok(/^[A-Za-z0-9._-]+$/.test(f) && !f.startsWith('STOPPED-'), `${f} is a plain name tree resume does not glob`);
    const [a, b] = kept.map(f => JSON.parse(readFileSync(join(runDir, f), 'utf8')));
    assert.equal(a.schema, 'stop-record/1');
    assert.deepEqual([a.stop_id, b.stop_id], [stopIdOf(first), stopIdOf(second)]);
    assert.deepEqual([a.stop.kind, a.stopped_by], ['overseer_cap', 'overseer_cap']);
    assert.match(a.kept_at, /^\d{4}-\d\d-\d\dT/);
    assert.ok(Object.keys(a.markers).length >= 1, 'the small stop markers are inside the record');
    assert.equal(existsSync(join(runDir, 'report-partial.json')), true, 'the live stop is still the third one, in the usual files');
  } finally { rmSync(p.dir, { recursive: true, force: true }); }
});
