// 0.8.1 pre-release audit round (MAN-4), area A1 (money path), findings fixed in batch 1. Each test fails on 0d4a519 (the audited tip) and passes after its fix.
// A1-1 `--max-usd=VALUE` ignored; A1-2 an advice call under --max-usd below its blind-wave worst case pays then aborts; A1-3 advise.js retried from the original cap;
// (0.8.4, the add-on removal, wave 2: A1-2 and A1-3 drove the advise stage of src/advise.js, which is gone, so they are removed; the stop-text row of A1-2 stays for the planning run it also checked.)
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
import { TREE_VERBS, TREE_VALUE_FLAGS } from '../src/tree-cli.js';

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

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, REM-w4): OLD /not resumed|asked again|ask again/i (the line said "ask for a new quote"). NEW the line is asserted word for word and names no quote. WHY the add-on's tools are gone, so the line ends "start it again (with a higher --max-usd if the limit stopped it)."
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: the CLI's spend-cap stop of a mock ADVICE call (a project chain with an `advise` block) offered no resume and said REM-w4's line ("an advice call is not resumed and its approval is used up: start it again ..."), and a planning run still offered it. NEW: the planning half only. WHY: a chain with an `advise` block is refused now (exit 2), so no advice call can be stopped by the cap, and the line that said it went with the code (REM-w4 is superseded; the folder tombstones are asserted in test/regression-081-audit-reaudit.test.js RA-8).
test('A1-2 (stop text): a spend-cap stop of a planning run still shows how to resume it', () => {
  const dir = workdir();
  const planning = cliRun(['--task', 'tasks/t.md', '--chain', 'mock-budget', '--max-usd=0.2'], dir);
  assert.match(planning.out, /--resume runs\//, 'a planning run still shows how to resume');
  assert.doesNotMatch(planning.out, /an advice call is not resumed|new quote|council_quote/);
});

test('A1-1 (guard): every flag read with flag(\'name\') in src/cli.js is in VALUE_FLAGS, so a new flag cannot silently lose its `--name=value` form', () => {
  const src = readFileSync(resolve(here, '../src/cli.js'), 'utf8');
  const read = new Set([...src.matchAll(/\bflag\('([a-z][a-z0-9-]*)'/g)].map(m => m[1]));
  const listed = new Set([...(/const VALUE_FLAGS = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]));
  assert.ok(read.size >= 20 && listed.size >= 20, `fixture: found ${read.size} read flags, ${listed.size} listed`);
  assert.deepEqual([...read].filter(n => !listed.has(n)), [], 'a flag read with flag() is missing from VALUE_FLAGS');
  // 0.8.3 (C&C's ruling, 9 Oct 2026, a DELIBERATE edit of this guard): the value options of `council tree decide` are listed here but read by src/tree-cli.js, not by flag(); they are the one exception, taken from
  // TREE_VALUE_FLAGS (derived from TREE_VERBS) and pinned by the next test. The first direction above is unchanged.
  assert.deepEqual([...listed].filter(n => !read.has(n) && !TREE_VALUE_FLAGS.includes(n)), [], 'a name in VALUE_FLAGS that no flag() call reads');
});

test('A1-1 (guard, 0.8.3): the only names VALUE_FLAGS lists without a flag() read are the value options of the tree verbs, each of them listed, and TREE_VALUE_FLAGS is exactly those options', () => {
  const src = readFileSync(resolve(here, '../src/cli.js'), 'utf8');
  const read = new Set([...src.matchAll(/\bflag\('([a-z][a-z0-9-]*)'/g)].map(m => m[1]));
  const listed = new Set([...(/const VALUE_FLAGS = new Set\(\[([^\]]*)\]\)/.exec(src)?.[1] ?? '').matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]));
  const verbOptions = [...new Set(Object.values(TREE_VERBS).flatMap(v => v.value).map(f => f.replace(/^--/, '')))].sort();
  assert.ok(verbOptions.length >= 10, `fixture: found ${verbOptions.length} tree value options`);
  assert.deepEqual([...TREE_VALUE_FLAGS].sort(), verbOptions, 'TREE_VALUE_FLAGS is the tree verbs\' value options, no more, no fewer');
  assert.deepEqual(verbOptions.filter(n => !listed.has(n)), [], 'a tree value option is missing from VALUE_FLAGS (its --name=value form would not split)');
  assert.deepEqual([...listed].filter(n => !read.has(n)).sort(), verbOptions.filter(n => !read.has(n)), 'VALUE_FLAGS lists a name that nothing reads and no tree verb takes');
});
