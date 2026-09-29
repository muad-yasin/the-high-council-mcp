// Bug audit 2026-09-27 H1: the provider names the model that actually answered (json.model), and
// an OpenRouter extra.models fallback with no price entry cost $0, so the spend cap went blind for
// that call. It is now charged at the seat's own price, and chain lint names an unpriced fallback on a
// priced seat. Offline: a loopback OpenAI-compatible stub, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { runChain, setBudget, setCache, budgetState, BudgetExceeded } from '../src/chain.js';
import { lintChain } from '../src/chain-lint.js';

const CRITIQUE = JSON.stringify({ meets: false, criteria: [{ criterion: 'It exists.', verdict: 'fail', evidence: 'no' }], failures: [{ criterion: 'It exists.', problem: 'Still missing.' }] });

test('an unpriced model answering for a priced seat is charged at the seat\'s price and stopped by the cap', async () => {
  let calls = 0;
  const srv = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      calls++;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ model: 'some-lab/unpriced-fallback', choices: [{ message: { content: CRITIQUE }, finish_reason: 'stop' }], usage: { prompt_tokens: 20000, completion_tokens: 2000 } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const prevKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'stub-not-a-key';
  const seat = lab => ({ provider: 'openrouter', model: 'mistralai/mistral-medium-3-5', maxTokens: 2000, lab, baseUrl: `http://127.0.0.1:${srv.address().port}`, extra: { models: ['some-lab/unpriced-fallback'] } });
  const cap = 0.05;
  try {
    setCache(null); setBudget(cap);
    const config = { name: 'fallback', signoff: 'unanimous', maxRounds: 7, criteria: ['It exists.'], seats: { builder: seat('b'), reviser: seat('b'), critics: [seat('c')] } };
    const logs = [];
    await assert.rejects(() => runChain({ request: 'Plan a thing.', config, log: l => logs.push(l) }), BudgetExceeded);
    const { spent } = budgetState();
    assert.ok(spent > 0 && spent <= cap, `the fallback's answers count toward the cap, spent ${spent}`);
    assert.ok(calls < 20, `the cap stopped the run, made ${calls} calls`);
    assert.ok(logs.some(l => /answered by openrouter\/some-lab\/unpriced-fallback, which has no price entry - charged at mistralai\/mistral-medium-3-5's price/.test(l)), 'the charge is logged');
  } finally {
    srv.close(); setBudget(null);
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevKey;
  }
});

test('lint: an unpriced extra.models fallback on a priced seat is a finding; coder-gate-v2 (now priced) passes', () => {
  const seat = { provider: 'openrouter', model: 'mistralai/mistral-medium-3-5', lab: 'c', extra: { models: ['some-lab/unpriced-fallback'] } };
  const cfg = { name: 'x', seats: { builder: { provider: 'mock', model: 'mock-builder' }, critics: [seat] } };
  const f = lintChain(cfg, 'x.json').filter(x => x.kind === 'extra-models-unpriced');
  assert.equal(f.length, 1);
  assert.match(f[0].message, /seats\.critics\.0: fallback model "some-lab\/unpriced-fallback"/);
  const cg = JSON.parse(readFileSync(new URL('../chains/coder-gate-v2.json', import.meta.url), 'utf8'));
  assert.deepEqual(lintChain(cg, 'coder-gate-v2.json').filter(x => x.kind === 'extra-models-unpriced'), []);
});
