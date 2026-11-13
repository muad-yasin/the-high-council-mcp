// 0.8.4 D38 (plan A T1.4, T5): what the handling session may send with a stage answer, and the one gate of the excerpt channel. The channel has no chain-level switch (excerpts ship in 0.8.4); it is ON only when the
// words a seat or a session reads are recorded in src/roles.js (the block's words and the description of the `session_reads` field), the way the draft boundary is (src/draft-bounds.js). While they are not recorded the
// tool does not offer the field and no prompt changes. A caller that passes the field to submitStageAnswer (src/stage-submission.js) anyway has the WHOLE answer refused (C&C, 09 Nov 2026, Q-a = A); through the MCP tool
// that refusal is NOT reached by a stale client: the SDK drops a key the tool's schema does not list before the handler runs (a question to C&C: `.passthrough()` would change the listed schema for every client).
import { held } from './held-roles.js';
import { parseLineRange } from './excerpt-extract.js';

export const EXCERPT_CHANNEL_WORDS = ['excerptsBlock', 'sessionReadsField'];
export const excerptChannelOn = () => EXCERPT_CHANNEL_WORDS.every(n => typeof held(n) === 'function');
/**
 * 0.8.4 A7 (C&C 09 Nov 2026): can a seat of this run ever be shown an excerpt? Decided ONCE at the start of a run and never per call, so a seat's system text is the same in all of its calls (a clause that appeared at the first
 * excerpt would break every seat's cached prefix). True only when the channel's words are recorded, the chain is not descending, and the chain has a stage a handling session answers: an external
 * seat, or a waiting questions stage. A chain of mock and model seats only can never show one, so its prompts never change. `seatsOf` = the chain's seats (everySeatOf in src/chain.js; passed in to keep this module a leaf).
 */
/** Is the channel usable in this run at all (C&C 09 Nov 2026, D18): its words are recorded, the chain is not descending. Whether a session pause follows a stage is a separate question (src/chain.js). */
export const excerptChannelUsable = config => excerptChannelOn() && !config?.descending;
export const excerptsMayBeShownFor = (config, seatsOf) => excerptChannelOn() && !config?.descending
  && (seatsOf(config).some(s => s?.provider === 'external') || (!!config?.questions && config.questions.wait !== false));
export const SESSION_READ_KEYS = ['path', 'lines', 'why'];
const str = v => typeof v === 'string' && v.trim() !== '';

/** The problems of a `session_reads` value, one phrase each (WORDING D38-w3); [] when it is a list of { path, lines?, why }. Does not throw. */
export function sessionReadsProblems(value) {
  if (!Array.isArray(value)) return ['the value is not a list'];
  const p = [];
  value.forEach((r, k) => {
    const n = k + 1;
    if (!r || typeof r !== 'object' || Array.isArray(r)) { p.push(`entry ${n} is not an object`); return; }
    for (const key of Object.keys(r)) if (!SESSION_READ_KEYS.includes(key)) p.push(`entry ${n} names the field "${key.length > 40 ? `${key.slice(0, 40)}...` : key}", which is not path, lines or why`);
    if (!str(r.path)) p.push(`entry ${n} has no path`);
    if (!str(r.why)) p.push(`entry ${n} has no why`);
    if (r.lines !== undefined && r.lines !== null && (typeof r.lines !== 'string' || r.lines.trim() === '' || !parseLineRange(r.lines))) p.push(`entry ${n} has lines that are not "a-b" or "n"`);
  });
  return p;
}

/** The `session_reads` argument of the MCP tool submit_stage as a zod shape fragment: {} while the channel is off (the field is then absent from the tool's listing), else the one optional field with its recorded description. `z` is passed in so this module needs no zod. It follows the recorded words only (a test hides them). */
export const sessionReadsSchemaFields = z => (excerptChannelOn()
  ? { session_reads: z.array(z.object({ path: z.string(), lines: z.string().optional(), why: z.string() })).optional().describe(held('sessionReadsField')()) }
  : {});

/**
 * 0.8.4 D18 (C&C 09 Nov 2026, the same Q-a pattern as session_reads): the optional `excerpt_answers` of a stage answer, the handling session's answers to the text requests listed in that stage's prompt. On only when
 * the channel is on AND the field's description is recorded; while it is not, the tool does not list the field and submitStageAnswer refuses the WHOLE answer that carries it.
 */
export const excerptAnswersOn = () => excerptChannelOn() && typeof held('excerptAnswersField') === 'function';
export const ANSWER_KEYS = ['request', 'path', 'lines', 'decline'];
/** The problems of an `excerpt_answers` value against the request numbers the stage listed (WORDING D18-w5); [] when it is whole. */
export function excerptAnswersProblems(value, listed) {
  if (!Array.isArray(value)) return ['the value is not a list'];
  const p = []; const seen = new Set();
  value.forEach((a, k) => {
    const n = k + 1;
    if (!a || typeof a !== 'object' || Array.isArray(a)) { p.push(`entry ${n} is not an object`); return; }
    for (const key of Object.keys(a)) if (!ANSWER_KEYS.includes(key)) p.push(`entry ${n} names the field "${key.length > 40 ? `${key.slice(0, 40)}...` : key}", which is not request, path, lines or decline`);
    if (!Number.isInteger(a.request)) { p.push(`entry ${n} has no request number`); return; }
    if (!listed.has(a.request)) p.push(`entry ${n} names request ${a.request}, which this stage did not list`);
    else if (seen.has(a.request)) p.push(`entry ${n} answers request ${a.request} that an earlier entry answered`);
    seen.add(a.request);
    const pastes = a.path !== undefined || a.lines !== undefined; const declines = a.decline !== undefined;
    if (pastes && declines) p.push(`entry ${n} both pastes and declines`);
    else if (declines && !str(a.decline)) p.push(`entry ${n} neither pastes nor declines`);   // a bare { request } pastes what was asked; an empty decline is neither
    if (a.path !== undefined && !str(a.path)) p.push(`entry ${n} has no path`);
    if (a.lines !== undefined && a.lines !== null && (typeof a.lines !== 'string' || a.lines.trim() === '' || !parseLineRange(a.lines))) p.push(`entry ${n} has lines that are not "a-b" or "n"`);
  });
  return [...new Set(p)];
}
export const excerptAnswersSchemaFields = z => (excerptAnswersOn()
  ? { excerpt_answers: z.array(z.object({ request: z.number().int(), path: z.string().optional(), lines: z.string().optional(), decline: z.string().optional() })).optional().describe(held('excerptAnswersField')()) }
  : {});
