// Fixture views for the texts a person reads (0.8.3 M5a; src/tree-stop.js). Shared by the tests and by Review/Build_0.8.3/render-stop-texts.mjs, which prints each rendered text in full for the report. Not a test file.
const KEY = '3f9a1c2e'.padEnd(64, '7');
const figures = { cheapestUsd: 1.11, expectedUsd: 1.56, atMostUsd: 5.25 };

export function frontierView(over = {}) {
  return {
    frontierKey: KEY,
    rootId: '2026-10-08T11-00-00-000Z',
    parent: {
      node: 'R', generation: 1, runId: '2026-10-08T11-00-00-000Z', splitSha256: 'a'.repeat(64),
      results: [
        { item: 1, ok: true, words: 'the panel passed and signed this text; the delivered text is the signed text; the handoff was made from it' },
        { item: 2, ok: true, words: '`contract check` exits 0 (the files are what the run wrote)' },
        { item: 3, ok: true, words: 'the split block in the plan is the block the handoff reproduced' },
        { item: 4, ok: true, words: 'the split is valid (every check of PLAN 5.3)' },
      ],
    },
    openedBy: [],
    children: [
      { node: 'R/M1', generation: 1, milestone: 'M1', scope: 'Choose and build the record store.', chain: { name: 'daily7-sub-a', figures }, grant: 5.25, ceiling: 5.25, admitted: true, notAdmittedReason: null, mayStop: false,
        inherited: [{ origin: 'R C1, global', text: 'The plan names an owner for every step.' }, { origin: 'R C2, delegated', text: 'No step calls the network.' }], refinements: ['The store keeps every record for 30 days.'],
        provides: [{ id: 'A1', to: 'R/M2', what: 'K1 exposes get(id) and put(record) on the store.', check: 'Call get after put on both plans and compare the record.' }], expects: [], refused: [], notEnforced: [], lints: [{ id: 'no-consistency', message: 'no criterion asks the plan to be consistent with itself' }] },
      { node: 'R/M2', generation: 1, milestone: 'M2', scope: 'Build the web layer on the store interface.', chain: { name: 'daily7-sub-a', figures }, grant: 3.1, ceiling: 3.1, admitted: true, notAdmittedReason: null, mayStop: true,
        inherited: [{ origin: 'R C1, global', text: 'The plan names an owner for every step.' }, { origin: 'R C3, delegated', text: 'Every step has a date.' }], refinements: [],
        provides: [], expects: [{ id: 'A1', from: 'R/M1', what: 'K1 exposes get(id) and put(record) on the store.', check: 'Call get after put on both plans and compare the record.' }],
        refused: [{ guard: 'infeasibleCriteria', text: 'The plan stays consistent with the milestone format of HANDOFF.md', origin: 'R:C4' }], notEnforced: [{ id: 'C2', check: 'grep -c date plan.md', text: 'Every step has a date.' }], lints: [] },
      { node: 'R/M3', generation: 1, milestone: 'M3', scope: 'Define the export format.', chain: { name: 'unpriced-chain', figures: null }, grant: 0, ceiling: 0, admitted: false, notAdmittedReason: 'run limit (12 of 12 runs are registered)', refusedLimit: 'maxRuns', refusedBy: null, mayStop: false,
        inherited: [{ origin: 'R C2, delegated', text: 'No step calls the network.' }], refinements: [], provides: [], expects: [], refused: [], notEnforced: [], lints: [] },
    ],
    budget: { rootCapUsd: 60, spentUsd: 4.2, heldUsd: 10.4, availableUsd: 45.4 },
    limits: [{ limit: 'runs', count: 12, effective: 12 }, { limit: 'depth', count: 1, effective: 2 }, { limit: 'children per split', count: 3, effective: 4 }],
    unexpanded: ['M4'],
    ...over,
  };
}

export const replacementFrontierView = () => frontierView({ openedBy: [{ id: 'e41', text: 'Decision: the record store is SQLite, one file per tree.\nStart the storage plan again with that fixed.' }] });

export const limitView = () => ({
  rootId: '2026-10-08T11-00-00-000Z', limit: 'maxRuns', flag: 'max-runs', count: 12, effective: 12, initial: 12, raises: [],
  open: [{ node: 'R/M3', scope: 'Define the export format.' }, { node: 'R/M5', scope: 'Write the migration notes.' }], unexpanded: ['M7'],
  perChild: { name: 'daily7-sub-a', atMostUsd: 5.25 }, wouldAdmit: 2, budget: { rootCapUsd: 60, availableUsd: 45.4 },
});

export const needsDecisionView = () => ({
  stopId: 'e57', node: 'R/M1', generation: 1, status: 'needs_decision',
  whatThisIs: 'The store depends on a choice only the owner can make: single file or a server.\nI cannot settle it from the plan.',
  provides: [{ id: 'A1', to: 'R/M2', what: 'K1 exposes get(id) and put(record) on the store.' }], expects: [],
  affected: [{ node: 'R/M1', why: 'the node that stopped', finished: true }, { node: 'R/M2', why: 'it expects an agreement from R/M1', finished: true }],
  stale: ['R/M2'], spentUsd: 1.37, releasedUsd: 3.88, independent: ['R/M3'], rootAffected: false,
});
