// 0.8.3 M7 apply, C2a-record fix-up (test only; asked by C&C thcmcp-6d, 18 Okt 2026): the TEXT of an approval screen is not what keeps an approval valid.
// Two screens had their wording changed in the M7 apply (the "replaced" clause of the held-node line, src/tree-stop.js / src/tree-decide-stop.js). The text is hashed when the person answers
// (`shownSha256`, the gate ledger) and is never re-rendered and compared on a resume: what an approval must satisfy on a resume is `boundSha256 === previewHash` (src/tree-transitions.js approvalValid),
// a hash of the PREVIEW PAYLOAD. So (a) an approval recorded under an older screen text still registers its children, and (b) a gate pending or answered under the older text approves nothing new:
// the verb asks again on the new text and records nothing until it is answered. Row (a) appends the two approval records by hand, as test/helpers/sitting.js approvePending does (its gateId has no ledger entry), and then drives the real loop (registerNextChild); row (b) drives the real verb (approveHandler) and the real gate (requestTreeGate, askTreeGate) on a realRoot.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { textSha256 } from '../src/gate.js';
import { TREE_GATE_KINDS, askTreeGate, requestTreeGate } from '../src/tree-gate.js';
import { approveHandler } from '../src/tree-approve.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { registerNextChild } from '../src/tree-loop.js';
import { prefixOf } from '../src/tree-stop.js';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { approvalValid } from '../src/tree-transitions.js';
import { GATE_FIELDS, ROOT_ID } from './helpers/tree-fixture.js';
import { realRoot } from './helpers/real-root.js';
import { terminal } from './helpers/terminal.js';

const T0 = Date.parse('2026-10-08T12:00:00Z');
const OLD_TEXT = 'Frontier approval, as the screen read before the M7 apply.\n\nThe held node was replaced by a later root plan.\n\nTo approve, type the first 8 characters of the frontier key: 00000000\n';
const eventsOf = r => readTreeRecord(r.t.rootDir).events;
const pendingOf = r => {
  const pending = findPendingFrontier({ rootDir: r.t.rootDir });
  assert.ok(pending, 'a frontier waits for approval');
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  return d;
};

test('(a) an approval recorded under an OLD screen text (any shownSha256) still registers its children; an approval whose boundSha256 is not the preview\'s registers none (the control: the hash that counts is the bound one)', async () => {
  const r = await realRoot();
  const d = pendingOf(r);
  const f = stateOf(readTreeRecord(r.t.rootDir)).frontiers.get(d.frontierKey);
  appendTreeEvent(r.t.rootDir, { event: 'frontier_previewed', ...d.preview, boundSha256: d.boundSha256 });
  // the CONTROL: an approval that binds another hash (a changed preview) is not valid, and the loop registers nothing from it
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', ...GATE_FIELDS, frontierKey: d.frontierKey, revision: (f?.revisions.length ?? 0) + 1, boundSha256: 'e'.repeat(64) });
  assert.equal(approvalValid(stateOf(readTreeRecord(r.t.rootDir)).frontiers.get(d.frontierKey)), false, 'an approval of another bound hash is not valid');
  const none = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.notEqual(none.kind, 'registered', JSON.stringify(none));
  assert.equal(eventsOf(r).some(e => e.event === 'node_registered' && e.node !== 'R'), false, 'no child was registered from an approval of another hash');
  // THE ROW: the approval of the preview's own hash, whose shown-text hash is an OLD screen's (the text hash of a screen that no longer renders), is valid and the loop registers the first child
  appendTreeEvent(r.t.rootDir, { event: 'frontier_approved', gateId: 'g-before-m7', shownSha256: textSha256(Buffer.from(OLD_TEXT)), actor: 'person', via: 'terminal', frontierKey: d.frontierKey, revision: (f?.revisions.length ?? 0) + 2, boundSha256: d.boundSha256 });
  const st = stateOf(readTreeRecord(r.t.rootDir));
  assert.equal(approvalValid(st.frontiers.get(d.frontierKey)), true, 'the latest approval binds the preview\'s hash: valid whatever text hash it carries');
  const reg = registerNextChild(r.t.rootDir, { work: r.t.work });
  assert.equal(reg.kind, 'registered', JSON.stringify(reg));
  assert.equal(reg.node, 'R/M1');
});

test('(b) a gate made (pending, or even answered yes) under the OLD screen text approves nothing new: `council tree approve` asks again on the current text, a "no" records nothing and spends neither gate, and a "yes" is recorded on a NEW gate whose text hash is the current text\'s', async () => {
  const r = await realRoot();
  const d = pendingOf(r);
  const prefix = prefixOf(d.frontierKey);
  // an old-text gate that was left pending, and another that the person answered yes to and that was never used
  const stale = requestTreeGate(r.t.rootDir, { kind: TREE_GATE_KINDS.frontier, text: OLD_TEXT }, { now: () => T0 });
  assert.equal(stale.ok, true, stale.message);
  const answeredText = OLD_TEXT.replace('\n\nTo approve', '\n\n(a second old screen)\n\nTo approve');   // the prompt stays the last line: the gate names what to type
  const answered = requestTreeGate(r.t.rootDir, { kind: TREE_GATE_KINDS.frontier, text: answeredText }, { now: () => T0 });
  assert.equal(answered.ok, true, answered.message);
  const yes = terminal(['00000000', 'y']);
  assert.equal(await askTreeGate(r.t.rootDir, answered.gate.id, { expectPrefix: '00000000', stdin: yes.stdin, stdout: yes.stdout, stderr: yes.stderr, now: () => T0 }), 0, yes.shown() + yes.errors());
  const ledger = () => readFileSync(join(r.t.rootDir, 'gate-ledger.jsonl'), 'utf8');
  assert.equal(/"event":"tree_frontier_approved"/.test(ledger()), false, 'the old-text answer was never spent');
  const before = eventsOf(r).length;

  // the verb asks AGAIN (it shows the current text and the prompt), and on "n" nothing is recorded and neither old gate is used
  const no = terminal([prefix, 'n']);
  const codeNo = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: no.stdin, stdout: no.stdout, stderr: no.stderr, now: () => T0 });
  assert.equal(codeNo, 1, no.shown() + no.errors());
  assert.ok(no.shown().includes('To approve, type the first 8 characters of the frontier key:'), 'it asked again: the current text and its prompt were shown');
  assert.equal(no.shown().includes('as the screen read before the M7 apply'), false, 'the old text was not what it asked about');
  assert.equal(eventsOf(r).length, before, 'nothing was recorded');
  assert.equal(/"event":"tree_frontier_approved"/.test(ledger()), false, 'and no gate was spent');

  // on "y" it is recorded on a gate of the CURRENT text, not on either old gate
  const yesNow = terminal([prefix, 'y']);
  const codeYes = await approveHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdin: yesNow.stdin, stdout: yesNow.stdout, stderr: yesNow.stderr, now: () => T0 });
  assert.equal(codeYes, 0, yesNow.shown() + yesNow.errors());
  const appr = eventsOf(r).find(e => e.event === 'frontier_approved');
  assert.ok(appr, 'the approval was recorded');
  assert.equal([stale.gate.id, answered.gate.id].includes(appr.gateId), false, 'not on an old-text gate');
  assert.equal([stale.gate.sha256, answered.gate.sha256].includes(appr.shownSha256), false, 'and not carrying an old text hash');
  assert.equal(appr.boundSha256, d.boundSha256);
});
