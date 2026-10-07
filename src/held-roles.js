// The seam for prompt sentences that are DRAFTED but not yet recorded (0.8.2 wiring block). Code only: no prompt words live here, and none may (src/roles.js is the one home of every prompt).
//
// How it works. A call site in src/chain.js that will show a seat new text asks `held('<name>')` for the function that renders it. Until the one ROLES_SHA256 re-record puts that function into
// src/roles.js as an export of that name, `held` returns undefined and the call site adds nothing, so every prompt stays byte-identical (test/prompt-pin.test.js). After the re-record the
// same call site renders the recorded text: the wiring, the parser's side of it and the door tests were proven before, with the drafted words injected through `setHeldForTest`.
// The drafted words live in test/held-prompts/ (test data, never shipped); test/held-prompts.test.js refuses a state where a name is in roles.js but its text differs from the drafted one.
//
// `setHeldForTest` is a test seam, the same kind as setStopCheck: no code under src/ may call it (test/held-prompts.test.js scans for that).
import * as R from './roles.js';

let overrides = null;

/** The function that renders a held sentence, or undefined while it is not part of src/roles.js. */
export const held = name => {
  const f = overrides && Object.hasOwn(overrides, name) ? overrides[name] : R[name];
  return typeof f === 'function' ? f : undefined;
};

/** Tests only: `{ name: fn }` makes `held(name)` return fn; null removes every override. */
export function setHeldForTest(map) { overrides = map && typeof map === 'object' ? map : null; }
