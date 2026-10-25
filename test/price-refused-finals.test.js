// Astra items 32-35 (20 Okt 2026, C&C ruling: a false sentence must not stay in code). The price-refusal stop no longer says "The spend cap rises with the price you type"; it says what a typed price does (counted at that price
// before and after the call, so recorded cost can read higher than the bill; the cap itself does not change); its copyable example is valid JSON and does NOT print the table price. A-DRAFT wording.
import test from 'node:test';
import assert from 'node:assert/strict';

test('PRF-1: no "spend cap rises"; the overstatement is named; the copyable example parses as JSON, covers every refused seat, and is not the table price; the unrecognised line says what the answer did not say', async () => {
  const { PriceRefused, priceRefusedWords } = await import('../src/price-refused.js');
  const mk = (seat, over = {}) => new PriceRefused({ seat, label: 'panel-1-orx', pin: { prompt: 0.4, completion: 1.6 }, row: { in: 0.4, out: 1.6 }, said: 'No endpoints found that satisfy the max price for this request', recognised: true, lab: 'orx', ...over });
  const first = mk('openrouter/qwen/qwen3.7-plus'); first.also = [mk('openrouter/other/model', { row: { in: 2, out: 6 } })];
  const text = priceRefusedWords(first, { runPath: 'runs/R1' });
  assert.ok(!/spend cap rises/.test(text), 'the false sentence is gone');
  assert.match(text, /The recorded cost is the tokens used times the price you typed, so it can read higher than the bill if a cheaper host served the call; the limit you typed does not change/);
  const example = JSON.parse(text.match(/for example (\{.*?\}) \(US dollars/)[1]);   // parses as JSON (the red: the old example held "(or more)")
  assert.deepEqual(Object.keys(example), ['openrouter/qwen/qwen3.7-plus', 'openrouter/other/model']);
  assert.notDeepEqual(example['openrouter/qwen/qwen3.7-plus'], { in: 0.4, out: 1.6 }, 'the example is not the refused table price');
  assert.ok(example['openrouter/qwen/qwen3.7-plus'].in > 0.4 && example['openrouter/other/model'].out > 6, 'both numbers are higher than the table price');
  assert.ok(text.includes('$0.4 in / $1.6 out per million tokens') && text.includes('$2 in / $6 out per million tokens') && text.includes('only a higher number changes anything'), 'the table price is stated beside the example');
  assert.match(priceRefusedWords(mk('openrouter/qwen/qwen3.7-plus', { recognised: false, said: 'Model not found' }), { runPath: 'runs/R1' }), /OpenRouter's answer does not say the price is the problem/);
  // a seat with no table row: no number is suggested at all
  const noRow = priceRefusedWords(mk('openrouter/new/model', { row: null }), { runPath: 'runs/R1' });
  assert.match(noRow, /For openrouter\/new\/model no table price is known: add a row with the model's listed input and output prices \(no number is suggested here\)/);
  assert.ok(!/for example/.test(noRow), 'no example with an invented number');
  // the example says what copying it unchanged does
  assert.match(text, /copied unchanged it sets the limits to twice today's table values \(shown below\)\. Check them before use/);
});

test('PRF-2: the source of the pin is true either way: the seat\'s own provider.max_price is named as such, not "the shipped price table"', async () => {
  const { PriceRefused, priceRefusedWords } = await import('../src/price-refused.js');
  const mk = over => new PriceRefused({ seat: 'openrouter/qwen/qwen3.7-plus', label: 'panel-1-orx', pin: { prompt: 0.5, completion: 2 }, row: { in: 0.4, out: 1.6 }, said: 'No endpoints found that satisfy the max price for this request', recognised: true, lab: 'orx', ...over });
  const own = priceRefusedWords(mk({ ownPin: true }), { runPath: 'runs/R1' });
  assert.match(own, /set by the seat's own provider\.max_price in the chain/);
  assert.ok(!/from the shipped price table/.test(own), 'not claimed to come from the table');
  assert.match(priceRefusedWords(mk({}), { runPath: 'runs/R1' }), /from the shipped price table/);
});

test('PRF-3: a seat whose own provider.max_price set the pin is kept out of the pricing.user.json example and told to raise the chain\'s own fields; the real call path marks it (ownPin)', async () => {
  const { PriceRefused, priceRefusedWords } = await import('../src/price-refused.js');
  const mk = (seat, over = {}) => new PriceRefused({ seat, label: 'panel-1-orx', pin: { prompt: 0.5, completion: 2 }, row: { in: 0.4, out: 1.6 }, said: 'No endpoints found that satisfy the max price for this request', recognised: true, lab: 'orx', ...over });
  const own = priceRefusedWords(mk('openrouter/own/model', { ownPin: true }), { runPath: 'runs/R1' });
  assert.ok(!/for example/.test(own), 'no pricing.user.json example for an own-pin seat');
  assert.match(own, /Recommended: if you accept the higher price, raise the fields of the seat's own provider\.max_price in your chain \(the stages already finished are kept\)\./);
  assert.match(own, /For openrouter\/own\/model: the price limit comes from the seat's own provider\.max_price in the chain, and a pricing\.user\.json row does not change a field it sets, so raise those fields in your chain\. A field the seat leaves out is priced from the price table: raise that one with a pricing\.user\.json row\. The stages already finished are kept\./);
  assert.match(own, /To use the copy with --resume \(only for a chain that came with the package; a chain of your own is changed where it is\): --resume reads the chain by the name recorded in the run and looks first in the chains\/ folder of the project the run was started in, so save the copy there under the same name\. The resume then stops once at the spending-limit screen, because the chain file changed, and you type the limit again\./, 'the copy must be saved where --resume looks (cli.js configPath), under the run\'s chain name');
  const first = mk('openrouter/table/model'); first.also = [mk('openrouter/own/model', { ownPin: true })];
  const mixed = priceRefusedWords(first, { runPath: 'runs/R1' });
  assert.deepEqual(Object.keys(JSON.parse(mixed.match(/for example (\{.*?\}) \(US dollars/)[1])), ['openrouter/table/model'], 'only the table seat is in the example');
  assert.match(mixed, /Recommended: if you accept the higher price, raise openrouter\/table\/model in a pricing\.user\.json row, and openrouter\/own\/model through the fields of the seat's own provider\.max_price in your chain \(the stages already finished are kept\)\./, 'a mixed set gets one recommendation per source, not a row for the own-pin seat');       // red with src/price-refused.js of 8999685 (the own-pin words, the old "raise it in a pricing.user.json row for each" for a mixed set)
  // the real path: runSingleStage marks the refusal with the seat's own pin (the field name cannot drift from chain.js)
  const { createServer } = await import('node:http');
  const srv = createServer((req, res) => { req.on('data', () => {}); req.on('end', () => { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'No endpoints found that satisfy the max price for this request', code: 404 } })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}/v1`;
  const { runSingleStage } = await import('../src/chain.js');
  const had = process.env.OPENROUTER_API_KEY; process.env.OPENROUTER_API_KEY = 'sk-test';
  const prev = process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = '1';
  try {
    const seat = extra => ({ provider: 'openrouter', model: 'qwen/qwen3.7-plus', lab: 'orx', maxTokens: 500, baseUrl: url, ...(extra ? { extra } : {}) });
    await assert.rejects(runSingleStage(seat({ provider: { max_price: { prompt: 0.5, completion: 2 } } }), { system: 's', user: 'u', label: 'probe-own' }), e => e instanceof PriceRefused && e.ownPin === true && JSON.stringify(e.ownFields) === '["prompt","completion"]');
    await assert.rejects(runSingleStage(seat({ provider: { max_price: { prompt: 0.5 } } }), { system: 's', user: 'u', label: 'probe-one' }), e => e instanceof PriceRefused && e.ownPin === true && JSON.stringify(e.ownFields) === '["prompt"]', 'the entry carries which fields the seat set (FIX 2)');
    await assert.rejects(runSingleStage(seat(null), { system: 's', user: 'u', label: 'probe-table' }), e => e instanceof PriceRefused && e.ownPin === false);
  } finally {
    await new Promise(r => srv.close(r));
    if (prev === undefined) delete process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST; else process.env.COUNCIL_ALLOW_LOOPBACK_KEY_HOST = prev;
    if (had === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = had;
  }
});

test('PRF-4: the sentences about "a field the seat leaves out" are printed only where a field is left out (C&C thcmcp-cd FIX 2, 23 Okt 2026; A-DRAFT): a seat that sets both fields gets neither; a seat that sets one, or whose fields are not known, keeps both', async () => {
  const { PriceRefused, priceRefusedWords } = await import('../src/price-refused.js');
  const mk = (seat, over = {}) => new PriceRefused({ seat, label: 'panel-1-orx', pin: { prompt: 0.5, completion: 2 }, row: { in: 0.4, out: 1.6 }, said: 'No endpoints found that satisfy the max price for this request', recognised: true, lab: 'orx', ownPin: true, ...over });
  const LEFT = /A field the seat leaves out is priced from the price table: raise that one with a pricing\.user\.json row\./; const SRC = /\(a field it leaves out comes from the price table\)/;
  const both = priceRefusedWords(mk('openrouter/own/model', { ownFields: ['prompt', 'completion'] }), { runPath: 'runs/R1' });
  assert.doesNotMatch(both, LEFT, 'both fields set: nothing is left out');           // red with src/price-refused.js of 8cb0a30 (the sentence is printed for every own-pin seat)
  assert.doesNotMatch(both, SRC);
  assert.match(both, /set by the seat's own provider\.max_price in the chain[);]/, 'the source is still named');
  assert.match(both, /so raise those fields in your chain\. The stages already finished are kept\./, 'the rest of the sentence is unchanged');
  for (const fields of [['prompt'], ['completion'], null]) {
    const w = priceRefusedWords(mk('openrouter/own/model', fields ? { ownFields: fields } : {}), { runPath: 'runs/R1' });
    assert.match(w, LEFT, `${JSON.stringify(fields)}: a field may be left out`); assert.match(w, SRC);
  }
  const first = mk('openrouter/a/model', { ownFields: ['prompt', 'completion'] }); first.also = [mk('openrouter/b/model', { ownFields: ['completion'] })];
  assert.match(priceRefusedWords(first, { runPath: 'runs/R1' }), LEFT, 'a set where ANY own seat leaves a field out keeps the sentence');
});
