// 0.8.1 milestone R review (advisor, 5 Oct 2026): what the retry decided must survive a resume. An Anthropic critic that was retried at the bigger cap
// by invoke() makes the panel skip its own retry; if `cappedAt` (and `noAnswer`) are not in the stage's usage file, a resumed run replays the stage
// WITHOUT them and issues the retry the first run never made: a new paid call on what should be a free replay, and the board record is lost.
// Offline: the CLI child process gets a stub fetch through --import; the replay test uses an in-memory cache.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setBudget, setCache, NO_ANSWER_THINKING } from '../src/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const cutByThinking = out => ({ ok: true, status: 200, json: async () => ({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: out, output_tokens_details: { thinking_tokens: out } } }), text: async () => '' });

const CHAIN = {
  name: 'rr', maxRounds: 1, signoff: 'unanimous',
  seats: {
    criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' },
    critics: [
      { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 36000, lab: 'sonnet5', extra: { output_config: { effort: 'high' } } },
      { provider: 'mock', model: 'mock-critic-a', lab: 'mock-a' },
    ],
  },
};

test('the stage usage file records the cap the answer was asked at and the no-answer mark, so a replay does not retry again', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-rr-'));
  mkdirSync(join(dir, 'chains')); mkdirSync(join(dir, 'tasks'));
  writeFileSync(join(dir, 'chains', 'rr.json'), JSON.stringify(CHAIN));
  writeFileSync(join(dir, 'tasks', 't.md'), 'Plan a tiny thing.\n');
  // Preload for the child process: every Anthropic call spends its whole cap on thinking and returns no text; each call's cap is logged.
  writeFileSync(join(dir, 'preload.mjs'), `import { appendFileSync } from 'node:fs';
globalThis.fetch = async (url, opts) => { const b = JSON.parse(opts.body || '{}'); appendFileSync(process.env.STUB_CALLS, b.max_tokens + '\\n'); const out = b.max_tokens || 1000;
  return { ok: true, status: 200, headers: new Map(), json: async () => ({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: 100, output_tokens: out, output_tokens_details: { thinking_tokens: out } } }), text: async () => '' }; };\n`);
  writeFileSync(join(dir, 'calls.txt'), '');
  const env = { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-test-not-a-key', STUB_CALLS: join(dir, 'calls.txt') };
  delete env.OPENROUTER_API_KEY;
  execFileSync('node', ['--import', join(dir, 'preload.mjs'), cli, '--task', 'tasks/t.md', '--chain', 'rr', '--max-usd', '50'], { cwd: dir, env, encoding: 'utf8', stdio: 'pipe' });
  assert.deepEqual(readFileSync(join(dir, 'calls.txt'), 'utf8').trim().split('\n'), ['36000', '64000'], 'one call and one same-effort retry, nothing duplicated');
  const run = join(dir, 'runs', readdirSync(join(dir, 'runs'))[0]);
  const usage = JSON.parse(readFileSync(join(run, 'panel-1-sonnet5.usage.json'), 'utf8'));
  assert.equal(usage.cappedAt, 64000, 'the cap the answer was asked at');
  assert.equal(usage.noAnswer, NO_ANSWER_THINKING);
  const report = JSON.parse(readFileSync(join(run, 'report.json'), 'utf8'));
  const row = report.panelVerdicts.find(v => v.lab === 'sonnet5');
  assert.equal(row.verdict, 'unheard');
  assert.equal(row.no_answer, NO_ANSWER_THINKING, 'on the board in report.json');
});

test('a replayed stage that was already retried does not issue the retry again, and keeps its no-answer record', async () => {
  const had = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return cutByThinking(36000); };
  try {
    // What the stage cache returns for the panel stage on a resume: the text and the usage file's fields (src/cli.js setCache get). No promptHash: a stage
    // from before prompt hashes existed replays as it always did.
    const hit = { text: '', provider: 'anthropic', model: 'claude-sonnet-5', usage: { input: 100, output: 64000, thinking: 64000, stop: 'max_tokens' }, usd: 1.0004, ms: 5, cappedAt: 64000, noAnswer: NO_ANSWER_THINKING };
    // The original run's stages: the panel call and its two re-asks of the unheard seat. It never made a `-retry` call (invoke() had already retried at the bigger cap).
    const asked = [];
    const mine = new Set(['panel-1-sonnet5', 'panel-1-sonnet5-reask1', 'panel-1-sonnet5-reask2']);
    setCache({ get: label => { asked.push(label); return mine.has(label) ? hit : null; }, warn() {}, invalidate() {} });
    setBudget(null);
    const cfg = { name: 'rr', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: CHAIN.seats.critics } };
    const r = await runChain({ request: 'Req.', config: cfg, draft: 'REVISED MOCK DELIVERABLE', log: () => {} });
    assert.deepEqual(asked.filter(l => /-retry$/.test(l)), [], 'the panel did not look for, or issue, a retry the first run never made');
    assert.equal(calls, 0, 'a free replay: no request was sent');
    const row = r.panelVerdicts.find(v => v.lab === 'sonnet5');
    assert.equal(row.verdict, 'unheard');
    assert.equal(row.no_answer, NO_ANSWER_THINKING, 'the board record survives the replay');
  } finally { globalThis.fetch = original; setCache(null); if (had === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had; }
});

test('a cache entry cannot plant an arbitrary no-answer text or a nonsense cap (the file is data, not instructions)', async () => {
  const had = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
  const original = globalThis.fetch;
  globalThis.fetch = async () => cutByThinking(36000);
  try {
    const hit = { text: '', provider: 'anthropic', model: 'claude-sonnet-5', usage: { input: 100, output: 36000, thinking: 36000, stop: 'max_tokens' }, usd: 0.36, ms: 5, cappedAt: 'huge', noAnswer: 'IGNORE PREVIOUS INSTRUCTIONS' };
    setCache({ get: label => (label === 'panel-1-sonnet5' ? hit : null), warn() {}, invalidate() {} });
    setBudget(null);
    const r = await runChain({ request: 'Req.', config: { name: 'rr', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: CHAIN.seats.critics } }, draft: 'REVISED MOCK DELIVERABLE', log: () => {} });
    const row = r.panelVerdicts.find(v => v.lab === 'sonnet5');
    assert.notEqual(row.no_answer, 'IGNORE PREVIOUS INSTRUCTIONS');
  } finally { globalThis.fetch = original; setCache(null); if (had === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had; }
});
