// 0.8.4 unit 6 (D11; C&C via Mini-C&C R424): a `settled` line with NO `reserved` line is damage to spend-reservations.jsonl (a call is reserved, with an fsync, before it is sent, and is not sent when that write fails). It is counted in NO figure and
// `council --spend` names it, with the folder and the reservation id, so it is not silent. Offline, $0: a hand-built run folder and the real `--spend` verb (mock-free: no chain runs, no key, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runSpentUsd } from '../src/spend.js';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.js');
const line = o => JSON.stringify({ schema: 'spend-reservations/1', at: new Date().toISOString(), ...o });

function folder(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-orphan-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a small thing.\n');
  const id = new Date().toISOString().replace(/[:.]/g, '-'); const runDir = join(dir, 'runs', id); mkdirSync(runDir, { recursive: true });   // today's id: `--days 30` lists it
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ chain: 'c', task: 'tasks/t.md' }));
  writeFileSync(join(runDir, 'a-stage.usage.json'), JSON.stringify({ provider: 'openrouter', model: 'x/y', usage: { input: 1, output: 1 }, usd: 0.5, basis: 'token_priced', reservationId: 'r1' }));
  writeFileSync(join(runDir, 'spend-reservations.jsonl'), `${lines.map(line).join('\n')}\n`);
  return { dir, id, runDir };
}
const spend = dir => spawnSync(process.execPath, [cli, '--spend', '--days', '30'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });

test('an orphan settled line (no reserved line) is counted nowhere and `--spend` names it with the folder and the id; the total is the same as without it', () => {
  const sound = [{ event: 'reserved', id: 'r1', label: 'a-stage', seat: 'openrouter/x/y', usd: 1 }, { event: 'settled', id: 'r1', outcome: 'recorded', usd: 0.5, basis: 'token_priced' }];
  const clean = folder(sound);
  const damaged = folder([...sound, { event: 'settled', id: 'r9', outcome: 'recorded', usd: 0.1, basis: 'token_priced' }]);   // r9 was never reserved
  assert.equal(runSpentUsd(clean.runDir), 0.5); assert.equal(runSpentUsd(damaged.runDir), 0.5, 'the orphan adds nothing to the spend total');
  const out = spend(damaged.dir).stdout;
  assert.match(out, /\$0\.5000 +total/, out);
  assert.ok(out.includes(`${damaged.id}  reservation r9: a settled line with no reserved line: damage, counted nothing`), out);
  const control = spend(clean.dir).stdout;
  assert.match(control, /\$0\.5000 +total/, control); assert.doesNotMatch(control, /damage/, 'a sound folder says nothing of damage');
});

test('the id of an orphan is read from a file a project can write: the line shows it without control characters and at most 80 characters', () => {
  const evil = `r9\u001b[31m${'x'.repeat(200)}`;
  const f = folder([{ event: 'settled', id: evil, outcome: 'recorded', usd: 0.1 }]);
  const out = spend(f.dir).stdout;
  const shown = out.split('\n').find(l => l.includes('damage, counted nothing'));
  assert.ok(shown, out);
  assert.doesNotMatch(shown, /\u001b/); assert.ok(shown.includes('r9[31m'), shown); assert.ok(shown.length < 200, `the id is clipped: ${shown.length}`);
});
