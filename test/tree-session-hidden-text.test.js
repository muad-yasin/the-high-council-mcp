// BUG-C-050 (bug audit 24 Okt 2026, lane B fix): the session's decision text and reason (MCP tree_decide, quote and answer) get the check a typed decision and a session draft get: control and bidi characters are
// refused, then invisible ones (the quiet joiners and the soft hyphen stay allowed: the 14 Okt 2026 hidden-characters ruling, nothing stricter). The gate text shows a text with controls removed and the rest
// marked, while `apply` records the raw text, so a text holding them used to put bytes in the record that the approved text did not show. Hostile characters are built from code points, never pasted. All $0.
// Rows: (S1) the quote refuses a text with a control, a bidi mark or an invisible character, and a reason with one, with the draft path's own sentences, before any gate is written; (S2) the answer refuses too;
// (S3) a soft hyphen and a zero-width joiner pass; (S4) the draft path says the same words for the same text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readLedger } from '../src/gate-ledger.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { runTree } from '../src/tree-run.js';
import { treeDecideResult } from '../src/mcp/tree-decide.js';
import { draftTextRefusal } from '../src/tree-session-draft.js';
import { ROOT_ID } from './helpers/tree-fixture.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const cp = (...a) => String.fromCodePoint(...a);
const call = (r, args) => JSON.parse(treeDecideResult({ runsDir: r.t.runsDir, work: r.t.work, args: { run: ROOT_ID, ...args } }).content[0].text);
async function stoppedTree() {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, maxStarts: 1, startRun: draftStarter(r) });
  const st = stateOf(readTreeRecord(r.t.rootDir)); const stopId = st.openStops[0]; const meta = st.stopMeta.get(stopId);
  return { r, stopId, key: `${meta.node}@g${meta.generation}` };
}
const CLEAN = 'The result stands.'; const REASON = 'the open question belongs to the next milestone; the result stands';
const CONTROL_WORDS = 'holds a control or direction-changing character that a person cannot see on the screen; write it again without it';
const gatesIn = r => readLedger(r.t.rootDir).lines.filter(l => l.event === 'gate_requested').length;

test('S1 (BUG-C-050) the quote refuses a decision text or a reason holding a control, a bidi mark or an invisible character, with the draft path\'s sentences, before any gate is written', async () => {
  const { r, key } = await stoppedTree();
  const gates0 = gatesIn(r);
  const q = (text, reason) => call(r, { step: 'quote', form: 'keep', node: key, text, reason });
  for (const [what, text, reason, want] of [
    ['an escape in the text', `${CLEAN}${cp(0x1b)}[2J`, REASON, `the decision text ${CONTROL_WORDS}`],
    ['a carriage return in the text', `${CLEAN}${cp(0x0d)}overwritten`, REASON, `the decision text ${CONTROL_WORDS}`],
    ['a bidi override in the text', `${CLEAN} ${cp(0x202e)}sdrawkcab`, REASON, `the decision text ${CONTROL_WORDS}`],
    ['a bidi mark in the reason', CLEAN, `${REASON}${cp(0x200f)}`, `the reason ${CONTROL_WORDS}`],
    ['an invisible word joiner in the text', `${CLEAN}${cp(0x2060)}`, REASON, 'the decision text holds an invisible character (U+2060) that a person cannot see on the screen; write it again without it'],
    ['an invisible character in the reason', CLEAN, `${REASON}${cp(0x2800)}`, 'the reason holds an invisible character (U+2800) that a person cannot see on the screen; write it again without it'],
  ]) {
    const out = q(text, reason);
    assert.ok(typeof out.error === "string" && out.error.includes(want), `${what}: ${JSON.stringify(out).slice(0, 200)}`);
    assert.equal(out.gate, undefined, `${what}: no gate in the answer`);
  }
  assert.equal(gatesIn(r), gates0, 'no gate was written for any of them');
});

test('S2 (BUG-C-050) the answer refuses too: a text changed to hold a control after the quote is refused, and nothing is recorded', async () => {
  const { r, stopId, key } = await stoppedTree();
  const ok = call(r, { step: 'quote', form: 'keep', node: key, text: CLEAN, reason: REASON });
  assert.ok(ok.gate && ok.shown, JSON.stringify(ok).slice(0, 200));
  const bad = call(r, { step: 'answer', form: 'keep', node: key, text: `${CLEAN}${cp(0x202e)}`, reason: REASON, gate: ok.gate, shown: ok.shown });
  assert.ok(bad.error?.includes(`the decision text ${CONTROL_WORDS}`), JSON.stringify(bad).slice(0, 200));
  const badReason = call(r, { step: 'answer', form: 'keep', node: key, text: CLEAN, reason: `${REASON}${cp(0x1b)}`, gate: ok.gate, shown: ok.shown });
  assert.ok(badReason.error?.includes(`the reason ${CONTROL_WORDS}`), JSON.stringify(badReason).slice(0, 200));
  assert.deepEqual(stateOf(readTreeRecord(r.t.rootDir)).openStops, [stopId], 'nothing was decided');
});

test('S3 (BUG-C-050) nothing stricter than a typed decision: a soft hyphen and a zero-width joiner still pass, and are recorded as written', async () => {
  const { r, key } = await stoppedTree();
  const text = `The re${cp(0x00ad)}sult stands${cp(0x200d)}.`;
  const q = call(r, { step: 'quote', form: 'keep', node: key, text, reason: REASON });
  assert.ok(q.gate && q.shown, JSON.stringify(q).slice(0, 200));
  const a = call(r, { step: 'answer', form: 'keep', node: key, text, reason: REASON, gate: q.gate, shown: q.shown });
  assert.ok(a.recorded, JSON.stringify(a).slice(0, 200));
  assert.equal(readTreeRecord(r.t.rootDir).events.find(e => e.event === 'decision_recorded' && e.form === 'keep').text, text);
});

test('S4 (BUG-C-050) one copy of the sentences: the draft path says the same words for the same text', async () => {
  const { r } = await stoppedTree();
  const text = `${CLEAN}${cp(0x202e)}`;
  assert.equal(draftTextRefusal({ rootDir: r.t.rootDir, text, reason: REASON }), `the draft text ${CONTROL_WORDS}`);
  assert.equal(draftTextRefusal({ rootDir: r.t.rootDir, text: CLEAN, reason: `${REASON}${cp(0x2060)}` }), 'the reason holds an invisible character (U+2060) that a person cannot see on the screen; write it again without it');
});
