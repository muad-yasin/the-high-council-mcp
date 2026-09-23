// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #2).
// policy.json read a hand-kept list of 7 seat slots plus proposers/critics, so a seat the run
// really calls - challenger, judge, coldRead, claims, descending, preflight, the default security
// reviewer - escaped allowed_providers / allowed_regions / refuse_unpriced_seats entirely.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { everySeatOf } from '../src/chain.js';
import { DEFAULT_SECURITY_REVIEWER_SEAT } from '../src/security-review.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const mock = JSON.parse(readFileSync(resolve(here, '../chains/mock.json'), 'utf8'));
const outsider = { provider: 'deepseek', model: 'deepseek-chat' };

function dryRun(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'thc-policy-seats-'));
  try {
    mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'chains', 'probe.json'), JSON.stringify({ ...chain, name: 'probe' }));
    writeFileSync(join(dir, 'task.md'), 'A plain task.\n');
    writeFileSync(join(dir, 'policy.json'), JSON.stringify({ allowed_providers: ['mock'] }));
    return spawnSync('node', [cli, '--chain', 'probe', '--task', 'task.md', '--dry-run'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

for (const [slot, place] of [
  ['challenger', c => { c.seats.challenger = outsider; }],
  ['judge', c => { c.seats.judge = outsider; }],
  ['coldRead', c => { c.seats.coldRead = outsider; }],
  ['claims', c => { c.seats.claims = outsider; }],
  ['preflight.seats', c => { c.preflight = { seats: [outsider] }; }],
]) {
  test(`policy.json refuses a disallowed provider seated as ${slot}`, () => {
    const chain = structuredClone(mock); place(chain);
    const r = dryRun(chain);
    assert.notEqual(r.status, 0, `${slot}: the policy let a deepseek seat through\n${r.stdout.slice(-300)}`);
    assert.match(r.stderr + r.stdout, /COUNCIL-E005|deepseek/);
  });
}

test('control: the same policy passes an all-mock chain', () => {
  assert.equal(dryRun(structuredClone(mock)).status, 0);
});

test('everySeatOf includes the default security reviewer a run falls back to, and preflight seats', () => {
  const seats = everySeatOf({ security_review: { enabled: true }, preflight: { seats: [outsider] }, seats: { critics: [] } });
  assert.ok(seats.includes(DEFAULT_SECURITY_REVIEWER_SEAT));
  assert.ok(seats.includes(outsider));
  assert.ok(!everySeatOf({ security_review: { enabled: true }, seats: { security_reviewer: outsider } }).includes(DEFAULT_SECURITY_REVIEWER_SEAT));
});
