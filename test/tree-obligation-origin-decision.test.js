// BUG-C-056 (bug audit 2026-10-24, second audit of the tree files): obligationOriginOf named the origin decision of a root obligation stop as the FIRST decision recorded on the child stop. A child stop that stands for several milestones keeps
// its stop open after an in-place milestone decision, so one stop can hold that decision AND the obligation decision that opened the root stop; the first match was the wrong one, the root re-plan then marked the in-place decision generated and
// left the obligation decision pending (recovery opened a generation for it from the replaced root plan). The origin is the decision that carries the obligation the root stop names. Pure functions over the fold's own maps.
//
// WHAT THIS CANNOT SHOW: the red reaches the function with the maps the fold builds, not a producing path through buildStopDecision (the audit's step "a milestone decision and then an obligation regenerate on one stop" was read, not run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { stateOf } from '../src/tree-record.js';
import { obligationOriginOf } from '../src/tree-transitions.js';

const OB = 'R@g1:C1';
const stopMeta = new Map([['e9', { node: 'R', generation: 1, originStopId: 'e2', obligation: OB }]]);

test('C-056: the origin decision of a root obligation stop is the decision that carries its obligation, whatever else was recorded on the child stop first', () => {
  const milestoneFirst = new Map([['e3', { stopId: 'e2', form: 'milestone', obligation: null }], ['e4', { stopId: 'e2', form: 'regenerate', obligation: OB }]]);
  assert.deepEqual(obligationOriginOf({ stopMeta, decisions: milestoneFirst }, 'e9'), { originStopId: 'e2', decisionId: 'e4' });
  const keepFirst = new Map([['e3', { stopId: 'e2', form: 'keep', obligation: null }], ['e4', { stopId: 'e2', form: 'regenerate', obligation: OB }]]);
  assert.deepEqual(obligationOriginOf({ stopMeta, decisions: keepFirst }, 'e9'), { originStopId: 'e2', decisionId: 'e4' });
  // an in-place decision may carry the obligation itself (the milestone form records it): then IT is the origin
  const inPlace = new Map([['e3', { stopId: 'e2', form: 'milestone', obligation: OB }]]);
  assert.deepEqual(obligationOriginOf({ stopMeta, decisions: inPlace }, 'e9'), { originStopId: 'e2', decisionId: 'e3' });
  // two obligations on one stop: each root stop finds its own decision
  const two = new Map([['e3', { stopId: 'e2', form: 'regenerate', obligation: 'R@g1:C2' }], ['e4', { stopId: 'e2', form: 'regenerate', obligation: OB }]]);
  assert.deepEqual(obligationOriginOf({ stopMeta, decisions: two }, 'e9'), { originStopId: 'e2', decisionId: 'e4' });
});

test('C-056: a root stop that names an obligation no decision of its origin stop carries has no origin (fail closed); an older record without the field keeps the first match', () => {
  const none = new Map([['e3', { stopId: 'e2', form: 'milestone', obligation: null }]]);
  assert.equal(obligationOriginOf({ stopMeta, decisions: none }, 'e9'), null);
  const oldMeta = new Map([['e9', { node: 'R', generation: 1, originStopId: 'e2' }]]);
  const oldDecisions = new Map([['e3', { stopId: 'e2' }], ['e4', { stopId: 'e2' }]]);
  assert.deepEqual(obligationOriginOf({ stopMeta: oldMeta, decisions: oldDecisions }, 'e9'), { originStopId: 'e2', decisionId: 'e3' });
});

test('C-056: the fold keeps the obligation on the decision and on the root obligation stop it opened', () => {
  const events = [
    { id: 'e1', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'r1', source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] },
    { id: 'e2', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 'r0', source: 'obligation', originStopId: 'e1', obligation: OB, affected: [{ node: 'R/M1', generation: 1 }] },
    { id: 'e3', event: 'decision_recorded', text: 'x', form: 'regenerate', stopId: 'e1', obligation: OB, affected: [{ node: 'R/M1', generation: 1 }], gateId: 'g', shownSha256: 'h', actor: 'person', via: 'terminal' },
  ];
  const state = stateOf({ events, corrupt: [], tree: {} });
  assert.equal(state.stopMeta.get('e2').obligation, OB);
  assert.equal(state.decisions.get('e3').obligation, OB);
  assert.deepEqual(obligationOriginOf(state, 'e2'), { originStopId: 'e1', decisionId: 'e3' });
});

// the fold, end to end (fix-up of C&C thcmcp-cd 24 Okt 2026): a child stop e1 holds an in-place milestone decision e2 and then the obligation decision e3; the ROOT obligation stop e4 names that obligation; a root re-plan e5 answers e4
const G = { gateId: 'g', shownSha256: 'h', actor: 'person', via: 'terminal' };
const CHILD_STOP = { id: 'e1', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'r1', source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] };
const MILESTONE = { id: 'e2', event: 'decision_recorded', text: 'x', form: 'milestone', stopId: 'e1', node: 'R/M1', generation: 1, milestone: 'M1', affected: [], ...G };
const ROOT_STOP = { id: 'e4', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 'r0', source: 'obligation', originStopId: 'e1', obligation: OB, affected: [{ node: 'R/M1', generation: 1 }] };
const REPLAN = { id: 'e5', event: 'decision_recorded', text: 'plan again', form: 'regenerate', replansRoot: true, stopId: 'e4', affected: [{ node: 'R', generation: 1 }], ...G };

test('C-056: a root re-plan marks the OBLIGATION decision generated (its pending generation never opens), not the in-place milestone decision that shares its child stop', () => {
  const oblig = { id: 'e3', event: 'decision_recorded', text: 'x', form: 'regenerate', stopId: 'e1', obligation: OB, affected: [{ node: 'R/M1', generation: 1 }], ...G };
  const before = stateOf({ events: [CHILD_STOP, MILESTONE, oblig, ROOT_STOP], corrupt: [], tree: {} });
  assert.equal(before.decisions.get('e3').generated, false, 'precondition: the obligation decision is pending before the re-plan');
  const state = stateOf({ events: [CHILD_STOP, MILESTONE, oblig, ROOT_STOP, REPLAN], corrupt: [], tree: {} });
  assert.equal(state.decisions.get('e3').generated, true, 'the re-plan supersedes the obligation decision: recovery never opens its generation');
  assert.equal(state.decisions.get('e2').generated, true, 'the in-place decision never opens one');
});

test('C-056: the fold does not fail on a root stop whose obligation no decision of its origin stop carries: nothing is marked, nothing is thrown', () => {
  const state = stateOf({ events: [CHILD_STOP, MILESTONE, ROOT_STOP, REPLAN], corrupt: [], tree: {} });
  assert.equal(state.decisions.get('e5').replansRoot, true, 'the re-plan is recorded');
  assert.equal(state.decisions.get('e2').generated, true);
});
