// 0.8.3 GAP A (Muad 23 Okt 2026, option B; plan Review/Build_0.8.3/m8/C_GapA_Session_Draft_Plan_2026-10-23.md; C&C PASS WITH CONDITIONS): the session writes the new decision for a stuck ROOT plan as a draft (MCP tool tree_decide, step "draft");
// `council tree decide` opens the gate on the draft IN FULL and the person approves it by typing the stop id. Offline, $0, a scripted terminal.
// Rows: (SD-1) the draft is written, the gate shows it in full, the stop id records it as the PERSON's act with fromSessionDraft and the paid recommendation is never asked; (SD-2) a newer draft written while the person reads: the approval is NOT used;
// (SD-3) a key-shaped text or reason is refused at the draft step, and a draft that gets into the record by hand is not offered at the terminal; (SD-4) a draft over the tree's size allowance: the terminal offers --allow-size and the person's raise records;
// (SD-5) saying no at the draft gate falls through to typing your own in the same run; (SD-6) the table: both origins, another text, a draft that is not the newest, a person writing a draft, a sub-plan stop; (SD-7) the draft step's refusals;
// (SD-8) the draft id, the reason and the text are inside the hashed gate text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { readLedger } from '../src/gate-ledger.js';
import { decideHandler } from '../src/tree-decide.js';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { treeStatusPayload, TREE_STATUS_UNTRUSTED_FIELDS } from '../src/mcp/tree-status.js';
import { sha256Of } from '../src/thin-contract.js';
import { closedRootTree, closedChildTree, GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';
import { driveToDepthTwoReplan } from './helpers/depth-two-replan.js';
import { rootBundle } from '../src/tree-root-replan.js';

const DRAFT = 'Plan the billing as its own sub-plan, and keep the invoices out of the first release.';
const WHY = 'the stop says the billing is missing; this names it and bounds the first release';
const open = t => { appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'person', affected: [{ node: 'R', generation: 1 }], reason: 'The plan leaves the billing out.', ...GATE_FIELDS }); return stateOf(readTreeRecord(t.rootDir)).openStops[0]; };
function setup(opts = {}) { const t = closedRootTree({ cap: 20, ...opts }); track(t.work); return { t, stopId: open(t), rootId: ROOT_ID }; }
const call = (s, args) => JSON.parse(treeDecideResult({ runsDir: s.t.runsDir, work: s.t.work, args: { run: s.rootId, reason: WHY, ...args } }).content[0].text);
const draft = (s, text = DRAFT, extra = {}) => call(s, { step: 'draft', stop: s.stopId, text, ...extra });
const NO_RECOMMEND = async () => { throw new Error('the paid recommendation must not be asked while a draft waits'); };
const decide = (s, io, flags = { fresh: true }, extra = {}) => decideHandler({ rootDir: s.t.rootDir, rootId: s.rootId, flags, work: s.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), env: {}, recommend: NO_RECOMMEND, ...extra });
const events = s => readTreeRecord(s.t.rootDir).events;

test('SD-1 the draft is written, the gate shows it in full, the typed stop id records the PERSON\'s act with fromSessionDraft, and the paid recommendation is never asked', async () => {
  const s = setup();
  const w = draft(s); assert.match(w.recorded ?? '', /Nothing is decided and nothing was spent/, JSON.stringify(w));
  assert.deepEqual(events(s).filter(e => e.event === 'decision_recorded'), [], 'writing a draft decides nothing');
  const io = terminal([s.stopId, 'y']);
  const code = await decide(s, io);
  assert.equal(code, 0, io.shown() + io.errors());
  assert.ok(io.shown().includes(DRAFT) && io.shown().includes(WHY), 'the gate shows the draft and the reason in full');
  assert.match(io.shown(), new RegExp(`This decision text was written by the session \\(draft ${w.draft}\\)\\. You approve it as written\\.`));
  const d = events(s).find(e => e.event === 'decision_recorded');
  assert.deepEqual([d.actor, d.via, d.text, d.fromSessionDraft], ['person', 'terminal', DRAFT, { draftId: w.draft }]);
});

test('SD-2 a newer draft written while the person reads: the approval is NOT used and nothing is recorded', async () => {
  const s = setup(); draft(s);
  const io = terminal([s.stopId, 'y']);
  let wrote = false;
  io.stdout.on('data', () => { if (!wrote && /Type the stop id/.test(io.shown())) { wrote = true; draft(s, 'A different plan: billing first.'); } });
  const code = await decide(s, io);
  assert.equal(code, 1, io.shown() + io.errors());
  assert.match(io.errors(), /what you were shown has changed .* approval was NOT used/);
  assert.deepEqual(events(s).filter(e => e.event === 'decision_recorded'), []);
});

test('SD-3 a key-shaped text or reason is refused at the draft step, and a draft that reached the record by hand is not offered at the terminal', async () => {
  const s = setup();
  assert.match(draft(s, `key ${'sk-' + 'A'.repeat(40)}`).error ?? '', /credential-shaped/);
  assert.match(draft(s, DRAFT, { reason: `because ${'sk-' + 'A'.repeat(40)}` }).error ?? '', /credential-shaped/);
  assert.deepEqual(events(s).filter(e => e.event === 'stop_draft_written'), [], 'nothing was written');
  const bad = `use ${'sk-' + 'B'.repeat(40)} for the billing`;
  appendTreeEvent(s.t.rootDir, { event: 'stop_draft_written', stopId: s.stopId, text: bad, reason: WHY, sha256: sha256Of(bad), actor: 'session', via: 'mcp' });
  const io = terminal(['My own plan for the billing.\n.', s.stopId, 'y']);
  const code = await decide(s, io);
  assert.equal(code, 0, io.shown() + io.errors());
  assert.match(io.errors(), /the session's draft e\d+ was not used: .*credential-shaped/);
  assert.equal(events(s).find(e => e.event === 'decision_recorded').fromSessionDraft, undefined);
});

test('SD-4 a draft over the tree\'s size allowance: the terminal offers --allow-size, and the person\'s raise records on the person\'s decision', { timeout: 600_000 }, async () => {
  const S = await driveToDepthTwoReplan({ stopBeforeReplan: true });
  const taskText = readFileSync(join(S.work, 'tasks', 'x.md'), 'utf8');
  const bytesWith = text => Object.values(rootBundle({ treeId: S.rootId, generation: 2, decisions: [{ id: 'd0', text }], taskText }).files).reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0);
  const big = 'a'.repeat(3950 - bytesWith('a') + 1);       // as test/tree-allow-size.test.js: the bundle without the earlier plan fits the 4000, the earlier plan takes it over
  const s = { t: { rootDir: S.rootDir, work: S.work, runsDir: dirname(S.rootDir) }, stopId: S.rootStop.id, rootId: S.rootId };
  const w = draft(s, big); assert.ok(w.recorded, JSON.stringify(w));
  const io1 = terminal([]);
  assert.equal(await decide(s, io1, {}), 1, io1.shown() + io1.errors());
  const m = /--allow-size (\d+)/.exec(io1.errors()); assert.ok(m, io1.errors());
  const io2 = terminal([s.stopId, 'y']);
  const code = await decide(s, io2, { 'allow-size': m[1] });
  assert.equal(code, 0, io2.shown() + io2.errors());
  const d = events(s).filter(e => e.event === 'decision_recorded').at(-1);       // the fixture already holds earlier decisions
  assert.deepEqual([d.actor, d.allowanceBytes, d.fromSessionDraft], ['person', Number(m[1]), { draftId: w.draft }]);
});

test('SD-5 not approving the draft falls through to typing your own decision in the same run (today\'s flow), the draft is not recorded', async () => {
  const s = setup(); draft(s);
  const io = terminal(['no', '.', 'My own plan for the billing.\n.', s.stopId, 'y']);
  const code = await decide(s, io);
  assert.equal(code, 0, io.shown() + io.errors());
  assert.match(io.shown(), /No draft was approved\.[\s\S]*Type your own decision\./);
  const d = events(s).find(e => e.event === 'decision_recorded');
  assert.deepEqual([d.text, d.actor, d.fromSessionDraft], ['My own plan for the billing.', 'person', undefined]);
});

test('SD-6 the table: a person cannot write a draft; a decision names the newest draft and its text byte for byte; a draft and a recommendation are not both an origin; a sub-plan stop takes no draft', () => {
  const s = setup(); const w = draft(s);
  const refused = ev => { try { appendTreeEvent(s.t.rootDir, ev); return null; } catch (e) { return e.reason ?? e.message; } };
  assert.match(refused({ event: 'stop_draft_written', stopId: s.stopId, text: 'x', reason: WHY, sha256: sha256Of('x'), actor: 'person', via: 'terminal' }) ?? '', /only the session writes a draft/);
  assert.match(refused({ event: 'stop_draft_written', stopId: s.stopId, text: 'x', reason: WHY, sha256: '0'.repeat(64), actor: 'session', via: 'mcp' }) ?? '', /not the hash of its text/);
  const base = { event: 'decision_recorded', form: 'regenerate', replansRoot: true, stopId: s.stopId, affected: [{ node: 'R', generation: 1 }], oldPlan: { form: 'fresh' }, ...GATE_FIELDS };
  assert.match(refused({ ...base, text: 'another text', fromSessionDraft: { draftId: w.draft } }) ?? '', /not the draft's text/);
  assert.match(refused({ ...base, text: DRAFT, fromSessionDraft: { draftId: 'e999' } }) ?? '', /not the newest draft/);
  assert.match(refused({ ...base, text: DRAFT, fromSessionDraft: { draftId: w.draft }, fromRecommendation: { n: 1, adviceId: 'A-1' } }) ?? '', /not both/);
  const c = closedChildTree({ cap: 20 }); track(c.work);
  const rid = [...stateOf(readTreeRecord(c.rootDir)).nodes.values()].find(n => n.node === 'R/M1').runId;
  appendTreeEvent(c.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: rid, source: 'blocked', affected: [{ node: 'R/M1', generation: 1 }], reason: 'the child needs a decision' });
  const childStop = stateOf(readTreeRecord(c.rootDir)).openStops.at(-1);
  const cs = { t: c, stopId: childStop, rootId: ROOT_ID };
  assert.match(draft(cs).error ?? '', /not a stop of the root/);
});

test('SD-7 the draft step refuses before anything is written: no stop, a stop that is not open, empty text, no reason, a text over the decision limit', () => {
  const s = setup();
  assert.match(call(s, { step: 'draft', text: DRAFT }).error ?? '', /name the open stop/);
  assert.match(draft(s, DRAFT, {}).recorded ? '' : 'x', /^$/);
  assert.match(call(s, { step: 'draft', stop: 'e999', text: DRAFT }).error ?? '', /is for an open stop/);
  assert.match(draft(s, '  ').error ?? '', /text is empty/);
  assert.match(draft(s, 'Plan the billing \u202Eas its own plan.').error ?? '', /control or direction-changing character/);       // what a typed decision is held to (terminalSafe, hiddenIn)
  assert.match(draft(s, 'Plan the billing\u200B as its own plan.').error ?? '', /invisible character/);
  assert.match(draft(s, DRAFT, { reason: 'because\u202E of it' }).error ?? '', /the reason holds a control/);
  assert.match(draft(s, DRAFT, { reason: ' ' }).error ?? '', /written reason is missing/);
  assert.match(draft(s, 'x'.repeat(16385)).error ?? '', /at most 16384/);
  assert.equal(events(s).filter(e => e.event === 'stop_draft_written').length, 1, 'only the one valid draft above was written');
});

test('SD-8 what the person read is what is hashed: the draft id, the fenced reason and the text are in the gate text, and the recorded shownSha256 is its hash', async () => {
  const s = setup(); const w = draft(s);
  const io = terminal([s.stopId, 'y']);
  assert.equal(await decide(s, io), 0, io.shown() + io.errors());
  const d = events(s).find(e => e.event === 'decision_recorded');
  const m = /gate (g\d+) \(tree_decide\): (\S+),/.exec(io.shown()); assert.ok(m, io.shown());
  const text = readFileSync(join(s.t.work, 'runs', ROOT_ID, m[2]), 'utf8');
  assert.ok(text.includes(`draft ${w.draft}`) && text.includes(WHY) && text.includes(DRAFT), 'id, reason and text are inside the hashed gate text');
  assert.equal(sha256Of(text), d.shownSha256);
});

test('SD-9 the request path: no, then what should change: recorded as the PERSON\'s act and scanned; the draft stays approvable and shows the request; the status carries it as untrusted text; a newer draft clears it; a key-shaped request is refused', async () => {
  const s = setup(); const w = draft(s);
  const REQ = 'Name the invoices too, and say who owns the billing sub-plan.';
  const io = terminal(['no', `${REQ}\n.`]);
  assert.equal(await decide(s, io), 0, io.shown() + io.errors());
  assert.match(io.shown(), /Recorded your request for the session: nothing was decided\./);
  const ask = events(s).find(e => e.event === 'stop_draft_change_asked');
  assert.deepEqual([ask.actor, ask.via, ask.text, ask.draftId, ask.stopId], ['person', 'terminal', REQ, w.draft, s.stopId]);
  assert.deepEqual(events(s).filter(e => e.event === 'decision_recorded'), [], 'a request decides nothing');
  // the draft stays approvable, and the next screen shows the request inside the text that is hashed
  const io2 = terminal([s.stopId, 'y']);
  assert.equal(await decide(s, io2), 0, io2.shown() + io2.errors());
  assert.ok(io2.shown().includes(REQ) && io2.shown().includes('this one can still be approved'), 'the screen shows the request');
  assert.equal(events(s).find(e => e.event === 'decision_recorded').fromSessionDraft.draftId, w.draft);
});

test('SD-10 the session reads the request through the existing status (no new tool); the list is untrusted text; a newer draft clears the mark; a key-shaped request is refused and nothing is recorded', async () => {
  const s = setup(); const w = draft(s);
  const bad = terminal(['no', `use ${'sk-' + 'C'.repeat(40)} please\n.`]);
  assert.equal(await decide(s, bad), 1, bad.shown() + bad.errors());
  assert.match(bad.errors(), /your request holds 1 credential-shaped/);
  assert.deepEqual(events(s).filter(e => e.event === 'stop_draft_change_asked'), []);
  const REQ = 'Shorter, please.';
  assert.equal(await decide(s, terminal(['no', `${REQ}\n.`])), 0);
  const f = gatherStatusFacts(s.t.rootDir, { work: s.t.work });
  const p = treeStatusPayload(f);
  assert.deepEqual(p.draftedStops.map(d => [d.stopId, d.draftId, d.text, d.changeAsked?.text]), [[s.stopId, w.draft, DRAFT, REQ]]);
  assert.ok(TREE_STATUS_UNTRUSTED_FIELDS.includes('draftedStops'), 'the request and the draft reach a model: untrusted');
  assert.match(renderTreeStatus(f), new RegExp(`Drafts waiting for you:\\n  stop ${s.stopId}: draft ${w.draft} .*you asked for a change: ${REQ}`));
  const w2 = draft(s, 'Short plan: billing first.');
  const p2 = treeStatusPayload(gatherStatusFacts(s.t.rootDir, { work: s.t.work }));
  assert.deepEqual(p2.draftedStops.map(d => [d.draftId, d.changeAsked]), [[w2.draft, null]], 'the newer draft stands alone: the request was answered by it');
});

test('SD-11 only a NO from the person leads to "what should change": a gate that expired before the answer ends the command with its own sentence', { timeout: 60_000 }, async () => {
  const s = setup(); draft(s);
  // the clock jumps two hours once the gate is requested (a line is in the ledger), so the answer meets an expired gate
  const late = () => (readLedger(s.t.rootDir).lines?.length ? Date.now() + 2 * 3600e3 : Date.now());
  const io = terminal(['Shorter, please.\n.']);       // a real request as the only answer: on a source that wrongly reaches the change prompt it is taken and recorded (so the row fails by its assertions); it is never read when the expired gate ends the command first
  const code = await decide(s, io, { fresh: true }, { now: late });
  assert.equal(code, 1, io.shown() + io.errors());
  assert.match(io.errors(), /gate g\d+ is expired/);
  assert.doesNotMatch(io.shown(), /No draft was approved|Type what the session should change/);
  assert.deepEqual(events(s).filter(e => /^stop_draft_change_asked$|^decision_recorded$/.test(e.event)), [], 'nothing was asked or recorded');
});

test('SD-12 a REFUSED answer (the gate record cannot be read when the approval is written) ends the command with the gate\'s own sentence: it never reaches "what should change"', { timeout: 60_000 }, async () => {
  const s = setup(); draft(s);
  // the third answer is a real request: on a source that wrongly falls through it is taken and recorded (the row then fails by its assertions); on the fixed source it is never read
  const io = terminal([s.stopId, 'y', 'Shorter, please.\n.']);
  let hit = false;
  io.stdout.on('data', () => {
    if (hit || !/Approve acting on exactly this text\?/.test(io.shown())) return;
    hit = true;       // after the stop id was typed and before the y is written (the scripted answer goes out on the next tick): the record the approval needs is damaged
    writeFileSync(join(s.t.rootDir, 'gates', `${/gate (g\d+) \(tree_decide\)/.exec(io.shown())[1]}.json`), '{');
  });
  const code = await decide(s, io);
  assert.equal(code, 1, io.shown() + io.errors());
  assert.match(io.errors(), /gate g\d+: refused \(gate_record_unreadable\)/);
  assert.doesNotMatch(io.shown(), /No draft was approved|Type what the session should change/);
  assert.deepEqual(events(s).filter(e => /^stop_draft_change_asked$|^decision_recorded$/.test(e.event)), [], 'nothing was asked or recorded');
});
