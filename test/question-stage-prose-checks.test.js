// 0.8.4 q-warn2: a `-question` stage (the builder's prose answer to a critic's blocking question) is checked as a freeform stage by the partial-output hook (src/cli.js, validateDeliverable with { asProse }): the two checks of the provider's stop, then
// the prose checks. chain.js hands the answer to the critic's `-answered` call with no empty-text check of its own, so the hook is the only signal that the answer was empty. Offline, $0: a mock chain whose builder is an external seat, so the
// person (here: the test) writes the answer file; the first critic is mock-critic-blocking and asks one question. Both modes: the unanimous panel (`panel-<r>-<seat>-question`) and the first-mode critic (`critique-<r>-question`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const ROWS = [
  { mode: 'unanimous panel', chain: 'mock-debate', file: /^NEEDS-(panel-\d+-.*-question)\.md$/ },
  { mode: 'first-mode critic', chain: 'mock', file: /^NEEDS-(critique-\d+-question)\.md$/ },
];
const runCli = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });

for (const row of ROWS) {
  test(`${row.mode}: an empty blocking-question answer gets a partial_output line (empty or missing deliverable text)`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-qprose-'));
    try {
      mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
      writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
      const cfg = JSON.parse(readFileSync(join(root, 'chains', `${row.chain}.json`), 'utf8'));
      const critics = [{ ...cfg.seats.critics[0], model: 'mock-critic-blocking' }, ...cfg.seats.critics.slice(1)];
      writeFileSync(join(dir, 'chains', 'q.json'), JSON.stringify({ ...cfg, name: 'q', freedoms: { blocking_questions: true }, seats: { ...cfg.seats, builder: { provider: 'external', model: 'x', lab: 'ext' }, critics } }));
      let r = runCli(dir, ['--chain', 'q', '--task', 'tasks/t.md']);
      assert.equal(r.status, 3, `start: ${r.stdout}${r.stderr}`);
      const id = readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0];
      const rd = join(dir, 'runs', id);
      writeFileSync(join(rd, 'build.md'), '# Plan\n\nRename each photo to its capture date. Keep the original name when no date is stored.\n');
      r = runCli(dir, ['--resume', join('runs', id)]);
      const needs = readdirSync(rd).map(f => f.match(row.file)).find(Boolean);
      assert.ok(needs, `the run must pause at the blocking-question stage (exit ${r.status}): ${readdirSync(rd).join(', ')}\n${r.stdout}${r.stderr}`);
      const label = needs[1];
      writeFileSync(join(rd, `${label}.md`), '\n');
      r = runCli(dir, ['--resume', join('runs', id)]);
      assert.ok(existsSync(join(rd, `${label.replace(/-question$/, '-answered')}.md`)), `PRECONDITION: the empty answer was consumed (the critic's -answered stage exists): ${readdirSync(rd).join(', ')}\n${r.stdout}${r.stderr}`);
      const warnings = existsSync(join(rd, 'WARNINGS.md')) ? readFileSync(join(rd, 'WARNINGS.md'), 'utf8') : '';
      assert.match(warnings, new RegExp(`partial_output: stage "${label}" \\(\\w+\\) - empty or missing deliverable text`), `WARNINGS.md:\n${warnings}\n${r.stdout}${r.stderr}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
