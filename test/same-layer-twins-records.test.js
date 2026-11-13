// SAME-LAYER TWINS, the records that name one judge and the person-read text (0.8.4 seats unit; C&C item 7). Offline, mock seats, $0.
//  TR-1 a stall escalation of a TWIN's objection (the fixture of test/stall-escalation.test.js SE-1 with a second layer-1 seat of the same model): the escalation row names the seat, not only the lab.
//  TR-2 the text a person reads (the HANDOFF sections of the closing read, the late-findings board) shows the bare lab plus the layer note, never the internal seat key.
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runChain, setPromptSpy, setCache, setBudget } from '../src/chain.js';
import { setHeldForTest } from '../src/held-roles.js';
import { reportJsonShape } from '../src/report-shape.js';
import { objectionId } from '../src/objection-ids.js';
import { registerSeatKeys } from '../src/seat-key.js';
import * as SK from '../src/seat-key.js';   // shownKey is new: read through the namespace
import { withClosedBelowFour, withOpenMayLeave, renderLateFindingsBoard } from '../src/late-finding.js';
import * as HESC from './held-prompts/held-escalation.js';
import { DEMAND } from './helpers/rating-demand.js';

afterEach(() => { setHeldForTest(null); setPromptSpy(null); setCache(null); setBudget(null); });

const CRITERION = 'The plan defines a retry limit.';
const DRAFT = 'The worker retries failed requests.';
// CHANGED ACCEPTED TEST (0.8.4 apply, recorded state): OLD: the stub failure carried no relation. NEW: relation 'new' on a first raise; the twin's second raise (pass 2) carries `continues <id>` (`repeatX`). WHY: relationRule is recorded (src/chain.js:5462); a `new` on a standing id mints #2 and the stall never fires.
const X = { relation: 'new', severity: 5, criterion: CRITERION, problem: 'No limit on retries.', quote: 'retries failed requests' };
const LOW = 'raiser-alpha', TWIN2 = 'raiser-alpha-l1-2';
const idX = objectionId(TWIN2, X);
const repeatX = { ...X, relation: `continues ${idX}` };
const meets = () => JSON.stringify({ meets: true, criteria: [{ criterion: CRITERION, verdict: 'MET', evidence: 'Section two sets it.' }], failures: [], verdict_line: 'ok' });
const objects = f => JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: f.problem }], failures: [f], verdict_line: 'no' });
const hit = text => ({ text, provider: 'mock', model: 'm', usage: { input: 0, output: 0 }, usd: 0 });

test('TR-1 A STALLED OBJECTION OF THE SECOND TWIN GOES UP NAMING ITS SEAT: the escalation row carries the seat key beside the lab, the first twin\'s objection is not mixed in', async () => {
  const held = { escalationRulingSystem: HESC.escalationRulingSystem, escalationRulingUser: HESC.escalationRulingUser, ledgerRulingsSection: HESC.ledgerRulingsSection, ...DEMAND };
  setHeldForTest(held);
  const script = {
    'panel-1-raiser-alpha': meets(), 'panel-2-raiser-alpha': meets(),
    'panel-1-raiser-alpha-l1-2': objects(X), 'panel-2-raiser-alpha-l1-2': objects(repeatX),
    'revise-1': `${DRAFT}\n\nRevision 1.\n\nDECLINED: ${idX}: The limit is set in section two.`,
    'rule-3-mid-beta': JSON.stringify({ rulings: [{ id: idX, ruling: 'overrule', reason: 'Section two sets the limit.' }] }),
  };
  setCache({ invalidate() {}, get(label) {
    if (label in script) return hit(script[label]);
    return hit(label.startsWith('panel-') || label.startsWith('final-read-') ? meets() : label.startsWith('revise-') ? `${DRAFT}\n\nRevision ${label.slice(7)}.` : DRAFT);
  } });
  const seat = (lab, layer) => ({ provider: 'mock', model: 'mock-review-fixture', lab, maxTokens: 3000, layer });
  const builder = { provider: 'mock', model: 'mock-builder', lab: 'writer' };
  const config = { name: 'fixture-tr1', criteria: [CRITERION], signoff: 'unanimous', answer_back: { enabled: true }, dispute: { enabled: true, stall_rounds: 2 }, maxRounds: 6,
    seats: { builder, reviser: builder, critics: [seat(LOW, 1), seat(LOW, 1), seat('mid-beta', 2), seat('top-gamma', 3)] } };
  const result = await runChain({ request: 'Write a worker plan with a retry limit.', runId: 'r-tr1', log: () => {}, config, retags: [{ pass: 3, id: idX, severity: 3, reason: 'A missing limit does not change what is built.' }] });
  const report = JSON.parse(JSON.stringify(reportJsonShape({ runId: 'r-tr1', chain: 'fixture-tr1', task: 't.md', result, config })));
  const e = report.escalations?.[0];
  assert.ok(e, `an escalation was recorded (${JSON.stringify(report.escalations)})`);
  assert.deepEqual(e.ids, [idX], 'only the second twin\'s objection went up');
  assert.deepEqual(e.labs, [LOW]);
  assert.deepEqual(e.seats, [TWIN2], 'the row names the seat as well as the lab');
  for (const s of e.stalled ?? []) assert.equal(s.seat, TWIN2, 'a stalled entry names its seat');
});

test('TR-2a PERSON-READ TEXT NEVER PRINTS THE INTERNAL SEAT KEY: the closed-below-4 and open-may-leave HANDOFF sections and the late-findings board name the model, not `alpha-l1-2`', () => {
  const a = { provider: 'mock', model: 'mock-critic-script-o-tr2', lab: 'alpha', layer: 1 }, b = { ...a }, c = { provider: 'mock', model: 'mock-critic-script-o-tr2c', lab: 'beta', layer: 2 };
  registerSeatKeys({ seats: { critics: [a, b, c] } });
  const row = { id: 'O-aaaaaaaa', lab: 'alpha-l1-2', criterion: 'It names a limit.', problem: 'No limit.', rating: 3, reasons: [{ seat: 'beta', reason: 'Minor.' }, { seat: 'alpha-l1-2', reason: 'Fine.' }] };
  for (const text of [withClosedBelowFour('H', [row], s => s, 3), withOpenMayLeave('H', [row], s => s, 3), renderLateFindingsBoard([{ id: 'O-bbbbbbbb', lab: 'alpha-l1-2', criterion: 'It names a limit.', problem: 'No limit.', rating: 3, sorted: null, found: 'final_read' }], 3)]) {
    assert.equal(/alpha-l1-2/.test(text), false, `the internal key is printed: ${text.slice(0, 400)}`);
  }
});

test('TR-2b THE SHOWN NAME OF A TWIN: the bare lab plus the layer note naming which seat of the model on the layer it is; a seat with no twin reads as before', () => {
  const a = { provider: 'mock', model: 'mock-critic-script-o-tr2b', lab: 'alpha', layer: 1 }, b = { ...a }, c = { provider: 'mock', model: 'mock-critic-script-o-tr2d', lab: 'beta', layer: 2 };
  registerSeatKeys({ seats: { critics: [a, b, c] } });
  const { shownKey } = SK;
  assert.equal(shownKey('alpha'), "alpha (layer 1, the model's first seat on this layer)");
  assert.equal(shownKey('alpha-l1-2'), "alpha (layer 1, the model's second seat on this layer)");
  assert.equal(shownKey('beta'), 'beta', 'a seat with no twin reads as before');
});
