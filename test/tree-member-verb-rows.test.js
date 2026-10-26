// 0.8.3 member verb, the END-BATCH ROWS that were deferred (C&C list in m7/CnC_M7_Lists.md; C&C order 16 Okt 2026): a REAL tree on all-mock chains ($0) where a member stops at its overseer limit, driven only through the person's
// verbs: `tree decide --continue-node/--finish-node` (decideHandler) and the sitting (`tree resume`, resumeHandler, with the product's own api resumer). Rows: (V1) --continue-node then the sitting goes on: the member is
// resumed ONCE and stops at the NEXT limit; (V2) --finish-node: the sitting exits 0 and the member closes NOT passed; (V3) a finished ROOT exits 0. What is NOT a verb: the plan a model would have written is handed in as a
// draft (test/helpers/sitting.js draftStarter), and the layered child/root chains are explicit mock configurations (a scripted objecting top judge, 1 overseer round) written into the work folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import * as api from '../src/api.js';
import { resumeHandler } from '../src/tree-resume.js';
import { apiResumer } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { registerRoot } from '../src/tree-register.js';
import { realRoot } from './helpers/real-root.js';
import { newTree, rootOpts, ROOT_ID, SPLIT_ROOT, splitRootConfig } from './helpers/tree-fixture.js';
import { pricedDebate } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { plan3 } from './helpers/split-fixture.js';
import { terminal } from './helpers/terminal.js';

const judge = (pattern, id, lab, layer) => ({ provider: 'mock', model: `mock-critic-script-${pattern}-${id}`, lab, layer });
const layered = (base, id) => { const { maxRounds, ...rest } = base; return ({ ...rest, signoff: 'unanimous', maxOverseerRounds: 1, layerRevisions: { 1: 1, 2: 1 }, estimate: { promptTokens: 1500, draftTokens: 1500, critiqueTokens: 300 },   // the larger assumed prompt priced-debate-style handoffs need (the fixture price row is 1000/1000 USD per million, so a grant sized on 500 tokens cannot cover the handoff call)
  seats: { ...base.seats, critics: [judge('o', `${id}a`, 'l1a', 1), judge('o', `${id}b`, 'l1b', 1), judge('o', `${id}c`, 'l2a', 2), judge('o', `${id}d`, 'l2b', 2), judge('x', `${id}e`, 'l3a', 3), judge('x', `${id}f`, 'l3b', 3)] } }); };
const quiet = () => { const stdout = new PassThrough(); const stderr = new PassThrough(); const buf = []; stdout.on('data', d => buf.push(String(d))); stderr.on('data', d => buf.push(String(d))); return { stdout, stderr, text: () => buf.join('') }; };
const sit = async (r, deps = {}) => { const o = quiet(); const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: o.stdout, stderr: o.stderr, deps }); return { code, text: o.text() }; };
const choose = async (r, flag, node) => { const t = terminal([]); const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { [flag]: node }, work: r.t.work, stdin: t.stdin, stdout: t.stdout, stderr: t.stderr, now: () => Date.now() }); return { code, text: t.shown() + t.errors() }; };
// the product's own resumer (src/tree-run.js apiResumer), with the exit code of each member resume written down
const coded = r => { const codes = []; return { codes, deps: { resumeRun: opts => apiResumer({ work: r.t.work })(opts).then(res => { codes.push(res.exitCode); return res; }) } }; };
const runDirOf = (r, node) => join(r.t.work, 'runs', state(r).nodes.get(`${node}@g1`).runId);
const state = r => stateOf(readTreeRecord(r.t.rootDir));
const events = (r, ...names) => readTreeRecord(r.t.rootDir).events.filter(e => names.includes(e.event));

// a tree whose children run on a layered child chain: the children's first sitting stops R/M1 and R/M3 at their overseer limit
async function stoppedTree() {
  const r = await realRoot({ childChain: 'lay-child', extraChains: { 'lay-child': layered(pricedDebate(), 'm') } });
  approvePending(r);
  const first = await sit(r, { startRun: draftStarter(r) });
  return { r, first };
}

test('V1 the positive member CLI path: --continue-node on a member that stopped at its overseer limit, then `tree resume` goes on ONCE (the member is resumed with the choice), and stops at the NEXT limit', async () => {
  const { r, first } = await stoppedTree();
  assert.match(first.text, /overseer-round limit/i, first.text);
  const stops0 = events(r, 'node_resumed').length;
  const c = await choose(r, 'continue-node', 'R/M1');
  assert.equal(c.code, 0, c.text);
  assert.equal(events(r, 'node_choice').filter(e => e.node === 'R/M1').length, 1);
  const k = coded(r);
  const second = await sit(r, k.deps);
  assert.match(second.text, /Resuming R\/M1/, second.text);
  assert.deepEqual(k.codes, [23], 'the member was resumed once and stopped again at a limit (exit 23)');
  assert.equal(events(r, 'node_resumed').length, stops0 + 1, 'the member was resumed exactly once');
  const dir = runDirOf(r, 'R/M1');
  const entries = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')).roundChoices;
  assert.equal(entries.length, 1); assert.equal(entries[0].choice, 'continue'); assert.ok(Number.isInteger(entries[0].add) && entries[0].add >= 1, 'add was filled');
  assert.equal(JSON.parse(readFileSync(join(dir, 'report-partial.json'), 'utf8')).stop.overseer_round, 2, 'R/M1 itself stopped at the NEXT overseer round (R/M3 stops too, so the sitting text alone proves nothing)');
});

test('V2 --finish-node: the member resume exits 0 (no "ended with exit code" line; the sitting then ends held by the stop the finished member opens) and the member closes NOT passed (the dispute stage and the handoff ran, the result stays "not agreed")', async () => {
  const { r } = await stoppedTree();
  const c = await choose(r, 'finish-node', 'R/M1');
  assert.equal(c.code, 0, c.text);
  const res = await sit(r);
  assert.ok(res.text.includes('your choice for its stop (finish) is applied.'), res.text);
  const m1 = state(r).nodes.get('R/M1@g1');
  assert.equal(m1.phase, 'closed', res.text);
  assert.equal(m1.outcome, 'not_passed');
  assert.equal(res.text.includes('ended with exit code'), false, 'the resume of the finished member did not end with a non-zero code: ' + res.text);
});

test('V3 a finished ROOT exits 0: the root run stopped at its overseer limit, --finish-node R, the sitting closes it not passed and its resume ends with no non-zero exit code', async () => {
  const rootCfg = layered(splitRootConfig(), 'r');
  const t = newTree({ cap: 100, childChain: 'lay-child', extraChains: { [SPLIT_ROOT]: rootCfg, 'lay-child': layered(pricedDebate(), 'm') } });
  registerRoot(t.rootDir);
  writeFileSync(join(t.work, 'plan.md'), plan3());
  const res0 = await api.run({ ...rootOpts(t) });
  assert.equal(res0.exitCode, 23, res0.outputTail);
  const r = { t };
  const c = await choose(r, 'finish-node', 'R');
  assert.equal(c.code, 0, c.text);
  const res = await sit(r);
  assert.ok(res.text.includes('your choice for its stop (finish) is applied.') && res.text.includes('The ROOT is blocked (not_passed)'), res.text);   // the sitting then ends held by the root stop the finished root opens (exit 20): the exit code of the finished run itself is the absence of "ended with exit code"
  const root = state(r).nodes.get('R@g1');
  assert.equal(root.phase, 'closed', res.text);
  assert.equal(root.outcome, 'not_passed');
  assert.equal(res.text.includes('ended with exit code'), false, res.text);
});

test('V4 no lockout from project-writable text: a hand-written run.json roundChoices entry for the member\'s stop (no node_choice behind it) does not make the stop "consumed": the plain sitting holds, --continue-node is accepted, and `tree resume` replaces the entry with the recorded choice and resumes the member ONCE', async () => {
  const { r } = await stoppedTree();
  const dir = runDirOf(r, 'R/M1');
  const stop = JSON.parse(readFileSync(join(dir, 'report-partial.json'), 'utf8')).stop;
  const id = `${stop.kind}:${stop.overseer_round}:${stop.pass}`;
  const file = join(dir, 'run.json');
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), roundChoices: [{ stop: id, choice: 'finish', kind: stop.kind, overseer_round: stop.overseer_round, add: 0 }] }));
  const k0 = coded(r);
  const held = await sit(r, k0.deps);
  assert.deepEqual(k0.codes, [], 'an entry alone starts no resume: ' + held.text);
  const c = await choose(r, 'continue-node', 'R/M1');
  assert.equal(c.code, 0, c.text);
  assert.equal(events(r, 'node_choice').filter(e => e.node === 'R/M1' && e.choice === 'continue').length, 1);
  const k = coded(r);
  await sit(r, k.deps);
  assert.deepEqual(k.codes, [23], 'the recorded choice (continue) resumed the member once');
  const entries = JSON.parse(readFileSync(file, 'utf8')).roundChoices.filter(e => e.stop === id);
  assert.deepEqual(entries.map(e => e.choice), ['continue'], 'the unbacked "finish" entry was replaced by the record\'s choice');
  // a guard, not a test seen to fail on its own (the red of V4 is the refused verb): the member really went on, to the NEXT overseer round, instead of being refused at the same stop (also exit 23)
  assert.equal(JSON.parse(readFileSync(join(dir, 'report-partial.json'), 'utf8')).stop.overseer_round, 2);
});
