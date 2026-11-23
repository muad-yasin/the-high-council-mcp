// 0.8.4 D18 (plan A T5.1): a seat asks for project text inside a reply it already writes. A judge's verdict may carry `text_requests: [{ path, lines?, why, objection_id? }]`; this module reads and checks them and numbers
// the list the handling session sees at its next pause. Pure, no I/O, no model call. A request is data a seat wrote: it is folded to one line and marked untrusted before a person or the session reads it, and
// `objection_id` is kept only when it is an id that same seat raised.
import { held } from './held-roles.js';
import { containerText } from './container-text.js';
import { parseLineRange } from './excerpt-extract.js';

export const REQUEST_KEYS = ['path', 'lines', 'why', 'objection_id'];
/** A line range as the record writes it: `a-b` (a single line `n` is `n-n`), or null for a whole file or anything unreadable. */
export const normLines = v => { if (v === undefined || v === null || String(v).trim() === '') return null; const r = parseLineRange(v); return r && r.b !== null ? `${r.a}-${r.b}` : null; };
const oneLine = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const MAX_PATH = 300; const MAX_WHY = 500; const MAX_ID = 60;

/**
 * -> { requests, dropped }. `raw` is whatever the reply carried under `text_requests`; `ownIds` the ids that seat raised in the same reply. An entry that is not an object, has no path or no why, or whose lines cannot be a
 * range is dropped (listed in `dropped` with the reason, for the run log); an objection_id that is not one of the seat's own is set to null (the request stays). Unknown keys are ignored.
 */
export function readTextRequests(raw, { ownIds = [] } = {}) {
  if (raw === undefined || raw === null) return { requests: [], dropped: [] };
  if (!Array.isArray(raw)) return { requests: [], dropped: ['text_requests is not a list'] };
  const own = new Set(ownIds); const requests = []; const dropped = [];
  raw.forEach((r, k) => {
    const n = k + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { dropped.push(`request ${n} is not an object`); return; }
    const path = oneLine(r.path).slice(0, MAX_PATH); const why = oneLine(r.why).slice(0, MAX_WHY);
    if (!path) { dropped.push(`request ${n} has no path`); return; }
    if (!why) { dropped.push(`request ${n} has no why`); return; }
    const lines = normLines(r.lines);
    if (lines === null && r.lines !== undefined && r.lines !== null && oneLine(r.lines) !== '') { dropped.push(`request ${n} has lines that are not "a-b" or "n"`); return; }
    const id = typeof r.objection_id === 'string' && own.has(r.objection_id.trim()) ? oneLine(r.objection_id).slice(0, MAX_ID) : null;
    requests.push({ path, lines, why, objection_id: id });
  });
  return { requests, dropped };
}

/** The list for one pause: the requests of the round, each with its number (1, 2, ...) and the key of the seat that asked. -> [{ n, requested_by, objection_id, path, lines, why }] */
export const numberRequests = list => list.map((r, i) => ({ n: i + 1, requested_by: r.requested_by, origin: r.origin ?? null, objection_id: r.objection_id ?? null, path: r.path, lines: r.lines ?? null, why: r.why }));

/** The block in NEEDS-<stage>.md for the handling session (held words D18-w3); '' while unrecorded or when there is no request. Seat-written values are folded to one line and marked untrusted. */
export function needsRequestsBlock(requests) {
  const render = held('textRequestsList');
  if (typeof render !== 'function' || !Array.isArray(requests) || !requests.length) return '';
  const safe = requests.map(r => ({ n: r.n, requested_by: containerText(oneLine(r.requested_by)), objection_id: r.objection_id ? containerText(oneLine(r.objection_id)) : null, path: containerText(oneLine(r.path)), lines: r.lines ? containerText(oneLine(r.lines)) : null, why: containerText(oneLine(r.why)) }));
  return `${render({ requests: safe })}\n\n`;
}

/**
 * 0.8.4 D18 (plan A T5.1, F5): the notices a requesting seat reads in its next prompt: one line per request of that seat that got no text: declined by the session (or refused by the person at an approval), left unanswered,
 * or withheld (the person dropped the text). Pure; `entries` = the excerpt lines, `seatKey` = the asking seat's key, matched EXACTLY (one seat key may be the start of another), `shown` = a function saying whether an entry's
 * answering stage has been recorded in this run. -> [{ id, line }]; a line whose words are not recorded is left out.
 */
export function noticeLines(entries, seatKey, shown = () => true) {
  const out = [];
  for (const e of entries || []) {
    if (!e || e.request_kind !== 'seat_request' || e.requested_by !== seatKey || !shown(e)) continue;
    const a = e.approval?.status; const facts = { path: e.path, lines: e.lines, reason: e.approval?.reason };
    const name = a === 'refused' ? (e.approval?.actor === 'main-session' ? 'excerptDeclinedNotice' : 'excerptRefusedNotice') : a === 'unanswered' ? 'excerptUnansweredNotice' : a === 'not_cut' ? 'excerptNotCutNotice' : a === 'withheld' ? 'excerptWithheldNotice' : null;
    const text = name ? held(name)?.(facts) : null;
    if (typeof text === 'string' && text) out.push({ id: e.id, line: text });
  }
  return out;
}

/** The identity of a request across a run: the seat, the reply that carried it, what it asked for and why. Two identical requests of different replies are two requests. */
export const requestKey = r => [r.requested_by, r.origin ?? '', r.path, normLines(r.lines) ?? '', r.why, r.objection_id ?? ''].join('\u0000');
