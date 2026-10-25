// The explicit "off" state of the held prompts the 0.8.3 re-record switches on (decider-readiness unit, 24 Okt 2026; C&C thcmcp-cd). `setHeldForTest(null)` means "no override", so once src/roles.js records a name, held(name) returns the REAL
// function and a test that proves the off path (prompt_held, no early finish, no envelope) would run the feature instead. src/held-roles.js honours `{ name: undefined }` (Object.hasOwn), so these maps keep the names off whatever roles.js holds.
// The names are DERIVED from the drafted files, never typed here: the conflict decider (3), early finish (2) and the 11 of held-083.js that are not the notes lane's four (the same filter as test/held-prompts.test.js, `!(n in HNOTES)`), 16 in all;
// a sentence added to any of them is off in every map from then on. withHeldOff(map) is the merge form for a test that also injects other names (setHeldForTest replaces the whole map).
import * as HDEC from '../held-prompts/held-083-decider.js';
import * as HEARLY from '../held-prompts/held-083-early.js';
import * as H083 from '../held-prompts/held-083.js';
import * as HNOTES from '../held-prompts/held-083-notes.js';

export const HELD_OFF_NAMES = Object.freeze([...Object.keys(HDEC), ...Object.keys(HEARLY), ...Object.keys(H083).filter(n => !(n in HNOTES))]);
export const HELD_OFF = Object.freeze(Object.fromEntries(HELD_OFF_NAMES.map(n => [n, undefined])));
export const withHeldOff = (map = {}) => ({ ...HELD_OFF, ...map });
