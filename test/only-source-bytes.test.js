// 0.8.4 D30 (plan A T1.5): the "only source" wording when seats are shown excerpts. Excerpts ship in 0.8.4, so three sentences stop being true and get one clause each: the fence header's "They are the only source you can
// see.", the critic's rule and the reviser's rule; and the session that answers an external seat gets one paragraph. All four are held words (test/held-prompts/held-084-a.js), injected here as the re-record will export
// them. "Off" is nothing recorded: every one of the three texts is then the shared text itself, byte for byte (the pin is the constant: FENCE_HEADER, QUOTE_RULE_CRITIC and QUOTE_RULE_REVISER inside the prompts). The
// wiring (src/cli.js, criticPromptFor, reviserSystemFor, the reviser call sites) waits for its slots; these tests drive the helpers. Offline, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
// guarded: on a tree without these exports (the red tree of the unit) each row fails by itself at its first use, instead of one load failure for the file; nothing is skipped
const { fenceHeader, FENCE_HEADER } = await import('../src/fence.js');
const { withExcerptClause } = await import('../src/stage-system.js');
const { externalStageBlock } = await import('../src/excerpt-record.js');
import { setHeldForTest } from '../src/held-roles.js';
import * as R from '../src/roles.js';
import { fenceHeaderOnlySource, criticOnlySourceSentence, reviserOnlySourceSentence, externalStageParagraph } from './held-prompts/held-084-a.js';

afterEach(() => setHeldForTest(null));
const ALL = { fenceHeaderOnlySource, criticOnlySourceSentence, reviserOnlySourceSentence, externalStageParagraph };
const CRITIC = R.criticSystem(false, { fencedSource: true });
const REVISER = R.reviserSystem(false, true, {});
const CRITIC_OLD = /That fenced text is the ONLY thing you\s+know about the repository\./;
const REVISER_OLD = /Some of the task is real source code, fenced verbatim, and it is the only source anyone in\s+this chain has seen\./;

test('the pin: FENCE_HEADER is today\'s header byte for byte (sha256 of the text at 084/integration), and it carries the heading `council fence` looks for before it writes a second header', () => {
  assert.equal(createHash('sha256').update(FENCE_HEADER).digest('hex'), '0d29a21cbf82f2ed68773ad39c766384b3f8a9a1bfe181e709ca858c09014926');
  assert.ok(FENCE_HEADER.includes('# Source, fenced verbatim'));
  setHeldForTest(ALL);
  assert.ok(fenceHeader().includes('# Source, fenced verbatim'), 'the heading survives the clause, so a task already holding the header is not given a second one');
});

// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: 'excerpts off (nothing recorded): the fence header, the critic and reviser prompts and the external-stage block are exactly the shared text'. NEW: the held assertions are removed (K7, SIBLINGS: 'excerpts on (the words recorded)' for the fence header and 'excerpts on: the critic and the reviser each get their one replacement sentence' for the prompts); the two assertions about the shared constants stay. WHY: fenceHeaderOnlySource, criticOnlySourceSentence, reviserOnlySourceSentence and externalStageParagraph are recorded (recorded-084-a.js).
test('the shared critic and reviser prompts carry the sentence the clause replaces', () => {
  assert.match(CRITIC, CRITIC_OLD, 'the critic prompt carries the sentence the clause replaces');
  assert.match(REVISER, REVISER_OLD, 'the reviser prompt carries the sentence the clause replaces');
});

test('excerpts on (the words recorded): the fence header changes its one sentence and nothing else', () => {
  setHeldForTest(ALL);
  const on = fenceHeader();
  assert.equal(on, FENCE_HEADER.replace('They are the only source you can see.', () => fenceHeaderOnlySource()));
  assert.equal(on.split('They are the only source you can see.').length, 1, 'the old sentence is gone');
  assert.equal(on.includes('together with the excerpts marked as such that the handling session adds during the run.'), true);
  assert.equal(FENCE_HEADER.includes('They are the only source you can see.'), true, 'the constant itself never moves');
});

test('excerpts on: the critic and the reviser each get their one replacement sentence, once, and the rest of the prompt is untouched', () => {
  setHeldForTest(ALL);
  const critic = withExcerptClause(CRITIC, 'critic', true);
  assert.equal(critic, CRITIC.replace(CRITIC_OLD, () => criticOnlySourceSentence()));
  assert.doesNotMatch(critic, CRITIC_OLD);
  assert.equal(critic.split(criticOnlySourceSentence()).length, 2);
  const reviser = withExcerptClause(REVISER, 'reviser', true);
  assert.equal(reviser, REVISER.replace(REVISER_OLD, () => reviserOnlySourceSentence()));
  assert.doesNotMatch(reviser, REVISER_OLD);
  assert.equal(reviser.split(reviserOnlySourceSentence()).length, 2);
});

test('every variant the slots will wrap carries its sentence exactly once when fenced: the critic (closed and open scope, criteria kinds, severity, self review), the reviser (closed, open with decisions, patch) and the recorded answer-back forms', () => {
  setHeldForTest(ALL);
  for (const [open, o] of [[false, {}], [true, {}], [false, { criteriaKinds: true }], [false, { severity: true }], [false, { selfReview: true }]]) {
    const out = withExcerptClause(R.criticSystem(open, { fencedSource: true, ...o }), 'critic', true);
    assert.equal(out.split(criticOnlySourceSentence()).length, 2, JSON.stringify([open, o]));
  }
  for (const make of [() => R.reviserSystem(false, true, {}), () => R.reviserSystem(true, true, { decisions: true }), () => R.patchReviserSystem(false, true, {}), () => R.reviserSystemWithIds(false, true, {}), () => R.patchReviserSystemWithIds(false, true, {})]) {
    const out = withExcerptClause(make(), 'reviser', true);
    assert.equal(out.split(reviserOnlySourceSentence()).length, 2, make.toString());
  }
});

test('a prompt without fenced source has no rule to change: untouched even with the words recorded; the external-stage block is the paragraph and a blank line', () => {
  setHeldForTest(ALL);
  assert.equal(withExcerptClause(R.criticSystem(false), 'critic', false), R.criticSystem(false));
  assert.equal(withExcerptClause(R.reviserSystem(false, false, {}), 'reviser', false), R.reviserSystem(false, false, {}));
  assert.equal(externalStageBlock(), `${externalStageParagraph()}\n\n`);
});

test('a fenced prompt that lacks the sentence, or carries it twice, is a loud failure, never a silent skip; an unknown kind too', () => {
  setHeldForTest(ALL);
  assert.throws(() => withExcerptClause('a prompt with no rule', 'critic', true), /critic's prompt must carry its "only source" sentence once \(found 0\)/);
  assert.throws(() => withExcerptClause(`${CRITIC}\n${CRITIC}`, 'critic', true), /once \(found 2\)/);
  assert.throws(() => withExcerptClause('x', 'reviser', true), /reviser's prompt .* \(found 0\)/);
  assert.throws(() => withExcerptClause('x', 'judge', true), /unknown kind judge/);
});

test('a broken draft changes nothing: an empty or non-string word leaves the shared text', () => {
  for (const bad of [() => '', () => 42, () => undefined]) {
    setHeldForTest({ fenceHeaderOnlySource: bad, criticOnlySourceSentence: bad, reviserOnlySourceSentence: bad, externalStageParagraph: bad });
    assert.equal(fenceHeader(), FENCE_HEADER);
    assert.equal(withExcerptClause(CRITIC, 'critic', true), CRITIC);
    assert.equal(withExcerptClause(REVISER, 'reviser', true), REVISER);
    assert.equal(externalStageBlock(), '');
  }
});

test('the held words are the plan\'s text, word for word (plan A T1 wording, l.96-98)', () => {
  assert.equal(fenceHeaderOnlySource(), 'They are the only source you can see, together with the excerpts marked as such that the handling session adds during the run.');
  assert.equal(criticOnlySourceSentence(), 'The fenced source, together with the excerpts marked as such below, is the ONLY thing you know about the repository: a claim about the project that neither shows is UNVERIFIED.');
  assert.equal(reviserOnlySourceSentence(), 'Some of the task is real source code, fenced verbatim, and it is, with the recorded excerpts marked as such, the only source anyone in this chain has seen.');
  assert.equal(externalStageParagraph(), 'You may have the project open. Anything you use from it beyond the fenced source goes into the run as an excerpt (record it) or is marked [UNVERIFIED: ...]; never write that the plan or the panel saw the repository.');
});

const CLI = () => readFileSync(new URL('../src/cli.js', import.meta.url), 'utf8');

test('slot H2-e (1 of 3): src/cli.js imports fenceHeader from ./fence.js in place of the constant', () => {
  assert.match(CLI(), /import \{ fenceFile, scanTaskForSecrets, fenceHeader, FENCE_MAX_BYTES \} from '\.\/fence\.js';/);
});

test('slot H2-e (2 of 3): `council fence` writes fenceHeader() unless the task already holds the header', () => {
  assert.match(CLI(), /includes\('# Source, fenced verbatim'\) \? '' : fenceHeader\(\);/);
});

test('slot H2-e (3 of 3): src/cli.js no longer names the FENCE_HEADER constant', () => {
  assert.equal(/\bFENCE_HEADER\b/.test(CLI()), false);
});
