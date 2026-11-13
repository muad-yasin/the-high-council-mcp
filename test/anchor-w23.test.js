// 0.8.4 S14, W23 (held: test/held-prompts/held-084-s14.js criticQuoteFieldSentence): the sentence that asks every judge for a `quote` beside each failure. Its own commit, its own file: D's FM-critic changes the same critic seam (criticPromptFor), and S14
// rebases onto it. Inert until src/roles.js records the word; it goes directly before the reply-format sentence, like a persona block, in every prompt criticPromptFor builds (the panel, the critique, the final read, the re-asks).
// Fenced runs: once recorded it applies there too, beside the fenced-source quote rule - one field, two meanings (the S12 open item, Review/WORDING_0.8.4.md); nothing about fenced behaviour is designed here. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { criticPromptFor, panelPromptFor, finalReadSystemFor, systemTextsFor } from '../src/stage-system.js';
import { criticQuoteFieldSentence } from './held-prompts/held-084-s14.js';
import { criticOnlySourceSentenceOrder } from './held-prompts/held-084-cache-order.js';
import { readChainFile } from './helpers/chain-file.js';

afterEach(() => setHeldForTest(null));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = readChainFile(root, 'plan-mini-council');
const seat = cfg.seats.critics[0];
const ANCHOR = 'Reply with a single JSON object and nothing else:';
const times = (s, sub) => s.split(sub).length - 1;
const FORMS = [undefined, { fencedSource: true }, { criteriaKinds: true }, { selfReview: true }, { severity: true }, { blocking_questions: true, pass: true }];

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: AW-1 built every critic prompt twice (held, with the rating demand held or injected) and compared the prompt with the sentence removed against the held prompt ("today's bytes"). NEW: the held comparison is removed (K7, SIBLING: the same row's assertions on the recorded prompt: the sentence once, the reply-format sentence once, the sentence before it); AW-2 reads the excerpt clause the recorded way. WHY: criticQuoteFieldSentence and the rating demand are recorded; the prompt cache of plan-mini-council puts the judge in the cache-shaped order, which uses criticOnlySourceSentenceOrder (recorded-084-cache-order.js).
test('AW-1 recorded: every critic prompt form (open and closed scope, each freedom, fenced and not) carries the sentence once, directly before the reply-format sentence, which is still there exactly once', () => {
  setHeldForTest(null);
  for (const open of [false, true]) FORMS.forEach((form, i) => {
    const out = criticPromptFor(seat, open, form, cfg);
    const where = JSON.stringify({ open, form });
    assert.equal(times(out, criticQuoteFieldSentence()), 1, where);
    assert.equal(times(out, ANCHOR), 1, where);
    assert.ok(out.indexOf(criticQuoteFieldSentence()) < out.indexOf(ANCHOR), `the sentence is before the reply format: ${where}`);
    assert.ok(out.includes(`${criticQuoteFieldSentence()}\n\n`), `the sentence is its own paragraph: ${where}`);
  });
});

test('AW-2 it reaches the other doors to the critic text (the panel prompt and the final read), the estimate prices it (the panel rows), and it sits beside the excerpt clause of H8 without disturbing it (both once, fenced)', () => {
  setHeldForTest(null);
  assert.equal(times(panelPromptFor(seat, false, { fencedSource: true }, cfg), criticQuoteFieldSentence()), 1);
  assert.equal(times(finalReadSystemFor(seat, cfg, { fencedSource: true }), criticQuoteFieldSentence()), 1);
  assert.ok(systemTextsFor('panel-1-a', cfg, seat).every(t => times(t, criticQuoteFieldSentence()) === 1), 'the panel rows are priced with it');
  const fenced = criticPromptFor(seat, false, { fencedSource: true }, cfg);
  assert.equal(times(fenced, criticOnlySourceSentenceOrder()), 1, 'H8\'s clause is still there once');
  assert.equal(times(fenced, criticQuoteFieldSentence()), 1);
});
