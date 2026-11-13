// 0.8.4 D14 / T7 wording (plan A l.919; WORDING U2-w6, held name `failedRowAbsencePhrase` in test/held-prompts/held-084-a.js): the critic's reply format asks, for something ABSENT, to copy the heading of the section where it should be. Held: seats get
// it only once src/roles.js records the name. Every critic prompt form (open and closed scope, each freedom, fenced or not) carries the replaced phrase once and the old phrase not at all; nothing recorded: the very same text, the old phrase once.
// No re-record of a recorded prompt. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setHeldForTest } from '../src/held-roles.js';
import { criticPromptFor, panelPromptFor, finalReadSystemFor, systemTextsFor, withAbsenceAnchor } from '../src/stage-system.js';
import { readChainFile } from './helpers/chain-file.js';
import { failedRowAbsencePhrase } from './held-prompts/held-084-a.js';
import { criticQuoteFieldSentence } from './held-prompts/held-084-s14.js';
import { DEMAND } from './helpers/rating-demand.js';
import { seatTitleBlock } from './held-prompts/held-084-c.js';

afterEach(() => setHeldForTest(null));
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = readChainFile(root, 'plan-mini-council');
const seat = cfg.seats.critics[0];
const OLD = 'FAILED: the quoted passage, or what is absent,';
const times = (s, sub) => s.split(sub).length - 1;
const FORMS = [undefined, { fencedSource: true }, { criteriaKinds: true }, { selfReview: true }, { severity: true }, { blocking_questions: true, pass: true }];

test('AA-1 recorded: every critic prompt form carries the anchored phrase once and the old phrase not at all; the reply-format sentence stays once', () => {
  setHeldForTest({ failedRowAbsencePhrase });
  for (const open of [false, true]) FORMS.forEach(form => {
    const out = criticPromptFor(seat, open, form, cfg);
    assert.equal(times(out, failedRowAbsencePhrase()), 1, JSON.stringify({ open, form }));
    assert.equal(times(out, OLD), 0);
    assert.equal(times(out, 'Reply with a single JSON object and nothing else:'), 1);
  });
  assert.equal(times(panelPromptFor(seat, false, { fencedSource: true }, cfg), failedRowAbsencePhrase()), 1, 'the panel');
  assert.equal(times(finalReadSystemFor(seat, cfg, { fencedSource: true }), failedRowAbsencePhrase()), 1, 'the final read');
  assert.ok(systemTextsFor('panel-1-a', cfg, seat).every(t => times(t, failedRowAbsencePhrase()) === 1), 'the panel rows are priced with it');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: a row 'AA-2 held (the default): nothing recorded gives the very same text, with the old phrase once' sat here. NEW: removed; its sibling AA-1 asserts the recorded phrase once and the old phrase not at all in the same prompt forms. WHY: failedRowAbsencePhrase is recorded (src/prompts/recorded-084-a.js, row NS-0187, D14).
test('AA-3 a template without the phrase (or with it twice) is a loud error, never a silent skip', () => {
  setHeldForTest({ failedRowAbsencePhrase });
  assert.throws(() => withAbsenceAnchor('no such phrase'), /found 0/);
  assert.throws(() => withAbsenceAnchor(`${OLD} x ${OLD}`), /found 2/);
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the last two lines said that unrecorded, withAbsenceAnchor returned the text as it came. NEW: removed (the two throws above pin the recorded behaviour). WHY: failedRowAbsencePhrase is recorded (D14).
});

test('AA-4 composed with the other held words that reach a critic prompt (the quote-field sentence of S14 and the rating demand): the anchored phrase is still found once in every form, so recording the batches together cannot make it throw', () => {
  setHeldForTest({ failedRowAbsencePhrase, criticQuoteFieldSentence, ...DEMAND });
  for (const open of [false, true]) FORMS.forEach(form => {
    const out = criticPromptFor(seat, open, form, cfg);
    assert.equal(times(out, failedRowAbsencePhrase()), 1, JSON.stringify({ open, form }));
    assert.equal(times(out, criticQuoteFieldSentence()), 1);
  });
  assert.equal(times(finalReadSystemFor(seat, cfg, { fencedSource: true }), failedRowAbsencePhrase()), 1, 'the final read');
});

test('AA-5 over the FINISHED text (C&C 09 Nov 2026): with a persona block and a lane paragraph added by the other wrappers, the anchored phrase is still found once and the old phrase not at all', () => {
  setHeldForTest({ failedRowAbsencePhrase, seatTitleBlock });
  const personaCfg = { ...cfg, seat_personas: { enabled: true, form: 'title' } };
  const dressed = { ...seat, persona: 'Moses', lane: 'security_failure' };
  for (const open of [false, true]) FORMS.forEach(form => {
    const out = criticPromptFor(dressed, open, form, personaCfg);
    assert.equal(times(out, failedRowAbsencePhrase()), 1, JSON.stringify({ open, form }));
    assert.equal(times(out, OLD), 0);
  });
});

