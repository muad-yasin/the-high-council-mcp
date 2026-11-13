// 0.8.4 D27: the lines around the draft in a judge's user prompt and the final read's. Their words are HELD (test/held-prompts/held-084-d27.js, WORDING_0.8.4.md D27-w1, D27-w2) and recorded together with the
// end line (DRAFT_END_MARKER, already in src/prompts/core.js) at the release, so no run ever shows half a boundary: the gate is the chain's switch `draft_end_marker { enabled }` AND both held names recorded.
// Read by src/chain.js (the gate once per run, the bounded draft at every call site that builds a judge's user prompt). The bounded draft is handed to the SAME prompt builder as its `draft` argument, so the builder's own
// head (criticUserHead) and tail contract hold with the lines on and off (Review/084/cnc/Boundary_DraftEnd.md); with the gate off the draft comes back unchanged.
import { held } from './held-roles.js';
import { promptCacheTtl } from './prompt-cache.js';

export const DRAFT_BOUNDARY_WORDS = ['draftStartLine', 'draftBoundarySentence'];
export const draftBoundaryWordsOn = () => DRAFT_BOUNDARY_WORDS.every(n => typeof held(n) === 'function');
// 0.8.4 cache part (b)2, R2 = (c) (Muad, 10 Nov 2026 16:23: "R2: c"): where the chain's prompt_cache switch is on the plan's start and end lines are ALWAYS sent, whatever the chain's own draft_end_marker says, a person's own chain included: the cache-shaped order puts the plan at the head of every judge call, and a head that ends in raw plan text would let the instructions below it read as part of the plan. A chain without caching keeps its own switch, as before.
export const draftBoundaryOn = config => (config?.draft_end_marker?.enabled === true || promptCacheTtl(config) !== null) && draftBoundaryWordsOn();

/** The draft with the sentence and the start line in front of it, or the draft itself while `on` is false. `on` true with a word missing is a bug in the caller: it throws instead of sending half a boundary. */
export function boundedDraft(draft, on) {
  if (!on) return draft;
  if (!draftBoundaryWordsOn()) throw new Error('draft boundary: the lines are on but the words of the start line and the sentence are not both recorded');   // A-DRAFT (internal; cannot be reached through draftBoundaryOn): WORDING D27-w7
  return `${held('draftBoundarySentence')()}\n\n${held('draftStartLine')()}\n\n${draft}`;
}
