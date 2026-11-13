// 0.8.4 S2/S3: the two held sentences that end a judge's prompt (W6, the relation each failure declares; W2, the anchor of a raiser's withdrawal) are composed in src/stage-system.js (panelPromptFor, layerReplySystemFor), so the cost estimate
// (systemTextsFor) and the send read ONE text. Offline, $0. Injected with setHeldForTest; inert (byte-identical) until src/roles.js records them.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { systemTextsFor } from '../src/stage-system.js';
import * as HB084 from './held-prompts/held-084-b.js';
import * as HS14 from './held-prompts/held-084-s14.js';

afterEach(() => { setHeldForTest(null); setCache(null); setBudget(null); setPromptSpy(null); });
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const config = { name: 'held-estimate', maxRounds: 1, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' },
    critics: [seat('mock-exch-support-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e9', 2)] } };
const W6 = HB084.relationRule(); const W2 = HB084.layerReplyAnchorRule(); const W24 = HS14.layerReplyQuoteSentence();
// `inject`: the held functions to record for the run. Recording W6 turns the id assigner on (a failure without a declared relation is then an unreadable reply), which the mock judges do not declare: so the W2 test records W2 alone.
const sent = async (inject, cfg = config) => {
  setHeldForTest(inject);
  const seen = []; setPromptSpy(p => seen.push(p));
  await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-held-estimate', config: cfg });
  return seen;
};
const priced = (label, cfg = config) => systemTextsFor(label, cfg, cfg.seats.critics[0]);
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state; K8 fixture needs answer_back): OLD: the W6 row read the relation sentence on a chain without answer_back. NEW: it reads it on a copy of the chain with answer_back on. WHY: the relation sentence is sent only where answer_back is on (the C&C decision of 11 Nov 2026, src/stage-system.js panelPromptFor); the W2 row keeps the chain as it was.
const configAB = { ...config, answer_back: { enabled: true } };

test('W6: with the words injected, every priced panel- text and the sent panel- prompt end with the relation sentence; the first-mode critic- row does not carry it', async () => {
  const seen = await sent({ relationRule: HB084.relationRule }, configAB);
  const panel = seen.find(p => p.label === 'panel-1-e1').system;
  assert.deepEqual([priced('panel-L1-e1', configAB).every(t => t.endsWith(W6)), panel.endsWith(W6), priced('critique-1', configAB).some(t => t.endsWith(W6))], [true, true, false]);
});
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: W2's row asserted the priced and the sent lreply- prompt END with the anchor sentence, and 'before the words are recorded the priced and the sent prompts carry neither sentence' asserted the held state. NEW: the lreply- prompt ends with W2 followed by W24's sentence, in that order (stage-system.js layerReplySystemFor: replyAnchorTail() then the layerReplyQuoteSentence tail) (K5); the held row is removed (K7, SIBLINGS: the W6 and W2 rows). WHY: layerReplyAnchorRule (W2) and layerReplyQuoteSentence (W24) are recorded.
test('W2: with the words injected, every priced lreply- text and the sent lreply- prompt end with the anchor sentence and then W24\'s quote sentence', async () => {
  const seen = await sent({ layerReplyAnchorRule: HB084.layerReplyAnchorRule });
  const reply = seen.find(p => /^lreply-1-/.test(p.label)).system;
  assert.deepEqual([priced('lreply-L1-e1').every(t => t.endsWith(`${W2}\n\n${W24}`)), reply.endsWith(`${W2}\n\n${W24}`)], [true, true]);
});

