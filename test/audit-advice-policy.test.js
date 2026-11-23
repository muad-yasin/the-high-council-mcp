// 0.8.2 item 1 (owner via C&C, 7 Oct 2026: "Terminal rule only, no cap change"): the advice send path's policy max_usd_per_run REFUSES on the call's EXPECTED cost and only WARNS on its ceiling, like the CLI's
// evaluatePolicy. $0, no network.
// 0.8.4 (the add-on removal, wave 2): the advice send path is removed, so the tests that drove it are removed with it: the preview and dialog text (previewText, dialogMessage of src/send-path.js) and the quote-versus-adopt-gate
// agreement (preSendRefusals of src/send-path-refusals.js). evaluatePolicy and its `figure: 'call'` wording are in src/policy.js and stay, so that one test stays unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy } from '../src/policy.js';

test('item 1: evaluatePolicy with figure "call": refuses on the first figure, warns on the second, in the advice words (the CLI words are unchanged)', () => {
  const ctx = { config: {}, allSeats: [], monthToDateUsd: 0 };
  const call = lim => evaluatePolicy({ max_usd_per_run: lim }, { ...ctx, worstCaseUsd: 0.4, maximumUsd: 1.32, figure: 'call' });
  assert.deepEqual([call(1).ok, call(1).warnings.length], [true, 1]);
  assert.match(call(1).warnings[0], /the expected cost of this call's chain \(the first figure --dry-run prints\) is \$0\.4000, within the \$1\.0000 limit, but the most this call can spend \(its ceiling\) is \$1\.3200/);
  assert.equal(call(0.3).ok, false);
  assert.match(call(0.3).reasons.join(' '), /the expected cost of this call's chain .* is \$0\.4000 and the most this call can spend \(its ceiling\) \$1\.3200, over the \$0\.3000 limit/);
  assert.equal(call(2).warnings.length, 0);
  assert.match(evaluatePolicy({ max_usd_per_run: 1 }, { ...ctx, worstCaseUsd: 1.32 }).reasons.join(' '), /this chain's expected cost \(the first figure --dry-run prints\) is \$1\.3200/);
});
