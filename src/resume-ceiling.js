// The ceiling a resume needs to get PAST a budget stop (cost-unit U1 split, 14 Oct 2026). A leaf module (the src/usd-figure.js pattern): src/cli.js (the printed resume command) and src/run-status.js (run_status's `suggestedMaxUsd`) share this
// one copy, so an MCP client following the guidance cannot stop at the same stage again.
//   resumeCeilingUsd({ cap, spent, projected }) -> number | null
// `spent` is what the cap has already COUNTED (replayed worst-case charges included, so it can exceed `cap`), `projected` the stage that stopped; the answer is above both, rounded up to the cent. null when a figure is not a finite number
// (a hand-edited or old STOPPED-budget.json): the caller keeps its own fallback and never throws on a stop path.
export function resumeCeilingUsd({ cap, spent, projected }) {
  if (![cap, spent, projected].every(Number.isFinite)) return null;
  return Math.ceil((Math.max(cap, spent) + projected) * 100) / 100;
}
