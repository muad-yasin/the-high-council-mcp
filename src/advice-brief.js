// The advice brief (thc-research brief 29, from brief 25's `advice-brief/1` schema): what a calling agent
// must write INSTEAD of handing over a transcript, and the exact text the advisors read.
//
// Everything a seat receives is rendered here, from fixed fields, into one string. That string is what the
// quote prices, what the person confirms by hash, what the outbound scan and the masking see, and what the
// run reads as its task. There is no field that can hold a transcript, a tool log, an environment dump or a
// file listing, and an unknown key is a refusal, never a pass-through.
//
// Changes from brief 25's draft schema (brief 29, "Departures from wave A"):
//   - no `answer_format` (the engine's verdict set is fixed: proceed, change, stop, need_information);
//   - no `data_flags` (declaring "no personal data" would LOOSEN the tier, and nothing may loosen it);
//   - no per-option `leaning` (the caller's favourite would reach every seat in the blind stage; 28 section 1.3);
//   - `tried` is required unless `first_look` is true, and at least two options are required (28 guard 3);
//   - `new_evidence` is part of the brief, because anything a seat reads must be in the text that is hashed.
import { z } from 'zod';

export const ADVICE_SCHEMA_VERSION = 'advice-brief/1';
// All strings together; excerpts together. Over the cap means refuse, never truncate (a truncated PEM block once leaked,
// src/fence.js, 2026-09-23). Brief 25 section 6 set 12,000 characters (a brief a person reads in about two minutes); the owner
// raised it on 2026-10-02 to 48,000 characters, about 12,000 tokens at the harness's four characters a token ("12k tokens will
// be almost nothing for anyone who runs his main sessions on a subscription basis"). The person still reads the whole text
// before it is sent. The excerpt caps rise with it so the total is reachable: the other fields together hold at most about
// 14,000 characters (question 600, decision 400, options 6 x 480, constraints 2,000, tried 4,000, not_included 1,280,
// new_evidence 600, excerpt labels and reasons 5 x 480), so excerpts get 36,000 together and 8,000 each (5 x 8,000 = 40,000
// cannot pass alone). Price at the new cap, with Sol and Gemini at 12,000 output tokens (owner, 2026-10-02): single $0.160,
// council $0.945 worst (at 12,000 characters: $0.140 and $0.866; before the 12k output raise $0.096 and $0.748).
// 0.8.1 milestone R (owner, 4 Oct 2026): the single seat's output cap is 36,000 tokens, so single is $0.4039 at 12,000 characters and $0.4237 at
// this cap (the figures above are the 12,000-token ones; the council is unchanged).
export const BRIEF_MAX_CHARS = 48_000;
export const EXCERPT_MAX_CHARS = 36_000;
export const EXCERPT_ITEM_MAX_CHARS = 8_000;
// A repeat of an earlier question needs at least this much new material (28 guard 2; untuned).
export const NEW_EVIDENCE_MIN_CHARS = 40;

export const MOMENTS = ['before_commit', 'stuck', 'before_done', 'choose_between', 'simplify_check'];
export const SENSITIVITIES = ['public', 'internal', 'confidential', 'personal_data', 'secret_adjacent', 'unknown'];
export const EXCERPT_KINDS = ['code', 'error', 'log', 'config', 'doc', 'spec'];

// A repo-relative path or a short description: never absolute, never `..`, never a URL with credentials.
const ORIGIN = /^(?![/~\\]|[A-Za-z]:[\\/])(?!.*:\/\/[^/\s]*@)(?!(?:.*[\\/])?\.\.(?:[\\/]|$))[^\u0000-\u001f]*$/;

const line = (min, max) => z.string().min(min).max(max);

export const ADVICE_BRIEF = z.object({
  schema_version: z.literal(ADVICE_SCHEMA_VERSION),
  moment: z.enum(MOMENTS).describe('why you are asking'),
  question: line(20, 600).describe('one answerable question, in your own words; not a task description'),
  decision_at_stake: line(10, 400).describe('what you will do differently depending on the answer, and what is costly or hard to undo if it is wrong'),
  options_considered: z.array(z.object({ name: line(1, 80), summary: line(1, 400) }).strict()).min(2).max(6)
    .describe('at least two real options; "do nothing", "do less" and "do not build" count'),
  constraints: z.array(line(1, 200)).max(10).optional().describe('hard limits the answer must respect'),
  tried: z.array(z.object({ what: line(1, 200), result: line(1, 300) }).strict()).max(8).optional()
    .describe('what you already tried or checked and what each try showed; required unless first_look'),
  first_look: z.boolean().optional().describe('true only when nothing has been tried yet because the choice comes before any work'),
  excerpts: z.array(z.object({
    label: line(1, 80),
    kind: z.enum(EXCERPT_KINDS),
    origin: z.string().max(200).regex(ORIGIN, 'a repo-relative path or short description: no leading slash, tilde, drive letter or "..", no credentials in a URL').optional(),
    why_needed: line(10, 200).describe('which part of the question this answers and why the advisors cannot answer without it'),
    text: line(1, EXCERPT_ITEM_MAX_CHARS),
  }).strict()).max(5).optional().describe('decision-relevant excerpts only; at most 36,000 characters together'),
  sensitivity: z.enum(SENSITIVITIES).describe('your own label; it can only tighten the operator policy; "unknown" counts as confidential'),
  not_included: z.array(line(1, 160)).min(1).max(8).describe('what you left out on purpose: transcript, environment, file listings, tool output'),
  new_evidence: line(NEW_EVIDENCE_MIN_CHARS, 600).optional().describe('only when asking again about the same question: what you found or changed since; a rephrasing does not count'),
}).strict();

/** Every string value in the brief, keys not counted. */
function stringsOf(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => stringsOf(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => stringsOf(x, out));
  return out;
}

// Characters a person cannot see in a preview and a key scan does not match through: control characters (but not tab, newline, carriage
// return), soft hyphen, zero-width and bidi controls, word joiners and invisible operators, the byte-order mark, Hangul and Braille fillers,
// variation selectors (but not U+FE0F, which emoji use) and Unicode tag characters. One of them inside a key, or a key spelled in tag
// characters, scored no hit on the scan (brief 29 review, finding 1). They are REFUSED, not stripped: the text that is hashed and shown
// must be the text that is sent.
const HIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2800\u3164\ufe00-\ufe0e\ufeff\uffa0\u{e0000}-\u{e007f}\u{e0100}-\u{e01ef}]/u;

/** The first hidden character in any string of the brief, as { where, code }, or null. */
export function hiddenCharacterIn(brief) {
  for (const s of stringsOf({ ...brief, schema_version: undefined })) {
    const m = HIDDEN.exec(s);
    if (m) return { code: `U+${m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`, near: s.slice(Math.max(0, m.index - 12), m.index).replace(/[\u0000-\u001f]/g, ' ') };
  }
  return null;
}

/**
 * The limits a schema cannot express: all strings together, excerpts together, `tried` unless a first look.
 * Returns null when the brief is fine, else the refusal text (nothing was written, sent or spent).
 */
export function briefRefusal(brief) {
  const hidden = hiddenCharacterIn(brief);
  if (hidden) return `the brief contains an invisible or control character (${hidden.code}, after "${hidden.near}"). It is refused and never stripped: the person who approves the send cannot see such a character, and it can hide text from the key scan. Remove it and ask again.`;
  const total = stringsOf({ ...brief, schema_version: undefined }).reduce((n, s) => n + s.length, 0);
  if (total > BRIEF_MAX_CHARS) return `the brief is ${total} characters; the limit is ${BRIEF_MAX_CHARS} for everything together. It is refused and never cut. Shorten it (fewer or smaller excerpts first) and ask again.`;
  const excerpts = (brief.excerpts || []).reduce((n, e) => n + e.text.length, 0);
  if (excerpts > EXCERPT_MAX_CHARS) return `the excerpts are ${excerpts} characters together; the limit is ${EXCERPT_MAX_CHARS}. It is refused and never cut. Keep only the lines the decision depends on.`;
  if (!brief.first_look && !(brief.tried || []).length) return 'tried: say what you already tried or checked (a test run, a doc you read, a smaller step). If nothing has been tried because the choice comes first, set first_look to true.';
  return null;
}

// A fence longer than any run of backticks in the text, so an excerpt cannot close it.
function fenced(text, info = '') {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map(m => m.length));
  const f = '`'.repeat(longest + 1);
  return `${f}${info}\n${text}\n${f}`;
}

/** The exact text the advisors read (the engine puts it under "# The brief"). Deterministic: same brief, same bytes. */
export function renderBriefText(brief) {
  const parts = [];
  parts.push(`Moment: ${brief.moment.replaceAll('_', ' ')}. The caller's sensitivity label: ${brief.sensitivity}.`);
  parts.push(`## Question\n\n${brief.question}`);
  parts.push(`## What depends on the answer\n\n${brief.decision_at_stake}`);
  parts.push(`## Options the caller weighed\n\n${brief.options_considered.map((o, i) => `${i + 1}. ${o.name}: ${o.summary}`).join('\n')}`);
  if (brief.constraints?.length) parts.push(`## Hard constraints\n\n${brief.constraints.map(c => `- ${c}`).join('\n')}`);
  parts.push(`## What was tried\n\n${brief.first_look && !(brief.tried || []).length ? 'Nothing yet: the choice comes before any work.' : brief.tried.map(t => `- ${t.what} -> ${t.result}`).join('\n')}`);
  if (brief.new_evidence) parts.push(`## New since the last time this was asked\n\n${brief.new_evidence}`);
  if (brief.excerpts?.length) {
    parts.push(`## Excerpts chosen by the caller\n\n${brief.excerpts.map(e => `### ${e.label} (${e.kind}${e.origin ? `, ${e.origin}` : ''})\n\nWhy it is here: ${e.why_needed}\n\n${fenced(e.text, e.kind === 'doc' || e.kind === 'spec' ? '' : e.kind)}`).join('\n\n')}`);
  }
  parts.push(`## Left out on purpose\n\n${brief.not_included.map(n => `- ${n}`).join('\n')}`);
  return `${parts.join('\n\n')}\n`;
}
