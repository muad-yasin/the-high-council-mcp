// 0.8.4 q-warn: the builder's prose answer to a critic's blocking question (label panel-<r>-<seat>[-tag]-question) is not a verdict, so the partial-output check
// (src/cli.js, validateDeliverable by stage kind) must not run on it, in both modes: the unanimous panel's `panel-<r>-<seat>[-tag]-question` and the first-mode critic's `critique-<r>-question`. Before the fix the label mapped to the `panel` kind and every such answer wrote a false
// "PARTIAL OUTPUT WARNING" to the log and a partial_output line to WARNINGS.md. Offline, $0: a mock chain whose first critic asks one blocking question.
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
  { mode: 'unanimous panel', chain: 'mock-debate', file: /^panel-\d+-.*-question\.md$/ },
  { mode: 'first-mode critic', chain: 'mock', file: /^critique-\d+-question\.md$/ },
];
for (const row of ROWS) {
  test(`${row.mode}: a blocking-question answer stage raises no partial-output warning (log or WARNINGS.md)`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'thc-qwarn-'));
    try {
      mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
      writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small command-line tool that renames photos by the date they were taken.\n');
      const cfg = JSON.parse(readFileSync(join(root, 'chains', `${row.chain}.json`), 'utf8'));
      const critics = [{ ...cfg.seats.critics[0], model: 'mock-critic-blocking' }, ...cfg.seats.critics.slice(1)];
      writeFileSync(join(dir, 'chains', 'q.json'), JSON.stringify({ ...cfg, name: 'q', freedoms: { blocking_questions: true }, seats: { ...cfg.seats, critics } }));
      const r = spawnSync(process.execPath, [cli, '--chain', 'q', '--task', 'tasks/t.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 90_000 });
      assert.ok(existsSync(join(dir, 'runs')), `no run folder (exit ${r.status})\n${r.stdout}${r.stderr}`);
      const rd = join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(d => !d.includes('.'))[0]);
      const asked = readdirSync(rd).filter(f => row.file.test(f));
      assert.ok(asked.length >= 1, `the blocking question must have been asked (no ${row.file} stage file): ${readdirSync(rd).join(', ')}`);
      const warnings = existsSync(join(rd, 'WARNINGS.md')) ? readFileSync(join(rd, 'WARNINGS.md'), 'utf8') : '';
      assert.equal(/-question/.test(warnings), false, `WARNINGS.md names a question stage:\n${warnings}`);
      assert.equal(/PARTIAL OUTPUT WARNING: stage "[^"]*-question"/.test(r.stdout), false, r.stdout);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
