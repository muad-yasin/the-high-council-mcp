// 0.8.4 D22 (plan A T3.3, settled item 6): the chain key `builder_kind` leaves the handoff seat's prompts byte for byte what they were unless it is exactly "one_shot" AND its held words are recorded. With the key unset,
// "session", or "one_shot" before the re-record, both forms of the handoff prompt (the default form and the milestone form) equal today's text, which is the shared constants of src/roles.js themselves
// (prompt-pin pins those bytes). Three fixtures: a signed run, a run whose draft was not agreed, a run whose plan has dependencies to install. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { setHeldForTest } from '../src/held-roles.js';
import { builderKindOf } from '../src/builder-kind.js';
import { builderSection } from '../src/handoff-contract-text.js';
import { createHash } from 'node:crypto';
import * as R from '../src/roles.js';

afterEach(() => setHeldForTest(null));
const FIXTURES = {
  'a signed run': { request: 'Plan a retry limit.', draft: '# Plan\n\n1. Retry three times.\n', planFile: 'PLAN.md', checks: '' },
  'a run that did not agree': { request: 'Plan a retry limit.', draft: '> Not a signed-off plan: finished with open objections.\n\n# Plan\n\n1. Retry as often as it takes.\n', planFile: 'deliverable.md', checks: '' },
  'a run with dependencies': { request: 'Plan a CLI.', draft: '# Plan\n\n1. Install `commander` (npm, 12.1.0) and `chalk`.\n', planFile: 'PLAN.md', checks: '' },
};
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the key setting `"one_shot" before the words are recorded` was an arm of the default-form, milestone-form and harness-half rows, and the expected prompts were R.HANDOFF_SYSTEM and R.handoffSystem({ milestones: true }) themselves, and the harness section was pinned by five sha256 values of the held-state text. NEW: (K7) the one_shot arm and the two-words-recorded loop are removed (after the recording `one_shot` is live; SIBLING, in test/builder-kind-one-shot.test.js: 'the default form under one_shot', 'the milestone form under one_shot' and 'the harness half under one_shot, words recorded'); (K5) the expected seat prompts carry the recorded 'Verify first' paragraph before the dependency paragraph (and, in the milestone form, the recorded status rule after the Status instruction); (K5) the five section hashes are the sha256 of the section as recorded: item 1 reads the recorded verifyFirstItemOne. WHY: verifyFirstParagraph, verifyFirstStatusRule and verifyFirstItemOne are recorded (recorded-084-a.js).
const KEYS = { 'key unset': {}, '"session"': { builder_kind: 'session' }, 'a wrong value': { builder_kind: 'oneshot' } };
const DEPENDENCY_ANCHOR = 'If the plan has the build session install or download anything';
const STATUS_ANCHOR = 'Say which, and why, in the next section.';
const withVerifyFirst = (system, { milestones = false } = {}) => {
  const out = system.replace(DEPENDENCY_ANCHOR, () => `${R.verifyFirstParagraph()}\n\n${DEPENDENCY_ANCHOR}`);
  return milestones ? out.replace(STATUS_ANCHOR, () => `${STATUS_ANCHOR} ${R.verifyFirstStatusRule()}`) : out;
};

test('builderKindOf: only the exact value "one_shot" reads as one_shot; unset, "session" and anything else read as session', () => {
  assert.equal(builderKindOf({ builder_kind: 'one_shot' }), 'one_shot');
  for (const v of [undefined, 'session', 'oneshot', 'ONE_SHOT', true, null, 1]) assert.equal(builderKindOf({ builder_kind: v }), 'session', String(v));
  assert.equal(builderKindOf(undefined), 'session');
});

test('the default form: for every fixture and every key setting the handoff seat gets R.HANDOFF_SYSTEM with the recorded Verify first paragraph, and R.handoffUser, byte for byte', () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    for (const [keyName, extra] of Object.entries(KEYS)) {
      const got = handoffPrompt({ config: { ...extra }, ...f });
      assert.equal(got.system, withVerifyFirst(R.HANDOFF_SYSTEM), `${name}, ${keyName}: system`);
      assert.equal(got.user, R.handoffUser({ request: f.request, draft: f.draft, planFile: f.planFile, checks: f.checks }), `${name}, ${keyName}: user`);
    }
  }
});

test('the milestone form: with the key unset, "session" or wrong, the prompt is the recorded milestone prompt', () => {
  for (const [name, f] of Object.entries(FIXTURES)) {
    const base = handoffPrompt({ config: { handoff_contract: { milestones: true } }, ...f, criteria: ['A', 'B'] });
    assert.equal(base.system, withVerifyFirst(R.handoffSystem({ milestones: true }), { milestones: true }));
    for (const [keyName, extra] of Object.entries(KEYS)) {
      const got = handoffPrompt({ config: { handoff_contract: { milestones: true }, ...extra }, ...f, criteria: ['A', 'B'] });
      assert.deepEqual(got, base, `${name}, ${keyName}`);
    }
  }
});

// D22's HARNESS half (builderSection): the sha256 of today's output over five fixtures, taken at 084/integration (the same pins as test/handoff-verify-first.test.js). With the key unset, "session", wrong, "one_shot"
// before its words are recorded, or "one_shot" with only some of the three recorded, builderSection is today's text byte for byte.
const THIN = { sha256: 'a'.repeat(64) };
const SECTION_PINS = {
  'no gaps': [{ thin: THIN, runId: 'r1' }, 'db5b7878fc72785f4726df6840e0c46dad9c0b1edbfb520ab29fe1593f5a4315'],
  'gaps': [{ thin: THIN, runId: 'r1', gaps: [{ kind: 'k', message: 'm' }] }, '3310ead4ac5629027ee1b8af77d057ca8039b6ec79bfe0975bcd1764d8a8fd53'],
  'checks': [{ thin: THIN, runId: 'r1', hasChecks: true }, '580acf6bf788e9dd75138ca4315bab171bbbea451c02f80d7df02a7f31c5cdbe'],
  'one failure': [{ thin: THIN, runId: 'r1', failures: 1 }, 'fc4b1dd7521473eb1beb59fea5a196cc61df9236f6d6acfdb1fecdc17cd1c503'],
  'no run id': [{ thin: THIN }, '8bd797f6b2798d29bbb44f74fc9e061366f7657a49ccd9300a6adac9a22e0211'],
};
test('builderSection, harness half: for every fixture and every key setting (unset, "session", wrong) the output is the pinned text as recorded', () => {
  const sha = t => createHash('sha256').update(t).digest('hex');
  const arms = [{}, { builderKind: 'session' }, { builderKind: 'oneshot' }];
  for (const [name, [args, hash]] of Object.entries(SECTION_PINS)) {
    for (const extra of arms) assert.equal(sha(builderSection({ ...args, ...extra })), hash, `${name}, ${JSON.stringify(extra)}`);
  }
  assert.equal(builderSection({ builderKind: 'one_shot' }), '', 'an older run has no thin contract: nothing, whatever the key');
});

