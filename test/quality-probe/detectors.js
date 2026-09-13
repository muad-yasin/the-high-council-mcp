// v5 §1 candidate 15, Phase 1: three deterministic detectors standing in for a "mock panel" -
// each independently graded, at a different sensitivity, against the same fixture and draft.
// This is a heuristic proxy, not a real multi-lab critique: it exists to make catch-rate vs.
// unanimity a measurable, repeatable number offline, not to claim these three functions grade
// the way GLM/Kimi/DeepSeek would. See test/quality-probe/README.md for what this number does
// and does not mean.
export const SENSITIVITIES = ['strict', 'medium', 'loose'];

function headingsOf(draft) {
  return [...draft.matchAll(/^##\s*(.+)$/gm)].map(m => m[1].trim());
}

function detectMissingSection(fixture, draft, sensitivity) {
  const headings = headingsOf(draft);
  if (sensitivity === 'loose') {
    // Loose: any mention of the section name anywhere in the doc counts as "present", even
    // outside a heading - the weakest check, and the one most likely to miss a dropped heading
    // whose name still gets referenced in body text elsewhere.
    return !fixture.sections.every(s => draft.toLowerCase().includes(s.toLowerCase()));
  }
  if (sensitivity === 'medium') {
    return !fixture.sections.every(s => headings.some(h => h.toLowerCase() === s.toLowerCase()));
  }
  return !fixture.sections.every(s => headings.includes(s)); // strict: exact case, must be a heading
}

function detectWrongNumber(fixture, draft, sensitivity) {
  const re = new RegExp(`${fixture.numberLabel}:\\s*([\\d.]+)`, 'i');
  const m = draft.match(re);
  if (!m) return sensitivity !== 'loose'; // can't find the figure at all - strict/medium flag it, loose shrugs
  const found = m[1];
  if (sensitivity === 'loose') return false; // loose never cross-checks the actual value
  if (sensitivity === 'medium') {
    const diff = Math.abs(parseFloat(found) - parseFloat(fixture.correctValue));
    return diff / parseFloat(fixture.correctValue) > 0.05; // medium: only flags a >5% drift
  }
  return found !== fixture.correctValue; // strict: exact match required
}

function detectDroppedConstraint(fixture, draft, sensitivity) {
  const phrase = fixture.constraintPhrase.toLowerCase();
  const text = draft.toLowerCase();
  if (sensitivity === 'strict') return !text.includes(phrase);
  if (sensitivity === 'medium') {
    const words = phrase.split(/\s+/).filter(w => w.length > 3);
    return !words.every(w => text.includes(w)); // requires every significant word present somewhere
  }
  // loose: a decoy sentence sharing just two of the constraint's words is enough to look "present"
  const words = phrase.split(/\s+/).filter(w => w.length > 3);
  const hits = words.filter(w => text.includes(w)).length;
  return hits < 2 ? true : false;
}

function detectBrokenOrdering(fixture, draft, sensitivity) {
  const headings = headingsOf(draft);
  const expected = fixture.sections;
  const present = headings.filter(h => expected.includes(h));
  if (sensitivity === 'strict') return JSON.stringify(present) !== JSON.stringify(expected.filter(s => present.includes(s)));
  if (sensitivity === 'medium') {
    // medium walks the whole heading order and flags any positional mismatch - stricter than
    // loose (which only looks at the first and last heading) but doesn't require, as strict
    // does, that the *entire* sequence match exactly including sections neither fixture nor
    // draft actually disturbed.
    const exp = expected.filter(s => present.includes(s));
    let mismatches = 0;
    for (let i = 0; i < present.length; i++) if (present[i] !== exp[i]) mismatches++;
    return mismatches > 1;
  }
  // loose: only compares the first and last heading, ignoring everything in between.
  const exp = expected.filter(s => present.includes(s));
  return present[0] !== exp[0] || present[present.length - 1] !== exp[exp.length - 1];
}

function detectUnresolvedObjection(fixture, draft, sensitivity) {
  const hasObjection = draft.includes(`OBJECTION ${fixture.objectionId}`);
  if (!hasObjection) return false; // nothing planted to catch in this draft
  const resolvedSameId = draft.includes(`RESOLVED ${fixture.objectionId}`);
  if (sensitivity === 'strict' || sensitivity === 'medium') return !resolvedSameId;
  // loose: any "RESOLVED" anywhere in the document is taken as good enough, regardless of which
  // objection it actually closes - exactly the kind of shallow read that misses an unresolved one.
  return !draft.includes('RESOLVED');
}

const DETECTORS = {
  missing_section: detectMissingSection,
  wrong_number: detectWrongNumber,
  dropped_constraint: detectDroppedConstraint,
  broken_ordering: detectBrokenOrdering,
  unresolved_objection: detectUnresolvedObjection,
};

/** Runs one (defectType, sensitivity) detector against one fixture's planted-defect draft. */
export function detect(defectType, fixture, draft, sensitivity) {
  return DETECTORS[defectType](fixture, draft, sensitivity);
}
