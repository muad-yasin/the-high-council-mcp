// 0.8.4 S16 (I; D25, T17l, T17ai, RU-S16-02): the CONCERN of the final read: a note a layer-3 seat attaches to its final read for the build to watch, that claims no criterion fails. It is recorded on the seat's entry and listed in HANDOFF.md under Concerns; it is NEVER an objection, never a late finding, never rated, holds nothing back, is never debated or declined.
// Live only once the final read's own words (the W31 group) are recorded: the held rows pin the state without them. Offline, mock seats, $0.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setCache, setBudget, setPromptSpy, setOutboundScan } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { finalReadBlocksAgreement, renderFinalReadBoard } from '../src/final-read.js';
import { REASON_CAP } from '../src/sorting.js';
import { readFileSync } from 'node:fs';
import { SORTING } from './helpers/rating-demand.js';
import { W31 } from './helpers/w31-held.js';
import { scenario, CRITERION } from './helpers/layer-two-run.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); setOutboundScan({}); });

const L3 = [['la', 1], ['lb', 2], ['lc', 3], ['ld', 3]];
const MET = JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok' });
const withConcern = (concern, extra = {}) => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets the retry limit to five attempts.' }], failures: [], verdict_line: 'ok', concern, ...extra });
const seatOf = ([lab, layer]) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
const NOTE = 'The retry limit may be too low for a slow network; watch it in the first week.';

async function run(held, lcReply) {
  setHeldForTest(held);
  setOutboundScan({ finish: true });
  const seats = { builder: seatOf(['writer']), reviser: seatOf(['writer']), handoff: seatOf(['hand']), critics: L3.map(seatOf) };
  try {
    return await scenario({ answerBack: true, l1Severity: 5, critics: L3, overrides: { 'final-read-lc': lcReply, 'final-read-ld': MET, handoff: '# Handoff\n\nBuild the worker.' }, extra: { seats, handoff: true }, cutLabels: ['revise-1'] });
  } finally { setOutboundScan({}); }
}
const lcEntry = r => r.result.finalRead.seats.find(e => e.lab === 'lc');

test('T17l: a concern attached to a layer-3 seat\'s final read is recorded on its entry and listed in HANDOFF.md under Concerns, in the seat\'s own words, escaped as model text; it carries no rating', async () => {
  const r = await run({ ...SORTING, ...W31 }, withConcern(NOTE));
  assert.equal(lcEntry(r).concern, NOTE);
  assert.equal('rating' in lcEntry(r) || 'severity' in lcEntry(r), false);
  // CHANGED ACCEPTED TEST (0.8.4 apply, job 12 row T17l): OLD: '... A concern claims no criterion fails and predicts no failure: it is not an objection, ...'. NEW: '... A concern does not claim that a criterion fails and does not predict a failure: it is not an objection, ...' (the rest of the pattern is unchanged and stays whole and anchored). WHY: error 'The input did not match the regular expression /\n## Concerns\n\nLayer 3 attached these notes ... A concern claims no criterion fails and predicts no failure ...': the reviewed wording reworded the Concerns paragraph (Review/084/wording-batch/v2/RESOLVED_LIST.md line 1323, applied by f60ebad2 in src/late-finding.js:102); the input printed in the TAP carries 'A concern does not claim that a criterion fails and does not predict a failure'.
  assert.match(r.result.handoff, /\n## Concerns\n\nLayer 3 attached these notes to its final read\. A concern does not claim that a criterion fails and does not predict a failure: it is not an objection, it holds nothing back, it is not debated and it is not declined\. Read each against the plan before you build\.\n\n- lc: The retry limit may be too low for a slow network; watch it in the first week\./);   // escaped as model text (R.claimText escapes a closing container tag; the handoff sections add no container, as the late findings and the closed-below-4 section do)
  assert.match(renderFinalReadBoard(r.result.finalRead), /\n  Concern \(not an objection, holds nothing back\): The retry limit may be too low for a slow network; watch it in the first week\./, 'and on the BOARD under the seat\'s row');
});

test('T17ai: a concern never becomes an objection or a late finding: the seat still meets, no failure, no late finding, and at an agreed ending it holds nothing back', async () => {
  const r = await run({ ...SORTING, ...W31 }, withConcern(NOTE));
  const lc = lcEntry(r);
  assert.equal(lc.meets, true);
  assert.deepEqual(lc.failures, []);
  assert.deepEqual((r.result.lateFindings ?? []).filter(x => x.found === 'final_read'), []);
  assert.equal(finalReadBlocksAgreement({ ran: true, run_end: 'agreed', final_sha: 'abc', seats: [lc] }), false);
});

// REMOVED (0.8.4 apply, K7): job 12 row 'HELD (pin): without the final read's own words the same reply is read as before: no concern on the entry, no Concerns section'. OLD: ran the scenario with the map SORTING alone (no W31) and asserted no `concern` on the entry and no '## Concerns' section. WHY: error 'true !== false' at assert.equal('concern' in lcEntry(r), false): finalReadRule, finalReadSortingForm, finalReadSortingItems and lateFindingRatingSentence are RECORDED, so a map that leaves them out falls through to the recorded text (src/held-roles.js:15) and the concern is read; the held-off state cannot be recreated: a name set to undefined is banned for 0.8.4 names, and finalReadWordsOn (src/final-read-words.js:5) is only `every held(name) is a function`, with no config term. Sibling: 'T17l: a concern attached to a layer-3 seat\'s final read is recorded on its entry and listed in HANDOFF.md under Concerns ...' (recorded state, the positive half) and 'a concern that is not text, or empty, is not recorded' (recorded state, the negative half), both in this file.

test('a concern that is not text, or empty, is not recorded', async () => {
  for (const bad of [42, '', '   ', { text: NOTE }]) {
    const r = await run({ ...SORTING, ...W31 }, withConcern(bad));
    assert.equal('concern' in lcEntry(r), false, JSON.stringify(bad));
  }
});

test('the schema\'s cap for a concern is the cap every judge field is read at (REASON_CAP), and its text says so', () => {
  const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
  const prop = JSON.stringify(schema).match(/"concern":\{"type":"string","maxLength":(\d+),"description":"([^"]*)"/);
  assert.ok(prop, 'the property is in the schema');
  assert.equal(Number(prop[1]), REASON_CAP);
  assert.match(prop[2], new RegExp(`at most ${REASON_CAP} characters`));
});

test('a note longer than the cap is cut at the cap, not dropped', async () => {
  const r = await run({ ...SORTING, ...W31 }, withConcern('x'.repeat(REASON_CAP + 500)));
  assert.equal(lcEntry(r).concern.length, REASON_CAP);
});
