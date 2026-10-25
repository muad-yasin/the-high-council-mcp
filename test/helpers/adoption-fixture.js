// A REAL record with an ADOPTION in force, built the way test/tree-adoption-rules.test.js builds its trees: every event goes through the real table (appendTreeEvent / registerChildUnchecked); the adoption itself is a preview with a `reused` entry and its approval (the K8 table),
// because nothing in src/ writes `reused` yet (C2b-2). Used by test/tree-adoption-sites.test.js (C2b-1) and test/tree-adoption-readers.test.js (C2b-1b).
//
//   R -> R/M1 (needs_decision) -> R/M1/A ($8 spent, passed) [-> R/M1/A/D when deep]; R/M1 is regenerated (R/M1@g2 closes), so R/M1/A@g1 is a candidate. The new plan's children frontier of R/M1@g2 names three slots: R/M1/A@g2 (a NEW run on the old path),
//   R/M1/B@g2 (ADOPTS R/M1/A@g1: a MOVE onto a colliding path) and R/M1/C@g2 (a new run registered AGAINST the adopted node: dependsOn R/M1/A@g1). With `deep`, A@g1 has a finished child R/M1/A/D@g1 (adopted with it) and the new A@g2 has its own R/M1/A/D@g2.
//   With `regenerate` (deep only), the child R/M1/A/D@g1 of the ADOPTED branch is regenerated after the adoption: a stop and a decision on it open generation 3, and R/M1/A/D@g3 registers under a frontier of the adopted R/M1/A@g1.
//   With `finishC`, the consumer R/M1/C@g2 is started and closed too, so the only child of the adopting frontier that is not registered is the reused slot.
//   With `agreement`, A@g1 SPLIT and holds an agreement between its children: its plan (block3 without K3: K1 -> K2 by the agreement A1, milestones M1/M2) is in its run folder and verified, R/M1/A/M1 and R/M1/A/M2 (IDS[8], IDS[9]) are its finished children, so the agreement's ends are R/M1/A/M1 and R/M1/A/M2 by PATH and R/M1/B/M1 and R/M1/B/M2 by PLACE (the slot A@g1 fills);
//   the adopting plan R/M1@g2 is in its run folder too (children A, B, C of the slot milestones, one agreement X1 from B to C).
//   With `held`, A@g1 carries one held item (check not enforced) so the held-target readers have something to find; `held: HELD_FROM_SIBLING` gives it an origin outside the tree.
import { strict as assert } from 'node:assert';
import { appendTreeEvent, readTreeRecord, stateOf } from '../../src/tree-record.js';
import { frontierKey } from '../../src/tree-identity.js';
import { registerChildUnchecked } from '../../src/tree-register.js';
import { isSupersededGeneration, subplanAffectedWanted } from '../../src/tree-transitions.js';
import { affectedFor } from '../../src/tree-affected.js';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Of } from '../../src/thin-contract.js';
import { block3, planWith } from './split-fixture.js';
import { track } from './temp-trees.js';
import { FIXTURE_BOUND, GATE_FIELDS as GF, IDS, SPLIT, approveFrontier, chainSha, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './tree-fixture.js';

export const HELD_IDENTITY = { originNode: 'R/M1', originGeneration: 1, originId: 'C2', originClass: 'delegated', textSha256: '1'.repeat(64), form: 'The summary is written to BOARD.md' };

// a rule that originates at a node that is not in the tree (R/M2 was approved but never registered): the carriers are found by their registrations alone
export const HELD_FROM_SIBLING = { ...HELD_IDENTITY, originNode: 'R/M2' };

/** A delivered run folder: deliverable.md + a report.json whose delivered_text hashes it, so the plan READS (as test/tree-root-frontier.test.js writes one). */
function writePlan(t, runId, block) {
  const dir = join(t.runsDir, runId); mkdirSync(dir, { recursive: true });
  const body = planWith(block, { preface: 'REVISED MOCK DELIVERABLE\n\n' });
  writeFileSync(join(dir, 'deliverable.md'), body); writeFileSync(join(dir, 'report.json'), JSON.stringify({ delivered_text: { body_sha256: sha256Of(body), harness_notes: [] } }));
}

export function adoptedTree({ deep = false, held = false, regenerate = false, finishC = false, agreement = false } = {}) {
  const heldId = held === true ? HELD_IDENTITY : held;       // `held: true` = the rule originates at R/M1; `held: 'own'` = an item with NO identity (the node's own refinement: its origin is A@g1 itself); `held: HELD_FROM_SIBLING` = it originates at R/M2, which is not in the tree, so ONLY the registration of the carrier names it
  const t = closedRootTree(); track(t.work);
  const open = (node, generation, runId) => appendTreeEvent(t.rootDir, { event: 'node_started', ...claim(node, runId, process.pid, generation, hostnameOf()) });
  const close = (node, generation, runId, status, returnedUsd) => appendTreeEvent(t.rootDir, { event: 'node_closed', node, generation, runId, outcome: 'passed', passed: true, status, share: 'released', returnedUsd });
  const chain = { name: t.childChain, sha256: (t.shaIn ?? chainSha)(t.childChain) };
  const preview = (parentNode, parentGeneration, parentRunId, kids) => {
    const base = { parentNode, parentGeneration, parentRunId, splitSha256: SPLIT, children: kids };
    const k = frontierKey({ ...base, openedBy: null, children: kids.map(c => ({ node: c.node, generation: c.generation })) });
    appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: k, ...base, boundSha256: FIXTURE_BOUND });
    appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GF, frontierKey: k, revision: 1, boundSha256: FIXTURE_BOUND });
    return k;
  };
  const k1 = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, k1, 'R/M1', IDS[0], 10); syntheticRun(t, IDS[0], {}); open('R/M1', 1, IDS[0]); close('R/M1', 1, IDS[0], 'needs_decision', 10);
  const k2 = preview('R/M1', 1, IDS[0], [{ node: 'R/M1/A', generation: 1 }]);
  registerChildUnchecked(t.rootDir, { frontierKey: k2, node: 'R/M1/A', generation: 1, runId: IDS[1], parentRunId: IDS[0], chain, grant: { amount: 10, unit: 'usd' }, ...(held ? { obligations: { items: [{ id: 'C1', ...(heldId === 'own' ? {} : { identity: heldId }), checkNotEnforced: true }], context: [] } } : {}) });
  syntheticRun(t, IDS[1], { usage: [{ file: 'a', usd: 8, provider: 'mock' }] }); open('R/M1/A', 1, IDS[1]); close('R/M1/A', 1, IDS[1], 'ready_for_build', 2);
  if (agreement) {
    writePlan(t, IDS[1], { ...block3(), children: block3().children.filter(c => c.id !== 'K3') });       // two children, both finished below: the owner is a WHOLE branch
    appendTreeEvent(t.rootDir, { event: 'split_verified', node: 'R/M1/A', generation: 1, runId: IDS[1], splitSha256: 'c'.repeat(64), children: ['R/M1/A/M1', 'R/M1/A/M2'] });
    const kAg = preview('R/M1/A', 1, IDS[1], [{ node: 'R/M1/A/M1', generation: 1 }, { node: 'R/M1/A/M2', generation: 1 }]);
    registerKid(t, kAg, 'R/M1/A/M1', IDS[8], 2); syntheticRun(t, IDS[8], {}); open('R/M1/A/M1', 1, IDS[8]); close('R/M1/A/M1', 1, IDS[8], 'ready_for_build', 2);
    registerKid(t, kAg, 'R/M1/A/M2', IDS[9], 2); syntheticRun(t, IDS[9], {}); open('R/M1/A/M2', 1, IDS[9]); close('R/M1/A/M2', 1, IDS[9], 'ready_for_build', 2);
  }
  if (deep) {
    const kD = preview('R/M1/A', 1, IDS[1], [{ node: 'R/M1/A/D', generation: 1 }]);
    registerKid(t, kD, 'R/M1/A/D', IDS[5], 5); syntheticRun(t, IDS[5], {}); open('R/M1/A/D', 1, IDS[5]); close('R/M1/A/D', 1, IDS[5], 'ready_for_build', 5);
  }
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: IDS[0], source: 'node_closed', affected: [{ node: 'R/M1', generation: 1 }, { node: 'R/M1/A', generation: 1 }, ...(deep ? [{ node: 'R/M1/A/D', generation: 1 }] : [])] });
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, affected: [{ node: 'R/M1', generation: 1 }], ...GF });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R/M1', generation: 2 }] });
  const kR = approveFrontier(t.rootDir, ['R/M1'], { generation: 2 });
  registerKid(t, kR, 'R/M1', IDS[2], 10, 2); syntheticRun(t, IDS[2], {});
  if (agreement) writePlan(t, IDS[2], { ...block3(), children: [{ id: 'KA', milestone: 'A' }, { id: 'KB', milestone: 'B' }, { id: 'KC', milestone: 'C' }], agreements: [{ id: 'X1', from: 'KB', to: 'KC', what: 'B feeds C.', provider_refs: [], integration_check: 'Run C on B.' }] }); open('R/M1', 2, IDS[2]); close('R/M1', 2, IDS[2], 'ready_for_build', 10);
  const reused = { adoptsNode: 'R/M1/A', adoptsGeneration: 1, runId: IDS[1], fieldsSha256: 'a'.repeat(64), identityMap: {} };
  const k3 = preview('R/M1', 2, IDS[2], [{ node: 'R/M1/A', generation: 2 }, { node: 'R/M1/B', generation: 2, reused }, { node: 'R/M1/C', generation: 2 }]);
  registerKid(t, k3, 'R/M1/A', IDS[3], 10, 2); syntheticRun(t, IDS[3], {});
  open('R/M1/A', 2, IDS[3]);       // registration is one node at a time: A@g2 runs and closes before anything else is registered
  close('R/M1/A', 2, IDS[3], 'ready_for_build', 10);
  if (deep) {
    const kY = preview('R/M1/A', 2, IDS[3], [{ node: 'R/M1/A/D', generation: 2 }]);
    registerKid(t, kY, 'R/M1/A/D', IDS[6], 5, 2); syntheticRun(t, IDS[6], {}); open('R/M1/A/D', 2, IDS[6]); close('R/M1/A/D', 2, IDS[6], 'ready_for_build', 5);
  }
  if (deep && regenerate) {
    const stopD = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1/A/D', generation: 1, runId: IDS[5], source: 'status', affected: [{ node: 'R/M1/A/D', generation: 1 }] });
    const decD = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan the child again.', form: 'regenerate', stopId: stopD.id, affected: [{ node: 'R/M1/A/D', generation: 1 }], ...GF });
    // A record this branch-only INTERIOR opening is one the table now refuses (guard 2 of the generation_opened row: planning part of a reused branch plans its slot). The lineage rule of C2b-1b (isSupersededGeneration inside a branch) still reads such a record, so the fixture writes the line by hand, the way an older record would hold it.
    appendFileSync(join(t.rootDir, 'tree', 'events.jsonl'), `${JSON.stringify({ schema: readTreeRecord(t.rootDir).events.at(-1).schema, id: `e${Math.max(...readTreeRecord(t.rootDir).events.map(e => Number(e.id.slice(1)))) + 1}`, event: 'generation_opened', decisionId: decD.id, nodes: [{ node: 'R/M1/A/D', generation: 3 }], at: new Date().toISOString() })}\n`);
    const baseN = { parentNode: 'R/M1/A', parentGeneration: 1, parentRunId: IDS[1], splitSha256: SPLIT, children: [{ node: 'R/M1/A/D', generation: 3 }] };
    const kN = frontierKey({ ...baseN, openedBy: decD.id });
    appendTreeEvent(t.rootDir, { event: 'frontier_previewed', frontierKey: kN, ...baseN, boundSha256: FIXTURE_BOUND });
    appendTreeEvent(t.rootDir, { event: 'frontier_approved', ...GF, frontierKey: kN, revision: 1, boundSha256: FIXTURE_BOUND });
    registerKid(t, kN, 'R/M1/A/D', IDS[7], 5, 3); syntheticRun(t, IDS[7], {}); open('R/M1/A/D', 3, IDS[7]); close('R/M1/A/D', 3, IDS[7], 'ready_for_build', 5);
  }
  // C is registered AGAINST the adopted node: its input pins R/M1/A@g1 (the adopted run), not the new R/M1/A@g2
  const regC = registerChildUnchecked(t.rootDir, { frontierKey: k3, node: 'R/M1/C', generation: 2, runId: IDS[4], parentRunId: IDS[2], chain, grant: { amount: 10, unit: 'usd' }, dependsOn: [{ node: 'R/M1/A', generation: 1 }] });
  syntheticRun(t, IDS[4], {});
  if (finishC) { open('R/M1/C', 2, IDS[4]); close('R/M1/C', 2, IDS[4], 'ready_for_build', 10); }       // every registered child of the frontier is finished: only the reused slot is unregistered
  const state = stateOf(readTreeRecord(t.rootDir));
  assert.ok(state.adopted.has('R/M1/A@g1'), 'the fixture: R/M1/A@g1 is adopted');
  assert.equal(state.adopted.get('R/M1/A@g1').slot, 'R/M1/B@g2', 'the fixture: into the slot R/M1/B');
  assert.ok(state.nodes.has('R/M1/A@g2'), 'the fixture: the new node of the old path is registered');
  if (deep) assert.ok(state.nodes.has('R/M1/A/D@g1') && state.nodes.has('R/M1/A/D@g2'), 'the fixture: the old path of the child is registered twice, once under each node');
  if (!deep) assert.equal(isSupersededGeneration(state, 'R/M1/A', 1), false, 'the fixture: the adopted node is live beside R/M1/A@g2');
  return { t, regC, ids: IDS };
}

/**
 * The person plans the ADOPTING plan again (C2b-1c, the adoption lapse): a stop on R/M1@g2 whose affected set is the real closure (affectedFor), the regenerate decision listing what the table wants for it (subplanAffectedWanted: the same function the verb and the table use), and the generation it opens (R/M1@g3).
 * Nothing is registered, so it works while R/M1/C is still registered.
 */
export function replanParent(t) {
  const record = readTreeRecord(t.rootDir); const state = stateOf(record);
  const { affected } = affectedFor({ record, state, runsDir: t.runsDir, node: 'R/M1', generation: 2 });
  const stop = appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1', generation: 2, runId: IDS[2], source: 'status', affected });
  const dec = appendTreeEvent(t.rootDir, { event: 'decision_recorded', text: 'Plan it again.', form: 'regenerate', stopId: stop.id, affected: subplanAffectedWanted(stateOf(readTreeRecord(t.rootDir)), stop.id), ...GF });
  appendTreeEvent(t.rootDir, { event: 'generation_opened', decisionId: dec.id, nodes: [{ node: 'R/M1', generation: 3 }] });
  return { stop, dec };
}
