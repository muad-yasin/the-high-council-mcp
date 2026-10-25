// Child chains of the loop tests (0.8.3 M5c): all-mock, $0 on the wire. `priced-debate` is mock-debate with a handoff seat that has a (fixture) price, so the dry run gives the chain a pack-B-style figure (a grant can be
// sized) and a finished child holds PLAN 5.5 items 1-2 (the panel signed, the handoff was made from the signed text); a child chain without a handoff seat (mock-budget) is never "eligible" as a provider. Not a test file.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SPLIT_ROOT, root, splitRootConfig } from './tree-fixture.js';
import { blockKinds, planWith } from './split-fixture.js';

const mockDebate = () => JSON.parse(readFileSync(join(root, 'chains', 'mock-debate.json'), 'utf8'));
// The fixture child's handoff seat is the Status-bearing named mock (M6, with the null-Status rule) AND the chain asks for milestones (handoff_contract.milestones), so a fixture child records a milestone lint like a real 0.8.3 child
// (C&C, 11 Oct: the fixtures model real trees). The mock then writes a Status, the `## Milestones` section and, when the plan holds one, the split fence; it has a price row (1000/1000 USD per million tokens) and a fixed usage of 30 in + 10 out,
// i.e. $0.04 per handoff call. Every `mock-handoff-split` it replaced had no price row, so it cost $0: see SPLIT_ROOT_HANDOFF_USD in tree-fixture.js for the figures that moved.
export const pricedDebate = () => { const c = mockDebate(); return { ...c, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-split-milestones', maxTokens: 2000 } }, handoff_contract: { milestones: true } }; };
/** A priced child chain whose handoff seat ends every node `needs_decision` (mock-handoff-needs-decision, a named mock model with a fixture price row beside mock-priced; M5e). */
export const needsDecisionDebate = () => { const c = mockDebate(); return { ...c, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-needs-decision', maxTokens: 2000 } }, handoff_contract: { milestones: true } }; };
export const needsDecisionChildren = () => ({ childChain: 'nd-debate', extraChains: { 'nd-debate': needsDecisionDebate() } });
/** realRoot options for a tree whose ROOT ends needs_decision (the split-root chain with the needs-decision handoff seat), children on priced-debate. */
export const needsDecisionRoot = () => ({ childChain: 'priced-debate', extraChains: { 'priced-debate': pricedDebate(), [SPLIT_ROOT]: { ...splitRootConfig(), seats: { ...splitRootConfig().seats, handoff: { provider: 'mock', model: 'mock-handoff-needs-decision', maxTokens: 2000 } } } } });
/** realRoot options for a tree whose children run on priced-debate. */
/** priced-debate whose handoff seat writes its milestones but does NOT reproduce the plan's split block: for the one test that needs a provider that fails PLAN 5.5 item 3 and nothing else. */
// The handoff seat is `mock-handoff-milestones-nofence` (C&C, 12 Oct): it writes its milestones like a real 0.8.3 seat and forgets the plan's split block, so the child records a CLEAN lint and still fails PLAN 5.5 item 3 (the real
// case); the chain asks for milestones like every fixture child. Same price row and fixed usage as the other named handoff mocks.
// Its handed-in plan carries the split block, so its handoff prompt is about 2120 tokens with the milestone request: the worst case of that call is $4.12 on the fixture row, over priced-debate's 2000 assumed input tokens (ceiling $4.00).
// The chain declares the larger assumed prompt (1500 + 1500 input tokens: ceiling (3000 + 2000) * 0.001 = $5.00), as a real chain with big plans would, so its grant covers its real worst case and the run finishes.
export const pricedUnreproducingChildren = () => ({ childChain: 'priced-debate', extraChains: { 'priced-debate': { ...pricedDebate(), estimate: { promptTokens: 1500, draftTokens: 1500, critiqueTokens: 300 }, seats: { ...pricedDebate().seats, handoff: { provider: 'mock', model: 'mock-handoff-milestones-nofence', maxTokens: 2000 } } } } });
export const pricedChildren = () => ({ childChain: 'priced-debate', extraChains: { 'priced-debate': pricedDebate() } });

/**
 * A REAL held item (M5c2): the root chain has criterion kinds ON (its acceptance list carries checkable items: C2 "heading named Assumptions", C4 "npm test exits 0"), the children run on priced-debate, which has kinds OFF, so the
 * checks of the items they inherit are `check_not_enforced` and the child is HELD (PLAN 6.2 item 3). The flags of the child chain differ from the root's, which is the only way a guard or an unenforced check holds an item.
 */
export const heldKindsChildren = () => ({
  childChain: 'priced-debate',
  extraChains: { [SPLIT_ROOT]: { ...splitRootConfig(), criteria_kinds: { enabled: true } }, 'priced-debate': pricedDebate() },
  plan: planWith(blockKinds(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }),
});

/**
 * A REAL guard-refused item (M5c2): the root chain has `debate` OFF, so its guards accept the item "The summary of the debate is written to BOARD.md." in the acceptance list it is handed; the children run on priced-debate,
 * which has `debate` ON, and infeasibleCriteria refuses a BOARD.md item for a debate chain. R/M1 and R/M3 inherit that item (C2, delegated), so they are HELD (`blocked_criteria_guard`): the item is carried in context only.
 */
export const heldGuardChildren = () => ({
  childChain: 'priced-debate',
  extraChains: { [SPLIT_ROOT]: { ...splitRootConfig(), debate: false }, 'priced-debate': pricedDebate() },
  rootCriteria: ['The deliverable is the artifact itself, not a plan for one.', 'The summary of the debate is written to BOARD.md.', 'It adds no scope the request did not ask for.'],
});

/**
 * A child chain that can SPLIT (M5c2, L8 depth 2): its handoff seat copies the plan's split block and writes milestones (mock-handoff-split-milestones, M6 fixtures), and its criteria seat is priced (the stage is skipped when a criteria list is handed in, as the loop does,
 * but the dry run counts it), so the chain has a grant figure: floor 4.60, at most 7.00 (1.40 and 3.00 while its handoff seat was the unpriced mock-handoff-split; the milestone mock's price row adds the same $3.20 / $4.00 as priced-debate's handoff, measured with chainFigures). Like priced-debate it has debate and handoff on.
 */
export const splitChild = () => { const c = mockDebate(); return { ...c, seats: { ...c.seats, handoff: { provider: 'mock', model: 'mock-handoff-split-milestones', maxTokens: 2000 }, criteria: { provider: 'mock', model: 'mock-priced', maxTokens: 2000 } }, handoff_contract: { milestones: true } }; };
export const splitChildren = () => ({ childChain: 'split-child', extraChains: { 'split-child': splitChild() } });

/** A child chain whose BUILDER is an external seat (M5c2, L1): the run pauses at the build stage (exit 3, NEEDS-builder.md) and waits for its answer file. Priced like priced-debate so a grant can be sized. */
export const externalChild = () => { const c = pricedDebate(); return { ...c, seats: { ...c.seats, builder: { provider: 'external', model: 'claude-code-session' } } }; };
export const externalChildren = () => ({ childChain: 'external-child', extraChains: { 'external-child': externalChild() } });

/** ALIASES (M6 fixtures, 11 Oct): splitChild and the default split root now write milestones themselves, so these two names are the same chains. Kept so the tests that name them (and the `split-ms-child` chain name) read as before. */
export const splitMilestoneChild = splitChild;
export const splitMilestoneRoot = splitRootConfig;
/** realRoot options for a tree whose root and children all split and write milestones, under the chain name `split-ms-child` (PLAN M6 exit 1 and 2 end to end). */
export const splitMilestoneChildren = () => ({ childChain: 'split-ms-child', extraChains: { 'split-ms-child': splitMilestoneChild(), [SPLIT_ROOT]: splitMilestoneRoot() } });

/** (M6 S2 held items): the root has criterion kinds ON, the children (split-ms-child, kinds OFF) split and write milestones, so their inherited checkable items are `check_not_enforced`. */
export const heldKindsMilestoneChildren = () => ({
  childChain: 'split-ms-child',
  extraChains: { [SPLIT_ROOT]: { ...splitMilestoneRoot(), criteria_kinds: { enabled: true } }, 'split-ms-child': splitMilestoneChild() },
  plan: planWith(blockKinds(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }),
});
/** The root has `debate` OFF, the children have it ON, so the BOARD.md item is refused by infeasibleCriteria at R/M1 and R/M3 and carried in context only. */
export const heldGuardMilestoneChildren = () => ({
  childChain: 'split-ms-child',
  extraChains: { [SPLIT_ROOT]: { ...splitMilestoneRoot(), debate: false }, 'split-ms-child': splitMilestoneChild() },
  rootCriteria: ['The deliverable is the artifact itself, not a plan for one.', 'The summary of the debate is written to BOARD.md.', 'It adds no scope the request did not ask for.'],
});
