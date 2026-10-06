// 0.8.1 pre-release audit round (MAN-4), area A1 (money path), findings fixed in batch 1. Each test fails on 0d4a519 (the audited tip) and passes after its fix.
// A1-1 `--max-usd=VALUE` ignored; A1-2 an advice call under --max-usd below its blind-wave worst case pays then aborts; A1-3 advise.js retried from the original cap;
// A1-4 a complete reply read as cut off after an inner retry; A1-5 a non-numeric cap fails open; A1-7 `cappedAt` below the seat's cap read back from a usage file.
// Offline, $0: mock providers, a stubbed fetch, the CLI with mock chains.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setBudget, setCache, budgetState, NO_ANSWER_THINKING, BudgetExceeded } from '../src/chain.js';
import { wouldBreach, projectStage } from '../src/cost.js';
import * as R from '../src/roles.js';

const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here, '../src/cli.js');
const BRIEF = '# Should we cache the price list?\n\nWe plan to cache the price list in memory for 24 hours to avoid a call per request.\n';
const stubFetch = h => { const o = globalThis.fetch; globalThis.fetch = h; return () => { globalThis.fetch = o; }; };
const withKey = async fn => { const had = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key'; try { return await fn(); } finally { if (had === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had; } };
const cutByThinking = out => ({ ok: true, json: async () => ({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: 30, output_tokens: out, output_tokens_details: { thinking_tokens: out } } }) });

function cliRun(args, cwd, env = {}) {
  const e = { ...process.env, ...env }; for (const k of Object.keys(e)) if (/API_KEY/.test(k)) delete e[k];
  try { return { status: 0, out: execFileSync(process.execPath, [cli, ...args], { cwd, env: e, encoding: 'utf8', stdio: 'pipe' }) }; } catch (err) { return { status: err.status, out: `${err.stdout || ''}${err.stderr || ''}` }; }
}
const workdir = () => { const d = mkdtempSync(join(tmpdir(), 'thc-audit-money-')); mkdirSync(join(d, 'tasks')); writeFileSync(join(d, 'tasks', 't.md'), 'Plan a tiny thing.\n'); return d; };

test('A1-1: `--max-usd=VALUE` and `--chain=NAME` are read like the space-separated forms (a money flag is never silently ignored)', () => {
  const dir = workdir();
  const capped = cliRun(['--task', 'tasks/t.md', '--chain', 'mock-budget', '--max-usd=0.2'], dir);
  assert.match(capped.out, /cap:\s+\$0\.20(00)? per run/, capped.out.slice(0, 400));
  assert.equal(capped.status, 4, 'the $0.20 cap stops the priced mock chain at its first stage');
  const chain = cliRun(['--task', 'tasks/t.md', '--chain=mock', '--dry-run'], dir);
  assert.equal(chain.status, 0, chain.out.slice(0, 300));
  assert.match(chain.out, /Chain: mock\b/);
});

test('A1-2: an advice call whose blind wave would pass the run cap is stopped before anything is called (nothing spent), not paid in part and aborted', async () => {
  const seat = lab => ({ provider: 'mock', model: 'mock-priced', lab, maxTokens: 100 }); // mock-priced is $1000 per Mtok both ways
  const seats = [seat('a'), seat('b'), seat('c')];
  const blindWorst = seats.reduce((n, s) => n + projectStage(s, { system: R.ADVISOR_SYSTEM, user: R.advisorUser({ request: BRIEF }) }), 0);
  const config = { name: 'audit-advise', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 1000, rounds: 0, max_wall_ms: 120000 }, seats: { critics: seats } };
  setCache(null); setBudget(blindWorst * 0.6); // room for two seats of three, not for the wave
  const stages = [];
  await assert.rejects(() => runChain({ config, request: BRIEF, log: () => {}, onStage: s => stages.push(s.label) }), err => {
    assert.ok(err instanceof BudgetExceeded, `${err.name}: ${err.message}`); // a spend-cap stop (exit 4, nothing spent), the kind the CLI already knows how to report
    assert.match(String(err.label), /advice/);
    return true;
  });
  assert.deepEqual(stages, [], 'no seat was called');
  assert.equal(budgetState().spent, 0);
  setBudget(null);
});

test('A1-3: advise.js starts its cut-off retry from the cap the reply was asked at: no identical paid call twice (the retry ceiling stays 64,000)', async () => {
  await withKey(async () => {
    const caps = [];
    const restore = stubFetch(async (url, opts) => { const c = JSON.parse(opts.body).max_tokens; caps.push(c); return cutByThinking(c); });
    try {
      const config = { name: 'audit-advise-dup', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 },
        advise: { enabled: true, usd: 1000, rounds: 0, max_wall_ms: 120000 }, seats: { critics: [{ provider: 'anthropic', model: 'claude-sonnet-5', lab: 'sonnet5', maxTokens: 4000, extra: { output_config: { effort: 'high' } } }] } };
      setCache(null); setBudget(null);
      try { await runChain({ config, request: BRIEF, log: () => {} }); } catch { /* no readable opinion: the fixture never answers */ }
      assert.ok(caps.length >= 2, `fixture: the seat was asked (${caps})`);
      for (let i = 1; i < caps.length; i++) assert.notEqual(caps[i], caps[i - 1], `two identical paid calls in a row: ${caps.join(', ')}`);
      // 4,000 first; 8,000 the same-effort retry inside invoke(); 16,000 the advice retry (started from 8,000, not from 4,000); 32,000 that call's own same-effort retry. Before the fix: 4000, 8000, 8000, 16000.
      assert.deepEqual(caps, [4000, 8000, 16000, 32000]);
    } finally { restore(); }
  });
});

test('A1-4: after an Anthropic seat\'s own retry, a complete reply that merely fails to parse is not read as cut off against the ORIGINAL cap (no third paid call)', async () => {
  await withKey(async () => {
    const caps = []; const logs = [];
    let n = 0;
    const restore = stubFetch(async (url, opts) => {
      const c = JSON.parse(opts.body).max_tokens; caps.push(c); n++;
      if (n === 1) return cutByThinking(c); // spent the whole 4,000 on thinking
      // the retry at 8,000: ends normally with 7,000 tokens of prose that is not a verdict (7,000 >= 95% of 4,000, < 95% of 8,000); any later call is a short reply
      const out = c === 8000 ? 7000 : 50;
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Some long prose that is not JSON.' }], stop_reason: 'end_turn', usage: { input_tokens: 30, output_tokens: out, output_tokens_details: { thinking_tokens: 100 } } }) };
    });
    try {
      setCache(null); setBudget(null);
      const critic = { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'sonnet5', maxTokens: 4000, extra: { output_config: { effort: 'high' } } };
      await runChain({ request: 'Req.', config: { name: 'audit-critic', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [critic, { provider: 'mock', model: 'mock-critic-b', lab: 'mock-b' }] } }, draft: 'REVISED MOCK DELIVERABLE', log: l => logs.push(l) });
      assert.equal(logs.filter(l => /reply cut off at \d+ tokens - asking once more/.test(l)).length, 0, `a reply that ended normally was logged as cut off: ${logs.filter(l => /cut off/.test(l)).join(' | ')}`);
      assert.ok(!caps.includes(16000), `a bigger-cap call was issued for a reply that was not cut off: ${caps}`);
    } finally { restore(); }
  });
});

test('A1-5: a cap that is not a finite number above zero fails closed (setBudget refuses it; wouldBreach treats it as a breach); null and a real number still work', () => {
  for (const bad of ['abc', {}, NaN, -1, 0, '5x', [], true]) {
    assert.throws(() => setBudget(bad), /cap|ceiling|--max-usd/i, `setBudget(${JSON.stringify(bad)}) must refuse`);
    assert.equal(wouldBreach({ spent: 0, cap: bad, projected: 100 }).breach, true, `wouldBreach with cap ${JSON.stringify(bad)} must breach`);
  }
  assert.doesNotThrow(() => setBudget(null));
  assert.doesNotThrow(() => setBudget(7));
  assert.equal(wouldBreach({ spent: 0, cap: null, projected: 100 }).breach, false);
  assert.equal(wouldBreach({ spent: 0, cap: 5, projected: 100 }).breach, true);
  setBudget(null);
});

test('A1-7: a cappedAt read back from a usage file that is below the seat\'s own cap is ignored (a planted 1 must not make the next paid retry ask for 2 tokens)', async () => {
  await withKey(async () => {
    const caps = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, opts) => { const c = JSON.parse(opts.body).max_tokens; caps.push(c); return cutByThinking(c); };
    try {
      const hit = { text: '', provider: 'anthropic', model: 'claude-sonnet-5', usage: { input: 100, output: 36000, thinking: 36000, stop: 'max_tokens' }, usd: 0.36, ms: 5, cappedAt: 1, noAnswer: NO_ANSWER_THINKING };
      setCache({ get: l => (l === 'panel-1-sonnet5' ? hit : null), warn() {}, invalidate() {} });
      setBudget(null);
      const critic = { provider: 'anthropic', model: 'claude-sonnet-5', lab: 'sonnet5', maxTokens: 36000, extra: { output_config: { effort: 'high' } } };
      await runChain({ request: 'Req.', config: { name: 'audit-cappedat', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [critic] } }, draft: 'REVISED MOCK DELIVERABLE', log: () => {} }).catch(() => {});
      assert.ok(caps.every(c => c >= 36000), `a paid call asked for fewer tokens than the seat's own cap: ${caps}`);
    } finally { globalThis.fetch = original; setCache(null); }
  });
});

test('A1-2 (stop text): a spend-cap stop of an advice call written by the CLI does not offer a resume (an advice call is asked again), and a planning run still does', () => {
  const dir = workdir(); mkdirSync(join(dir, 'chains'));
  const advice = { name: 'audit-adv', resumeAfterStop: false, maxRounds: 1, estimate: { promptTokens: 1000, draftTokens: 1000, critiqueTokens: 300 }, advise: { enabled: true, usd: 1000, rounds: 0, max_wall_ms: 120000 },
    seats: { critics: ['a', 'b', 'c'].map(lab => ({ provider: 'mock', model: 'mock-priced', lab, maxTokens: 100 })) } };
  writeFileSync(join(dir, 'chains', 'audit-adv.json'), JSON.stringify(advice));
  const r = cliRun(['--task', 'tasks/t.md', '--chain', 'audit-adv', '--max-usd', '0.01'], dir);
  assert.equal(r.status, 4, r.out.slice(0, 500));
  assert.doesNotMatch(r.out, /--resume runs\//, 'no resume offer for an advice call');
  assert.match(r.out, /not resumed|asked again|ask again/i);
  const planning = cliRun(['--task', 'tasks/t.md', '--chain', 'mock-budget', '--max-usd=0.2'], dir);
  assert.match(planning.out, /--resume runs\//, 'a planning run still shows how to resume');
});

test('A1-1 (guard): every flag read with flag(\'name\') in src/cli.js is in VALUE_FLAGS, so a new flag cannot silently lose its `--name=value` form', () => {
  const src = readFileSync(resolve(here, '../src/cli.js'), 'utf8');
  const read = new Set([...src.matchAll(/\bflag\('([a-z][a-z0-9-]*)'/g)].map(m => m[1]));
  const listed = new Set([...(/const VALUE_FLAGS = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]));
  assert.ok(read.size >= 20 && listed.size >= 20, `fixture: found ${read.size} read flags, ${listed.size} listed`);
  assert.deepEqual([...read].filter(n => !listed.has(n)), [], 'a flag read with flag() is missing from VALUE_FLAGS');
  assert.deepEqual([...listed].filter(n => !read.has(n)), [], 'a name in VALUE_FLAGS that no flag() call reads');
});
