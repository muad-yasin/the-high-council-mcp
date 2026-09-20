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

// Extracted from the task text, which is the only source any seat sees.
export function fencedSourceOf(text) {
  const blocks = [...String(text || '').matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map(m => m[1]);
  return blocks.join('\n');
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
 *   'unquoted'    - claims the repo, carried no quote at all.
 *   null          - makes no repo claim, or there is no fenced source to check against, in
 *                   which case marking would be theatre.
 */
export function markFailures(failures, fenced) {
  const source = String(fenced || '');
  const checkable = source.trim().length > 0;
  return (failures || []).map(f => {
    if (!checkable) return { ...f };
    const claims = looksLikeRepoClaim(f.problem) || looksLikeRepoClaim(f.criterion);
    if (!claims) return { ...f };
    if (!f.quote) return { ...f, quote_status: 'unquoted' };
    return { ...f, quote_status: quoteAppears(f.quote, source) ? 'verified' : 'unverified' };
  });
}

/** One line per marked failure, for the run log and WARNINGS.md. */
export function quoteWarnings(marked, seatLabel = 'a seat') {
  const out = [];
  for (const f of marked || []) {
    if (f.quote_status === 'unquoted') {
      out.push(`${seatLabel}: "${f.criterion}" makes a claim about the repository without quoting the fenced source - kept, but nobody checked it.`);
    } else if (f.quote_status === 'unverified') {
      out.push(`${seatLabel}: "${f.criterion}" quotes text that does NOT appear in the fenced source - treat this objection's detail as invented until a human checks it.`);
    }
  }
  return out;
}
