// 0.8.4 S9 (the proposer return, Q10): reads ONE numbered entry of a plan's "Decisions" section and checks a quoted Choice line against it. Pure: text in, answer out; no model, no file, no import.
// The rule the check serves (Q10(a), W8): a layer-3 objection is decision-level only if it names an entry, quotes that entry's Choice line and the quote is really there. The test is made on the plan's own text, so no seat is asked to imagine a failure.
// The entries are numbered by the builder and the reviser (W13, "Decision 1, Decision 2, ..."). The section is found by the same heading rule as src/argued.js decisionsSection (a heading of any level whose text is "Decisions"), with two deliberate
// differences: it is read WHOLE (decisionsSection clips at 8000 characters for a prompt, and a clipped entry would read as "not found"), and a same-level heading "## Decision N" does not end it (decisionsSection ends at the next heading of the same level).

const SECTION_HEAD = /^#{1,6}\s+(?:§?\d+(?:\.\d+)*[.)]?\s+)?Decisions\b/i;
// An entry starts at a line that is "Decision <n>" and then ends or goes on with a separator (": . ) - en/em dash, closing bold): a body sentence that merely begins with "Decision 2 is ..." does not start an entry.
const ENTRY_HEAD = /^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?(?:\*\*|__)?Decision\s+(\d+)\b(?:\s*(?:[:.)\u2013\u2014-]|\*\*|__)|\s*$)/i;
// The record's fields (DECISIONS_RULE_BUILDER): a field starts a line, with or without a bullet or bold marks.
// A line that opens another bullet field, named or not ("- Why the alternatives lost: ..."): the Choice body ends there, so words of a field this module does not know cannot pass the quote check. A nested bullet of the Choice with a label shape is cut too (named limit: its words cannot be quoted).
const BULLET_LABEL = /^\s*[-*]\s+(?:\*\*|__)?[A-Za-z][A-Za-z' -]{1,40}(?:\*\*|__)?\s*:/;
const FIELD = /^\s*(?:[-*]\s+)?(?:\*\*|__)?(Context|Options considered|Trade-offs|Choice|Why the others lost|Consequences)(?:\*\*|__)?\s*[:.\u2013\u2014-]\s*/i;

const squeeze = s => String(s ?? '').replace(/\s+/g, ' ').trim();

/** The whole "Decisions" section of a plan as lines, or null when the plan has none. */
function sectionLines(plan) {
  const lines = String(plan ?? '').split('\n');
  const start = lines.findIndex(l => SECTION_HEAD.test(l.trim()));
  if (start < 0) return null;
  const level = lines[start].trim().match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(#+)\s/);
    if (m && m[1].length <= level && !ENTRY_HEAD.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start + 1, end);
}

/** The numbers of the entries the plan's Decisions section carries, in order (a number can repeat: the check below calls that ambiguous). */
export function decisionNumbersOf(plan) {
  const body = sectionLines(plan);
  if (!body) return [];
  return body.flatMap(l => { const m = l.match(ENTRY_HEAD); return m ? [Number(m[1])] : []; });
}

/**
 * Entry `n` of the plan's Decisions section: `{ ok: true, number, title, text, choice }` (`choice` is the Choice field's body without its label, the lines up to the next field; null when the entry has no Choice field),
 * or `{ ok: false, reason }` with reason 'no_decisions_section', 'entry_not_found', 'entry_not_a_number' (the number is not a whole number or a digit string) or 'entry_ambiguous' (two entries carry the number: nothing is guessed).
 */
export function decisionEntryOf(plan, n) {
  const body = sectionLines(plan);
  if (!body) return { ok: false, reason: 'no_decisions_section' };
  // A seat writes the number as it reads (a JSON number or a digit string, "2" or "Decision 2"); anything else is a different refusal from "the plan has no such entry".
  const k = typeof n === 'string' ? (n.trim().match(/^(?:decision\s+)?(\d{1,6})$/i)?.[1] ?? null) : n;
  n = typeof k === 'string' ? Number(k) : k;
  if (!Number.isInteger(n)) return { ok: false, reason: 'entry_not_a_number' };
  const starts = body.flatMap((l, i) => { const m = l.match(ENTRY_HEAD); return m ? [{ i, number: Number(m[1]) }] : []; });
  const mine = starts.filter(s => s.number === n);
  if (mine.length === 0) return { ok: false, reason: 'entry_not_found' };
  if (mine.length > 1) return { ok: false, reason: 'entry_ambiguous' };
  const at = starts.indexOf(mine[0]);
  const lines = body.slice(mine[0].i, at + 1 < starts.length ? starts[at + 1].i : body.length);
  const text = lines.join('\n').trim();
  const title = squeeze(lines[0].replace(/^\s*(?:#{1,6}\s+)?(?:[-*]\s+)?(?:\*\*|__)?Decision\s+\d+\s*(?:[:.)\u2013\u2014-])?(?:\*\*|__)?\s*/i, '').replace(/(?:\*\*|__)\s*$/, ''));
  let choice = null;
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].match(FIELD);
    if (!f || f[1].toLowerCase() !== 'choice') continue;
    const parts = [lines[i].slice(f[0].length)];
    for (let j = i + 1; j < lines.length && !FIELD.test(lines[j]) && !BULLET_LABEL.test(lines[j]); j++) parts.push(lines[j]);
    choice = squeeze(parts.join(' '));
    break;
  }
  return { ok: true, number: n, title, text, choice };
}

/**
 * Is `quote` the entry's Choice line? Whitespace-normalised, with or without a bullet and the "Choice:" label (a seat copies the line as it reads, "- Choice: ...", or just the words after the label). This check gates 3P paid calls, so the FLOOR is
 * stated: the quote is a contiguous run of the Choice's words and covers at least half of them, never fewer than three (a Choice of fewer words must be quoted whole): min(words, max(3, ceil(words / 2))). A longer Choice therefore cannot be "quoted"
 * by one word. Words from another field of the entry (Context, Why the others lost, ...) do not count: only the Choice field is searched. An empty quote, or an entry with no Choice field, is false.
 */
export function choiceQuoteFound(entry, quote) {
  if (!entry?.ok || typeof entry.choice !== 'string' || !entry.choice) return false;
  const q = squeeze(String(quote ?? '').replace(/^\s*(?:[-*]\s+)?(?:\*\*|__)?choice(?:\*\*|__)?\s*[:.\u2013\u2014-]\s*/i, '').replace(/^\s*[-*]\s+/, ''));
  if (!q) return false;
  const words = entry.choice.split(' ').length;
  if (q.split(' ').length < Math.min(words, Math.max(3, Math.ceil(words / 2)))) return false;
  return entry.choice.includes(q);
}

/** The words of a refused mark's reason in run.log and BOARD.md (WORDING S9-w13, S9-w16): ONE copy, in this import-free file so the report writer can use it without pulling in the held-text registry. */
export function refusalWords(reason, number) {
  if (reason === 'no_decisions_section') return 'the plan has no Decisions section';
  if (reason === 'entry_not_a_number') return 'it does not name an entry by number';
  if (reason === 'entry_not_found') return `the plan has no Decision ${number}`;
  if (reason === 'entry_ambiguous') return `two entries are numbered ${number}`;
  if (reason === 'choice_not_found') return `its quoted Choice line is not in Decision ${number}`;
  return reason;
}
