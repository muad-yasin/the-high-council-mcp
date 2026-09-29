// Bug audit 2026-09-28, area 2 #4 and #6 (plan-daily-7's first real run): (a) a seated lab that
// dropped out was named only in report.json and run.log, so an outcome of "degraded" had no visible
// reason; BOARD.md, WARNINGS.md and the CLI summary now name it. (b) The dry run printed external
// seats as a priced "$0.0000"; it now prints "external" and says those stages are outside the total.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDropoutsBoard } from '../src/report-shape.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');

test('a proposer dropout is named in BOARD.md, WARNINGS.md and the CLI summary', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-dropout-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
    const cfg = JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
    cfg.name = 'dropout';
    cfg.seats.proposers = [...cfg.seats.proposers, { provider: 'mock', model: 'mock-proposer-empty', lab: 'mock-z' }];
    writeFileSync(join(dir, 'chains', 'dropout.json'), JSON.stringify(cfg));
    const r = spawnSync('node', [cli, '--chain', 'dropout', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const report = JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8'));
    assert.ok(report.dropouts.some(d => d.lab === 'mock-z'), JSON.stringify(report.dropouts));
    assert.match(readFileSync(join(runDir, 'BOARD.md'), 'utf8'), /## Dropped out[\s\S]*- mock-z \(mock-proposer-empty\), at proposals/);
    assert.match(readFileSync(join(runDir, 'WARNINGS.md'), 'utf8'), /- dropout: mock-z \(mock-proposer-empty\) produced nothing usable at proposals/);
    assert.match(r.stdout, /dropped:  mock-z \(proposals: /);
  } finally { rmSync(dir, { recursive: true, force: true }); }
  assert.equal(renderDropoutsBoard([]), '');
  assert.equal(renderDropoutsBoard(undefined), '');
});

test('the dry run prints external seats as "external" and says they are outside the total', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-dry-ext-'));
  try {
    writeFileSync(join(dir, '.env'), '');
    const r = spawnSync('node', [cli, '--dry-run', '--chain', 'plan-daily-7'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(r.status, 0, r.stderr);
    const extRows = r.stdout.split('\n').filter(l => /^\s+\S+\s+external\//.test(l));
    assert.ok(extRows.length > 0);
    assert.ok(extRows.every(l => /external\s*$/.test(l) && !/\$0\.0000/.test(l)), extRows.join('\n'));
    assert.match(r.stdout, new RegExp(`${extRows.length} of \\d+ stages are answered by external seats`));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
