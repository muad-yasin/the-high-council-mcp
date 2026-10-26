// BUG-C-045 (bug audit 24 Okt 2026, lane B fix): the session's deferred reason is its own text. `council tree status` prints it to a terminal and TREE_HANDOFF.md carries it as a list item, so
// control and bidi characters must not reach either, and a newline in it must not start a heading or a second row. Hostile characters are built from code points, never pasted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';
import { gatherStatusFacts, renderTreeStatus } from '../src/tree-status.js';
import { gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';

const cp = (...a) => String.fromCodePoint(...a);
const call = (r, args) => JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, ...args } }).content[0].text);
// controls other than newline and tab, DEL, C1, and the bidi embeddings, overrides, isolates and marks: the set terminalSafe removes
const UNSAFE_AFTER_NEWLINE_AND_TAB = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/;
const HOSTILE = `${cp(0x1b)}[2J${cp(0x1b)}[1;1H all clear${cp(0x0d)}${cp(0x202e)}reversed${cp(0x202c)}\t\n## Injected by the reason\n- stop e999: fake row\nreal words stay`;

async function deferredTree(reason) {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const stopId = stateOf(readTreeRecord(r.t.rootDir)).openStops[0];
  const ok = call(r, { step: 'defer', stop: stopId, conditions: ['plan_unclear'], reason });
  assert.ok(ok.recorded, JSON.stringify(ok));
  return { r, stopId };
}

test('C-045: a deferred reason with escape, bidi, carriage-return and heading text reaches `tree status` and TREE_HANDOFF.md as ONE safe line', async () => {
  const { r, stopId } = await deferredTree(HOSTILE);
  // the record keeps the session's text exactly as written (the fix is at the readers)
  assert.equal(readTreeRecord(r.t.rootDir).events.find(e => e.event === 'stop_deferred').reason, HOSTILE.trim());
  const status = renderTreeStatus(gatherStatusFacts(r.t.rootDir, { work: r.t.work }));
  const handoff = renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work }));
  for (const [name, text, rowStart] of [['status', status, `  stop ${stopId}: the session handed it to you`], ['handoff', handoff, `- stop ${stopId}: the session handed it to you`]]) {
    const lines = text.split('\n'); const at = lines.findIndex(l => l.startsWith(rowStart));
    assert.ok(at >= 0, `${name}: the deferred row is there`);
    const row = lines[at];
    assert.ok(!UNSAFE_AFTER_NEWLINE_AND_TAB.test(row), `${name}: no control or bidi character in the row`);
    assert.ok(!row.includes('\t'), `${name}: no tab in the row`);
    assert.match(row, /its reason: .*all clear.*reversed.*## Injected by the reason.*real words stay$/, `${name}: the whole reason is on this ONE line: ${JSON.stringify(row)}`);
    assert.ok(!lines.some(l => l.startsWith('## Injected')), `${name}: no line of the reason starts a heading`);
    assert.ok(!lines.some(l => l.startsWith('- stop e999') || l.startsWith('  stop e999')), `${name}: no line of the reason makes a second row`);
    assert.ok(!UNSAFE_AFTER_NEWLINE_AND_TAB.test(text.slice(text.indexOf(rowStart))), `${name}: nothing after the row carries one either`);
  }
});

test('C-045: a plain reason reads exactly as before', async () => {
  const plain = 'the open question belongs to the next milestone; the result stands';
  const { r, stopId } = await deferredTree(plain);
  assert.match(renderTreeStatus(gatherStatusFacts(r.t.rootDir, { work: r.t.work })), new RegExp(`Stops the session handed to you:\\n  stop ${stopId}: the session handed it to you \\(plan_unclear\\); its reason: ${plain}\\n`));
  assert.ok(renderTreeHandoff(gatherHandoffFacts(r.t.rootDir, { work: r.t.work })).includes(`- stop ${stopId}: the session handed it to you (plan_unclear); its reason: ${plain}\n`));
});
