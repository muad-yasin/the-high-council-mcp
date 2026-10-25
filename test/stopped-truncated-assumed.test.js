// Cost-unit U1 split (C&C 14 Oct 2026, 6d): STOPPED-truncated.json is reachable on a RESUME, which can replay a stage whose usage record lost its cost. Its spentUsd is the RECORDED spend (the folder's total), never the worst case the cap
// counted for that replay. Offline: priced mock seats (mock-priced) up to the final edit, whose seat (mock-draft-cut) is always cut off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runSpentUsd } from '../src/spend.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'src', 'cli.js');
const RUN = '2026-10-14T13-00-00-000Z';
const run = (dir, args) => spawnSync(process.execPath, [cli, ...args], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 60_000 });
const priced = { provider: 'mock', model: 'mock-priced', maxTokens: 100 };

test('a resume that replays a stage with no recorded cost and then stops on a cut-off draft records the recorded spend, not the worst case', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-trunc-assumed-'));
  mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
  writeFileSync(join(dir, 'tasks', 't.md'), 'A test task.');
  writeFileSync(join(dir, 'chains', 'trunc-assumed.json'), JSON.stringify({
    name: 'trunc-assumed', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
    seats: { criteria: priced, builder: priced, reviser: priced, critics: [{ ...priced, lab: 'a' }], finalist: { provider: 'mock', model: 'mock-draft-cut' } },
  }));
  assert.equal(run(dir, ['--chain', 'trunc-assumed', '--task', 'tasks/t.md', '--max-usd', '100', '--run-id', RUN]).status, 17, 'fixture: the first run stops on the cut-off final edit');
  const rd = join(dir, 'runs', RUN);
  const usageFile = join(rd, 'build.usage.json');
  const record = JSON.parse(readFileSync(usageFile, 'utf8'));
  assert.ok(record.usd > 0, 'fixture: the build stage recorded a cost');
  delete record.usd;                                                                   // the figure is lost; fingerprint and prompt hash intact, so the replay is trusted
  writeFileSync(usageFile, JSON.stringify(record));
  const r = run(dir, ['--resume', join('runs', RUN), '--max-usd', '100']);
  assert.equal(r.status, 17, r.stdout + r.stderr);
  assert.ok(existsSync(join(rd, 'STOPPED-truncated.json')));
  const stopped = JSON.parse(readFileSync(join(rd, 'STOPPED-truncated.json'), 'utf8'));
  assert.match(r.stdout + r.stderr, /cost recorded on disk for this stage is missing/, 'fixture: the replay did charge a worst case');
  assert.ok(Math.abs(stopped.spentUsd - runSpentUsd(rd)) < 1e-6, `STOPPED-truncated says ${stopped.spentUsd}, the folder holds ${runSpentUsd(rd)}`);
});
