// 0.8.4 S8 (M3): the handler/closing rows T15p, T17o, T17g, T17ag. The fixtures and ALL assertions live in test/helpers/s8-handler-rows.js (run<ROW> builds and runs, check<ROW> asserts, premises first).
// T17o and T17g are NAMED PINS (no input makes their event happen); T15p and T17ag have a swapped-input red variant that is run on the box only (test/s8-handler-rows-red.test.js, never committed).
import test, { afterEach } from 'node:test';
import { setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { runT15p, checkT15p, runT17o, checkT17o, runT17g, checkT17g, runT17ag, checkT17ag } from './helpers/s8-handler-rows.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });

test('T15p (CA4): layer 3 signs off after an escalated sign-off and the handler answers good_to_build with the final read on; no lower layer is asked to read or sign the final text. Failing case: a lower layer is asked', async () => {
  checkT15p(await runT15p());
});

test('T17o (Q8, Q2; NAMED PIN) an N5 send-up of an objection rated 5.0, overruled at layer 2, layer 3 signs: the objection stays open on the record, layer 3 sorts it at the final read, and its seat is not called at the sign-off. Fail condition: a call to the sent-up seat at or after the sign-off, or the objection closed/unsorted', async () => {
  checkT17o(await runT17o());
});

test('T17g (Q8; NAMED PIN) an open objection of a lower seat that was debated: no new exchange and no ruling call, only layer 3\'s sorting at the final read. Fail condition: the debated id is debated again (in the ending exchange) or a rule- call is made', async () => {
  checkT17g(await runT17g());
});

test('T17ag (Q8) layer 3 sorts a block rated 5.0 may-leave: the ending is not held up: the handler\'s good_to_build naming the block ends the run agreed. Failing case: the sorting holds up the ending', async () => {
  checkT17ag(await runT17ag());
});
