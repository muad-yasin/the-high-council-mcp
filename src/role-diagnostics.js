// v6 §7: four failure-mode detectors, reconsidered against the corrected
// framing (Muad, 2026-09-13): the feature is not "catch more planted
// defects" - it is debate diversity among real model seats reasoning
// differently about a real infrastructure decision. A deterministic
// heuristic probe (v6 phase 4) cannot have a philosophy, so it cannot
// see the thing this feature is for. See docs/v6-decisions.md for the
// full argument: two of the plan's four detectors originally read
// per-seat catch-rate data from the phase 4 probe; both are redesigned
// here to read real debate-stage output (a run's own report.json)
// instead, so all four detectors measure something the feature's actual
// purpose can be judged by, not a proxy for a question the feature was
// never trying to answer.
//
// Every function here is pure and read-only: no ledger, nothing
// transmitted, computed from `report.debate.posts` on disk exactly the
// same way verdict-stats.js and cost-forecast.js already derive their
// numbers from run folders.

const QUOTE_RE = /"([^"]{3,})"/g;

function quotedSpans(text) {
  return [...String(text || '').matchAll(QUOTE_RE)].map(m => m[1]);
}

function wordSet(text) {
  return new Set(String(text || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []);
}

function jaccard(a, b) {
  if (!a.size && !b.size) return null;
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : null;
}

/**
 * Per-seat (by `by`, the anonymised or real lab tag on each post)
 * substance and evidence-share metrics, computed only from a run's own
 * debate.posts. Returns `null` for a lab with no posts requiring a
 * quote (support posts don't - DEBATE_SYSTEM only asks for one on
 * object/merge), rather than a misleading 0.
 *
 * substanceRatio: v6 §7 failure mode 1, character-performed-not-
 * reviewed. Fraction of a seat's object/merge posts that contain at
 * least one quoted span, since DEBATE_SYSTEM's own instructions
 * require quoting the phrase being objected to or merged - a seat that
 * never quotes despite the prompt asking for it is arguing without
 * engaging the text in front of it, whatever its role.
 *
 * evidenceTokenShare: v6 §7 failure mode 4, token spend shifting from
 * substance to voice. Fraction of a seat's total post-text words that
 * fall inside a quoted span, across every post regardless of stance.
 */
export function perSeatMetrics(posts) {
  const byLab = new Map();
  for (const p of posts || []) {
    if (!p.by) continue;
    if (!byLab.has(p.by)) byLab.set(p.by, { evidencePosts: 0, quotedPosts: 0, totalWords: 0, quotedWords: 0 });
    const m = byLab.get(p.by);
    const text = String(p.text || '');
    const words = (text.match(/\S+/g) || []).length;
    m.totalWords += words;
    const spans = quotedSpans(text);
    const quotedWords = spans.reduce((s, q) => s + (q.match(/\S+/g) || []).length, 0);
    m.quotedWords += quotedWords;
    if (p.stance === 'object' || p.stance === 'merge') {
      m.evidencePosts += 1;
      if (spans.length) m.quotedPosts += 1;
    }
  }
  const out = {};
  for (const [lab, m] of byLab) {
    out[lab] = {
      substanceRatio: m.evidencePosts ? m.quotedPosts / m.evidencePosts : null,
      evidenceTokenShare: m.totalWords ? m.quotedWords / m.totalWords : null,
    };
  }
  return out;
}

/**
 * v6 §7 failure mode 2, role-correlation collapse - reconsidered.
 * Originally specified as a comparison against the phase 4 probe's
 * plain-arm baseline; that baseline is a deterministic heuristic mock,
 * not a real model, and cannot speak to real debate diversity. This
 * instead measures the mean pairwise textual overlap (Jaccard over
 * 4+ letter words) between different labs' posts on the SAME proposal,
 * within one real debate stage - a lens meant to diversify argument
 * that instead makes every seat's objection read the same is a real,
 * checkable signal computed from what seats actually wrote. Returns
 * `null` when there are fewer than two comparable posts (nothing to
 * compare, not evidence of agreement).
 */
export function pairwiseAgreement(posts) {
  const byTarget = new Map();
  for (const p of posts || []) {
    if (!p.on || !p.by) continue;
    if (!byTarget.has(p.on)) byTarget.set(p.on, []);
    byTarget.get(p.on).push(p);
  }
  const scores = [];
  for (const group of byTarget.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (group[i].by === group[j].by) continue;
        const score = jaccard(wordSet(group[i].text), wordSet(group[j].text));
        if (score !== null) scores.push(score);
      }
    }
  }
  return scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
}

/**
 * v6 §7 failure mode 3, a role degrading a weaker model - reconsidered.
 * Originally specified as a per-seat catch-rate delta read from the
 * phase 4 probe; catch rate against planted synthetic defects is not
 * what this feature is for (see module header). This instead compares,
 * within the SAME real run, the mean substanceRatio (above) of seats
 * carrying a role against seats that do not - a same-run, cross-
 * sectional read, not a longitudinal one (it cannot tell you whether
 * role-bearing seat X got worse than seat X used to be without a role,
 * only whether role-bearing seats collectively argued less
 * substantively than role-less seats in this one run). Returns `null`
 * when a run has no mix of role-bearing and role-less seats to compare
 * - a chain where every seat has the same role status has nothing this
 * detector can say.
 */
export function roleVsPlainSubstanceGap(perSeat, roleLabs) {
  const roleSeats = [];
  const plainSeats = [];
  for (const [lab, m] of Object.entries(perSeat)) {
    if (m.substanceRatio === null) continue;
    (roleLabs.has(lab) ? roleSeats : plainSeats).push(m.substanceRatio);
  }
  if (!roleSeats.length || !plainSeats.length) return null;
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  return mean(roleSeats) - mean(plainSeats);
}

// Placeholder thresholds, author to tighten (v6 Decisions left to the
// author already names this class of number as open) - not derived
// from any measurement, only from "clearly bad" being obviously below/
// above a midpoint.
const SUBSTANCE_FLOOR = 0.5;
const EVIDENCE_SHARE_FLOOR = 0.15;
const AGREEMENT_CEILING = 0.6;
const SUBSTANCE_GAP_FLOOR = -0.2;

/**
 * The full diagnostics object for one run's `report.debate`, meant to
 * be attached at `report.json`'s `debate.diagnostics` per v6 §7. Never
 * throws on a run with no debate stage or no posts - returns nulls and
 * empty flags, not an error, matching every other read-only reporting
 * module in this project.
 */
export function computeRoleDiagnostics(debate, roleLabs = new Set()) {
  const posts = debate?.posts || [];
  const perSeat = perSeatMetrics(posts);
  const agreement = pairwiseAgreement(posts);
  const substanceGap = roleVsPlainSubstanceGap(perSeat, roleLabs);

  const characterPerformedNotReviewed = Object.entries(perSeat)
    .filter(([, m]) => m.substanceRatio !== null && m.substanceRatio < SUBSTANCE_FLOOR)
    .map(([lab]) => lab);
  const tokenShiftToVoice = Object.entries(perSeat)
    .filter(([, m]) => m.evidenceTokenShare !== null && m.evidenceTokenShare < EVIDENCE_SHARE_FLOOR)
    .map(([lab]) => lab);

  return {
    perSeat,
    pairwiseAgreement: agreement,
    roleVsPlainSubstanceGap: substanceGap,
    flags: {
      characterPerformedNotReviewed,
      tokenShiftToVoice,
      roleCorrelationCollapse: agreement !== null && agreement > AGREEMENT_CEILING,
      roleDegradesOutput: substanceGap !== null && substanceGap < SUBSTANCE_GAP_FLOOR,
    },
  };
}
