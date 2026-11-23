// The words that say HOW a finished run passed, in one place (T2-4, 14 Oct 2026). Before this, four report-reading sites (the HTML board, the replay transcript, `run_status`, the viewer)
// printed "every lab signed off" for every `passed: true` report, including a first-mode run that one critic passed and a unanimous run where a seat only stated a pass or dropped out.
// The mode is DERIVED from what the run wrote (nothing records the chain's setting, and none is added): `signoff` is an array for a unanimous run (chain.js assigns it each round and sets
// passed only after), null for a first-mode pass; an advice report is passed:true with signoff null and carries `advise`; `outcome: "degraded"` wins over both. A field that is absent
// (an old or damaged report) gives the neutral word, never a stronger claim. The sentences below are SHIPPED WORDS reused at the new sites (cli.js's live verdict line, handoff-from-run.js's
// degraded reason, run-status.js's advice state), moved here so each exists once; the neutral word is new.
import { computeOutcome } from './outcome.js';
import { finalReadBlocksAgreement, finalReadObjected } from './final-read.js';
import { topLayerNotSignedFrom } from './layers.js';
import { didNotSignOffPhrase, relayedTail } from './overseer-rounds.js';
import { topLayerOf, layerWord, layerHyphen } from './top-layer.js';
import { nothingStandsAtEnd } from './ending-matrix.js';
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

/**
 * 0.8.4 S4 (CA4, G11; A-DRAFT): the words of a recorded `ending` that is NOT agreed, or null (no ending, or an agreed one). The panel's layers signed off and the run still does not end agreed: say why in one sentence.
 * Every reader that prints "PASSED" or "signed off" for a report with this ending must say these words instead.
 */
export function endingWords(report) {
  const e = report?.ending;
  if (!e || typeof e !== 'object' || e.kind === 'agreed') return null;
  const basis = Array.isArray(e.basis) ? e.basis : [];
  const lw = layerWord(topLayerOf({ layers: report.layers, finalRead: report.final_read }));   // S8: the run's top layer from its own record; none = "the top layer" (src/top-layer.js)
  if (basis.includes('handler_not_yet')) return `${lw} signed off, but the handler said not yet, so the run does NOT end agreed`;
  if (basis.includes('text_changed_after_sign_off')) return `${lw} signed off, but the plan that is delivered is not the plan it signed, so the run does NOT end agreed`;
  if (basis.includes('final_read_objection')) return `${lw} signed off, but an objection to the final plan holds, so the run does NOT end agreed`;
  return `${lw} signed off, but the run does NOT end agreed`;
}

/**
 * 0.8.4 S4 (C&C's Q-d: "fix for every report"; A-DRAFT): the words of a report whose final read holds the sign-off although `passed` is true (the final read objected, or not every layer-3 seat read the final plan). Null otherwise.
 * Before this a final-read-blocked report printed "PASSED" in the exports, the replay transcript, the viewer and the rematch line, contradicting its own verdict line.
 */
export function finalReadHoldWords(report) {
  const fr = report?.final_read;
  if (!report?.passed || !finalReadBlocksAgreement(fr)) return null;
  const lh = layerHyphen(topLayerOf({ layers: report.layers, finalRead: fr }));   // S8: the run's top layer from its own record
  return finalReadObjected(fr) ? `every layer had signed off on an earlier text, but a ${lh} objection to the final plan holds the sign-off` : `every layer had signed off on an earlier text, but not every ${lh} seat read the final plan`;
}
/**
 * 0.8.4 S4 (A-DRAFT; copy correction 11, Muad's pick of 4 Nov 2026): the words of a layered run that ended AGREED with no handling session, so no build check was made; null for every other report.
 * They are ADDED after the panel's own words (the old sentence stays the start, as with the delivered-text clause), so a reader that matched "every lab on the panel signed off" still matches.
 */
export function noBuildCheckWords(report) {
  const e = report?.ending;
  if (!e || typeof e !== 'object' || e.kind !== 'agreed' || !Array.isArray(e.basis) || !e.basis.includes('no_handling_session')) return null;
  return `agreed on ${layerWord(topLayerOf({ layers: report.layers, finalRead: report.final_read }))}'s sign-off; no build check was made, because no session was there to make one`;
}

/** 0.8.4 S4 (A-DRAFT): an escalated sign-off that the handler's good_to_build ended AGREED (`ending` agreed with `passed` false); null for every other report. The outcome stays no_consensus: it is not the whole panel's agreement. */
export function agreedAfterEscalationWords(report) {
  if (report?.ending?.kind !== 'agreed' || report.passed === true) return null;
  const lw = layerWord(Number.isInteger(report.escalated_signoff?.layer) ? report.escalated_signoff.layer : topLayerOf({ layers: report.layers, finalRead: report.final_read }));   // S8: the escalated sign-off's own layer, else the run's top layer; none = "the top layer"
  if (report.escalated_signoff?.requested && !report.escalated_signoff.ladder) return `${lw} signed off on a pass that was asked to start at layer 3, and the handler checked the build: the run ends agreed (the layers below were not asked in that pass, so the whole panel did not sign off; see ending and escalated_signoff in report.json)`;   // 0.8.4 S4: control 1 without the ladder; nothing was passed up
  if (report.escalated_signoff?.ladder && Array.isArray(report.escalated_signoff.below) && report.escalated_signoff.below.length) return `${lw} signed off in a ladder pass, and the handler checked the build: the run ends agreed (${report.escalated_signoff.below.length === 1 ? 'layer' : 'layers'} ${report.escalated_signoff.below.join(', ')} ${report.escalated_signoff.below.length === 1 ? 'was' : 'were'} not asked in that pass, so the whole panel did not sign off; see ending and escalated_signoff in report.json)`;   // 0.8.4 A1-1: the words of ROUND2.md ed985f4b item A1-1-agreed-ladder (A-DRAFT); a ladder sign-off passed nothing up, so the general sentence below is false for it
  return `${lw} signed off after objections were passed up, and the handler checked the build: the run ends agreed (the whole panel did not sign off; see ending and escalated_signoff in report.json)`;
}

/** The panel's words for a report that PASSED, or null when it did not. The security gate is NOT consulted here (gateWords and verdictHeadline decide that, using these words). */
function panelWords(report) {
  if (!report || !report.passed) return null;
  if (endingWords(report) || finalReadHoldWords(report)) return null;   // 0.8.4 S4: a sign-off that does not end agreed is not "passed"; the ending's (or the final read's) own words say what it is
  // `advise` present means this is not a panel pass at all (signoff is null there too): never fall through to the first-mode words.
  if (report.advise) return adviceWords(report.advise);
  // `outcome` is a required report field; an old or damaged report without it is classified from what it does carry (src/outcome.js, a leaf module), so an absent field never reads as a stronger claim.
  if ((report.outcome ?? computeOutcome(report)) === 'degraded') return DEGRADED_WORDS;
  const noCheck = noBuildCheckWords(report);   // 0.8.4 S4: a no-session layered run that ended agreed says that no build check was made, after the old sentence
  const withCheck = w => (noCheck ? `${w}; ${noCheck}` : w);
  if (Array.isArray(report.signoff)) return withCheck(UNANIMOUS_WORDS);
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
// A-DRAFT (pr2 fix, R1): R1 (C&C, 13 Nov): a run the person finished at a pause, the spending limit or the owner's pause and then finished AT ONCE at the final-read stop (the final read was asked and no seat gave a usable reply) keeps the earlier stop and its words, and the words still tell him that
// the top layer did not sign off (his 05 Nov heading), by the existing clause. '' for every other report (a clause the words already carry is never said twice).
const layerThreeAfterFinalReadFinish = report => {
  const fr = report?.final_read ?? report?.finalRead;
  if (fr?.ran !== true || fr?.reason !== 'finished_at_once' || (Array.isArray(fr.seats) && fr.seats.some(e => e?.read === true))) return '';
  const top = Math.max(...(Array.isArray(report?.layers) ? report.layers : []).map(r => r?.layer).filter(Number.isInteger));
  return Number.isInteger(top) ? `, and ${didNotSignOffPhrase(top)}` : '';
};

/** 0.8.4 (found-secret pause, --finish; WORDING_0.8.4.md section c2b): the words for a run the person finished at a credential-shaped pause (report.json `stop.kind` secret_pause); null for every other report. NOT agreement: the pass the pause came in was not reviewed. */
export function secretFinishWords(report) {
  const s = report?.stop;
  if (s?.kind !== 'secret_pause' || report.passed === true) return null;
  const layers = ls => (ls.length === 1 ? `layer ${ls[0]}` : `layers ${ls.slice(0, -1).join(', ')} and ${ls.at(-1)}`);
  const asked = Array.isArray(s.asked_layers) ? s.asked_layers : [];
  const cut = Array.isArray(s.cut_layers) ? s.cut_layers : [];
  const notAsked = Array.isArray(s.not_asked_layers) ? s.not_asked_layers : [];
  const clause = (ls, one, many, what) => (ls.length ? `${layers(ls)} ${ls.length === 1 ? one : many} ${what}` : '');
  // by what was asked, cut off and not asked, in that order; the first clause carries "in this pass" (c2g, WORDING_0.8.4.md)
  const parts = [clause(asked, 'was', 'were', 'asked'), clause(cut, 'was', 'were', 'cut off'), clause(notAsked, 'was', 'were', 'not asked')].filter(Boolean);
  const listed = parts.length === 1 ? `${parts[0]} in this pass` : parts.length === 2 ? `${parts[0]} in this pass and ${parts[1]}` : `${parts[0]} in this pass, ${parts[1]} and ${parts[2]}`;
  const state = s.reviewed === 'signed' ? 'every layer signed off in this pass and the build check was not asked'
    : s.reviewed === 'all' ? 'this pass was reviewed and its revise did not run'
    : s.reviewed === 'part' && parts.length ? listed
    : Array.isArray(s.asked_layers) ? 'no layer was asked in this pass' : 'the review of this pass did not run';
  // A-DRAFT (pr2 fix, R1): the clause after a finish at once at the final-read stop comes from layerThreeAfterFinalReadFinish.
  return `finished at the person's choice${relayedTail(s)}${s.finished_at_once === true ? ' at once' : ''} at a credential-shaped pause in stage "${s.label}", NOT agreement${s.finished_at_once === true ? ' (no judge was asked again)' : ''}: ${state}${layerThreeAfterFinalReadFinish(report)}`;   // A-DRAFT (WORDING LAD-R40): a finish-now says so
}

/** 0.8.4 (ladder unit, A-DRAFT LAD-O6): the words for a run the person finished AT the owner's pause (report.json `stop.kind` owner_pause, `chosen` finish; `pauses[].finished` says the same); null for every other report. NOT agreement. */
export function ownerPauseFinishWords(report) {
  const s = report?.stop;
  if (s?.kind !== 'owner_pause' || s.chosen !== 'finish' || report.passed === true) return null;
  // Muad's 05 Nov rule: a layered run the person finished at a stop says the top layer did not sign off on that plan. At the owner's pause the stop names the pass it stopped BEFORE, which has no row yet: the plan is the one that pass would have reviewed, and the top layer has not signed it off, so the claim is made when the layers record is there and holds no row of that pass.
  const noRowYet = Array.isArray(report.layers) && report.layers.length > 0 && Number.isInteger(s.pass) && !report.layers.some(r => r?.round === s.pass);
  const hit = topLayerNotSignedFrom({ layers: report.layers, stop: s }) ?? (noRowYet && report.layers.some(r => Number.isInteger(r?.layer)) ? { layer: Math.max(...report.layers.map(r => r?.layer).filter(Number.isInteger)) } : null);
  // A-DRAFT (pr2 fix, item 7 and R1): "and no judge read the plan again" is said only when no final read is on the report; the clause after a finish at once at the final-read stop comes from layerThreeAfterFinalReadFinish.
  return `finished at the person's choice at the owner's pause before pass ${s.pass}${s.finished_at_once ? ' at once' : ''}${s.relayed ? ', relayed by the handling session' : ''}, NOT agreement${hit ? `, and ${didNotSignOffPhrase(hit.layer)}` : layerThreeAfterFinalReadFinish(report)}${s.finished_at_once && (report.final_read ?? report.finalRead)?.ran !== true ? ', and no judge read the plan again' : ''}`;   // said only when no final read is on the record (budgetFinishWords says the same of the spending limit)
}

/** 0.8.4 S16 (F; WORDING S16-w60): the words for a run the person finished at a spending stop (report.json `stop.kind` budget_stop, `chosen` finish); null for every other report. NOT agreement. */
export function budgetFinishWords(report) {
  const s = report?.stop;
  if (s?.kind !== 'budget_stop' || s.chosen !== 'finish' || report.passed === true) return null;   // a stopped run's partial report carries the stop too (kind budget_stop, no choice): that is not a finish
  const readRec = report.final_read ?? report.finalRead;   // the report's spelling, or a result's (cli.js prints the verdict line from the result): a read on disk is what the words say, whoever asks
  const recSeats = readRec?.ran === true && Array.isArray(readRec.seats) ? readRec.seats : [];
  const usableSeats = recSeats.filter(e => e?.read === true).length;
  const capWords = `${s.cap_name ? `, the ${s.cap_name} cap` : ''}`;
  if (s.finished_at_once === true && recSeats.length && usableSeats === 0) return `finished at the person's choice${relayedTail(s)} at the spending limit${capWords}, at once, NOT agreement: the final read on disk held no usable reply and was not asked again, and the run stopped at stage "${s.label}", before its next call was paid for`;   // A-DRAFT (WORDING LAD-R26)
  if (s.finished_at_once === true && recSeats.length && usableSeats < recSeats.length) return `finished at the person's choice${relayedTail(s)} at the spending limit${capWords}, at once, NOT agreement: only part of the final read was usable - the seats whose reads were on disk are on the record, the others were not asked, or gave no usable reply and were not asked again - and the run stopped at stage "${s.label}", before its next call was paid for`;   // A-DRAFT (WORDING LAD-R21, as amended by LAD-R26)
  if (s.finished_at_once === true && readRec?.ran !== true) return `finished at the person's choice${relayedTail(s)} at the spending limit${s.cap_name ? `, the ${s.cap_name} cap` : ''}, at once, NOT agreement, and no judge read the plan again: the run stopped at stage "${s.label}", before its next call was paid for`;   // 0.8.4 (LAD-B3): --finish-now at the spending stop
  // A-DRAFT (pr2 fix, item 7 and R1): "after the final read" is said when a final read is on the report (the report's or the result's spelling); the clause after a finish at once at the final-read stop comes from layerThreeAfterFinalReadFinish.
  return `finished at the person's choice${relayedTail(s)} at the spending limit${s.cap_name ? `, the ${s.cap_name} cap` : ''}, after the final read, NOT agreement: the run stopped at stage "${s.label}", before its next call was paid for${layerThreeAfterFinalReadFinish(report)}`;
}

export function earlyFinishWords(report) {
  const s = report?.stop;
  if (s?.kind !== 'early_finish' || report.passed === true) return null;
  const n = Array.isArray(s.items) ? s.items.length : 0;
  return `finished early by the session, NOT agreement: the overseer layer said to finish, the lower layers did not review the last revision, and ${n} open objection(s) go to the builder`;
}

/**
 * 0.8.4 L3 (A-DRAFT; Muad, 05 Nov 2026: THC should tell him that layer 3 did not sign off when he finishes a stop): the clause of a run that a person FINISHED at a stop while the top layer had not signed off on that plan, else null.
 * `x` is a report.json or a result: it needs `.stop` (with `chosen: 'finish'`; an early finish has `chosen: 'early'` and says nothing here) and `.layers`. Pure and derived (nothing is recorded; passed, outcome and the exit code are untouched),
 * so a report written before L3 gets the clause too. The layer test is the shared core, src/layers.js topLayerNotSignedFrom; the clause itself is src/overseer-rounds.js didNotSignOffPhrase. A passed report never gets it, and neither does a report that carries an `ending` or an `escalated_signoff` (its own words say how it ended).
 */
export function finishedAtStopWords(x) {
  if (x?.passed === true || (x?.stop?.chosen !== 'finish' && x?.stop?.chosen !== 'rule') || x?.stop?.kind === 'secret_pause' || x?.stop?.kind === 'budget_stop' || x?.stop?.kind === 'owner_pause' || (x.ending && typeof x.ending === 'object') || x.escalated_signoff) return null;   // a recorded `ending` or `escalated_signoff` speaks for itself (cli.js's verdict line already puts them first): neither is recorded for a finished stop, so this is a guard, not a case
  const hit = topLayerNotSignedFrom({ layers: x.layers, stop: x.stop });
  if (!hit) return null;
  if (x.stop.why === 'final_read') return didNotSignOffPhrase(hit.layer);   // A-DRAFT (pr2 fix, R1) 0.8.4 (R1): at the final-read stop the final read WAS asked and got no usable reply, so "no judge was asked again" would be false there; the bare clause claims neither
  if (x.stop.finished_at_once !== true) return didNotSignOffPhrase(hit.layer);
  const fr = x.final_read ?? x.finalRead;   // a report or a result
  if (fr?.ran === false && (fr.reason === 'every_top_seat_read_this_plan' || (fr.reason === 'finished_at_once' && fr.coverage_only === true))) return `${didNotSignOffPhrase(hit.layer)}, and it had read this version before the run ended: no judge was asked again`;   // A-DRAFT (WORDING LAD-R23): the record says the top layer had read this text
  if (fr?.ran === false && fr.reason === 'finished_at_once' && Array.isArray(fr.reused) && fr.reused.length) return `${didNotSignOffPhrase(hit.layer)}, and only part of that layer had read this version before the run ended: no judge was asked again`;   // A-DRAFT (WORDING LAD-R24)
  // 0.8.4 round 1, the A7 fix (A7-c; C&C's result: where the record cannot show whether a seat was heard on the delivered text, the clause claims neither): the text's round is signed_text.round (the round in which that draft was put to the panel), the stop's own pass is stop.pass.
  if ((x.delivered_text ?? x.deliveredText)?.same_as_signed === true) {
    const roundOfText = (x.signed_text ?? x.signedText)?.round;
    // a report with no per-seat list cannot be reached here (every report of a run that can finish at once carries panelVerdicts): the bare phrase is the file's rule for a damaged record
    if (!Array.isArray(x.panelVerdicts) || !Number.isInteger(roundOfText) || roundOfText !== x.stop.pass) return didNotSignOffPhrase(hit.layer);   // the record does not tie the text to the stop's pass (a ledger-overflow stop): neither claim
    const heardOnText = x.panelVerdicts.some(v => v && v.round === roundOfText && typeof v.verdict === 'string' && v.verdict !== 'unheard');   // a seat was HEARD on it in the stop's pass: read from the per-seat record (a layer's row reads `unheard` while one of its seats is silent, even when its other seats were heard)
    if (heardOnText) return `${didNotSignOffPhrase(hit.layer)}, and the last round reviewed this version: no judge was asked again`;
  }
  return `${didNotSignOffPhrase(hit.layer)}, and no judge read the last version of it before the run ended`;   // 0.8.4 (finish at once, A-DRAFT LAD-F2): the person ended the run at the stop, so nobody read the last version
}

export function verdictHeadline(report) {
  const gate = gateWords(report);
  if (gate) return { heading: 'Verdict', label: 'NOT A PASS', words: gate, text: `NOT A PASS - ${gate}` };
  // An advice report has no verdict and no objections, whatever `passed` says (a stopped advice call is written with passed false): the Advice heading and the record's advice words (never the neutral word).
  if (report?.advise) { const w = adviceWords(report.advise); return { heading: 'Advice', label: null, words: w, text: w }; }
  const early = earlyFinishWords(report);
  if (early) return { heading: 'Verdict', label: 'FINISHED EARLY', words: early, text: `FINISHED EARLY - ${early}` };
  const secretEnd = secretFinishWords(report);
  if (secretEnd) return { heading: 'Verdict', label: 'NOT AGREED', words: secretEnd, text: `NOT AGREED - ${secretEnd}` };
  const spendEnd = budgetFinishWords(report);   // 0.8.4 S16 (F)
  if (spendEnd) return { heading: 'Verdict', label: 'NOT AGREED', words: spendEnd, text: `NOT AGREED - ${spendEnd}` };
  const pauseEnd = ownerPauseFinishWords(report);   // 0.8.4 (ladder unit)
  if (pauseEnd) return { heading: 'Verdict', label: 'NOT AGREED', words: pauseEnd, text: `NOT AGREED - ${pauseEnd}` };
  const ended = finalReadHoldWords(report) ?? endingWords(report);   // 0.8.4 S4: layer 3 signed off and the run still does not end agreed (the final read's own sentence first: it is the older, more specific one)
  if (ended) return { heading: 'Verdict', label: 'NOT AGREED', words: ended, text: `NOT AGREED - ${ended}` };
  const escAgreed = agreedAfterEscalationWords(report);
  if (escAgreed) return { heading: 'Verdict', label: 'AGREED', words: escAgreed, text: `AGREED - ${escAgreed}` };
  const w = verdictWords(report);
  if (w === null) { const finished = finishedAtStopWords(report); return { heading: 'Verdict', label: 'OPEN OBJECTIONS', words: null, text: finished ? (nothingStandsAtEnd(report) ? `NOT AGREED - ${finished}` : `OPEN OBJECTIONS - ${finished}`) : (nothingStandsAtEnd(report) ? 'NOT AGREED' : 'OPEN OBJECTIONS') }; }   // A-DRAFT (0.8.4 round 1, A7-2): NOT AGREED is the run finished at once with no objection open. 0.8.4 L3: `words` stays null (the viewer prints 'open objections' for it); only the text says the top layer's part
  return { heading: 'Verdict', label: 'PASSED', words: w, text: `PASSED - ${w}` };
}

/** The short label for a one-line summary (the rematch line): PASSED, OPEN OBJECTIONS, NOT A PASS or ADVICE. */
export function verdictShort(report) {
  const h = verdictHeadline(report);
  return h.label || h.heading.toUpperCase();
}

/**
 * 0.8.4 (ladder unit, --finish-now at a spending stop; A-DRAFT LAD-B4): the words of a run the person ended at the spending limit, with the calls that were not made. Null when the report holds no `stages_not_run`. It says what was not made and nothing about the verdict: a run ended this way
 * keeps the verdict the panel and the final read produced (agreed stays agreed), so the sentence never says "agreed" or "not agreed" itself.
 */
export function stagesNotRunWords(report) {
  const rows = report?.stages_not_run;
  if (!Array.isArray(rows) || !rows.length) return null;
  const labels = rows.map(r => r && typeof r.label === 'string' ? r.label : null).filter(Boolean);
  if (!labels.length) return null;
  const atLimit = rows.some(r => r?.reason === 'spending_limit');   // A-DRAFT (LAD-R41): rows that are all `finished_at_once` come from a finish-now at a pause or a round stop, not from the spending limit
  return `ended ${atLimit ? 'at the spending limit' : 'at once'} at the person's choice${report?.spending_finish?.relayed === true ? ', relayed by the handling session' : ''}; ${labels.length === 1 ? 'one call was' : `${labels.length} calls were`} not made (${labels.join(', ')})`;
}
