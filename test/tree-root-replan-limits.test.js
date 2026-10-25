// D2 F8 (CR-2D-004, Sol S3's sequence, real verbs throughout): a root re-plan whose approval no longer matches ONLY because a limit was raised after it waits for approval again (check limits_changed, a reopen check), instead of
// a refusal written once that no verb answers ("Nothing waits for your approval"). The new approval binds the new limits and the next sitting registers R@g2. All-mock, $0; the plans are drafts handed to each run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { runTree } from '../src/tree-run.js';
import { resumeHandler } from '../src/tree-resume.js';
import { approveHandler } from '../src/tree-approve.js';
import { decideHandler } from '../src/tree-decide.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { DEFAULT_LIMITS, readTreeRecord, stateOf } from '../src/tree-record.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { draftStarter, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const approve = async r => {
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const io = terminal([String(pending?.key ?? 'none').slice(0, 8), 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: io.shown() + io.errors(), pending };
};
const decide = async (r, flags, answers) => {
  const io = terminal(answers); const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, text: io.shown() + io.errors() };
};
const resume = async (r, start) => {
  const out = new PassThrough(); const err = new PassThrough(); const buf = []; out.on('data', d => buf.push(String(d))); err.on('data', d => buf.push(String(d)));
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: out, stderr: err, deps: { startRun: start } });
  return { code, text: buf.join('') };
};

test('T8 (F8, CR-2D-004): a limit raised after the root re-plan was approved -> the sitting refuses limits_changed and the root frontier waits for approval again; `tree approve` offers it, and the next sitting registers R@g2', { timeout: 900_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: { ...DEFAULT_LIMITS, maxChildrenPerSplit: 2 } });     // block3 has three children: R/M3 is refused for width in the first preview
  const start = draftStarter(r);
  let a = await approve(r); assert.equal(a.code, 0, a.text);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 1 });
  appendFileSync(join(r.runDir, 'deliverable.md'), '\nA late edit.\n');                                           // the finished root's plan no longer reads as signed: a stop on R
  await runTree(r.t.rootDir, { work: r.t.work, startRun: start, maxStarts: 0 });
  const rootStop = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.node === 'R').at(-1);
  assert.ok(rootStop, JSON.stringify(eventsOf(r).map(e => e.event)));
  const d = await decide(r, { stop: rootStop.id, fresh: true }, ['Plan it again.\n.', rootStop.id, 'y']); assert.equal(d.code, 0, d.text);     // a fresh root re-plan (--fresh: the edited R@g1 plan no longer reads as a finished plan): R@g2 is opened
  a = await approve(r); assert.equal(a.pending?.kind, 'root_replan', `the frontier offered is the root re-plan: ${JSON.stringify(a.pending)}`); assert.equal(a.code, 0, `the root frontier is approved: ${a.text}`);
  const raise = await decide(r, { 'max-children': '3' }, ['3', 'y']); assert.equal(raise.code, 0, raise.text);
  const first = await resume(r, start);
  assert.match(first.text, /limits_changed/, first.text);
  assert.ok(first.text.includes('the decision, the task bytes or a limit changed since the approval, so what would be registered is not what was approved; run `council tree approve` again'), `the refusal's words (Fable chunk 02 G-01): ${first.text}`);
  assert.ok(eventsOf(r).some(e => e.event === 'blocked' && e.check === 'limits_changed' && e.scope === 'R@g2' && e.frontierKey), 'the refusal carries its frontier: a reopen check');
  a = await approve(r); assert.equal(a.pending?.kind, 'root_replan', `the frontier offered again is the root re-plan: ${JSON.stringify(a.pending)}`); assert.equal(a.code, 0, `the root frontier waits for approval again: ${a.text}`);
  await resume(r, start);
  assert.equal(stateOf(readTreeRecord(r.t.rootDir)).nodes.has('R@g2'), true, 'the new approval binds the new limits and R@g2 registers');
});
