// D2 F2(d) (CR-2E-002: a refusal of a plan's own text opens that plan's stop AT approve, through the sitting's trio), D3 F2-2 (the session's frontier route records the refusal like `tree approve`, and opens no stop), and D2 F3's S3 (an
// approve-time refusal that is not the plan's text says it is not held against the plan). Real all-mock trees, $0. The derivation refusal comes from the record as 943906f leaves it (a split_verified written before the reference check:
// TWO hand-made lines, named), the only way a parent's bad reference can still reach approve now that verification checks it (G1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approveHandler } from '../src/tree-approve.js';
import { sessionFrontierQuote } from '../src/tree-approve-session.js';
import { findPendingFrontier } from '../src/tree-frontier.js';
import { splitSha256 } from '../src/tree-split.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { block3, plan3 } from './helpers/split-fixture.js';
import { eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

async function oldRecord() {
  const block = block3(); block.children[0].context_refs = ['No such heading'];
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3(block), verify: false });
  appendTreeEvent(r.t.rootDir, { event: 'split_verified', node: 'R', generation: 1, runId: ROOT_ID, splitSha256: splitSha256(block), children: block.children.map(c => `R/${c.milestone}`) });     // hand-made 1 (the old verification: no reference check)
  return r;
}
const approve = async r => {
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  const io = terminal([String(pending?.key ?? 'none').slice(0, 8), 'y']);
  const timer = setTimeout(() => io.stdin.end(), 8000);
  const code = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer));
  return { code, errors: io.errors() };
};
const stopsOn = (r, node) => eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked' && e.node === node);
const triggers = r => eventsOf(r).filter(e => e.event === 'blocked' && e.transition === 'derivation');

test('F2(d): `tree approve` refused by the plan\'s own text records the trigger AND opens the stop on that plan (R) at once, says so (S1a, A-DRAFT) and shows the stop; a second approve writes no second trigger', { timeout: 400_000 }, async () => {
  const r = await oldRecord();
  const a = await approve(r);
  assert.equal(a.code, 19, a.errors);
  assert.equal(triggers(r).length, 1);
  const stop = stopsOn(r, 'R').at(-1);
  assert.ok(stop && stateOf(readTreeRecord(r.t.rootDir)).openStops.includes(stop.id), 'the stop on R is open right after approve, before any sitting');
  assert.ok(stop.blockedBy.some(b => b.code === 'derivation_refused'));
  assert.match(a.errors, /This comes from the plan's own text, so approving again gives the same answer\. A stop is open for it now:/);
  assert.ok(a.errors.includes(`Stop ${stop.id}`), a.errors);
  assert.equal((await approve(r)).code, 2, 'the frontier is no longer offered while its stop stands');
  assert.equal(triggers(r).length, 1, 'no second trigger line');
});

test('F2-2: the session\'s frontier quote, refused the same way, records the same trigger (one writer) and opens no stop (no MCP route runs a sitting\'s writes)', { timeout: 400_000 }, async () => {
  const r = await oldRecord();
  const q = sessionFrontierQuote({ rootDir: r.t.rootDir, work: r.t.work });
  assert.match(String(q.refusal), /the frontier cannot be put to anyone yet/);
  assert.deepEqual(triggers(r).map(e => [e.scope, e.check]), [['R/M1@g1', 'missing_context']]);
  assert.equal(stopsOn(r, 'R').length, 0);
});

test('S3 (D2 F3): an approve-time refusal that is not the plan\'s text (the plan file edited after the panel signed) says it is not held against the plan, and opens no stop', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: plan3() });
  const file = join(r.runDir, 'deliverable.md');
  writeFileSync(file, `${readFileSync(file, 'utf8')}\nOne line added after the panel signed.\n`);
  const a = await approve(r);
  assert.equal(a.code, 19, a.errors);
  assert.match(a.errors, new RegExp(`This is not held against the plan: once it is fixed, run \`council tree approve ${ROOT_ID}\` again\\.`));
  assert.equal(stopsOn(r, 'R').length, 0);
});
