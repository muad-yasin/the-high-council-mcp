// Bug-audit regression tests, 2026-09-23 (Review/BugAudit_MoneyPath_2026-09-23.md #1, #5, #4a).
//
// #1: parallel seats all checked the same `spent` before any of them had added to it, so a parallel
//     panel could overshoot --max-usd (repro: 3 critics at ~$100 under a $150 cap spent $300.14).
// #5: a parallel stage rejected on the first BudgetExceeded while siblings were still in flight -
//     billed, never recorded, and re-paid on resume.
// #4a: the Anthropic thinking-disabled retry's first, billed attempt vanished from `spent` if the
//     retry itself threw.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runChain, setBudget, setCache, budgetState, BudgetExceeded } from '../src/chain.js';
import { worstCaseOf } from '../src/cost.js';

// A big draft makes each critic's real input cost large, and a tiny maxTokens keeps the projection
// close to the actual cost - so the cap fits exactly one critic, not three.
const DRAFT = 'REVISED MOCK DELIVERABLE ' + 'x'.repeat(400000);
const seat = lab => ({ provider: 'mock', model: 'mock-priced', maxTokens: 50, lab });

test('parallel panel: three critics under a cap that fits one never spend past the cap', async () => {
  const one = worstCaseOf('mock', 'mock-priced', { promptChars: DRAFT.length, maxTokens: 50 }).usd;
  assert.ok(one > 90 && one < 110, `fixture: one critic projects ~$100, got ${one}`);
  setCache(null); setBudget(150);
  const labels = [];
  const config = { name: 'race', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'],
    seats: { critics: [seat('a'), seat('b'), seat('c')] } };
  await assert.rejects(
    () => runChain({ request: 'Req.', config, draft: DRAFT, log: () => {}, onStage: s => labels.push(s.label) }),
    BudgetExceeded);
  const s = budgetState();
  assert.ok(s.spent <= 150, `spent $${s.spent.toFixed(2)} past a $150 cap`);
  assert.equal(labels.length, 1, 'exactly one critic fits under the cap and is paid for');
  assert.equal(s.reserved, 0, 'every reservation is released once its call settles');
  setBudget(null);
});

test('parallel panel: the in-flight sibling is recorded before the stage rethrows (nothing billed goes unrecorded)', async () => {
  setCache(null); setBudget(150);
  const labels = [];
  const config = { name: 'race', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'],
    seats: { critics: [seat('a'), seat('b'), seat('c')] } };
  let spentAtRejection = null;
  try {
    await runChain({ request: 'Req.', config, draft: DRAFT, log: () => {}, onStage: s => labels.push(s.label) });
  } catch (err) {
    assert.ok(err instanceof BudgetExceeded);
    spentAtRejection = budgetState().spent;
    // The CLI writes STOPPED-budget.json from exactly this moment - the paid sibling must be in it.
    assert.equal(labels.length, 1, 'the paid sibling was recorded before runChain rejected');
  }
  await new Promise(r => setTimeout(r, 50));
  assert.equal(budgetState().spent, spentAtRejection, 'nothing is added to spent after runChain has already rejected');
  setBudget(null);
});

test('a lone call that fits is unaffected: reserved goes back to zero and spent is the actual cost', async () => {
  setCache(null); setBudget(1000);
  const config = { name: 'one', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { critics: [seat('a')] } };
  const r = await runChain({ request: 'Req.', config, draft: DRAFT, log: () => {} });
  const paid = r.stages.reduce((n, s) => n + s.usd, 0);
  assert.ok(Math.abs(budgetState().spent - paid) < 1e-9);
  assert.equal(budgetState().reserved, 0);
  setBudget(null);
});

test('thinking-disabled retry: the discarded first attempt stays in spent even when the retry throws', async () => {
  let n = 0;
  const srv = http.createServer((req, res) => {
    req.resume(); req.on('end', () => {
      n++;
      res.setHeader('content-type', 'application/json');
      if (n === 1) {
        // Attempt 1: the whole budget went to thinking and the reply was cut off - billed, unusable.
        res.end(JSON.stringify({ model: 'anthropic/claude-opus-5', choices: [{ message: { content: '' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 1000, completion_tokens: 4000, completion_tokens_details: { reasoning_tokens: 4000 } } }));
      } else {
        // The retry fails with a non-retryable 4xx.
        res.statusCode = 400; res.end(JSON.stringify({ error: { message: 'bad request' } }));
      }
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const prevKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'stub-not-a-key';
  try {
    const s = { provider: 'openrouter', model: 'anthropic/claude-opus-5', originalProvider: 'anthropic', maxTokens: 4000, baseUrl: `http://127.0.0.1:${srv.address().port}` };
    setCache(null); setBudget(100);
    await assert.rejects(() => runChain({ request: 'Req.', config: { name: 'x', maxRounds: 1, seats: { criteria: s, builder: s, critics: [s] } }, log: () => {} }));
    assert.equal(n, 2, 'fixture: one discarded attempt, one failed retry');
    assert.ok(budgetState().spent > 0, 'the billed first attempt must be counted');
    assert.equal(budgetState().reserved, 0);
  } finally {
    srv.close(); setBudget(null);
    if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevKey;
  }
});
