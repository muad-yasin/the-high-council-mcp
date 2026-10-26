// What a tree on two chains could cost at the default limits, BEFORE anything is written or spent: the pure half of `council tree start --dry-run` (0.8.3 M6, ROADMAP 56; contract
// Review/Build_0.8.3/m6-closing/ROADMAP56_Tree_Start_DryRun_Contract.md). No file or network access, and no clock of its own EXCEPT through `priceTableLines()` (src/cost.js), which reads the clock for the "(N days ago)" age of the price table: the caller hands it two resolved chain configs, the root task's size and the limits.
//
// Contract: projectTree({ root: { name, config, taskChars }, child: { name, config }, limits, capUsd }) -> { limits, capacity, subPlans, runs, root, child, total, capNote }
//   root, child   { name, priced, unpriced: [{ provider, model, roles }], expectedUsd, maximumUsd, cheapestUsd (child), taskTokens (root), externalStages, stages }; the figures are null when priced is false
//   total         { expectedUsd, maximumUsd } = root + subPlans x child, or null when either chain has an unpriced seat (a sum that leaves a seat out reads as complete)
//   capNote       'root' | 'tree' | 'above' | null (null: no cap given)
// projectionLines(p, { capUsd }) -> the person-facing lines. Every dollar figure on them is labelled PROJECTED.
//
// Where every number comes from:
//  - the figures: src/dry-run.js `dryRunReport(config).estimate`, the report behind `chainFigures` (src/tree-budget.js), so the sub-plan's at-most printed here IS the figure admission caps a grant at.
//    The root's own figures use the `...WithTask` pair when the task is larger than the chain assumes.
//  - the number of runs: depth and fan-out first (a node at maxDepth cannot split: src/tree-budget.js admitAgainstLimits refuses `depth > maxDepth`), so a tree holds at most
//    capacity = sum for d = 0..maxDepth of maxChildrenPerSplit^d runs; then the run limit: runs = min(maxRuns, capacity), of which one is the root. maxRuns counts every registered run, a replacement generation included.
//  - the cap sentences: the tree's own admission rule (src/tree-budget.js proposeGrants): each sub-plan is offered min(its at-most, free / k) and is admitted only when that reaches the chain's cheapest end.
//    The sentences say what the rule does at a low cap; none predicts how many sub-plans will run.
// "At most" is true for ONE CLEAN PASS of each chain AT ITS ASSUMED PROMPT SIZES, at the default limits, before any root re-plan or top-up. There are two ways past the printed figure, and the lines say so where it is printed:
//  1. the prompt size: the estimate prices every call at the chain's assumed input size (config.estimate; ROADMAP 60), so a real prompt larger than that costs more in a clean pass. A sub-plan is held to its grant, but the ROOT is registered
//     with the WHOLE cap as its grant (test/tree-start.test.js S5-1), so nothing stops the root short of the cap;
//  2. a top-up (src/tree-budget.js `topUp`) checks only that the root cap still has the money free, not the node's chain at-most, and a call that was in flight when a process died stays charged at its worst case and is
//     sent again on the resume (src/spend-reservations.js), so a topped-up node can spend past its chain's at-most.
import { dryRunReport } from './dry-run.js';
import { estimateChainRows, formatUsd, priceTableLines } from './cost.js';
import { unpricedSeats } from './unpriced.js';
import { formatCouncilError } from './errors.js';
import { DEFAULT_LIMITS } from './tree-record.js';

/** The most runs the depth and fan-out limits allow: 1 + f + f^2 + ... + f^maxDepth. */
export const treeCapacity = limits => Array.from({ length: limits.maxDepth + 1 }, (_, d) => limits.maxChildrenPerSplit ** d).reduce((a, b) => a + b, 0);

function figuresOf({ name, config, taskChars }) {
  const unpriced = unpricedSeats(config);
  const est = dryRunReport(config, taskChars == null ? {} : { taskChars }).estimate;
  const maximumUsd = est.maximumWithTaskUsd ?? est.maximumUsd; const expectedUsd = est.expectedWithTaskUsd ?? est.expectedUsd;
  const priced = unpriced.length === 0 && Number.isFinite(maximumUsd) && Number.isFinite(expectedUsd) && Number.isFinite(est.floorUsd);
  const rows = estimateChainRows(config);
  return {
    name, priced, unpriced: unpriced.map(u => ({ provider: u.provider, model: u.model, roles: u.roles })),
    expectedUsd: priced ? expectedUsd : null, maximumUsd: priced ? maximumUsd : null, cheapestUsd: priced ? (est.floorWithTaskUsd ?? est.floorUsd) : null,
    taskTokens: taskChars == null ? null : Math.ceil(taskChars / 4),
    externalStages: rows.filter(r => r.seat.startsWith('external/')).reduce((n, r) => n + (r.times ?? 1), 0), stages: rows.reduce((n, r) => n + (r.times ?? 1), 0),
  };
}

export function projectTree({ root, child, limits = DEFAULT_LIMITS, capUsd = null }) {
  const capacity = treeCapacity(limits);
  const runs = Math.min(limits.maxRuns, capacity); const subPlans = runs - 1;
  const r = figuresOf(root); const k = figuresOf(child);
  const total = r.priced && k.priced ? { expectedUsd: r.expectedUsd + subPlans * k.expectedUsd, maximumUsd: r.maximumUsd + subPlans * k.maximumUsd } : null;
  const capNote = capUsd === null || !total ? null : capUsd < r.maximumUsd ? 'root' : capUsd < total.maximumUsd ? 'tree' : 'above';
  return { limits, capacity, runs, subPlans, root: r, child: k, total, capNote };
}

const CONDITIONS = 'one clean pass of each chain at its assumed prompt sizes, at the default limits, before any root re-plan or top-up';

export function projectionLines(p, { capUsd = null } = {}) {
  const lines = [`Tree cost, PROJECTED, ${CONDITIONS} (nothing was started, written or spent):`];
  const row = (label, f, extra) => lines.push(f.priced
    ? `  ${label}  ${f.name}   PROJECTED expected ${formatUsd(f.expectedUsd)}, upper estimate ${formatUsd(f.maximumUsd)}${extra(f)}`
    : `  ${label}  ${f.name}   not priced`);
  row('root plan  ', p.root, f => `   (one run${f.taskTokens ? `; your task is about ${f.taskTokens} tokens` : ''})`);
  row('sub-plan   ', p.child, f => `, cheapest end ${formatUsd(f.cheapestUsd)}   (per run, at the chain's assumed sizes; cheapest end: the least one run is projected to cost)`);
  for (const f of [p.root, p.child]) {
    for (const u of f.unpriced) {
      lines.push(`  ${f.name}: the seat ${u.provider}/${u.model} is not priced: no total for the whole tree can be given (council tree start refuses a chain with an unpriced seat).`);
      lines.push(...formatCouncilError('COUNCIL-E002', { provider: u.provider, model: u.model, roles: u.roles, ...(capUsd !== null ? { capUsd } : {}) }).split('\n').map(l => `  ${l}`));
    }
    if (f.externalStages) lines.push(`  ${f.name}: ${f.externalStages} of ${f.stages} stages are answered by external seats (a person or another session) and are not in these figures.`);
  }
  // E42 (fix-up after the advisor): the "at most" explanation prints once, after the rows, whenever ANY row shows an "at most" (a tree whose other chain is unpriced has no whole-tree row, but its priced row still says "at most").
  let explained = false;
  const explain = () => {
    if (explained || !(p.root.priced || p.child.priced)) return;
    explained = true;
    lines.push('  The upper estimate is the largest figure this projection reaches, not a ceiling: the cap you give (--max-usd) is what stops spending.');
  };
  if (p.total) {
    lines.push(`  whole tree  PROJECTED, ${CONDITIONS} (${p.runs} runs: the root + ${p.subPlans} sub-plans)   expected ${formatUsd(p.total.expectedUsd)}, upper estimate ${formatUsd(p.total.maximumUsd)}`);
    explain();   // E42 (final wording, pass 2)
    if (p.capNote === 'root') lines.push(`  Your cap ${formatUsd(capUsd)}: the root run alone can spend more than this cap; it may stop at the cap before its plan is finished (its PROJECTED upper estimate is ${formatUsd(p.root.maximumUsd)}).`);
    else if (p.capNote === 'tree') lines.push(`  Your cap ${formatUsd(capUsd)}: the tree counts its spend against the cap and admits a sub-plan only when its share of the money still free reaches the cheapest end of its chain (${formatUsd(p.child.cheapestUsd)}, PROJECTED); at this cap fewer sub-plans run, or run on a grant that may stop them before they finish.`);
    else if (p.capNote === 'above') lines.push(`  Your cap ${formatUsd(capUsd)}: the cap is above the largest this projection reaches (PROJECTED upper estimate ${formatUsd(p.total.maximumUsd)}); a run can still reach the cap through calls this projection leaves out.`);
  }
  explain();   // no whole-tree row: after the rows all the same
  lines.push(...priceTableLines().map(l => `  ${l}`));
  lines.push('Not checked here: API keys, the key scan and the personal-data check of the task (council tree start asks them). A raised limit (council tree decide --max-runs) allows more runs than this, and a re-planned root runs the root chain, which this counts as a sub-plan.');
  return lines;
}
