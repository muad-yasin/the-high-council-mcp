// 0.8.4 S6 (M1), U6-3: the two held sentences of the shortened exchange in the PROMPTS (src/stage-system.js): W5 ends both exchange prompts of a seat above the lowest layer, W14 ends its reply prompt, and the estimate (systemTextsFor) and the send read ONE text.
// Offline, mock seats only, $0. WRITTEN WITHOUT A RUN (overnight, no box). The rows compare the recorded text of a seat above the lowest layer with the text of a layer-1 seat, which carries neither tail (the PIN row); the rows that run a chain inject the pair (setHeldForTest).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { layerDebateSystemFor, layerReplySystemFor, systemTextsFor } from '../src/stage-system.js';
import { setHeldForTest } from '../src/held-roles.js';
import * as R from '../src/roles.js';
import * as HB084 from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const PAIR = { shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule };
const W5 = R.shortExchangeRule(); const W14 = R.signoffLineRule();   // the recorded sentences (the held mirror test/held-prompts/held-084-b.js is compared with them by its own file)
// The ORDINARY exchange text of this chain, built from the recorded pieces (no tail of the pair): this chain is layered with the rating demand recorded, has no answer_back and no handling session, so the exchange words carry the rating variant only (no ledger, no handler sentence); round 1 of the post prompt ends with W1's own-quote sentence; the reply prompt ends with the anchor rule and the quote sentence.
const SEV = { severity: true };
const ordinaryPost = again => R.layerDebateSystem(again, SEV) + (again ? '' : `\n\n${R.layerDebateOwnQuoteSentence()}`);
const ordinaryReply = again => `${R.layerReplySystem(again, SEV)}\n\n${R.layerReplyAnchorRule()}\n\n${R.layerReplyQuoteSentence()}`;
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const critics = [seat('mock-exch-support-keep-sev3', 'a1', 1), seat('mock-exch-contest-keep-clean', 'b1', 1), seat('mock-exch-support-keep', 'r2', 2), seat('mock-exch-contest-keep-clean', 'p2', 2), seat('mock-exch-support-keep-clean', 't3', 3)];
const chainOf = (extra = {}) => ({
  name: 'short-exchange-prompts', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics }, ...extra,
});
const composed = (held, config = chainOf()) => { setHeldForTest(held); return critics.map(s => [false, true].map(again => [layerDebateSystemFor(config, s, again), layerReplySystemFor(config, s, again)])); };

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the PIN row compared the prompts under held maps (nothing, one word of the pair) with `composed(null)`, and the W5/W14 row built its expected text as `composed(null)` plus the tails. After the recording both are the recorded state (a partial map falls through to the recorded words), so the held comparison could not fail and the expected text carried W5 twice. NEW: the ordinary text is built from the recorded pieces (R.layerDebateSystem / layerReplySystem with the rating variant, the own-quote sentence, the anchor rule and the quote sentence); a layer-1 seat is sent exactly that, a seat above it exactly that plus W5 (plus W14 on the reply). The held half is removed (K7), its sibling is the next row.
test('PIN: a seat of the lowest layer is sent exactly the ordinary exchange text, built from the recorded pieces, with neither W5 nor W14', () => {
  const table = composed(null);
  critics.forEach((s, i) => {
    if (s.layer !== 1) return;
    [false, true].forEach((again, j) => {
      assert.equal(table[i][j][0], ordinaryPost(again), `${s.lab} (layer 1) post prompt (again ${again}) is the ordinary text`);
      assert.equal(table[i][j][1], ordinaryReply(again), `${s.lab} (layer 1) reply prompt (again ${again}) is the ordinary text`);
    });
    assert.ok(table[i].flat().every(t => !t.includes(W5) && !t.includes(W14)), `${s.lab} (layer 1) carries neither tail`);
  });
  assert.ok(W5.length > 40 && W14.length > 40, 'the recorded tails are whole sentences, not empty strings');
});

test('W5 and W14 (Q5): a seat above the lowest layer is sent EXACTLY the ordinary exchange text and then W5 at the end of BOTH exchange prompts and W14 at the very end of its reply prompt, in both round forms; nothing else in them moves', () => {
  const table = composed(null);
  critics.forEach((s, i) => {
    if (s.layer === 1) return;
    [false, true].forEach((again, j) => {
      assert.equal(table[i][j][0], `${ordinaryPost(again)}\n\n${W5}`, `${s.lab} post prompt (again ${again}): the ordinary text, then W5`);
      assert.equal(table[i][j][1], `${ordinaryReply(again)}\n\n${W5}\n\n${W14}`, `${s.lab} reply prompt (again ${again}): the ordinary text, then W5, then W14`);
    });
  });
});

const RUN_CHAIN = chainOf({ maxRounds: 1 });
async function runIt() {
  const prompts = new Map();
  setPromptSpy(p => { prompts.set(p.label, p); });
  setHeldForTest({ ...DEMAND, ...PAIR });
  const r = await runChain({ request: 'A mock task.', log() {}, runId: 'r-short-prompts', config: RUN_CHAIN });
  return { r, prompts };
}

test('W5 and W14 in a run: the prompts SENT to the layer-2 judges carry them, the prompts sent to the layer-1 judges do not; and what is sent is among the texts the estimate prices for that label (priced = sent)', async () => {
  const { prompts } = await runIt();
  const sent = label => { const p = prompts.get(label); assert.ok(p, `${label} was sent`); return p.system; };
  assert.equal(sent('ldebate-1-p2').endsWith(W5), true, 'layer 2 post prompt ends with W5');
  assert.equal(sent('lreply-1-r2').endsWith(`${W5}\n\n${W14}`), true, 'layer 2 reply prompt ends with W5 and W14');
  for (const label of ['ldebate-1-b1', 'lreply-1-a1']) assert.equal(sent(label).includes(W5) || sent(label).includes(W14), false, `${label} (layer 1) carries neither`);
  const resolved = critics;   // mock seats are not changed by seat resolution
  for (const [label, who] of [['ldebate-1-p2', 'p2'], ['lreply-1-r2', 'r2'], ['ldebate-1-b1', 'b1'], ['lreply-1-a1', 'a1']]) {
    const texts = systemTextsFor(label, chainOf(), resolved.find(s => s.lab === who));
    assert.ok(texts.includes(sent(label)), `${label}: the estimate prices the text that was sent`);
  }
});
