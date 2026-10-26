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
import * as chainModule from '../src/chain.js';   // recordedSpentOf is read off the namespace so this file still loads (and its older tests still run) against a tree that lacks it
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

// Cost-unit gate page U1 + C&C's split ruling (14 Oct 2026): a usage file with NO `usd` (absent or null) is a lost figure on a seat that can cost money. TWO figures, kept apart:
//   (1) the CAP counts one attempt's worst case for it, exactly what an invalid amount is charged - never $0 (a resume cannot lap the cap);
//   (2) the stage's own recorded usd stays what the record holds (0): report.json, totals and --spend never carry a dollar the seat did not produce.
// An explicit 0 stays 0 on both, and a seat that projects $0 stays free on both.
async function replayWith(seat, recorded) {
  setBudget(1e6);
  setCache({ get: label => (label === 'build' ? { text: 'A draft.', provider: 'mock', model: seat.model, usage: { input: 10, output: 5 }, ...recorded } : null) });
  const logs = [];
  const config = { name: 'replay', signoff: 'unanimous', maxRounds: 1, criteria: ['It exists.'], seats: { builder: seat, critics: [seat] } };
  const r = await runChain({ request: 'Req.', config, log: l => logs.push(l) });
  return { budget: budgetState(), build: r.stages.find(s => s.label === 'build'), logs };
}
const PRICED = { provider: 'mock', model: 'mock-priced', maxTokens: 50, lab: 'a' };
const FREE = { provider: 'mock', model: 'mock-unanimous', maxTokens: 50, lab: 'a' };

test('the cap counts one attempt for a replayed stage with no recorded cost, never $0 (explicit 0 and free seats stay free)', async () => {
  try {
    const invalid = await replayWith(PRICED, { usd: 'abc' });   // the existing worst-case path: what "one attempt" is on this seat
    const zero = await replayWith(PRICED, { usd: 0 });
    assert.ok(invalid.budget.spent > zero.budget.spent, `fixture: an invalid amount is charged more than an explicit 0 (${invalid.budget.spent} vs ${zero.budget.spent})`);
    for (const [name, recorded] of [['absent', {}], ['null', { usd: null }]]) {
      const r = await replayWith(PRICED, recorded);
      assert.equal(r.budget.spent, invalid.budget.spent, `${name}: the cap is charged the same one attempt as an invalid amount`);
      assert.ok(r.logs.some(l => /cost recorded on disk for this stage is missing/.test(l)), `${name}: logged`);
    }
    assert.ok(!zero.logs.some(l => /cost recorded on disk/.test(l)), 'an explicit 0 is read as 0 with no charge line');
    const freeMissing = await replayWith(FREE, {});
    const freeZero = await replayWith(FREE, { usd: 0 });
    assert.equal(freeMissing.budget.spent, freeZero.budget.spent, 'a seat that projects $0 stays free when the figure is missing');
    assert.ok(!freeMissing.logs.some(l => /cost recorded on disk/.test(l)), 'a free seat logs no charge line');
  } finally { setCache(null); setBudget(null); }
});

test('the stage keeps the RECORDED usd (0) when the cap is charged a worst case; the assumed part is its own value, and recordedSpentOf leaves it out', async () => {
  try {
    const invalid = await replayWith(PRICED, { usd: 'abc' });
    for (const [name, recorded] of [['absent', {}], ['null', { usd: null }]]) {
      const r = await replayWith(PRICED, recorded);
      assert.equal(r.build.usd, 0, `${name}: the stage's returned usd is the recorded figure, not the worst case`);
      assert.equal(r.budget.assumed.stages, 1, `${name}: the budget names one assumed stage`);
      assert.equal(r.budget.assumed.usd, invalid.budget.spent - (await replayWith(PRICED, { usd: 0 })).budget.spent, `${name}: the assumed part is exactly the one attempt the cap was charged`);
      assert.ok(Math.abs(chainModule.recordedSpentOf(r.budget) - (await replayWith(PRICED, { usd: 0 })).budget.spent) < 1e-12, `${name}: the recorded spend leaves the assumed part out`);
    }
    // A MALFORMED figure is the same as an absent one (C&C 14 Oct 2026, closing the class): the stage records what src/spend.js reads it as (unknown: 0), the cap is charged one attempt, the budget names it.
    const zeroSpent = (await replayWith(PRICED, { usd: 0 })).budget.spent;
    for (const bad of [-1000, 'abc', '5', Number.POSITIVE_INFINITY, { n: 1 }]) {
      const r = await replayWith(PRICED, { usd: bad });
      assert.equal(r.build.usd, 0, `malformed ${JSON.stringify(bad)}: the stage's returned usd is the recorded (unreadable) figure, 0`);
      assert.equal(r.budget.assumed.stages, 1, `malformed ${JSON.stringify(bad)}: named as assumed`);
      assert.ok(r.budget.spent > zeroSpent, `malformed ${JSON.stringify(bad)}: the cap is still charged one attempt`);
      assert.ok(r.logs.some(l => /not a valid amount/.test(l)), `malformed ${JSON.stringify(bad)}: logged`);
    }
    const freeBad = await replayWith(FREE, { usd: 'abc' });
    assert.equal(freeBad.budget.assumed.stages, 0, 'a seat that projects $0 assumes nothing for a malformed figure either');
    const zero = await replayWith(PRICED, { usd: 0 });
    assert.equal(zero.budget.assumed.stages, 0, 'an explicit 0 assumes nothing');
  } finally { setCache(null); setBudget(null); }
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
