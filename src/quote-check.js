// Quote validation (2026-09-20). Only meaningful once a task can carry real source - see
// src/fence.js. The failure it targets is specific and was observed: in the cheap-7 run, seats
// with no access to the repository still made confident, concrete claims about it, the debate
// converged on one of them, and it reached the deliverable. Nothing in the harness could tell
// a claim about the code from an invention about the code, because both are just prose.
//
// With fenced source present, that distinction becomes checkable: a claim about the repository
// should be able to point at the text it came from. So a critic objection or debate post making
// a repo claim is expected to carry a `quote`, and the harness checks that quote actually
// appears in the fenced blocks.
//
// What this deliberately does NOT do is drop unquoted objections. A critic may be right without
// quoting, and silently discarding an objection is the one thing a review harness must never do
// - it is how a real defect disappears. An unquoted repo claim is kept, recorded, and marked, so
// the reviser can weigh it knowing nobody checked it. Marking beats deleting.
//
// It is also not a truth test. A quote that appears verbatim proves the seat read the source,
// not that its conclusion is right.

import { markSpans, evidenceSpans } from './post-quotes.js';
import { criterionKeyOf } from './objection-ids.js';
import { criterionIndexOf } from './criteria-ledger.js';

// Fenced code blocks, parsed the CommonMark way: an opening fence is 3+ backticks (or tildes),
// indented at most 3 spaces; the block ends at a line of the SAME character, at least as long,
// with nothing after it; an unclosed block runs to the end. Pre-release audit 2026-09-23
// (PreRelease_Audit_guards, HIGH): a global /```...```/ regex paired any two ``` markers, so a
// fenced .md file that itself contained an example fence flipped the parity - the task's own
// prose became "source", and an objection quoting that prose was shown to the reviser as a
// verified quote. `council fence` now also writes a fence longer than any backtick run in the
// file (src/fence.js), so its blocks always parse whole.
// Returns [{ index (offset of the opening line), end, info, firstLine, body, closed }].
export function parseFences(text) {
  const src = String(text || '');
  const lines = src.split('\n');
  const blocks = [];
  let offset = 0;
  let open = null;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const next = Math.min(offset + raw.length + 1, src.length);
    if (!open) {
      const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (m && !(m[1][0] === '`' && m[2].includes('`'))) {
        open = { index: offset, char: m[1][0], len: m[1].length, info: m[2].trim(), lines: [] };
      }
    } else {
      const c = new RegExp(`^ {0,3}(\\${open.char}{${open.len},})\\s*$`).exec(line);
      if (c) { blocks.push(close(open, true, next)); open = null; } else open.lines.push(line);
    }
    offset += raw.length + 1;
  }
  if (open) blocks.push(close(open, false, src.length));
  return blocks;
  // `closed` (additive, 2026-09-23): false for a block that runs to the end of the text with no
  // closing fence - partial-deliverable.js uses it to spot a draft cut off inside a code block.
  // `end` (additive, 0.7.8): the offset just past the closing fence line (or the text's end), so
  // outsideFences() can blank the whole block, fence lines included.
  function close(b, closed, end) { return { index: b.index, end, info: b.info, firstLine: b.lines[0] ?? '', body: b.lines.join('\n'), closed }; }
}

// The task text with every fenced block blanked out, fence lines included. Line breaks are kept,
// so line numbers and line starts are unchanged; everything else inside a block becomes nothing.
// For the readers that take a line of the task's own prose as an instruction to the harness - the
// `label:`, `target_file:` and `signoff:` fields, and `council fence`'s "is the header already
// there" check. Hostile-fence corpus, 0.7.8 (test/hostile-fenced-corpus.test.js): each of them
// read fenced source too, so a fenced file with a `signoff: <name>` line satisfied a policy's
// required sign-off, a YAML file's `label:` line renamed the run, and a fenced file quoting the
// fence header kept `council fence` from writing the real one. Fenced text is the repository's
// words, never the operator's.
export function outsideFences(text) {
  const src = String(text || '');
  let out = '';
  let at = 0;
  for (const b of parseFences(src)) {
    out += src.slice(at, b.index) + src.slice(b.index, b.end).replace(/[^\n]/g, '');
    at = b.end;
  }
  return out + src.slice(at);
}

// Extracted from the task text, which is the only source any seat sees.
export function fencedSourceOf(text) {
  return parseFences(text).map(b => b.body).join('\n');
}

export function hasFencedSource(text) {
  return fencedSourceOf(text).trim().length > 0;
}

// Whitespace is normalised on both sides before comparing. A model re-typing a quoted line
// almost never reproduces leading indentation exactly, and failing a correct quote over two
// spaces would teach seats that quoting is not worth the trouble - which loses the whole
// mechanism to protect a detail that does not matter. Case is NOT normalised: identifiers are
// case-sensitive, and `SaveSystem` vs `savesystem` is a real difference in a repo claim.
function normalise(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

export function quoteAppears(quote, fenced) {
  const q = normalise(quote);
  if (!q) return false;
  return normalise(fenced).includes(q);
}

// Does this text claim something about the repository? Deliberately narrow: a filename with a
// code extension, a path, or an identifier shaped like code (CamelCase with an inner capital,
// snake_case, or a call/member expression). Prose about the plan itself is not a repo claim and
// must not be dragged into needing a quote.
//
// A miss here is quiet and safe (the claim is simply not marked); a false positive is noisy and
// teaches seats to ignore the marking. So this errs toward missing.
const REPO_CLAIM_PATTERNS = [
  /\b[\w-]+\.(cs|js|ts|jsx|tsx|py|rs|go|java|rb|php|c|h|cpp|hpp|json|ya?ml|toml|xml|sh|sql|asmdef|prefab|asset|unity|meta|csproj)\b/,
  /(^|\s)[\w-]+\/[\w./-]+/,
  /\b[a-z]+[A-Z]\w*\s*\(/,
  /\b[A-Z][a-z]+[A-Z]\w*\b/,
  /\b\w+_\w+\s*\(/,
];

export function looksLikeRepoClaim(text) {
  const s = String(text || '');
  return REPO_CLAIM_PATTERNS.some(re => re.test(s));
}

/**
 * Mark each failure with how its repo claim (if any) is evidenced. Returns new objects; the
 * input is never mutated, and no failure is ever removed.
 *
 * `quote_status`:
 *   'verified'    - claims the repo, carried a quote, and the quote is in the fenced source.
 *   'unverified'  - claims the repo, carried a quote, and that quote is NOT in the source.
 *                   The strongest signal available that a seat is inventing detail.
 *   'in_excerpt'  - claims the repo, carried a quote, the quote is not in the fenced source but is in a recorded excerpt (its id is attached as `excerpt_id`).
 *   'unquoted'    - claims the repo, carried no quote at all.
 *   null          - makes no repo claim, or there is no fenced source to check against, in
 *                   which case marking would be theatre.
 *
 * `draft` (0.8.4 F2, gap check S8-01): the text the judges were shown. The repo-claim patterns
 * are loose by design ("accept/withdraw" reads as a path), and a quote the seat took from the
 * draft is not an invented claim about the repository whatever its objection looks like. So a
 * quote that is not in the fenced source but IS in the draft gets no mark (no status at all:
 * nothing was invented, and nothing was checked against the source either). A quote found in
 * neither place is still 'unverified'. With no draft given the rule is the old one.
 *
 * `spans` (0.8.4 D14, plan A T7.2/T7.3; WORDING U2-w1): beside `quote_status`, and whether or not the task is checkable, a failure that quotes anything carries `spans: [{ text, located_in }]`: the quote itself, the quoted passages of its problem and
 * its fix, and those of the evidence of the FAILED table row of the same criterion (`rows`: [{ criterion, evidence }], the first row with the same criterion; none from a caller that has no table), each at least 8 characters once
 * normalised and each once. `located_in` is the first of draft, fenced_source, excerpt, request, criteria that holds the span, else null. The comparison is normQuote (case, emphasis and quote marks do not matter), NOT the
 * quote check's own case-sensitive compare above, so a span can be located while its quote_status says unverified. Marks are record only: nothing is gated or removed, and neither the id nor the stall key reads them.
 * `request` and `criteria` are the task text and the criteria list the seats were given. A row pairs with a failure when both resolve to the same criterion of that list (the pairing normaliseCritique uses), else when the id reads
 * their texts alike. `marks: false` makes none (the caller whose draft is not the one the raiser was shown: a ruling given in a layer's ordinary review, src/chain.js settleInCallRulings).
 *
 * `excerpts` (0.8.4 D41, plan A T5.3): the recorded excerpts the seats were shown, entries of excerpts.jsonl that carry text. An excerpt is never fenced source (the fence is read once from the task), so the fenced check is
 * unchanged; a quote that is not in the fenced source but is in an excerpt gets 'in_excerpt' with that excerpt's id. The caller passes [] unless the excerpt words are recorded. Checkability still comes from the fenced source.
 */
/**
 * 0.8.4 D14 (plan A T7.3; WORDING U2-w1): the five texts a span is looked for in, in the order of the rule (the first that holds it names it): [[name, text], ...] for markSpans (src/post-quotes.js). The excerpts are the entries that carry
 * text, one text each; the criteria are joined by newlines. The ONE copy: markFailures and the answer-back records (src/answer-back.js applyAnswers) both take it.
 */
export function spanTexts({ draft = '', fenced = '', excerpts = [], request = '', criteria = [] } = {}) {
  const shown = (excerpts || []).filter(e => typeof e?.text === 'string' && e.text !== '');
  return [['draft', draft], ['fenced_source', String(fenced || '')], ...shown.map(e => ['excerpt', e.text]), ['request', request], ['criteria', Array.isArray(criteria) ? criteria.join('\n') : criteria]];
}

export function markFailures(failures, fenced, draft = '', excerpts = [], { request = '', criteria = [], rows = [], marks = true } = {}) {
  const source = String(fenced || '');
  const shown = (excerpts || []).filter(e => typeof e?.text === 'string' && e.text !== '');
  const checkable = source.trim().length > 0 || shown.length > 0;   // 0.8.4 A7: an unfenced task is checkable once an excerpt is visible (the run-stable prompt clause asks for quotes from it)
  const texts = spanTexts({ draft, fenced, excerpts, request, criteria });
  const list = Array.isArray(criteria) ? criteria : [];
  const sameCriterion = (a, b) => { const ia = list.length ? criterionIndexOf(a, list) : -1; return (ia >= 0 && ia === criterionIndexOf(b, list)) || criterionKeyOf(a) === criterionKeyOf(b); };   // the run's own pairing (src/criteria-ledger.js: both resolve to the same list criterion) or the id's reading of the text
  const spansOf = f => {   // the quote itself, the quoted passages of the problem and the fix, and the quoted passages of the FAILED table row of the same criterion (the first such row), each once
    if (!marks) return [];
    const row = (rows || []).find(r => r && sameCriterion(r.criterion, f.criterion));
    return markSpans([typeof f.quote === 'string' ? f.quote : '', ...evidenceSpans(f.problem), ...evidenceSpans(f.fix), ...evidenceSpans(row?.evidence)], texts);
  };
  return (failures || []).map(({ spans: _earlier, ...f }) => {   // marks are made here, never inherited from an input copy
    const spans = spansOf(f);
    const out = g => (spans.length ? { ...g, spans } : g);
    if (!checkable) return out({ ...f });
    const claims = looksLikeRepoClaim(f.problem) || looksLikeRepoClaim(f.criterion);
    if (!claims) return out({ ...f });
    if (!f.quote) return out({ ...f, quote_status: 'unquoted' });
    if (quoteAppears(f.quote, source)) return out({ ...f, quote_status: 'verified' });
    const inEx = shown.find(e => quoteAppears(f.quote, e.text));
    if (inEx) return out({ ...f, quote_status: 'in_excerpt', excerpt_id: inEx.id });
    if (quoteAppears(f.quote, draft)) return out({ ...f });
    return out({ ...f, quote_status: 'unverified' });
  });
}

/** One line per marked failure, for the run log and WARNINGS.md. */
export function quoteWarnings(marked, seatLabel = 'a seat', { fenced = true } = {}) {
  const out = [];
  for (const f of marked || []) {
    if (f.quote_status === 'unquoted') {
      out.push(fenced ? `${seatLabel}: "${f.criterion}" makes a claim about the repository without quoting the fenced source - kept, but nobody checked it.` : `${seatLabel}: "${f.criterion}" makes a claim about the repository without quoting an excerpt - kept, but nobody checked it.`);   // WORDING A7-w6
    } else if (f.quote_status === 'unverified') {
      out.push(fenced ? `${seatLabel}: "${f.criterion}" quotes text that does NOT appear in the fenced source - treat this objection's detail as invented until a human checks it.` : `${seatLabel}: "${f.criterion}" quotes text that does NOT appear in any excerpt shown - treat this objection's detail as invented until a human checks it.`);   // WORDING A7-w6
    }
  }
  return out;
}
