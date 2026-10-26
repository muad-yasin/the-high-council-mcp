// RATCHET over the places that decide which generation of a PATH is "the newest" (0.8.3 M6 S8-9 C2a gate 1, C&C 14 Oct 2026: I1', "the SCANNER GUARD is written FIRST").
// Why: a node is `(path, generation)` and "is there a newer generation of this path?" decides whether it is live. Relocation by content adopts an old node into another slot while the new plan may ALSO have a new node at the old path, so every reader that asks that question
// by itself would call the adopted node replaced. The plan (gate page C2a section 6) is ONE adopted-aware predicate (`isSupersededGeneration`) and every direct comparison moved onto it, plus a lineage-aware variant of the `latestByPath` readers.
// What it does: counts, per .js file anywhere under src/ (widened from src/tree-*.js and src/mcp/tree*.js: the other 137 files held none of the idioms at c6969e3, so the wider scan costs nothing and a new file ANYWHERE is judged against a baseline of 0), the direct idioms for "the newest generation of a path" (the pattern table below; line comments are stripped). It is GREEN against today's counts (the baseline), RED when a file gets MORE of them (a new direct comparison: use the predicate)
// and RED when a file gets FEWER (the baseline is stale: lower it in the same commit, so the progress is visible). Some sites ask about the ROOT only, which is never adopted (tree-transitions.js, tree-person-stop.js, ...): the builder of the record half classifies each remaining site and lowers
// the baseline as it moves, or keeps it with the reason. PERMANENT counts (they are the predicate and a definition themselves and can never reach zero): tree-transitions.js `isSupersededGeneration`'s own `latestGenerationOf(` call (1) and `function generationOf(` (1). The site list is larger than the first page said (14 sites in 9 files): the inline sort idiom and tree-handoff's newestOf add most of the rest (58 occurrences in 17 files at release 3bc8a6a).
// What it does NOT see: a newest-generation idiom written some other way (`.reduce`, a manual loop), a `Math.max(` whose `.generation` sits on another line or after a `;` (since G7 item 6 the pattern reads to the first
// `.generation` in the same statement, through nested parens), and a file outside src/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PATTERNS = Object.freeze({
  latestGenerationOf: /\blatestGenerationOf\(/g,                          // the registered-or-opened newest generation of a path
  latestByPath: /\blatestByPath\(/g,                                      // path -> ONE node (the newest): can never hold an adopted old generation beside a new one
  generationOf: /(?<![\w.])generationOf\(/g,                              // the slot generation under a parent path
  sortNewest: /b\.generation\s*-\s*a\.generation/g,                       // the inline idiom: sort the nodes of a path newest first
  maxGeneration: /Math\.max\([^;\n]*?\.generation/g,                       // the inline idiom: the highest generation. G7 item 6 (26 Okt 2026): OLD /Math\.max\([^)]*\.generation/g, whose `[^)]` stopped at the first paren INSIDE the call (`.values()`)
  newestOf: /\bnewestOf\b/g,                                              // tree-handoff's path -> newest map
});
/** Counts per pattern in one file's text (line comments stripped). Pure. */
export function countSites(text) {
  const code = text.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  return Object.fromEntries(Object.entries(PATTERNS).map(([name, re]) => [name, (code.match(re) ?? []).length]).filter(([, n]) => n > 0));
}
// file -> { pattern: count } as of release 3bc8a6a. Lower an entry (or delete it) when a site moves onto the adopted-aware predicate.
// C2b-1 (M7 apply; plan Review/Build_0.8.3/m7/C2b_Plan_2026-10-18.md; per-site table in the commit message): what each remaining entry is.
//   MOVED (rows in test/tree-adoption-sites.test.js): tree-blocked-child.js:42 (entry deleted); tree-ready.js providers pin, tree-continuation.js provider pin and tree-handoff.js replaced list moved but their idiom counts STAY (the sort that picks the fallback, the newest map).
//   C2b-1b (plan Review/Build_0.8.3/m7/C2b1b_Plan_2026-10-18.md; rows in test/tree-adoption-readers.test.js) RE-KEYED the path-keyed readers by PLACE (placeOf / liveNodesOf in tree-transitions.js): tree-ready.js (verdictOf's Map, gatherReadinessFacts, heldTargetsOf's iteration, bindingOf), tree-affected.js (treeGraph, affectedFor), tree-loop.js (providerEligibility),
//     tree-stop-view.js (parent/entry, `independent`). What is left in this file for them is written beside their entries below. STILL KEPT, with their reason: tree-check.js:142 (an agreement of an adopted node is refused "now generation N": no fixture with a readable verified plan; the code change lands no later than C2b-2 and its row comes from C2b-2's probe record),
//     tree-ready.js bindingOf's agreement branch (re-keyed; its row also comes from that probe record), tree-affected.js generationOf (the generation mark of a PATH).
//   KEPT, SLOT RESOLUTION (C2b-2): tree-derive-load.js:112 (a consumer's provider lookup), tree-continuation.js:167 (the ancestors of a node under an adopted node).
//   KEPT, NOT A LIVENESS TEST: tree-reuse-load.js:111 (selects the earlier node by its proposing parent), tree-decide.js:139 (a person's bare path), tree-frontier.js:60/:170 (the parent of a frontier by path: an adopted PARENT is C2b-3), tree-loop.js:115 (a message).
//   KEPT, ROOT-ONLY / PERMANENT: as before.
export const BASELINE = Object.freeze({
  'tree-affected.js': { generationOf: 1, sortNewest: 1 },       // C2b-1b: treeGraph moved onto places (latestByPath gone); +1 sortNewest = affectedFor's DEFAULT stopped node (the newest live node of a path, for a caller that gives no generation); generationOf = the generation mark of a path, kept
  'tree-bundle-input.js': { latestGenerationOf: 2 },
  'tree-check.js': { latestGenerationOf: 1 },
  'tree-continuation.js': { sortNewest: 2 },
  // RAISED (G7 item 6, 26 Okt 2026, the widened maxGeneration): maxGeneration 1 -> 2. OLD: 1. WHY: rootRemedies' `Math.max(0, ...[...state.nodes.values()]...)` (the newest ROOT generation): root-only, never adopted.
  'tree-decide-stop.js': { latestGenerationOf: 1, maxGeneration: 2 },
  // RAISED 23 Okt 2026 (red-triage SG-1 unit, oversize check; found by the box set of e69a2ed): + 'tree-decide-size.js': { sortNewest: 1 }. OLD: no such file. WHY: the what-if size check picks the node a decision REPLACES (the newest node of the target's path older than the generation being opened) to find the frontier it was registered under and so the parent, as registration does (tree-loop.js). It is a lookup of one earlier node by path, not a liveness test. UNVERIFIED for an ADOPTED slot (openingTargetOf returns the slot's path there): no row covers it (tree-regen-slot's regenerate is synthetic, so the what-if skips it); registration stays the authority.
  'tree-decide-size.js': { sortNewest: 1 },
  'tree-decide.js': { sortNewest: 1 },
  // C2b-2 fix-up: providerSubtreeOf (the subtree rule moved into a helper) keeps the plain newest-of-path read for every provider that is NOT adopted (unchanged behaviour); the adopted branch is read through adoptedBelow, not by this sort.
  'tree-derive-load.js': { sortNewest: 2 },
  'tree-frontier.js': { sortNewest: 3 },
  'tree-handoff.js': { newestOf: 3 },
  'tree-loop.js': { latestGenerationOf: 1, sortNewest: 2 },       // C2b-1b: providerEligibility moved onto places (latestByPath gone)
  // C2b-ob: `carrierNodesOf` picks the origin node's newest LIVE node (one sort); not a liveness question about an adopted node (the adopted ones are added from the live list).
  'tree-obligation.js': { sortNewest: 1 },
  'tree-person-stop.js': { latestGenerationOf: 2 },
  'tree-ready.js': { latestGenerationOf: 3, latestByPath: 1, sortNewest: 2 },       // C2b-1b: bindingOf, heldTargetsOf's iteration, the facts and verdictOf moved onto places; latestByPath 1 = heldTargetsOf's `genOf` (a refinement label names a PATH); sortNewest +1 = bindingOf's fallback for a carrier whose generation is no longer live
  'tree-reuse-load.js': { sortNewest: 1 },
  // C2b-2 fix-up: wholeBranchOf picks the live child INSIDE one parent node@generation's children (a child planned again in place); the path-wide predicate would count the new plan's node on the same path against this branch's child, which is not its replacement.
  'tree-reuse-wire.js': { sortNewest: 1 },
  'tree-root-replan.js': { latestGenerationOf: 1, sortNewest: 1 },
  'tree-stop-view.js': { sortNewest: 2 },
  // RAISED in the K4 commit (C2a-record commit 3): sortNewest 3 -> 4. The new `liveNodesByPath` DEFINES the lineage-aware live set (it sorts a path's live nodes newest first); like `isSupersededGeneration` and `generationOf` it can never reach zero. The other counts are unchanged; the readers move onto the predicate and the helper in C2b, which lowers the OTHER files' entries.
  // C2b-1b: latestByPath 1 -> 2: `liveNodesOf` DEFINES the live set the re-keyed readers iterate (it calls latestByPath once); permanent like the other definitions.
  // RAISED 23 Okt 2026 (red-triage SG-1 unit; the slot fix's dead-frontier block, 35f23f0): latestGenerationOf 11 -> 12. OLD: 11. WHY: foldRecord's era scope reads `const rootNow = latestGenerationOf(state, 'R');` (tree-transitions.js:455): the literal ROOT path, which is never adopted, so the adopted-aware predicate does not apply (a ROOT-ONLY site, like the others kept above). This test was not in the sets that carried 35f23f0; it has been red on every tree since; the box set of e69a2ed found it.
  // RAISED (G7 item 6, 26 Okt 2026, the widened maxGeneration): maxGeneration 2 -> 9. OLD: 2. WHY, the seven sites the old pattern missed (a paren inside the call): ROOT-ONLY: foldRecord's `latestRoot` (abandon), holdabilityOf's
  //   `rootGen`, the root re-plan guard's registered root generation (applyEvent). PERMANENT: `latestGenerationOf`'s own definition. BOOKKEEPING: foldRecord's `maxOpened` (the highest generation a decision OPENED per path).
  //   BY PATH, kept at today's count, not reviewed for adoption here: foldRecord's `plainLatest` (the regenerate-of-a-reused-node slot rule). The count keeps a NEW site from passing.
  //   SCOPED (CR-RC-019, 26 Okt 2026; the count unchanged): pendingBelowOf's `registeredGen` reads only the children registered under a frontier of the node it judges (its lineage), no longer the path anywhere in the tree.
  'tree-transitions.js': { latestGenerationOf: 12, latestByPath: 2, generationOf: 3, sortNewest: 4, maxGeneration: 9 },
});

/** The pure comparison: { file: { pattern: count } } found vs the baseline -> { more: [...], fewer: [...] }. A file the baseline does not list has a baseline of 0, so a NEW file with an idiom is `more`. */
export function diffCounts(found, baseline) {
  const more = []; const fewer = [];
  for (const file of new Set([...Object.keys(found), ...Object.keys(baseline)])) {
    for (const name of Object.keys(PATTERNS)) {
      const have = found[file]?.[name] ?? 0; const base = baseline[file]?.[name] ?? 0;
      if (have > base) more.push(`${file}: ${name} ${have} > ${base}`);
      if (have < base) fewer.push(`${file}: ${name} ${have} < ${base}`);
    }
  }
  return { more, fewer };
}

test('the idioms for "the newest generation of a path" appear exactly where the baseline says (a new one is a path-keyed liveness test the adopted-aware predicate does not see; a removed one means the baseline must be lowered)', () => {
  const found = {};
  const walk = rel => { for (const e of readdirSync(join(root, 'src', rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(r);
    else if (e.name.endsWith('.js')) { const counts = countSites(readFileSync(join(root, 'src', r), 'utf8')); if (Object.keys(counts).length) found[r] = counts; }
  } };
  walk('');
  const { more, fewer } = diffCounts(found, BASELINE);
  assert.deepEqual(more, [], `${more.join('; ')}\n` + 'a NEW direct "newest generation of a path" comparison: use isSupersededGeneration (adopted-aware) or raise the baseline with the reason');
  assert.deepEqual(fewer, [], `${fewer.join('; ')}\n` + 'a site moved off the idiom: lower the baseline in this commit (the progress is the point)');
});

test('the counter itself: it counts each idiom, strips line comments, and ignores childGenerationOf / closedUnstartedGenerationOf (known-bad input)', () => {
  const bad = [
    "const g = latestGenerationOf(state, 'R/M1');",
    "const m = latestByPath(nodes);",
    "const s = generationOf(state, p);",
    "const n = [...a].sort((a, b) => b.generation - a.generation)[0];",
    "const h = Math.max(0, ...nodes.map(n => n.generation));",
    "const v = Math.max(0, ...[...state.nodes.values()].map(n => n.generation));",       // G7 item 6: a paren inside the call (values()) no longer hides the idiom
    "const o = new Map(nodes.map(n => [n.node, n.generation])); newestOf.has(x);",
  ].join('\n');
  assert.deepEqual(countSites(bad), { latestGenerationOf: 1, latestByPath: 1, generationOf: 1, sortNewest: 1, maxGeneration: 2, newestOf: 1 });
  assert.deepEqual(countSites("// latestGenerationOf(x) in a comment\nconst c = childGenerationOf(state, 1, p); const d = closedUnstartedGenerationOf(state, p);"), {});
});

test('a NEW file is judged against a baseline of 0: an unlisted file with one idiom is `more`, one with none is nothing, a listed file that lost its idioms is `fewer` (a PIN: the behaviour was already so; the in-test known-bad input is the evidence that it can fail)', () => {
  assert.deepEqual(diffCounts({ 'brand-new.js': { sortNewest: 1 } }, { 'tree-ready.js': { latestGenerationOf: 4 } }).more, ['brand-new.js: sortNewest 1 > 0']);
  assert.deepEqual(diffCounts({}, { 'tree-ready.js': { latestGenerationOf: 4 } }), { more: [], fewer: ['tree-ready.js: latestGenerationOf 0 < 4'] });
  assert.deepEqual(diffCounts({ 'tree-ready.js': { latestGenerationOf: 4 } }, { 'tree-ready.js': { latestGenerationOf: 4 } }), { more: [], fewer: [] });
  assert.deepEqual(diffCounts({ 'mcp/new-tool.js': { latestByPath: 2 } }, {}).more, ['mcp/new-tool.js: latestByPath 2 > 0'], 'a file under src/mcp/ with any name counts too');
});
