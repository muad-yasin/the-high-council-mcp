// 0.8.3 M6 S2: `council tree check` asks the person through its own gate kind, `tree_check`, which spends the ledger event `tree_checked` (the third tree use event after `tree_frontier_approved` and `tree_decided`).
// This file pins the kind's three edges: `council gate answer` on such a gate refuses a bare y and names `council tree check`; an approval is spent once, as `tree_checked`; and it is not another kind's approval.
// All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { answerGate, readGateAnswer, USE_EVENTS } from '../src/gate.js';
import { EVENTS } from '../src/gate-ledger.js';
import { TREE_VERB_OF, gateCommand } from '../src/gate-cli.js';
import { TREE_VERBS } from '../src/tree-cli.js';
import { TREE_GATE_KINDS, USE_EVENT_OF, askTreeGate, recordTreeUse, requestTreeGate, treeApproval } from '../src/tree-gate.js';
import { newTree } from './helpers/tree-fixture.js';
import { terminal } from './helpers/terminal.js';

const T0 = Date.parse('2026-10-08T12:00:00Z');
const TEXT = 'Run the checks of R/M1 once (sha256 aaaa).\n\nTo approve, type the node path: R/M1\n';
const ledgerOf = t => readFileSync(join(t.rootDir, 'gate-ledger.jsonl'), 'utf8');
const rootOf = t => `runs/${t.rootDir.split('/').pop()}`;   // `council gate` takes the run FOLDER relative to the working folder
const checkGate = t => { const r = requestTreeGate(t.rootDir, { kind: TREE_GATE_KINDS.check, text: TEXT }, { now: () => T0 }); assert.equal(r.ok, true, r.message); return r.gate; };
const approve = (t, g) => assert.equal(answerGate(t.rootDir, g.id, { shownSha256: g.sha256, decision: 'approved', channel: 'cli', tty: true }, { now: () => T0 }).ok, true);

test('the kind exists and its use event is on both closed lists, and the three kinds spend three different events', () => {
  assert.equal(TREE_GATE_KINDS.check, 'tree_check');
  assert.equal(USE_EVENT_OF.tree_check, 'tree_checked');
  assert.ok(USE_EVENTS.includes('tree_checked') && EVENTS.includes('tree_checked'));
  assert.equal(new Set(Object.values(USE_EVENT_OF)).size, Object.keys(TREE_GATE_KINDS).length, 'one use event per tree gate kind');
  for (const e of Object.values(USE_EVENT_OF)) assert.ok(USE_EVENTS.includes(e) && EVENTS.includes(e), `${e} is on both lists`);
});

test('`council gate answer` names a verb for EVERY tree gate kind, and each verb is a `council tree` verb (no fallback: a fourth kind cannot name the wrong one)', () => {
  for (const kind of Object.values(TREE_GATE_KINDS)) { assert.ok(TREE_VERB_OF[kind], `${kind} has a verb`); assert.ok(Object.hasOwn(TREE_VERBS, TREE_VERB_OF[kind]), `${TREE_VERB_OF[kind]} is a tree verb`); }
  assert.deepEqual(Object.keys(TREE_VERB_OF).sort(), Object.values(TREE_GATE_KINDS).sort(), 'and no entry names a kind that does not exist');
});

test('`council gate answer` on a tree_check gate answered "y" writes nothing, names `council tree check`, and leaves the gate pending; declining through it still works', async () => {
  const t = newTree({ cap: 10 });
  const gate = checkGate(t);
  const before = ledgerOf(t);
  const io = terminal(['y']);
  assert.equal(await gateCommand(['answer', rootOf(t), gate.id], { work: t.work, ...io, now: () => T0 }), 1);
  assert.match(io.errors(), /is a tree_check gate: it is approved only by `council tree check /);
  assert.equal(io.typed(), 0, 'no prompt was shown');
  assert.equal(ledgerOf(t), before); assert.equal(readGateAnswer(t.rootDir, gate.id, { now: () => T0 }).status, 'pending');
  const io2 = terminal(['y']);
  assert.equal(await gateCommand(['answer', rootOf(t), gate.id, '--decline'], { work: t.work, ...io2, now: () => T0 }), 0, io2.errors());
  assert.equal(readGateAnswer(t.rootDir, gate.id, { now: () => T0 }).status, 'declined');
});

test('a tree_check approval is spent ONCE as `tree_checked`, and it is not a frontier or a decide approval (nor theirs a check approval)', () => {
  const t = newTree({ cap: 10 });
  const gate = checkGate(t); approve(t, gate);
  assert.equal(treeApproval(t.rootDir, gate.id, { kind: TREE_GATE_KINDS.check, now: () => T0 }).approved, true);
  assert.match(treeApproval(t.rootDir, gate.id, { kind: TREE_GATE_KINDS.frontier, now: () => T0 }).reason, /is a tree_check gate, not tree_frontier/);
  const wrong = recordTreeUse(t.rootDir, gate.id, 'tree_decide', {}, { now: () => T0 });
  assert.deepEqual([wrong.ok, wrong.code], [false, 'not_a_tree_approval']);
  assert.equal(/"event":"tree_(checked|decided|frontier_approved)"/.test(ledgerOf(t)), false, 'the wrong kind wrote no use line');
  assert.equal(recordTreeUse(t.rootDir, gate.id, 'tree_check', { node: 'R/M1' }, { now: () => T0 + 1000 }).ok, true);
  assert.equal((ledgerOf(t).match(/"event":"tree_checked"/g) || []).length, 1);
  const again = recordTreeUse(t.rootDir, gate.id, 'tree_check', {}, { now: () => T0 + 2000 });
  assert.equal(again.ok, false, 'a second use is refused');
  assert.equal((ledgerOf(t).match(/"event":"tree_checked"/g) || []).length, 1);
  // the other two kinds' approvals are not check approvals
  const d = requestTreeGate(t.rootDir, { kind: TREE_GATE_KINDS.decide, text: 'Raise the run limit from 12 to 13.\n\nTo approve, type the new value: 13\n' }, { now: () => T0 }); approve(t, d.gate);
  assert.match(treeApproval(t.rootDir, d.gate.id, { kind: TREE_GATE_KINDS.check, now: () => T0 }).reason, /is a tree_decide gate, not tree_check/);
  assert.equal(recordTreeUse(t.rootDir, d.gate.id, 'tree_check', {}, { now: () => T0 }).ok, false);
});

test('what the person is told approving DOES is per kind: a tree_check approval "records the result of an integration check; it starts no run and spends nothing"; the other tree kinds keep their line (a frontier approval does let child runs start and spend)', async () => {
  const t = newTree({ cap: 10 });
  const shownFor = async (kind, text, expectPrefix) => {
    const g = requestTreeGate(t.rootDir, { kind, text }, { now: () => T0 }); assert.equal(g.ok, true, g.message);
    const io = terminal([expectPrefix, 'y']);
    assert.equal(await askTreeGate(t.rootDir, g.gate.id, { expectPrefix, typedLabel: 'the id', ...io, now: () => T0 }), 0, io.errors());
    return io.shown();
  };
  const check = await shownFor(TREE_GATE_KINDS.check, TEXT, 'R/M1');
  assert.ok(check.includes('Approving records the result of an integration check; it starts no run and spends nothing.'));
  assert.equal(/frontier approval|child runs start|spend, up to/.test(check), false, 'and not the frontier sentence');
  const decide = await shownFor(TREE_GATE_KINDS.decide, 'Raise the run limit from 12 to 13.\n\nTo approve, type the new value: 13\n', '13');
  assert.ok(decide.includes('approving records your decision on exactly this text, once; the tree then acts on it (a frontier approval lets the runs it lists start, and spend, up to the figures shown)'), 'the other kinds\' line is untouched');
  // S8-5 (old: "... lets child runs start, and spend, up to the figures shown"): the same default line serves a ROOT replacement, which starts a new ROOT run, not a child: both sentences are pinned
  const frontier = await shownFor(TREE_GATE_KINDS.frontier, 'Start a NEW ROOT run (R@g2)?\n\nTo approve, type the first 8 characters of the frontier key: abcd1234\n', 'abcd1234');
  assert.ok(frontier.includes('a frontier approval lets the runs it lists start, and spend, up to the figures shown'));
  assert.equal(/lets child runs start/.test(frontier + decide), false, 'the old sentence is gone from both');
});
