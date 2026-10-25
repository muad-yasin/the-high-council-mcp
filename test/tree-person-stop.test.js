// 0.8.3 M6 S8-8, the PERSON-OPENED ROOT STOP (contract Review/Build_0.8.3/m6-closing/S8-8_Person_Opened_Root_Stop_Contract.md, gate 1 passed 12 Oct, C&C's acceptance of the departures 13 Oct). Muad, 11 Oct: "a person may open a root stop himself
// (ready-but-wrong plans)". Commit 1 (the RECORD layer): the table row for `source: 'person'` (P4) and the detect clause that keeps a person's stop from hiding the root's own automatic stop (P8). The form (commit 2) and the readers
// (commit 3) add their own tests to this file. Fold units on raw events, like test/tree-held-state.test.js and test/tree-abandon.test.js; P8 runs on a REAL tree. All $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectStops } from '../src/tree-detect.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { eventShapeError, foldRecord, transitionRefusal } from '../src/tree-transitions.js';
import { registerRoot } from '../src/tree-register.js';
import { GATE_FIELDS, ROOT_ID, claim, hostnameOf, newTree, syntheticRun } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const G = GATE_FIELDS;
const runFor = (n, g) => (n === 'R' && g === 1 ? 't' : `run-${n.replace(/\//g, '-')}-${g}`);
const reg = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: runFor(n, g), attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 4, unit: 'usd' } });
const started = (id, n, g, extra = {}) => ({ id, event: 'node_started', node: n, generation: g, runId: runFor(n, g), pid: 1, host: 'h', ...extra });
const closed = (id, n, g, extra = {}) => ({ id, event: 'node_closed', node: n, generation: g, runId: runFor(n, g), outcome: 'passed', passed: true, status: null, share: 'released', ...extra });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: 'f'.repeat(64), frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', frontierKey: fk, revision: 1, ...G, boundSha256: 'f'.repeat(64) }];
// a FINISHED tree: the root closed passed, one child closed passed; nothing is running
const DONE = [{ id: 'e1', event: 'tree_started', treeId: 't' }, { id: 'e2', ...reg('R', 1, null, null), depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'), { id: 'e4', ...reg('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1)];
const personStop = (extra = {}) => ({ id: 'e50', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'The plan leaves the billing out.', ...G, ...extra });
const why = (events, event) => transitionRefusal(foldRecord(events), event)?.reason ?? null;

test('P4 the table, the GOOD case: a person\'s stop on the newest, closed root of a finished tree is accepted, and the fold keeps the reason with the event', () => {
  assert.equal(why(DONE, personStop()), null);
  assert.equal(eventShapeError({ schema: 'tree-events/1', ...personStop(), at: '2026-10-13T12:00:00.000Z' }), null, '`reason` is a known optional field');
  assert.match(eventShapeError({ schema: 'tree-events/1', ...personStop({ reason: 42 }), at: '2026-10-13T12:00:00.000Z' }) ?? '', /reason/, 'and it must be a string');
  const state = foldRecord([...DONE, personStop()]);
  assert.deepEqual(state.openStops, ['e50']); assert.equal(state.stopMeta.get('e50').source, 'person');
});

test('P4 the table REFUSES a person\'s stop that is not the one good case (known-bad inputs; the child-with-no-gate case is ACCEPTED at the base)', () => {
  const minimal = { id: 'e50', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'person', affected: [{ node: 'R/M1', generation: 1 }] };
  assert.match(why(DONE, minimal) ?? '', /ROOT plan only/, 'a closed child with no gate: accepted by the row before S8-8');
  assert.match(why(DONE, personStop({ node: 'R/M1', runId: runFor('R/M1', 1) })) ?? '', /ROOT plan only/, 'even with a gate and a reason');
  assert.match(why(DONE, personStop({ gateId: undefined })) ?? '', /carries the gate/);
  // K10 (C2a-record commit 5, fix-up; C&C 6d condition 7): a person's stop says who answered, and only a person may open it (its `reason` stays the typed reason)
  assert.match(why(DONE, personStop({ actor: undefined, via: undefined })) ?? '', /records who gave it/, 'no who answered');
  assert.match(why(DONE, personStop({ actor: 'session', via: 'mcp', reason: 'typed' })) ?? '', /person's only/, 'the session cannot open a person\'s stop');
  assert.match(why(DONE, personStop({ actor: 'person', via: 'mcp' })) ?? '', /names its channel/, 'a person does not answer through the session channel');
  assert.match(why(DONE, personStop({ shownSha256: 'not-hex' })) ?? '', /carries the gate/);
  for (const reason of [undefined, '', '   ']) assert.match(why(DONE, personStop({ reason })) ?? '', /carries the reason/, JSON.stringify(reason));
  const running = DONE.filter(e => e.id !== 'e2c');
  assert.match(why(running, personStop()) ?? '', /R@g1 is not closed/, 'a root that has not finished');
  const kidRegistered = [...DONE.filter(e => !['e4b', 'e4c'].includes(e.id))];
  assert.match(why(kidRegistered, personStop()) ?? '', /R\/M1@g1 is active|R\/M1@g1 is not closed/, 'a registered child that never started (it is the active node)');
  const kidRunning = DONE.filter(e => e.id !== 'e4c');
  assert.match(why(kidRunning, personStop()) ?? '', /is active|is not closed/, 'a running child');
  assert.match(why([...DONE, personStop({ id: 'e50' })], personStop({ id: 'e51' })) ?? '', /already has an open stop/, 'an open stop on the root');
  const replan = [{ id: 'e60', event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: 'e59', replansRoot: true, affected: [{ node: 'R', generation: 1 }], ...G }];
  assert.match(why([...DONE, ...replan], personStop()) ?? '', /new root plan is already being opened/, 'a root re-plan whose generation was not opened');
  const opened = [...DONE, { id: 'e59', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }] }, replan[0], { id: 'e61', event: 'generation_opened', decisionId: 'e60', nodes: [{ node: 'R', generation: 2 }] }];
  assert.match(why(opened, personStop()) ?? '', /dead|held|not the newest/, 'the OLD root generation (its plan was replaced)');
});

test('P4 a RE-PLANNED root: once R@g2 has finished, a person may open a stop on it although an old child of R@g1 (dead, stopped at its cap) never closed and never will', () => {
  // the held-state fixture of test/tree-held-state.test.js in miniature: R@g1 closed needs_decision, R/M3@g1 stopped at its cap, the root re-planned (R@g2 opened), R@g2 registered, started and closed
  const OLD = [...DONE.filter(e => !['e4b', 'e4c'].includes(e.id)), started('e4b', 'R/M1', 1), { id: 'e4s', event: 'node_stopped', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), reason: 'budget' }];
  const stopE = { id: 'e9', event: 'needs_decision_opened', node: 'R', generation: 1, runId: 't', source: 'node_closed', affected: [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }] };
  const decideE = { id: 'e10', event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: 'e9', replansRoot: true, affected: [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }], ...G };
  const openE = { id: 'e11', event: 'generation_opened', decisionId: 'e10', nodes: [{ node: 'R', generation: 2 }] };
  const g2 = [{ id: 'e12', ...reg('R', 2, null, null), runId: 'run-R-2', depth: 0 }, { id: 'e13', event: 'node_started', node: 'R', generation: 2, runId: 'run-R-2', pid: 1, host: 'h' }, { id: 'e14', event: 'node_closed', node: 'R', generation: 2, runId: 'run-R-2', outcome: 'passed', passed: true, status: null, share: 'released' }];
  const events = [...OLD, stopE, decideE, openE, ...g2];
  const state = foldRecord(events);
  assert.equal(state.nodes.get('R/M1@g1').phase, 'stopped', 'known-bad control: the old child never closed');
  assert.equal(transitionRefusal(state, personStop({ node: 'R', generation: 2, runId: 'run-R-2', affected: [{ node: 'R', generation: 2 }] }))?.reason ?? null, null, 'a person may open a stop on the finished R@g2');
  // and the control inside: an UNFINISHED live node still refuses
  const live = [...events, { id: 'e20', ...reg('R/M9', 1, 'R', 'kZ') }];
  assert.match(why(live, personStop({ node: 'R', generation: 2, runId: 'run-R-2', affected: [{ node: 'R', generation: 2 }] })) ?? '', /R\/M9@g1 is (active|not closed)/);
});

test('P4 an abandoned tree refuses it with the abandoned sentence (57 sits in front of the row; no line of its own)', () => {
  const state = foldRecord([...DONE, { id: 'e70', event: 'tree_abandoned', at: '2026-10-13T12:00:00.000Z', ...G }]);
  assert.match(transitionRefusal(state, personStop({ id: 'e71' }))?.reason ?? '', /This tree was abandoned by a person/);
});

test('P8 (EDITED by the S8-8 fix-up, disclosed; old: a person\'s stop beside the root\'s not-yet-written own stop was ACCEPTED) a person\'s stop WAITS while the root\'s own needs_decision close has no stop: the table refuses it; detection then writes the root\'s own stop, and a person\'s stop is then refused for the open stop on the root', () => {
  const t = newTree({}); track(t.work);
  registerRoot(t.rootDir); syntheticRun(t, ROOT_ID, {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R', ROOT_ID, process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R', generation: 1, runId: ROOT_ID, outcome: 'passed', passed: true, status: 'needs_decision', share: 'released' });
  assert.deepEqual(stateOf(readTreeRecord(t.rootDir)).openStops, [], 'no stop is open yet: no sitting has looked');
  const person = { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'It is wrong.', ...G };
  const refusedBy = fn => { try { fn(); return null; } catch (e) { return e.reason ?? e.message; } };
  assert.match(refusedBy(() => appendTreeEvent(t.rootDir, person)) ?? '', /R@g1 ended with the Status needs_decision and its stop is not written yet/);
  const opened = detectStops(t.rootDir, {});
  assert.equal(opened.length, 1, 'detection writes the root\'s own automatic stop'); assert.equal(opened[0].source, 'node_closed');
  assert.match(refusedBy(() => appendTreeEvent(t.rootDir, person)) ?? '', /the root plan already has an open stop/);
  assert.equal(detectStops(t.rootDir, {}).length, 0, 'and a second look appends nothing more');
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------- commit 2: the FORM
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { abandonTree } from '../src/tree-abandon.js';
import { chooseForm, decideHandler } from '../src/tree-decide.js';
import { DECISION_WORDS, readDecisionText } from '../src/tree-decide-stop.js';
import { parseTreeArgs } from '../src/tree-cli.js';
import { recordRefusalLine } from '../src/tree-abandon.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { acquireRunLock } from '../src/run-lock.js';
import { SITTING_LOCK_FILE } from '../src/tree-files.js';
import { treeDirOf } from '../src/tree-record.js';
import { IDS, approveFrontier, closedRootTree, registerKid, root } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

const finished = (opts = {}) => { const t = closedRootTree({ cap: 50, ...opts }); track(t.work); return t; };
const decideAt = async (t, flags, answers, { tty = true } = {}) => {
  const io = terminal(answers, tty ? {} : { tty: false }); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, shown: io.shown().replace(/\u001b\[[0-9;]*[A-Za-z]/g, ''), errors: io.errors() };
};
const eventsOf = t => readTreeRecord(t.rootDir).events;
const gateFiles = t => { const d = join(treeDirOf(t.rootDir), 'gate-texts'); return existsSync(d) ? readdirSync(d).length : 0; };
const REASON = 'The plan leaves the billing out.\nIt also never says who owns the migration.';

test('readDecisionText: the DEFAULT words are the accepted M5d words, byte for byte (S8-8 added a `words` parameter and moved nothing)', async () => {
  assert.equal(DECISION_WORDS.intro(16384), 'Type your decision. It is recorded word for word (at most 16384 bytes). End it with a line holding only a dot (.).');
  assert.equal(DECISION_WORDS.prompt, 'decision: '); assert.equal(DECISION_WORDS.empty, 'the decision is empty'); assert.equal(DECISION_WORDS.tooLong(20), 'the decision is longer than 20 bytes');
  const run = async (lines, extra = {}) => { const stdin = new PassThrough(); const stdout = new PassThrough(); stdin.isTTY = true; stdin.setRawMode = () => {}; stdout.isTTY = true; let out = ''; stdout.on('data', d => { out += d; }); const p = readDecisionText({ stdin, stdout, ...extra }); setImmediate(() => stdin.write(lines.join('\n') + '\n')); return { res: await p, out }; };
  const empty = await run(['.']); assert.deepEqual(empty.res, { error: 'the decision is empty' }); assert.ok(empty.out.startsWith('Type your decision. It is recorded word for word (at most 16384 bytes). End it with a line holding only a dot (.).\n'));
  const long = await run(['x'.repeat(30), '.'], { maxBytes: 20 }); assert.deepEqual(long.res, { error: 'the decision is longer than 20 bytes' });
  const ok = await run(['One.', 'Two.', '.']); assert.deepEqual(ok.res, { text: 'One.\nTwo.' });
});

test('P1 the form: `decide --open-root-stop` takes the reason typed BEFORE the gate text, shows it word for word (indented), takes the generation token, records ONE person stop with the reason and the gate; the stop id the text named is the id recorded', async () => {
  const t = finished(); const n0 = eventsOf(t).length;
  const r = await decideAt(t, { 'open-root-stop': true }, [`${REASON}\n.`, 'R@g1', 'y']);
  assert.equal(r.code, 0, r.shown + r.errors);
  assert.match(r.shown, /Type what you saw in the root plan that is wrong\. It is recorded word for word \(at most 16384 bytes\)\. End it with a line holding only a dot \(\.\)\./);
  assert.match(r.shown, /Open a stop on the root plan R@g1 \(run [^)]+\)\?/);
  assert.match(r.shown, /Your reason, word for word \(\d+ bytes\):\n----- reason -----\n  The plan leaves the billing out\.\n  It also never says who owns the migration\.\n----- end -----/);
  assert.match(r.shown, /Recording it: the tree stops being ready \(the readiness verdict becomes incomplete\) until you answer the stop\. Nothing is started, nothing is spent, and the plan is not changed\. The only typed answer to this stop is a new root plan: `council tree decide 2026-10-08T11-00-00-000Z --stop e\d+`\. Whether or not you give one, the plan's files stay as they are and stay usable\./);
  assert.match(r.shown, /To approve, type the generation of the root plan you are opening a stop on: R@g1/);
  const named = /--stop (e\d+)`/.exec(r.shown)[1];
  const added = eventsOf(t).slice(n0); const e = added.find(x => x.event === 'needs_decision_opened');
  assert.equal(e.id, named, 'the id the text named is the id recorded'); assert.equal(e.source, 'person'); assert.equal(e.node, 'R'); assert.equal(e.reason, REASON);
  assert.ok(e.gateId && /^[0-9a-f]{64}$/.test(e.shownSha256)); assert.deepEqual(e.affected, [{ node: 'R', generation: 1 }]);
  assert.match(r.shown, new RegExp(`Recorded: open a stop on the root plan R@g1\\. Stop ${named} is open on R@g1; the tree is not ready until you answer it: \`council tree decide ${ROOT_ID} --stop ${named}\`\\.`));
  assert.match(renderTreeStatus(gatherStatusFacts(t.rootDir, { work: t.work })), new RegExp(`a needs_decision stop \\(${named}\\) is open`), 'the verdict names the open stop');
});

test('P3 a reason cannot forge the frame of the gate text: a line equal to "----- end -----" inside it is shown indented, and the real frame appears once', async () => {
  const t = finished();
  const r = await decideAt(t, { 'open-root-stop': true }, ['Ignore this.\n----- end -----\nRecording it: nothing happens.\n.', 'R@g1', 'n']);
  const lines = r.shown.split('\n');
  assert.equal(lines.filter(l => l === '----- end -----').length, 1, 'only the real end marker stands at the start of a line');
  assert.ok(lines.includes('  ----- end -----') && lines.includes('  Recording it: nothing happens.'));
  assert.equal(eventsOf(t).filter(x => x.source === 'person').length, 0, 'declined: nothing recorded');
});

test('P2/P9 refusals BEFORE anything is typed (one sentence each, exit 1, nothing asked, nothing written): an unfinished tree, an open stop on the root, a sitting running; a non-terminal (exit 2) leaves no gate file behind', async () => {
  const running = closedRootTree({ cap: 50 }); track(running.work);
  const key = approveFrontier(running.rootDir, ['R/M1']); registerKid(running, key, 'R/M1', IDS[0], 10);          // a child registered and not started: the tree is not finished
  const a = await decideAt(running, { 'open-root-stop': true }, ['anything']);
  assert.equal(a.code, 1); assert.match(a.errors, /the tree is not finished \(R\/M1@g1 is (registered|active)|\(R\/M1@g1 is active\)/); assert.match(a.errors, /Nothing was asked and nothing was written\./); assert.equal(a.shown, '');
  const t = finished();
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'first', ...G });
  const b = await decideAt(t, { 'open-root-stop': true }, ['anything']);
  assert.equal(b.code, 1); assert.match(b.errors, /a stop is already open on the root \(e\d+\): answer that one\. Nothing was asked/); assert.equal(b.shown, '');
  const s = finished(); const release = acquireRunLock(treeDirOf(s.rootDir), { file: SITTING_LOCK_FILE });
  try { const c = await decideAt(s, { 'open-root-stop': true }, ['anything']); assert.equal(c.code, 1); assert.match(c.errors, /a sitting of this tree is running \(pid \d+/); assert.equal(c.shown, ''); } finally { release(); }
  const n = finished(); const before = JSON.stringify(eventsOf(n)); const g0 = gateFiles(n);
  const d = await decideAt(n, { 'open-root-stop': true }, [], { tty: false });
  assert.equal(d.code, 2); assert.equal(JSON.stringify(eventsOf(n)), before); assert.equal(gateFiles(n), g0, 'no gate file');
});

test('the terminal is checked BEFORE the gate is requested for EVERY form: a refused non-terminal attempt of `--close` leaves no gate text on disk (it used to leave one, and the real form then got the next gate id)', async () => {
  const t = closedRootTree({ cap: 50 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']); registerKid(t, key, 'R/M1', IDS[0], 10);
  const g0 = gateFiles(t); const ledger0 = existsSync(join(treeDirOf(t.rootDir), 'gate-ledger.jsonl')) ? readFileSync(join(treeDirOf(t.rootDir), 'gate-ledger.jsonl'), 'utf8') : null;
  const r = await decideAt(t, { close: 'R/M1' }, [], { tty: false });
  assert.equal(r.code, 2); assert.match(r.errors, /gate answer needs a person at a terminal: stdin and stdout must both be a terminal\. Nothing was written\./);
  assert.equal(gateFiles(t), g0, 'no gate text file'); void ledger0;
});

test('P3 the typing-time scans: a key-shaped string in the reason is refused (kind and place, never the value; no gate requested); a personal-data reason is refused under hard-stop and goes on under warn with its place printed', async () => {
  const t = finished(); const g0 = gateFiles(t);
  const secret = 'postgres://admin:hunter2pass@db.prod-cluster.net/prod';
  const k = await decideAt(t, { 'open-root-stop': true }, [`The config says ${secret}\n.`]);
  assert.equal(k.code, 1); assert.match(k.errors, /the reason holds 1 credential-shaped string\(s\)/); assert.doesNotMatch(k.errors, /hunter2pass/, 'the refusal never prints the value (the scripted terminal echoes what was typed into shown; that echo is the test harness, not the verb)'); assert.equal(gateFiles(t), g0, 'no gate was requested');
  assert.equal(eventsOf(t).filter(x => x.source === 'person').length, 0);
  const hard = finished({ piiGate: 'hard-stop' });
  const h = await decideAt(hard, { 'open-root-stop': true }, ['Write to jane.doe@gmail.com about it.\n.']);
  assert.equal(h.code, 1); assert.match(h.errors, /the reason holds personal data under --pii-gate hard-stop/); assert.match(h.errors, /the reason, line 1, col \d+: /); assert.doesNotMatch(h.errors, /jane\.doe/);
  const warn = finished({ piiGate: 'warn' });
  const w = await decideAt(warn, { 'open-root-stop': true }, ['Write to jane.doe@gmail.com about it.\n.', 'R@g1', 'y']);
  assert.equal(w.code, 0, w.shown + w.errors); assert.match(w.errors, /the reason holds personal data \(the tree's mode is warn, so it goes on\)/); assert.doesNotMatch(w.errors, /jane\.doe/);
});

test('CONDITION (57 is ahead): `--open-root-stop` on an ABANDONED tree gets the abandoned sentence, nothing is typed, nothing is written', async () => {
  const t = finished(); abandonTree(t.rootDir, G, {});
  const before = JSON.stringify(eventsOf(t));
  const r = await decideAt(t, { 'open-root-stop': true }, ['anything']);
  assert.equal(r.code, 1); assert.match(r.errors, /This tree was abandoned by a person/); assert.match(r.errors, /Nothing was asked and nothing was written\./); assert.equal(r.shown, '');
  assert.equal(JSON.stringify(eventsOf(t)), before);
});

test('P6 the option: `--open-root-stop` is a BOOLEAN of `decide` only, refused beside any other form, `--stop` or `--abandon`; the real front door knows it', () => {
  assert.deepEqual(parseTreeArgs(['decide', 'rid', '--open-root-stop']), { verb: 'decide', rootArg: 'rid', flags: { 'open-root-stop': true } });
  assert.match(parseTreeArgs(['resume', 'rid', '--open-root-stop']).error ?? '', /not an option of `council tree resume`/);
  assert.match(chooseForm({ 'open-root-stop': true, close: 'R/M1' }).error ?? '', /one form per invocation/);
  assert.match(chooseForm({ 'open-root-stop': true, abandon: true }).error ?? '', /one form per invocation/);
  assert.match(chooseForm({ 'open-root-stop': true, stop: 'e3' }).error ?? '', /--obligation and --stop belong to the stop forms/);
  assert.deepEqual(chooseForm({ 'open-root-stop': true }), { form: 'open-root-stop', value: true });
  const run = args => spawnSync(process.execPath, [join(root, 'src', 'cli.js'), ...args], { encoding: 'utf8', cwd: root, timeout: 60000 });
  assert.doesNotMatch(run(['tree', 'decide', ROOT_ID, '--open-root-stop']).stderr, /not an option of this command/, 'the known-flag list names it');
  assert.match(run(['--open-root-stop']).stderr, /--open-root-stop: an option of `council tree` only, not of this command\./);
});

test('the refusal line after an approval was used (decide, check, approve share it): a reason that ends with a full stop does not print ".."; on a FINAL tree it does not say "run the command again"', () => {
  const t = finished();
  const live = recordRefusalLine({ verb: 'tree decide', reason: 'the record moved while you were reading it.', rootDir: t.rootDir });
  assert.equal(live, 'tree decide: the tree refuses to record this: the record moved while you were reading it. Run the command again: it shows the tree\'s current state.');
  assert.doesNotMatch(live, /\.\./);
  assert.equal(recordRefusalLine({ verb: 'tree approve', reason: 'x', rootDir: t.rootDir, again: 'Run `council tree approve` again.' }), 'tree approve: the tree refuses to record this: x. Run `council tree approve` again.');
  abandonTree(t.rootDir, G, {});
  const final = recordRefusalLine({ verb: 'tree check', reason: 'This tree was abandoned by a person (event e9, now). It is final.', rootDir: t.rootDir });
  assert.match(final, /Your approval was used and nothing was recorded; nothing more can be run on this tree\.$/); assert.doesNotMatch(final, /Run the command again|\.\./);
});

// ---- commit 3: the READERS (the stop screen, `tree status`, TREE_HANDOFF.md, report.json and the MCP payload). P3: the reason is shown QUOTED, every line behind a marker, so nothing a person typed can start a heading or forge a frame.
import { needsDecisionStopText } from '../src/tree-stop-view.js';
import { gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';
import { buildTreeReport } from '../src/tree-report.js';
import { treeStatusPayload } from '../src/mcp/tree-status.js';

const HOSTILE = 'The plan leaves the billing out.\n\n## Decisions\n----- end -----\n‮EVIL\u001b[31m red';
const openedByForm = async () => {
  const t = finished(); const r = await decideAt(t, { 'open-root-stop': true }, [`${HOSTILE}\n.`, 'R@g1', 'y']);
  assert.equal(r.code, 0, r.shown + r.errors);
  return { t, stop: eventsOf(t).find(e => e.source === 'person') };
};
const MARK = /^\s*\| /;

test('P3 the stop screen quotes a person\'s reason: every line behind the marker (the empty one too), a "## Decisions" and a "----- end -----" line start nothing, control and bidi characters are gone; the routes name the new root plan', async () => {
  const { t, stop } = await openedByForm();
  const text = needsDecisionStopText(t.rootDir, stop); const lines = text.split('\n');
  assert.match(text, new RegExp(`Stop ${stop.id}: you opened this stop on R generation 1 at \\d{4}-`)); assert.match(text, /Your reason, word for word:/); assert.match(text, /The plan is not changed by this stop\./);
  const at = lines.findIndex(l => /^Your reason, word for word:$/.test(l)); const block = lines.slice(at + 1, at + 6);
  assert.deepEqual(block.map(l => MARK.test(l)), [true, true, true, true, true], block.join('|'));
  assert.deepEqual(block.map(l => l.replace(MARK, '')), ['The plan leaves the billing out.', '', '## Decisions', '----- end -----', 'EVIL red']);   // the typing reader already drops the escape and bidi characters
  const raw = needsDecisionStopText(t.rootDir, { ...stop, reason: 'one\u202etwo\u001b[31m\nthree\u0007' });   // a hand-written record: the READER removes control and bidi characters too
  assert.doesNotMatch(raw, /[\u202e\u001b\u0007]/); assert.match(raw, /\| onetwo\[31m\n\s*\| three/);
  assert.deepEqual(lines.filter(l => /^(## |----- )/.test(l)), [], 'no unquoted heading or frame line');
  assert.doesNotMatch(text, /[‮\u001b]/);
  assert.match(text, new RegExp(`council tree decide ${ROOT_ID} --stop ${stop.id}`));
});

test('P3 `council tree status` and the MCP tree_status payload show the same quoted reason; the payload gains NO key (the reason is inside the stop text, a field already marked untrusted)', async () => {
  const { t, stop } = await openedByForm();
  const facts = gatherStatusFacts(t.rootDir, { work: t.work }); const shown = renderTreeStatus(facts).split('\n');
  for (const l of shown.filter(x => /## Decisions|----- end -----/.test(x))) assert.match(l, MARK, `an unquoted line in status: ${l}`);
  assert.ok(shown.some(l => /## Decisions/.test(l)), 'the reason is shown');
  const p = treeStatusPayload(facts); const s = p.openStops.find(x => x.id === stop.id);
  assert.deepEqual(Object.keys(s).sort(), ['child', 'generation', 'id', 'node', 'text']);
  assert.match(s.text, /Your reason, word for word:/); assert.ok(p.openStops.length >= 1);
});

test('P3 TREE_HANDOFF.md quotes the reason under "Open decisions": no heading of its own appears (known-bad input: a "## Decisions" line in the reason), and report.json carries no reason', async () => {
  const { t, stop } = await openedByForm();
  const md = renderTreeHandoff(gatherHandoffFacts(t.rootDir, { work: t.work })); const lines = md.split('\n');
  assert.deepEqual(lines.filter(l => /^## Decisions\s*$/.test(l) || /^----- /.test(l)), [], 'the reason started no heading and forged no frame');
  const at = lines.findIndex(l => /Your reason, word for word:/.test(l)); assert.ok(at > 0, 'the reason is listed');
  assert.ok(lines.slice(at + 1, at + 6).every(l => MARK.test(l)), lines.slice(at + 1, at + 6).join('|'));
  assert.match(lines[at - 1], new RegExp(`- ${stop.id}: needs_decision on \`R@g1\``));
  assert.equal(JSON.stringify(buildTreeReport(t.rootDir, { work: t.work })).includes('billing'), false, 'report.json holds no reason (P9/P14: no new key)');
});

// ---- P5b THE WALK, end to end through the real verbs (S8-4 + S8-9 are on release): the person opens the stop, the person answers it with a new root plan.
import { runTree } from '../src/tree-run.js';
import { deadKeys, heldKeys } from '../src/tree-transitions.js';
import { readinessOf } from '../src/tree-ready.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

test('P5b the walk: a real tree whose first child finished and passed; the person opens a stop on the root, then answers it with a new root plan: the finished child is HELD (not dead), the old root plan is set aside, the stop is answered, and the verdict names the pending root plan', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const out = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  assert.equal(out.started.length, 1, JSON.stringify(out.started));
  const t = { rootDir: r.t.rootDir, work: r.t.work };
  const o = await decideAt(t, { 'open-root-stop': true }, ['The first child is built on the wrong store.\n.', 'R@g1', 'y']);
  assert.equal(o.code, 0, o.shown + o.errors);
  const stop = eventsOf(t).find(e => e.source === 'person'); assert.ok(stop, 'the person stop is recorded');
  const a = await decideAt(t, { stop: stop.id }, ['Plan it again, offline store first.\n.', stop.id, 'y']);
  assert.equal(a.code, 0, a.shown + a.errors); assert.match(a.shown, /HELD \(1 node in 1 run: finished and passed;/); assert.match(a.shown, /Answer stop e\d+ \(person, R@g1\) with a NEW ROOT plan\?/);
  const state = stateOf(readTreeRecord(t.rootDir)); const dec = eventsOf(t).find(e => e.event === 'decision_recorded');
  assert.equal(dec.replansRoot, true); assert.equal(dec.stopId, stop.id); assert.deepEqual(dec.affected, [{ node: 'R', generation: 1 }]);
  assert.deepEqual([...heldKeys(state)], ['R/M1@g1'], 'the finished child is held for the reuse check');
  assert.ok(deadKeys(state).has('R@g1')); assert.equal(deadKeys(state).has('R/M1@g1'), false, 'and is NOT dead: the answered stop\'s own marks do not count against it');
  assert.equal(state.openStops.includes(stop.id), false, 'the stop is answered');
  const v = readinessOf(t.rootDir, { work: t.work });
  assert.deepEqual([v.reasons[0].code, v.reasons[0].scope], ['generation_pending', 'R@g1']);
});

import { plan3 } from './helpers/split-fixture.js';

test('P5 (second half) a person\'s stop is answered IN PLACE by resolving a needs-decision milestone of the root plan, with the command the gate text named (no --stop: the root has one open stop); the stop is answered and the tree is not re-planned', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  const t = { rootDir: r.t.rootDir, work: r.t.work };
  const o = await decideAt(t, { 'open-root-stop': true }, ['The billing question is unresolved.\n.', 'R@g1', 'y']);
  assert.equal(o.code, 0, o.shown + o.errors);
  assert.match(o.shown, /or, in place, a needs-decision milestone of the plan \(R@g1:M5\): `council tree decide \S+ --milestone <id>`/, 'the gate text names the in-place route and the milestone');
  const stop = eventsOf(t).find(e => e.source === 'person');
  const a = await decideAt(t, { milestone: 'R@g1:M5' }, ['Take the offline store.\n.', 'R@g1:M5', 'y']);
  assert.equal(a.code, 0, a.shown + a.errors);
  const events = eventsOf(t); const dec = events.find(e => e.event === 'decision_recorded');
  assert.equal(dec.stopId, stop.id); assert.notEqual(dec.replansRoot, true, 'in place: no new root plan');
  const state = stateOf(readTreeRecord(t.rootDir));
  assert.equal(state.openStops.includes(stop.id), false, 'the stop is answered'); assert.equal(events.some(e => e.event === 'generation_opened'), false, 'and no new generation was opened');
});

// ---- S8-8 FIX-UP (C&C 13 Oct 2026; Haiku batch 3 J1-15-1): a person's root stop must not strand a tree behind a needs_decision close that detection has not written yet.
import { PassThrough as Pipe } from 'node:stream';
import { resumeHandler } from '../src/tree-resume.js';
import { personStopPreflight } from '../src/tree-person-stop.js';

const ND = { outcome: 'not_passed', passed: false, status: 'needs_decision', share: 'revoked' };
// a finished tree whose child R/M1 ended with the Status needs_decision and whose stop was NEVER WRITTEN (the sitting died between the close and its detection)
const undetectedTree = () => {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, key, 'R/M1', IDS[0], 10, 1); syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  appendTreeEvent(t.rootDir, { event: 'node_closed', node: 'R/M1', generation: 1, runId: IDS[0], ...ND });
  return t;
};

test('FIX (1) detectStops skips a DEAD key: a needs_decision close whose plan was replaced gets no stop, and the sitting does not die on the refused append (red at the base: detectStops throws)', () => {
  const t = undetectedTree();
  // the root's own stop is written and answered with a new root plan: R@g1 is dead, and so is R/M1@g1 (it ended needs_decision: not held)
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'node_closed', affected: [{ node: 'R', generation: 1 }] });
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'again', form: 'regenerate', stopId: stop.id, replansRoot: true, affected: [{ node: 'R', generation: 1 }, { node: 'R/M1', generation: 1 }], ...G });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R', generation: 2 }] });
  const state = stateOf(readTreeRecord(t.rootDir));
  assert.ok(deadKeys(state).has('R/M1@g1'), 'the fixture: R/M1@g1 is dead');
  assert.deepEqual(detectStops(t.rootDir, {}), [], 'a dead key gets no stop, and nothing throws');
  assert.equal(readTreeRecord(t.rootDir).events.filter(e => e.event === 'needs_decision_opened' && e.node === 'R/M1').length, 0);
});

const UNDET = DONE.map(e => (e.id === 'e4c' ? closed('e4c', 'R/M1', 1, { status: 'needs_decision', outcome: 'not_passed', passed: false, share: 'revoked' }) : e));
test('FIX (2) THE TABLE: a person\'s stop waits while a live closed node ended with the Status needs_decision and has no stop written (red at the base: accepted); once the stop is written, or the node is dead, it does not wait', () => {
  assert.match(why(UNDET, personStop()) ?? '', /R\/M1@g1 ended with the Status needs_decision and its stop is not written yet: a person's stop waits until it is/);
  const written = { id: 'e60', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: runFor('R/M1', 1), source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }] };
  assert.equal(why([...UNDET, written], personStop({ id: 'e61' })), null, 'control: the stop is written');
  assert.equal(why(DONE, personStop()), null, 'control: a child that passed has nothing to write');
});

test('FIX (2) THE FORM: the preflight refuses with the verb that writes the stop (`council tree resume`), nothing is asked or written; that verb DOES write it in exactly this state (all closed, nothing active); then the person may ask', async () => {
  const t = undetectedTree();
  const pre = personStopPreflight({ rootDir: t.rootDir });
  assert.equal(pre.refusal, `R/M1@g1 ended with the Status needs_decision and its stop is not written yet: run \`council tree resume ${ROOT_ID}\` to write it, then answer that stop`);
  const g0 = gateFiles(t); const r = await decideAt(t, { 'open-root-stop': true }, ['should not be read']);
  assert.equal(r.code, 1); assert.match(r.errors, /R\/M1@g1 ended with the Status needs_decision and its stop is not written yet: run `council tree resume .+` to write it, then answer that stop\. Nothing was asked and nothing was written\./);
  assert.equal(gateFiles(t), g0); assert.equal(eventsOf(t).filter(e => e.source === 'person').length, 0);
  // the named verb, for real: nothing may be started; the sitting looks, detection writes the child's stop
  const so = new Pipe(); const se = new Pipe(); const forbidden = () => { throw new Error('nothing may be started'); };
  await resumeHandler({ rootDir: t.rootDir, rootId: ROOT_ID, work: t.work, stdout: so, stderr: se, now: () => Date.now(), deps: { startRun: forbidden, resumeRun: forbidden, startRootRun: forbidden } });
  const written = eventsOf(t).filter(e => e.event === 'needs_decision_opened');
  assert.ok(written.some(e => e.node === 'R/M1' && e.source === 'node_closed'), 'the verb wrote the missing stop: ' + JSON.stringify(written.map(e => [e.node, e.source])));
  assert.doesNotMatch(personStopPreflight({ rootDir: t.rootDir }).refusal ?? '', /its stop is not written yet/, 'and the "not written yet" refusal is gone');
});

test('FIX (2) under a standing block `council tree resume` writes nothing, so the preflight says so instead of naming it as the way', () => {
  const t = undetectedTree();
  appendTreeEvent(t.rootDir, { event: 'blocked', reason: 'root_affected', scope: 'tree', detail: 'residue' });
  const pre = personStopPreflight({ rootDir: t.rootDir });
  assert.match(pre.refusal ?? '', /^R\/M1@g1 ended with the Status needs_decision and its stop is not written yet, and the tree is blocked \(root_affected\): answer the block first \(`council tree resume .+` says how\); the next `council tree resume .+` then writes the stop, and you answer that$/);
});

test('item 7 (2b), site 2: the reason a person types for a stop on the root plan is refused when it holds a hidden character (naming the code), and the reader\'s default decision words carry the same sentence', async () => {
  const t = finished(); const before = eventsOf(t).length; const g0 = gateFiles(t);
  const r = await decideAt(t, { 'open-root-stop': true }, [`The plan${String.fromCodePoint(0xFE00)} leaves billing out.\n.`, 'R@g1', 'y']);
  assert.match(r.errors, /the reason holds an invisible character \(U\+FE00\) that you cannot see on the screen; type it again without it\. No gate was requested and nothing was written\./);
  assert.equal(r.code, 1); assert.equal(eventsOf(t).length, before, 'nothing was recorded'); assert.equal(gateFiles(t), g0, 'and no gate text was written');
  assert.equal(DECISION_WORDS.hidden('U+200B'), 'the decision holds an invisible character (U+200B) that you cannot see on the screen; type it again without it');
});
