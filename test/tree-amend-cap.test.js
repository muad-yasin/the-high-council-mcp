// CHANGED ACCEPTED (stale literals left by 1e81a99, estimator unit commit 2, ruling B-narrow; named by the line history; 20 Okt 2026; second pass after C&C's finding that 7ce4b8c let a raise become a lowering): that commit moved this file's fixture cap 20 -> 26 and none of the literals. OLD cap in force $20.00, grant $6.65, typed total 40 (ADDS $20.00), event [20, 40, 1], +20 available, refuse amend-cap 20, fromCapUsd 20 (the hand-lowering), 'started at $20.00', window amendment to 25 (a $5 raise); NEW $26.00, $8.65, typed total 46 (still ADDS $20.00, the raise branch), event [26, 46, 1], +20, refuse 26, fromCapUsd 26, '$26.00', window amendment to 31 (a $5 raise). WHY: arithmetic of the cap that commit set, and every typed figure moved WITH the cap so each case stays on the branch it was written for (raise); no code moved.
// 0.8.3 M6 atomic tree budget, COMMIT 2 (approvals + person-facing text; gate page Review/Build_0.8.3/m6-closing/Atomic_Tree_Budget_Gate_Page.md section 13 and 13.1): `council tree decide <root> --amend-cap <total>` - the form, its
// hashed text, the refusals before anything is typed, the offer of a budget-refused child after a raise, and the readiness reason `awaiting_cap`. All-mock, $0: the stopped child is a REAL mock-budget run that hits its cap through the
// sitting (as test/tree-decide-topup.test.js). The library `amendCap`, the event and the gate's `over_committed` are commit 1 (test/tree-cap-amended.test.js). Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../src/thin-contract.js';
import { EVENTS_FILE, TREE_DIR, TREE_FILE, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { amendCap, budgetOf, capFactsOf, ceilCents, effectiveCapUsd, gateTree } from '../src/tree-budget.js';
import { chooseForm, decideHandler } from '../src/tree-decide.js';
import { frontierOffersShare } from '../src/tree-frontier.js';
import { abandonTree } from '../src/tree-abandon.js';
import { TREE_ONLY_FLAGS } from '../src/tree-cli.js';
import { gatherReadinessFacts, verdictOf } from '../src/tree-ready.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { approvePending, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { GATE_FIELDS, ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';
import { assertRefusedWithoutAsking } from './helpers/bound-text.js';
import { stoppedChildFixture, usdRx } from './helpers/money-figures.js';

const treeJson = r => readFileSync(join(r.t.rootDir, TREE_DIR, TREE_FILE));
const decide = (r, flags, answers, extra = {}) => {
  const io = terminal(answers);
  if (answers.length === 0) io.stdin.end();     // a run that has nobody to answer and wrongly ASKS ends (and fails its assertions) instead of waiting for ever
  if (extra.onPrompt) io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d))) extra.onPrompt(); });
  const run = () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  return { io, run };
};
const amends = r => eventsOf(r).filter(e => e.event === 'cap_amended');
// CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed five tests of this file, #3772-#3776). OLD: the fixture cap 26, the child grant 8.65 and the typed totals 46 (a raise of 20) and 31 (a raise of 5), sized against mock-budget's cheapest end 8.064. NEW: G, CAP = test/helpers/money-figures.js stoppedChildFixture() (the equal share just over mock-budget's own cheapest end, and the root cap whose
// share among three children is G); NEWTOTAL = CAP + 20 and WINDOW = CAP + 5 keep each case on the branch it was written for (a raise). WHY: recording the drafted words moves the cheapest end (8.064 -> 8.714), so 26 / 3 = 8.67 fell under it, R/M1 was not admitted and stopped() failed with another stop (held_by_stop: no_milestone_lint) before any assertion of the test.
const { G, CAP } = stoppedChildFixture();
const NEWTOTAL = Math.round((CAP + 20) * 100) / 100;       // a raise of $20.00
const WINDOW = Math.round((CAP + 5) * 100) / 100;          // the amendment made while the person reads: a raise of $5.00
const AMEND = { gateId: GATE_FIELDS.gateId, shownSha256: GATE_FIELDS.shownSha256, actor: GATE_FIELDS.actor, via: GATE_FIELDS.via };       // K10 (EDITED; OLD: gateId + shownSha256 only; NEW: and who answered; WHY: the table requires actor/via on a new cap_amended and abandon
/** A tree with a real child (R/M1) stopped at its cap: root cap 20, mock-budget children (the topup test's tree). */
async function stopped() {
  const r = await trackedRealRoot({ childChain: 'mock-budget', cap: CAP });      // CAP is stoppedChildFixture()'s root cap (a share G just over mock-budget's cheapest end among three children; the CHANGED ACCEPTED note above); history: the estimator unit moved the typed cap 20 -> 26 (fixture-delta-trace.txt)
  approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work });
  assert.equal(out.status, 'budget_stop', JSON.stringify(out)); assert.equal(out.node, 'R/M1');
  assert.equal(phases(r)['R/M1'], 'stopped');
  return r;
}

test('the form, driven at a terminal on a real tree with a stopped child: the text carries the cap in force, the new total, what it does, where the money stands, the nodes that hold or wait; the person types the total twice; cap_amended carries the gate and the hash of THAT text; tree.json is untouched; nothing starts', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const treeBefore = treeJson(r);
  const budget0 = budgetOf(r.t.rootDir);
  const registeredBefore = eventsOf(r).filter(e => e.event === 'node_registered').length;
  const d = decide(r, { 'amend-cap': String(NEWTOTAL) }, [String(NEWTOTAL), 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const shown = d.io.shown();
  assert.match(shown, /Change the cap of this whole tree\?   \(tree .*, amendment 1\)/);
  assert.match(shown, new RegExp(`The cap in force: \\$${usdRx(CAP)} \\(the cap the tree started with, as tree\\.json says\\)\\.`));
  assert.match(shown, new RegExp(`You type a NEW TOTAL for the whole tree: \\$${usdRx(NEWTOTAL)}\\.`));
  assert.match(shown, /This ADDS \$20\.00 to what the whole tree may spend\. The total you type replaces the cap; it is not an increase on top of it\./);
  assert.match(shown, /Where the money stands now:[^]*spent, or in flight at its bound: \$[0-9.]+[^]*granted and not yet spent: \$[0-9.]+[^]*free \$[0-9.]+[^]*committed in all: \$[0-9.]+ \(the lowest total this form accepts: \$[0-9.]+\)/);
  assert.match(shown, new RegExp(`R/M1@g1: stopped; grant \\$${usdRx(G)}, spent \\$[0-9.]+, still held \\$[0-9.]+`));
  assert.match(shown, /Waiting for money: R\/M1@g1 \(stopped at its cap\)\./);
  assert.match(shown, /This starts nothing and resets nothing\. A raise gives a stopped node no money of its own; a stop that is not about money/);
  assert.match(shown, new RegExp(`To approve, type the new total: ${NEWTOTAL}\\n`)); assert.match(shown, /Type the new total shown in the last line above: /);
  const [ev] = amends(r);
  assert.equal(amends(r).length, 1);
  assert.deepEqual([ev.fromCapUsd, ev.toCapUsd, ev.expectedRevision], [CAP, NEWTOTAL, 1]);
  assert.ok(ev.gateId); assert.match(ev.shownSha256, /^[0-9a-f]{64}$/);
  const textFile = join(r.t.rootDir, TREE_DIR, 'gate-texts', `tree_decide-${ev.shownSha256.slice(0, 16)}.txt`);
  assert.equal(existsSync(textFile), true, 'the text the person read is on disk under its hash'); assert.equal(sha256Of(readFileSync(textFile, 'utf8')), ev.shownSha256);
  assert.deepEqual(treeJson(r), treeBefore, 'tree.json is byte-identical');
  assert.equal(effectiveCapUsd(readTreeRecord(r.t.rootDir)), NEWTOTAL);
  assert.ok(Math.abs(budgetOf(r.t.rootDir).availableUsd - (budget0.availableUsd + 20)) < 1e-6, 'twenty more dollars are free');
  assert.equal(phases(r)['R/M1'], 'stopped', 'decide starts nothing'); assert.equal(eventsOf(r).some(e => e.event === 'node_resumed'), false);
  assert.equal(eventsOf(r).filter(e => e.event === 'node_registered').length, registeredBefore);
  assert.match(d.io.shown(), new RegExp(/Recorded: amend the cap to @NEWTOTAL@\. Nothing was started and nothing was reset\. A stopped node needs its own money: `council tree decide .* --top-up <node> --amount <usd>`, then `council tree resume /.source.replace('@NEWTOTAL@', String(NEWTOTAL))), 'the after-line names the real next step for a stopped node, not a bare resume');
});

test('each refusal asks nobody and writes nothing: a total that is not a plain amount (B\'s one grammar), the cap already in force, a total below what is committed (the lowest accepted is named, rounded up to the cent), a node with a live claim, a failing gate other than over_committed, a final tree; and the form is one of PRIMARY', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const events0 = eventsOf(r).length; const gates = () => { try { return readdirSync(join(r.t.rootDir, 'gates')).length; } catch { return 0; } }; const gates0 = gates();
  const refuse = async (flags, pattern) => { const d = decide(r, flags, []); await assertRefusedWithoutAsking(d, pattern); };
  await refuse({ 'amend-cap': '12abc' }, /--amend-cap: .*is not a plain number of dollars/);
  await refuse({ 'amend-cap': 'none' }, /--amend-cap: An unlimited run is not offered/);
  await refuse({ 'amend-cap': '0' }, /--amend-cap: A limit of 0 allows no paid call/);
  await refuse({ 'amend-cap': '12.12345' }, /--amend-cap: .*more than four decimals/);
  await refuse({ 'amend-cap': String(CAP) }, new RegExp(`\\$${usdRx(CAP)} is the cap already in force: nothing to amend`));
  const b = budgetOf(r.t.rootDir); const floor = ceilCents(b.treeSpentUsd + b.unknownSpendHeldUsd + b.heldUsd);
  await refuse({ 'amend-cap': String(Math.floor(floor) - 1 > 0 ? Math.floor(floor) - 1 : 1) }, new RegExp(`is below the \\$${floor.toFixed(2)} already committed[^]*the lowest total accepted now is \\$${floor.toFixed(2)}`));
  assert.equal(amends(r).length, 0); assert.equal(eventsOf(r).length, events0, 'nothing was written by any refusal'); assert.equal(gates(), gates0, 'no gate request was made');
  // a live claim: the figures change while it runs
  appendTreeEvent(r.t.rootDir, { event: 'node_resumed', purpose: 'resume', ...claim('R/M1', stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId, process.pid, 1, hostnameOf()) });
  await refuse({ 'amend-cap': String(NEWTOTAL) }, /R\/M1@g1 has a live claim \(pid \d+ on .*\): its figures change while it runs, so the figures you read could not be the ones recorded; amend the cap when it has ended or stopped \(`council tree stop .*` starts nothing further but lets a running node finish\)/);
  appendTreeEvent(r.t.rootDir, { event: 'node_stopped', node: 'R/M1', generation: 1, runId: stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId, reason: 'budget' });
  // a failing gate other than over_committed (a started member's run folder is gone; moved aside, not deleted)
  const runId = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').runId; const dir = join(r.t.runsDir, runId);
  renameSync(dir, `${dir}.moved`);
  await refuse({ 'amend-cap': String(NEWTOTAL) }, /the accounting gate fails \(.*member_folder_missing.*\); the cap is not amended while it does/);
  renameSync(`${dir}.moved`, dir);
  // one form per invocation
  assert.match(chooseForm({ 'amend-cap': '12', close: 'R/M1' }).error, /one form per invocation: --close, --amend-cap|one form per invocation: --amend-cap, --close/);
  assert.deepEqual(chooseForm({ 'amend-cap': '12' }), { form: 'amend-cap', value: '12' });
  // a final tree answers with its one sentence first
  abandonTree(r.t.rootDir, AMEND);
  await refuse({ 'amend-cap': String(NEWTOTAL) }, /abandoned by a person[^]*Nothing was asked and nothing was written/);
});

test('the revision the text shows is the one recorded: an amendment made while the person reads makes the rebuilt text differ, and the approval is NOT used (exit 1, one cap_amended on the record)', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const d = decide(r, { 'amend-cap': String(NEWTOTAL) }, [String(NEWTOTAL), 'y'], { onPrompt: () => { amendCap(r.t.rootDir, { toCapUsd: WINDOW, expectedRevision: 1, ...AMEND }); } });
  assert.equal(await d.run(), 1, d.io.shown() + d.io.errors());
  assert.match(d.io.errors(), /what you were shown has changed while you were reading it[^]*Your approval was NOT used and nothing was recorded/);
  assert.deepEqual(amends(r).map(e => [e.toCapUsd, e.expectedRevision]), [[WINDOW, 1]], 'only the amendment made in the window is on the record');
});

test('a total hand-lowered below what is committed (a record edited by hand, over_committed) is cured THROUGH the form: the screen says the record is OVER the cap by the figure, and the raise is recorded as amendment 2', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const next = Math.max(...eventsOf(r).map(e => Number(e.id.slice(1)))) + 1;
  appendFileSync(join(treeDirOf(r.t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: 'tree-events/1', id: `e${next}`, event: 'cap_amended', fromCapUsd: CAP, toCapUsd: 5, expectedRevision: 1, ...AMEND, at: new Date().toISOString() })}\n`);
  assert.deepEqual(gateTree(r.t.rootDir).problems.map(p => p.code), ['over_committed']);
  const d = decide(r, { 'amend-cap': '30' }, ['30', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  assert.match(d.io.shown(), /\(tree .*, amendment 2\)/); assert.match(d.io.shown(), new RegExp(`\\(the tree started at \\$${usdRx(CAP)}, as tree\\.json still says, and has been amended 1 time\\)`));
  assert.match(d.io.shown(), /OVER the cap by \$[0-9.]+ \(the record commits more than the cap allows\)/);
  assert.equal(effectiveCapUsd(readTreeRecord(r.t.rootDir)), 30);
  assert.equal(gateTree(r.t.rootDir).ok, true, 'the raise cured it');
});

test('awaiting_cap: incomplete (never blocked, never sticky) exactly when something waits for money AND under a cent is free; its words name the real next step per waiting item; it goes when money is free again', { timeout: 300_000 }, async () => {
  const r = await stopped();
  const reasons = () => verdictOf(gatherReadinessFacts(r.t.rootDir, { work: r.t.work })).reasons;
  assert.equal(reasons().some(x => x.code === 'awaiting_cap'), false, 'money is free: the existing "stopped" reason stands, awaiting_cap does not');
  const b = budgetOf(r.t.rootDir);
  amendCap(r.t.rootDir, { toCapUsd: ceilCents(b.treeSpentUsd + b.unknownSpendHeldUsd + b.heldUsd), expectedRevision: 1, ...AMEND });      // the lowest total: nothing free
  assert.ok(budgetOf(r.t.rootDir).availableUsd < 0.01);
  const a = reasons().find(x => x.code === 'awaiting_cap');
  assert.ok(a, 'exhausted and a stopped node waits'); assert.deepEqual([a.severity, a.scope], ['incomplete', 'tree']);
  assert.match(a.text, /the cap \(\$[0-9.]+\) is used or held and less than a cent is free: R\/M1@g1 stopped at its cap\./);
  assert.match(a.text, new RegExp(`A new total is typed at a terminal with \`council tree decide ${ROOT_ID} --amend-cap <total>\`; a stopped node then gets money with \`council tree decide ${ROOT_ID} --top-up <node> --amount <usd>\` and is resumed`));
  assert.equal(a.text.includes('council tree approve'), false, 'no refused child waits: that step is not named');
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).sticky.size, 0, 'it is not sticky');
  amendCap(r.t.rootDir, { toCapUsd: 60, expectedRevision: 2, ...AMEND });
  assert.equal(reasons().some(x => x.code === 'awaiting_cap'), false, 'money is free again: the reason goes');
  // a FINAL tree refuses every amendment: nothing waits for money there, so no awaiting_cap tells a person to amend it
  amendCap(r.t.rootDir, { toCapUsd: ceilCents(budgetOf(r.t.rootDir).treeSpentUsd + budgetOf(r.t.rootDir).unknownSpendHeldUsd + budgetOf(r.t.rootDir).heldUsd), expectedRevision: 3, ...AMEND });
  assert.equal(reasons().some(x => x.code === 'awaiting_cap'), true, 'exhausted again');
  abandonTree(r.t.rootDir, AMEND);
  assert.deepEqual(capFactsOf(readTreeRecord(r.t.rootDir), budgetOf(r.t.rootDir)).waiting, [], 'an abandoned tree has nothing that waits for money');
});

test('a RAISE re-offers a frontier that was approved with a child refused for budget (frontierOffersShare, an offer only); a lowering, a raise from before the approval, a child not refused for budget and a registered child do not', () => {
  const K = 'kA';
  const base = [
    { event: 'frontier_previewed', frontierKey: K, children: [{ node: 'R/M2', generation: 1, admitted: false, refusedBy: 'budget' }, { node: 'R/M1', generation: 1, admitted: true }] },
    { event: 'frontier_approved', frontierKey: K },
  ];
  const raise = { event: 'cap_amended', fromCapUsd: 10, toCapUsd: 20 };
  assert.equal(frontierOffersShare({ events: base }, K), false, 'nothing changed since the approval');
  assert.equal(frontierOffersShare({ events: [...base, raise] }, K), true, 'a raise since the approval frees money like a closed node\'s share');
  assert.equal(frontierOffersShare({ events: [...base, { ...raise, fromCapUsd: 20, toCapUsd: 12 }] }, K), false, 'a lowering frees nothing');
  assert.equal(frontierOffersShare({ events: [raise, ...base] }, K), false, 'a raise from before the approval was already in the figures the person approved');
  const otherRefusal = [{ ...base[0], children: [{ node: 'R/M2', generation: 1, admitted: false, refusedBy: 'stale' }] }, base[1], raise];
  assert.equal(frontierOffersShare({ events: otherRefusal }, K), false, 'only a child refused for BUDGET is helped by money');
  const registered = [...base, { event: 'node_registered', node: 'R/M2', generation: 1 }, raise];
  assert.equal(frontierOffersShare({ events: registered }, K), false, 'a registered child needs no offer');
});

test('the flag is registered: tree decide takes --amend-cap (TREE_ONLY_FLAGS), the usage names it, and cli.js reads it as a VALUE flag (so its number is not a stray word)', () => {
  assert.ok(TREE_ONLY_FLAGS.includes('amend-cap'));
  const root = join(import.meta.dirname, '..', 'src');
  assert.match(readFileSync(join(root, 'tree-cli.js'), 'utf8'), /\| --amend-cap <total> \|/);
  assert.match(readFileSync(join(root, 'cli.js'), 'utf8'), /const VALUE_FLAGS = new Set\(\[[^\]]*'amend-cap'/);
});
