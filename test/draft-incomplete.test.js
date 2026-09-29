// Bug audit 2026-09-27 M4: draftCutOff caught only length/max_tokens, so a draft the provider ended
// with stop "error" (or content_filter / refusal - normaliseStop passes them through) was taken as a
// finished draft. Now every draft stage retries such a reply once at the same cap, then stops the
// run (DraftTruncated) naming the real stop. Mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, DraftTruncated, draftCutOff, draftIncomplete, abstentionReasonCode, setCache, setBudget } from '../src/chain.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mock = model => ({ provider: 'mock', model });
const chain = seats => ({
  name: 'test-draft-incomplete', maxRounds: 1, signoff: 'unanimous',
  seats: { criteria: mock('mock-criteria'), builder: mock('mock-builder'), reviser: mock('mock-builder'),
    critics: [{ ...mock('mock-critic-a'), lab: 'a' }, { ...mock('mock-critic-b'), lab: 'b' }], ...seats },
});
const run = (config, onStage) => { setCache(null); setBudget(null); return runChain({ config, request: 'A mock task.', log: () => {}, onStage }); };

test('stop reasons, one table: cut off, incomplete, or finished - for drafts and for panel abstentions', () => {
  for (const [stop, cut, incomplete, code] of [
    ['length', true, false, 'REPLY_TRUNCATED'],
    ['max_tokens', true, false, 'REPLY_TRUNCATED'],
    ['error', false, true, 'PROVIDER_ERROR'],
    ['content_filter', false, true, 'REPLY_UNPARSEABLE'],
    ['refusal', false, true, 'REPLY_UNPARSEABLE'],
    [null, false, false, 'REPLY_UNPARSEABLE'],
    ['stop', false, false, 'REPLY_UNPARSEABLE'],
  ]) {
    const usage = { output: 100, stop };
    assert.equal(draftCutOff(usage, 8000), cut, `draftCutOff ${stop}`);
    assert.equal(draftIncomplete(usage), incomplete, `draftIncomplete ${stop}`);
    assert.equal(abstentionReasonCode(usage, 8000), code, `abstentionReasonCode ${stop}`);
  }
  assert.equal(draftIncomplete(undefined), false);
});

test('a build that ends with stop "error" twice stops the run and names the stop', async () => {
  await assert.rejects(run(chain({ builder: mock('mock-draft-error') })),
    err => err instanceof DraftTruncated && err.label === 'build' && err.stop === 'error' && /did not complete \(stop: error\)/.test(err.message));
});

test('a build that ends with stop "error" once is retried at the same cap and the run goes on', async () => {
  const stages = [];
  const r = await run(chain({ builder: { ...mock('mock-draft-error-once'), maxTokens: 4000 } }), s => stages.push(s));
  const retry = stages.find(s => s.label === 'build-retry');
  assert.ok(retry, `expected build-retry, got ${stages.map(s => s.label).join(', ')}`);
  assert.ok(!/We chose$/.test(r.deliverable), 'the unfinished fragment is not the deliverable');
});

test('CLI: a final edit ending with stop "error" exits 17 and STOPPED-truncated names the stop', () => {
  const dir = mkdtempSync(join(tmpdir(), 'draft-incomplete-'));
  try {
    mkdirSync(join(dir, 'tasks')); mkdirSync(join(dir, 'chains'));
    writeFileSync(join(dir, 'tasks', 'x.md'), 'A test task.');
    writeFileSync(join(dir, 'chains', 'test-draft-incomplete.json'), JSON.stringify(chain({ finalist: mock('mock-draft-error') })));
    let code = 0, out = '';
    try { out = execFileSync('node', [join(root, 'src', 'cli.js'), '--chain', 'test-draft-incomplete', '--task', 'tasks/x.md'], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH } }); }
    catch (e) { code = e.status; out = (e.stdout || '') + (e.stderr || ''); }
    assert.equal(code, 17, out);
    const runDir = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
    const stopped = JSON.parse(readFileSync(join(runDir, 'STOPPED-truncated.json'), 'utf8'));
    assert.equal(stopped.stage, 'final');
    assert.equal(stopped.stop, 'error');
    assert.match(readFileSync(join(runDir, 'STOPPED-truncated.md'), 'utf8'), /did not complete[\s\S]*stop "error"/);
    assert.ok(!existsSync(join(runDir, 'deliverable.md')), 'the fragment is never shipped');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('panel: a sign-off in a reply the provider ended with stop "error" is an abstention, not consent', async () => {
  setCache(null); setBudget(null);
  const cfg = { ...chain({}), criteria: ['It names an owner.'] };
  cfg.seats = { ...cfg.seats, critics: [{ ...mock('mock-critic-error-signoff'), lab: 'e' }] };
  const r = await runChain({ config: cfg, request: 'A mock task.', log: () => {} });
  const s = r.signoff.find(x => x.model === 'mock-critic-error-signoff');
  assert.equal(s.signedOff, null);
  assert.equal(s.reason_code, 'PROVIDER_ERROR');
  assert.equal(r.passed, false);
});
