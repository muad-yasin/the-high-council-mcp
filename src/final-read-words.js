// 0.8.4 S16 (G2a): the ONE gate of the final read's own wording (W31 and W32; WORDING S16-w14, w16b, w17, w19). All four held names are recorded together, or the final read and the climb keep W7 and S8's list and form, byte for byte.
// Read by src/stage-system.js (the system text), src/chain.js (the user text, the readers) and src/cost.js (the price). The batch must not be recorded before the `concern` reader (I) and the prompt call site have merged.
import { held } from './held-roles.js';

export const FINAL_READ_WORDS = ['finalReadRule', 'finalReadSortingForm', 'finalReadSortingItems', 'lateFindingRatingSentence'];
export const finalReadWordsOn = () => FINAL_READ_WORDS.every(n => typeof held(n) === 'function');
