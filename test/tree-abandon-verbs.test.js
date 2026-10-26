// 0.8.3 M6 ROADMAP 57, commit 2 (the FORM and the REFUSALS; contract Review/Build_0.8.3/m6-closing/ROADMAP57_Tree_Abandon_Contract.md, C&C's departures of 13 Oct 2026): `council tree decide <root> --abandon` shows the gate text, takes the typed tree id and
// records `tree_abandoned`; afterwards every verb of the tree answers with the one abandoned sentence and writes nothing. DA-3 (the form), DA-4 (the refusals), DA-9 (the close sentence), the option plumbing and the "..": a member's detail
// that ends with a full stop. Real trees (the same helpers as test/tree-status.test.js); the gates are typed at a scripted terminal. All $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import { abandonTree } from '../src/tree-abandon.js';
import { approveHandler } from '../src/tree-approve.js';
import { checkHandler } from '../src/tree-check.js';
import { decideHandler, chooseForm } from '../src/tree-decide.js';
import { HANDOFF_FILE } from '../src/tree-handoff.js';
import { registerNextChild } from '../src/tree-loop.js';
import { TREE_REPORT_FILE } from '../src/tree-report.js';
import { resumeHandler, sittingLines } from '../src/tree-resume.js';
import { apiStarter, runTree, stopHandler } from '../src/tree-run.js';
import { stopMarkerPath } from '../src/tree-stop-marker.js';
import { TREE_VERBS, parseTreeArgs } from '../src/tree-cli.js';
import { EVENTS_FILE, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { GATE_FIELDS, ROOT_ID, root } from './helpers/tree-fixture.js';
import { track, trackedRealRoot } from './helpers/temp-trees.js';
import { configSha256 } from '../src/tree-continuation.js';
import { startTree } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { makeRootTaskPin } from '../src/tree-task-pin.js';
import { installSplitRoot } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';
import { ceilCents, pricedDebateFigures } from './helpers/money-figures.js';
import { pricedChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';

const sink = () => { let t = ''; return { w: new Writable({ write(c, e, cb) { t += c; cb(); } }), get: () => t }; };
async function realTree() {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered');
  return { r, rootDir: r.t.rootDir, work: r.t.work, child: reg };
}
const eventsText = rootDir => readFileSync(join(treeDirOf(rootDir), EVENTS_FILE), 'utf8');
const nEvents = rootDir => readTreeRecord(rootDir).events.length;
const decide = async (t, flags, answers, extra = {}) => {
  const io = terminal(answers); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), ...extra }).finally(() => clearTimeout(timer));
  return { code, shown: io.shown(), errors: io.errors() };
};
const SENTENCE = /This tree was abandoned by a person \(event e\d+, [^)]+\)\. It is final: nothing more is registered, started, approved, decided or checked in it, and it cannot be reopened\./;

test('DA-3 the form: `decide --abandon` shows the gate text, takes the TYPED tree id, records ONE tree_abandoned with the gate, the record ENDS with it (no readiness line after), and both view files are written', async () => {
  const t = await realTree();
  const n0 = nEvents(t.rootDir);
  const { code, shown, errors } = await decide(t, { abandon: true }, [ROOT_ID, 'y']);
  assert.equal(code, 0, shown + errors);
  assert.match(shown, new RegExp(`Abandon tree ${ROOT_ID}\\?   \\(this cannot be undone\\)`));
  assert.match(shown, /Root task: .*x\.md   Root cap \$100\.00/);
  assert.match(shown, /What exists: R@g1 closed passed; R\/M1@g1 registered, never started\./);
  assert.match(shown, /Nothing is running: no member holds a claim and no sitting of this tree is running\./);
  // CHANGED ACCEPTED TEST (money-test conversion, lane C (drafted by lane B, reviewed by C), 24 Okt 2026; C&C ruling (c); the full suite on fad02049 listed it as #3621). OLD: "$4.92" typed (the priced-debate at-most 4.919 rounded up to the cent). NEW: that figure derived from the chain's own dry run (the cap is $100, far above it, so the grant is the at-most). WHY: recording the drafted words moves the estimate (4.919 -> 5.02).
  assert.match(shown, new RegExp(`Money: spent \\$0\\.04 \\(it stays counted\\)\\. Held for nodes that will never spend it: \\$${ceilCents(pricedDebateFigures().atMostUsd).toFixed(2).replace('.', '\\.')}, released`));
  assert.match(shown, /Abandoning ends this tree for good\. Nothing more is registered, started, resumed, approved, decided, checked or topped up in it, and it cannot be reopened\. Its run folders stay as they are; the record gains this event, and TREE_HANDOFF\.md and tree\/report\.json are rewritten to say so\./);
  assert.match(shown, /To try again, start a new tree: `council tree start --task <task> --chain <root chain> --child-chain <name> --max-usd <usd>`/);
  assert.match(shown, new RegExp(`To approve, type the tree id: ${ROOT_ID}`));
  assert.match(shown, new RegExp(`Recorded: abandon tree ${ROOT_ID}\\. The tree is final; \`council tree status ${ROOT_ID}\` shows its history\\.`));
  const events = readTreeRecord(t.rootDir).events;
  assert.equal(events.length, n0 + 1, 'exactly one event');
  const e = events.at(-1);
  assert.equal(e.event, 'tree_abandoned', 'the record ENDS with it: no readiness event follows');
  assert.ok(e.gateId && /^[0-9a-f]{64}$/.test(e.shownSha256), 'it carries the gate whose approval the typed id spent');
  assert.equal(stateOf(readTreeRecord(t.rootDir)).abandoned.eventId, e.id);
  assert.ok(existsSync(join(treeDirOf(t.rootDir), HANDOFF_FILE)) && existsSync(join(treeDirOf(t.rootDir), TREE_REPORT_FILE)), 'both view files are written by the form');
});

test('DA-3 declined, a wrong id and a closed stdin write nothing', async () => {
  const t = await realTree();
  const before = eventsText(t.rootDir);
  for (const answers of [['n'], ['not-the-id'], [ROOT_ID, 'n'], []]) {
    const { code, shown } = await decide(t, { abandon: true }, answers);
    assert.notEqual(code, 0, JSON.stringify(answers));
    assert.match(shown, new RegExp(`Abandon tree ${ROOT_ID}\\?`), `${JSON.stringify(answers)}: the abandon text WAS shown (without this a form that never ran would also "write nothing")`);
    assert.equal(eventsText(t.rootDir), before, `${JSON.stringify(answers)}: the record is byte-identical`);
  }
  assert.equal(stateOf(readTreeRecord(t.rootDir)).abandoned, null);
});

test('DA-3 a gate that was PENDING when the tree was abandoned (by another terminal) is not used: the person\'s typed answer records nothing and says so', async () => {
  const t = await realTree();
  const io = terminal([]);                                   // nobody types until we say so
  const pending = decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags: { close: t.child.node }, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() });
  for (let i = 0; i < 200 && !/To approve, type the node path/.test(io.shown()); i += 1) await new Promise(r => setTimeout(r, 25));
  assert.match(io.shown(), /To approve, type the node path/, 'the close form is waiting for its answer');
  abandonTree(t.rootDir, GATE_FIELDS, {});                   // the OTHER terminal abandons the tree
  io.stdin.write(`${t.child.node}\n`);
  for (let i = 0; i < 200 && !/\[y\/N\] $/.test(io.shown()); i += 1) await new Promise(r => setTimeout(r, 25));
  io.stdin.write('y\n');
  const code = await pending;
  assert.equal(code, 1);
  assert.match(io.errors(), SENTENCE); assert.match(io.errors(), /Your approval was NOT used and nothing was recorded\./);
  assert.ok(!readTreeRecord(t.rootDir).events.some(e => e.event === 'node_closed' && e.node === t.child.node), 'the close of the child was not recorded (the root\'s own close is older)');
  assert.equal(readTreeRecord(t.rootDir).events.at(-1).event, 'tree_abandoned', 'and nothing was written after the abandon');
});

test('DA-4 on an abandoned tree: every `decide` form, `approve` and `check` answer with the sentence, ask nothing and write nothing', async () => {
  const t = await realTree();
  abandonTree(t.rootDir, GATE_FIELDS, {});
  const before = eventsText(t.rootDir);
  const forms = [{ close: t.child.node }, { milestone: 'M1' }, { accounting: t.child.node }, { 'top-up': t.child.node, amount: '1' }, { 'max-runs': '20' }, {}, { abandon: true }];
  for (const flags of forms) {
    const r = await decide(t, flags, ['anything']);
    assert.equal(r.code, 1, JSON.stringify(flags)); assert.match(r.errors, SENTENCE); assert.match(r.errors, /Nothing was asked and nothing was written\./);
    assert.doesNotMatch(r.errors, /\.\./, 'no doubled full stop'); assert.equal(r.shown, '', 'nothing was shown or asked');
  }
  const io = terminal(['x']); const a = await approveHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr });
  assert.equal(a, 1); assert.match(io.errors(), SENTENCE); assert.equal(io.shown(), '');
  const io2 = terminal(['x']); const c = await checkHandler({ rootDir: t.rootDir, rootId: ROOT_ID, args: ['R:A1', 'pass'], work: t.work, stdin: io2.stdin, stdout: io2.stdout, stderr: io2.stderr });
  assert.equal(c, 1); assert.match(io2.errors(), SENTENCE); assert.equal(io2.shown(), '');
  assert.equal(eventsText(t.rootDir), before, 'the record is byte-identical after every refusal');
});

test('DA-4 `resume` on an abandoned tree: the sentence, exit 19, no lock file, no stop marker touched, nothing started, the record byte-identical; a tree that is not abandoned is unchanged (known-bad control)', async () => {
  const t = await realTree();
  const started = []; const never = async () => { started.push('start'); throw new Error('must not start'); };
  const live = sink(); const liveErr = sink();
  const control = await resumeHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: live.w, stderr: liveErr.w, deps: { startRun: async () => ({ exitCode: 0 }), resumeRun: async () => ({ exitCode: 0 }) } });
  assert.notEqual(control, 19, 'control: a live tree is resumed normally'); assert.doesNotMatch(live.get(), SENTENCE);
  abandonTree(t.rootDir, GATE_FIELDS, {});
  const before = eventsText(t.rootDir);
  const o = sink(); const e = sink();
  const code = await resumeHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: o.w, stderr: e.w, deps: { startRun: never, resumeRun: never } });
  assert.equal(code, 19); assert.match(o.get(), SENTENCE); assert.deepEqual(started, []);
  assert.equal(eventsText(t.rootDir), before, 'no recovery, no blocked line, no readiness event');
  assert.ok(!existsSync(stopMarkerPath(t.rootDir)), 'no stop marker');
});

test('DA-4 a sitting on an abandoned tree (runTree): status `abandoned`, built without afterStep, the record byte-identical; `stop` writes no marker; a member started by hand is refused at its start (exit 19, nothing spent)', async () => {
  const t = await realTree();
  abandonTree(t.rootDir, GATE_FIELDS, {});
  const before = eventsText(t.rootDir);
  const res = await runTree(t.rootDir, { work: t.work, startRun: async () => { throw new Error('must not start'); } });
  assert.equal(res.status, 'abandoned'); assert.match(res.sentence, SENTENCE); assert.deepEqual(res.stops, []);
  assert.deepEqual(sittingLines(res, ROOT_ID), [res.sentence]);
  assert.equal(eventsText(t.rootDir), before, 'a sitting writes NOTHING to a final tree (no blocked line)');
  const out = sink(); const err = sink();
  assert.equal(await stopHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: out.w, stderr: err.w }), 0);
  assert.match(out.get(), SENTENCE); assert.match(out.get(), /There is nothing left to stop\./); assert.ok(!existsSync(stopMarkerPath(t.rootDir)));
  const kid = await apiStarter({ work: t.work })({ rootDir: t.rootDir, chain: t.child.event.chain.name, bundleDir: join(treeDirOf(t.rootDir), 'inputs', `${t.child.node.replace(/\//g, '.')}@g1`), runId: t.child.runId, grantUsd: t.child.grantUsd });
  assert.equal(kid.exitCode, 19); assert.match(kid.outputTail, /This tree was abandoned by a person/); assert.match(kid.outputTail, /Nothing was run and nothing was spent\./);
});

test('DA-6 a STRANDED ROOT (registered, its run never started) can be abandoned, and `resume` then starts nothing: the root starter is never called, the record is byte-identical, exit 19 (criterion 9: the gate comes before the root-unstarted branch)', async () => {
  const ID = '2026-10-12T10-00-00-000Z';
  const dir = track(mkdtempSync(join(tmpdir(), 'thc-abandon-stranded-'))); const rootDir = join(dir, 'runs', ID);
  mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), 'Plan a tiny change.\n'); installSplitRoot(dir);
  writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  const chains = [['split-root', 0], ['priced-debate', 1], ['priced-debate', 2]].map(([name, depth]) => ({ depth, name, sha256: configSha256(join(dir, 'chains', `${name}.json`)) }));
  startTree(rootDir, { rootCapUsd: 5, chains, rootTask: makeRootTaskPin(join(dir, 'tasks', 'x.md'), dir) });
  mkdirSync(join(rootDir, 'tree', 'inputs', 'R@g1'), { recursive: true });
  writeFileSync(join(rootDir, 'tree', 'inputs', 'R@g1', 'node.json'), `${JSON.stringify({ treeId: ID, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0, splitSha256: null, bundleSha256: null }, null, 2)}\n`);
  registerRoot(rootDir);
  const resume = async deps => { const o = sink(); const e = sink(); const code = await resumeHandler({ rootDir, rootId: ID, work: dir, stdout: o.w, stderr: e.w, deps }); return { code, out: o.get() }; };
  const calls = [];
  const control = await resume({ startRootRun: async opts => { calls.push(opts); return { exitCode: 3 }; }, startRun: async () => ({ exitCode: 0 }), resumeRun: async () => ({ exitCode: 0 }) });
  assert.equal(calls.length, 1, 'control: a stranded root IS started by resume'); assert.doesNotMatch(control.out, SENTENCE);
  const stranded = track(mkdtempSync(join(tmpdir(), 'thc-abandon-stranded2-'))); const rootDir2 = join(stranded, 'runs', ID);
  mkdirSync(join(stranded, 'tasks')); writeFileSync(join(stranded, 'tasks', 'x.md'), 'Plan a tiny change.\n'); installSplitRoot(stranded);
  writeFileSync(join(stranded, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2));
  startTree(rootDir2, { rootCapUsd: 5, chains: chains.map(c => ({ ...c, sha256: configSha256(join(stranded, 'chains', `${c.name}.json`)) })), rootTask: makeRootTaskPin(join(stranded, 'tasks', 'x.md'), stranded) });
  mkdirSync(join(rootDir2, 'tree', 'inputs', 'R@g1'), { recursive: true });
  writeFileSync(join(rootDir2, 'tree', 'inputs', 'R@g1', 'node.json'), `${JSON.stringify({ treeId: ID, node: 'R', generation: 1, attempt: 1, parentNode: null, depth: 0, splitSha256: null, bundleSha256: null }, null, 2)}\n`);
  registerRoot(rootDir2);
  abandonTree(rootDir2, GATE_FIELDS, {});
  const before = eventsText(rootDir2); const never = [];
  const o = sink(); const e = sink();
  const code = await resumeHandler({ rootDir: rootDir2, rootId: ID, work: stranded, stdout: o.w, stderr: e.w, deps: { startRootRun: async opts => { never.push(opts); return { exitCode: 3 }; }, startRun: async () => { never.push('node'); return { exitCode: 0 }; }, resumeRun: async () => { never.push('resume'); return { exitCode: 0 }; } } });
  assert.equal(code, 19); assert.match(o.get(), SENTENCE); assert.deepEqual(never, [], 'nothing was started');
  assert.equal(eventsText(rootDir2), before);
});

test('DA-9 the root cannot be closed as a node: the sentence names `decide <root> --abandon`, and the old pointer is gone', async () => {
  const t = await realTree();
  const r = await decide(t, { close: 'R' }, []);
  assert.equal(r.code, 1);
  assert.match(r.errors, new RegExp(`the root cannot be closed as a node; to end the whole tree for good use \`council tree decide ${ROOT_ID} --abandon\`, or \`council tree stop\` to start nothing further for now`));
  assert.doesNotMatch(r.errors, /PLAN 7\.5/);
});

test('the CLI front door: `council tree decide <root> --abandon` is a KNOWN option of the real CLI (src/cli.js BOOLEAN_FLAGS lists it); a normal command refuses it as tree-only', () => {
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { encoding: 'utf8', cwd: root, timeout: 60000 });
  const unknown = run(['tree', 'decide', ROOT_ID, '--abandon']);
  assert.doesNotMatch(unknown.stderr, /unknown option|not an option/i, `the front door must not refuse --abandon as unknown: ${unknown.stderr}`);
  const normal = run(['--abandon']);
  assert.match(normal.stderr, /--abandon: an option of `council tree` only, not of this command\. Nothing was run and nothing was spent\./);
});

test('DA-10 (the MCP half): no MCP tool abandons anything - it is a terminal verb (the tool COUNT is pinned by test/landing-page.test.js, which derives it from src/mcp/server.js)', () => {
  const sources = ['server.js', 'advice.js', 'contract.js'].map(f => readFileSync(new URL(`../src/mcp/${f}`, import.meta.url), 'utf8'));       // the same three files test/landing-page.test.js counts
  const names = sources.flatMap(src => [...src.matchAll(/server\.(?:tool|registerTool)\(\s*'([a-z_]+)'/g)].map(m => m[1]));
  assert.ok(names.length >= 20, `the tool list was read (${names.length} tools)`);
  assert.deepEqual(names.filter(n => /abandon/.test(n)), []);
});

test('the option plumbing: `--abandon` is the first BOOLEAN tree option (parsed as true, only by `decide`), one form per invocation, and the usage line lists it', () => {
  // CHANGED ACCEPTED (red triage, C&C thcmcp-cd 23 Okt 2026). OLD: ['--abandon', '--open-root-stop', '--accept-plan']. NEW: and '--fresh' as the fourth boolean. WHY: a5d818f (19 Okt) added --fresh, the earlier root plan left out instead of offered as data.
  assert.deepEqual(TREE_VERBS.decide.bool, ['--abandon', '--open-root-stop', '--accept-plan', '--fresh']);   // 2c EDITED, disclosed (old: ['--abandon', '--open-root-stop']): `--accept-plan` is the third boolean;   // EDITED (S8-8, disclosed): `--open-root-stop` is the second boolean; old: ['--abandon']
  assert.deepEqual(parseTreeArgs(['decide', 'rid', '--abandon']), { verb: 'decide', rootArg: 'rid', flags: { abandon: true } });
  assert.match(parseTreeArgs(['resume', 'rid', '--abandon']).error ?? '', /not an option of `council tree resume`/);
  assert.match(parseTreeArgs(['decide', 'rid', '--abandon', '--abandon']).error ?? '', /given twice/);
  assert.match(chooseForm({ abandon: true, close: 'R/M1' }).error ?? '', /one form per invocation: --close, --abandon/);
  assert.deepEqual(chooseForm({ abandon: true }), { form: 'abandon', value: true });
});

test('a member\'s detail that ends with a full stop does not print "..": the tree_refused line strips it (known-bad control: a detail without one is unchanged)', () => {
  const line = detail => sittingLines({ status: 'tree_refused', node: 'R/M1', generation: 1, runId: 'run-x', exitCode: 19, detail, started: [], stops: [] }, ROOT_ID)[0];
  assert.equal(line('its input changed. Put it back.'), 'The tree refused to start or resume R/M1 (run run-x) (exit 19): its input changed. Put it back. Nothing was spent.');
  assert.doesNotMatch(line('ends with a stop.\n'), /\.\./);
  assert.equal(line('no stop at the end'), 'The tree refused to start or resume R/M1 (run run-x) (exit 19): no stop at the end. Nothing was spent.');
});
