// Pre-release audit batch 2, CLI-level fixes (Review/PreRelease_Audit_cli_2026-09-23.md #1-#3,
// Review/PreRelease_Audit_ResumeCache_2026-09-23.md #2, #3, #5). Mock seats only, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from '../src/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

function freshDir(chains = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'batch2-cli-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  for (const [name, c] of Object.entries(chains)) writeFileSync(join(dir, 'chains', `${name}.json`), JSON.stringify({ name, ...c }, null, 2));
  return dir;
}
function run(args, cwd) {
  try { return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd, env: { PATH: process.env.PATH } }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
const onlyRun = dir => join(dir, 'runs', readdirSync(join(dir, 'runs')).filter(f => !f.includes('.'))[0]);

test('cli #1: a plain --context document no longer blocks the run at the artifact gate', () => {
  const dir = freshDir();
  mkdirSync(join(dir, 'ctx'));
  writeFileSync(join(dir, 'ctx', 'm.md'), '# Mission\nBe small. See also notes.md for the history.');
  const r = run(['--task', 'tasks/x.md', '--chain', 'mock', '--context', 'ctx'], dir);
  assert.equal(r.code, 0, r.out);
  assert.ok(!existsSync(join(onlyRun(dir), 'BLOCKED-ARTIFACTS.md')));
});

test('cli #3 / resume-cache #5: a relative --draft is found again when the run is resumed from another directory', () => {
  const chain = {
    maxRounds: 1, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 }, handoff: true,
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      reviser: { provider: 'mock', model: 'mock-builder' },
      handoff: { provider: 'external', model: 'claude-code-session' },
      critics: [{ provider: 'mock', model: 'mock-critic-passer' }],
    },
  };
  const dir = freshDir({ 'ext-handoff': chain });
  writeFileSync(join(dir, 'draft.md'), 'THE HANDED DRAFT');
  const first = run(['--task', 'tasks/x.md', '--chain', 'ext-handoff', '--draft', 'draft.md'], dir);
  assert.equal(first.code, 3, first.out);
  const rd = onlyRun(dir);
  writeFileSync(join(rd, 'handoff.md'), 'handoff');
  const elsewhere = mkdtempSync(join(tmpdir(), 'batch2-elsewhere-'));
  writeFileSync(join(elsewhere, 'draft.md'), 'A DIFFERENT FILE THAT HAPPENS TO SHARE THE NAME');
  const second = run(['--resume', rd], elsewhere);
  assert.equal(second.code, 0, second.out);
  assert.match(readFileSync(join(rd, 'deliverable.md'), 'utf8'), /THE HANDED DRAFT/);
});

test('resume-cache #2: --from-run of an unfinished run takes the accepted criteria retry, not the rejected first answer', () => {
  const dir = freshDir();
  const prev = join(dir, 'runs', '2026-09-01T00-00-00-000Z');
  mkdirSync(prev, { recursive: true });
  writeFileSync(join(prev, 'criteria.md'), JSON.stringify({ criteria: ['Is a JSON object with a "criteria" key holding a list of strings'] }));
  writeFileSync(join(prev, 'criteria-retry.md'), JSON.stringify({ criteria: ['The plan names one owner per step', 'Every step has a date'] }));
  writeFileSync(join(prev, 'build.md'), 'A draft.');
  const r = run(['--task', 'tasks/x.md', '--chain', 'mock', '--from-run', prev], dir);
  assert.equal(r.code, 0, r.out);
  const rd = join(dir, 'runs', readdirSync(join(dir, 'runs')).find(f => f !== '2026-09-01T00-00-00-000Z'));
  assert.deepEqual(JSON.parse(readFileSync(join(rd, 'report.json'), 'utf8')).criteria, ['The plan names one owner per step', 'Every step has a date']);
});

test('resume-cache #2: criteria handed to runChain go through the same guards', async () => {
  const config = JSON.parse(readFileSync(resolve(here, '../chains/mock.json'), 'utf8'));
  config.criteria = ['Is a JSON object with a "criteria" key holding a list of strings'];
  await assert.rejects(runChain({ request: 'x', config, log: () => {} }), /Stopped before any paid review round/);
});

test('cli #2: a --rematch folder is refused by --resume, with nothing run', () => {
  const dir = freshDir();
  const side = join(dir, 'runs', '2026-09-01T00-00-00-000Z.rematch-5');
  mkdirSync(side, { recursive: true });
  writeFileSync(join(side, 'run.json'), JSON.stringify({ chain: 'mock', task: 'tasks/x.md', rematchOf: '2026-09-01T00-00-00-000Z', rematchSeed: 5 }));
  const r = run(['--resume', side], dir);
  assert.equal(r.code, 2, r.out);
  assert.ok(!existsSync(join(side, 'report.json')));
  const replay = join(dir, 'runs', '2026-09-01T00-00-00-000Z.replay-2026-09-02');
  mkdirSync(replay);
  assert.equal(run(['--resume', replay], dir).code, 2);
});

test('resume-cache #3: --rematch of a chain with an external seat is refused before anything is paid', () => {
  const chain = {
    maxRounds: 1, estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'external', model: 'claude-code-session' },
      reviser: { provider: 'mock', model: 'mock-builder' },
      critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }, { provider: 'mock', model: 'mock-critic-b', lab: 'b' }],
    },
  };
  const dir = freshDir({ 'ext-build': chain });
  const orig = join(dir, 'runs', '2026-09-01T00-00-00-000Z');
  mkdirSync(orig, { recursive: true });
  writeFileSync(join(orig, 'run.json'), JSON.stringify({ chain: 'ext-build', task: 'tasks/x.md' }));
  writeFileSync(join(orig, 'report.json'), JSON.stringify({ passed: true, signoff: [] }));
  const r = run(['--rematch', orig, '--rematch-seed', '3'], dir);
  assert.equal(r.code, 2, r.out);
  assert.ok(!existsSync(join(dir, 'runs', '2026-09-01T00-00-00-000Z.rematch-3')), 'refused before the rematch folder or any call');
});
