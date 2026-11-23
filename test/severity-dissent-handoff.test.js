// B3 prep, JUDGE, TAGS SHOWN completed (C&C FIX 2 Nov 2026, the owner's 1 Nov pick: "the handoff tasks carry each objection's tag"): with the rating demand in force (M1/S19: a layered unanimous chain records ratings, and the held word ratingDemand, injected below, demands them; there is no switch any more) every Unresolved-dissent row of a not-agreed end shows its rating in force as a
// `Severity: <number>` line (no band words) right after the "Raised by" line, and the handoff seat is told what that number is (the sentence the reviser and the dispute prompt already carry). Demand held: neither the row nor the prompt changes.
// A-DRAFT wording. $0, offline (test/helpers/layer-two-run.js drives the runs).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/roles.js';
import { handoffPrompt } from '../src/handoff-prompt.js';
import { scenario, FINAL_READ_OK } from './helpers/layer-two-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { DEMAND, NO_DEMAND } from './helpers/rating-demand.js';

afterEach(() => setHeldForTest(null));   // M1 (S19): each test says which side of the rating demand it runs on

// The recorded Verify first paragraph stands before the dependency sentence of the handoff system prompt: the expectation is assembled here from the RECORDED words (R.verifyFirstParagraph), never from src/verify-first.js, the code under test.
const DEPENDENCY_ANCHOR = 'If the plan has the build session install or download anything';
const withVerifyFirst = system => system.replace(DEPENDENCY_ANCHOR, () => `${R.verifyFirstParagraph()}\n\n${DEPENDENCY_ANCHOR}`);
const dissentOf = deliverable => { const i = deliverable.indexOf('## Unresolved dissent'); assert.ok(i >= 0, 'the run ended not agreed, so the deliverable carries the dissent block'); return deliverable.slice(i, deliverable.indexOf('\n---\n', i)); };

// CHANGED ACCEPTED (0.8.4 S19). OLD: scenario({ severity: true }) vs scenario({ severity: false }) (the helper wrote severity: { enabled: true } into the chain for the first). NEW: scenario() twice with no severity option, the first run under DEMAND, the second under NO_DEMAND (the fixture's layers la/lb/lc are a ratingsRecorded chain either way, so the held run keeps a ledger, unrated). WHY: the switch is removed (the helper's dead severity key, if it is still there, is ignored by runChain). RED ON OLD SRC: helper unchanged = the default severity: true writes the old switch into BOTH runs, so bOff carries "Severity:" and assert.equal(bOff.includes('Severity:'), false) fails; helper without the key = DEMAND does nothing and the first block has no rating line (the first assert.match fails).
const FINISH_STALL = [{ choice: 'finish', stop: 'stall_stop:1:2', kind: 'stall_stop', why: 'climb_not_shown' }];   // the person's recorded finish at the stall stop of pass 2 (overseer round 1); in the half whose stall is passed up that stop never occurs and the entry is ignored
// CHANGED ACCEPTED (0.8.4 SG-1, the stall gate; C&C 08 Nov 2026). OLD: both halves ran with no recorded choice and the two whole blocks were compared after the rating lines were removed. NEW: both halves carry the same recorded `finish` for stall_stop:1:2, and the comparison is split: (1) the same number of rows and the same rows (rating lines and each Raised-by line's status clause left out), (2) each header and each status clause against its own end (WORDING-COUPLED pins on A-DRAFT text: BLOCK_CAUSE, limitReachedWords [S5 A-DRAFT] and the escalated-standing status; the apply re-records them; the title's tail "is otherwise the same" now means the rows, not the blocks) (the DEMAND rows say `it stood unchanged up to round R and was passed up a layer, where no ruling closed it`; the finished-stop rows say `never resolved`). WHY: with the demand held the stall gate is off, so the half ends at the stall stop and the person's finish (the box diagnostic of 08 Nov: kind stall_stop, why climb_not_shown, pass 2) writes the dissent block through the dispute stage; the half whose stall goes up ends after layer 3 signed off, so the headers differ by design. The OFF header, as the source builds it (chain.js, the dissent block, finishedStop): `1 objection(s) were still open when this run stopped (the person chose to finish at this stop: an objection stood unchanged and could not be passed up; the panel did not agree` + an optional `, and <where the layers stood>` + `)` (chain.js 6719: limitReachedWords for stall_stop, S5 A-DRAFT, then finishedAtStopWords); the DEMAND header begins `(the top layer signed off in round 3 after objections that stood unchanged`.
test('run (rating demand in force, a 5 raised, the run ends not agreed): each dissent row carries "Severity: 5" right after its Raised-by line; with the demand held the block has no rating line and is otherwise the same', async () => {
  setHeldForTest(DEMAND);
  const on = await scenario({ answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 }, overrides: FINAL_READ_OK, runExtra: { roundChoices: FINISH_STALL } });
  setHeldForTest(NO_DEMAND);
  const off = await scenario({ answerBack: true, ladder: false, l1Severity: 5, extra: { dispute: { enabled: true }, maxRounds: 2 }, overrides: FINAL_READ_OK, runExtra: { roundChoices: FINISH_STALL } });
  const bOn = dissentOf(on.result.deliverable); const bOff = dissentOf(off.result.deliverable);
  assert.match(bOn, /\n\*Raised by [^\n]*\*\nSeverity: 5\n\n/, bOn);
  assert.equal(bOff.includes('Severity:'), false, bOff);
  // the rows, rating lines removed, the status clause of each Raised-by line left out (it names how the objection ended, which differs by design), and the same number of rows
  const nRows = b => (b.match(/^### /gm) || []).length;
  const rowsOf = b => b.slice(b.indexOf('\n### ') + 1).replace(/\nSeverity: \d+\n/g, '\n').split('\n').map(l => (l.startsWith('*Raised by') ? l.replace(/(, round \d+),.*$/, '$1') : l)).join('\n');
  assert.equal(nRows(bOn), nRows(bOff), 'the same number of dissent rows');
  assert.equal(rowsOf(bOn), rowsOf(bOff), 'apart from the rating lines and the status clause the rows are the same text');
  // each header against its own end (wording-coupled pins: the apply re-records them)
  assert.match(bOn, /\(the top layer signed off in round 3 after objections that stood unchanged/, bOn);
  assert.match(bOff, /\(the person chose to finish at this stop: an objection stood unchanged and could not be passed up; the panel did not agree/, bOff);
  // each half's status clause against its own end (the clause the rows comparison above leaves out)
  assert.match(bOn, /it stood unchanged up to round \d+ and was passed up a layer, where no ruling closed it\.\*/, bOn);
  assert.match(bOff, /, never resolved\.\*/, bOff);
});

// CHANGED ACCEPTED (0.8.4 S19). OLD: config { severity: { enabled: true } } vs { severity: { enabled: false } } vs {}. NEW: a rated config (signoff unanimous, every critic on a layer) under DEMAND vs the same config under NO_DEMAND vs a flat config {} under DEMAND (the "absent" half is stronger: even with the demand in force a chain that records no ratings gets the plain prompt), plus the held, rated milestone prompt. WHY: the switch is removed; handoffPrompt reads ratingsDemanded(config). RED ON OLD SRC: the old src ignores the config's layers and the held word, so onPlain.system lacks the sentence (the first assert.equal fails).
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the plain handoff system prompt was R.HANDOFF_SYSTEM (+ the rating sentence with the demand in force), and the demand-held halves (NO_DEMAND) were compared with it. NEW: the plain prompt is withVerifyFirst(R.HANDOFF_SYSTEM) (the "Verify first" paragraph, recorded, is in every handoff prompt); the demand-held halves are REMOVED (K7: ratingDemand is recorded in every shipped run; sibling: the in-force half of this test, the same rated chain with the sentence, and the flat-chain half, which stays). WHY: verifyFirstParagraph recorded (src/verify-first.js).
test('handoff seat: with the rating demand in force on a rated chain the system prompt ends with the rating sentence (the milestone prompt too); on a chain that records no ratings (even with the demand in force), the prompt is what it always was', () => {
  const base = { request: 'Make tea.', draft: 'Boil water.' };
  const RATED = { signoff: 'unanimous', seats: { critics: [{ provider: 'mock', model: 'mock-critic-x', lab: 'a', layer: 1 }, { provider: 'mock', model: 'mock-critic-x', lab: 'b', layer: 1 }] } };   // ratingsRecorded: unanimous sign-off, every critic on a layer
  setHeldForTest(DEMAND);
  const onPlain = handoffPrompt({ ...base, config: RATED });
  assert.equal(onPlain.system, `${withVerifyFirst(R.HANDOFF_SYSTEM)}\n\n${R.SEVERITY_WRITER_SENTENCE}`);
  setHeldForTest(DEMAND);   // in force again, but this chain records no ratings (no unanimous sign-off, no layers): it gets the plain prompt
  const none = handoffPrompt({ ...base, config: {} });
  assert.equal(none.system, withVerifyFirst(R.HANDOFF_SYSTEM));
  const onMs = handoffPrompt({ ...base, config: { ...RATED, handoff_contract: { milestones: true } } });
  assert.ok(onMs.system.endsWith(`\n\n${R.SEVERITY_WRITER_SENTENCE}`), 'the milestone prompt ends with the sentence too');
  const offMs = handoffPrompt({ ...base, config: { handoff_contract: { milestones: true } } });
  assert.equal(offMs.system.includes(R.SEVERITY_WRITER_SENTENCE), false);
});
