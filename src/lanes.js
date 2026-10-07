// Review lanes (0.8.2 item 7; owner 6 Oct 2026: an OPTIONAL chain with one writer and 2-3 reviewers who each carry an assigned duty). A lane is where a reviewer's ATTENTION goes first; it never narrows
// WHAT the reviewer judges: every judge still writes a row for every criterion and still flags a critical problem outside its lane (the audit plan: "lanes create accountability, not blinders").
//
// The words that tell a reviewer its lane are a prompt change: they live in src/roles.js (LANE_TEXT), recorded by the 0.8.2 ROLES_SHA256 re-record (P11), so a seat with `lane` set is told its lane. `laneTextOf` is '' only for no lane or an unknown
// lane (a seat without one runs as a plain panel seat: byte-identical prompts, which test/prompt-pin.test.js keeps honest). Pure; no model call.
import * as R from './roles.js';

export const LANE_IDS = Object.freeze(['correctness_interfaces', 'security_failure', 'implementation_verification']);

// Test seam, same style as setStopCheck / setRetrySleep: a lane text for tests to inject so the wiring can be proven before the real text exists. Null in production; reset it in a finally.
let testTexts = null;
export function setLaneTextsForTest(texts) { testTexts = texts || null; }

/** The paragraph for a lane, or '' (no lane, or an unknown lane). */
export const laneTextOf = lane => { const t = testTexts ?? R.LANE_TEXT ?? {}; return typeof lane === 'string' && Object.hasOwn(t, lane) ? String(t[lane] ?? '') : ''; };

/** A critic's system prompt with its lane paragraph appended. Nothing at all is added when the seat has no lane or the lane has no text: not even a newline. */
export function withLane(seat, system) {
  const text = seat && typeof seat.lane === 'string' ? laneTextOf(seat.lane) : '';
  return text ? `${system}\n\n${text}` : system;
}
