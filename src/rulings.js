// A ruling (B3 prototype, 30 Okt 2026; the person's word via C&C): a decision the person who owns the request gives while a run is paused, shown to the judges from ONE fixed pass on. Pure of the clock, the disk and the terminal.
//
// A ruling is a gate of kind `ruling` (src/gate.js): its TEXT file is the ruling as it was shown to him, headed by the pass it applies from; his answer is recorded with the approval (person_words, verbatim, when the handler session
// relays it). Once approved a ruling stays in force from its pass on, as a pure function of the record and never of the clock, so a later resume rebuilds every prompt exactly as it was. Every reader filters by pass: a prompt for
// pass R carries the rulings with pass <= R and nothing else (a stage that was asked before the ruling existed must keep its prompt byte for byte, or a replay would ask it again for money).

/** The gate text of a ruling: the pass it applies from, then the ruling as shown. */
export const rulingGateText = (pass, text) => `Ruling from pass ${pass}\n\n${String(text).trim()}\n`;

/**
 * Does the person's words CONTAIN the ruling text (S20 slice 2, Q1; C&C's R155)? A ruling is the person's own text: a handler that relays it must bring the person's quoted words, and the ruling must be in them. The comparison, and nothing wider:
 * every run of whitespace on both sides is collapsed to one space and both are trimmed, then plain containment (the words may hold more). "Whitespace" is JavaScript's own `\s`, which includes the non-breaking space and the other Unicode spaces, so that
 * a line wrap from a handler window does not matter. Case and punctuation stay EXACT, and a word split by a hyphen at a line end is a different text and stays refused. The record is NOT normalised: the words are stored as typed.
 */
export const rulingTextInWords = (words, text) => {
  const squash = s => String(s).replace(/\s+/g, ' ').trim();
  const t = squash(text);
  return t !== '' && squash(words).includes(t);
};

/** { pass, text } from the bytes of a ruling gate's text, or null when they are not exactly that shape (a ruling that cannot be read is never dropped silently: the caller refuses). */
export function parseRulingGateText(bytes) {
  const m = /^Ruling from pass (\d+)\n\n([\s\S]*\S)\n$/.exec(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
  if (!m) return null;
  const pass = Number(m[1]);
  return Number.isInteger(pass) && pass >= 1 ? { pass, text: m[2] } : null;
}

/** The rulings a prompt for pass `round` carries: those dated at or before it and not withdrawn from a pass at or before it. A withdrawal is dated at a pass with no stage on disk, so every earlier prompt keeps carrying the ruling (the record keeps both). */
export const rulingsInForce = (rulings, round) => (Array.isArray(rulings) ? rulings : []).filter(r => Number.isInteger(r?.pass) && r.pass <= round && !(Number.isInteger(r?.withdrawn?.from_pass) && r.withdrawn.from_pass <= round));

/** The gate text of a withdrawal (B3 prototype, 31 Okt 2026): the person's decision to take a given ruling out of force from a given pass on. Its own gate kind, `ruling_withdrawal` (src/gate.js). */
export const withdrawalGateText = (gate, pass) => `Withdraw ruling ${gate} from pass ${pass}\n`;

/** { gate, pass } from the bytes of a withdrawal gate's text, or null when they are not exactly that shape. */
export function parseWithdrawalGateText(bytes) {
  const m = /^Withdraw ruling (g[1-9][0-9]{0,5}) from pass (\d+)\n$/.exec(Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes));
  if (!m) return null;
  const pass = Number(m[2]);
  return Number.isInteger(pass) && pass >= 1 ? { gate: m[1], pass } : null;
}

/** The re-tags that apply AT pass `round` (each one takes effect once, at the top of its own pass; the rating it sets stays in force after that through the severity run). */
export const retagsAtPass = (retags, round) => (Array.isArray(retags) ? retags : []).filter(r => Number.isInteger(r?.pass) && r.pass === round);
