// The spend cap against usage it cannot read (security scan 2026-09-26, THC #3).
//
// A provider's usage counts went straight into the cost and the cap. A string, a negative or an
// overflowing count made the stage's cost NaN or negative, `spent` followed, and a NaN never breaches
// a ceiling: the scan's repro made 12 calls past a $0.03 cap. Counts are now read as finite numbers
// >= 0 only; unreadable usage (or none) is charged at one attempt's worst case. A cost read back
// from disk on replay is checked the same way. Offline: a loopback OpenAI-compatible stub, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { runChain, setBudget, setCache, budgetState, BudgetExceeded } from '../src/chain.js';
import { readUsage, readUsd, worstCaseOf } from '../src/cost.js';

const CRITIQUE = JSON.stringify({ meets: false, criteria: [{ criterion: 'It exists.', verdict: 'fail', evidence: 'no' }], failures: [{ criterion: 'It exists.', problem: 'Still missing.' }] });

// `raw` is spliced into the JSON body as-is, so 1e400 (which JSON.parse reads as Infinity) can be sent.
const BAD_USAGE = {
  strings: '{"prompt_tokens":"lots","completion_tokens":"many"}',
  negative: '{"prompt_tokens":-1000000000,"completion_tokens":-1000000000}',
  overflow: '{"prompt_tokens":1e400,"completion_tokens":1e400}',
  nulls: '{"prompt_tokens":null,"completion_tokens":null}',
  reasoning: '{"prompt_tokens":10,"completion_tokens":10,"completion_tokens_details":{"reasoning_tokens":"NaN"}}',
  missing: null,
};

for (const [name, raw] of Object.entries(BAD_USAGE)) {
  test(`the cap still stops the run when the provider's usage is unreadable (${name})`, async () => {
    let calls = 0;
    const srv = http.createServer((req, res) => {
      req.resume(); req.on('end', () => {
        calls++;
        res.setHeader('content-type', 'application/json');
        const head = `{"model":"mistralai/mistral-medium-3-5","choices":[{"message":{"content":${JSON.stringify(CRITIQUE)}},"finish_reason":"stop"}]`;
        res.end(raw === null ? `${head}}` : `${head},"usage":${raw}}`);
      });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const prevKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = 'stub-not-a-key';
    const seat = lab => ({ provider: 'openrouter', model: 'mistralai/mistral-medium-3-5', maxTokens: 2000, lab, baseUrl: `http://127.0.0.1:${srv.address().port}` });
    const cap = 0.05;
    try {
      setCache(null); setBudget(cap);
      const config = { name: 'usage', signoff: 'unanimous', maxRounds: 7, criteria: ['It exists.'], seats: { builder: seat('b'), reviser: seat('b'), critics: [seat('c')] } };
      const logs = [];
      await assert.rejects(() => runChain({ request: 'Plan a thing.', config, log: l => logs.push(l) }), BudgetExceeded);
      const { spent } = budgetState();
      assert.ok(Number.isFinite(spent) && spent > 0 && spent <= cap, `spent must be a finite charge under the cap, got ${spent}`);
      assert.ok(calls <= 4, `the cap must stop the run after a few calls, made ${calls}`);
      assert.ok(logs.some(l => /usage the spend cap cannot read/.test(l)), 'the charge is logged');
    } finally {
      srv.close(); setBudget(null);
      if (prevKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = prevKey;
    }
  });
}

test('a replayed stage whose recorded cost is not a valid amount is charged its worst case', async () => {
  const seat = { provider: 'mock', model: 'mock-priced', maxTokens: 50, lab: 'a' };
  for (const usd of [-1000, 'abc', '5', Number.POSITIVE_INFINITY, { n: 1 }]) {
    setBudget(1e6);
    setCache({ get: label => (label === 'build' ? { text: 'A draft.', usd, provider: 'mock', model: 'mock-priced', usage: { input: 'x', output: -3 } } : null) });
    const logs = [];
    const config = { name: 'replay', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [seat] } };
    const r = await runChain({ request: 'Req.', config, log: l => logs.push(l) });
    const { spent } = budgetState();
    assert.equal(typeof spent, 'number', `usd ${JSON.stringify(usd)}: spent stays a number`);
    assert.ok(Number.isFinite(spent) && spent > 0, `usd ${JSON.stringify(usd)}: spent ${spent}`);
    assert.ok(logs.some(l => /cost recorded on disk for this stage is not a valid amount/.test(l)), `usd ${JSON.stringify(usd)}: logged`);
    const build = r.stages.find(s => s.label === 'build');
    assert.ok(Number.isFinite(build.usage.input) && build.usage.input >= 0 && build.usage.output >= 0, 'replayed counts are sane');
  }
  setCache(null); setBudget(null);
});

test('readUsage and readUsd: finite counts >= 0 only; plain digit strings are read as numbers', () => {
  assert.deepEqual(readUsage({ input: 10, output: 5, thinking: 2, stop: 'stop' }), { usage: { input: 10, output: 5, thinking: 2, stop: 'stop' }, unreadable: null });
  assert.deepEqual(readUsage({ input: '10', output: 5 }).usage, { input: 10, output: 5 });
  assert.match(readUsage({ input: NaN, output: 5 }).unreadable, /input/);
  assert.match(readUsage({ input: 1, output: -5 }).unreadable, /output/);
  assert.match(readUsage(undefined).unreadable, /no usage/);
  assert.equal(readUsd(undefined), 0);
  assert.equal(readUsd(0.25), 0.25);
  for (const bad of [-1, NaN, Infinity, '0.1', {}]) assert.equal(readUsd(bad), null, String(bad));
  assert.ok(worstCaseOf('openrouter', 'mistralai/mistral-medium-3-5', { promptChars: 100, maxTokens: 2000 }).usd > 0.01, 'fixture: one call projects over $0.01');
});
