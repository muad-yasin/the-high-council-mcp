// test/from-run-crashed-resume.test.js - 2026-09-23 audit, MoneyPath #6. A run started with
// --from-run <crashed run> (no report.json, only criteria.md) reuses that run's criteria. On
// --resume it used to find no report.json, skip the criteria.md fallback, and regenerate the
// criteria: a changed fingerprint, so every stage re-paid, and new criteria mid-run.
// Offline: mock criteria, external builder/reviser, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.js');

const CHAIN = {
  name: 'test-from-run-crashed',
  maxRounds: 2,
  estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' },
    builder: { provider: 'external', model: 'claude-code-session' },
    reviser: { provider: 'external', model: 'claude-code-session' },
    critics: [{ provider: 'mock', model: 'mock-critic-passer' }, { provider: 'mock', model: 'mock-critic-passer' }],
  },
  handoff: true,
};
const HANDED = ['ORIGINAL-CRITERION-ONE: the plan names its owner', 'ORIGINAL-CRITERION-TWO: every step has a test'];

function run(args, cwd) {
  try {
    return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH } }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '') + (e.stderr || '') };
  }
}

test('MoneyPath #6: resuming a --from-run of a crashed run keeps its criteria and replays, never re-pays', () => {
  const work = mkdtempSync(join(tmpdir(), 'thc-fromrun-crashed-'));
  mkdirSync(join(work, 'tasks'));
  mkdirSync(join(work, 'chains'));
  writeFileSync(join(work, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(work, 'chains', `${CHAIN.name}.json`), JSON.stringify(CHAIN));
  // The crashed run: criteria.md (the raw criteria reply) and build.md, no report.json.
  const crashed = join(work, 'runs', 'crashed');
  mkdirSync(crashed, { recursive: true });
  writeFileSync(join(crashed, 'criteria.md'), `Here you go:\n${JSON.stringify({ criteria: HANDED })}\n`);
  writeFileSync(join(crashed, 'build.md'), '# The crashed run\'s draft\n');

  const first = run(['--task', 'tasks/x.md', '--chain', CHAIN.name, '--from-run', 'runs/crashed'], work);
  const id = readdirSync(join(work, 'runs')).find((d) => d !== 'crashed');
  assert.ok(id, first.out);
  const runDir = join(work, 'runs', id);
  const needs = readdirSync(runDir).filter((f) => f.startsWith('NEEDS-'));
  assert.equal(needs.length, 1, `expected one pause:\n${first.out}`);

  // Answer the external stage, then resume.
  const stage = needs[0].slice('NEEDS-'.length, -'.md'.length);
  writeFileSync(join(runDir, `${stage}.md`), '# Handoff\n\n1. Do the thing. Acceptance: it is done.\n');
  const resumed = run(['--resume', join('runs', id)], work);

  assert.doesNotMatch(resumed.out, /^\s*criteria\b(?!.*from disk)/m, `criteria were generated again on resume:\n${resumed.out}`);
  assert.doesNotMatch(resumed.out, /CACHE STALENESS/, `a stage was re-run (re-paid on a real chain):\n${resumed.out}`);
  assert.ok(!existsSync(join(runDir, 'criteria.md')) || readFileSync(join(runDir, 'criteria.md'), 'utf8').includes('ORIGINAL-CRITERION-ONE'), 'new criteria were written');
  const report = existsSync(join(runDir, 'report.json')) ? JSON.parse(readFileSync(join(runDir, 'report.json'), 'utf8')) : null;
  assert.ok(report, `the resumed run didn't finish:\n${resumed.out}`);
  assert.deepEqual(report.criteria, HANDED, 'the resumed run used different criteria');
});
