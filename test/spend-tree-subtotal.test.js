// The spend report's per-tree subtotal (0.8.3 M6 slice S7 (d); PLAN 10.2 and M6 exit 14, the spend half): `spendReport` groups the member runs of a recursive-councils tree into `trees: [{ treeId, memberRuns, usd }]`,
// ADDITIVELY: the per-run rows and `totalUsd` are exactly what they were, and a subtotal is never added to the total again. A run counts for a tree only if the tree's own record lists it (run.json is project-writable text),
// and the root folder must be a real folder. The figure is each member's `runSpentUsd`, the same one `tree/report.json` sums. Real priced mock tree, $0 real money.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runSpentUsd, spendReport } from '../src/spend.js';
import { buildTreeReport } from '../src/tree-report.js';
import { readTreeRecord } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { mcpCalls } from './helpers/mcp-calls.js';

const PLAIN = '2026-01-01T00-00-00-000Z';
const WIDE = { days: 5000, now: Date.parse('2026-10-11T12:00:00Z') };
const sum = xs => xs.reduce((a, b) => a + b, 0);

async function pricedTree() {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  mkdirSync(join(r.t.runsDir, PLAIN)); writeFileSync(join(r.t.runsDir, PLAIN, 'report.json'), JSON.stringify({ chain: 'mock', totals: { usd: 0.5 } }));
  const members = readTreeRecord(r.t.rootDir).events.filter(e => e.event === 'node_registered').map(e => e.runId);
  return { r, members };
}

test('the tree subtotal is the sum of its members\' runSpentUsd (the figure tree/report.json sums), counts the members, and the overall total is exactly the sum of the per-run rows with or without it', async () => {
  const { r, members } = await pricedTree();
  const rep = spendReport(r.t.runsDir, WIDE);
  assert.equal(rep.trees.length, 1); const t = rep.trees[0];
  assert.deepEqual(Object.keys(t).sort(), ['memberRuns', 'treeId', 'usd'], 'ids and amounts only');
  assert.equal(t.treeId, ROOT_ID); assert.equal(t.memberRuns, members.length);
  const expected = sum(members.map(id => runSpentUsd(join(r.t.runsDir, id))));
  assert.ok(expected > 0, 'a priced tree: the members paid something, so the equality below is not 0 = 0');
  assert.equal(t.usd, expected);
  assert.equal(t.usd, buildTreeReport(r.t.rootDir, { work: r.t.work }).money.memberSpend.sumUsd, 'the same figure tree/report.json shows as memberSpend');
  assert.equal(rep.totalUsd, sum(rep.runs.map(x => x.usd)), 'the total is the sum of the rows: the subtotal is not added again');
  assert.equal(rep.totalUsd, expected + 0.5, 'the tree\'s members once, plus the plain run');
  assert.equal(rep.count, members.length + 1); assert.equal(rep.runs.length, rep.count);
});

test('a run whose run.json CLAIMS a tree that does not list it is in the total and the rows but in no subtotal; a claimed root that is a symbolic link gives no subtotal', async () => {
  const { r, members } = await pricedTree();
  const before = spendReport(r.t.runsDir, WIDE);
  const claim = '2026-02-02T00-00-00-000Z'; mkdirSync(join(r.t.runsDir, claim));
  writeFileSync(join(r.t.runsDir, claim, 'report.json'), JSON.stringify({ chain: 'mock', totals: { usd: 7 } }));
  writeFileSync(join(r.t.runsDir, claim, 'run.json'), JSON.stringify({ chain: 'mock', tree: { treeId: ROOT_ID, node: 'R/M9', generation: 1 } }));
  const link = '2026-03-03T00-00-00-000Z'; symlinkSync(join(r.t.runsDir, ROOT_ID), join(r.t.runsDir, link));
  const lied = '2026-04-04T00-00-00-000Z'; mkdirSync(join(r.t.runsDir, lied));
  writeFileSync(join(r.t.runsDir, lied, 'report.json'), JSON.stringify({ chain: 'mock', totals: { usd: 3 } }));
  writeFileSync(join(r.t.runsDir, lied, 'run.json'), JSON.stringify({ chain: 'mock', tree: { treeId: link, node: 'R', generation: 1 } }));
  // a PRICED member is linked too: before 0.8.3's link fix the link of a $0 root passed this test by accident (its double count was $0); a link to a member that paid something cannot
  const paid = members.find(id => id !== ROOT_ID && runSpentUsd(join(r.t.runsDir, id)) > 0); assert.ok(paid, 'a priced member exists');
  symlinkSync(join(r.t.runsDir, paid), join(r.t.runsDir, '2026-05-05T00-00-00-000Z'));
  const after = spendReport(r.t.runsDir, WIDE);
  assert.deepEqual(after.trees, before.trees, 'neither the claim nor the linked root nor the linked member changed any subtotal');
  assert.equal(after.trees[0].memberRuns, members.length);
  assert.equal(after.totalUsd, before.totalUsd + 7 + 3, 'both runs are still in the total, and no link adds anything');
  assert.equal(after.symbolicLinksNotCounted, 2, 'the two links are counted apart (the claimed root link and the linked member)');
});

test('the window can cut a tree: the subtotal covers the members inside it and says how many (memberRuns), while the root outside the window is simply not in it', async () => {
  const { r, members } = await pricedTree();
  const inWindow = spendReport(r.t.runsDir, { days: 1, now: Date.parse('2026-10-11T12:00:00Z') });
  const ids = inWindow.runs.map(x => x.id);
  assert.equal(ids.includes(ROOT_ID), false, 'the fixture root is dated 8 Oct: outside a one-day window');
  const memberIds = members.filter(id => ids.includes(id));
  assert.ok(memberIds.length >= 1 && memberIds.length < members.length);
  assert.equal(inWindow.trees[0].memberRuns, memberIds.length);
  assert.equal(inWindow.trees[0].usd, sum(memberIds.map(id => runSpentUsd(join(r.t.runsDir, id)))));
});

test('no tree in the folder: the report has `trees: []` and every other field is what it was; a missing runs folder still gives a usable answer', () => {
  const none = spendReport('/nonexistent-runs-folder-for-test', { days: 1 });
  assert.deepEqual(none.trees, []); assert.equal(none.totalUsd, 0);
});

test('spend_report over MCP carries the subtotal as `trees` with a plain sentence saying it is part of the total, and nothing but ids and amounts', async () => {
  const { r } = await pricedTree();
  const res = await mcpCalls(r.t.work, [{ name: 'spend_report', arguments: { days: 365 } }]);
  const out = JSON.parse(res.get(2).result.content[0].text);
  assert.equal(out.trees.length, 1); assert.deepEqual(Object.keys(out.trees[0]).sort(), ['memberRuns', 'treeId', 'usd']);
  assert.match(out.treesNote, /already counted in totalUsd/);
  assert.equal(out.totalUsd, spendReport(r.t.runsDir, { days: 365 }).totalUsd);
});
