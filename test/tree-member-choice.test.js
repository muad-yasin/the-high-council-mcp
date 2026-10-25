// The member verb, commit 1 (records + verb; gate note Member_Verb_Gate_Note.md, delta addendum, C&C rulings 15/16 Okt 2026): `council tree decide <root> --continue-node|--finish-node <node>` writes ONE `node_choice` event for a member
// stopped at its overseer limit and starts nothing. Synthetic nodes (test/helpers/tree-fixture.js), offline, $0. Consumption (commit 2) is test/tree-member-choice-consume.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TreeRefusal, appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { decideHandler } from '../src/tree-decide.js';
import { parseTreeArgs } from '../src/tree-cli.js';
import { sittingLines } from '../src/tree-resume.js';
import { memberStopContinue } from '../src/tree-redirect.js';
import { closeRefusal } from '../src/tree-close.js';
import { track } from './helpers/temp-trees.js';
import { terminal } from './helpers/terminal.js';
import { IDS, ROOT_ID, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

const dead = { pidAlive: () => false };
const STOP = { kind: 'overseer_cap', overseer_round: 7, pass: 3 };
const STOP_ID = 'overseer_cap:7:3';

/** R/M1 started (its claim's process is gone) and stopped at its overseer limit: the marker, the partial report with its stop, and a run.json. */
function stopped({ marker = true, partial = true, choices = null } = {}) {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  const dir = syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  if (marker) writeFileSync(join(dir, 'STOPPED-overseer_cap.json'), '{}');
  if (partial) writeFileSync(join(dir, 'report-partial.json'), JSON.stringify({ stop: STOP }));
  if (choices) writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: t.childChain, task: 'x', maxUsd: 100, roundChoices: choices }));
  return { t, dir };
}
const verb = (t, flags, facts = dead) => { const io = terminal([], {}); io.stdin.end(); return decideHandler({ rootDir: t.rootDir, rootId: ROOT_ID, flags, work: t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now(), facts }).then(code => ({ code, io })); };
const events = t => readTreeRecord(t.rootDir).events;
const choices = t => events(t).filter(e => e.event === 'node_choice');
const outOf = io => `${io.shown()}${io.errors()}`;

test('MC-1 the verb records ONE node_choice for a round-stopped member and starts nothing: the stop id, the node, the money and next lines; the same choice again adds no event; the other choice replaces it', async () => {
  const { t, dir } = stopped();
  const before = events(t).length; const runFiles = readdirSync(dir).sort().join();
  const a = await verb(t, { 'continue-node': 'R/M1' });
  assert.equal(a.code, 0);
  assert.equal(events(t).length, before + 1, 'exactly one event');
  assert.deepEqual(choices(t).map(e => [e.node, e.generation, e.runId, e.choice, e.stop]), [['R/M1', 1, IDS[0], 'continue', STOP_ID]]);
  assert.equal(readdirSync(dir).sort().join(), runFiles, 'nothing was started or written in the run folder');
  const printed = outOf(a.io);
  assert.match(printed, /Recorded: R\/M1@g1 will continue/); assert.match(printed, /Money: it continues under its own grant/); assert.match(printed, /--top-up R\/M1 --amount <usd>/);
  assert.match(printed, new RegExp(`council tree resume ${ROOT_ID}`));
  assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.get('R/M1@g1').phase, 'running', 'the node stays running: no new phase');
  const again = await verb(t, { 'continue-node': 'R/M1' });
  assert.equal(again.code, 0); assert.equal(choices(t).length, 1, 'the same choice twice adds no second event'); assert.match(outOf(again.io), /already has your choice/);
  const other = await verb(t, { 'finish-node': 'R/M1' });
  assert.equal(other.code, 0); assert.deepEqual(choices(t).map(e => e.choice), ['continue', 'finish']);
  assert.equal(stateOf(readTreeRecord(t.rootDir)).nodes.get('R/M1@g1').choice.choice, 'finish', 'the newest choice stands');
  assert.match(outOf(other.io), /replaces your earlier choice, continue/);
});

test('MC-2 refusals, each writes nothing: an unknown node names the waiting ones; a node that is not round-stopped; a live claim; an unreadable stop names --close; a stop whose choice was already applied', async () => {
  const unknown = stopped();
  const u = await verb(unknown.t, { 'continue-node': 'R/NOPE' });
  assert.equal(u.code, 1); assert.match(outOf(u.io), /no such node/); assert.match(outOf(u.io), /Waiting for a choice: R\/M1/); assert.equal(choices(unknown.t).length, 0);
  const notStopped = stopped({ marker: false });
  const n = await verb(notStopped.t, { 'finish-node': 'R/M1' });
  assert.equal(n.code, 1); assert.match(outOf(n.io), /not stopped at an overseer limit/); assert.equal(choices(notStopped.t).length, 0);
  const live = stopped();
  const l = await verb(live.t, { 'continue-node': 'R/M1' }, { pidAlive: () => true });
  assert.equal(l.code, 1); assert.match(outOf(l.io), /is running: pid/); assert.equal(choices(live.t).length, 0);
  const noStop = stopped({ partial: false });
  const s = await verb(noStop.t, { 'continue-node': 'R/M1' });
  assert.equal(s.code, 1); assert.match(outOf(s.io), /stop does not read/); assert.match(outOf(s.io), /--close R\/M1/); assert.equal(choices(noStop.t).length, 0);
  const done = stopped({ choices: [{ stop: STOP_ID, choice: 'finish', kind: 'overseer_cap', overseer_round: 7, add: 0 }] });
  // an entry alone (project-writable text) is not "consumed": the person's choice is accepted (V4 in tree-member-verb-rows); once the RECORD holds the same choice the entry backs, a different choice is refused
  assert.equal((await verb(done.t, { 'finish-node': 'R/M1' })).code, 0); assert.equal(choices(done.t).length, 1);
  const c = await verb(done.t, { 'continue-node': 'R/M1' });
  assert.equal(c.code, 1); assert.match(outOf(c.io), /already applied to its run/); assert.equal(choices(done.t).length, 1);
});

test('MC-3 the spelling: the old `--continue` / `--finish` under tree decide refuses and names --continue-node; a missing node is "needs a value"; both flags together are one form too many', () => {
  const old = parseTreeArgs(['decide', ROOT_ID, '--continue', 'R/M1']);
  assert.ok(old.error && /--continue: not an option of `council tree decide`/.test(old.error) && old.error.includes('--continue-node'), old.error);
  assert.ok(parseTreeArgs(['decide', ROOT_ID, '--finish', 'R/M1']).error.includes('--finish-node'));
  assert.match(parseTreeArgs(['decide', ROOT_ID, '--continue-node']).error, /needs a value/);
  const ok = parseTreeArgs(['decide', ROOT_ID, '--continue-node', 'R/M1']);
  assert.deepEqual([ok.verb, ok.rootArg, ok.flags], ['decide', ROOT_ID, { 'continue-node': 'R/M1' }]);
  const both = parseTreeArgs(['decide', ROOT_ID, '--continue-node', 'R/M1', '--finish-node', 'R/M1']);
  return import('../src/tree-decide.js').then(({ chooseForm }) => assert.match(chooseForm(both.flags).error, /one form per invocation/));
});

// every command the product PRINTS for a stopped member is the person's own: fed back through the parser it must come out as the decide / resume form, never a refusal (the side-cap-gate row 11 class)
const commandsIn = s => [...s.matchAll(/(?:`|^\s{4})(council tree [^`\n]+?)(?:`|$)/gm)].map(m => m[1].trim());
const parsesAsDecideOrResume = cmd => { const p = parseTreeArgs(cmd.split(/\s+/).slice(2)); assert.equal(p.error, undefined, `${cmd}: ${p.error}`); return p; };

test('MC-2b (review fix F7, 18 Okt 2026): the way out of a member whose stop does not read is real: closeRefusal accepts a round-stopped member with no readable report-partial.json, and the root keeps `tree decide --abandon`', () => {
  const ok = stopped({ partial: false });
  const state = stateOf(readTreeRecord(ok.t.rootDir));
  assert.equal(closeRefusal({ state, runsDir: join(ok.t.rootDir, '..'), node: 'R/M1', facts: dead, rootId: ROOT_ID }), null, 'close takes the member: nothing about its partial report is asked');
  const root = closeRefusal({ state, runsDir: join(ok.t.rootDir, '..'), node: 'R', facts: dead, rootId: ROOT_ID });
  assert.match(root.reason, /--abandon/, 'the root names --abandon instead');
});

test('MC-4 every printed command parses back: the member stop text, the sitting line and the verb\'s own lines name --continue-node / --finish-node / --close / resume and each is a valid tree command', async () => {
  const member = { treeId: ROOT_ID, node: 'R/M1', generation: 1 };
  const stopText = memberStopContinue(member, 'round_stop');
  const sitting = sittingLines({ status: 'awaiting_choice', started: [], node: 'R/M1', runId: 'r1' }, ROOT_ID).join('\n');
  const { t } = stopped(); const v = await verb(t, { 'finish-node': 'R/M1' });
  for (const [where, s] of [['round_stop text', stopText], ['sitting line', sitting], ['verb output', outOf(v.io)]]) {
    const cmds = commandsIn(s); assert.ok(cmds.length >= 2, `${where}: commands found (${cmds.length})`);
    for (const c of cmds) parsesAsDecideOrResume(c);
    assert.equal(/--continue\b(?!-)|--finish\b(?!-)/.test(s), false, `${where} never prints the direct-run spelling`);
  }
  assert.ok(commandsIn(stopText).some(c => c.includes('--continue-node R/M1')) && commandsIn(stopText).some(c => c.includes('--finish-node R/M1')));
  assert.ok(commandsIn(sitting).some(c => c.includes('--continue-node R/M1')));
});

test('MC-5 no choice verb over MCP: no file under src/mcp names the event, the writer or the flags', () => {
  const dir = new URL('../src/mcp/', import.meta.url);
  const hits = readdirSync(dir).filter(f => f.endsWith('.js') && /node_choice|chooseNode|continue-node|finish-node/.test(readFileSync(new URL(f, dir), 'utf8')));
  assert.deepEqual(hits, []);
});

test('MC-6 the record table itself refuses a node_choice that is not about a running, claimless node of its own run: a registered-only node, a wrong run id, a live claim; an unknown node', () => {
  const ev = (t, over = {}) => ({ event: 'node_choice', node: 'R/M1', generation: 1, runId: IDS[0], choice: 'continue', stop: STOP_ID, ...over });
  const refused = (t, e, facts = dead) => { try { appendTreeEvent(t.rootDir, e, { facts }); return null; } catch (err) { if (err instanceof TreeRefusal) return err.message; throw err; } };
  const reg = closedRootTree({ cap: 100 }); track(reg.work);
  registerKid(reg, approveFrontier(reg.rootDir, ['R/M1', 'R/M2']), 'R/M1', IDS[0], 10);
  assert.match(refused(reg, ev(reg)), /is registered; a choice is for a node stopped at its overseer limit/);
  const { t } = stopped();
  assert.match(refused(t, ev(t, { runId: IDS[1] })), /not the run registered/);
  assert.match(refused(t, ev(t), { pidAlive: () => true }), /is running \(pid/);
  assert.match(refused(t, ev(t, { node: 'R/ZZ' })), /not registered/);
  assert.equal(refused(t, ev(t)), null, 'the same event on the right node is accepted');
});
