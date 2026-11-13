// 0.8.4 unit 1 (C&C 09 Nov 2026, FIX, ruling (b)): a tree member whose chain turns the privacy switch on (approve_excerpts) can stop at an approval of excerpts (exit 26). The tree says so in the existing awaiting_choice state
// (like exit 25), with its own words and its own verb (`council gate answer`), never 'crashed', and never continue / finish / --prevail-node; the member is NOT resumed while the approval waits, and IS resumed once the ledger
// reads the gate as answered. A fake starter stands in for the member's process; its run folder holds a real gate. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hostname } from 'node:os';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTreeEvent } from '../src/tree-record.js';
import { runTree, apiStarter } from '../src/tree-run.js';
import { setHeldForTest } from '../src/held-roles.js';
import { submitStageAnswer } from '../src/stage-submission.js';
import { excerptSwitchForSubmit } from '../src/run-status.js';
import * as H from './held-prompts/held-084-a.js';
import { exitCodeOf, resumeHandler, sittingLines, STATUS_OF_EXIT } from '../src/tree-resume.js';
import { describePhase, phaseKindOf, WAITS_FOR_PERSON } from '../src/tree-close.js';
import { requestGate, answerGate, readGateAnswer, recordExcerptSwitchOn } from '../src/gate.js';
import { EXIT_AWAITING_EXCERPT_APPROVAL } from '../src/exit-codes.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren, externalChild } from './helpers/child-chains.js';
import { LEAF_PLAN, approvePending, draftStarter, eventsOf, phases } from './helpers/sitting.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const EX = [{ id: 'E-1', lines: null, text_sha256: 'a'.repeat(64), shown_lines: 2 }];
const dead = { pidAlive: () => false };
// the first sitting starts the child; it "stops at an approval of excerpts" (the fake starter writes a real pending gate in the member's run folder and returns 26); the member then looks as a real one would: node_started on record (a dead pid)
async function approvalMember() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const first = await runTree(r.t.rootDir, {
    work: r.t.work, maxStarts: 3,
    startRun: async args => {
      const rd = join(r.t.runsDir, args.runId); mkdirSync(rd, { recursive: true });
      writeFileSync(join(rd, 'run.json'), '{}'); writeFileSync(join(rd, 'excerpt-screen.md'), 'Excerpt 1 of 1\n1  one\n2  two\n');
      assert.equal(recordExcerptSwitchOn(rd, { source: 'chain' }).ok, true);
      assert.equal(requestGate(rd, { kind: 'excerpt_approval', textPath: 'excerpt-screen.md', excerpts: EX }).ok, true);
      return { exitCode: EXIT_AWAITING_EXCERPT_APPROVAL, outputTail: 'x' };
    },
  });
  appendTreeEvent(r.t.rootDir, { event: 'node_started', node: 'R/M1', generation: 1, runId: first.runId, pid: 999999, host: hostname() });
  return { r, first, rd: join(r.t.runsDir, first.runId) };
}
const handler = (r, resumeRun, out) => resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: { write: s => { out.push(String(s)); return true; } }, stderr: { write: s => { out.push(String(s)); return true; } }, now: () => Date.now(), facts: dead, deps: { startRun: async () => ({ exitCode: 0 }), resumeRun } });

test('EXIT MAPPING: 26 reads awaiting_choice in the tree\'s exit table, beside 23 and 25', () => {
  assert.equal(STATUS_OF_EXIT[EXIT_AWAITING_EXCERPT_APPROVAL], 'awaiting_choice');
  assert.deepEqual([23, 25].map(c => STATUS_OF_EXIT[c]), ['awaiting_choice', 'awaiting_choice']);
});

test('THE START: a member that exits 26 is awaiting_choice with the gate named (exit 20), not crashed; the sitting text offers the gate answer and the tree resume, and none of continue, finish, --prevail-node or close', async () => {
  const { r, first, rd } = await approvalMember();
  assert.equal(first.status, 'awaiting_choice', JSON.stringify(first));
  assert.deepEqual([first.exitCode, first.excerptApproval.gate, first.excerptApproval.status, exitCodeOf(first)], [26, 'g1', 'pending', 20]);
  const text = sittingLines(first, ROOT_ID).join('\n');
  assert.ok(text.includes(`R/M1 (run ${first.runId}) is stopped at an approval of excerpts of your project, and waits for YOUR answers.`), text);
  assert.ok(text.includes(`council gate answer runs/${first.runId} g1`) && text.includes(`council tree resume ${ROOT_ID}`), text);
  const own = sittingLines(first, ROOT_ID).slice(0, 2).join('\n');   // the state's own lines; the sitting's tail (this fixture's fake starter leaves the node registered, so the tail names --close) is another reader's
  assert.doesNotMatch(own, /--continue|--finish|--prevail|--close|crashed|exit code/);
  assert.ok(rd.endsWith(first.runId));
});

test('NOT BEFORE: the next sitting and `council tree resume` hold at the member while the approval waits: awaiting_choice, exit 20, no start, no resume, no node_resumed', async () => {
  const { r } = await approvalMember();
  let started = 0; let resumed = 0;
  const second = await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 3, facts: dead, startRun: async () => { started += 1; return { exitCode: 0 }; }, resumeRun: async () => { resumed += 1; return { exitCode: 0 }; } });
  assert.deepEqual([second.status, second.node, exitCodeOf(second), started, resumed], ['awaiting_choice', 'R/M1', 20, 0, 0], JSON.stringify(second));
  assert.equal(second.excerptApproval.gate, 'g1');
  const out = []; let viaHandler = 0;
  const code = await handler(r, async () => { viaHandler += 1; return { exitCode: 0 }; }, out);
  assert.equal(code, 20, out.join(''));
  assert.equal(viaHandler, 0);
  assert.match(out.join(''), /waits for YOUR answers/);
  assert.doesNotMatch(out.join(''), /Resuming R\/M1|--continue|--finish/);
  assert.equal(eventsOf(r).some(e => e.event === 'node_resumed'), false);
});

test('ONCE ANSWERED: the same member is resumed by `council tree resume` (the gate reads as answered; the member\'s own resume applies the answers), so it never stays stuck', async () => {
  const { r, first, rd } = await approvalMember();
  const g = readGateAnswer(rd, 'g1').gate;
  const done = answerGate(rd, 'g1', { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  let resumed = 0; const out = [];
  await handler(r, async () => { resumed += 1; return { exitCode: 0 }; }, out);
  assert.equal(resumed, 1, out.join(''));
  assert.match(out.join(''), /Resuming R\/M1/);
  assert.ok(first.runId);
});

test('THE OTHER READERS: describePhase and phaseKindOf (the decide sentences, a close that would end a run that waits for the person) name the member as waiting for its answers, not as interrupted', async () => {
  const { r, first } = await approvalMember();
  const node = { phase: 'running', runId: first.runId };
  assert.equal(phaseKindOf(node, r.t.runsDir), 'excerpt_approval');
  assert.equal(describePhase(node, r.t.runsDir), 'stopped at an approval of excerpts of your project, waiting for your answers');
  assert.ok(WAITS_FOR_PERSON.includes('excerpt_approval'));
});

// THE REAL TREE RUN (C&C 09 Nov 2026): the member is the real command. api.js hands its child process.env, so NODE_OPTIONS carries the preload that records the channel's words (test/helpers/held-excerpt-preload.js), as
// test/privacy-pause.test.js does for a single run. The member's chain turns the privacy switch on (approve_excerpts); its external builder pauses (exit 3); the session answers with a read; the tree resume runs the member,
// which stops at the approval (exit 26) and the tree says so; the gate is answered and the next tree resume carries the member on.
const preload = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'test', 'helpers', 'held-excerpt-preload.js');
const approvingChildren = () => ({ childChain: 'approving-child', extraChains: { 'approving-child': { ...externalChild(), approve_excerpts: true } } });
test('REAL TREE RUN: a member run by the real command stops at the approval gate (exit 26): the tree says awaiting your answers, not crashed; once the gate is answered the member goes on and records the excerpt', { timeout: 300_000 }, async () => {
  const before = process.env.NODE_OPTIONS;
  process.env.NODE_OPTIONS = `${before ? `${before} ` : ''}--import ${preload}`;
  try {
    const r = await trackedRealRoot(approvingChildren()); approvePending(r);
    mkdirSync(join(r.t.work, 'src'), { recursive: true }); writeFileSync(join(r.t.work, 'src', 'k.js'), 'one\ntwo\nthree\n');
    const first = await runTree(r.t.rootDir, { work: r.t.work, startRun: apiStarter({ work: r.t.work }) });
    assert.equal(first.status, 'waiting', JSON.stringify(first)); assert.deepEqual(first.needs, ['NEEDS-build.md']);
    const dir = join(r.t.runsDir, first.runId);
    setHeldForTest({ excerptsBlock: H.excerptsBlock, sessionReadsField: H.sessionReadsField });
    try { submitStageAnswer(dir, 'build', LEAF_PLAN, { excerptSwitch: excerptSwitchForSubmit, sessionReads: [{ path: 'src/k.js', lines: '1-2', why: 'To check the key handling.' }], workDir: r.t.work }); } finally { setHeldForTest(null); }
    const out = [];
    const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: { write: s => { out.push(String(s)); return true; } }, stderr: { write: s => { out.push(String(s)); return true; } }, now: () => Date.now(), deps: { startRun: draftStarter(r) } });
    const text = out.join('');
    assert.equal(code, 20, text);
    assert.match(text, /R\/M1 \(run .*\) is stopped at an approval of excerpts of your project, and waits for YOUR answers\./);
    const gateId = (text.match(new RegExp(`council gate answer runs/${first.runId} (g\\d+)`)) || [])[1];
    assert.ok(gateId, `the sitting names the gate to answer: ${text}`);
    assert.doesNotMatch(text, /and no result|--continue|--finish|--prevail/);
    assert.equal(existsSync(join(dir, 'excerpts.jsonl')), false, 'nothing is recorded before the person answers');
    const g = readGateAnswer(dir, gateId).gate;
    const done = answerGate(dir, gateId, { channel: 'cli', shownSha256: g.sha256, decision: 'approved', actor: 'alice', tty: true, excerptAnswers: [{ id: 'E-1', decision: 'approve' }] });
    assert.equal(done.ok, true, JSON.stringify(done));
    const out2 = [];
    const code2 = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: { write: s => { out2.push(String(s)); return true; } }, stderr: { write: s => { out2.push(String(s)); return true; } }, now: () => Date.now(), deps: { startRun: draftStarter(r) } });
    assert.ok([0, 3, 20].includes(code2) && !/and no result|approval of excerpts of your project/.test(out2.join('')), `${code2} ${out2.join('')}`);
    const rows = readFileSync(join(dir, 'excerpts.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.deepEqual(rows.map(e => [e.id, e.approval.status, e.approval.actor, e.text]), [['E-1', 'approved', 'alice', 'one\ntwo']]);
    assert.ok(Object.keys(phases(r)).includes('R/M1'));
  } finally { if (before === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = before; }
});

