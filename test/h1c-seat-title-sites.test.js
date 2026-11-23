// 0.8.4 H1-c (Builder B; lane C's hub row): src/chain.js sends the propose and reply prompts through the helpers of src/stage-system.js (proposerSystemFor, replySystemFor), which place a seat's title before the reply format. Offline, $0, no run.
// The behaviour is proved through runChain in test/seat-title.test.js (PROPOSE and REPLY, injected, in a run); this file pins the routing so a new direct call cannot go round the helpers again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');

test('H1C-1: no direct R.proposerSystem( or R.replySystem( call is left in src/chain.js; two propose sites call proposerSystemFor(config, seat, open), three reply sites call replySystemFor', () => {
  assert.equal((src.match(/R\.proposerSystem\(/g) || []).length, 0, 'a direct R.proposerSystem( call is left');
  assert.equal((src.match(/R\.replySystem\(/g) || []).length, 0, 'a direct R.replySystem( call is left');
  assert.equal((src.match(/proposerSystemFor\(config, seat, open\)/g) || []).length, 2, 'the two propose sites (the first ask and the retry)');
  assert.equal((src.match(/replySystemFor\(config, seatOf\(lab\), guard\)/g) || []).length, 2, 'the two reply sites (the ask and its incomplete-reply retry)');
  assert.equal((src.match(/replySystemFor\(config, seat, guard\)/g) || []).length, 1, 'the canary reply site');
});
