// 0.8.4 S8 (M3): the stop rows T11b and T9a. The fixtures and ALL assertions live in test/helpers/s8-stop-rows.js (shared with the red-only file test/s8-stop-rows-red.test.js, which runs the same
// assertions on the swapped input). Each row here states the correct behaviour; premise assertions come first, so a red is never a fixture error. Offline, mock seats, $0.
// The "no closing read before the choice" half of T11b is a NAMED PIN (no input makes a final-read label appear before the stop is thrown; fail condition in the helper); the rest of T11b and all of T9a have a red variant on the box only.
import test, { afterEach } from 'node:test';
import { setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { runT11b, checkT11b, runT9a, checkT9a } from './helpers/s8-stop-rows.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

test('S8-ST-1 (T11b) with the cap at 4 overseer rounds and the top layer still objecting in round 4, the run stops (resumable, not agreed) with the top seat\'s sorting attached to the stopped partial and no closing-read call before the choice. Failing case: a fifth round opens without a continue', async () => {
  checkT11b(await runT11b());
});

test('S8-ST-2 (T9a) a finish on a plan text that both layer-3 seats have read exactly as it stands makes 0 layer-3 calls and reuses each seat\'s statement and sorting. Failing case: a new layer-3 call', async () => {
  checkT9a(await runT9a());
});
