// test/draft-truncation.test.js
//
// Pre-release audit 2026-09-23 (Review/PreRelease_Audit_revise_2026-09-23.md #1, HIGH): a build,
// revise or final reply cut off at its token cap used to flow straight on - partial-deliverable only
// checked that free text was non-empty - so a truncated final edit became the shipped deliverable
// with no review after it. Now every draft-producing stage retries once with a bigger cap, and a
// reply still cut off (or an external one reporting a cut-off) stops the run: exit 17,
// STOPPED-truncated.md, no report.json and no deliverable.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, DraftTruncated, draftCutOff, setCache } from '../src/chain.js';
import { validateDeliverable, endsMidStructure } from '../src/partial-deliverable.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mock = model => ({ provider: 'mock', model });
const chain = (seats, extra = {}) => ({
  name: 'test-draft-truncation', maxRounds: 1, signoff: 'unanimous',
  estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
  seats: {
    criteria: mock('mock-criteria'), builder: mock('mock-builder'), reviser: mock('mock-builder'),
    critics: [{ ...mock('mock-critic-a'), lab: 'a' }, { ...mock('mock-critic-b'), lab: 'b' }],
    ...seats,
  },
  ...extra,
});
const run = (config, onStage) => runChain({ config, request: 'A mock task.', log: () => {}, onStage });

test('draftCutOff: the provider stop reason decides; a finished long reply is not truncated', () => {
  assert.equal(draftCutOff({ output: 10, stop: 'length' }, 8000), true);
  assert.equal(draftCutOff({ output: 10, stop: 'max_tokens' }, 8000), true);
  assert.equal(draftCutOff({ output: 8000, stop: null }, 8000), true, 'no stop reason and the whole cap used');
  assert.equal(draftCutOff({ output: 8000, stop: 'end_turn' }, 8000), false, 'finished exactly at the cap');
  assert.equal(draftCutOff({ output: 7990, stop: null }, 8000), false);
  assert.equal(draftCutOff(undefined, 8000), false);
});

test('a build cut off at the cap and again on the retry stops the run - nothing is graded', async () => {
  const labels = [];
  await assert.rejects(run(chain({ builder: mock('mock-draft-cut') }), s => labels.push(s.label)),
    err => err instanceof DraftTruncated && err.label === 'build' && /again at/.test(err.detail));
  assert.ok(labels.includes('build') && labels.includes('build-retry'), 'one retry, under its own stable label');
  assert.ok(!labels.some(l => l.startsWith('panel-')), 'the fragment was never shown to the panel');
});

test('a build cut off once is rescued by the bigger-cap retry, and the run goes on', async () => {
  const labels = [];
  const r = await run(chain({ builder: { ...mock('mock-draft-cut-then-fits'), maxTokens: 800 } }), s => labels.push(s.label));
  assert.ok(labels.includes('build-retry'));
  assert.ok(labels.some(l => l.startsWith('panel-')), 'the complete retried draft went on to review');
  assert.ok(!/because it re$/.test(r.deliverable), 'the cut-off fragment is not the deliverable');
});

test('a final edit cut off at the cap stops the run instead of shipping the fragment', async () => {
  await assert.rejects(run(chain({ finalist: mock('mock-draft-cut') })),
    err => err instanceof DraftTruncated && err.label === 'final');
});

test('an external draft whose reply reports a cut-off is not retried and stops the run', async () => {
  const config = chain({ builder: { provider: 'external', model: 'claude-code-session' } });
  try {
    setCache({ get: label => label === 'build'
      ? { text: '# Plan\n\nWe chose A because it re', usage: { input: 0, output: 36000, stop: 'length' }, usd: 0 }
      : null });
    await assert.rejects(run(config), err => err instanceof DraftTruncated && err.label === 'build' && /external reply/.test(err.detail));
  } finally {
    setCache(null);
  }
});

test('partial-deliverable: a cut-off reply, or free text that ends mid-structure, is flagged', () => {
  assert.equal(validateDeliverable('final', '# A complete plan\n\nDone.', { output: 5, stop: 'end_turn' }).ok, true);
  assert.match(validateDeliverable('final', '# Plan\n\nSome text', { output: 5, stop: 'length' }).reason, /cut off at the token cap/);
  assert.match(validateDeliverable('build', '# Plan\n\n```bash\nnpm te').reason, /code block is never closed/);
  assert.equal(endsMidStructure('| a | b |\n|---|---|\n| 1 | 2'), 'the last table row is unfinished');
  assert.equal(endsMidStructure('# Plan\n\ntext\n\n## Risks'), 'it ends on a heading with nothing under it');
  assert.equal(endsMidStructure('- one\n- '), 'it ends on an empty list item');
  assert.equal(endsMidStructure('# Plan\n\n```js\nx()\n```\n\nDone.'), null);
});

test('CLI: a truncated draft exits 17 with STOPPED-truncated.md and no report or deliverable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'draft-trunc-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
    writeFileSync(join(dir, 'chains', 'test-draft-truncation.json'), JSON.stringify(chain({ finalist: mock('mock-draft-cut') })));
    let code = 0, out = '';
    try { out = execFileSync('node', [join(root, 'src', 'cli.js'), '--chain', 'test-draft-truncation', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } }); }
    catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
    assert.equal(code, 17, out);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    assert.ok(existsSync(join(runDir, 'STOPPED-truncated.md')));
    assert.equal(JSON.parse(readFileSync(join(runDir, 'STOPPED-truncated.json'), 'utf8')).stage, 'final');
    assert.ok(!existsSync(join(runDir, 'report.json')), 'a stopped run never reads as finished');
    assert.ok(!existsSync(join(runDir, 'deliverable.md')), 'the fragment is never shipped');
    assert.match(readFileSync(join(runDir, 'WARNINGS.md'), 'utf8'), /partial_output: stage "final".*cut off at the token cap/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the retry labels map to their stage kinds, so the partial-output check still runs on them', async () => {
  const { stageKindOf } = await import('../src/stage-contract.js');
  assert.equal(stageKindOf('build-retry'), 'build');
  assert.equal(stageKindOf('final-retry'), 'final');
  assert.equal(stageKindOf('handoff-retry'), 'handoff');
  assert.equal(stageKindOf('revise-3-retry'), 'revise');
});
