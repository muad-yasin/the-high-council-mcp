// Shared diff semantics for item C (blind rematch) and item D (council replay) -
// relay/runs/2026-09-15T15-12-52-325Z/deliverable.md. Item C builds this module; item D reuses
// it verbatim rather than inventing a second definition of "diff the verdict" (derive-never-
// record, same precedent as src/spend.js's spendReport()). Validated against
// schemas/verdict-diff.json.
//
// Deliberately positional, not lab-named: a rematch/replay changes which real model sits in
// which seat (src/rematch.js re-anonymizes the `lab` field for exactly this reason), so lab
// identity is not a stable axis to diff two reports against - seat position (`critic-0`,
// `critic-1`, ...) is the only one that means the same thing in both reports being compared.

function objectingSeatRoles(report) {
  return (report.signoff || [])
    .map((s, i) => ({ role: `critic-${i}`, objecting: s.signedOff === false }))
    .filter(s => s.objecting)
    .map(s => s.role);
}

function objectionTexts(report) {
  const texts = [];
  for (const s of report.signoff || []) {
    for (const o of s.objections || []) {
      if (o?.problem) texts.push(String(o.problem).trim());
    }
  }
  return texts;
}

// Exact-string-match dedupe, per the plan's own stated scope ("simple equality for this version,
// not semantic matching"): 1.0 when both sides raised the identical set of objection texts (or
// both raised none), down to 0 when they share nothing.
function objectionOverlapRatio(origTexts, newTexts) {
  const a = new Set(origTexts);
  const b = new Set(newTexts);
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection++;
  return intersection / union.size;
}

/**
 * computeVerdictDiff(originalReport, newReport) -> {
 *   signoff_match: bool,
 *   verdict_category_changed: bool,
 *   critics_objecting_added: string[],   // seat-role ids present in newReport but not originalReport
 *   critics_objecting_removed: string[], // seat-role ids present in originalReport but not newReport
 *   objection_overlap_ratio: number,     // 0..1, exact-string dedupe
 * }
 * Pure function of the two report.json objects; reads nothing else, writes nothing.
 */
export function computeVerdictDiff(originalReport, newReport) {
  const origRoles = new Set(objectingSeatRoles(originalReport));
  const newRoles = new Set(objectingSeatRoles(newReport));

  return {
    signoff_match: originalReport.passed === newReport.passed,
    verdict_category_changed: (originalReport.outcome ?? null) !== (newReport.outcome ?? null),
    critics_objecting_added: [...newRoles].filter(r => !origRoles.has(r)).sort(),
    critics_objecting_removed: [...origRoles].filter(r => !newRoles.has(r)).sort(),
    objection_overlap_ratio: objectionOverlapRatio(objectionTexts(originalReport), objectionTexts(newReport)),
  };
}
