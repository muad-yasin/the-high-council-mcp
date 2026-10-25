// Text on its way to the terminal and run.log, made safe to print (security scan 2026-09-26, THC #9).
//
// Log lines quote model output: verdict lines, objections, answers, reasons. A reply holding an
// escape sequence could recolour, move the cursor, retitle or clear the operator's terminal, or
// hide or rewrite what the log says; a carriage return overprints a line, and a bidi override
// shows text in an order other than the one on disk. This removes C0 controls other than newline
// and tab, DEL, C1 controls, and the bidi embeddings, overrides, isolates and marks. It is applied
// to log output only: stage files and everything sent to a seat keep the text exactly as it was.
import { markHidden } from './hidden-chars.js';
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g;

export function terminalSafe(text) {
  return String(text).replace(UNSAFE, '');
}

// The same characters, written as \uXXXX escapes instead of removed: for a JSON document that is printed (council replay --json). JSON.stringify already escapes the C0 controls but leaves DEL, the C1
// controls and the bidi characters raw; the document still parses to the same data (bug audit 2026-10-24, C-018). One list: UNSAFE above.
export function escapeTerminalUnsafe(text) {
  return String(text).replace(UNSAFE, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

// Text the HARNESS renders from model words and then shows AND hashes as one (a tree gate's text, audit item 7, 0.8.3): the display filter above, then every hidden character
// made visible in place as `[U+XXXX]`, so "the person approved these bytes" is true: they saw where each one sits. An emoji sequence is left alone (src/hidden-chars.js). Author-written
// text a person approves (a contract) is not marked: it is refused when it holds hidden characters, and the quiet joiners are counted on the gate screen instead.
export function terminalSafeMarked(text) {
  return markHidden(terminalSafe(text));
}

