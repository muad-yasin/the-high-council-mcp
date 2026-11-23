// 0.8.4 S8 (M3): the closing-read rows T9g, T13l and T13t. The fixtures and ALL assertions live in test/helpers/s8-closing-rows.js (shared with the red-only file test/s8-closing-rows-red.test.js, which runs the same
// assertions on the swapped input). Each row here states the correct behaviour; premise assertions come first, so a red is never a fixture error. Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import { setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { runT9g, checkT9g, runT13, checkT13l, checkT13t } from './helpers/s8-closing-rows.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

test('S8-CR-1 (T9g) a finish at the found-secret pause on a plan text that both layer-3 seats have read as it stands makes 0 closing-read calls and carries their last statements as the read. Failing case: a fresh read of 2 calls is made', async () => {
  checkT9g(await runT9g());
});

test('S8-CR-2 (T13l) a closing read of a never-read plan whose statements are unreadable twice makes 4 calls (a read and one re-ask for each of the two layer-3 seats), both entries "did not read" with a why, the ending untouched. Failing case: it is priced at 6 (the price half is another unit\'s; this row pins the 4 calls)', async () => {
  checkT13l(await runT13());
});

test('S8-CR-3 (T13t) the same closing read costs at most 2 x K3 = 4 calls, not 2. Failing case: it is priced at 2 (the price half is another unit\'s; this row pins the 4 calls)', async () => {
  checkT13t(await runT13());
});
