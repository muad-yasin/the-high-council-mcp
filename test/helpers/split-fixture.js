// Fixtures for the split contract (0.8.3 M3), shared by test/tree-split.test.js and the tree tests whose real root run must carry a split block (PLAN 5.5 item 3 is part of a child's start). Not a test file.
import { SPLIT_MARKER } from '../../src/tree-split.js';

/** A valid three-child block: M1-M3 decompose (children K1-K3), M4 ready (its basis names a heading), M5 needs-decision. K1 provides A1 to K2; K3 is independent of both. */
export function validBlock() {
  const empty = (...siblings) => siblings.map(sibling => ({ sibling, agreements: [] }));
  return {
    milestones: [
      { id: 'M1', status: 'decompose', basis: 'which store holds the records is not settled', open_question: 'Which store holds the records?' },
      { id: 'M2', status: 'decompose', basis: 'the web layer depends on the store interface', open_question: 'What does the web layer read from the store?' },
      { id: 'M3', status: 'decompose', basis: 'the export format is not settled', open_question: 'Which export format is used?' },
      { id: 'M4', status: 'ready', basis: 'Release and rollback plan', open_question: null },
      { id: 'M5', status: 'needs-decision', basis: 'the owner has not said whether the old API stays', open_question: 'Does the old API stay?' },
    ],
    classes: [{ id: 'C1', class: 'global' }, { id: 'C2', class: 'delegated' }, { id: 'C3', class: 'delegated' }, { id: 'C4', class: 'root-only' }],
    children: [
      { id: 'K1', milestone: 'M1', scope: 'Choose and build the record store.', inherits: ['C2'], obligations: ['The store keeps every record for 30 days.'], context_refs: ['parent-plan: Overview'],
        provides: [{ sibling: 'K2', agreements: ['A1'] }, ...empty('K3')], expects: empty('K2', 'K3') },
      { id: 'K2', milestone: 'M2', scope: 'Build the web layer on the store interface.', inherits: ['C3'], obligations: [], context_refs: ['parent-plan: Overview'],
        provides: empty('K1', 'K3'), expects: [{ sibling: 'K1', agreements: ['A1'] }, ...empty('K3')] },
      { id: 'K3', milestone: 'M3', scope: 'Define the export format.', inherits: ['C2'], obligations: [], context_refs: ['parent-plan: Overview'],
        provides: empty('K1', 'K2'), expects: empty('K1', 'K2') },
    ],
    agreements: [{ id: 'A1', from: 'K1', to: 'K2', what: 'K1 exposes get(id) and put(record) on the store.', provider_refs: ['Overview'], integration_check: 'Call get after put on both plans and compare the record.' }],
  };
}

/** The plan text around a block: milestone headings M1..M5 (plus `extraMilestones`), the headings the ready basis can name, the marked fence. */
export function planWith(block, { extraMilestones = [], noFence = false, fenceCount = 1, preface = '' } = {}) {
  const ids = ['M1', 'M2', 'M3', 'M4', 'M5', ...extraMilestones];
  const heads = ids.map(id => `### ${id} - ${{ M1: 'Storage layer', M2: 'Web layer', M3: 'Export', M4: 'Release', M5: 'Old API' }[id] ?? 'Extra'}\nEntry: the repo exists.\nWork: build it.\nExit:\n- check: C1 | run it => it works`).join('\n\n');
  const fence = `\`\`\`${SPLIT_MARKER}\n${JSON.stringify(block, null, 1)}\n\`\`\``;
  return `${preface}# The plan\n\n## Overview\nA plan.\n\n## Release and rollback plan\nShip behind a flag.\n\n## Scope\nSmall.\n\n## Milestones\n\n${heads}\n\n${noFence ? '' : Array(fenceCount).fill(fence).join('\n\n')}\n`;
}


/** The valid block for the three criteria the mock criteria seat writes (C1..C3). */
export function block3() { const b = validBlock(); b.classes = b.classes.filter(c => c.id !== 'C4'); return b; }
/** A plan around it that the mock critics sign (they sign a draft that carries the REVISED MOCK DELIVERABLE line). */
export const plan3 = (block = block3(), opts = {}) => planWith(block, { preface: 'REVISED MOCK DELIVERABLE\n\n', ...opts });

/** The block for the five criteria a root with criterion KINDS ON locks (test/helpers/child-chains.js kindsRoot): C2 and C4 are checkable. K1 and K3 inherit C2, so a child chain with kinds off will not enforce its check. */
export function blockKinds() {
  const b = block3();
  b.classes = [{ id: 'C1', class: 'global' }, { id: 'C2', class: 'delegated' }, { id: 'C3', class: 'delegated' }, { id: 'C4', class: 'root-only' }, { id: 'C5', class: 'root-only' }];
  return b;
}

/** A copy of `block` whose open questions are its OWN (prefixed): a child plan that repeats the root's questions has its expansion refused (repeated_question) and, since the blocked-child rule, a stop of its own - a test that wants a plain split child uses this. */
export function ownQuestions(block) { const b = JSON.parse(JSON.stringify(block)); for (const m of b.milestones) if (m.open_question) m.open_question = `Inside the store: ${m.open_question}`; return b; }
