// 0.8.4 S8 (M3): the ending rows T15h, T17s and T17al. The fixtures and ALL assertions live in test/helpers/s8-end-rows.js (run<ROW> builds and runs, check<ROW> asserts, premises first). T17s and T17al share ONE run (one fixture, two checks);
// T15h has a swapped-input red variant, and so do T17s (the block re-tagged to 7) and T17al (a good_to_build that names no id): those run on the box only (test/s8-end-rows-red.test.js, never committed).
import test, { afterEach } from 'node:test';
import { setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { runT15h, checkT15h, runT17sAl, checkT17s, checkT17al } from './helpers/s8-end-rows.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });

test('T15h (CA4): an agreed ending after the final read with a may-leave block recorded names its basis (layer 3\'s sign-off, the handler\'s check, the dissent on the record), so it is distinguishable from a whole-panel sign-off. Failing case: the ending reads as a whole-panel sign-off with no basis named', async () => {
  checkT15h(await runT15h());
});

test('T17s + T17al (Q8): a dissent on a block rated 5.0 (not re-tagged) is on the record under the seat\'s name with its rating, status open and layer 3\'s reasons, its layer counted as not signed and not blocking, the seat recorded as dissenting; the ending is not held. Failing cases: the dissent is dropped; the ending is held', async () => {
  const d = await runT17sAl();
  checkT17al(d);   // first: a held run (waiting at the build check) is named by T17al, not by a premise of T17s
  checkT17s(d);
});
