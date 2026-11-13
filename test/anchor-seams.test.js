// 0.8.4 S14, the seams of the held wording (test/held-prompts/held-084-s14.js): W24 after the raiser's reply prompt, W1's clause after the round-1 post prompt, and the post's block that lists the judge's own failures that quote nothing.
// All three are inert (byte-identical prompts) until src/roles.js records them: each row says what it injects. The words are the plan's (pinned in test/anchor-wording.test.js); here only WHERE they go and WHEN. Offline, mock seats, $0.
// (W23, the critic template's sentence, is its own commit and its own file: test/anchor-w23.test.js.)
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setCache, setBudget, setPromptSpy } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { layerDebateSystemFor, layerReplySystemFor, systemTextsFor } from '../src/stage-system.js';
import { objectionId } from '../src/objection-ids.js';
import * as HS14 from './held-prompts/held-084-s14.js';

afterEach(() => { setCache(null); setBudget(null); setPromptSpy(null); setHeldForTest(null); });
const CRITERION = 'It states the assumptions it was written under.';
const COARSE = lab => objectionId(lab, { criterion: CRITERION });
const seat = (model, lab, layer) => ({ provider: 'mock', model, lab, layer });
const chainOf = critics => ({
  name: 'anchor-seams-test', maxRounds: 2, signoff: 'unanimous', estimate: { promptTokens: 500, draftTokens: 500, critiqueTokens: 200 },
  seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder', lab: 'author' }, reviser: { provider: 'mock', model: 'mock-builder', lab: 'author' }, critics },
});
const CONFIG = chainOf([seat('mock-exch-contest-keep', 'e1', 1), seat('mock-exch-contest-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)]);
const SEAT = CONFIG.seats.critics[0];
const WORDS = { layerReplyQuoteSentence: HS14.layerReplyQuoteSentence, layerDebateOwnQuoteSentence: HS14.layerDebateOwnQuoteSentence, ownFailuresBlock: HS14.ownFailuresBlock };
const times = (s, sub) => s.split(sub).length - 1;
const go = async (critics, held = null) => { const seen = []; setPromptSpy(p => seen.push(p)); setHeldForTest(held); const r = await runChain({ request: 'A mock task.', log: () => {}, runId: 'r-anchor-seams', config: chainOf(critics) }); return { r, seen }; };

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: AS-1, AS-2, AS-4 and AS-5 compared the recorded prompt with the prompt built while the words were held (`base`, `setHeldForTest(null)`) and checked that unrecorded nothing was added. NEW: the held halves are removed (K7: after the recording no shipped run is held; SIBLING in each row: its recorded half, and AS-3 for the estimate); the sentences are asserted whole and once on the recorded prompts, and the ending exchange's prompts are asserted free of both sentences (K5). WHY: layerReplyQuoteSentence, layerDebateOwnQuoteSentence and ownFailuresBlock are recorded (recorded-084-s14.js).
test('AS-1 W24 follows the raiser\'s reply prompt in every round', () => {
  for (const again of [false, true]) {
    const out = layerReplySystemFor(CONFIG, SEAT, again);
    assert.equal(times(out, HS14.layerReplyQuoteSentence()), 1, `again=${again}`);
    assert.ok(out.includes(`\n\n${HS14.layerReplyQuoteSentence()}`), `again=${again}: the sentence stands as its own paragraph`);
  }
});

test('AS-2 W1\'s clause follows the post prompt in ROUND 1 only (again=false), not in a later round', () => {
  const first = layerDebateSystemFor(CONFIG, SEAT, false); const later = layerDebateSystemFor(CONFIG, SEAT, true);
  assert.equal(times(first, HS14.layerDebateOwnQuoteSentence()), 1);
  assert.ok(first.includes(`\n\n${HS14.layerDebateOwnQuoteSentence()}`), 'the clause stands as its own paragraph');
  assert.equal(times(later, HS14.layerDebateOwnQuoteSentence()), 0, 'a later round has no clause');
});

test('AS-3 the estimate prices what is sent: the ldebate and lreply rows carry the sentences through the same two functions', () => {
  setHeldForTest(WORDS);
  assert.ok(systemTextsFor('lreply-1-e1', CONFIG, SEAT).every(t => times(t, HS14.layerReplyQuoteSentence()) === 1), 'every lreply text carries W24');
  const posts = systemTextsFor('ldebate-1-e1', CONFIG, SEAT);
  assert.ok(posts.some(t => times(t, HS14.layerDebateOwnQuoteSentence()) === 1) && posts.some(t => times(t, HS14.layerDebateOwnQuoteSentence()) === 0), 'the round-1 text carries the clause, the later one does not');
});

test('AS-4 REAL RUN, recorded: in round 1 each judge\'s post lists ITS OWN failures that quote nothing (id and criterion), and only those, and a later round lists none; the own_quote it gives is attached to that objection under its raise-time id', async () => {
  const critics = [seat('mock-exch-ownq-keep', 'e1', 1), seat('mock-exch-support-keep', 'e2', 1), seat('mock-critic-x', 'e3', 2)];
  const { r, seen } = await go(critics);
  const post1 = seen.find(p => p.label === 'ldebate-1-e1');
  assert.ok(post1, 'the premise: e1 posted in round 1');
  assert.ok(post1.user.includes(`Your own failures that quote nothing:\n- ${COARSE('e1')}: ${CRITERION}`), 'e1\'s own unquoted failure is listed');
  assert.ok(!post1.user.includes(`- ${COARSE('e2')}: `), 'e2\'s failure is not listed to e1');
  assert.equal(times(post1.system, HS14.layerDebateOwnQuoteSentence()), 1);
  const later = seen.find(p => /^ldebate-1-x2-e1/.test(p.label));
  if (later) assert.ok(!later.user.includes('Your own failures that quote nothing:'), 'a later round lists no block');
  const row = r.layerDebates[0].objections.find(o => o.raised_by === 'e1');
  assert.ok(row.attached_quote && !row.quote && /^ldebate-1-e1/.test(row.quote_attached_in), `the own_quote is attached: ${JSON.stringify([row.attached_quote, row.quote_attached_in])}`);
  assert.equal(row.id, COARSE('e1'), 'under the id it was raised with');
});

test('AS-5 the ENDING exchange keeps its own prompts: asked as the ending exchange (the fourth argument), the debate and reply texts carry neither W24 nor W1\'s clause even when recorded; the ending call in src/chain.js asks that way', async () => {
  const ending = [false, true].flatMap(again => [layerDebateSystemFor(CONFIG, SEAT, again, { ending: true }), layerReplySystemFor(CONFIG, SEAT, again, { ending: true })]);
  assert.ok(ending.every(t => times(t, HS14.layerReplyQuoteSentence()) === 0 && times(t, HS14.layerDebateOwnQuoteSentence()) === 0), 'the ending exchange\'s prompts carry neither sentence');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/chain.js', import.meta.url), 'utf8');
  assert.match(src, /\(config, seat, again, \{ ending: true \}\), severity: severityOn, ending: \{/, 'the ending exchange\'s call asks for the ending form');
});
