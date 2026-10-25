// CHANGED ACCEPTED (already-false unit, C&C thcmcp-cd 24 Okt 2026; the dead-key sentence): OLD "its plan, or an ancestor's, was replaced"; NEW "replaced or set aside by a decision, or a node above it was" (table rows: "is dead (NEW): ..."; screens and refusals: "is dead: it was NEW, ..."). WHY: the old words are false for a node a decision LISTED (a consumer that never wrote a plan, or one with no successor) and for a transitive orphan whose parent was never replaced; the new tail holds on every route into deadKeys. Only the words moved: every row refuses the same keys as before.
// 0.8.3 M6 S8-3 fix-up (C&C, 12 Oct): a SCAN, not another one-off. A dead-key refusal was missing from the transition table THREE times (node_started, node_resumed, now needs_decision_opened), each found by a person
// reading, so this test walks EVERY event that names a node and a generation (read from EVENT_FIELDS, not from a list of mine) against two dead keys and demands a decision for each: the table REFUSES it, or the case is
// named below in ACCEPTS with the reason a dead key is still recorded. A new event that names a node and a generation fails here until someone decides. Fold units on raw events, as test/tree-root-generation.test.js does.
// The dead keys: R/M1@g1 (replaced by a regenerate decision whose generation was opened: held for good) and R@g1 (a SUPERSEDED root generation), plus the never-registered R/M2@g1 a decision put in question (dead, no node).
import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_FIELDS, deadKeys, foldRecord, heldKeys, transitionRefusal } from '../src/tree-transitions.js';
import { FIXTURE_BOUND } from './helpers/tree-fixture.js';

const G = { gateId: 'g', shownSha256: '0'.repeat(64), actor: 'person', via: 'terminal' };       // K10 (EDITED; OLD: gate fields only; NEW: and who answered; WHY: the table requires actor/via on a new decision, close or approval)
const runFor = (n, g) => (n === 'R' && g === 1 ? 't' : `run-${n.replace(/\//g, '-')}-${g}`);
const reg = (n, g, parent, fk, extra = {}) => ({ event: 'node_registered', node: n, generation: g, runId: runFor(n, g), attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 5, unit: 'usd' }, ...extra });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...G, boundSha256: FIXTURE_BOUND, frontierKey: fk, revision: 1 }];
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: runFor(n, g), pid: 1, host: 'h' });
const closed = (id, n, g, status = null) => ({ id, event: 'node_closed', node: n, generation: g, runId: runFor(n, g), outcome: 'passed', passed: true, status, share: 'released' });
// R closed (needs_decision) with a child R/M1 closed; a regenerate decision replaces R/M1 AND puts the never-registered R/M2 in question; its generation is opened (R/M1@g2, R/M2@g2); then a ROOT re-plan opens R@g2.
const EVENTS = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, 'needs_decision'),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1, 'needs_decision'),
  { id: 'e5', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }] },
  { id: 'e6', event: 'decision_recorded', text: 'redo', form: 'regenerate', stopId: 'e5', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M2', generation: 1 }], ...G },
  { id: 'e7', event: 'generation_opened', decisionId: 'e6', nodes: [{ node: 'R/M1', generation: 2 }, { node: 'R/M2', generation: 2 }] },
  { id: 'e8', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] },
  { id: 'e9', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e8', replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...G },
  { id: 'e10', event: 'generation_opened', decisionId: 'e9', nodes: [{ node: 'R', generation: 2 }] }];
const state = foldRecord(EVENTS);
// the same tree with NO root re-plan (a child regenerate only): R/M1@g1 and the never-registered R/M2@g1 are dead through the decision's held marks, and the frontier that proposed them is still live
const childOnly = foldRecord(EVENTS.slice(0, EVENTS.findIndex(e => e.id === 'e8')));

// A dead node in each PHASE a row accepts a live one in: R/M1 is replaced (stop, regenerate, generation opened), so its child R/M1/M1 is an orphan, whatever phase it was in. The dead-key rule is the only thing that refuses it.
const orphanIn = phase => foldRecord([{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1, 'needs_decision'),
  ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e5'), { id: 'e6', ...reg('R/M1/M1', 1, 'R/M1', 'kB') },
  ...(phase === 'registered' ? [] : [started('e6b', 'R/M1/M1', 1)]), ...(phase === 'stopped' ? [{ id: 'e6c', event: 'node_stopped', node: 'R/M1/M1', generation: 1, runId: runFor('R/M1/M1', 1), reason: 'budget' }] : []),
  { id: 'e7', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/M1', generation: 1 }] },
  { id: 'e8', event: 'decision_recorded', text: 'redo', form: 'regenerate', stopId: 'e7', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/M1', generation: 1 }], ...G },
  { id: 'e9', event: 'generation_opened', decisionId: 'e8', nodes: [{ node: 'R/M1', generation: 2 }] }]);
const DEAD_BY_STATE = [[state, ['R/M1@g1', 'R@g1', 'R/M2@g1']], [childOnly, ['R/M1@g1', 'R/M2@g1']]];
// where a row accepts a LIVE key only in some phase, the case is that phase: [state, key] pairs
const CASES = {
  node_started: [[orphanIn('registered'), 'R/M1/M1@g1']],
  node_resumed: [[orphanIn('stopped'), 'R/M1/M1@g1'], [orphanIn('running'), 'R/M1/M1@g1']],
  grant_issued: [[orphanIn('stopped'), 'R/M1/M1@g1']],
};
test('the fixtures really have the dead keys the scan uses', () => {
  for (const [st, k] of Object.values(CASES).flat()) assert.ok(deadKeys(st).has(k), `${k} is dead in its phase tree`);
  for (const [st, keys] of DEAD_BY_STATE) for (const k of keys) assert.ok(deadKeys(st).has(k), `${k} is dead in this record (deadKeys: ${[...deadKeys(st)].join(', ')})`);
  assert.equal(deadKeys(childOnly).has('R@g1'), false, 'control: without a root re-plan the root is live');
});

// What each node-naming event looks like for a key, as the ONE minimal valid shape.
const nodeOf = k => k.split('@g')[0]; const genOf = k => Number(k.split('@g')[1]);
const BUILD = {
  split_verified: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), splitSha256: 's' }),
  node_registered: k => reg(nodeOf(k), genOf(k), nodeOf(k) === 'R' ? null : 'R', 'kA', nodeOf(k) === 'R' ? { depth: 0 } : {}),
  node_started: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), pid: 1, host: 'h' }),
  node_stopped: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), reason: 'budget' }),
  node_resumed: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), pid: 1, host: 'h', purpose: 'resume' }),
  node_released: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), reason: 'x' }),
  node_closed: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), outcome: 'passed', passed: true, status: null, share: 'released' }),
  grant_issued: k => ({ node: nodeOf(k), generation: genOf(k), amount: 1, unit: 'usd', ...G }),
  node_closed_unstarted: k => ({ node: nodeOf(k), generation: genOf(k), stopId: 'e5', ...G }),
  bundle_input_allowed: k => ({ node: nodeOf(k), generation: genOf(k), stopId: 'e5', types: ['email'], ...G }),   // T-b (19 Okt 2026): the person's allowance for an unregistered child; refused for a dead key (it would never be used)
  guard_refused: k => ({ node: nodeOf(k), generation: genOf(k), item: 'i', guard: 'g' }),
  milestone_resolved: k => ({ node: nodeOf(k), generation: genOf(k), milestone: 'M1', decisionId: 'e6' }),
  reservation_mirrored: k => ({ runId: runFor(nodeOf(k), genOf(k)), node: nodeOf(k), generation: genOf(k), line: { id: 'r1', event: 'reserved' } }),
  needs_decision_opened: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), source: 'node_closed', affected: [{ node: nodeOf(k), generation: genOf(k) }] }),
  node_bundle_rebuilt: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), previousBundleSha256: 'a'.repeat(64), bundleSha256: 'b'.repeat(64), bundleBytes: 10, because: [{ node: nodeOf(k), generation: genOf(k), eventId: 'e1', acceptedBodySha256: 'a'.repeat(64) }], builtFrom: [{ node: nodeOf(k), generation: genOf(k), eventId: null }] }),
  plan_accepted: k => ({ actor: 'person', via: 'terminal', stopId: 'e5', node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), previousBodySha256: 'a'.repeat(64), acceptedBodySha256: 'b'.repeat(64), splitSha256: null, scan: { keyFindings: 0, piiFindings: null }, ...G }),
  stop_restored: k => ({ actor: 'sitting', stopId: 'e5', node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), deliveredBodySha256: 'a'.repeat(64), observedBodySha256: 'a'.repeat(64) }),
  node_choice: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), choice: 'continue', stop: 'overseer_cap:7:3' }),
  price_answered: k => ({ node: nodeOf(k), generation: genOf(k), runId: runFor(nodeOf(k), genOf(k)), model: 'openrouter/v/m', inUsdPerM: 1, outUsdPerM: 1, before: 'none', after: { in: 1, out: 1 }, source: 's', ...G }),
  decision_recorded: k => ({ text: 'x', form: 'milestone', stopId: 'e5', node: nodeOf(k), generation: genOf(k), milestone: 'M1', affected: [], ...G }),
};
// The events for which the table has NO dead-key rule, and why a dead key is still recorded (the row's own refusals - already closed, no open stop - still apply). Every entry is a decision, not a convenience.
const ACCEPTS = {
  price_answered: 'a fact about a PRICE ROW the session wrote for the model that blocked a stopped member (the member is named so the answer is bound to it); the row is project-wide and only ever raised, and a dead member\'s refusal still has to be answered or abandoned: refusing the record would hide a price that is already in pricing.user.json',
  split_verified: 'a fact about a closed run\'s plan (the verification of its block); dead or live, the record of what was checked is the same, and nothing reads it for a dead node',
  node_stopped: 'a run that is still alive at the replacement ends and its own CLI records the stop; refusing the record would hide a process that really ended',
  node_released: 'the release of a claim: facts about a process, refusing it would strand a claim',
  node_closed: 'a dead node that is still RUNNING ends (its process is gone or finishes) and its close is a fact with its returnedUsd; refusing it would keep the grant held for ever (S8-1: only a running dead node keeps its hold, until it ends)',
  guard_refused: 'a record of what a guard left out of a bundle; a fact about a derivation, written for any node the loop derived',
  reservation_mirrored: 'a copy of one line of a member\'s own money file: the accounting gate reads it, and a dead node\'s spend stays counted - refusing the mirror would break the gate',
  node_closed_unstarted: 'the close of a child that was NEVER REGISTERED (c3b): it kills nothing (nothing runs, nothing is spent, nothing returned) and it is the only exit of an open bundle_input stop whose child was replaced meanwhile, so a dead key is accepted; the row\'s own refusals (a registered node, an unknown or foreign stop, a missing gate) still apply - pinned below',
  milestone_resolved: 'the second half of a decision that already exists: it names the decision (decisionId) and is refused by its own row when that decision was not recorded; a dead node cannot have one open',
};
// Events whose table row refuses a dead key, with the reason the refusal must carry. Where a row refuses for another reason, the reason is named and WHY it holds for every dead key.
const REFUSES = {
  node_registered: /already registered|superseded: a newer generation/,           // a dead registered key is already registered; a dead never-registered key (held mark, generation opened) is superseded by the newer generation the decision opened
  node_started: /dead \(replaced or set aside by a decision, or a node above it was\)/,
  node_resumed: /dead \(replaced or set aside by a decision, or a node above it was\)/,
  node_choice: /not registered|dead \(replaced or set aside by a decision, or a node above it was\)/,       // member verb: the row asks the dead set right after the registration, before the run, phase and claim rows
  grant_issued: /dead \(replaced or set aside by a decision, or a node above it was\)/,
  needs_decision_opened: /dead \(replaced or set aside by a decision, or a node above it was\)/,
  bundle_input_allowed: /dead \(replaced or set aside by a decision, or a node above it was\)/,        // T-b: the row asks the dead set before it looks for the stop
  node_bundle_rebuilt: /dead \(replaced or set aside by a decision, or a node above it was\)/,        // REBUILD: the row asks the dead set FIRST, before it looks for the node
  plan_accepted: /is not an open stop/,                                               // 2b: like stop_restored, it answers exactly one OPEN stop
  stop_restored: /is not an open stop/,                                                // restore gap: it answers exactly one OPEN stop; a node's stops are answered when its plan is replaced (a regenerate decision, a root re-plan retiring them), so a dead key has no open stop to restore
  decision_recorded: /no open stop|names an open stop|answers only the stop/,        // a milestone decision for a dead key: its stop is answered by the regenerate that made the key dead (or, for a root, retired at the era boundary), so there is no open stop of a dead key to answer
};

test('SCAN: every event that names a node and a generation is either refused for a dead key or named in ACCEPTS with its reason (a new one fails here until it is decided)', () => {
  const naming = Object.entries(EVENT_FIELDS).filter(([, f]) => 'node' in f && 'generation' in f).map(([name]) => name);
  for (const extra of ['needs_decision_opened', 'decision_recorded']) if (!naming.includes(extra)) naming.push(extra);     // they name a node optionally (a stop's node, a milestone decision's node)
  for (const name of naming) {
    assert.ok(BUILD[name], `${name} names a node and a generation: add a builder to BUILD`);
    assert.ok(name in ACCEPTS || name in REFUSES, `${name} names a node and a generation: decide whether a dead key is refused (REFUSES) or accepted (ACCEPTS, with the reason)`);
  }
  for (const name of Object.keys(ACCEPTS)) assert.ok(naming.includes(name), `ACCEPTS names ${name}, which is not a node-naming event`);
  for (const name of Object.keys(REFUSES)) assert.ok(naming.includes(name), `REFUSES names ${name}, which is not a node-naming event`);
});

test('SCAN: each event of REFUSES is refused for each dead key, in both fixtures, with the reason its row owns', () => {
  const failures = [];
  for (const [name, re] of Object.entries(REFUSES)) for (const [st, k] of CASES[name] ?? DEAD_BY_STATE.flatMap(([state_, keys]) => keys.map(key => [state_, key]))) {
    const why = transitionRefusal(st, { id: 'e99', event: name, ...BUILD[name](k) });
    if (!why) failures.push(`${name} ${k}: ACCEPTED by the table`);
    else if (!re.test(why.reason)) failures.push(`${name} ${k}: refused for another reason: ${why.reason}`);
  }
  assert.deepEqual(failures, [], 'a dead key is accepted, or refused for a reason that is not about its replacement');
});

test('the stop row names the replaced plan (needs_decision_opened for a dead key), and an integration stop - which names no node - is still accepted', () => {
  for (const k of ['R/M1@g1', 'R@g1']) {
    const why = transitionRefusal(state, { id: 'e99', event: 'needs_decision_opened', ...BUILD.needs_decision_opened(k) });
    assert.match(why?.reason ?? '', /replaced or set aside by a decision, or a node above it was/, k);
  }
  assert.equal(transitionRefusal(state, { id: 'e99', event: 'needs_decision_opened', source: 'integration', agreement: 'R/M1@g1:A1', affected: [{ node: 'R/M1', generation: 1 }] }), null, 'source integration is exempt (it belongs to no node)');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- the HELD class (contract M6_HeldState_Contract_2026-10-12.md section 8)
// A third state class: an ELIGIBLE old child of a replaced root is HELD (not dead) between the decision's generation_opened and the release. The same walk over EVENT_FIELDS demands a decision for a HELD key.
const heldState = foldRecord([{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, 'needs_decision'),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1),
  { id: 'e8', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] },
  { id: 'e9', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e8', replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...G },
  { id: 'e10', event: 'generation_opened', decisionId: 'e9', nodes: [{ node: 'R', generation: 2 }] }]);
const HELD = 'R/M1@g1';
// per event: the reason a HELD key is refused (what its row owns), or the reason it is still recorded (the same as ACCEPTS; the table has no held rule for a fact about a process or a derivation)
const HELD_REFUSES = {
  node_registered: /already registered/,
  bundle_input_allowed: /held pending the new root plan: no allowance is recorded for it/,   // T-b: like a stop, an allowance is not recorded for a held key
  node_started: /closed|first claim/,
  node_resumed: /held pending the new root plan/,                                   // both purposes
  node_choice: /held pending the new root plan: it is neither resumed nor given a choice/,      // member verb: the held set is asked before the phase row
  grant_issued: /not stopped|top-up follows a budget stop/,
  node_closed: /already closed/,
  node_stopped: /not running|is closed|cannot stop/,
  needs_decision_opened: /held pending the new root plan: no stop is opened on it/,
  node_bundle_rebuilt: /held pending the new root plan: its input is not rebuilt/,    // REBUILD: refused while held; the due change stays on the record and the sitting after the release rebuilds
  plan_accepted: /is not an open stop/,                                              // a held key has no open stop either (2b)
  stop_restored: /is not an open stop/,                                              // a held key has no open stop either (the root re-plan retired them at the era boundary)
  decision_recorded: /no open stop|names an open stop|answers only the stop/,
};
test('the fixture really holds the key the scan uses, and it is not dead', () => {
  assert.ok(heldKeys(heldState).has(HELD)); assert.equal(deadKeys(heldState).has(HELD), false);
});
test('SCAN, HELD class: every node-naming event is decided for a HELD key too - refused with the reason its row owns (both purposes of node_resumed), or named in ACCEPTS with its reason; a held key never silently accepts node_started', () => {
  const naming = Object.entries(EVENT_FIELDS).filter(([, f]) => 'node' in f && 'generation' in f).map(([name]) => name);
  for (const extra of ['needs_decision_opened', 'decision_recorded']) if (!naming.includes(extra)) naming.push(extra);
  for (const name of naming) assert.ok(name in ACCEPTS || name in HELD_REFUSES, `${name} names a node and a generation: decide it for a HELD key (HELD_REFUSES or ACCEPTS)`);
  const failures = [];
  for (const [name, re] of Object.entries(HELD_REFUSES)) {
    const cases = name === 'node_resumed' ? ['resume', 'post_run'].map(purpose => ({ ...BUILD.node_resumed(HELD), purpose })) : [BUILD[name](HELD)];
    for (const ev of cases) {
      const why = transitionRefusal(heldState, { id: 'e99', event: name, ...ev });
      if (!why) failures.push(`${name}${ev.purpose ? `/${ev.purpose}` : ''}: ACCEPTED for a held key`); else if (!re.test(why.reason)) failures.push(`${name}${ev.purpose ? `/${ev.purpose}` : ''}: refused for another reason: ${why.reason}`);
    }
  }
  assert.deepEqual(failures, [], 'a held key is accepted, or refused for a reason that is not the one its row owns');
});

test('SCAN, HELD class, mid-expansion: a half-finished child (its verified split names a child nobody registered) is NOT held - a decision that leaves it out is refused by the table, so it can never pass the held rows by accident', () => {
  const events = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1, 'needs_decision'),
    ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1),
    { id: 'e4v', event: 'split_verified', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), splitSha256: 's', children: ['R/M1/M1'] },
    { id: 'e8', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] }];
  const s0 = foldRecord(events);
  const r = transitionRefusal(s0, { id: 'e99', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e8', replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...G });
  assert.match(r?.reason ?? '', /missing R\/M1@g1/, 'listing only the root would hold a half-finished child');
  const done = foldRecord([...events, { id: 'e9', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e8', replansRoot: true, affected: [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }], ...G }, { id: 'e10', event: 'generation_opened', decisionId: 'e9', nodes: [{ node: 'R', generation: 2 }] }]);
  assert.equal(heldKeys(done).has('R/M1@g1'), false, 'dead, not held');
});

// S5b part B: the second SHAPE of a stop - `bundle_input` names a node that is not in the record and carries NO runId. The dead-key row still comes first: a child of a replaced plan gets no stop before its registration either.
test('a bundle_input stop (no runId, an unregistered child) for a dead key is refused by the dead-key row, not by the row that follows it', () => {
  const failures = [];
  for (const [st, keys] of DEAD_BY_STATE) for (const k of keys.filter(x => nodeOf(x) !== 'R')) {
    const why = transitionRefusal(st, { id: 'e99', event: 'needs_decision_opened', source: 'bundle_input', node: nodeOf(k), generation: genOf(k), parent: { node: 'R', generation: 1 }, findings: [{ file: 'context.md', line: 1, name: 'n' }], carriers: [], affected: [{ node: nodeOf(k), generation: genOf(k) }] });
    if (!why) failures.push(`${k}: ACCEPTED`); else if (!/dead \(replaced or set aside by a decision, or a node above it was\)/.test(why.reason)) failures.push(`${k}: refused for another reason: ${why.reason}`);
  }
  assert.deepEqual(failures, []);
});

// c3b: the dead-key decision for node_closed_unstarted, measured on a hand-folded state (the fold applies events without the table): a bundle_input stop is open on R/M2@g1, and R/M2@g1 is DEAD (a regenerate decision made on another stop replaced it). The close is ACCEPTED and answers the stop; if it were refused the stop would have no exit.
test('a bundle_input stop open on a key that became DEAD still has its exit: the close of that never-registered child is accepted and answers the stop', () => {
  const upTo = EVENTS.findIndex(e => e.id === 'e8');
  const events = [...EVENTS.slice(0, upTo), { id: 'e7b', event: 'needs_decision_opened', source: 'bundle_input', node: 'R/M2', generation: 1, parent: { node: 'R', generation: 1 }, findings: [{ file: 'context.md', line: 1, name: 'n' }], carriers: [], affected: [{ node: 'R/M2', generation: 1 }] }];
  const st = foldRecord(events);
  assert.ok(deadKeys(st).has('R/M2@g1'), 'the fixture: R/M2@g1 is dead'); assert.ok(st.openStops.includes('e7b'), 'the fixture: the stop is open');
  const close = { id: 'e99', event: 'node_closed_unstarted', node: 'R/M2', generation: 1, stopId: 'e7b', ...G };
  assert.equal(transitionRefusal(st, close), null, 'accepted');
  const after = foldRecord([...events, close]);
  assert.deepEqual(after.openStops, [], 'the stop is answered by the close'); assert.ok(after.closedUnstarted.has('R/M2@g1'));
  // the row's own refusals still hold on this state
  assert.match(transitionRefusal(st, { ...close, stopId: 'e5' })?.reason ?? '', /answers an open stop of the input kind/);
  assert.match(transitionRefusal(st, { ...close, node: 'R/M1', generation: 1 })?.reason ?? '', /is registered/);
  assert.match(transitionRefusal(after, { ...close, id: 'e100' })?.reason ?? '', /already closed|answers an open stop/);
});
