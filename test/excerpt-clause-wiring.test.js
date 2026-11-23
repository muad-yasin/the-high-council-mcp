// 0.8.4 H8 (Builder A's slot in src/stage-system.js; Mini-C&C R478, 08 Nov 2026): D30's two "only source" sentences (held names `criticOnlySourceSentence`, `reviserOnlySourceSentence`) reach the prompts a seat is sent.
// criticPromptFor wraps the critic system text with withExcerptClause(..., 'critic', fencedSource) before the persona and the lane; the function reviserSystemFor returns wraps the reviser text the same way ('reviser').
// Every reviser site in src/chain.js (deep-dive-revise, the revise loop, the allocator, challenge-revise) and the estimate (reviserTexts, the panel, critique and final-read cost rules) reach them through those two.
// INERT until src/roles.js records the words (the release apply): nothing recorded gives today's bytes. Offline, $0. Only exports that exist on the parent are imported, so on a tree without H8 each row fails by its own assertion.
// ADDED (R478): every criticSystem form (open and closed scope, each freedom, the rating demand on and off) carries the critic sentence exactly once through criticPromptFor, because withExcerptClause throws otherwise.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../src/roles.js';
import { setHeldForTest } from '../src/held-roles.js';
import { criticPromptFor, panelPromptFor, finalReadSystemFor, reviserSystemFor, systemTextsFor } from '../src/stage-system.js';
import { criticOnlySourceSentence, reviserOnlySourceSentence } from './held-prompts/held-084-a.js';
import { criticOnlySourceSentenceOrder } from './held-prompts/held-084-cache-order.js';
import { reviserSystemWithIds, patchReviserSystemWithIds } from './held-prompts/held.js';
import { DEMAND } from './helpers/rating-demand.js';
import { readChainFile } from './helpers/chain-file.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
afterEach(() => setHeldForTest(null));
const WORDS = { criticOnlySourceSentence, reviserOnlySourceSentence, reviserSystemWithIds, patchReviserSystemWithIds };
const CRITIC_OLD = /That fenced text is the ONLY thing you\s+know about the repository\./;
const REVISER_OLD = /Some of the task is real source code, fenced verbatim, and it is the only source anyone in\s+this chain has seen\./;
const times = (s, sub) => s.split(sub).length - 1;
const cfg = readChainFile(root, 'plan-mini-council');
const seat = cfg.seats.critics[0];
const FORMS = [{}, { criteriaKinds: true }, { selfReview: true }, { severity: true }, { severity: true, severityLedger: true, severityHandler: true }, { blocking_questions: true, pass: true }];

test('H8-1 the reviser: with the words recorded, every form the sites can send (plain, patch, with ids, patch with ids; closed and open scope; with and without decision records) carries the drafted sentence exactly once and no longer the old one', () => {
  setHeldForTest(WORDS);
  for (const answerBackOn of [false, true]) for (const patch of [false, true]) for (const open of [false, true]) for (const opts of [{}, { decisions: true }]) {
    const out = reviserSystemFor(answerBackOn, patch)(open, true, opts);
    const where = JSON.stringify({ answerBackOn, patch, open, opts });
    assert.equal(times(out, reviserOnlySourceSentence()), 1, where);
    assert.doesNotMatch(out, REVISER_OLD, where);
  }
});

test('H8-2 the critic: through criticPromptFor, every criticSystem form (open and closed scope, each freedom, the rating demand in force and not) carries the drafted sentence exactly once and no longer the old one (the ADDED row: withExcerptClause throws otherwise)', () => {
  for (const held of [WORDS, { ...WORDS, ...DEMAND }]) {
    setHeldForTest(held);
    for (const open of [false, true]) for (const form of FORMS) {
      const out = criticPromptFor(seat, open, { ...form, fencedSource: true }, cfg);
      const where = JSON.stringify({ demand: 'ratingDemand' in held, open, form });
      assert.equal(times(out, criticOnlySourceSentenceOrder()), 1, where);   // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state; H8-2, H8-3, H8-4, H8-5): OLD: the critic prompts of the shipped plan-mini-council carried criticOnlySourceSentence. NEW: that chain has prompt_cache on and the cache-shaped order is recorded, so withExcerptClause reads the order's own sentence (src/stage-system.js:283-288, heldName), criticOnlySourceSentenceOrder (recorded in src/prompts/recorded-084-cache-order.js:28); the pins count that sentence. WHY: the cache-order words recorded.
      assert.doesNotMatch(out, CRITIC_OLD, where);
    }
  }
});

test('H8-3 the other doors to the critic text carry it too: the panel prompt and the final read (fenced), and the persona and lane text around it are untouched', () => {
  setHeldForTest(WORDS);
  assert.equal(times(panelPromptFor(seat, false, { fencedSource: true }, cfg), criticOnlySourceSentenceOrder()), 1);
  assert.equal(times(finalReadSystemFor(seat, cfg, { fencedSource: true }), criticOnlySourceSentenceOrder()), 1);
  const wrapped = criticPromptFor(seat, false, { fencedSource: true }, cfg);
  setHeldForTest({ ...WORDS, criticOnlySourceSentenceOrder: () => '' });   // an empty draft leaves the shared text (only-source-bytes proves it), every other held word is the same in both calls
  const plain = criticPromptFor(seat, false, { fencedSource: true }, cfg);
  assert.equal(wrapped.replace(criticOnlySourceSentenceOrder(), plain.match(CRITIC_OLD)[0]), plain, 'the one sentence is the only difference between the recorded and the unrecorded prompt');
});

test('H8-4 the estimate prices the sentence: the system texts of a revise row, the deep-dive revise row, the panel rows and the fenced final-read rows carry the drafted words, so the upper estimate counts what is sent', () => {
  setHeldForTest(WORDS);
  const revise = systemTextsFor('revise-1', cfg, seat);
  assert.ok(revise.length > 0 && revise.some(t => times(t, reviserOnlySourceSentence()) === 1), 'a fenced revise text carries the reviser sentence');
  assert.ok(revise.every(t => times(t, reviserOnlySourceSentence()) <= 1));
  assert.ok(systemTextsFor('deep-dive-revise', cfg, seat).some(t => times(t, reviserOnlySourceSentence()) === 1));
  const panel = systemTextsFor('panel-1-a', cfg, seat);
  assert.ok(panel.length > 0 && panel.some(t => times(t, criticOnlySourceSentenceOrder()) === 1) && panel.every(t => times(t, criticOnlySourceSentenceOrder()) <= 1), 'the panel rows are priced for a fenced task');   // CHANGED ACCEPTED (0.8.4 A7 estimate, commit 0d892668): OLD every priced panel text carried the sentence; NEW a fenced variant carries it and an unfenced variant does not (the estimate prices the larger of the two). WHY: the same two-variant rule the final-read assertion below already states
  const finalRead = systemTextsFor('final-read-L3-c', cfg, seat);
  assert.ok(finalRead.some(t => times(t, criticOnlySourceSentenceOrder()) === 1) && finalRead.some(t => times(t, criticOnlySourceSentenceOrder()) === 0), 'the fenced variants carry it, the unfenced ones do not');
});

test('H8-5 PIN (green on both trees by construction; it cannot fail on the parent): a prompt with no fenced source is today\'s bytes', () => {
  // REMOVED (0.8.4 apply, recorded state; K7): the 'nothing recorded' half (the reviser text and the critic prompt are today's bytes with no excerpt words). A held state: the words are recorded in every shipped run. Sibling: the 'recorded, unfenced' loop just below (the shared reviser text and no critic sentence for a prompt with no fenced source).
  setHeldForTest(WORDS);
  for (const open of [false, true]) {
    assert.equal(reviserSystemFor(false, false)(open, false, {}), R.reviserSystem(open, false, {}), 'recorded, unfenced: the shared reviser text');
    assert.equal(times(criticPromptFor(seat, open, { fencedSource: false }, cfg), criticOnlySourceSentenceOrder()), 0, 'recorded, unfenced: no critic sentence');
    assert.equal(times(criticPromptFor(seat, open, undefined, cfg), criticOnlySourceSentenceOrder()), 0, 'recorded, no freedoms: no critic sentence');
  }
});

test('H8-6 SCAN: withExcerptClause is defined once and called from exactly criticPromptFor and the function reviserSystemFor returns; no other module of src/ mentions it, so chain.js and roles.js are untouched (the wiring is stage-system.js only)', () => {
  const srcDir = join(root, 'src'); const files = []; const stack = [srcDir];
  while (stack.length) { const d = stack.pop(); for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) stack.push(p); else if (n.endsWith('.js')) files.push(p); } }
  const mentions = files.filter(f => /withExcerptClause/.test(readFileSync(f, 'utf8'))).map(f => f.slice(srcDir.length + 1));
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: only stage-system.js mentions withExcerptClause. NEW: src/prompts/recorded-084-a.js also does, in a comment copied from the held file (recorded-084-a.js:123, 'src/stage-system.js withExcerptClause'); the list is compared sorted. WHY: the lane A words recorded (src/prompts/recorded-084-a.js).
  assert.deepEqual(mentions.sort(), ['prompts/recorded-084-a.js', 'stage-system.js']);
  const text = readFileSync(join(srcDir, 'stage-system.js'), 'utf8').split('\n').filter(l => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');   // code lines only: the docblocks name the helper too
  assert.equal((text.match(/export const withExcerptClause = /g) || []).length, 1, 'defined once');
  assert.equal((text.match(/withExcerptClause\(/g) || []).length, 2, 'called from exactly two places');
  // CHANGED ACCEPTED (0.8.4 cache part (b)1). OLD: the critic call passed three arguments to withExcerptClause, ending `!!o2?.fencedSource)`. NEW: it passes a fourth, `cacheOrderSeat(config, seat)`, which makes the helper read the order's own held sentence (`above` for `below`) where the cache-shaped order is live.
  // WHY: the order moves the excerpt block above the instructions, so the sentence about its place changes with the seat's layout; the wiring this test pins (one definition, two call sites, stage-system.js only) is unchanged.
  assert.match(text, /withExcerptClause\(o2 === undefined \? R\.criticSystem\(open\) : R\.criticSystem\(open, o2\), 'critic', !!o2\?\.fencedSource, cacheOrderSeat\(config, seat\)\)/);
  assert.match(text, /withExcerptClause\(base\(open, fenced, opts\), 'reviser', fenced\)/);
});
