// The total a resume needs for the next call to a model to be sent after a budget stop (cost-unit U1 split, 14 Oct 2026). A leaf module (the src/usd-figure.js pattern): src/cli.js (the printed resume command) and src/run-status.js (run_status's `suggestedMaxUsd`) share this
// one copy, so an MCP client following the guidance cannot stop at the same stage again.
//   resumeCeilingUsd({ cap, spent, projected, gate }) -> number | null   (`gate`: the record's gateStageUsd, optional)
// `spent` is what the cap has already COUNTED (replayed worst-case charges included, so it can exceed `cap`), `projected` the stage that stopped; the answer is above both, rounded up to the cent. null when a figure is not a finite number
// (a hand-edited or old STOPPED-budget.json): the caller keeps its own fallback and never throws on a stop path.
import { smallestCapThatPasses } from './cost.js';
export function resumeCeilingUsd({ cap, spent, projected, gate }) {
  if (![cap, spent, projected].every(Number.isFinite)) return null;
  // S5-05 (owner's pick, 28 Okt 2026): a record that carries the gate's own figure (`gateStageUsd`) names the EXACT total: the spend the resume starts from plus the figure the gate decided on, through the one predicate
  // (smallestCapThatPasses, which wouldBreach agrees with). A record written before the field has only the worst case and keeps its old figure, `above both`, which over-states by cap - spent.
  if (Number.isFinite(gate)) { const exact = smallestCapThatPasses(spent, gate); return Number.isFinite(exact) ? exact : null; }
  return Math.ceil((Math.max(cap, spent) + projected) * 100) / 100;
}
