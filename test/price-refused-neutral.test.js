// Astra item 31 (20 Okt 2026, C&C order): the price-pin cause is named only when OpenRouter named the price; an HTTP 404 in other words gets the neutral first line.
// And the money half: a refused call is booked at $0 (invoke() settles a 404 at usd 0; `maybeBilled` is never set for an HTTP answer), closing the gap that no test asserted it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const MODEL = 'qwen/qwen3.7-plus';
const stub = async (body, status = 404) => {
  const srv = createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${srv.address().port}/v1`, close: () => new Promise(r => srv.close(r)) };
};

test('PRN-1: an unrecognised 404 gets no price-pin cause and no "cost nothing"; a recognised one still names the pin; both say the run counts $0', async () => {
  const { PriceRefused, priceRefusedWords } = await import('../src/price-refused.js');
  const mk = over => new PriceRefused({ seat: `openrouter/${MODEL}`, label: 'panel-1-orx', pin: { prompt: 0.4, completion: 1.6 }, row: { in: 0.4, out: 1.6 }, said: 'No endpoints found that satisfy the max price for this request', recognised: true, lab: 'orx', ...over });
  // the check C&C named, first: an unrecognised 404 is not given the price-pin cause
  const unnamed = priceRefusedWords(mk({ recognised: false, said: 'Model not found' }), { runPath: 'runs/R1' });
  const first = unnamed.split('\n')[0];
  assert.ok(!/price limit/.test(first) && !/cost nothing/.test(unnamed), 'no price-pin cause and no "cost nothing" for an unrecognised 404');
  assert.match(first, /^OpenRouter refused the call of openrouter\/qwen\/qwen3\.7-plus in panel-1-orx with HTTP 404\. The cause has not been identified\. /);
  assert.match(first, /counts the refused call as \$0/);
  // 4.1 (C&C thcmcp-cd, 23 Okt 2026): old bar "one unrecognised refusal among several gets the neutral line" (asserted only !/price limits/); new bar "the cause is named for exactly the recognised seats" (item 31 continued, per seat); why: the blanket line told the person nothing was identified when it was identified for one seat.
  const both = priceRefusedWords(Object.assign(mk({}), { also: [mk({ seat: 'openrouter/other/model', recognised: false, said: 'x' })] }), { runPath: 'runs/R1' }).split('\n')[0];
  assert.match(both, /^OpenRouter refused the calls of 2 seats in panel-1-orx \(and its siblings\) with HTTP 404: openrouter\/qwen\/qwen3\.7-plus, openrouter\/other\/model\. For openrouter\/qwen\/qwen3\.7-plus the answer names the max price; for openrouter\/other\/model the cause has not been identified\. /, 'one unrecognised refusal among several: the cause is named per group');
  assert.ok(!/price limits/.test(both));
  // the price-named case keeps its cause
  const named = priceRefusedWords(mk({}), { runPath: 'runs/R1' });
  assert.match(named.split('\n')[0], /was refused at the price limit in panel-1-orx\. No further call was started after the refusal, and this run counts the refused call as \$0\./);
});

test('PRN-2 (money): a refused call, recognised or not, books $0 against the cap', async () => {
  const { runSingleStage, setBudget, budgetState } = await import('../src/chain.js');
  const { PriceRefused } = await import('../src/price-refused.js');
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const prev = process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = '1';
  try {
    // positive control: the same seat and budget DO book a served call, so the zero below is not a budget that books nothing
    const ok = await stub({ id: 'stub-1', model: MODEL, provider: 'StubHost', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 } }, 200);
    try {
      setBudget(5);
      await runSingleStage({ provider: 'openrouter', model: MODEL, lab: 'orx', maxTokens: 500, baseUrl: ok.url }, { system: 's', user: 'u', label: 'control' });
      assert.ok(budgetState().spent > 0, 'a served call books a positive amount');
    } finally { await ok.close(); setBudget(null); }
    for (const body of [{ error: { message: 'No endpoints found that satisfy the max price for this request', code: 404 } }, { error: { message: 'Model not found', code: 404 } }]) {
      const s = await stub(body);
      try {
        setBudget(5);
        await assert.rejects(runSingleStage({ provider: 'openrouter', model: MODEL, lab: 'orx', maxTokens: 500, baseUrl: s.url }, { system: 's', user: 'u', label: 'probe' }), e => e instanceof PriceRefused);
        const st = budgetState();
        assert.equal(st.spent, 0, 'a refused call is booked at $0');
        assert.equal(st.reserved, 0, 'its reservation is settled');
      } finally { await s.close(); setBudget(null); }
    }
  } finally {
    if (prev === undefined) delete process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; else process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = prev;
    if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had;
  }
});
