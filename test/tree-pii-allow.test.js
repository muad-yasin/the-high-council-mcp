// T-b of the PII stop unit (owner 18/19 Okt 2026: the person chooses to continue AFTER SEEING; a standing warn only from the user). A tree under the default stop: a sub-plan the models wrote whose input holds personal data gets a recorded `bundle_input`
// stop (nothing registered); `council tree decide <root> --allow-pii-node <node>@gN` shows where each finding sits (never the value), asks the typed node path, and records ONE `bundle_input_allowed` for exactly the types the stop found; the next
// sitting registers the child and its own run scans with that allowance READ FROM THE RECORD (a member still takes no --allow-pii flag). `council tree start --allow-pii <types>` does the same for the ROOT task (tree.json `piiAllow`).
// This REVERSES C&C's F1 ruling on 3822f9a ("a TREE has no allow-list") in ONE way only: an allowance a person recorded after seeing; the member's own flag stays refused (tree-member-pii-warnings, tree-start-piigate PG-1).
// Real verbs, all-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { treePiiAllowFrom } from '../src/tree-pii-mode.js';
import { recordedPiiAllow } from '../src/tree-member.js';
import { presenceProblems } from './helpers/event-presence.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { piiGateReport } from '../src/run-preflight.js';
import { bundleInputCheck, openBundleInputStop } from '../src/tree-bundle-input.js';
import { ROOT_ID, cli, installSplitRoot, newTree, rootOpts } from './helpers/tree-fixture.js';
import { registerRoot } from '../src/tree-register.js';
import * as api from '../src/api.js';
import { track } from './helpers/temp-trees.js';
import { pricedDebate } from './helpers/child-chains.js';

const MAIL = ['jane.doe', '@', 'mail-corp', '.de'].join('');

async function treeWith(model, opts = {}) {
  const sc = splitChildren(); const cfg = sc.extraChains['split-child'];
  const seat = { provider: 'mock', model, maxTokens: 4000 };
  cfg.seats = { ...cfg.seats, builder: seat, reviser: seat };
  const r = await trackedRealRoot({ ...sc, plan: plan3(), ...opts }); approvePending(r);
  return r;
}
const sittings = async r => { let last; for (let i = 0; i < 6; i += 1) { last = await runTree(r.t.rootDir, { work: r.t.work }); if (last.status !== 'limit_reached') break; } return last; };
const stopsOf = r => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'bundle_input');
const decide = (r, flags, answers) => {
  const io = terminal(answers);
  const run = () => { const timer = setTimeout(() => io.stdin.end(), 8000); return decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)); };
  return { io, run };
};

test('TA-1 THE WAY ON, real verbs: the stop names the e-mail in R/M2\'s input; --allow-pii-node shows the places (no value), asks the typed node path and records ONE bundle_input_allowed for [email] that answers the stop; the next sitting registers R/M2 and it runs to its end; its run.json carries no allow list of its own', async () => {
  const r = await treeWith('mock-plan-placeholder-email', { piiGate: 'hard-stop' });
  const out = await sittings(r); assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  const [stop] = stopsOf(r); assert.equal(stop.node, 'R/M2'); assert.ok(stop.findings.every(f => f.name.startsWith('pii:email')), JSON.stringify(stop.findings));
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R/M2@g1'), false);
  const d = decide(r, { 'allow-pii-node': 'R/M2@g1' }, ['R/M2', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  for (const needle of ['Send R/M2@g1 anyway?', `Stop ${stop.id} refused it before it started`, 'context.md line', 'personal data (email)', 'for the types email only', 'Nothing is started or spent by this answer']) assert.ok(d.io.shown().includes(needle), `${needle}\n${d.io.shown()}`);
  assert.equal(d.io.shown().includes(MAIL), false, 'the address is not in what the person reads');
  const allowed = eventsOf(r).filter(e => e.event === 'bundle_input_allowed'); assert.equal(allowed.length, 1);
  assert.deepEqual([allowed[0].node, allowed[0].generation, allowed[0].stopId, allowed[0].types], ['R/M2', 1, stop.id, ['email']]); assert.ok(allowed[0].gateId && /^[0-9a-f]{64}$/.test(allowed[0].shownSha256) && allowed[0].actor === 'person');
  let st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(st.openStops.includes(stop.id), false, 'the same event answered the stop'); assert.equal(st.nodes.has('R/M2@g1'), false, 'the answer registers nothing');
  assert.deepEqual(recordedPiiAllow({ rootDir: r.t.rootDir, lineage: { node: 'R/M2', generation: 1 } }), ['email']);
  assert.deepEqual(recordedPiiAllow({ rootDir: r.t.rootDir, lineage: { node: 'R/M3', generation: 1 } }), [], 'nobody else is covered');
  const after = await sittings(r); assert.notEqual(after.status, 'held_by_stop', JSON.stringify(after));
  st = stateOf(readTreeRecord(r.t.rootDir)); assert.equal(st.nodes.get('R/M2@g1')?.phase, 'closed', `R/M2 ran: ${JSON.stringify(after)}`);
  assert.equal(stopsOf(r).length, 1, 'no second stop');
  const runDir = join(r.t.rootDir, '..', st.nodes.get('R/M2@g1').runId);
  const meta = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8')); assert.deepEqual(meta.piiGate?.allow ?? [], [], 'the allowance lives in the tree record, not in the member');
  assert.deepEqual(presenceProblems(eventsOf(r)), []);
});

test('TA-2 REFUSED with a sentence, nothing written: a stop that also holds key-shaped text (a tree takes no override of the key scan); a node with no such stop; a node already registered', async () => {
  const r = await treeWith('mock-plan-placeholder-url', { piiGate: 'hard-stop' });
  await sittings(r); const before = eventsOf(r).length;
  for (const [node, why] of [['R/M2@g1', /holds no personal-data finding|key-shaped/], ['R/M7@g1', /no open stop about a child of that name/], ['R/M3@g1', /already registered/]]) {
    const d = decide(r, { 'allow-pii-node': node }, []); assert.equal(await d.run(), 1, node); assert.match(d.io.errors(), why, node);
  }
  assert.equal(eventsOf(r).length, before, 'nothing was written');
});

test('TA-3 THE TABLE (bundle_input_allowed): a type the stop did not find, a second allowance, a foreign stop, a missing gate and a session as the answerer are each refused with their own sentence', async () => {
  const r = await treeWith('mock-plan-placeholder-email', { piiGate: 'hard-stop' });
  await sittings(r); const [stop] = stopsOf(r);
  const G = { gateId: 'g-1', shownSha256: 'a'.repeat(64), actor: 'person', via: 'terminal' };
  const ev = over => ({ event: 'bundle_input_allowed', node: 'R/M2', generation: 1, stopId: stop.id, types: ['email'], ...G, ...over });
  const refused = (e, why) => assert.throws(() => appendTreeEvent(r.t.rootDir, e), x => x.name === 'TreeRefusal' && why.test(x.reason), JSON.stringify(e));
  refused(ev({ types: ['iban'] }), /names a type the stop did not find/);
  refused(ev({ node: 'R/M3' }), /is registered/);
  refused(ev({ stopId: 'e1' }), /open stop of the input kind/);
  assert.throws(() => appendTreeEvent(r.t.rootDir, ev({ gateId: undefined })), /gateId/);
  assert.throws(() => appendTreeEvent(r.t.rootDir, ev({ types: [] })), /types/);
  refused(ev({ actor: 'session', via: 'mcp', reason: 'r' }), /person's only/);
  assert.equal(appendTreeEvent(r.t.rootDir, ev({})).event, 'bundle_input_allowed');
  refused(ev({}), /already has an allowance|open stop of the input kind/);
});

test('TA-4 the tree.json reader: no field = none; a usable list = on; an empty list, a word outside the four, a repeat, a non-list and a non-object are unusable (fail closed: the root scan then allows nothing)', () => {
  assert.deepEqual(treePiiAllowFrom({}), { status: 'none' });
  assert.deepEqual(treePiiAllowFrom({ piiAllow: ['email'] }), { status: 'on', types: ['email'] });
  for (const bad of [[], ['rm'], ['email', 'email'], 'email', null]) assert.equal(treePiiAllowFrom({ piiAllow: bad }).status, 'unusable', JSON.stringify(bad));
  assert.equal(treePiiAllowFrom(null).status, 'unusable');
});

test('TA-5 ROOT, real CLI: `tree start --allow-pii email` records piiAllow in tree.json and starts (the root run scans with the record); without the flag the same task stops (exit 11, no folder); a word outside the four, and --allow-pii with --pii-gate warn, are exit 2', () => {
  const mk = () => { const dir = mkdtempSync(join(tmpdir(), 'thc-pii-treeallow-')); mkdirSync(join(dir, 'tasks')); writeFileSync(join(dir, 'tasks', 'x.md'), `Plan a tiny change. Contact ${MAIL}.\n`); installSplitRoot(dir); writeFileSync(join(dir, 'chains', 'priced-debate.json'), JSON.stringify({ ...pricedDebate(), name: 'priced-debate' }, null, 2)); return dir; };
  const start = (dir, extra) => spawnSync(process.execPath, [cli, 'tree', 'start', '--task', 'tasks/x.md', '--chain', 'split-root', '--child-chain', 'priced-debate', '--max-usd', '5', ...extra], { cwd: dir, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: dir }, timeout: 120_000 });
  const a = mk(); const stopped = start(a, []); assert.equal(stopped.status, 11, stopped.stderr); assert.match(stopped.stderr, /--allow-pii email/); assert.equal(existsSync(join(a, 'runs')), false);
  const ok = start(a, ['--allow-pii', 'email']); assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const rec = readTreeRecord(join(a, 'runs', readdirSync(join(a, 'runs'))[0])); assert.deepEqual(rec.tree.piiAllow, ['email']); assert.equal(rec.tree.piiGate, 'hard-stop');
  assert.equal(ok.stderr.includes(MAIL), false);
  for (const [extra, why] of [[['--allow-pii', 'rm'], /expected some of email, iban, card \(each once\)|expected some of email, iban, card, got/], [['--allow-pii', 'email', '--pii-gate', 'warn'], /on warn for this tree/]]) { const b = start(mk(), extra); assert.equal(b.status, 2, b.stderr); assert.match(b.stderr, why); }
});

test('TA-6 THE STOP NAMES THE VERB: the text of a PII-only bundle_input stop on a child offers `--allow-pii-node <node>@gN` beside the close and the regenerate; the text of a stop with key-shaped text does not (a tree takes no override of the key scan)', async () => {
  const { needsDecisionStopText } = await import('../src/tree-stop-view.js');
  const pii = await treeWith('mock-plan-placeholder-email', { piiGate: 'hard-stop' }); await sittings(pii);
  const [p] = stopsOf(pii); const pt = needsDecisionStopText(pii.t.rootDir, p);
  assert.ok(pt.includes(`council tree decide ${ROOT_ID} --allow-pii-node R/M2@g1`), pt); assert.ok(pt.includes('(email only)')); assert.equal(pt.includes(MAIL), false);
  const key = await treeWith('mock-plan-placeholder-url', { piiGate: 'hard-stop' }); await sittings(key);
  const [k] = stopsOf(key); assert.equal(needsDecisionStopText(key.t.rootDir, k).includes('--allow-pii-node'), false);
});

test('TA-7 C&C RULING (c), ROOT-CARRIED: a stop recorded on the ROOT (a model-written root plan carries the finding into R/M3\'s input) is answered by `--allow-pii-node R/M3@g1` through the CHILD key like a sub-plan\'s; the table accepts it (OLD in this branch: refused, "a new root plan answers it"); a pii:secret finding or key-shaped text is not allowable', async () => {
  const r = await treeWith('mock-plan-placeholder-url-localhost', { piiGate: 'hard-stop' });
  const opened = openBundleInputStop(r.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: [{ file: 'context.md', line: 3, name: 'pii:email' }], carriers: [], parentOwned: true } });
  assert.equal(opened.kind, 'stop_opened'); assert.equal(opened.stop.node, 'R', 'recorded on the root');
  const d = decide(r, { 'allow-pii-node': 'R/M3@g1' }, ['R/M3', 'y']);
  assert.equal(await d.run(), 0, d.io.shown() + d.io.errors());
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.deepEqual(st.piiAllowed.get('R/M3@g1')?.types, ['email']); assert.equal(st.openStops.length, 0, 'the root-variant stop is answered by the allowance');
  const out = await sittings(r); assert.notEqual(out.status, 'held_by_stop', JSON.stringify(out));
  const after = stateOf(readTreeRecord(r.t.rootDir)); assert.equal(after.nodes.get('R/M3@g1')?.phase, 'closed', `R/M3 registered and ran: ${JSON.stringify(out)}`); assert.equal(after.openStops.length, 0);
  // a pii:secret finding is key-shaped text: no allowance (the single-run CLI may take --allow-pii secret; a tree takes no override of the key scan)
  const r2 = await treeWith('mock-plan-placeholder-url-localhost', { piiGate: 'hard-stop' });
  openBundleInputStop(r2.t.rootDir, { child: { node: 'R/M3', generation: 1 }, parent: { node: 'R', generation: 1 }, found: { findings: [{ file: 'context.md', line: 3, name: 'pii:secret:Mistral' }], carriers: [], parentOwned: true } });
  const e = decide(r2, { 'allow-pii-node': 'R/M3@g1' }, []); assert.equal(await e.run(), 1); assert.match(e.io.errors(), /holds key-shaped text|holds no personal-data finding/);
});

test('TA-8 C&C RULING (c), ROOT TASK ONLY: the root allowance covers the task text and nothing else: bundleInputCheck with allowOnly [task.md] lets the task\'s e-mail through and still stops the same e-mail in context.md; the CLI scan (allowTask) drops the finding on the task\'s lines and keeps the one further down; `secret` is not a tree word', () => {
  const mail = MAIL; const files = { 'task.md': `Contact ${mail}\n`, 'context.md': `# Context\nalso ${mail}\n` };
  const mode = { status: 'on', mode: 'hard-stop' };
  assert.deepEqual(bundleInputCheck({ files, piiMode: mode, allow: ['email'], allowOnly: ['task.md'] }).findings.map(f => [f.file, f.name]), [['context.md', 'pii:email']]);
  assert.deepEqual(bundleInputCheck({ files, piiMode: mode, allow: ['email'] }).findings, [], 'a child\'s own allowance covers its whole input');
  const combined = `Contact ${mail}\n\n---\n\n# Standing context\nalso ${mail}\n`;
  const rep = piiGateReport({ mode: 'hard-stop', sources: [['the task file and --context documents', combined]], allowTask: { types: ['email'], lines: 1 } });
  assert.equal(rep.blocked, true); assert.deepEqual(rep.findings.map(f => f.line), [6]); assert.match(rep.lines.join('\n'), /suppressed pattern class 'email'/);
  assert.equal(piiGateReport({ mode: 'hard-stop', sources: [['x', combined]], allowTask: { types: ['email'], lines: 99 } }).blocked, false);
  // the allowance names ITS source: an e-mail on line 1 of the handed draft is not the task's and still stops
  const two = piiGateReport({ mode: 'hard-stop', sources: [['the task file and --context documents', `Contact ${mail}\n`], ['the handed draft (--draft / --from-run)', `Draft says ${mail}\n`]], allowTask: { types: ['email'], lines: 1, where: 'the task file and --context documents' } });
  assert.equal(two.blocked, true); assert.deepEqual(two.findings.map(f => f.where), ['the handed draft (--draft / --from-run)']);
  assert.equal(treePiiAllowFrom({ piiAllow: ['secret'] }).status, 'unusable');
});

test('TA-9 ROOT ALLOWANCE REACHES THE CHILDREN BY BYTES (C&C ruling (c), Q1): the task\'s own e-mail rides into R/M1\'s context.md section 2 as a verbatim copy of the pinned task; R/M1 registers and runs without a stop of its own, and the walk reaches the root re-plan; the same address written by a MODEL still stops (TA-10)', async () => {
  const { driveToDepthTwoReplan } = await import('./helpers/depth-two-replan.js');
  const S = await driveToDepthTwoReplan({ taskText: `Plan a tiny change. Contact ${MAIL}.\n`, startFlags: { 'allow-pii': 'email' } });
  assert.deepEqual(readTreeRecord(S.rootDir).tree.piiAllow, ['email']);
  assert.equal(S.kinds('needs_decision_opened').some(e => e.source === 'bundle_input'), false, 'no child was stopped for the task\'s own address');
  assert.deepEqual([S.nodeOf('R/M1', 1)?.phase, S.nodeOf('R/M1', 1)?.outcome], ['closed', 'passed']);
  // the root re-plan: R@g2 registers with the task's address allowed (root registration, allowOnly ['task.md']); its sitting is where the base budget-cap red lives, so the exit code is NOT asserted
  const a = await S.approve(); assert.equal(a.code, 0, a.text);
  await S.sit();
  assert.ok(S.nodeOf('R', 2), 'R@g2 registered');
  assert.equal(S.kinds('blocked').some(e => e.check === 'bundle_input'), false, 'the root backstop did not refuse the new root plan');
});

test('TA-10 BYTES, NEVER THE VALUE: a model-written plan section that holds the same address still stops the child, with the root allowance recorded; only the tree code\'s verbatim copy of the pinned task is covered', async () => {
  const r = await treeWith('mock-plan-placeholder-email', { piiGate: 'hard-stop' });
  const { appendTreeEvent: _ } = await import('../src/tree-record.js');
  // the filter: the same address inside derive's span is covered, outside it (model text: section 1, 3 or 4) it still stops
  const ctx = `# Context\n\n## 1. entry\nScope: write to ${MAIL}\n----- root task x -----\nContact ${MAIL}\n----- end -----\n`;
  const at = ctx.indexOf('Contact'); const files = { 'task.md': 'Milestone: M1\n', 'context.md': ctx };
  const found = bundleInputCheck({ files, piiMode: { status: 'on', mode: 'hard-stop' }, rootCover: { types: ['email'], spans: [{ from: at, to: at + 8 + MAIL.length }] } });
  assert.deepEqual(found.findings.map(f => [f.file, f.line, f.name]), [['context.md', 4, 'pii:email']], 'only the model-written line stops');
  assert.deepEqual(bundleInputCheck({ files, piiMode: { status: 'on', mode: 'hard-stop' } }).findings.map(f => f.line), [4, 6], 'no coverage: both stop');
  const { rootTaskCoverage } = await import('../src/tree-bundle-input.js');
  // the unit rows: spans only count with the allowance, the pin and the pinned hash; the address is nowhere consulted
  const tree = { piiAllow: ['email'], rootTask: { task: '/x', cwd: '/', taskHash: 'aaaaaaaaaaaa' } };
  assert.deepEqual(rootTaskCoverage(tree, { rootTaskHash: 'aaaaaaaaaaaa', rootTaskSpans: [{ from: 1, to: 5 }] }), { types: ['email'], spans: [{ from: 1, to: 5 }] });
  assert.deepEqual(rootTaskCoverage(tree, { rootTaskHash: 'bbbbbbbbbbbb', rootTaskSpans: [{ from: 1, to: 5 }] }), { types: [], spans: [] }, 'a task that is not the pinned one covers nothing');
  assert.deepEqual(rootTaskCoverage({ ...tree, piiAllow: undefined }, { rootTaskHash: 'aaaaaaaaaaaa', rootTaskSpans: [{ from: 1, to: 5 }] }), { types: [], spans: [] }, 'no allowance covers nothing');
  const out = await sittings(r); assert.equal(out.status, 'held_by_stop', JSON.stringify(out));
  assert.ok(stopsOf(r).length >= 1, 'model text with the address stops the child (no root allowance in this tree)');
});

test('TA-11 FAIL CLOSED (C&C 19 Okt 2026): a tree member handed no mode, in a tree that records none, scans under the stop, never a quiet warn: its task holding an e-mail ends at exit 11 (OLD fallback \'warn\': the run went on)', async () => {
  const t = newTree({ cap: 100 }); track(t.work); registerRoot(t.rootDir);
  writeFileSync(join(t.work, 'tasks', 'x.md'), `Plan a tiny change. Contact ${MAIL}.\n`);
  const res = await api.run({ ...rootOpts(t) });
  assert.equal(res.exitCode, 11, res.outputTail);
});

test('TA-12 PERSON ONLY: `tree decide --allow-pii-node` over plain streams (no terminal) is refused and records no bundle_input_allowed (the allowance is written only through the gate answer)', async () => {
  const { PassThrough } = await import('node:stream');
  const r = await treeWith('mock-plan-placeholder-email', { piiGate: 'hard-stop' }); await sittings(r);
  const so = new PassThrough(); const se = new PassThrough(); const si = new PassThrough();
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { 'allow-pii-node': 'R/M2@g1' }, work: r.t.work, stdin: si, stdout: so, stderr: se, now: () => Date.now() }).finally(() => si.end());
  assert.notEqual(code, 0); assert.equal(eventsOf(r).filter(e => e.event === 'bundle_input_allowed').length, 0);
});
