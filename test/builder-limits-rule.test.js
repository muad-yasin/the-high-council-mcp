// 0.8.4 D16 (plan A T1.2): a limit the plan sets is a default with a reason; only a limit the request sets is hard. The writer seat's builder rules carry one drafted sentence for it
// (test/held-prompts/held-084-a.js builderLimitsRule, A-DRAFT until the one release wording review). The sentence reaches the build seat only once src/roles.js records it: src/stage-system.js builderSystemOf
// asks held('builderLimitsRule') and adds the answer as one more item of the Rules list. Before the re-record nothing is added and the prompt is what it was; the dry run's text for the `build` row is the
// text invoke() will send. Offline, $0. The send site (src/chain.js, `R.builderSystem` -> `builderSystemOf`) is a separate unit in Builder B's H1 slot; the run-level tests that need it are added on top after it lands.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setHeldForTest } from '../src/held-roles.js';
import { builderSystemOf, systemTextsFor } from '../src/stage-system.js';
import * as R from '../src/roles.js';
import { builderLimitsRule } from './held-prompts/held-084-a.js';

afterEach(() => { setHeldForTest(null); });
const SENTENCE = builderLimitsRule();
const CONFIGS = [{}, { scope: 'open' }, { decisions: { enabled: true } }, { scope: 'open', decisions: { enabled: true } }];
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'the reading that would lift it' and 'if a reading shows otherwise'. NEW: 'the evidence that would lift it' and 'if checking disproves the claim'. WHY: builderLimitsRule (src/prompts/recorded-084-a.js:14), the resolved text of the row (RESOLVED_LIST).
test('the drafted sentence is the plan\'s text, word for word (plan A l.86): a default with a reason, a hard limit only when the request sets it, a fallback for an UNVERIFIED step', () => {
  assert.equal(SENTENCE, 'A limit you set on where the build session may change code is a default: give its reason and the evidence that would lift it. Write a hard limit only when the request sets it, and say that the request sets it. Where a step rests on an UNVERIFIED claim, give the fallback the build session takes if checking disproves the claim; write a step that stops the build only when no safe fallback exists.');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the rows below proved the held state (builderSystemOf is R.builderSystem until the sentence is recorded) and injected the sentence with setHeldForTest. NEW: every row reads the recorded state: the Rules list carries the claim-markers item and then the limits item right after BUILDER_SYSTEM's own rules, before the scope rule, and the decisions numbering sentence ends the text where the Decisions rule is on. WHY: builderMarkersRule, builderLimitsRule and decisionsNumberingRule are recorded (src/prompts/recorded-084-a.js, recorded-084-s9.js); no held map is used.
const MARKERS = R.builderMarkersRule();
const recordedBuild = (open, opts, items = [MARKERS, SENTENCE]) => {
  const base = R.builderSystem(open, opts);
  const text = R.BUILDER_SYSTEM + items.map(t => `\n- ${t}`).join('') + base.slice(R.BUILDER_SYSTEM.length);
  return opts.decisions ? `${text}\n\n${R.decisionsNumberingRule()}` : text;
};
test('the recorded build text is the plain one plus the markers item and the limits item, in the Rules list, for the open and closed scope rule and with the decisions rule', () => {
  for (const extra of CONFIGS) {
    const open = extra.scope === 'open'; const opts = { decisions: !!extra.decisions };
    assert.equal(builderSystemOf(open, opts), recordedBuild(open, opts), JSON.stringify(extra));
  }
});

test('the two recorded items stand right after the base rules and before the scope and decisions rules, in the plan\'s order (markers, then limits)', () => {
  for (const extra of CONFIGS) {
    const open = extra.scope === 'open'; const opts = { decisions: !!extra.decisions };
    const text = builderSystemOf(open, opts);
    assert.ok(text.startsWith(`${R.BUILDER_SYSTEM}\n- ${MARKERS}\n- ${SENTENCE}`), JSON.stringify(extra));
    assert.equal(text.split(SENTENCE).length, 2, `${JSON.stringify(extra)}: the limits sentence is in the text exactly once`);
  }
});

test('the dry run prices the text the build call will send: the estimate\'s build texts carry the recorded items, one text each for a tree member and for any other run', () => {
  for (const extra of CONFIGS) {
    const texts = systemTextsFor('build', { scope: extra.scope, ...(extra.decisions ? { decisions: extra.decisions } : {}) });
    assert.equal(texts.length, 2, JSON.stringify(extra));
    for (const t of texts) assert.ok(t.includes(`${R.BUILDER_SYSTEM}\n- ${MARKERS}\n- ${SENTENCE}`), JSON.stringify(extra));
  }
});

test('a broken draft adds nothing: an empty answer from the held seam leaves the markers item alone in the Rules list', () => {
  setHeldForTest({ builderLimitsRule: () => '' });
  assert.equal(builderSystemOf(false, {}), recordedBuild(false, {}, [MARKERS]));
});

test('a broken draft adds nothing: an answer that is not a string leaves the markers item alone in the Rules list', () => {
  setHeldForTest({ builderLimitsRule: () => 42 });
  assert.equal(builderSystemOf(false, {}), recordedBuild(false, {}, [MARKERS]));
});
