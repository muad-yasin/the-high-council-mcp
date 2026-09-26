// Text on its way to the terminal and run.log, made safe to print (security scan 2026-09-26, THC #9).
//
// Log lines quote model output: verdict lines, objections, answers, reasons. A reply holding an
// escape sequence could recolour, move the cursor, retitle or clear the operator's terminal, or
// hide or rewrite what the log says; a carriage return overprints a line, and a bidi override
// shows text in an order other than the one on disk. This removes C0 controls other than newline
// and tab, DEL, C1 controls, and the bidi embeddings, overrides, isolates and marks. It is applied
// to log output only: stage files and everything sent to a seat keep the text exactly as it was.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F؜‎‏‪-‮⁦-⁩]/g;

export function terminalSafe(text) {
  return String(text).replace(UNSAFE, '');
}
