// 0.8.3 M6 unit 2c: the PERSON'S typed form `council tree decide <root> --accept-plan --stop <id>` (gate page Restore_Gap_Gate_Page.md sections 13, 13.9; C&C PASS ON CONDITIONS 14 Oct 2026). Real all-mock trees, a real sitting opens each stop, the form is driven through the real `decideHandler`
// with the scripted terminal (test/helpers/terminal.js), the way test/tree-person-stop.test.js drives `--open-root-stop`. $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { clearStop, requestStop, runTree } from '../src/tree-run.js';
import { decideHandler, chooseForm } from '../src/tree-decide.js';
import { buildAcceptPlan, lineDiff, ACCEPT_SHOW_MAX_BYTES } from '../src/tree-decide-accept.js';
import { bundleDirName } from '../src/tree-continuation.js';
import { track } from './helpers/temp-trees.js';
import { deadKeys } from '../src/tree-transitions.js';
import { TREE_VERBS } from '../src/tree-cli.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

const ADDED = '\nOne clarifying sentence the person reads: the store keeps every record for a year.\n';
const KEY_URL = ['postgres', '://user:', 'pass', '@', 'db.internal', '/db'].join('');

async function finished() {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  const start = draftStarter(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
async function finishedDeep() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  return { r, start };
}
/** R/M1 finished with REGISTERED children, none started (the sitting that registered the first one stopped right there). */
async function notStartedTree() {
  const r = await trackedRealRoot(splitChildren());
  approvePending(r);
  const blockA = block3(); for (const m of blockA.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`;
  blockA.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  writeFileSync(join(r.t.work, 'plan-a.md'), planWith(blockA, { preface: 'REVISED MOCK DELIVERABLE\n\n' }));
  const start = draftStarter(r, { 'R/M1': 'plan-a.md' });
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, hooks: { afterRegister: next => { if (next.kind === 'registered' && next.node.startsWith('R/M1/')) requestStop(r.t.rootDir); } } });
  return { r, start };
}
const nodeOf = (r, node) => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === node);
const dirOf = (r, node) => join(r.t.runsDir, nodeOf(r, node).runId);
const planFile = (r, node) => join(dirOf(r, node), 'deliverable.md');
const sit = (r, start) => runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
const stopsOf = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const accepted = r => eventsOf(r).filter(e => e.event === 'plan_accepted');
async function changed(r, start, node, text = ADDED) {
  const original = readFileSync(planFile(r, node), 'utf8');
  writeFileSync(planFile(r, node), original + text);
  await sit(r, start);
  const stop = stopsOf(r, node).at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), `a stop is open for ${node}`);
  return { stop, original };
}
const gateFiles = r => { const d = join(treeDirOf(r.t.rootDir), 'gate-texts'); return existsSync(d) ? readdirSync(d).length : 0; };
const decide = async (r, flags, answers, { tty = true } = {}) => {
  const io = terminal(answers, tty ? {} : { tty: false }); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, shown: io.shown().replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''), errors: io.errors() };
};
const refusalOf = (r, stopId) => { const b = buildAcceptPlan({ rootDir: r.t.rootDir, rootId: ROOT_ID, stopArg: stopId }); assert.equal(typeof b.refusal, 'string', `the form refuses (it built a text instead: ${String(b.text).slice(0, 80)})`); return b.refusal; };
const build = (r, stopId) => buildAcceptPlan({ rootDir: r.t.rootDir, rootId: ROOT_ID, stopArg: stopId });
const copyFile = (r, node) => join(dirOf(r, node), 'plan-at-close.md');

test('[new 2c behaviour] REAL FLOW through decideHandler: the person reads the diff against the signed text, types the stop id, ONE plan_accepted(person, terminal) with the gate is recorded, the stop is answered, and TREE_HANDOFF.md already holds the accepted-plan sentence', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const out = await decide(r, { 'accept-plan': true, stop: stop.id }, [stop.id, 'y']);
  assert.equal(out.code, 0, out.errors);
  assert.match(out.shown, /Accept a changed plan for R\/M2@g1\?/);
  assert.match(out.shown, /Accepting means this file stands as the plan; the panel did not sign it\./);
  assert.match(out.shown, /Compared with the text the panel signed:/);
  assert.match(out.shown, /^ {6}\+ One clarifying sentence the person reads/m, 'the added line is shown as added, indented six spaces');
  assert.match(out.shown, /Recorded: accept the changed plan of R\/M2@g1/);
  const [e] = accepted(r);
  assert.deepEqual([accepted(r).length, e.actor, e.via, typeof e.gateId, /^[0-9a-f]{64}$/.test(e.shownSha256), e.stopId], [1, 'person', 'terminal', 'string', true, stop.id]);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), false, 'the stop is answered');
  const handoff = readFileSync(join(treeDirOf(r.t.rootDir), 'TREE_HANDOFF.md'), 'utf8');
  assert.match(handoff, /`R\/M2`: its plan was accepted by a person \(terminal\), not signed by the panel/, 'the handler wrote the view files right after the record (carried item 1)');
});

test('[new 2c behaviour] PREFLIGHT: --stop is required, and a stop that is not open is named with the open ones; each asks nobody, writes nothing and leaves no gate file', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const before = JSON.stringify(eventsOf(r));
  const a = await decide(r, { 'accept-plan': true }, []);
  assert.equal(a.code, 1); assert.match(a.errors, /--accept-plan needs --stop <id>: the stop it answers \(open: e\d+ \(blocked, R\/M2@g1\)\)/);
  const b = await decide(r, { 'accept-plan': true, stop: 'e9999' }, []);
  assert.equal(b.code, 1); assert.match(b.errors, /--stop e9999: that is not an open stop \(open: /);
  assert.equal(JSON.stringify(eventsOf(r)), before); assert.equal(gateFiles(r), 0);
  assert.ok(stop.id);
});

test('[regression pin of pre-2c behaviour: the handler\'s own terminal refusal, applied to the new form] NOT A TERMINAL: the form refuses when stdin or stdout is not a terminal (exit 2), writes nothing and leaves no gate file', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const before = JSON.stringify(eventsOf(r));
  const d = await decide(r, { 'accept-plan': true, stop: stop.id }, [], { tty: false });
  assert.equal(d.code, 2); assert.match(d.errors, /gate answer needs a person at a terminal: stdin and stdout must both be a terminal\. Nothing was written\./);
  assert.equal(JSON.stringify(eventsOf(r)), before); assert.equal(gateFiles(r), 0);
});

test('[regression pin of pre-2c behaviour: the gate\'s typed-id check, applied to the new form] A WRONG typed id approves nothing: no plan_accepted, the stop stays open', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const d = await decide(r, { 'accept-plan': true, stop: stop.id }, ['e0', 'y']);
  assert.notEqual(d.code, 0);
  assert.equal(accepted(r).length, 0); assert.ok(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id));
});

test('[new 2c behaviour] THE TEXT MOVES while the person reads: building the form again after the file changed gives a different text (the handler compares the two and does not use the approval)', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const first = build(r, stop.id);
  writeFileSync(planFile(r, 'R/M2'), `${readFileSync(planFile(r, 'R/M2'), 'utf8')}\nA second sentence, added while the first was read.\n`);
  const again = build(r, stop.id);
  assert.ok(first.text && again.text && first.text !== again.text);
  assert.match(again.text, /\+ A second sentence, added while the first was read\./);
});

test('[new 2c behaviour] BASELINE: no kept copy of the signed text -> the WHOLE new plan is shown, no diff and no "Compared with"; a copy that does not hash is treated the same', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  renameSync(copyFile(r, 'R/M2'), `${copyFile(r, 'R/M2')}.gone`);
  const a = build(r, stop.id);
  assert.match(a.text, /The text the panel signed is not kept for this node, so no change can be shown\. The whole plan as the file reads now \(\d+ bytes, sha256 [0-9a-f]{12}\) follows:/);
  assert.doesNotMatch(a.text, /Compared with the text the panel signed/);
  assert.match(a.text, /^ {6}One clarifying sentence the person reads/m);
  writeFileSync(copyFile(r, 'R/M2'), 'not the signed text\n');
  const b = build(r, stop.id);
  assert.match(b.text, /is not kept for this node/); assert.doesNotMatch(b.text, /Compared with/);
});

test('[new 2c behaviour] A SECOND ACCEPT compares with the text the panel SIGNED and says the plan was already accepted once; it never claims the kept copy is gone', { timeout: 600_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  assert.equal((await decide(r, { 'accept-plan': true, stop: stop.id }, [stop.id, 'y'])).code, 0);
  const second = await changed(r, start, 'R/M2', '\nAnother sentence, after the first acceptance.\n');
  const t = build(r, second.stop.id).text;
  assert.match(t, /Compared with the text the panel signed \(this plan was already accepted once, by a person; that text is not kept, so only the change from the signed text can be shown\):/);
  assert.match(t, /^ {6}\+ One clarifying sentence the person reads/m, 'the diff is from the SIGNED text, so the first acceptance\'s sentence is still shown as added');
  assert.doesNotMatch(t, /is not kept for this node/);
});

test('[new 2c behaviour] A REVERT (the file is the text the panel signed again, on a node that holds an accepted plan): no diff, "puts back the text the panel signed", and the record writes a revert', { timeout: 600_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  assert.equal((await decide(r, { 'accept-plan': true, stop: stop.id }, [stop.id, 'y'])).code, 0);
  const signed = readFileSync(copyFile(r, 'R/M2'), 'utf8');
  writeFileSync(planFile(r, 'R/M2'), signed);
  await sit(r, start);
  const stops = stopsOf(r, 'R/M2');
  const open = stateOf(readTreeRecord(r.t.rootDir)).openStops.filter(id => stops.some(s => s.id === id));
  assert.equal(open.length, 1, 'the accepted node stops again when its file no longer matches the accepted plan');
  const f = build(r, open[0]);
  assert.match(f.text, /^Put back the signed plan for R\/M2@g1\?/);
  assert.match(f.text, /This puts back the text the panel signed\. The earlier acceptance is undone/);
  assert.doesNotMatch(f.text, /Compared with/);
  for (const untrue of [/Accept a changed plan/, /is not the text its panel signed/, /Accepting means this file stands/, /then say this plan was accepted by a person/]) assert.doesNotMatch(f.text, untrue, 'a revert never says the plan is a changed one');
  assert.equal((await decide(r, { 'accept-plan': true, stop: open[0] }, [open[0], 'y'])).code, 0);
  assert.deepEqual(accepted(r).map(e => e.revert === true), [false, true]);
});

test('[new 2c behaviour] THE CAP: a plan above 64 KB with no signed copy, and a diff above 64 KB with one, are each REFUSED (nothing is accepted that was not shown), naming the two answers; the refusal asks nobody', { timeout: 600_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2', `\n${'x'.repeat(ACCEPT_SHOW_MAX_BYTES + 10)}\n`);
  assert.match(refusalOf(r, stop.id), /above the 64 KB this form can show, and nothing is accepted that was not shown\. A plan changed that much cannot be accepted here: the answers are a new plan \(council tree decide .* --stop e\d+\) or abandon \(council tree decide .* --abandon\)/);
  renameSync(copyFile(r, 'R/M2'), `${copyFile(r, 'R/M2')}.gone`);
  assert.match(refusalOf(r, stop.id), /the text the panel signed is not kept to compare it with\. Nothing is accepted that was not shown/);
  const before = JSON.stringify(eventsOf(r));
  const d = await decide(r, { 'accept-plan': true, stop: stop.id }, []);
  assert.equal(d.code, 1); assert.equal(JSON.stringify(eventsOf(r)), before); assert.equal(gateFiles(r), 0);
});

test('[new 2c behaviour] A KEY-SHAPED string in the changed plan is refused at preflight for the person too: the shape named, never the value, and nothing is asked', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2', `${ADDED}\nThe settings come from ${KEY_URL}.\n`);
  const b = { refusal: refusalOf(r, stop.id) };
  // CHANGED ACCEPTED (19 Okt 2026, no-mode trees are asked as hard-stop): OLD the sentence named the key-shaped string only. NEW the fixture's user:pass@host line is also read as personal data (email, secret), so the sentence may add ' and N personal-data findings (...)' and say 'them'.
  assert.match(b.refusal, /the changed plan holds 1 key-shaped string \(.+\)( and \d+ personal-data findings? \(.+\))?: the tree holds no plan that its own key and personal-data checks refuse\. Edit the file to remove (it|them) and ask again/);
  assert.ok(!b.refusal.includes('db.internal') && !b.refusal.includes(KEY_URL), 'the shape is named, never the value');
  const d = await decide(r, { 'accept-plan': true, stop: stop.id }, []);
  assert.equal(d.code, 1); assert.equal(gateFiles(r), 0);
});

test('[new 2c behaviour: the form relays the 2b table\'s sentences] A CHANGED SPLIT and a CHANGED THIN CONTRACT are refused at preflight for the person, each sentence names the two answers (a new plan, abandon)', { timeout: 600_000 }, async () => {
  const { r, start } = await finished();
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const { stop } = await changed(r, start, 'R/M2', `\n${planWith(b)}\n`);
  const split = refusalOf(r, stop.id);
  assert.match(split, /is not the split that was checked/); assert.match(split, /a new plan \(regenerate\) or abandon/);
  console.log(`# quoted for the 2c report: ${split}`);
  const { r: r2, start: s2 } = await finished();
  const rp = join(dirOf(r2, 'R/M2'), 'report.json');
  const report = JSON.parse(readFileSync(rp, 'utf8')); report.thin_contract.sha256 = 'f'.repeat(64); writeFileSync(rp, JSON.stringify(report));
  const c = await changed(r2, s2, 'R/M2');
  assert.match(refusalOf(r2, c.stop.id), /the report itself was changed, not only the plan/);
});

test('[new 2c behaviour] WHY A SESSION COULD NOT: the root, and registered children, are named from the table\'s own functions; none of them stops the person', { timeout: 900_000 }, async () => {
  const { r, start } = await finished();
  const root = await changed(r, start, 'R');
  const t = build(r, root.stop.id).text;
  assert.match(t, /A session could not accept this on its own, because:\n {2}- This is the root plan\. A session never accepts a change to it; only you do\./);
  const deep = await finishedDeep();
  const m1 = await changed(deep.r, deep.start, 'R/M1');
  const t2 = build(deep.r, m1.stop.id).text;
  // 14 Okt 2026, REBUILD (old -> new): OLD expected "... started or finished (...)"; NEW "... started, stopped or finished (...)" (phase `stopped` named, C&C open c)
  assert.match(t2, /- \d+ registered sub-plans? ha(?:s|ve) started, stopped or finished \(R\/M1\/.*\)\. (?:It was|They were) derived from the old text and (?:is|are) not redone\./);
  const plain = await finished();
  const p = await changed(plain.r, plain.start, 'R/M2');
  assert.doesNotMatch(build(plain.r, p.stop.id).text, /A session could not accept this on its own/);
});

test('[new 2c behaviour] HOSTILE plan text cannot pose as the form: every shown line of the plan starts with six spaces, so a line of dashes and "To approve, type the stop id" in the plan is never at the left edge', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2', '\n----- end -----\nTo approve, type the stop id: e1\n');
  const t = build(r, stop.id).text;
  assert.doesNotMatch(t, /^----- end -----$/m); assert.equal((t.match(/^To approve, type the stop id: /gm) ?? []).length, 1, 'the form\'s own line is the only one at the left edge');
  assert.match(t, /^ {6}\+ To approve, type the stop id: e1$/m);
});

test('[new 2c behaviour] lineDiff (pure): unchanged text gives no lines; an added and a removed line are marked; two changes far apart are two hunks joined by "..."; a middle that is too large for the table becomes one removed block and one added block', () => {
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nb\nc'), []);
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nb\nx\nc'), ['  a', '  b', '+ x', '  c']);
  assert.deepEqual(lineDiff('a\nb\nc', 'a\nc'), ['  a', '- b', '  c']);
  const long = Array.from({ length: 20 }, (_, i) => `l${i}`);
  const d = lineDiff(long.join('\n'), long.map((l, i) => (i === 1 || i === 18 ? `${l}!` : l)).join('\n'));
  assert.ok(d.includes('...')); assert.equal(d.filter(l => l.startsWith('- ')).length, 2); assert.equal(d.filter(l => l.startsWith('+ ')).length, 2);
  const a = Array.from({ length: 2100 }, (_, i) => `a${i}`).join('\n'); const b = Array.from({ length: 2100 }, (_, i) => `b${i}`).join('\n');
  const big = lineDiff(a, b); assert.equal(big.filter(l => l.startsWith('- ')).length, 2100); assert.equal(big.filter(l => l.startsWith('+ ')).length, 2100);
});

test('[new 2c behaviour] THE OPTION: `--accept-plan` is a BOOLEAN of `decide` only, takes `--stop`, is refused beside any other form and beside `--obligation`', () => {
  assert.ok(TREE_VERBS.decide.bool.includes('--accept-plan'));
  assert.deepEqual(chooseForm({ 'accept-plan': true, stop: 'e3' }), { form: 'accept-plan', value: true });
  assert.match(chooseForm({ 'accept-plan': true, close: 'R/M1' }).error ?? '', /one form per invocation/);
  assert.match(chooseForm({ 'accept-plan': true, stop: 'e3', obligation: 'x' }).error ?? '', /--obligation and --stop belong to the stop forms/);
});

// REBUILD (Muad, 14 Oct 2026: "Rebuild them (Recommended)"; gate page 14; src/tree-rebuild.js). This test REVERSES the 2c version of QB3 ORDER ("STARTS on the OLD quoted text"): a child registered but NOT started when its parent's plan is accepted has its input
// rebuilt from the accepted text before it starts, and the form says so instead of warning.
test('[REBUILD, reverses 2c QB3 ORDER] a child registered but NOT started when its parent\'s plan is accepted is REBUILT from the accepted text before it starts; the form says so', { timeout: 900_000 }, async () => {
  const { r, start } = await notStartedTree();
  const kids = () => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].filter(n => n.node.startsWith('R/M1/'));
  assert.ok(kids().length >= 1 && kids().every(k => k.phase === 'registered'), 'the children are registered and not started');
  const first = kids()[0];
  const inputs = join(r.t.rootDir, 'tree', 'inputs');
  const ctx = () => readFileSync(join(inputs, bundleDirName(first.node, first.generation), 'context.md'), 'utf8');
  assert.match(ctx(), /A plan\./, 'the child\'s context.md quotes the parent\'s Overview section');
  const NEW = 'A plan, now with a different overview sentence.';
  writeFileSync(planFile(r, 'R/M1'), readFileSync(planFile(r, 'R/M1'), 'utf8').replace('A plan.', NEW));
  await sit(r, start);
  const stop = stopsOf(r, 'R/M1').at(-1);
  assert.ok(stop);
  const form = build(r, stop.id);
  assert.match(form.text, /\d+ registered sub-plans? ha(?:s|ve) not started yet \(R\/M1\/[^)]*\)\. (?:Its input is|Their inputs are) rebuilt from the accepted text before (?:it starts|they start), unless the accepted plan no longer holds a section (?:it quotes|they quote): then (?:it does|that one does) not start, and the next `council tree resume` says why and what you can do\./);   // MOVED 18 Okt 2026 with E177b (pass-2 final wording): OLD tail "; then it is held and you are asked."
  assert.doesNotMatch(form.text, /will start on it/, 'the old warning is gone');
  assert.equal((await decide(r, { 'accept-plan': true, stop: stop.id }, [stop.id, 'y'])).code, 0);
  clearStop(r.t.rootDir);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start });
  assert.equal(kids().find(k => k.node === first.node).phase, 'closed', 'the first child started and closed after the accept (the identity check passed on the rebuilt files)');
  const rebuilt = eventsOf(r).filter(e => e.event === 'node_bundle_rebuilt');
  assert.ok(rebuilt.length >= 1, 'one rebuild is on the record');
  // 14 Okt 2026, REBUILD (old -> new): OLD `because` = [{ node, generation, eventId }]; NEW it also carries acceptedBodySha256 (the text the bundle was rebuilt from, C&C 14.11 item 1)
  assert.deepEqual([rebuilt[0].node, rebuilt[0].because], [first.node, [{ node: 'R/M1', generation: 1, eventId: accepted(r).at(-1).id, acceptedBodySha256: accepted(r).at(-1).acceptedBodySha256 }]]);
  assert.notEqual(rebuilt[0].previousBundleSha256, rebuilt[0].bundleSha256);
  assert.ok(ctx().includes(NEW), 'the rebuilt context.md quotes the accepted text');
  assert.ok(readdirSync(inputs).some(d => d.startsWith(`${bundleDirName(first.node, first.generation)}.replaced-`)), 'the old input was moved aside, never deleted');
  // 14 Okt 2026 (kept from the 2c version of this test, which asserted it): a child registered AFTER the accept derives from the accepted body and quotes the NEW text. Still true under rebuild; the live input folders only (the `.replaced-*` folders hold the old text on purpose).
  const later = kids().filter(k => k.node !== first.node);
  assert.ok(later.length >= 1, 'a sibling was registered after the accept');
  for (const k of later) assert.ok(readFileSync(join(inputs, bundleDirName(k.node, k.generation), 'context.md'), 'utf8').includes(NEW), `${k.node} (registered after the accept) quotes the new text`);
});

// The way out the QB3 sentence names: a NEW PLAN for the node (the regenerate answer to the same stop) leaves the children that were registered from the old plan DEAD (their parent's plan was replaced), so they never start. The sentence says it; this test is what it rests on.
test('[new 2c behaviour] QB3 WAY OUT: answering the same stop with a NEW PLAN (regenerate) makes the registered-not-started children dead: they never start', { timeout: 900_000 }, async () => {
  const { r, start } = await notStartedTree();
  const kids = () => [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].filter(n => n.node.startsWith('R/M1/'));
  assert.ok(kids().length >= 1 && kids().every(k => k.phase === 'registered'));
  writeFileSync(planFile(r, 'R/M1'), readFileSync(planFile(r, 'R/M1'), 'utf8').replace('A plan.', 'A plan, changed.'));
  await sit(r, start);
  const stop = stopsOf(r, 'R/M1').at(-1);
  const out = await decide(r, { stop: stop.id }, ['Rewrite the overview.\n.', stop.id, 'y']);
  assert.equal(out.code, 0, out.errors);
  clearStop(r.t.rootDir);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const dead = deadKeys(stateOf(readTreeRecord(r.t.rootDir)));
  const old = kids().filter(k => k.generation === 1 && k.phase === 'registered');
  assert.ok(old.length >= 1 && old.every(k => dead.has(`${k.node}@g${k.generation}`)), `the old children are dead: ${[...dead].join(', ')}`);
});

test('[new 2c behaviour, C&C FIX] THE FILE MOVES BETWEEN THE COMPARE AND THE LOCK: the person\'s apply carries the hashes of the text shown and the writer refuses under the lock when the file differs; nothing is recorded and the stop stays open; the same form built again on the new text records it', { timeout: 400_000 }, async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const shown = build(r, stop.id);
  assert.equal(typeof shown.apply, 'function', 'the form built');
  writeFileSync(planFile(r, 'R/M2'), `${readFileSync(planFile(r, 'R/M2'), 'utf8')}\nA line the person never saw.\n`);
  assert.throws(() => shown.apply({ gateId: 'g-test', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' }), /the plan changed after it was shown to you, so no acceptance was recorded \(your typed approval is used up\): ask again to see the text as it is now/);   // EDITED in the M7 apply (group 3b, fix-up; old: /...so nothing was recorded/; why: the refusal says what was and was not recorded and that the typed approval is used up)
  assert.equal(accepted(r).length, 0, 'nothing recorded');
  assert.ok(stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'the stop is still open');
  const again = build(r, stop.id);
  assert.equal(typeof again.apply, 'function');
  const out = again.apply({ gateId: 'g-test', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' });
  assert.equal(accepted(r).length, 1, 'the form built on the new text records it');
  assert.equal(out.acceptedBodySha256, accepted(r)[0].acceptedBodySha256);
});

test('item 7: the accept-plan gate text MARKS a hidden character of the changed plan in place as [U+200B], on the text the gate hashes', async () => {
  const { r, start } = await finished();
  const { stop } = await changed(r, start, 'R/M2');
  const zw = String.fromCodePoint(0x200B);
  writeFileSync(planFile(r, 'R/M2'), `${readFileSync(planFile(r, 'R/M2'), 'utf8')}\nA changed line with a hidden${zw} character.\n`);
  const shown = build(r, stop.id);
  assert.equal(typeof shown.text, 'string', JSON.stringify(shown.refusal));
  assert.equal(shown.text.includes(zw), false, 'a hidden character is MARKED in place, never left raw in the hashed text');
  assert.ok(shown.text.includes('hidden[U+200B] character'), 'the token sits where the character was');
});
