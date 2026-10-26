// 0.8.3 M7 MEMBER VERB (conflict ask), commit 2: the person answers a tree member that the conflict decider stopped for them (exit 25) with
// `council tree decide <tree> --prevail-node <node> --prevail <n>=<objection id>|neither`, and `council tree resume` applies the pick. The stop is written by hand here (report-partial.json `stop`, as cli.js writes it);
// the real stop and the whole loop are the real-verb probe's. Rows: (CV1) refusals write nothing; (CV2) the pick is ONE node_choice with picks, the same pick again adds nothing, a different pick replaces it;
// (CV4) the member replays only the conflictChoices its tree record backs; (CV5) the table refuses a malformed conflict choice. (CV3) the money fence: a run.json conflictChoices entry with no node_choice in the TREE RECORD never starts a paid resume, and `tree resume` with the recorded pick applies it (via 'tree') and resumes once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { resumeHandler } from '../src/tree-resume.js';
import { backedConflictChoices } from '../src/tree-choice.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending } from './helpers/sitting.js';
import { ROOT_ID, claim, hostnameOf } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

const GONE = { pidAlive: () => false };
const STOP = { kind: 'conflict', pass: 3, overseer_round: 1, conflicts: [{ n: 1, ids: ['O-a', 'O-b'] }] };
const events = r => readTreeRecord(r.t.rootDir).events;
const choices = r => events(r).filter(e => e.event === 'node_choice');
const runJsonOf = (r, dir) => JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));

async function conflictStoppedTree() {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() }); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: async () => ({ exitCode: 25, outputTail: 'x' }) });
  const reg = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  appendTreeEvent(r.t.rootDir, { event: 'node_started', ...claim('R/M1', reg.runId, process.pid, 1, hostnameOf()) });
  const dir = join(r.t.runsDir, reg.runId); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ chain: r.t.childChain, task: 'x', maxUsd: 10 }));
  writeFileSync(join(dir, 'STOPPED-conflict.json'), JSON.stringify({ schema: 'stopped/1', stoppedBy: 'conflict', beforeFirstCall: false, spentUsd: 0.01, resumeAfterStop: true, at: '2026-10-19T00:00:00.000Z', reason: 'the decider asked' }));
  writeFileSync(join(dir, 'report-partial.json'), JSON.stringify({ stop: STOP }));
  return { r, dir };
}
const decide = async (r, flags) => { const t = terminal([]); const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now(), facts: GONE }); return { code, text: t.shown() + t.errors() }; };
const sit = async (r, deps) => { const o = new PassThrough(); const buf = []; o.on('data', d => buf.push(String(d))); const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: o, stderr: o, facts: GONE, deps }); return { code, text: buf.join('') }; };

test('CV1 refusals write nothing: --prevail alone, --prevail-node without --prevail, a pick that is not an objection of its conflict, a conflict left unanswered, an unknown node, a member that is not at a conflict; --continue-node on a conflict member points at --prevail-node', async () => {
  const { r } = await conflictStoppedTree();
  const before = events(r).length;
  const cases = [
    [{ prevail: '1=O-a' }, /--prevail belongs to --prevail-node/],
    [{ 'prevail-node': 'R/M1' }, /--prevail-node needs --prevail/],
    [{ 'prevail-node': 'R/M1', prevail: '1=O-zzz' }, /O-zzz is not an objection of conflict 1/],
    [{ 'prevail-node': 'R/M1', prevail: '2=neither' }, /conflict 2 is not one the decider asked about/],
    [{ 'prevail-node': 'R/M9', prevail: '1=O-a' }, /no such node/],
    [{ 'prevail-node': 'R/M3', prevail: '1=O-a' }, /not stopped at a conflict|phase|registered|no such node/],
    [{ 'continue-node': 'R/M1' }, /--prevail-node R\/M1 --prevail/],
  ];
  for (const [flags, pattern] of cases) { const res = await decide(r, flags); assert.notEqual(res.code, 0, JSON.stringify(flags)); assert.match(res.text, pattern, JSON.stringify(flags) + ' -> ' + res.text); }
  assert.equal(events(r).length, before, 'no refusal wrote an event');
  assert.equal(choices(r).length, 0);
});

test('CV2 the pick is ONE node_choice (choice prevail, the picks); the same pick again adds nothing; another pick replaces it (the newest stands)', async () => {
  const { r } = await conflictStoppedTree();
  const first = await decide(r, { 'prevail-node': 'R/M1', prevail: '1=O-b' });
  assert.equal(first.code, 0, first.text);
  assert.equal(choices(r).length, 1);
  assert.deepEqual([choices(r)[0].choice, choices(r)[0].stop, choices(r)[0].picks], ['prevail', 'conflict:1:3', [{ n: 1, prevail: 'O-b' }]]);
  const again = await decide(r, { 'prevail-node': 'R/M1', prevail: '1=O-b' });
  assert.equal(again.code, 0); assert.match(again.text, /already has your choice/); assert.equal(choices(r).length, 1, 'same pick again = already, no new event');
  const other = await decide(r, { 'prevail-node': 'R/M1', prevail: 'neither' });
  assert.equal(other.code, 0, other.text); assert.equal(choices(r).length, 2);
  assert.deepEqual(stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1').choice.picks, [{ n: 1, prevail: 'neither' }], 'the newest pick stands');
});

test('CV3 money fence: a run.json conflictChoices entry alone never starts a paid resume; with the pick in the TREE RECORD, `tree resume` writes the entry (via tree) and resumes the member ONCE', async () => {
  const { r, dir } = await conflictStoppedTree();
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ ...runJsonOf(r, dir), conflictChoices: [{ pass: 3, n: 1, prevail: 'O-a', via: 'cli', at: '2026-10-19T00:00:00.000Z' }] }));
  let calls = 0;
  const deps = { resumeRun: async () => { calls++; return { exitCode: 0 }; } };
  const held = await sit(r, deps);
  assert.equal(calls, 0, 'no paid resume from a run.json entry alone: ' + held.text);
  assert.match(held.text, /waits for YOUR pick/);
  assert.match(held.text, /--prevail-node R\/M1 --prevail/);
  const rec = await decide(r, { 'prevail-node': 'R/M1', prevail: '1=O-b' });
  assert.equal(rec.code, 0, rec.text);
  const second = await sit(r, deps);
  assert.equal(calls, 1, 'resumed once: ' + second.text);
  const entries = runJsonOf(r, dir).conflictChoices;
  assert.deepEqual(entries.filter(e => e.pass === 3).map(e => [e.n, e.prevail, e.via]), [[1, 'O-b', 'tree']], 'the tree replaced the hand-written entry with its own record\'s pick');
});

test('CV4 a member applies only the conflictChoices its TREE RECORD backs: an entry for another pass, a pick the person did not make, or a pick the newest choice replaced is dropped; an older stop\'s backed pick is kept', async () => {
  const { r } = await conflictStoppedTree();
  const reg = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  const give = (stop, picks) => appendTreeEvent(r.t.rootDir, { event: 'node_choice', node: 'R/M1', generation: 1, runId: reg.runId, choice: 'prevail', stop, picks }, { facts: GONE });
  give('conflict:1:3', [{ n: 1, prevail: 'O-a' }]); give('conflict:1:3', [{ n: 1, prevail: 'O-b' }]); give('conflict:2:6', [{ n: 1, prevail: 'neither' }]);   // pass 3: O-a then replaced by O-b; a later stop, pass 6
  const entries = [{ pass: 3, n: 1, prevail: 'O-b', via: 'tree' }, { pass: 3, n: 1, prevail: 'O-a', via: 'tree' }, { pass: 7, n: 1, prevail: 'O-x', via: 'tree' }, { pass: 6, n: 1, prevail: 'neither', via: 'tree' }, { pass: 6, n: 2, prevail: 'neither', via: 'tree' }];
  assert.deepEqual(backedConflictChoices(r.t.rootDir, { node: 'R/M1', generation: 1 }, entries).map(e => [e.pass, e.n, e.prevail]), [[3, 1, 'O-b'], [6, 1, 'neither']]);
  assert.deepEqual(backedConflictChoices(r.t.rootDir + '-nowhere', { node: 'R/M1', generation: 1 }, entries), [], 'a record that does not read backs nothing');
});

test('CV5 the record table refuses a malformed conflict choice: prevail without picks, a continue that carries picks, a continue that names a conflict stop', async () => {
  const { r } = await conflictStoppedTree();
  const reg = stateOf(readTreeRecord(r.t.rootDir)).nodes.get('R/M1@g1');
  const bad = over => () => appendTreeEvent(r.t.rootDir, { event: 'node_choice', node: 'R/M1', generation: 1, runId: reg.runId, choice: 'prevail', stop: 'conflict:1:3', picks: [{ n: 1, prevail: 'O-a' }], ...over }, { facts: GONE });
  assert.throws(bad({ picks: undefined }), /conflict choice names a conflict stop|picks/);
  assert.throws(bad({ choice: 'continue' }), /only a conflict choice carries picks/);
  assert.throws(bad({ picks: undefined, choice: 'continue' }), /only a conflict choice carries picks/);
  assert.throws(bad({ stop: 'overseer_cap:1:3' }), /conflict choice names a conflict stop/);
  assert.equal(choices(r).length, 0);
});
