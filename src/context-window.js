// 0.8.4 S16 (H; Muad 09 Nov 2026): the input window W of a seat's model, in tokens, from src/context-windows.json (written by scripts/refresh-context-windows.mjs), and the room rule of the final read.
// An OpenRouter seat has a W from the router's list; a DIRECT Anthropic seat from the documented figure typed in the table; any other seat, and a model missing from the table, has none: null means NO room check, the final read reads as before.
import { readFileSync } from 'node:fs';
import { promptTokensOfChars } from './cost.js';

let TABLE = null;
const table = () => (TABLE ??= JSON.parse(readFileSync(new URL('./context-windows.json', import.meta.url), 'utf8')));
let override = null;   // test seam: seat -> tokens | undefined (undefined falls through to the table)
export const setContextWindowsForTest = fn => { override = typeof fn === 'function' ? fn : null; };
export const contextWindowOf = seat => {
  if (override) { const o = override(seat); if (o !== undefined) return o; }
  if (typeof seat?.model !== 'string') return null;
  const w = seat.provider === 'openrouter' ? (table().models?.[seat.model] ?? directWindowOfRouted(seat.model)) : seat.provider === 'anthropic' ? table().direct?.[`anthropic/${seat.model}`] : null;
  return Number.isInteger(w) && w > 0 ? w : null;
};
// 0.8.4 (the Claude route): a Claude model reached through OpenRouter ("anthropic/claude-fable-5.2") with no row of its own in `models` reads the DIRECT model's row ("anthropic/claude-fable-5-2" in `direct`): the same model, only the route differs, and
// the router's windows for the four shipped Claude models equal the direct figures (read 10 Nov 2026). The id changes the way src/stage-system.js modelIdentity does for a `claude-` id (dots to hyphens). Any other model gets no fallback.
const directWindowOfRouted = model => (typeof model === 'string' && model.startsWith('anthropic/claude-') ? table().direct?.[model.replace(/\./g, '-')] : undefined);
/**
 * The seats of a roster that are Claude models reached through OpenRouter and have NO window at all (neither their own row nor the direct model's): the final read's room check is skipped for them, as it is for any seat with no row.
 * -> the distinct model ids, sorted. The start log and the dry run say so by name before anything is paid (src/claude-route.js's caller). Pure over the seats it is given.
 */
export const routedSeatsWithoutWindow = seats => [...new Set((seats ?? []).filter(s => s && s.provider === 'openrouter' && s.originalProvider === 'anthropic' && typeof s.model === 'string' && contextWindowOf(s) === null).map(s => s.model))].sort();
/**
 * The room rule: a part's WHOLE prompt (system text plus user text, at chars/4: cost.js promptTokensOfChars, the harness's one estimator) plus the cap the call is sent at must fit in HALF of the window W. Pure.
 * `promptChars`: the whole prompt of the call; `sentCap`: the maxTokens the call is sent with.
 */
export const fitsHalfWindow = (windowTokens, promptChars, sentCap) => Number.isInteger(windowTokens) && windowTokens > 0 && promptTokensOfChars(promptChars) + sentCap <= Math.floor(windowTokens / 2);
/** The line the start log and the dry run print for each model `routedSeatsWithoutWindow` names. A-DRAFT (wording row SW2-w5). */
export const skippedRoomLines = models => (models ?? []).map(m => `No input window is known for ${m}, so for that seat the final read does not check whether its prompt fits the window.`);
