// BUG-C-051 (bug audit 2026-10-24, second audit of the tree files): the session channel (MCP tree_decide) took a decision text of any size. A person's typed decision (DECISION_MAX_BYTES, read while typing) and a session draft
// (sessionDraft) are both capped at DECISION_MAX_BYTES, because a decision is copied verbatim into the record and into the context.md of every consumer; the session's quote and answer were not. The refusal reuses the draft path's sentence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLedger } from '../src/gate-ledger.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { DECISION_MAX_BYTES } from '../src/tree-decide-stop.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const call = (r, args) => JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, ...args } }).content[0].text);
async function stoppedTree() {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const st = stateOf(readTreeRecord(r.t.rootDir)); const stopId = st.openStops[0]; const meta = st.stopMeta.get(stopId);
  return { r, stopId, key: `${meta.node}@g${meta.generation}` };
}
const REASON = 'the open question belongs to the next milestone; the result stands';

test('C-051: the session path refuses a decision text over the decision limit, counted in bytes, before any gate is written; exactly the limit is accepted', async () => {
  const { r, stopId, key } = await stoppedTree();
  const gatesBefore = readLedger(r.t.rootDir).lines.length;
  const over = 'x'.repeat(DECISION_MAX_BYTES + 1);
  const keep = call(r, { step: 'quote', form: 'keep', node: key, text: over, reason: REASON });
  assert.match(keep.error ?? '', new RegExp(`the text is ${DECISION_MAX_BYTES + 1} bytes; a decision holds at most ${DECISION_MAX_BYTES}`), JSON.stringify(keep).slice(0, 300));
  const regen = call(r, { step: 'quote', form: 'regenerate', planMode: 'fresh', stop: stopId, text: over, reason: REASON });
  assert.match(regen.error ?? '', /a decision holds at most/, JSON.stringify(regen).slice(0, 300));
  // two bytes a character: under the limit in characters, over it in bytes
  const wide = call(r, { step: 'quote', form: 'keep', node: key, text: 'é'.repeat(Math.floor(DECISION_MAX_BYTES / 2) + 1), reason: REASON });
  assert.match(wide.error ?? '', /a decision holds at most/, JSON.stringify(wide).slice(0, 300));
  assert.equal(readLedger(r.t.rootDir).lines.length, gatesBefore, 'no gate was written by any refusal above');
  const exact = call(r, { step: 'quote', form: 'keep', node: key, text: 'x'.repeat(DECISION_MAX_BYTES), reason: REASON });
  assert.ok(exact.gate && exact.shown, JSON.stringify(exact).slice(0, 300));
  assert.equal(readTreeRecord(r.t.rootDir).events.some(e => e.event === 'decision_recorded'), false, 'a quote decides nothing');
});
