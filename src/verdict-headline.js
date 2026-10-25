// The words that say HOW a finished run passed, in one place (T2-4, 14 Oct 2026). Before this, four report-reading sites (the HTML board, the replay transcript, `run_status`, the viewer)
// printed "every lab signed off" for every `passed: true` report, including a first-mode run that one critic passed and a unanimous run where a seat only stated a pass or dropped out.
// The mode is DERIVED from what the run wrote (nothing records the chain's setting, and none is added): `signoff` is an array for a unanimous run (chain.js assigns it each round and sets
// passed only after), null for a first-mode pass; an advice report is passed:true with signoff null and carries `advise`; `outcome: "degraded"` wins over both. A field that is absent
// (an old or damaged report) gives the neutral word, never a stronger claim. The sentences below are SHIPPED WORDS reused at the new sites (cli.js's live verdict line, handoff-from-run.js's
// degraded reason, run-status.js's advice state), moved here so each exists once; the neutral word is new.
import { computeOutcome } from './outcome.js';
export const UNANIMOUS_WORDS = 'every lab signed off';
export const FIRST_WORDS = 'a critic from another lab passed it';
export const DEGRADED_WORDS = 'the result reads as passed, but not every seat gave a verdict (an abstention, a stated pass, a dropped lab, or too few heard)';
export const NEUTRAL_WORDS = 'passed';

/** The advice state sentence (an advice call has no sign-off), moved from run-status.js; byte-identical for an answered record that carries a verdict. A null verdict reads 'advice (stopped)' only when the record says it stopped (status or stopped_by), else plain 'advice'. */
export function adviceWords(advise) {
  const a = advise;
  // A stopped call may carry no verdict, and may or may not carry stopped_by: advise.js builds the object (stopped_by is spread at :437) BEFORE its final halted() at :441, so a stop first latched there has status 'stopped' and no stopped_by.
  // Say only what the record says: stopped = status 'stopped' or stopped_by (T2-4 commits 3-4: an advice report never reads as the neutral word 'passed', and an answered record without stopped_by is never called stopped).
  const stopped = a.status === 'stopped' || !!a.stopped_by;
  if (a.verdict == null) return stopped ? 'advice (stopped)' : 'advice';
  return `advice from ${a.seats_answered} of ${a.seats_asked} seat(s), leaning ${String(a.verdict).replace('_', ' ')}${a.stopped_by ? ` (stopped early: ${a.stopped_by})` : stopped ? ' (stopped early)' : ''}`;
}

/** The panel's words for a report that PASSED, or null when it did not. The security gate is NOT consulted here (gateWords and verdictHeadline decide that, using these words). */
function panelWords(report) {
  if (!report || !report.passed) return null;
  // `advise` present means this is not a panel pass at all (signoff is null there too): never fall through to the first-mode words.
  if (report.advise) return adviceWords(report.advise);
  // `outcome` is a required report field; an old or damaged report without it is classified from what it does carry (src/outcome.js, a leaf module), so an absent field never reads as a stronger claim.
  if ((report.outcome ?? computeOutcome(report)) === 'degraded') return DEGRADED_WORDS;
  if (Array.isArray(report.signoff)) return UNANIMOUS_WORDS;
  if (report.signoff === null) return FIRST_WORDS;
  return NEUTRAL_WORDS;
}

/** The security gate's words (shipped in run-status.js since the 2026-09-23 bug audit, moved here): the gate outranks the panel, so a run whose final security review did not pass is not a pass. null when the gate passed or is absent. The clause says what the PANEL did in the panel's own words (T2-4 commit 3: it used to say "the panel signed off" for every pass, including a first-mode or degraded one). */
export function gateWords(report) {
  const gate = report?.security_review?.gate;
  if (!gate || gate === 'pass') return null;
  const panel = panelWords(report);
  return `security gate ${gate} - not a pass${panel ? ` (${panel}; the security review did not)` : ''}`;
}

/** The words for a report that PASSED, or null when it did not or the security gate blocked it (callers keep their own "open objections" text). */
export function verdictWords(report) {
  return gateWords(report) ? null : panelWords(report);
}

/**
 * The verdict a person reads, from one decision place: { heading, label, words, text }. The security gate comes first (a blocked run is NOT A PASS whatever the panel said), then an advice report (it has no
 * verdict: heading "Advice", no PASSED label; interim words, E item), then an unpassed run (OPEN OBJECTIONS), then a pass with the words of how it passed.
 */
/** ROADMAP 83: the words for a run that finished early at the session's proposal (report.json `stop.kind` early_finish); null for every other report. NOT agreement. */
export function earlyFinishWords(report) {
  const s = report?.stop;
  if (s?.kind !== 'early_finish' || report.passed === true) return null;
  const n = Array.isArray(s.items) ? s.items.length : 0;
  return `finished early by the session, NOT agreement: the overseer layer said to finish, the lower layers did not review the last revision, and ${n} open objection(s) go to the builder`;
}

export function verdictHeadline(report) {
  const gate = gateWords(report);
  if (gate) return { heading: 'Verdict', label: 'NOT A PASS', words: gate, text: `NOT A PASS - ${gate}` };
  // An advice report has no verdict and no objections, whatever `passed` says (a stopped advice call is written with passed false): the Advice heading and the record's advice words (never the neutral word).
  if (report?.advise) { const w = adviceWords(report.advise); return { heading: 'Advice', label: null, words: w, text: w }; }
  const early = earlyFinishWords(report);
  if (early) return { heading: 'Verdict', label: 'FINISHED EARLY', words: early, text: `FINISHED EARLY - ${early}` };
  const w = verdictWords(report);
  if (w === null) return { heading: 'Verdict', label: 'OPEN OBJECTIONS', words: null, text: 'OPEN OBJECTIONS' };
  return { heading: 'Verdict', label: 'PASSED', words: w, text: `PASSED - ${w}` };
}

/** The short label for a one-line summary (the rematch line): PASSED, OPEN OBJECTIONS, NOT A PASS or ADVICE. */
export function verdictShort(report) {
  const h = verdictHeadline(report);
  return h.label || h.heading.toUpperCase();
}
