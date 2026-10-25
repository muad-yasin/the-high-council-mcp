// Astra (c) (Muad 25 Okt 2026 14:45 "Yes to all"; D3 F2-5): the free edit-and-accept route is KEPT for a provider whose plan lacks the heading its parent promised. The stop on the provider (derivation_refused, D2 F2) is answered by
// accepting the edited plan ONLY when every child it holds back now derives from the edited text (the writer re-derives against the candidate; the event carries `rechecked`); a repair that still misses refuses and says which child.
// Real all-mock trees through the real writer, $0 (there is no MCP accept form: SESSION_FORMS; the person's form builds on the same candidate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf, TreeRefusal } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { acceptChangedPlan } from '../src/tree-accept.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';

async function providerStopped() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: plan3(b) });
  approvePending(r);
  writeFileSync(join(r.t.work, 'no-overview.md'), '# The provider plan\n\n## Store\nThe store keeps every record.\n\nREVISED MOCK DELIVERABLE\n');
  const start = draftStarter(r, { 'R/M1': 'no-overview.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  const stop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === 'R/M1').at(-1);
  assert.ok(stop?.blockedBy.some(x => x.code === 'derivation_refused'), JSON.stringify(stop));
  const m1 = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  return { r, start, stop, file: join(r.t.runsDir, m1.runId, 'deliverable.md') };
}
const accept = (r, stop) => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'session', via: 'mcp', reason: 'adds the Overview section the parent promised; same split, same obligations', runsDir: r.t.runsDir, work: r.t.work });
const refusalOf = fn => { try { fn(); } catch (e) { if (e instanceof TreeRefusal) return e.reason; throw e; } assert.fail('no refusal'); };

test('(c) KEPT: the provider\'s plan edited to hold the promised heading is accepted on its derivation_refused stop; the event carries rechecked; the consumer then registers', { timeout: 600_000 }, async () => {
  const { r, start, stop, file } = await providerStopped();
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Store\n', '## Overview\nget(id) and put(record).\n\n## Store\n'));
  const out = accept(r, stop);
  assert.deepEqual(out.event.rechecked, ['derivation_refused']);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), false, 'the stop is answered');
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R/M2@g1'), true, 'the consumer registers against the accepted plan');
});

test('(c) NARROW: an edit that still lacks the heading is refused and names the child it still cannot feed; nothing is recorded', { timeout: 600_000 }, async () => {
  const { r, stop, file } = await providerStopped();
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Store\n', '## Summary\nA summary.\n\n## Store\n'));
  assert.match(refusalOf(() => accept(r, stop)), /^the changed plan still does not give R\/M2@g1 its input \(missing_context\): .*Overview/);
  assert.equal(eventsOf(r).filter(e => e.event === 'plan_accepted').length, 0);
});

// LB-3 (C&C's ruling on the fresh-eyes read, 25 Okt 2026): EVERY accept of a plan with a verified split runs the one resolver against the accepted text, so a prose edit outside the fence that removes a heading the split names is refused
// before it can leave a derivation stop no free route closes. Through the real writer (the person's typed form builds on the same candidate; the gate fields here are the shape the table checks, named as test values).
test('LB-3: a root plan edited OUTSIDE its split fence so that "Overview" (named by every child\'s context_refs) is gone is NOT accepted: the refusal names the child and the heading; nothing is recorded', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() });
  const file = join(r.runDir, 'deliverable.md');
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Overview\nA plan.\n', '## Summary\nA plan.\n'));
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 0 });
  const stop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === 'R').at(-1);
  assert.ok(stop?.blockedBy.some(b => b.code === 'plan_unreadable'), JSON.stringify(stop));
  const reason = refusalOf(() => acceptChangedPlan(r.t.rootDir, { stopId: stop.id, actor: 'person', via: 'terminal', gate: { gateId: 'g-test', shownSha256: 'a'.repeat(64) }, runsDir: r.t.runsDir, work: r.t.work }));
  assert.match(reason, /^the changed plan breaks a reference of its own split: R\/M1 \(K1\): .*Overview/);
  assert.equal(eventsOf(r).filter(e => e.event === 'plan_accepted').length, 0);
});
