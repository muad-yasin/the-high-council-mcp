// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_GuardLayer_2026-09-23.md #8, and the
// lint-on-resume half of Review/BugAudit_RunChainStages_2026-09-23.md #5).
// eu-only + "transport": "openrouter" linted clean, the EU region policy passed and the dry run
// exited 0 - while every seat's data went to OpenRouter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintChain } from '../src/chain-lint.js';
import { resolveChainSeats } from '../src/chain.js';
import { evaluatePolicy } from '../src/policy.js';

const here = dirname(fileURLToPath(import.meta.url));
const euOnly = JSON.parse(readFileSync(resolve(here, '../chains/eu-only.json'), 'utf8'));

test('control: eu-only as shipped lints clean', () => {
  assert.deepEqual(lintChain(euOnly, 'chains/eu-only.json').filter(f => f.kind === 'invalid-compliance-config'), []);
});

test('eu-only with transport: openrouter is refused by the compliance lint', () => {
  const f = lintChain({ ...euOnly, transport: 'openrouter' }, 'chains/eu-only.json').filter(x => x.kind === 'invalid-compliance-config');
  assert.ok(f.some(x => /reroutes/.test(x.message)), f.map(x => x.message).join('\n'));
});

test('a rerouted seat loses its region claim, so an EU region policy fails closed', () => {
  const seat = { provider: 'anthropic', model: 'claude-opus-5', region: 'EU' };
  const routed = resolveChainSeats({ transport: 'openrouter', seats: { builder: seat, critics: [seat] } });
  assert.equal(routed.seats.builder.provider, 'openrouter');
  assert.equal(routed.seats.builder.region, undefined);
  assert.equal(routed.seats.builder.routedFromRegion, 'EU');
  const { ok } = evaluatePolicy({ allowed_regions: ['EU'] }, { config: routed, allSeats: [routed.seats.builder] });
  assert.equal(ok, false);
  // Unrouted, the same seat still passes.
  assert.equal(evaluatePolicy({ allowed_regions: ['EU'] }, { config: {}, allSeats: [seat] }).ok, true);
});

test('--resume re-lints the chain: a chain edited into a broken state between sittings is refused', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-resume-lint-'));
  try {
    mkdirSync(join(dir, 'chains'));
    mkdirSync(join(dir, 'tasks'));
    const chain = JSON.parse(readFileSync(resolve(here, '../chains/mock-external.json'), 'utf8'));
    writeFileSync(join(dir, 'chains', 'probe.json'), JSON.stringify({ ...chain, name: 'probe' }));
    writeFileSync(join(dir, 'tasks', 't.md'), 'A plain task.\n');
    const cli = resolve(here, '../src/cli.js');
    const first = spawnSync('node', [cli, '--chain', 'probe', '--task', 'tasks/t.md'], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
    assert.equal(first.status, 3, `fixture: the external chain pauses (exit 3), got ${first.status}: ${first.stderr.slice(-200)}`);
    // Between sittings, a denied model is added to the chain.
    writeFileSync(join(dir, 'chains', 'probe.json'), JSON.stringify({ ...chain, name: 'probe', seats: { ...chain.seats, critics: [...chain.seats.critics, { provider: 'openrouter', model: 'openrouter/auto', lab: 'router' }] } }));
    const runId = readdirSync(join(dir, 'runs'))[0];
    const resumed = spawnSync('node', [cli, '--resume', join('runs', runId)], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } });
    assert.equal(resumed.status, 1, `expected the lint to refuse the resume: ${resumed.stderr.slice(-300)}`);
    assert.match(resumed.stderr, /chain lint/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
