// The money figures of the tree tests, DERIVED from the chain's own dry run instead of typed (decider-readiness apply patch, template commit, 24 Okt 2026; C&C ruling (c)). The upper estimate counts each call's system text, which comes from src/roles.js,
// so every recorded or reworded sentence moves a chain's figures (mock-budget cheapest 8.064 -> 8.714 and at-most 44.45 -> 45.75 when the 16 drafted functions are recorded). A fixture that types a figure, or a cap sized against a typed figure, breaks on
// every wording change; these helpers keep the RELATION a test is about (a share just over the cheapest end, a pool under it, a pool over the at-most) true BY CONSTRUCTION: each cap is a function of the figure and of the branch the test names.
// PATTERN for a converted test: (1) ask for the figure here, (2) derive the share or pool for the branch (shareOver / capFor / the midpoint of cheapest and at-most), (3) assert the relation in the fixture, so a figure that crosses it fails the fixture and not
// a distant assertion, (4) express every expected amount and every screen text as a function of those, never as a number. Exactly ONE test keeps a typed figure: tree-budget's PIN of mock-budget's own dry run (provisional; re-recorded at the apply).
// The in-process figure equals the product's only when both price the chain at the same input size: the tree prices a child at its bundle allowance (tree.json bundleAllowanceBytes, the fixture's FIXTURE_BUNDLE_ALLOWANCE_BYTES), so that is the default here.
// No test may have a setHeldForTest override active when it asks (the estimate reads held()). Not a test file.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveChainSeats } from '../../src/chain.js';
import { chainFigures, ceilCents, floorCents, MONEY_EPS } from '../../src/tree-budget.js';
import { FIXTURE_BUNDLE_ALLOWANCE_BYTES, SPLIT_ROOT_HANDOFF_USD, root } from './tree-fixture.js';
import { pricedDebate } from './child-chains.js';

export { ceilCents, floorCents };
/** the chain's own dry-run figures { cheapestUsd, atMostUsd }, priced for an input of `inputBytes` as the tree prices a child (the fixture's bundle allowance by default) */
export const figuresOfConfig = (config, { inputBytes = FIXTURE_BUNDLE_ALLOWANCE_BYTES } = {}) => chainFigures(resolveChainSeats(config), { inputBytes });
/** mock-budget's figures */
export const mockBudgetFigures = () => figuresOfConfig(JSON.parse(readFileSync(join(root, 'chains', 'mock-budget.json'), 'utf8')));
/** priced-debate's figures (the fixture child of pricedChildren()) */
export const pricedDebateFigures = () => figuresOfConfig(pricedDebate());

/** How far above the cheapest end a "just admitted" share sits. A share must be at least the cheapest end to be admitted (src/tree-frontier.js: floorCents(share) + MONEY_EPS >= cheapestUsd). A child run on mock-budget stops at its cap only while the grant
 * stays under what its calls can project (INFERRED, not measured: spent + the next call's whole maxTokens at the fixture price, about the cheapest end plus a few tenths). The old fixtures sat 0.55-0.59 over (6.65 over 6.1; 8.65 over 8.064) and stopped.
 * The smallest margin that is still a share to the cent keeps the run stopping on every state of src/roles.js, and the admission test holds by construction; fixtureShare() asserts it. */
export const OVER_CHEAPEST = 0.01;
/** the equal share (to the cent) a child needs to be admitted with a little room: the cheapest end plus OVER_CHEAPEST, rounded UP to the cent */
export const shareOver = figures => ceilCents(figures.cheapestUsd + OVER_CHEAPEST);
/** the root cap whose equal share among `k` children is exactly `share` after the root's own spend `rootSpent` (the split root's handoff, SPLIT_ROOT_HANDOFF_USD). Integer cents, so floorCents((cap - rootSpent) / k) is `share`. */
export const capFor = (share, k, rootSpent = 0) => Math.round((share * k + rootSpent) * 100) / 100;

/** The fixture of the "child stopped at its cap" tests (tree-decide-topup, tree-amend-cap, tree-ceiling, tree-decide-close): mock-budget children, a root cap whose equal share among three children (after the split root's own handoff) is G, a share just over the
 * cheapest end, so the first child is admitted, runs and stops at its cap. G and CAP replace the typed 8.65 and 26 (typed against the cheapest end 8.064, which moved to 8.714 when the drafted words were recorded). The relation is asserted HERE. */
export const stoppedChildFixture = () => {
  const figures = mockBudgetFigures();
  const G = shareOver(figures);
  const CAP = capFor(G, 3, SPLIT_ROOT_HANDOFF_USD);
  assert.ok(floorCents((CAP - SPLIT_ROOT_HANDOFF_USD) / 3) + MONEY_EPS >= figures.cheapestUsd, `fixture: the share ${G} of the cap ${CAP} reaches mock-budget's cheapest end ${figures.cheapestUsd}, so R/M1 is admitted`);
  assert.ok(G < figures.atMostUsd, 'fixture: the share is under the at-most figure, so the child can stop at its cap');
  return { G, CAP };
};
/** a figure as the screens print it (two decimals), and the same as a regular-expression source */
export const usd = n => n.toFixed(2);
export const usdRx = n => usd(n).replace('.', '\\.');
