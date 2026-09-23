// Pre-release audit 5 #1 (Review/PreRelease_Audit_ResumeCache_2026-09-23.md, HIGH), money path #2
// (Review/PreRelease_Audit_moneypath_2026-09-23.md) and resume-cache #4.
//
// 1. The flip sequence, rebuilt from /tmp/resume-audit/flip.mjs: a critic that failed in sitting 1
//    answers live in sitting 2 and objects; the operator writes a revision; in sitting 3 the round-2
//    sign-offs cached in sitting 1 (they reviewed the OLD draft) used to be replayed onto the new text,
//    and the run finished passed=true on text no critic had read. Each cached stage now carries the
//    hash of the prompt it answered, and a different prompt is a cache miss.
// 2. A resume after the chain changed re-pays a stale stage. The earlier payment used to vanish (its
//    usage file was overwritten and the cap forgot it), so the run could go past its ceiling across
//    sittings. It is now kept under superseded/ and counted.
// 3. An external answer given against an older task/chain is set aside and asked for again, never
//    replayed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setCache, setBudget, ExternalPause } from '../src/chain.js';
import { spendReport } from '../src/spend.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');

test('flip sequence: a cached sign-off of the old draft is never replayed onto a new revision', async () => {
  const disk = new Map(); // label -> { text, usage, usd, promptHash } - what the CLI keeps on disk
  const asked = new Map(); // label -> promptHash recorded when the run paused for an external answer
  const config = critA => ({
    name: 't', maxRounds: 3, signoff: 'unanimous', handoff: true,
    estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'mock', model: 'mock-builder' },
      reviser: { provider: 'external', model: 'claude-code-session' },
      handoff: { provider: 'external', model: 'claude-code-session' },
      critics: [{ provider: 'mock', model: critA, lab: 'la' }, { provider: 'mock', model: 'mock-critic-b', lab: 'lb' }],
    },
  });
  const sitting = async (critA, failLabels = []) => {
    setBudget(null);
    setCache({
      get: l => { if (failLabels.some(t => l.startsWith(t))) throw new Error('simulated 503 after retries'); return disk.get(l) || null; },
      invalidate: l => disk.delete(l),
    });
    try {
      return await runChain({
        request: 'Write a tiny plan.', config: config(critA), draft: 'REVISED MOCK DELIVERABLE v0 (the draft critics saw)', log: () => {},
        onStage: s => { if (!s.cached) disk.set(s.label, { text: s.text, usage: s.usage, usd: s.usd, promptHash: s.promptHash }); },
      });
    } catch (e) {
      if (e instanceof ExternalPause) { asked.set(e.label, e.promptHash); return e; }
      throw e;
    }
  };
  const answer = (label, text) => disk.set(label, { text, usage: { input: 0, output: 0 }, usd: 0, promptHash: asked.get(label) });

  // Sitting 1: critic A is unreachable; the run reaches the external handoff and pauses there.
  const s1 = await sitting('mock-critic-a', ['panel-1-la']);
  assert.ok(s1 instanceof ExternalPause && s1.label === 'handoff', `sitting 1 should pause at handoff, got ${s1?.label ?? JSON.stringify(s1?.passed)}`);
  answer('handoff', 'HANDOFF written for draft v0');
  // Sitting 2: critic A now answers live and objects, so the run pauses for a revision.
  const s2 = await sitting('mock-critic-holdout');
  assert.ok(s2 instanceof ExternalPause && /^revise-/.test(s2.label), `sitting 2 should pause at a revise stage, got ${s2?.label}`);
  answer(s2.label, 'NEW TEXT THAT NO CRITIC HAS SEEN');
  // Sitting 3: the old code replayed sitting 1's round-2 sign-offs and finished passed=true here.
  const s3 = await sitting('mock-critic-holdout');
  const signedOffNewText = !(s3 instanceof ExternalPause) && s3.passed === true && /NEW TEXT THAT NO CRITIC HAS SEEN/.test(s3.deliverable);
  assert.equal(signedOffNewText, false, 'the new revision was passed on sign-offs that reviewed the old draft');
});

// --- CLI: the real cache on disk ---------------------------------------------------------------

function freshDir(chain) {
  const dir = mkdtempSync(join(tmpdir(), 'resume-hash-'));
  mkdirSync(join(dir, 'tasks'), { recursive: true });
  mkdirSync(join(dir, 'chains'), { recursive: true });
  writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
  writeFileSync(join(dir, 'chains', `${chain.name}.json`), JSON.stringify(chain, null, 2));
  return dir;
}
function run(args, dir) {
  try { return { code: 0, out: execFileSync('node', [cli, ...args], { encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH } }) }; }
  catch (e) { return { code: e.status, out: (e.stdout || '') + (e.stderr || '') }; }
}
const runFolder = dir => join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);

test('money path #2: a stale stage re-paid on resume keeps its first payment on disk and against the cap', () => {
  const chain = JSON.parse(readFileSync(resolve(here, '../chains/mock-budget.json'), 'utf8'));
  chain.name = 'mock-budget-copy';
  const dir = freshDir(chain);
  const first = run(['--task', 'tasks/x.md', '--chain', 'mock-budget-copy', '--max-usd', '1'], dir);
  assert.equal(first.code, 4, `first sitting should stop at the cap:\n${first.out}`);
  const rd = runFolder(dir);
  const firstSpent = JSON.parse(readFileSync(join(rd, 'STOPPED-budget.json'), 'utf8')).spentUsd;
  assert.ok(firstSpent > 0, 'the first sitting paid for at least one stage');

  // The chain changes between sittings (an edit, or a package upgrade): every cached stage is stale.
  chain.description = 'edited between sittings';
  writeFileSync(join(dir, 'chains', 'mock-budget-copy.json'), JSON.stringify(chain, null, 2));
  const second = run(['--resume', rd], dir);
  assert.equal(second.code, 4, `the resumed sitting should stop at the cap again:\n${second.out}`);
  const secondSpent = JSON.parse(readFileSync(join(rd, 'STOPPED-budget.json'), 'utf8')).spentUsd;
  assert.ok(secondSpent >= firstSpent * 2 - 1e-9, `the cap must count the first payment plus the re-payment (first ${firstSpent}, now ${secondSpent})`);
  assert.ok(existsSync(join(rd, 'superseded', 'criteria.1.usage.json')), 'the first criteria payment is kept under superseded/, not overwritten');
  const spend = spendReport(join(dir, 'runs'), { days: 1 });
  assert.ok(spend.totalUsd >= secondSpent - 1e-6, `--spend must count the superseded payment too (report ${spend.totalUsd}, spent ${secondSpent})`);
});

test('resume-cache #4: an external answer given against an older chain is set aside and asked for again', () => {
  const chain = {
    name: 'ext-build', maxRounds: 1,
    estimate: { promptTokens: 100, draftTokens: 100, critiqueTokens: 100 },
    seats: {
      criteria: { provider: 'mock', model: 'mock-criteria' },
      builder: { provider: 'external', model: 'claude-code-session' },
      reviser: { provider: 'external', model: 'claude-code-session' },
      critics: [{ provider: 'mock', model: 'mock-critic-passer' }],
    },
  };
  const dir = freshDir(chain);
  const first = run(['--task', 'tasks/x.md', '--chain', 'ext-build'], dir);
  assert.equal(first.code, 3, `should pause at the external build:\n${first.out}`);
  const rd = runFolder(dir);
  assert.ok(existsSync(join(rd, 'build.prompt.json')), 'the pause records the prompt the answer will be held to');
  writeFileSync(join(rd, 'build.md'), 'OLD BUILD, written for the old chain');

  chain.description = 'edited after the operator answered';
  writeFileSync(join(dir, 'chains', 'ext-build.json'), JSON.stringify(chain, null, 2));
  const second = run(['--resume', rd], dir);
  assert.equal(second.code, 3, `the stale external answer must not be replayed; the run asks again:\n${second.out}`);
  assert.ok(!existsSync(join(rd, 'build.md')), 'the stale answer is no longer in place');
  assert.equal(readFileSync(join(rd, 'superseded', 'build.1.md'), 'utf8'), 'OLD BUILD, written for the old chain');
  assert.ok(!existsSync(join(rd, 'report.json')), 'no report: nothing was graded against the old build');
});
