// COUNCIL_MAX_USD_LIMIT bounds a tree's typed dollar amounts too (0.8.3 M6 TREE CEILING unit; C&C ruling 14 Oct 2026 23:28, gate note Review/Build_0.8.3/m6-closing/Tree_Ceiling_Gate_Note.md; Astra #10's "No ceiling: a person at a terminal is the
// authority" is REVERSED for trees). One leaf, no file and no env read: the CEILING is read by src/cli.js (readUsdCeiling) and handed in, so src/tree-member.js and src/tree-start.js stay free of env reads.
//
//   A ceiling is { usd: number | null, source: 'environment' | 'project-env', unreadable: string | null } (src/cli.js readUsdCeiling), or null for "no check" (a free-only tree or member).
//   treeIsPaid(tree, work)                                 any chain the tree registered has a paid seat; a chain that will not load counts as paid (fail closed)
//   typedCeilingRefusal({ capText, capUsd, ceiling })      -> sentence | null: the CLI's own sentence for a typed total above the ceiling (src/cap-input.js ceilingRefusal, the ONE comparison), plus the way out for the SOURCE the person's own process sees
//   amendCeilingArgs(ceiling)                              -> the { ceilingUsd, ceilingSource } parseCapInput takes (src/cap-input.js)
//   memberCeilingRefusal({ key, tree, capUsd, committedUsd, ceiling }) -> { check, detail } | null for the member's start (exit 19 and ONE `blocked`, written by src/tree-member.js)
// THE TREE'S BOUND IS TRANSITIVE: child grants, top-ups and node caps all sit inside the cap in force (src/tree-budget.js lifetimeCapOf), so bounding the cap in force bounds them; an increment is never compared to the ceiling.
import { chainIsPaid } from './start-scope.js';
import { loadChainConfig } from './tree-derive-load.js';
import { MICRO, ceilingRefusal } from './cap-input.js';
import { ceilCents } from './tree-budget.js';

export const CEILING_NAME = 'COUNCIL_MAX_USD_LIMIT';

export function treeIsPaid(tree, work) {
  for (const c of tree?.chains ?? []) {
    try { if (chainIsPaid(loadChainConfig({ tree, depth: c.depth, work }).config)) return true; } catch { return true; }      // an unreadable chain file is never read as "free": fail closed
  }
  return !(tree?.chains?.length > 0);
}

/** The way out, for the commands that run in the PERSON's own process (tree start, decide --amend-cap), where the source is true: the real environment wins over a project .env (src/mcp/usd-limit.js limitSource), so a .env cannot lift what the environment set. */
export const wayOutOfCeiling = source => (source === 'project-env'
  ? `To type more, raise or remove ${CEILING_NAME} in the project's .env.`
  : `To type more, raise or unset ${CEILING_NAME} in the environment you start council from.`);

export function typedCeilingRefusal({ capText, capUsd, ceiling }) {
  if (!ceiling) return null;
  if (ceiling.unreadable) return ceiling.unreadable;
  if (ceiling.usd === null || ceiling.usd === undefined) return null;
  // ONE comparison: src/cap-input.js ceilingRefusal (the CLI's own), micro-dollar integers
  const over = ceilingRefusal(capText, Math.round(capUsd * MICRO), { ceilingUsd: ceiling.usd, ceilingSource: CEILING_NAME });
  if (!over) return null;
  return over.code === 'above_ceiling' ? `${over.sentence.replace(/ Nothing was started\.$/, '')} ${wayOutOfCeiling(ceiling.source)} Nothing was started.` : over.sentence;
}

export const amendCeilingArgs = ceiling => (ceiling && !ceiling.unreadable && ceiling.usd !== null && ceiling.usd !== undefined ? { ceilingUsd: ceiling.usd, ceilingSource: CEILING_NAME } : {});

/**
 * The member's start. WHY THE WAY OUT NAMES BOTH PLACES (do not "fix" this into the two-branch form of typedCeilingRefusal): a member CLI is spawned by the sitting with env = the sitting's process.env (src/api.js runCli), and the sitting already
 * applied the project .env into it (src/cli.js applyEnvFile), so a ceiling set ONLY in the .env arrives as if the operator had set it and limitSource() in the child says "environment". The child cannot tell the two places apart. The ceiling arrives from the member's own CLI process, which inherits a value the sitting may have taken from the project .env, so it cannot know which of the two places set it: the way out names both. The detail is
 * kept under about 340 characters (tree-resume prints the first 400 of the last three output lines, and the refusal's own prefix is about 55). `--amend-cap` is named only when the committed floor, rounded up to the cent, is at or below the ceiling.
 */
export function memberCeilingRefusal({ key, tree, capUsd, committedUsd, ceiling }) {
  if (!ceiling) return null;
  if (ceiling.unreadable) return { check: 'ceiling_unreadable', detail: `${key}: ${ceiling.unreadable.replace(/ Nothing was started\.$/, '')}. Nothing was run.` };
  if (ceiling.usd === null || ceiling.usd === undefined) return null;
  if (!ceilingRefusal(String(capUsd), Math.round(capUsd * MICRO), { ceilingUsd: ceiling.usd, ceilingSource: CEILING_NAME })) return null;      // the same comparison
  const usd = Number(ceiling.usd);
  const amend = ceilCents(committedUsd) <= usd + 1e-9;
  return {
    check: 'ceiling',
    detail: `${key}: the tree's cap in force ($${capUsd}) is above the ceiling in force ($${usd}, ${CEILING_NAME}). ${amend ? `Lower the cap: council tree decide ${tree.treeId} --amend-cap <total up to $${usd}>. Or raise` : 'Raise'} or unset ${CEILING_NAME} where it is set (the environment, or the project's .env).`,
  };
}
