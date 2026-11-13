// 0.8.4 S18 (Q15(c), Q8; FEATURE_SPECS T21ac): the dissent record of a block rated 6.0 that layer 3 overruled and the seat keeps. WHOLE-RUN row, offline, mock seats, $0. The fixture is DS-3 of test/m1-dissent.test.js (the seat keeps the block in rounds 4 and 5,
// the plan goes up again in round 6 and the second ruling signs off), COPIED here with the block's rating as the input and every field of the row asserted together: the seat's name, the block id, its rating, layer 3's reasons, the seat's reason where it
// answered, and the status. The dissent words (dissentRecordSection) are HELD: a stub is injected, so only the RECORD is under test; as shipped none of this is reachable.
// NAMED PIN (no input makes the event happen): "recorded under the seat key only" - the row's `name` is derived from the lab (src/chain.js dissentRows: `name: labFromKey(f.lab)` plus the layer note), so no run records it under the key alone. FAIL CONDITION: the assertion on `name` below.
// Written without a run (no tests on the laptop). The red is a swapped-input variant (S18_SWAPS.json): KEEP_EVIDENCE = KEPT -> another sentence (the run's path is unchanged; the record has `kept` without the seat's reason); every assert line byte-identical. (RATE 6 -> 3 was rejected: a block rated below 4 is closed by the ruling and the run takes another path.)
// NO GREEN TWIN: DS-3 ran without the rating demand; the long go-up shape under the rating demand has not run before, so a red at the premise in the set is the fixture, not the code.
// T21be ("recorded as closed") is the same row's `status` clause and a NAMED PIN: no input makes a closed dissent; FAIL CONDITION: the literal `status: 'open'` at src/chain.js dissentRows and the schema enum ["open"] (schemas/report-v1.json, dissents.status) - the assertion on d.status below fails if either gives another value.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { objectionId } from '../src/objection-ids.js';
import { reportJsonShape } from '../src/report-shape.js';
import * as HB from './held-prompts/held-084-b.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
const Y = { criterion: CRITERION, problem: 'No owner is named.', quote: 'The worker' };
const idY = objectionId('mid-beta', Y);
const L3F = { criterion: CRITERION, problem: 'Layer three has its own concern.', quote: 'The worker' };
const idL3 = objectionId('top-gamma', L3F);
const REASON2 = 'Still covered by section two.';
const KEPT = 'No owner is named in section two.';
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const withdrawsOf = id => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two.' }], failures: [], verdict_line: 'ok', answers: [{ id, status: 'withdrawn', evidence: 'It reads "The worker retries failed requests."' }] });
const keepsOf = (f, id, evidence) => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no', answers: [{ id, status: 'sustained', evidence }] });
const rules = list => JSON.stringify({ rulings: list });
const GOUP = { goUpRulingSystem: HB.goUpRulingSystem, goUpRulingUser: HB.goUpRulingUser, goUpRulingsSection: HB.goUpRulingsSection };
const STUB = { dissentRecordSection: () => '' };

// rate: the rating the seat gives the block Y
async function run({ rate, keep }) {
  // CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the scripted failures carried no `relation`. NEW: the first raise says `new`, the same seat's repeat (passes 2, 4, 5: the block stays open at rating 4 or above) says `continues <id>`. WHY: relationRule recorded (src/chain.js relation gate).
  const Yr = { ...Y, severity: rate };
  const Yc = { ...Yr, relation: `continues ${idY}` };
  const script = { 'panel-1-mid-beta': objects({ ...Yr, relation: 'new' }), 'panel-2-mid-beta': objects(Yc), 'rule-3-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: 'Section two names the owner.' }]), 'panel-3-top-gamma': objects({ ...L3F, severity: 5, relation: 'new' }),
    'panel-4-mid-beta': keepsOf(Yc, idY, keep), 'panel-5-mid-beta': keepsOf(Yc, idY, keep),
    'rule-6-top-gamma': rules([{ id: idY, ruling: 'overrule', reason: REASON2 }]), 'panel-6-top-gamma': withdrawsOf(idL3) };
  setHeldForTest({ ...DEMAND, ...GOUP, ...STUB });
  setCache({ invalidate() {}, get(label) {
    if (label in script) return { text: script[label], provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
    const text = (label.startsWith('panel-') || label.startsWith('final-read-')) ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT;
    return { text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 };
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const writer = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-s18-dissent', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 9 }, maxOverseerRounds: 3, layerRevisions: { 1: 1, 2: 1 },
    seats: { builder: writer, reviser: writer, critics: [seat('raiser-alpha', 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  let result = null; let error = null;
  try { result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-s18-dissent', log: () => {}, config }); } catch (e) { error = e; }
  const report = result ? JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-s18-dissent', chain: 'fixture-s18-dissent', task: 't.md', result, config }))) : null;
  return { result, error, report };
}

test('T21ac, T21be: a block rated 6.0 that layer 3 overruled and the seat keeps is on the record as a dissent: the seat\'s name, the block id, its rating, layer 3\'s reasons, the seat\'s reason where it answered, and the status open (not closed), readable by the seat\'s name', async () => {
  const RATE = 6;
  const KEEP_EVIDENCE = KEPT;   // what the seat writes when it keeps the block (the expected value below stays the module constant KEPT)
  const { report, error } = await run({ rate: RATE, keep: KEEP_EVIDENCE });
  assert.ok(report, `premise: the run ends with a report (${String(error)})`);
  const d = (report.dissents || []).find(x => x.name === 'mid-beta');   // readable by the seat's NAME
  assert.ok(d, `T21ac: the dissent is on the record under the seat's name (${JSON.stringify(report.dissents)})`);
  assert.deepEqual([d.lab, d.id, d.criterion, d.status], ['mid-beta', idY, CRITERION, 'open'], 'T21ac, T21be: the dissent names the seat and the block; its status is open, not closed');
  assert.deepEqual([d.rating.as_raised, d.rating.in_force, d.rating.changes], [RATE, RATE, []], 'T21ac: its rating, as raised and in force');
  assert.deepEqual([d.ruling.layer, d.ruling.round, d.ruling.reasons.length === 1 && d.ruling.reasons[0].lab === 'top-gamma' && d.ruling.reasons[0].text.includes(REASON2)], [3, 6, true], 'T21ac: layer 3\'s ruling (the second one wins) and its reasons, from its seat');
  assert.deepEqual([d.kept?.round, d.kept?.reason?.includes(KEPT)], [5, true], 'T21ac: the seat\'s own reason where it answered (it kept the block in round 5)');
});
