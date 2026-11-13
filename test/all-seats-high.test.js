// 2 Nov 2026 (owner, to C&C: "High for THC's chains, default to High on all chains, users can change it if they want to"): every seat is sent reasoning effort high, including the four models whose own default is above
// high (GLM-5.3, GLM-5.3 Flash, MiniMax M3.1 Flash, Qwen 3.8 Max). Two layers, both pinned here: the shipped chain files STATE high on those seats (route B; src/chain-lint.js holds them to it), and the harness SENDS high to an unset seat
// of those models in any chain (route A; src/reasoning.js highExtraFor). A level a person typed in their own chain is theirs and goes out unchanged. The sweep reads what is actually POSTED (a stubbed fetch under runChain),
// not highExtraFor's return value. $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain, setBudget, setCache } from '../src/chain.js';
import { loweringReasons, highExtraFor, rowOf } from '../src/reasoning.js';
import { lintChain } from '../src/chain-lint.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ABOVE_DEFAULT = ['z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'minimax/minimax-m3.1-flash', 'qwen/qwen3.8-max-0902'];
const seatsOf = c => { const out = []; const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object') { if (o.provider && o.model) out.push(o); else Object.values(o).forEach(walk); } }; walk(c.seats); return out; };
const shipped = readdirSync(join(root, 'chains')).filter(f => f.endsWith('.json')).map(f => [f, JSON.parse(readFileSync(join(root, 'chains', f), 'utf8'))]);
const realSeats = c => seatsOf(c).filter(s => s.provider !== 'mock' && s.provider !== 'external');
// CHANGED ACCEPTED TEST (0.8.4 seats unit, Muad 10 Nov 2026: seven planning chains re-seated, four chains retired). OLD: the ratchet counted a typed number of seats on the four above-default models (30). NEW: the count is derived from the raw text of every shipped chain file (a regex over the file, a different method from the parsed seats the sweep walks), so it moves by itself with the thing it counts. WHY: the seats changed again and a typed number would have to be moved by hand each time.
const RAW_ABOVE = shipped.reduce((n, [f]) => n + (readFileSync(join(root, 'chains', f), 'utf8').match(/"model":\s*"(?:z-ai\/glm-5\.3|z-ai\/glm-5\.3-flash|minimax\/minimax-m3\.1-flash|qwen\/qwen3\.8-max-0902)"/g) || []).length, 0);

const stubFetch = handler => { const original = globalThis.fetch; globalThis.fetch = handler; return () => { globalThis.fetch = original; }; };
const withKeys = async fn => {
  const had = { o: process.env.OPENROUTER_API_KEY, a: process.env.ANTHROPIC_API_KEY };
  process.env.OPENROUTER_API_KEY = 'sk-or-test-not-a-key'; process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-key';
  try { return await fn(); } finally {
    if (had.o === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had.o;
    if (had.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = had.a;
  }
};
const REPLY = '{"meets": true, "criteria": [{"criterion": "It exists.", "verdict": "MET", "evidence": "quoted"}]}';
// The body the harness POSTs for one seat: the seat is the only real panel seat of a one-stage chain, its first call is captured.
async function sentBody(seat) {
  const bodies = [];
  const restore = stubFetch(async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return String(url).includes('anthropic.com')
      ? { ok: true, json: async () => ({ content: [{ type: 'text', text: REPLY }], stop_reason: 'end_turn', usage: { input_tokens: 30, output_tokens: 20 } }) }
      : { ok: true, json: async () => ({ model: seat.model, choices: [{ message: { content: REPLY }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }) };
  });
  try {
    setCache(null); setBudget(null);
    const critic = { provider: seat.provider, model: seat.model, maxTokens: seat.maxTokens ?? 36000, lab: 'sweep', ...(seat.extra ? { extra: structuredClone(seat.extra) } : {}) };
    const cfg = { name: 'all-seats-high', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [critic, { provider: 'mock', model: 'mock-critic-b', lab: 'mock-b' }] } };
    await runChain({ request: 'Req.', config: cfg, draft: 'REVISED MOCK DELIVERABLE', log: () => {} });
  } finally { restore(); }
  assert.ok(bodies.length >= 1, `${seat.provider}/${seat.model}: no request was sent`);
  return bodies[0];
}

test('SWEEP-1: every API seat of every shipped chain is SENT an effort of high or above, and the seats on the four above-default models are sent exactly "high" (what is POSTed, not highExtraFor)', async () => {
  await withKeys(async () => {
    const seen = new Set(); const bad = []; let onAbove = 0; const providers = new Set();
    for (const [file, c] of shipped) {
      for (const seat of realSeats(c)) {
        providers.add(seat.provider);
        const key = `${seat.provider}/${seat.model}/${JSON.stringify(seat.extra ?? null)}`;
        const above = seat.provider === 'openrouter' && ABOVE_DEFAULT.includes(seat.model);
        if (above) onAbove++;
        if (seen.has(key)) continue; seen.add(key);
        if (seat.provider !== 'openrouter' && seat.provider !== 'anthropic') continue;   // the providers asserted below are the only ones a shipped chain seats
        const body = await sentBody(seat);
        const { model, messages, max_completion_tokens, max_tokens, provider, ...fields } = body;
        const low = loweringReasons(fields, seat);
        if (low.length) bad.push(`${file}: ${seat.model} is sent a lowering setting ${JSON.stringify(low)}`);
        if (seat.provider === 'openrouter' && rowOf(seat)?.form === 'openrouter-effort') {
          const eff = body.reasoning?.effort;
          if (!['high', 'xhigh', 'max'].includes(eff)) bad.push(`${file}: ${seat.model} is sent effort ${JSON.stringify(eff)}`);
          if (above && eff !== 'high') bad.push(`${file}: ${seat.model} (own default above high) is sent ${JSON.stringify(eff)}, not high`);
        }
      }
    }
    assert.deepEqual(bad, []);
    // The sweep POSTs the two wires that carry the four models and the direct Claude seats; the other providers a shipped chain seats (google, ollama, openai: a handful of seats) are held to high by the lint rule (test/reasoning-table.test.js), and a NEW provider fails here until it is placed.
    // CHANGED ACCEPTED TEST (0.8.4 seats unit). OLD: the providers were anthropic, google, ollama, openai and openrouter. NEW: anthropic, ollama and openrouter. WHY: chains/verify.json, the only shipped chain that seated Gemini (google) and GPT-5.5 (openai), moved to chains/outdated/; those two providers are still held to high by the lint rule (test/reasoning-table.test.js), a user's own chain may seat them, and a NEW provider in a shipped chain still fails here until it is placed.
    assert.deepEqual([...providers].sort(), ['anthropic', 'ollama', 'openrouter']);
    assert.ok(RAW_ABOVE >= 10 && onAbove === RAW_ABOVE, `a ratchet derived from the raw files: the ${RAW_ABOVE} shipped seats on the four models are all swept (${onAbove})`);
  });
});

test('SWEEP-2: an UNSET seat on each of the four above-default models, in a chain that is not shipped, is sent high', async () => {
  await withKeys(async () => {
    for (const model of ABOVE_DEFAULT) {
      const body = await sentBody({ provider: 'openrouter', model, maxTokens: 36000 });
      assert.deepEqual(body.reasoning, { effort: 'high' }, `${model}: an unset seat is sent high`);
    }
    // a provider block beside it does not stop the default (it is not a reasoning field)
    const withProvider = await sentBody({ provider: 'openrouter', model: 'z-ai/glm-5.3-flash', maxTokens: 36000, extra: { provider: { zdr: true } } });
    assert.deepEqual(withProvider.reasoning, { effort: 'high' });
  });
});

test('SWEEP-3: a level a person typed in their own chain is sent unchanged, above or below high (the owner: "users can change it if they want to")', async () => {
  await withKeys(async () => {
    for (const typed of ['low', 'medium', 'high', 'xhigh', 'max']) {
      const body = await sentBody({ provider: 'openrouter', model: 'z-ai/glm-5.3-flash', maxTokens: 36000, extra: { reasoning: { effort: typed } } });
      assert.deepEqual(body.reasoning, { effort: typed }, `typed ${typed}`);
    }
  });
});

test('FILES: every shipped seat on the four above-default models states exactly "high" in its own file', () => {
  const bad = []; let n = 0;
  for (const [file, c] of shipped) for (const seat of realSeats(c)) {
    if (seat.provider !== 'openrouter' || !ABOVE_DEFAULT.includes(seat.model)) continue;
    n++;
    if (seat.extra?.reasoning?.effort !== 'high') bad.push(`${file}: ${seat.model} states ${JSON.stringify(seat.extra?.reasoning?.effort)}`);
  }
  assert.deepEqual(bad, []);
  // CHANGED ACCEPTED TEST (0.8.4, plan-the-high-council joins the shipped chains). OLD bar: 32 seats on the above-default models. NEW bar: 34. WHY: the chain seats two more of them
  // (GLM-5.3 Flash and MiniMax M3.1 Flash), each stating high in its file; the count moves with the thing it counts.
  // CHANGED ACCEPTED TEST (0.8.4 CC 1a54f329, found by the box run of 08 Nov 2026): OLD bar 34. NEW bar: 32. WHY: chains/daily7-sub-a.json moved to chains/outdated/ and took its two seats on the above-default GLM-5.3 Flash with it; the count moves with the thing it counts.
  // CHANGED ACCEPTED TEST (0.8.4, 36a: the eight one-model chains left chains/): OLD bar 32. NEW bar: 30. WHY: chains/advise-single-glm-flash.json and chains/advise-single-deepseek.json moved to chains/outdated/ and took their seats on the above-default models with them; the count moves with the thing it counts.
  assert.ok(RAW_ABOVE >= 10 && n === RAW_ABOVE, `every seat on the four models found in the raw files (${RAW_ABOVE}) is checked (${n})`);   // 0.8.4 seats unit: derived from the raw text instead of a typed 30
});

test('LINT: a shipped seat on an above-default model with a level below high, or with a reasoning field that is not the table\'s high form, is refused; a user\'s own chain is not bound', () => {
  const shippedPath = join(root, 'chains', 'x.json'); const userPath = '/tmp/some-project/chains/x.json';
  const chain = extra => ({ seats: { critics: [{ provider: 'openrouter', model: 'z-ai/glm-5.3', maxTokens: 16000, extra }] } });
  const hits = (cfg, path) => lintChain(cfg, path).filter(f => f.kind === 'reasoning-not-high');
  assert.equal(hits(chain({ reasoning: { effort: 'low' } }), shippedPath).length, 1, 'low');
  assert.equal(hits(chain({ reasoning: { enabled: true } }), shippedPath).length, 1, 'a bare switch states no level and blocks the default');
  for (const e of ['high', 'xhigh', 'max']) assert.deepEqual(hits(chain({ reasoning: { effort: e } }), shippedPath), [], e);
  assert.deepEqual(hits(chain(undefined), shippedPath), [], 'unset: the harness sends high');
  assert.deepEqual(hits(chain({ reasoning: { effort: 'low' } }), userPath), [], 'a user\'s own chain passes through');
});

test('TABLE: claude-haiku-5-5 has its own row (anthropic-effort, medium by default, 128K output; sources in src/reasoning-table.json), a seat on it is sent high, and the refresh script keeps the row', () => {
  const row = rowOf({ provider: 'anthropic', model: 'claude-haiku-5-5' });
  assert.equal(row?.form, 'anthropic-effort');
  assert.equal(row.defaultEffort, 'medium');
  assert.equal(row.maxOutput, 128000);
  assert.deepEqual(highExtraFor({ provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 36000 }).extra, { output_config: { effort: 'high' } });
  assert.equal(highExtraFor({ provider: 'anthropic', model: 'claude-haiku-5-5', maxTokens: 36000, extra: { output_config: { effort: 'low' } } }), null, 'a typed level is left alone');
  const script = readFileSync(join(root, 'scripts', 'refresh-reasoning-table.mjs'), 'utf8');
  for (const id of ['anthropic/claude-haiku-5-5', 'anthropic/claude-sonnet-5-5']) assert.ok(script.includes(`'${id}':`), `${id} is in the script's DIRECT map, so a refresh keeps its row`);
});
