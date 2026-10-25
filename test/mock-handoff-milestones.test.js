// 0.8.3 M6: the named mock handoff model `mock-handoff-split-milestones` (PLAN M6 exit 1 second half and exit 2 end to end need a real tree whose members carry a clean milestone lint AND a split block; no earlier mock writes both).
// It writes a Status, a `## Milestones` section discharging every criterion it was shown, and the plan's split fence when the system prompt asks for the milestone format; a prompt that does not ask is answered exactly as
// `mock-handoff-split` does. It costs what mock-priced costs (same price row, same fixed usage), so swapping a fixture chain's handoff seat to it moves no figure. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { call } from '../src/providers.js';
import { readRunJson } from '../src/run-files.js';
import { expansionCheck } from '../src/tree-expansion.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { needsDecisionChildren, splitMilestoneChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';
import { approvePending, draftStarter, eventsOf } from './helpers/sitting.js';
import { runTree } from '../src/tree-run.js';
import { readinessOf } from '../src/tree-ready.js';
import { providerEligibility } from '../src/tree-loop.js';
import { readTreeRecord, stateOf } from '../src/tree-record.js';

const SYSTEM = 'You write the handoff file for a builder.';
const FENCE = '```the-high-council:tree-split\n{"x": 1}\n```';
const ask = (model, system, user) => call('mock', { model, system, messages: [{ role: 'user', content: user }], maxTokens: 2000 });

test('a real root on mock-handoff-split-milestones: its report.json carries a clean milestone lint with Status ready_for_build, its HANDOFF.md reproduces the split block (PLAN 5.5 items 1-3 hold), and the root is split-verified', async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const rep = readRunJson(r.runDir, 'report.json');
  assert.ok(rep.handoff_milestones, 'a chain with handoff_contract.milestones records the lint');
  assert.deepEqual([rep.handoff_milestones.status, rep.handoff_milestones.findings], ['ready_for_build', []]);
  assert.equal(expansionCheck({ runDir: r.runDir, work: r.t.work, upTo: 3 }).refusal, null, 'the handoff reproduced the block: items 1-3 hold');
  assert.ok(r.split, 'and the root\'s split was verified');
});

test('the model writes both when asked and nothing else when not: Status + Milestones (every criterion named) + the fence; a prompt without "## Milestones" gets mock-handoff-split\'s text byte for byte; both cost the fixed mock-priced usage', async () => {
  const user = `The plan:\nC1. one\nC2. two\nC3. three\n\n${FENCE}\n`;
  const asked = await ask('mock-handoff-split-milestones', `${SYSTEM}\n## Milestones\nWrite them.`, user);
  assert.match(asked.text, /^Status: ready_for_build\n/); assert.match(asked.text, /## Milestones\n### M0 - walking skeleton[^]*- check: C1, C2, C3 \|/); assert.ok(asked.text.includes(`## The split\n\n${FENCE}\n`), 'the fence, byte for byte');
  const plain = await ask('mock-handoff-split-milestones', SYSTEM, user); const ref = await ask('mock-handoff-split', SYSTEM, user);
  assert.equal(plain.text, ref.text, 'without a milestone request the model is mock-handoff-split');
  assert.deepEqual([asked.usage, plain.usage], [{ input: 30, output: 10 }, { input: 30, output: 10 }], 'the fixed usage of mock-priced: no spent figure moves');
  const none = await ask('mock-handoff-split-milestones', `${SYSTEM}\n## Milestones`, 'The plan:\nC1. one\n');
  assert.match(none.text, /## The split\n\n\(the plan holds no split block\)/, 'a leaf plan: no fence to copy');
});

test('the criteria it discharges are the `# Acceptance criteria` list at the END of the prompt, each once: `C<n>.` lines elsewhere (a tree child\'s request holds its inherited obligations as C1-C3) are not criteria', async () => {
  const user = `# Request\n\nInherited:\nC1. old one\nC2. old two\nC3. old three\n\n# Final plan\n\nA plan.\n\n${FENCE}\n\n# Acceptance criteria\n\nC1. first\nC2. second`;
  const asked = await ask('mock-handoff-split-milestones', `${SYSTEM}\n## Milestones\nWrite them.`, user);
  assert.match(asked.text, /- check: C1, C2 \|/, JSON.stringify(asked.text.match(/- check:.*/)?.[0]));
  assert.equal(/C3/.test(asked.text), false, 'C3 is not one of this run\'s criteria');
  // no heading at all: the whole prompt is read, as before (and still each id once)
  const bare = await ask('mock-handoff-split-milestones', `${SYSTEM}\n## Milestones`, 'The plan:\nC1. one\nC2. two\nC1. one again\n');
  assert.match(bare.text, /- check: C1, C2 \|/);
});

test('END TO END (R2\'s owed real-record agreement test): a real tree on the milestone mock, every child run to its end, reads as incomplete naming EXACTLY the agreement - no member has a lint finding or a failing item', { timeout: 600_000 }, async () => {
  const b = block3(); b.milestones[4] = { id: 'M5', status: 'ready', basis: 'Release and rollback plan', open_question: null };
  const r = await trackedRealRoot({ ...splitMilestoneChildren(), plan: planWith(b, { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r) });
  const v = readinessOf(r.t.rootDir, { work: r.t.work });
  assert.deepEqual(v.reasons.map(x => [x.severity, x.code, x.scope]), [['incomplete', 'integration_unrecorded', 'R@g1:A1']], JSON.stringify(v.reasons));
  assert.equal(v.verdict, 'incomplete');
  assert.deepEqual(v.inputs.nodes.map(n => [n.node, n.generation, n.phase, n.passed, n.status]), [['R', 1, 'closed', true, 'ready_for_build'], ['R/M1', 1, 'closed', true, 'ready_for_build'], ['R/M2', 1, 'closed', true, 'ready_for_build'], ['R/M3', 1, 'closed', true, 'ready_for_build']]);
  // row 79's other half (added with the S2 verb commit, test-only): the loop's eligibility reader (providerEligibility, which applies subtreeEligible) and the readiness rule AGREE on this one real record - every node
  // readinessOf finds no node-level reason for is an eligible provider (the only reason left belongs to an agreement, not to a node)
  const record = readTreeRecord(r.t.rootDir); const state = stateOf(record);
  for (const p of ['R/M1', 'R/M2', 'R/M3']) { const e = providerEligibility({ record, state, runsDir: r.t.runsDir, work: r.t.work }, p); assert.deepEqual([e.eligible, e.why, e.heldByStop], [true, [], false], `${p}: eligible, as readiness finds nothing wrong with it`); }
});

test('mock-handoff-needs-decision takes the milestone branch too, ONLY when asked (C&C, 11 Oct): the same reply with Status needs_decision; without the request it is mock-handoff-split\'s text with that Status, as before (M5e)', async () => {
  const user = `The plan:\nC1. one\nC2. two\n\n${FENCE}\n`;
  const asked = await ask('mock-handoff-needs-decision', `${SYSTEM}\n## Milestones\nWrite them.`, user);
  const ref = await ask('mock-handoff-split-milestones', `${SYSTEM}\n## Milestones\nWrite them.`, user);
  assert.match(asked.text, /^Status: needs_decision\n/);
  assert.equal(asked.text, ref.text.replace('Status: ready_for_build', 'Status: needs_decision'), 'the milestone reply differs from the ready one in the Status line only');
  assert.deepEqual(asked.usage, { input: 30, output: 10 });
  const plain = await ask('mock-handoff-needs-decision', SYSTEM, user); const split = await ask('mock-handoff-split', SYSTEM, user);
  assert.equal(plain.text, split.text.replace('Status: ready_for_build', 'Status: needs_decision'), 'not asked: exactly what it has always answered');
  assert.deepEqual(plain.usage, split.usage, 'and at the usage it has always had (length-based, not the fixed 30/10)');
});

test('a real child on the needs-decision fixture records a lint with Status needs_decision and the ONE finding statusPolicyOk allows for it (status_not_ready); its close still opens the node\'s own stop (source node_closed) - the meaning of every needs-decision test is unchanged', { timeout: 300_000 }, async () => {
  const r = await trackedRealRoot(needsDecisionChildren()); approvePending(r);
  await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), maxStarts: 1 });
  const n = [...stateOf(readTreeRecord(r.t.rootDir)).nodes.values()].find(x => x.node === 'R/M1');
  const rep = readRunJson(join(r.t.runsDir, n.runId), 'report.json');
  assert.deepEqual([rep.handoff_milestones.status, rep.handoff_milestones.findings.map(f => f.kind)], ['needs_decision', ['status_not_ready']]);
  const stops = eventsOf(r).filter(e => e.event === 'needs_decision_opened' && e.node === 'R/M1');
  assert.deepEqual(stops.map(e => e.source), ['node_closed']);
});

test('mock-handoff-milestones-nofence (the PLAN 5.5 item-3 case: a seat that writes its milestones and forgets the split block): asked for milestones it writes the milestone reply WITHOUT the fence, byte for byte the split-milestones reply minus its `## The split` section; not asked it answers the default reply; the fixed usage and the fixture price row of the other named handoff mocks', async () => {
  const user = `The plan:\nC1. one\nC2. two\n\n${FENCE}\n`;
  const asked = await ask('mock-handoff-milestones-nofence', `${SYSTEM}\n## Milestones\nWrite them.`, user);
  const ref = await ask('mock-handoff-split-milestones', `${SYSTEM}\n## Milestones\nWrite them.`, user);
  assert.equal(asked.text, ref.text.slice(0, ref.text.indexOf('\n\n## The split')) + '\n');
  assert.equal(/tree-split|## The split/.test(asked.text), false, 'no fence, no split section');
  assert.deepEqual(asked.usage, { input: 30, output: 10 });
  const plain = await ask('mock-handoff-milestones-nofence', SYSTEM, user); const dflt = await ask('mock-priced', SYSTEM, user);
  assert.equal(plain.text, dflt.text, 'not asked: the default handoff reply');
  const { default: pricing } = await import('../src/pricing.json', { with: { type: 'json' } });
  assert.deepEqual(pricing['mock/mock-handoff-milestones-nofence'], pricing['mock/mock-handoff-split-milestones'], 'the same fixture price row');
});
