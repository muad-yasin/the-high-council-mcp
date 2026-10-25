// `council tree decide`: the framework and the three limit raises (0.8.3 M5d, sub-commit 1; PLAN 8.6, D17; M5 exit checks L13, L14). All-mock, $0. Real children run through api.run where a test says so. The flow tests
// CHANGED ACCEPTED (label rename, 20 Okt 2026; Muad 18 Okt: "upper estimate" replaces "at most" and "maximum"): OLD the printed label "at most" / "MAXIMUM" / "Maximum:"; NEW "upper estimate" / "UPPER ESTIMATE" / "Upper estimate:". WHY: only the printed figure label moved; the held sentences (README/docs/chain descriptions) still say "at most" and their pins here are unchanged.
// use LOWERED limits (maxRuns 3, maxDepth 1) so a limit is reached with two or three runs instead of twelve; the literal "12 of 12" / 12 -> 13 of the exit check is a renderer property
// (test/tree-approve.test.js, renderLimitStop) and is not repeated here. Every working folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../src/thin-contract.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { TREE_FILE, TREE_DIR } from '../src/tree-record.js';
import { effectiveLimits } from '../src/tree-budget.js';
import { approveHandler } from '../src/tree-approve.js';
import { chooseForm, decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier, frontierReopened } from '../src/tree-frontier.js';
import { prefixOf } from '../src/tree-stop.js';
import { admitAgainstLimits } from '../src/tree-budget.js';
import { parseTreeArgs } from '../src/tree-cli.js';
import { chooseNextChild, registerNextChild } from '../src/tree-loop.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, splitChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { ceilCents, pricedDebateFigures } from './helpers/money-figures.js';
import { assertBoundTextClean, assertRefusedWithoutAsking, dirty, dirtyMarked } from './helpers/bound-text.js';

const treeJson = r => readFileSync(join(r.t.rootDir, TREE_DIR, TREE_FILE));
const decide = (r, flags, answers, extra = {}) => {
  const io = terminal(answers, extra.tty === false ? { tty: false } : {});
  if (answers.length === 0) io.stdin.end();     // a run that has nobody to answer and wrongly ASKS ends (and fails its assertions) instead of waiting for ever: a removed guard must not look like a hang
  if (extra.onPrompt) io.stdout.on('data', d => { if (/\[y\/N\]/.test(String(d))) extra.onPrompt(); });
  const run = () => decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  return { io, run };
};
const approveAgain = async (r, key) => { const io = terminal([prefixOf(key), 'y']); const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }); return { code, shown: io.shown(), errors: io.errors() }; };
const gateFiles = r => { try { return readdirSync(join(r.t.rootDir, 'gates')).length; } catch { return 0; } };
const LOW_RUNS = { maxDepth: 2, maxRuns: 3, maxChildrenPerSplit: 4, attemptsPerChild: 1 };

test('the form: one primary form per invocation; --amount only with --top-up (and --top-up needs it); --obligation / --stop only with the stop forms; no option is the regenerate form', () => {
  assert.deepEqual(chooseForm({ 'max-runs': '13' }), { form: 'max-runs', value: '13' });
  assert.deepEqual(chooseForm({}), { form: 'regenerate', value: null });
  assert.match(chooseForm({ 'max-runs': '13', 'max-depth': '3' }).error, /one form per invocation/);
  assert.match(chooseForm({ amount: '2' }).error, /--amount belongs to --top-up only/); assert.match(chooseForm({ 'max-runs': '13', amount: '2' }).error, /--amount belongs to --top-up only/);
  assert.match(chooseForm({ 'top-up': 'R/M1' }).error, /--top-up needs --amount/); assert.equal(chooseForm({ 'top-up': 'R/M1', amount: '2' }).error, undefined);
  assert.match(chooseForm({ 'max-runs': '13', stop: 'e5' }).error, /belong to the stop forms/); assert.equal(chooseForm({ obligation: 'R@g1:C1' }).error, undefined); assert.equal(chooseForm({ milestone: 'M1', stop: 'e5' }).error, undefined);
});

test('L13 (lowered limits): a raise is raise-only, typed, bound to the text read, leaves tree.json and the root cap untouched, reopens exactly the frontier with a child refused for that limit, and the newly admitted child is registered ONLY after a new approval, never re-registering the others', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: LOW_RUNS });
  const d1 = approvePending(r);
  assert.deepEqual(d1.view.children.map(c => [c.node, c.admitted, c.notAdmittedReason]), [['R/M1', true, null], ['R/M2', true, null], ['R/M3', false, 'not admitted: run limit']]);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });                    // R/M1 ran; R/M2 is next
  const b = registerNextChild(r.t.rootDir, { work: r.t.work });                                                // R/M2 registered, not started: the frontier's own idle child is active
  assert.equal(b.node, 'R/M2');
  const treeBefore = treeJson(r); const capBefore = readTreeRecord(r.t.rootDir).tree.rootCapUsd;
  // not a raise: refused before anybody is asked, no gate written
  const gates0 = gateFiles(r); const events0 = eventsOf(r).length;
  const same = decide(r, { 'max-runs': '3' }, []); assert.equal(await same.run(), 1); assert.match(same.io.errors(), /--max-runs 3 is not a raise: the effective value is 3/); assert.equal(gateFiles(r), gates0); assert.equal(eventsOf(r).length, events0);
  const low = decide(r, { 'max-runs': '2' }, []); assert.equal(await low.run(), 1); assert.match(low.io.errors(), /--max-runs 2 is not a raise/); assert.equal(low.io.shown(), '', 'nobody was asked');
  const junk = decide(r, { 'max-runs': '4.5' }, []); assert.equal(await junk.run(), 1); assert.match(junk.io.errors(), /expected a whole number/);
  // the raise, at a terminal, typing the new value
  const raise = decide(r, { 'max-runs': '4' }, ['4', 'y']);
  assert.equal(await raise.run(), 0, raise.io.shown() + raise.io.errors());
  const shown = raise.io.shown();
  assert.match(shown, /A limit stops the tree: maxRuns is 3 of 3\./); assert.match(shown, /R\/M3: /); // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed it as #4107): OLD "$4.92" typed; NEW the priced-debate at-most figure rounded up to the cent, derived from the chain's own dry run (recording the drafted words moves it: 4.919 -> 5.02).
  const ceiling = ceilCents(pricedDebateFigures().atMostUsd).toFixed(2).replace('.', '\\.');
  assert.match(shown, new RegExp(`A rough added cost: 1 more child x \\$${ceiling} \\(priced-debate, upper estimate\\) = \\$${ceiling}`));
  assert.match(shown, /Raise maxRuns from 3 to 4\. tree\.json and the root dollar cap \(\$100\.00\) do not change\./); assert.match(shown, /To approve, type the new value: 4\n/);
  assert.match(shown, /Type the new value shown in the last line above: /);
  const raised = eventsOf(r).filter(e => e.event === 'limit_raised');
  assert.equal(raised.length, 1); assert.deepEqual([raised[0].limit, raised[0].from, raised[0].to], ['maxRuns', 3, 4]); assert.match(raised[0].shownSha256, /^[0-9a-f]{64}$/); assert.ok(raised[0].gateId);
  assert.deepEqual(treeJson(r), treeBefore, 'tree.json is byte-identical'); assert.equal(readTreeRecord(r.t.rootDir).tree.rootCapUsd, capBefore);
  assert.equal(effectiveLimits(readTreeRecord(r.t.rootDir).tree, readTreeRecord(r.t.rootDir).events).maxRuns, 4);
  // the raise reopens the frontier: approve finds it pending again; the loop registers nothing before the new approval
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), d1.frontierKey), true);
  // the refusal's KEY: the preview child carries the structured `limit`; reopening does not read the reason words (reword them in a copy of the record: it still reopens)
  const previewed = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'frontier_previewed' && e.frontierKey === d1.frontierKey).at(-1);
  assert.equal(previewed.children.find(c => c.node === 'R/M3').limit, 'maxRuns');
  const reworded = { events: readTreeRecord(r.t.rootDir).events.map(e => (e.event === 'frontier_previewed' ? { ...e, children: e.children.map(c => (c.reason ? { ...c, reason: 'refused (reworded: nothing may be read from these words)' } : c)) } : e)) };
  assert.equal(frontierReopened(reworded, d1.frontierKey), true, 'the reopen rule is keyed on `limit`, not on the words of `reason`');
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir })?.key, d1.frontierKey);
  assert.deepEqual(chooseNextChild(r.t.rootDir, { work: r.t.work }).awaitingApproval, [d1.frontierKey]);
  const registrations = eventsOf(r).filter(e => e.event === 'node_registered').length;
  // the ONE condition (activeIsOwnChild): R/M2 is the frontier's own idle child and is active - the new preview is recorded, nothing is refused
  const ap = await approveAgain(r, d1.frontierKey);
  // CHANGED FIGURE (20 Okt 2026). OLD: Proposed grant $4.91 (the at-most 4.919 floored). NEW: $4.92 (a binding at-most is granted whole, rounded up to the cent when the share holds it). WHY: the floored grant sat below the figure the screen calls its ceiling while mayStop read false (test/tree-grant-rounding.test.js).
  assert.equal(ap.code, 0, ap.shown + ap.errors); assert.match(ap.shown, /ALREADY REGISTERED \(closed\)/); assert.match(ap.shown, /ALREADY REGISTERED \(registered\)/); assert.match(ap.shown, new RegExp(`Proposed grant: \\$${ceilCents(pricedDebateFigures().atMostUsd).toFixed(2).replace('.', '\\.')}`));
  const ev = eventsOf(r);
  assert.equal(ev.filter(e => e.event === 'frontier_approved' && e.frontierKey === d1.frontierKey).length, 2, 'a new approval for the SAME frontier key');
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), d1.frontierKey), false);
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  assert.deepEqual(out.started.map(s => s.node), ['R/M2', 'R/M3'], 'R/M2 (registered, resumed on its first claim) then the newly admitted R/M3');
  assert.equal(eventsOf(r).filter(e => e.event === 'node_registered').length, registrations + 1, 'exactly one registration more: R/M1 and R/M2 are not registered again');
  assert.deepEqual(phases(r), { R: 'closed', 'R/M1': 'closed', 'R/M2': 'closed', 'R/M3': 'closed' });
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.size, 4, 'four runs: a resume of an existing run never counts as another');
});

test('the typed step and the gate: a wrong typed value, a decline and a missing terminal write nothing; a raise with no terminal asks nobody; what changed while the person read (another raise) is NOT used and nothing is recorded', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: LOW_RUNS });
  approvePending(r);
  const none0 = eventsOf(r).filter(e => e.event === 'limit_raised').length;
  const wrong = decide(r, { 'max-runs': '4' }, ['5', 'y']);
  assert.equal(await wrong.run(), 1); assert.match(wrong.io.shown(), /That is not what the text asks you to type\. Nothing was written/);
  const declined = decide(r, { 'max-runs': '4' }, ['4', 'n']); assert.equal(await declined.run(), 1);
  const notty = decide(r, { 'max-runs': '4' }, [], { tty: false }); assert.equal(await notty.run(), 2);
  assert.equal(eventsOf(r).filter(e => e.event === 'limit_raised').length, none0, 'nothing was recorded');
  // the figures change while the person reads: another raise lands before the y
  const moved = decide(r, { 'max-runs': '4' }, ['4', 'y'], { onPrompt: () => appendTreeEvent(r.t.rootDir, { event: 'limit_raised', limit: 'maxRuns', from: 3, to: 5, actor: 'person', via: 'terminal' }) });
  assert.equal(await moved.run(), 1); assert.match(moved.io.errors(), /what you were shown has changed while you were reading it/); assert.match(moved.io.errors(), /Your approval was NOT used and nothing was recorded/);
  assert.equal(eventsOf(r).filter(e => e.event === 'limit_raised').length, none0 + 1, 'only the raise that moved things; the decide recorded nothing');
});

test('the typed step is EQUALITY, not a prefix: typing 4 does not approve a raise to 40', { timeout: 200_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: LOW_RUNS });
  approvePending(r);
  const d = decide(r, { 'max-runs': '40' }, ['4', 'y']);
  assert.equal(await d.run(), 1); assert.match(d.io.shown(), /That is not what the text asks you to type/); assert.equal(eventsOf(r).filter(e => e.event === 'limit_raised').length, 0);
});

test('admitAgainstLimits names the KEY of a refusal (limit) apart from its words (reason)', () => {
  const lim = { maxDepth: 2, maxRuns: 3, maxChildrenPerSplit: 1 };
  const out = admitAgainstLimits({ limits: lim, registeredRuns: 2, children: [{ id: 'a', depth: 1 }, { id: 'b', depth: 1 }, { id: 'c', depth: 3 }] });
  assert.deepEqual(out.map(o => [o.id, o.admitted, o.limit]), [['a', true, null], ['b', false, 'maxChildrenPerSplit'], ['c', false, 'maxDepth']]);
  assert.deepEqual(admitAgainstLimits({ limits: { ...lim, maxChildrenPerSplit: 5 }, registeredRuns: 3, children: [{ id: 'a', depth: 1 }] }).map(o => o.limit), ['maxRuns']);
});

test('a raise reopens only a frontier that has a child refused for THAT limit: raising --max-children does not reopen a frontier refused for the run limit; the gate rules also hold for the other two limits (raise-only, whole number)', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: LOW_RUNS });
  const d1 = approvePending(r);
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), d1.frontierKey), false);
  // R17 (edited): R/M3 was refused for the RUN limit, so no child waits for the fan-out limit and a raise of --max-children has no stop to be made at: it is refused, records nothing, and reopens nothing
  const kids = decide(r, { 'max-children': '5' }, []);
  await assertRefusedWithoutAsking(kids, /no child is waiting for this limit/);
  assert.deepEqual(eventsOf(r).filter(e => e.event === 'limit_raised'), []);
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), d1.frontierKey), false, 'R/M3 was refused for the run limit, not the fan-out');
  assert.equal(findPendingFrontier({ rootDir: r.t.rootDir }), null);
  const depth = decide(r, { 'max-depth': '2' }, []); assert.equal(await depth.run(), 1); assert.match(depth.io.errors(), /--max-depth 2 is not a raise: the effective value is 2/);
  const attempts = parseTreeArgs(['decide', ROOT_ID, '--attempts-per-child', '2']);
  assert.match(attempts.error, /--attempts-per-child: not an option of `council tree decide`/, 'attemptsPerChild has no raise: the parser refuses the option');
});

test('L14 (depth, lowered to 1): the children of a depth-1 splitter are "not admitted: depth limit" until `decide --max-depth 2` and a new approval; then they are registered and run', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...splitChildren(), limits: { maxDepth: 1, maxRuns: 12, maxChildrenPerSplit: 4, attemptsPerChild: 1 } });
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });                                            // R/M1 (A) and the independent R/M3 run; A's split is verified
  const dA = approvePending(r);                                                                                // A's frontier: its three children are depth 2
  assert.deepEqual(dA.view.children.map(c => [c.node, c.admitted, c.notAdmittedReason]), [['R/M1/M1', false, 'not admitted: depth limit'], ['R/M1/M2', false, 'not admitted: depth limit'], ['R/M1/M3', false, 'not admitted: depth limit']]);
  assert.equal(registerNextChild(r.t.rootDir, { work: r.t.work }).kind, 'none', 'nothing of A\'s children is registered');
  const raise = decide(r, { 'max-depth': '2' }, ['2', 'y']);
  assert.equal(await raise.run(), 0, raise.io.shown() + raise.io.errors()); assert.match(raise.io.shown(), /A limit stops the tree: maxDepth is 1 of 1\./); assert.match(raise.io.shown(), /R\/M1\/M1: /);
  assert.equal(frontierReopened(readTreeRecord(r.t.rootDir), dA.frontierKey), true);
  approvePending(r);                                                                                           // the new approval admits them
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.deepEqual(out.started.map(s => s.node), ['R/M1/M1', 'R/M1/M2', 'R/M1/M3', 'R/M2']);
  assert.equal(existsSync(join(r.t.rootDir, TREE_DIR, TREE_FILE)), true);
});

test('the sources: tree-decide.js asks through askTreeGate (never answerAtTerminal), reads no environment variable and no process argument, and the limit raise hashes the text it prints through terminalSafe', () => {
  const code = readFileSync(join(import.meta.dirname, '..', 'src', 'tree-decide.js'), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.equal(/answerAtTerminal/.test(code), false); assert.equal(/process\.env|process\.argv|\bargv\b/.test(code), false);
  // a TRIPWIRE, not a pin: it notices a fifth form or a lost call, but one surviving copy of the call would hide a dropped one at another site. The pins are the behaviour tests (K10 in this file and in -topup, -accounting, -close).
  // CHANGED ACCEPTED COUNT (20 Okt 2026). OLD: 8 gate texts. NEW: 9, the new site is the allowance for a child that never started (`allow <types> for <key> before it started`, PII stop unit commit 3 = T-b, 3f26adbb194a, A). WHY: a new person-typed gate text, hashed through terminalSafe like the others; its behaviour tests are in test/tree-bundle-input.test.js, which has NO control-character or bidi case for this gate text (a named gap, not a claim).
  assert.equal((code.match(/text: terminalSafeMarked\(text\), expect:/g) ?? []).length, 9, 'all NINE gate texts (raise, top-up, accounting, close, close of a child that never started, the allowance for a child that never started (T-b, 20 Okt), abandon, a person-opened stop on the root, the cap amendment: budget commit 2 EDITED the count, disclosed; old EIGHT; old SEVEN, S8-8; old SIX, ROADMAP 57; old FIVE) are hashed through terminalSafe(text); each also has its behaviour test');   // c3b (EDITED, disclosed; old: 4, without the close of a child that never started - the tripwire did its job: its behaviour test is test/tree-closed-unstarted.test.js)
  assert.equal(sha256Of('x').length, 64);
});

test('K1 / K2 fail-fast: a raise that is not above the effective value, and a value that is not a plain whole number, are refused BEFORE anybody is asked: nothing is shown, no gate is requested, nothing is written', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: LOW_RUNS });
  approvePending(r);
  const treeBefore = treeJson(r).toString(); const gates0 = gateFiles(r); const events0 = eventsOf(r).length;
  // K1: a whole number, but not above the effective value (3): equal, and lower
  for (const raw of ['3', '2', '1']) await assertRefusedWithoutAsking(decide(r, { 'max-runs': raw }, []), new RegExp(`--max-runs ${raw} is not a raise: the effective value is 3`));
  // K2: above the effective value, but not a plain whole number (fractional, exponent, leading zero, sign, too many digits, empty)
  for (const raw of ['100.5', '1e2', '0100', '+9', '1234567', '']) await assertRefusedWithoutAsking(decide(r, { 'max-runs': raw }, []), /expected a whole number/);
  assert.equal(gateFiles(r), gates0, 'no gate was requested'); assert.equal(eventsOf(r).length, events0, 'nothing was recorded'); assert.equal(treeJson(r).toString(), treeBefore, 'tree.json is untouched');
});

test('R17 (Opus 4-2, ruled by C&C): a raise is accepted only AT a limit stop - on a fresh tree no child waits for any limit, so `decide --max-runs 40` is refused before anybody is asked with a sentence naming the rule, and records nothing (PLAN 8.5, D17: the person raises after seeing the open work)', { timeout: 200_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const n = eventsOf(r).length;
  for (const flags of [{ 'max-runs': '40' }, { 'max-depth': '3' }, { 'max-children': '9' }]) {
    const d = decide(r, flags, []);
    await assertRefusedWithoutAsking(d, /no child is waiting for this limit[^]*PLAN 8\.5[^]*D17[^]*Nothing was asked and nothing was written/);
  }
  assert.equal(eventsOf(r).length, n, 'nothing was recorded'); assert.equal(gateFiles(r), 0, 'and no gate was requested');
  assert.equal(effectiveLimits(readTreeRecord(r.t.rootDir).tree, readTreeRecord(r.t.rootDir).events).maxRuns, 12, 'the limit is as it was');
});

test('K10: the limit raise is shown and hashed through terminalSafe: a control character and a bidi mark in a child\'s scope (model-written text in the rendered stop) are gone from the gate text, the screen and the hash, which agree', async () => {
  const word = dirtyMarked('Define the export format now', 10);
  const b = block3(); b.children[2].scope = `${word.raw}.`;
  const r = await trackedRealRoot({ ...pricedChildren(), limits: LOW_RUNS, plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const d1 = approvePending(r);
  assert.equal(d1.view.children.find(c => c.node === 'R/M3').admitted, false, 'R/M3 is the child the run limit refused: its scope is in the raise stop');
  const d = decide(r, { 'max-runs': '4' }, ['4', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const raised = eventsOf(r).find(e => e.event === 'limit_raised');
  assertBoundTextClean({ rootDir: r.t.rootDir, shownSha256: raised.shownSha256, shown: d.io.shown(), word: `${word.clean}.` });
});
