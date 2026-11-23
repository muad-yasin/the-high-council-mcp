// The Scope ledger lives in its own file, not in the plan the judges grade (ROADMAP 138, 0.8.4; owner, 28 Okt 2026: "No, move it to its own file").
//
// ONE SWITCH, a ONE-WAY DOOR, not a toggle: everything here that changes behaviour is on only while `held('proposalsSectionLedgerOut')` returns a function, i.e. once src/roles.js
// exports `proposalsSectionLedgerOut` (the one ROLES_SHA256 re-record after the owner's yes on the wording; until then the drafted words are test data in test/held-prompts/held.js).
// Off: every prompt, every draft and every report is byte-identical to before. On: the ledger block is taken off every writer's reply, kept in `scope-ledger.md`, scored from there,
// and checked ($0, informational) after every writer stage. After the re-record the legacy path stays only for old run folders and a draft handed in.
//
// This module holds the pieces so nothing is spelt twice: the ledger-line pattern (the strip and the scorer share ONE builder, so a block the scorer can read is a block the strip takes
// off the plan), the trailing-block taker (called from parseDisputes, the one reader every builder/reviser text goes through), the id check, and the prompt-section swap.
import * as R from './roles.js';
import { held } from './held-roles.js';

export const ledgerOutOn = () => typeof held('proposalsSectionLedgerOut') === 'function';

export const SCOPE_LEDGER_FILE = 'scope-ledger.md';

export const LEDGER_STATUSES = Object.freeze(['accepted', 'cut', 'withdrawn']);

/**
 * The source of ONE regular expression for a ledger line: an optional bullet or emphasis, the id, a dash or colon (hyphen, en dash, em dash), the status (bold or not),
 * another optional dash or colon, then the rest of the line. Groups: 1 = id, 2 = status, 3 = the rest. `idSource` is the id's pattern: the default matches any id (the strip),
 * and the scorer passes one proposal's escaped id. Flags are the caller's ('i', plus 'm' when it searches a whole text).
 */
export function ledgerLineSource(idSource = '\\S+?') {
  return `^[\\s*_\`-]*(${idSource})[\`*_]*\\s*[-:\\u2013\\u2014]\\s*\\**(${LEDGER_STATUSES.join('|')})\\**\\s*[-:\\u2013\\u2014]?\\s*(.*)$`;
}
const GENERIC_LEDGER_LINE = new RegExp(ledgerLineSource(), 'i');

/** One ledger line as `{ id, status, note }`, or null when the line is not one. */
export function parseLedgerLine(line) {
  const m = GENERIC_LEDGER_LINE.exec(String(line));
  return m ? { id: m[1], status: m[2].toLowerCase(), note: m[3].trim() } : null;
}

// The heading: `## Scope ledger`, `## 9. Scope ledger` (both seen in real runs), or a bold line.
const LEDGER_HEADING = /^[ \t]*(?:#{1,6}[ \t]*|\*\*[ \t]*)(?:\d+\.[ \t]*)?Scope ledger[ \t]*:?[ \t]*(?:\*\*)?[ \t]*:?[ \t]*$/i;
/** How many lines under the heading may be something other than a ledger line (an introductory sentence was seen in 3 of 183 real ledgers). OPEN for C&C's ruling. */
export const LEDGER_PROSE_MAX = 3;

/**
 * The trailing Scope ledger block of a reply, given its lines. The block starts at the LAST ledger heading and runs to the end; it is taken when it holds at least one ledger line,
 * no other heading and at most LEDGER_PROSE_MAX other lines (a plan is never cut for a heading that merely looks like the ledger). Returns `{ taken: true, rest, block }` (block =
 * the heading and everything under it, raw lines), `{ taken: false, notTaken: <reason> }` when a ledger heading is there but the block was left in the plan (a named finding, never
 * silence), or `{ taken: false }` when there is no such heading.
 */
export function takeLedgerBlock(lines) {
  let end = lines.length;
  while (end > 0 && lines[end - 1].trim() === '') end--;
  let h = -1;
  for (let i = end - 1; i >= 0; i--) if (LEDGER_HEADING.test(lines[i])) { h = i; break; }
  if (h < 0) return { taken: false };
  const body = lines.slice(h + 1, end).filter(l => l.trim() !== '');
  if (body.some(l => /^[ \t]*#{1,6}[ \t]/.test(l))) return { taken: false, notTaken: 'another heading follows it' };
  const entries = body.filter(l => parseLedgerLine(l));
  if (!entries.length) return { taken: false, notTaken: 'no line under it is a ledger line' };
  if (body.length - entries.length > LEDGER_PROSE_MAX) return { taken: false, notTaken: `${body.length - entries.length} lines under it are not ledger lines` };
  return { taken: true, rest: lines.slice(0, h), block: lines.slice(h, end) };
}

// A-DRAFT (public text: findings reach report.json `lints`, the log and WARNINGS.md). Not recorded until the owner approves the batch; reachable only through the switch above.
export const LEDGER_MESSAGES = Object.freeze({
  missing: id => `proposal "${id}" has no line in the scope ledger`,
  duplicate: id => `proposal "${id}" has more than one line in the scope ledger`,
  unknown: id => `the scope ledger has a line for "${id}", which is not a proposal of this run`,
  dropped: (stage, id) => `stage "${stage}" returned a scope ledger with no line for proposal "${id}"`,
  none: (stage, earlier) => `stage "${stage}" was asked for a scope ledger and wrote none${earlier ? `; the ledger stays the one written by "${earlier}"` : '; there is no scope ledger'}`,
  notTaken: (stage, why) => `stage "${stage}" ended with a "Scope ledger" heading that was left in the plan: ${why}`,
});

/**
 * The id check on a ledger (the lines of the block or the file): every proposal id has exactly one line, and no line names an id that is not a proposal. Ids compare without case, as
 * the scorer does. Returns `[{ id: 'ledger_id', message }]`, one per problem, the same objects the flag-gated lint (src/lints.js) returns, so one problem is never reported twice.
 */
export function ledgerIdFindings(lines, proposals) {
  const entries = lines.map(parseLedgerLine).filter(Boolean);
  const count = new Map();
  for (const e of entries) count.set(e.id.toLowerCase(), (count.get(e.id.toLowerCase()) || 0) + 1);
  const ids = (proposals || []).filter(p => p && p.id).map(p => String(p.id));
  const known = new Set(ids.map(i => i.toLowerCase()));
  const out = [];
  for (const id of ids) {
    const n = count.get(id.toLowerCase()) || 0;
    if (n === 0) out.push({ id: 'ledger_id', message: LEDGER_MESSAGES.missing(id) });
    else if (n > 1) out.push({ id: 'ledger_id', message: LEDGER_MESSAGES.duplicate(id) });
  }
  for (const e of entries) if (!known.has(e.id.toLowerCase())) out.push({ id: 'ledger_id', message: LEDGER_MESSAGES.unknown(e.id) });
  return out.filter((f, i) => out.findIndex(g => g.message === f.message) === i);
}

/**
 * The prompt a writer is sent, with its proposals section replaced by the held one. roles.js is pinned byte for byte, so chain.js renders the prompt as before and this swaps the one rendered
 * section (R.proposalsSection) for the held wording, in the same place. A prompt that carries no section (a reviser called without proposals renders '') is returned as it is; a prompt that
 * should carry it and does not throws, so the old wording is never kept silently. Plain slicing, never String.replace: the section embeds the debate board, which is model text, and a `$&` or
 * `$'` in it must stay literal.
 */
export function swapProposalsSection(prompt, proposals, board = null) {
  const render = held('proposalsSectionLedgerOut');
  if (typeof render !== 'function') return prompt;
  const old = R.proposalsSection(proposals, board);
  if (!old) return prompt;
  const at = prompt.indexOf(old);
  if (at < 0) throw new Error('scope ledger: the writer prompt does not carry the proposals section it should, so the scope-ledger wording cannot replace it');
  return prompt.slice(0, at) + render(proposals, board) + prompt.slice(at + old.length);
}

/** The text of scope-ledger.md: the stage that wrote the ledger (and the writers before it) on top, then the ledger block as the writer wrote it. */
export function scopeLedgerFile({ by, earlier = [], lines }) {
  return `Written by stage: ${by}${earlier.length ? ` (earlier writers: ${earlier.join(', ')})` : ''}\n\n${lines.join('\n')}\n`;
}
