// The ONE rule for a dollar figure read back out of a run folder's files (0.8.3 M6, Builder D; Batch 1 audit item 10, Batch 3 entry 14). A leaf module, so that src/spend.js and src/superseded.js
// (which spend.js imports) share it without a cycle.
//   absent (undefined)  -> 0       an external stage, a file from before costs were recorded: $0 on purpose
//   a finite number >= 0 -> itself  (src/cost.js readUsd's rule)
//   anything else PRESENT -> null   UNKNOWN: null (what JSON.stringify writes for a NaN), a string (it used to be concatenated: "0.5" + 1 = "0.51"), a negative number (it used to lower a total),
//                                   NaN, Infinity, an object. Never read as 0 and never added; the caller counts it and says where it is.
import { readUsd } from './cost.js';

export const usdFigure = v => (v === undefined ? 0 : v === null ? null : readUsd(v));
