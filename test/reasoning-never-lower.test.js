// 0.8.1 milestone R: "NO LOWER EFFORT!!!!" (owner, 5 Oct 2026). The retry after a reply that spent its whole cap on thinking keeps the SAME
// effort and gives the call a bigger cap; a reply that is still no text is recorded as "no answer: thinking used the whole cap"; the spend
// cap projects both attempts and charges the attempt that failed; and no code path in src/ writes a lower setting. Offline: stubbed fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setBudget, setCache, budgetState, BudgetExceeded, NO_ANSWER_THINKING } from '../src/chain.js';
import { projectAttempts, projectStage, worstCaseOf } from '../src/cost.js';
import { retryCapFor, retryCeilingOf, loweringReasons } from '../src/reasoning.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stubFetch = handler => { const original = globalThis.fetch; globalThis.fetch = handler; return () => { globalThis.fetch = original; }; };
const withKey = async fn => {
  const had = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
  try { return await fn(); } finally { if (had === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had; }
};
// Anthropic Messages API replies, as providers.js reads them.
const cutByThinking = out => ({ ok: true, json: async () => ({ content: [], stop_reason: 'max_tokens', usage: { input_tokens: 30, output_tokens: out, output_tokens_details: { thinking_tokens: out } } }) });
const complete = text => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 30, output_tokens: 20, output_tokens_details: { thinking_tokens: 5 } } }) });
const SEAT = (over = {}) => ({ provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 4000, extra: { output_config: { effort: 'high' } }, ...over });
const config = seat => ({ name: 'never-lower', maxRounds: 1, seats: { criteria: seat, builder: { provider: 'mock', model: 'mock-builder' }, reviser: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a' }, { provider: 'mock', model: 'mock-critic-b' }] } });
const CRITERIA_REPLY = JSON.stringify({ criteria: ['A real criterion, produced on the retry.'] });

test('retry: a seat whose thinking used the whole cap is retried ONCE at the same effort with a bigger cap, never with thinking off', async () => {
  await withKey(async () => {
    const bodies = [];
    const restore = stubFetch(async (url, opts) => { const body = JSON.parse(opts.body); bodies.push(body); return bodies.length === 1 ? cutByThinking(4000) : complete(CRITERIA_REPLY); });
    try {
      setCache(null); setBudget(null);
      const r = await runChain({ request: 'A request.', config: config(SEAT()), log: () => {} });
      assert.equal(bodies.length, 2, 'exactly one retry');
      for (const b of bodies) {
        assert.deepEqual(b.output_config, { effort: 'high' }, 'every attempt asks for high effort');
        assert.equal('thinking' in b, false, 'no attempt switches thinking off or sets a lower budget');
      }
      const { max_tokens: m1, ...rest1 } = bodies[0];
      const { max_tokens: m2, ...rest2 } = bodies[1];
      assert.deepEqual(rest2, rest1, 'the retry is the same request apart from its cap');
      assert.equal(m1, 4000);
      assert.equal(m2, retryCapFor(4000, retryCeilingOf({ provider: 'anthropic', model: 'claude-sonnet-5' })), 'the bigger cap is retryCapFor: double, bounded by the model and its transport');
      assert.equal(m2, 8000);
      assert.deepEqual(r.criteria, ['A real criterion, produced on the retry.']);
    } finally { restore(); }
  });
});

test('retry: an unset Anthropic seat gets high from the harness default, on the first attempt and on the retry', async () => {
  await withKey(async () => {
    const bodies = [];
    const restore = stubFetch(async (url, opts) => { bodies.push(JSON.parse(opts.body)); return bodies.length === 1 ? cutByThinking(4000) : complete(CRITERIA_REPLY); });
    try {
      setCache(null); setBudget(null);
      await runChain({ request: 'A request.', config: config({ provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 4000 }), log: () => {} });
      assert.equal(bodies.length, 2);
      for (const b of bodies) assert.deepEqual(b.output_config, { effort: 'high' });
    } finally { restore(); }
  });
});

test('at its ceiling a seat is not retried, and the stage is recorded "no answer: thinking used the whole cap" (an unreadable non-pass)', async () => {
  await withKey(async () => {
    let calls = 0;
    const restore = stubFetch(async () => { calls++; return cutByThinking(64000); });
    const stages = [];
    try {
      setCache(null); setBudget(null);
      // 64,000 is the direct-Anthropic transport ceiling (src/reasoning-table.json transportCeilings): no room to grow, so no retry.
      await assert.rejects(() => runChain({ request: 'A request.', config: config(SEAT({ maxTokens: 64000 })), log: () => {}, onStage: s => stages.push(s) }));
      assert.equal(calls, 1, 'no second attempt: a retry at the same cap would only cut off again');
      const st = stages.find(s => s.label === 'criteria');
      assert.equal(st?.noAnswer, NO_ANSWER_THINKING, 'recorded on the stage');
      assert.equal(NO_ANSWER_THINKING, 'no answer: thinking used the whole cap');
    } finally { restore(); }
  });
});

test('a panel seat whose thinking used the whole cap is recorded on the board as such: unheard, with no_answer, never a pass', async () => {
  await withKey(async () => {
    const bodies = [];
    const restore = stubFetch(async (url, opts) => { bodies.push(JSON.parse(opts.body)); return cutByThinking(64000); });
    try {
      setCache(null); setBudget(null);
      const critic = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 64000, lab: 'sonnet5', extra: { output_config: { effort: 'high' } } };
      const cfg = { name: 'panel-no-answer', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [critic, { provider: 'mock', model: 'mock-critic-b', lab: 'mock-b' }] } };
      const r = await runChain({ request: 'Req.', config: cfg, draft: 'REVISED MOCK DELIVERABLE', log: () => {} });
      const mine = r.panelVerdicts.filter(v => v.lab === 'sonnet5');
      assert.ok(mine.length > 0 && mine.every(v => v.verdict === 'unheard'), JSON.stringify(r.panelVerdicts));
      assert.ok(mine.every(v => v.reason_code === 'REPLY_TRUNCATED' && v.no_answer === NO_ANSWER_THINKING), 'recorded with the words the owner asked for');
      for (const b of bodies) assert.deepEqual(b.output_config, { effort: 'high' }, 'no attempt, first or retried, lowers the effort');
    } finally { restore(); }
  });
});

test('no duplicate paid call: an outer cut-off retry starts from the cap invoke() already retried at (panel critic, draft stage) and is skipped when it has no room', async () => {
  await withKey(async () => {
    // (1) a panel critic at 36,000 that always spends its cap thinking: invoke() retries at 64,000; the panel must NOT ask again at 64,000.
    const caps = [];
    const logs = [];
    let restore = stubFetch(async (url, opts) => { caps.push(JSON.parse(opts.body).max_tokens); return cutByThinking(caps[caps.length - 1]); });
    try {
      setCache(null); setBudget(null);
      const critic = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 36000, lab: 'sonnet5', extra: { output_config: { effort: 'high' } } };
      const cfg = { name: 'dup-panel', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [critic, { provider: 'mock', model: 'mock-critic-b', lab: 'mock-b' }] } };
      await runChain({ request: 'Req.', config: cfg, draft: 'REVISED MOCK DELIVERABLE', log: l => logs.push(l) });
      assert.ok(caps.length >= 2, `fixture: the seat was asked (${caps})`);
      for (let i = 1; i < caps.length; i++) assert.notEqual(caps[i], caps[i - 1], `two identical paid calls in a row: ${caps.join(', ')}`);
      assert.equal(logs.filter(l => /asking once more with a/.test(l)).length, 0, 'the panel did not re-ask at the cap invoke() had retried at');
    } finally { restore(); }
    // (2) a draft stage (the builder) at 36,000: invoke() retries at 64,000, the draft stage has no further room and stops: exactly two calls.
    const caps2 = [];
    restore = stubFetch(async (url, opts) => { caps2.push(JSON.parse(opts.body).max_tokens); return cutByThinking(caps2[caps2.length - 1]); });
    try {
      setCache(null); setBudget(null);
      const builder = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 36000, extra: { output_config: { effort: 'high' } } };
      await assert.rejects(() => runChain({ request: 'Req.', config: { name: 'dup-draft', maxRounds: 1, criteria: ['It exists.'], seats: { builder, critics: [{ provider: 'mock', model: 'mock-critic-a' }] } }, log: () => {} }), /largest retry cap|cut off/);
      assert.deepEqual(caps2, [36000, 64000], 'one call, one same-effort retry, nothing more');
    } finally { restore(); }
  });
});

test('a seat whose cap is above its model\'s own maximum is not re-asked at the same cap (OpenRouter Llama 4 Maverick: cap 36,000, model maximum 16,384)', async () => {
  const had = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key';
  const logs = [];
  const caps = [];
  const restore = stubFetch(async (url, opts) => {
    caps.push(JSON.parse(opts.body).max_completion_tokens);
    return { ok: true, json: async () => ({ model: 'meta-llama/llama-4-maverick', choices: [{ message: { content: '{"meets": tru' }, finish_reason: 'length' }], usage: { prompt_tokens: 30, completion_tokens: 36000 } }) };
  });
  try {
    setCache(null); setBudget(null);
    const critic = { provider: 'openrouter', model: 'meta-llama/llama-4-maverick', maxTokens: 36000, lab: 'llama4' };
    const cfg = { name: 'maverick', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [critic, { provider: 'mock', model: 'mock-critic-b', lab: 'mock-b' }] } };
    await runChain({ request: 'Req.', config: cfg, draft: 'REVISED MOCK DELIVERABLE', log: l => logs.push(l) });
    assert.ok(caps.length >= 1 && caps.every(c => c === 36000), `fixture: the seat's own cap only (${caps})`);
    assert.equal(logs.filter(l => /asking once more with a/.test(l)).length, 0, 'no retry at a cap that is not bigger');
  } finally { restore(); if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had; }
});

test('the no-answer record is on the board in first-mode chains too (the single-critic path), not only in the unanimous panel', async () => {
  await withKey(async () => {
    const restore = stubFetch(async (url, opts) => cutByThinking(JSON.parse(opts.body).max_tokens));
    try {
      setCache(null); setBudget(null);
      const critic = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 64000, lab: 'sonnet5', extra: { output_config: { effort: 'high' } } };
      // No `signoff: 'unanimous'`: the first-mode loop, where one critic passes the chain.
      const cfg = { name: 'first-mode-no-answer', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [critic] } };
      const r = await runChain({ request: 'Req.', config: cfg, draft: 'REVISED MOCK DELIVERABLE', log: () => {} });
      const mine = (r.panelVerdicts || []).filter(v => v.lab === 'sonnet5');
      assert.ok(mine.length > 0 && mine.every(v => v.verdict === 'unheard' && v.no_answer === NO_ANSWER_THINKING), JSON.stringify(r.panelVerdicts));
    } finally { restore(); }
  });
});

test('money: the projection is the first attempt plus a BIGGER retry, not twice the first; one function for the cap and the dry run', () => {
  const seat = { provider: 'anthropic', model: 'claude-sonnet-5', maxTokens: 36000 };
  const opts = { system: 'x'.repeat(4000), user: 'y'.repeat(4000) };
  const { first, retry } = projectAttempts(seat, opts);
  const promptChars = 8000;
  assert.equal(first, worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars, maxTokens: 36000 }).usd);
  assert.equal(retry, worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars, maxTokens: 64000 }).usd, '36,000 doubles to the 64,000 transport ceiling');
  assert.ok(retry > first, 'the retry is the bigger attempt');
  assert.equal(projectStage(seat, opts), first + retry);
  // At its ceiling there is no retry to project.
  assert.equal(projectAttempts({ ...seat, maxTokens: 64000 }, opts).retry, 0);
  // A seat that is not Anthropic has one attempt here (its cut-off retries are separate, priced calls).
  assert.equal(projectAttempts({ provider: 'openrouter', model: 'openai/gpt-6.1-sol', maxTokens: 12000 }, opts).retry, 0);
  // An Anthropic seat routed through single-vendor mode keeps the retry in its projection (originalProvider), at the vendor's ceiling.
  assert.ok(projectAttempts({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', originalProvider: 'anthropic', maxTokens: 36000 }, opts).retry > 0);
});

test('money: the cap refuses a call whose first attempt plus its bigger retry would breach it, before any request is sent', async () => {
  await withKey(async () => {
    let calls = 0;
    const restore = stubFetch(async () => { calls++; return complete(CRITERIA_REPLY); });
    try {
      const seat = SEAT({ maxTokens: 36000 });
      const { first, retry } = projectAttempts(seat, { system: '', user: '' });
      assert.ok(first > 0 && retry > first);
      // A ceiling above one attempt but below both: under the old "twice the first" rule this would still have been refused only above 2 x first;
      // a ceiling of first + 0.5 x (retry - first) sits between the two readings and must refuse.
      setCache(null); setBudget(first + (retry - first) / 2);
      await assert.rejects(() => runChain({ request: 'A request.', config: config(seat), log: () => {} }), BudgetExceeded);
      assert.equal(calls, 0, 'refused before the call');
    } finally { restore(); setBudget(null); }
  });
});

test('money: a call that fails after it was sent is charged the worst case of the attempt that failed (the retry\'s, not half the total)', async () => {
  await withKey(async () => {
    let n = 0;
    const restore = stubFetch(async () => {
      n++;
      if (n === 1) return cutByThinking(4000);
      // The retry's answer arrives as a body that is not JSON: sent, possibly billed, unreadable (providers.js marks it maybeBilled).
      return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); }, text: async () => '<html>' };
    });
    try {
      const seat = SEAT();
      const { first, retry } = projectAttempts(seat, { system: '', user: '' });
      setCache(null); setBudget(100);
      await assert.rejects(() => runChain({ request: 'R', config: config(seat), log: () => {} }));
      assert.equal(n >= 2, true, 'fixture: the first attempt was cut off, the retry was sent');
      const spent = budgetState().spent;
      // spent = the billed first attempt (30 in, 4000 out) + what the failed retry is charged. The retry asked for 8,000 output tokens, so its own
      // worst case carries at least 8,000 x the model's output price; the old rule (the whole projection / 2) carried only about 6,000 of them.
      const firstBilled = worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars: 30 * 4, maxTokens: 4000 }).usd;
      const retryOutputShare = worstCaseOf('anthropic', 'claude-sonnet-5', { promptChars: 0, maxTokens: 8000 }).usd;
      const oldRuleCharge = (first + retry) / 2;
      assert.ok(spent - firstBilled >= retryOutputShare, `the failed retry is charged its own worst case: ${spent - firstBilled} >= ${retryOutputShare}`);
      assert.ok(oldRuleCharge < retryOutputShare + 0.01 && retry > first, 'fixture: the two rules differ by more than the prompt share');
      assert.ok(spent - firstBilled < retry + 0.001, 'and not more than that one attempt');
      assert.equal(budgetState().reserved, 0);
    } finally { restore(); setBudget(null); }
  });
});

// ---- no code path in src/ lowers a seat's effort ------------------------------------------------------------------------------------

test('never lower, form 1 (source scan): no line of code in src/ writes a lower reasoning setting', () => {
  const lowering = [
    /\btype['"]?\s*:\s*['"](disabled|between_tools)['"]/, /\beffort['"]?\s*:\s*['"](low|medium|minimal|none)['"]/, /enable_thinking['"]?\s*:\s*false/,
    /\benabled['"]?\s*:\s*false/, /reasoning_effort['"]?\s*:\s*['"](low|medium|minimal|none)['"]/, /\bexclude['"]?\s*:\s*true/,
  ];
  const files = readdirSync(join(root, 'src'), { recursive: true }).filter(f => f.endsWith('.js'));
  const hits = [];
  for (const f of files) {
    if (f === 'reasoning.js') continue; // the one list of what is lowering: it names every form so the lint can refuse it
    readFileSync(join(root, 'src', f), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return; // comments may name the old behaviour
      if (lowering.some(re => re.test(line))) hits.push(`src/${f}:${i + 1}: ${t.slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('never lower, form 2 (source scan): every call that sends a seat\'s request in invoke() sends the SAME extra', () => {
  const whole = readFileSync(join(root, 'src', 'chain.js'), 'utf8');
  const from = whole.indexOf('async function invoke(');
  const src = whole.slice(from, whole.indexOf('\n}\n', from)); // invoke() only: the alternatives stage has its own, unrelated `ask`
  const asks = [...src.matchAll(/\bask\(([^)]*)\)/g)].map(m => m[1].trim());
  assert.ok(asks.length >= 2, 'fixture: the first call and the retry');
  for (const a of asks) assert.ok(a.startsWith('sentExtra'), `ask(${a}) does not send sentExtra`);
  assert.ok(!/\.\.\.\(seat\.extra \|\| \{\}\), thinking/.test(src), 'the old thinking override is gone');
});

test('never lower, form 3 (every shipped non-mock seat): what the harness would send has no lowering setting', () => {
  const walk = (o, out = []) => { if (Array.isArray(o)) o.forEach(v => walk(v, out)); else if (o && typeof o === 'object') { if (typeof o.provider === 'string' && typeof o.model === 'string' && o.provider !== 'mock' && o.provider !== 'external') out.push(o); Object.values(o).forEach(v => walk(v, out)); } return out; };
  for (const f of readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json'))) {
    for (const seat of walk(JSON.parse(readFileSync(join(root, 'chains', f), 'utf8')))) assert.deepEqual(loweringReasons(seat.extra, seat), [], `${f}: ${seat.provider}/${seat.model}`);
  }
});
