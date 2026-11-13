// 0.8.3 ROADMAP 77, step 4b: the recommendation inside the real `council tree decide` form on a ROOT stop (decideHandler). 0.8.4 (the advice add-on is removed, wave 2): the recommendation route, its grant gate, its advice run and the
// `fromRecommendation` field are gone, so rows W1 and W3-W6 (the route, a chosen recommendation, its frame, Ctrl-C in flight, the grant word) were removed with the code they drove. What stays is W2: the form is the plain typed-text form,
// nothing about a recommendation is shown and no advice event is written. All $0, scripted terminal.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: six rows, five of them drove the recommendation route (src/tree-advice-route.js, src/tree-advice-record.js, the real cli.js advice run on a copy of mock-advise-quick, COUNCIL_ADVISE_* and COUNCIL_ADVICE_CHAINS_DIR in the child env). NEW: W2 only, with no advice chain and no advice settings. WHY: nothing in THC can send an advice call and `decideHandler` has no `recommend` or `adviceDeps` option any more.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { closedRootTree, GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';

function setup() {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'The plan leaves the billing out.', ...GATE_FIELDS });
  const stopId = stateOf(readTreeRecord(t.rootDir)).openStops[0];
  const env = { PATH: process.env.PATH, HOME: t.work };
  return { t, env, stopId };
}
const decide = (s, io, extra = {}) => decideHandler({ ...extra, rootDir: s.t.rootDir, rootId: ROOT_ID, flags: { fresh: true }, work: s.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), env: s.env });

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: "with the production brief builder (held) the form is as before: no request begun, nothing extra shown". NEW: the same expectations with no brief builder, no advice chain and no advice settings in the env. WHY: the held brief builder and the route are removed; the typed-text form is all there is.
test('W2 the root re-plan form is the plain typed-text form: a decision is recorded, no advice event is written and nothing about a recommendation is shown', { timeout: 60_000 }, async () => {
  const s = setup();
  const io = terminal(['A fresh plan that covers the billing.\n.', s.stopId, 'y']);
  const code = await decide(s, io);
  assert.equal(code, 0, io.shown() + io.errors());
  const events = readTreeRecord(s.t.rootDir).events;
  assert.ok(events.some(e => e.event === 'decision_recorded'), 'a decision was recorded');
  assert.equal(events.some(e => /^advice_/.test(e.event)), false);
  assert.doesNotMatch(io.shown(), /recommendation/i);
});
