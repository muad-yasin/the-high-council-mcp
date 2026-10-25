// Slice 6 of M5e: L17 (a released share re-admits a child the approval showed as `not admitted: budget`), the integration stop (no node) is regenerate-only (item 9), and the texts the sitting ends with (item 6: a registered-not-started
// child and its held grant, a frontier closed under a changed parent, a guard refusal of an unregistered node "derived, not admitted", what waits for a node a person closed incomplete, the needs_decision stop). Real all-mock trees, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { decideHandler } from '../src/tree-decide.js';
import { requestStop } from '../src/tree-run.js';
import { registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { exitCodeOf, sittingLines } from '../src/tree-resume.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren, needsDecisionRoot, pricedChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { capFor, pricedDebateFigures, ceilCents } from './helpers/money-figures.js';
import { SPLIT_ROOT_HANDOFF_USD as ROOT_HANDOFF } from './helpers/tree-fixture.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 6000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};
// CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); this test passed on fad02049 and typed the same class of figure). OLD: cap 9.84 typed (first share 3.27 under the cheapest end 4.119, then 4.90 for two: admitted, under the at-most 4.919). NEW: the cap is a function of priced-debate's own dry-run figures: the pool X = 2 x S, S half way between the cheapest end and the at-most figure, so the first of three gets X / 3 (under the cheapest end) and the two left get S each (over it, under the at-most). WHY: the figures move with every recorded or reworded sentence in src/roles.js.
const stopScreenCap = () => {
  const f = pricedDebateFigures(); const S = ceilCents((f.cheapestUsd + f.atMostUsd) / 2);
  assert.ok(2 * S / 3 < f.cheapestUsd && S >= f.cheapestUsd && S < f.atMostUsd, 'fixture: the first of three is under the cheapest end, the two left are over it and under the at-most');
  return capFor(S, 2, ROOT_HANDOFF);
};
const children = r => Object.fromEntries(describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) }).view.children.map(c => [c.node, c]));

test('L17: a child the approval showed as "not admitted: budget" is proposed AGAIN once a node closed and gave its unspent share back: the frontier waits for an approval once more, the new approval admits it with a grant, and it then runs', { timeout: 600_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), cap: stopScreenCap() });      // stopScreenCap(): the first share of three is under priced-debate's cheapest end, the two left are over it and under its at-most (derived, asserted in the helper above); history: the estimator unit moved the typed cap 8 -> 9.84 (fixture-delta-trace.txt)
  const before = children(r);
  assert.equal(before['R/M1'].admitted, false); assert.equal(before['R/M1'].refusedBy, 'budget'); assert.match(before['R/M1'].notAdmittedReason, /not admitted: budget/);
  approvePending(r);
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }), null, 'approved: nothing waits yet');
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(out.started.map(s => s.node), ['R/M3'], 'only the independent admitted child ran; R/M1 was not admitted and R/M2 waits for it');
  assert.ok(eventsOf(r).find(e => e.event === 'node_closed' && e.node === 'R/M3').returnedUsd > 0, 'R/M3 gave its unspent share back');
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending, 'the share was released: the frontier waits for a person again');
  const after = children(r);
  assert.equal(after['R/M1'].admitted, true); assert.ok(after['R/M1'].grant > 0, 'proposed again, with a grant'); assert.equal(after['R/M3'].registered.phase, 'closed', 'a registered child is shown as registered, never re-admitted');
  assert.ok(out.approvalWaits === true && out.status === 'nothing_to_do'); 
  approvePending(r);
  const out2 = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(out2.started.map(s => s.node), ['R/M1', 'R/M2']);
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'closed', 'R/M2': 'closed', 'R/M3': 'closed' });
});

test('item 9: the integration stop (no node) is answered by REGENERATE only: `--milestone` on it is refused before any gate (a stop belongs to the node whose split holds the milestone), regenerate works', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({});
  const stop = appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', source: 'integration', affected: [{ node: 'R', generation: 1 }] });
  const n = eventsOf(r).length;
  const m = decide(r, { milestone: 'R@g1:M5' }, []); assert.equal(await m.run(), 1);
  assert.match(m.io.errors(), /no open stop of R@g1, the node whose split holds the milestone/); assert.equal(m.io.shown(), ''); assert.equal(eventsOf(r).length, n);
  const named = decide(r, { milestone: 'R@g1:M5', stop: stop.id }, []); assert.equal(await named.run(), 1); assert.match(named.io.errors(), /that is an integration stop, which belongs to no node; a milestone is resolved in place only through the stop of R@g1/);
  const ok = decide(r, {}, ['Regenerate it.\n.', stop.id, 'y']); assert.equal(await ok.run(), 0, ok.io.shown() + ok.io.errors());
  assert.equal(eventsOf(r).filter(e => e.event === 'decision_recorded').length, 1);
});

// ----------------------------------------------------------------------------------------------------------------------- item 6: what the sitting's end text says
test('the sitting that OPENS a needs_decision stop prints that stop: the node\'s own words, the agreements, the affected set with its reason (finished ones stale), the spend and the share given back, the work that can still run', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionChildren());
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.equal(out.stops.length, 1);
  const text = sittingLines(out, 'rid').join('\n');
  assert.match(text, new RegExp(`Stop ${out.stops[0].id}: R/M1 generation 1 ended with the Status needs_decision\\.`));
  assert.match(text, /What it says it is, word for word:\n\s+\| A fixture handoff\./);
  assert.match(text, /Agreements it provides:\n\s+- A1 to R\/M2: K1 exposes get\(id\) and put\(record\) on the store\./);
  assert.match(text, /R\/M1 \(finished, now stale\): the node that stopped/); assert.match(text, /R\/M2: it expects an agreement from R\/M1/);
  assert.match(text, /Spent on it so far \$[0-9.]+; its unspent share \$[0-9.]+ went back to the pool/); assert.match(text, /Independent work that can still run: R\/M3/);
  assert.equal(/R\/M3 \(finished/.test(text), false);
});

test('a child REGISTERED and not started is named with the grant it holds, and how to release it', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.kind, 'registered');
  requestStop(r.t.rootDir);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'stopped_by_person'); assert.deepEqual(out.registeredNotStarted.map(c => [c.node, c.grantUsd > 0]), [['R/M1', true]]);
  const text = sittingLines(out, 'rid').join('\n');
  assert.match(text, /R\/M1 is registered but has not started: it holds a grant of \$[0-9.]+ \(run \S+\) until it starts or a person closes it \(`council tree decide rid --close R\/M1`\)\./);
});

test('a frontier closed under a changed parent is named, with how to lift it, and the blocked sitting exits 20 (a person can act)', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const d = approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const b = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(b.node, 'R/M2');
  const file = join(r.t.runsDir, ROOT_ID, 'deliverable.md'); writeFileSync(file, `${readFileSync(file, 'utf8')}\nAn edit after the approval.\n`);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });                        // the start is refused: parent_changed is recorded
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.equal(out.status, 'blocked'); assert.deepEqual(out.reasons, ['parent_changed']);
  const text = sittingLines(out, 'rid').join('\n');
  assert.match(text, new RegExp(`Frontier ${d.frontierKey.slice(0, 8)} was closed under a changed parent[^]*council tree approve rid`));
  assert.equal(exitCodeOf(out), 20);
});

test('a guard refusal of a node that was derived and never registered reads "derived, not admitted"; the same refusal of a registered node is not listed there', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  appendTreeEvent(r.t.rootDir, { event: 'guard_refused', node: 'R/M3', generation: 1, item: 'The plan stays consistent with the milestone format of HANDOFF.md', guard: 'infeasibleCriteria', origin: 'R:C4' });
  requestStop(r.t.rootDir);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(out.guardRefusals.map(g => [g.node, g.guard]), [['R/M3', 'infeasibleCriteria']]);
  appendTreeEvent(r.t.rootDir, { event: 'guard_refused', node: 'R', generation: 1, item: 'something about the root', guard: 'metaCriteria', origin: 'R:C1' });                  // the ROOT is registered: not "derived, not admitted"
  const again = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(again.guardRefusals.map(g => g.node), ['R/M3'], 'a refusal of a REGISTERED node is not listed as derived-not-admitted');
  assert.match(sittingLines(out, 'rid').join('\n'), /R\/M3@g1 was derived, not admitted: the guard infeasibleCriteria refused the item "The plan stays consistent with the milestone format of HANDOFF\.md" and the node was not registered\./);
});

test('a provider a person closed incomplete opens the blocked-child stop (M6, row 116: the only route to a replacement), and the sitting says what it holds back and how to answer it', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work }); assert.equal(reg.node, 'R/M1');
  const c = decide(r, { close: 'R/M1' }, ['R/M1', 'y']); assert.equal(await c.run(), 0, c.io.shown() + c.io.errors());
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const text = sittingLines(out, 'rid').join('\n');
  // EDITED in M6 S3b (disclosed; old: /R\/M2 waits: provider K1: R\/M1 was closed incomplete by a person/ and /A node a person closed incomplete never becomes a provider: what waits for it starts only if that node is replaced\./):
  // a node a person closed incomplete had NO route to a replacement (decide refused with no stop open), so it now opens the blocked-child stop; the sitting ends held by that stop and says what it holds back and the exact command
  assert.match(text, /R\/M2 is held: R\/M2 is stale: stop e\d+ put it in question/);
  assert.match(text, /Stop e\d+: R\/M1 generation 1 finished, and the tree cannot count it:\n {2}- closed_incomplete: R\/M1@g1 was closed as incomplete by a person/);
  assert.match(text, /regenerate what it affects \(a new generation of R\/M1\): council tree decide \S+ --stop e\d+/);
});

test('L17 is an OFFER, never a stall: after an unrelated close returns a share, a child the standing approval admitted still registers WITHOUT a new approval, while the budget-refused child is offered again at the next approve', { timeout: 600_000 }, async () => {
  const b = block3();
  b.agreements = [];
  for (const c of b.children) { c.provides = c.provides.map(p => ({ ...p, agreements: [] })); c.expects = c.expects.map(e => ({ ...e, agreements: [] })); }
  const r = await trackedRealRoot({ ...pricedChildren(), cap: stopScreenCap(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const shown = children(r);
  assert.deepEqual([shown['R/M1'].admitted, shown['R/M2'].admitted, shown['R/M3'].admitted], [false, true, true], 'R/M1 is refused for the share; R/M2 and R/M3 are admitted and independent');
  approvePending(r);
  const start = draftStarter(r);
  const first = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: start });
  assert.deepEqual(first.started.map(x => x.node), ['R/M2']);
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }) !== null, true, 'R/M2 closed and returned a share: the budget-refused R/M1 is OFFERED again');
  const second = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.deepEqual(second.started.map(x => x.node), ['R/M3'], 'R/M3, admitted by the standing approval, registers and runs with NO new approval');
  assert.equal(phases(r)['R/M3'], 'closed'); assert.equal(second.approvalWaits, true);
});

test('the needs_decision stop offers only the routes its forms accept: the ROOT\'s own stop is answered in place on a root milestone or by a new root run (never "regenerate"); a leaf child\'s stop is regenerated (no --milestone: it has no milestone to resolve); nothing is offered that refuses', { timeout: 600_000 }, async () => {
  const root = await trackedRealRoot(needsDecisionRoot());
  approvePending(root);
  const o1 = await runTree(root.t.rootDir, { work: root.t.work, maxStarts: 0, startRun: draftStarter(root) });
  const rt = sittingLines(o1, 'rid').join('\n');
  assert.match(rt, /Stop e\d+: R generation 1 ended with the Status needs_decision\./);
  assert.match(rt, /You can:\n\s+- answer it in place: council tree decide \S+ --milestone R@g1:M5 --stop e\d+\n\s+- answer it with a NEW ROOT plan: council tree decide \S+ --stop e\d+/);
  assert.equal(/regenerate what it affects|leave the branch incomplete/.test(rt), false, 'a root stop is offered a new ROOT plan, never the child regenerate');
  const kid = await trackedRealRoot(needsDecisionChildren());
  approvePending(kid);
  const o2 = await runTree(kid.t.rootDir, { work: kid.t.work, maxStarts: 1, startRun: draftStarter(kid) });
  const kt = sittingLines(o2, 'rid').join('\n');
  assert.match(kt, /You can:\n\s+- regenerate what it affects: council tree decide \S+ --stop e\d+/); assert.match(kt, /widen it to one obligation/);
  assert.equal(/--milestone|leave the branch incomplete/.test(kt), false, 'a leaf child has no milestone to resolve');
});

test('"Independent work that can still run" leaves out what is stale (a node another stop put in question) and what is superseded', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionChildren());
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'obligation', affected: [{ node: 'R/M3', generation: 1 }] });
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const text = sittingLines(out, 'rid').join('\n');
  assert.match(text, /Independent work that can still run: \(none\)/, 'R/M3 is stale: it is not work that can run');
});
