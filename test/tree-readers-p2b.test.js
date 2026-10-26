// S8-6b PART 2b, the LISTING half (C&C's go on the rebased p2a branch, 13 Oct 2026; MCP-surface SHA-stop: the P9/P14 pins move again): a child a person CLOSED BEFORE IT EVER STARTED (c3b: `decide --close <child>` on a child whose input was refused, so it was never registered) is not a state.nodes row, so
// no reader listed it: the status "Nodes" section skipped it, TREE_HANDOFF.md section 2 called it "(not registered yet)" (false: it was closed) and section 3 omitted it. The readers now LIST it, from the fold's `state.closedUnstarted` through the readiness facts' own filter (src/tree-ready.js:
// not a dead key, not superseded by a registered generation): fixed fields only {node, generation, stopId, at}, never the findings. The readiness reason ("closed before it started") and the blocked-child stop are A's and unchanged.
// New exports are read through a namespace (the habit from the views-lock slip). Everything is mock and $0; every folder is removed at the end of the file.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as H from '../src/tree-handoff.js';
import { buildTreeReport, renderTreeReport } from '../src/tree-report.js';
import { TREE_STATUS_UNTRUSTED_FIELDS, treeStatusPayload } from '../src/mcp/tree-status.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { runTree } from '../src/tree-run.js';
import { decideHandler } from '../src/tree-decide.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { splitChildren } from './helpers/child-chains.js';
import { plan3 } from './helpers/split-fixture.js';
import { approvePending, eventsOf } from './helpers/sitting.js';
import { terminal } from './helpers/terminal.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const HOST = ['db', 'internal'].join('.');                      // part of the mock plan's URL (the value of the finding): it must appear on no surface

/** c3b's real flow: a dirty provider text -> the consumer R/M2 is never registered, a bundle_input stop opens -> `decide --close R/M2` closes it before it started. */
async function closedBeforeStart() {
  const sc = splitChildren(); const cfg = sc.extraChains['split-child'];
  const seat = { provider: 'mock', model: 'mock-plan-placeholder-url', maxTokens: 4000 };
  cfg.seats = { ...cfg.seats, builder: seat, reviser: seat };
  const r = await trackedRealRoot({ ...sc, plan: plan3() }); approvePending(r);
  let last; for (let i = 0; i < 6; i += 1) { last = await runTree(r.t.rootDir, { work: r.t.work }); if (last.status !== 'limit_reached') break; }
  assert.equal(last.status, 'held_by_stop');
  const io = terminal(['R/M2', 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, flags: { close: 'R/M2' }, work: r.t.work, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  const [close] = eventsOf(r).filter(e => e.event === 'node_closed_unstarted');
  return { r, close };
}
const section = (text, from, to) => text.slice(text.indexOf(from), to ? text.indexOf(to) : undefined);

test('P2B-1: a child closed before it started is LISTED on every reader - status Nodes, handoff sections 2 and 3, report.json and the MCP payload - with fixed fields only {node, generation, stopId, at}', async () => {
  const { r, close } = await closedBeforeStart();
  const w = r.t.work; const dir = r.t.rootDir;
  const want = { node: 'R/M2', generation: 1, stopId: close.stopId, at: close.at };
  const facts = gatherStatusFacts(dir, { work: w }); const payload = treeStatusPayload(facts);
  const report = buildTreeReport(dir, { work: w });
  assert.deepEqual(facts.closedUnstarted, [want]);
  assert.deepEqual(payload.closedUnstarted, [want]);
  assert.deepEqual(report.closedUnstarted, [want]);
  assert.deepEqual(JSON.parse(renderTreeReport(report)).closedUnstarted, [want]);
  for (const entry of [facts.closedUnstarted[0], payload.closedUnstarted[0], report.closedUnstarted[0]]) assert.deepEqual(Object.keys(entry).sort(), ['at', 'generation', 'node', 'stopId'], 'the entry is four fixed keys: no finding, no carrier, no value');
  const status = renderTreeStatus(facts);
  const nodes = section(status, 'Nodes', 'Waiting');
  assert.ok(nodes.includes(H.closedUnstartedLine(want)), nodes); assert.ok(!nodes.includes('(none registered)'));
  assert.equal(payload.view, status, 'the MCP view is the same text');
  const hf = H.renderTreeHandoff(H.gatherHandoffFacts(dir, { work: w }));
  const order = section(hf, '## 2.', '## 3.');
  assert.ok(order.includes('`R/M2` (closed before it started)') && !order.includes('`R/M2` (not registered yet)'), order);
  const s3 = section(hf, '## 3.', '## 4.');
  assert.ok(s3.includes(`### ${H.CLOSED_UNSTARTED_TITLE}`) && s3.includes(H.CLOSED_UNSTARTED_SENTENCE) && s3.includes(`- \`R/M2\` generation 1, closed by stop ${close.stopId} at ${close.at}`), s3);
  for (const [name, text] of [['status', status], ['handoff', hf], ['report', renderTreeReport(report)], ['payload', JSON.stringify(payload)]]) {
    assert.ok(!text.includes(HOST), `${name} does not carry the value of the finding`);
  }
  assert.ok(!hf.includes('context.md line'), 'the handoff names no finding');
  assert.ok(!report.closedUnstarted.some(c => 'findings' in c));
});

test('P2B-2: a tree with no child closed before it started lists nothing new: no section, "(none registered)" where it was, an empty key; and the key is not under an untrusted field name (it carries node names like `nodes`)', async () => {
  const r = await trackedRealRoot({ ...splitChildren(), plan: plan3() }); approvePending(r);
  const w = r.t.work; const dir = r.t.rootDir;
  const facts = gatherStatusFacts(dir, { work: w });
  assert.deepEqual(facts.closedUnstarted, []); assert.deepEqual(treeStatusPayload(facts).closedUnstarted, []); assert.deepEqual(buildTreeReport(dir, { work: w }).closedUnstarted, []);
  assert.ok(!H.renderTreeHandoff(H.gatherHandoffFacts(dir, { work: w })).includes(H.CLOSED_UNSTARTED_TITLE));
  assert.ok(!renderTreeStatus(facts).includes('closed before it started'));
  assert.ok(!TREE_STATUS_UNTRUSTED_FIELDS.includes('closedUnstarted'));
  const { closedUnstarted, ...bare } = facts;
  assert.ok(!renderTreeStatus(bare).includes('closed before it started'), 'a facts object without the key renders no line');
});

test('P2B-3 (2b-2): once a regenerate opens R/M2@g2 the child closed before it started leaves the live list, and the handoff\'s EXISTING replaced section keeps it as one entry (no run id: closed before it started); no new section, no payload key', async () => {
  const { r, close } = await closedBeforeStart();
  const w = r.t.work; const dir = r.t.rootDir;
  await runTree(dir, { work: w });                                                  // the sitting opens the blocked-child stop on the closed child (c3b)
  const [blocked] = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.source === 'blocked');
  const io = terminal(['Replace it, with the credential left out.\n.', blocked.id, 'y']); const timer = setTimeout(() => io.stdin.end(), 8000);
  assert.equal(await decideHandler({ rootDir: dir, rootId: ROOT_ID, flags: { stop: blocked.id }, work: w, stdin: io.stdin, stdout: io.stdout, stderr: io.stderr, now: () => Date.now() }).finally(() => clearTimeout(timer)), 0, io.shown() + io.errors());
  assert.equal((await runTree(dir, { work: w })).approvalWaits, true, 'the sitting after the answer waits for the person to approve the new generation');
  const opened = eventsOf(r).filter(e => e.event === 'generation_opened').at(-1);
  assert.ok(opened.nodes.some(n => n.node === 'R/M2' && n.generation === 2), 'the regenerate opened R/M2@g2');
  const facts = gatherStatusFacts(dir, { work: w });
  assert.deepEqual(facts.closedUnstarted, [], 'g1 is superseded: it leaves the live list');
  const hf = H.gatherHandoffFacts(dir, { work: w });
  assert.deepEqual(hf.replaced.filter(x => x.node === 'R/M2').map(x => [x.generation, x.runId, x.closedBeforeStart === true, x.decisionId === opened.decisionId]), [[1, null, true, true]], 'one entry, with the decision that opened the later generation');
  const text = H.renderTreeHandoff(hf);
  const replaced = section(text, '### Replaced generations', '### Held pending');
  assert.ok(replaced.includes('| R/M2 | 1 | closed before it started |'), replaced);
  assert.ok(!replaced.includes('| none') && !text.includes(`### ${H.CLOSED_UNSTARTED_TITLE}`), 'not "none", and no new section');
  assert.ok(!('replaced' in treeStatusPayload(facts)), 'the payload has no replaced key: nothing moves there');
  assert.ok(close.stopId);
});
