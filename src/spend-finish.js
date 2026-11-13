// 0.8.4 S16 (F; T9e T21q T21bz; N29, Q9(f); C&C's rulings of 09 Nov 2026): `--finish` at a SPENDING stop (STOPPED-budget.json). It RECORDS the person's choice (run.json `budgetFinish`) and the command ends at exit 4 with nothing run and nothing spent;
// the run stays stopped. The ending happens on the resume that follows the person's own typed raise: the first call of that sitting that misses the cache inside the review rounds is the stage the limit stopped, the loop ends there (chain.js SpendFinish),
// the final read runs (it is paid out of the raise: a stop gives no authority for another paid call, N29), and then the run ends NOT agreed (report.json stop.kind budget_stop, chosen finish).
// PURE: plain data in, plain data out. Every sentence a person reads here is a WORDING row (WORDING_0.8.4.md, "S16 F": w60 to w68, A-DRAFT).

/** Where the run was when the limit stopped it, as the harness recorded it (STOPPED-budget.json `phase`, set from chain.js's one scanPhase): before the review rounds, inside them, or after them. */
export const SPEND_PHASES = Object.freeze(['before', 'loop', 'after']);

const TAIL = 'Nothing was recorded, run or spent.';
const RAISE = runDir => `Raise the spending limit as before (the way to do it is in ${runDir}/STOPPED-budget.md)`;

/**
 * The decision for `--finish` given at a run that STOPPED at the spending limit. `stop`: the parsed STOPPED-budget.json (null when unreadable). `member`: the run is a tree member. `maxUsdGiven`: the command also carries --max-usd.
 * Returns { refusal } (a sentence, exit 2, nothing recorded), or { record: { label, cap_name? } } (the entry for run.json `budgetFinish` is built by the caller with the time).
 * WORDING S16-w62b, w62g.
 */
export function spendFinishDecision({ stop, member = false, maxUsdGiven = false, runDir = '<run folder>' }) {
  if (member) return { refusal: `--finish: this run is a member of a tree; a finish at its spending limit is not given from a member. ${TAIL}` };
  if (maxUsdGiven) return { refusal: `--finish: give it alone. It only records your choice to end the run here; the new spending limit comes with the resume that follows. ${TAIL}` };
  const phase = stop && typeof stop === 'object' ? stop.phase : undefined;
  if (phase === 'before') return { refusal: `--finish: this stop came before the review rounds began, so there is no plan under review yet and nothing to finish. ${RAISE(runDir)}: the run then goes on from the stage it stopped at. ${TAIL}` };
  if (phase === 'after') return { refusal: `--finish: this stop came after the review rounds, so the run is already ending. ${RAISE(runDir)}: the stage it stopped at is paid for and the run ends the way it was going to. ${TAIL}` };
  if (phase !== 'loop' || typeof stop.stoppedAt !== 'string' || !stop.stoppedAt) return { refusal: `--finish: the stop record (STOPPED-budget.json) does not say where in the run it came, so your choice cannot be matched to a review. ${RAISE(runDir)}. ${TAIL}` };
  return { record: { label: stop.stoppedAt, ...(typeof stop.capName === 'string' && stop.capName ? { cap_name: stop.capName } : {}) } };
}

/** The entry of run.json `budgetFinish`, whole or not: 'none' (absent), 'finish' (whole), 'bad' (present and unreadable: the resume is refused, nothing run or spent). Only the SHAPE is checked: a later stop at the final read rewrites STOPPED-budget.json, and the finish stays what the person chose. */
export function spendFinishState(runMeta) {
  const f = runMeta?.budgetFinish;
  if (f === undefined) return 'none';
  const whole = f && typeof f === 'object' && f.choice === 'finish' && typeof f.label === 'string' && f.label && typeof f.at === 'string' && Number.isFinite(Date.parse(f.at));
  return whole ? 'finish' : 'bad';
}

/** WORDING S16-w62f: what the command prints once the choice is recorded (stdout, exit 4). `calls`: 'plain' (up to twice the number of top-layer seats) or 'parts' (the long-list parts are recorded, so no figure is given). */
export function spendFinishAnswer({ label, topLayer = null, topSeats = 0, parts = false, runDir = '<run folder>' }) {
  const read = topLayer === null ? 'the final read' : `the final read of layer ${topLayer}`;
  const cost = topLayer === null || !topSeats ? '' : parts
    ? `: it makes two calls for each seat of that layer for each part of a long list, fewer when a seat has already read exactly this text`
    : `: that read makes up to ${2 * topSeats} calls, none for a seat of that layer that has already read exactly this text`;
  return `Your choice to end the run here is recorded: nothing was run and nothing was spent. The run stays stopped. When you raise the spending limit as before (the way to do it is in ${runDir}/STOPPED-budget.md), the run ends at stage "${label}", NOT agreed, after ${read}${cost}. That read runs only once your raise pays for it; a raise that does not cover it stops the run again, still not ended.`;
}

/** WORDING LAD-R15 (A-DRAFT): run.json holds a finish for this spending stop that the approval record does not, so it is not applied: the run goes on as an ordinary raise. */
export const spendFinishUnrecordedNote = where => `  run.json holds a finish for this spending stop that the approval record does not, so it is not applied: the run goes on as a plain raise, and the review rounds go on from where they stopped.${where === 'loop' ? ' To end them after one last read, give --finish again.' : where === 'after' ? ' This stop falls after the review rounds, where a plain finish no longer exists.' : ''}`;

/** WORDING LAD-R20 (A-DRAFT): the approval record holds the person's finish, but the budgetFinish entry was removed from run.json by hand (the way back that has always existed): the finish is taken as withdrawn. */
export const spendFinishWithdrawnNote = '  the approval record holds your finish for this run, but run.json no longer does (the entry was removed): the finish is taken back and the review rounds go on from where they stopped. To end them after one last read, give --finish again.';

/** WORDING LAD-R34 (A-DRAFT; unit-end item ii): the person went on past a finish they gave earlier (--continue, typed or relayed): the finish is set aside, the latest choice decides. */
export const spendFinishContinuedNote = '  you chose to go on past your finish (--continue, after --finish): the review rounds go on from where they stopped, and the run is not ended at the stage the finish named.';

/** WORDING S16-w66 (A-DRAFT, pr2 fix, finish note): the note a resume prints when it carries the recorded finish, and the line the raise screen shows before the person types the figure. Its last sentence is the caveat of S16-w62f (the --finish answer) as a sentence of its own, in the same words: the printed figure pays for the next call, not for the whole finish. */
export const spendFinishNote = label => `  you chose to end the run at the spending stop (stage "${label}"); it ends there, NOT agreed, after the final read. A raise that does not cover it stops the run again, still not ended.`;

/** WORDING S16-w62g: a recorded finish in run.json that cannot be read. */
export const SPEND_FINISH_BAD = '--resume: the finish recorded in run.json (budgetFinish) cannot be read, so it cannot be matched to a stop. Nothing was run or spent. Give --finish again to record it, or remove the budgetFinish entry to go on with the review.';

import { createHash } from 'node:crypto';
/** The hash of the identifying fields of a spending stop (the stop file's stage, phase, cap and figures): what a recorded finish-now is bound to. A raise, or a second stop, changes these fields, so a record never applies to another stop. -> hex | null for an unreadable stop. */
export function stopShaOf(stop) {
  if (!stop || typeof stop !== 'object') return null;
  return createHash('sha256').update(JSON.stringify([stop.stoppedAt ?? null, stop.phase ?? null, stop.capName ?? null, stop.capUsd ?? null, stop.spentUsd ?? null])).digest('hex');
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// 0.8.4 (ladder unit; C&C 10 Nov 2026): `--finish-now` at a SPENDING stop. It ends the run at no cost, in the one command: no raise, no limit screen. Unlike `--finish` it records nothing for a later resume to read (a plain resume still meets the limit gate): the
// sitting itself makes no call that bills (chain.js NotRunForLimit), asks no judge again, and names every call it did not make. Every sentence a person reads here is a WORDING row (WORDING_0.8.4.md, LAD-B1 to LAD-B7, A-DRAFT).

/**
 * The decision for `--finish-now` given at a run that STOPPED at the spending limit (STOPPED-budget.json). Same inputs as spendFinishDecision. Returns { refusal } (a sentence, exit 2, nothing recorded, run or spent) or { ok: true, phase, label, capName }.
 * A stop that came BEFORE the review rounds has no plan to end; a stop record that does not say where the run was cannot be matched; a tree member and a command that also carries a new limit are refused.
 */
export function spendFinishNowDecision({ stop, member = false, maxUsdGiven = false, runDir = '<run folder>' }) {
  const tail = 'Nothing was recorded, run or spent.';
  if (member) return { refusal: `--finish-now: this run is a member of a tree; a finish at its spending limit is not given from a member. ${tail}` };
  if (maxUsdGiven) return { refusal: `--finish-now: give it alone. It ends the run here without a new limit, so a --max-usd would be ignored. ${tail}` };
  const phase = stop && typeof stop === 'object' ? stop.phase : undefined;
  if (phase === 'before') return { refusal: `--finish-now: this stop came before the review rounds began, so there is no plan under review yet and nothing to end. ${RAISE(runDir)}: the run then goes on from the stage it stopped at. ${tail}` };
  if (phase !== 'loop' && phase !== 'after') return { refusal: `--finish-now: the stop record (STOPPED-budget.json) does not say where in the run it came, so your choice cannot be matched to the run. ${RAISE(runDir)}. ${tail}` };
  return { ok: true, phase, label: typeof stop.stoppedAt === 'string' ? stop.stoppedAt : null, capName: typeof stop.capName === 'string' && stop.capName ? stop.capName : null };
}

/** WORDING LAD-B2: the line the sitting prints before it replays the run. */
export const finishNowNote = (phase, label) => `  you chose to end the run at the spending limit (stage "${label ?? '?'}") with --finish-now: no call that bills is made, no judge reads the plan again${phase === 'loop' ? ', and the run ends NOT agreed' : ', and the verdict is the one the run had reached'}.`;

/** WORDING LAD-B2b: a call before the review rounds that would bill (a stage the run folder no longer holds). Nothing was sent. */
/** WORDING LAD-B10: a limit the run stopped at fired in a --finish-now sitting (a call escaped the stop of calls that bill). Nothing was reserved or sent; the run is exactly as it was stopped. */
export const finishNowLimitFired = (label, runDir) => `--finish-now: stage "${label}" reached a limit this run stopped at, although this command should make no call that bills. Nothing was reserved or sent, and the run is exactly as it was stopped. ${RAISE_INSTEAD(runDir)} Please report this.`;

/** WORDING LAD-B2b/B10/B12/B1: with the person's finish-now on record a plain resume goes on ending the run; the way to raise the limit INSTEAD is the raise flag. */
export const RAISE_INSTEAD = runDir => `To raise the limit instead of ending the run, resume with --raise-cap (a plain resume goes on ending it; the way is also in ${runDir}/STOPPED-budget.md).`;

export const finishNowBeforeRounds = (label, runDir) => `--finish-now: stage "${label}" comes before the review rounds and would bill, so the run cannot be ended here without a bill. Nothing was sent or spent. The run stays stopped. ${RAISE_INSTEAD(runDir)}`;

/**
 * WORDING LAD-B1 (C&C's reading of his 02:47 words "may finish at any stop ... does not ask"): the paragraph of the spending-stop screen that states the way to end the run here without paying, and asks nothing. `phase`: before | loop | after (no paragraph for `before`, or
 * for a stop whose phase is unknown). `hasHandoff`: the chain makes a handoff. Returns '' when there is nothing to say.
 */
export function finishNowScreen({ command, runId, phase, hasHandoff = false }) {
  if (phase !== 'loop' && phase !== 'after') return '';
  const raise = phase === 'loop'
    ? 'Raising the limit as above pays the stage the run stopped at, and the review rounds go on.'
    : 'Raising the limit as above pays the stage the run stopped at, and the run ends the way it was going to (the top layer reads the final plan where a read is owed).';
  const now = phase === 'loop'
    ? '--finish-now keeps every stage already paid for, makes no call that bills, and no judge reads the plan again: the run ends NOT agreed, because the review rounds were not finished.'
    : '--finish-now keeps every stage already paid for, makes no call that bills, and no judge reads the plan again: the run keeps the verdict the review rounds reached, and where the top layer owed a read of the final plan that was not made, the report says the top layer did not read the final plan, or that only part of it had read this version.';   // 0.8.4 (his 19:01 words, 10 Nov 2026): a finish after the rounds does not change the verdict; the old words said the run ends NOT agreed if a read was owed, which the record does not say
  const handoff = hasHandoff ? ` A handoff that would bill is not made by this ending; \`${command} handoff --from-run runs/${runId}\` makes it later (a handoff seat that bills shows a screen and asks the person for a limit).` : '';
  const session = ' A stage that a session writes (a seat that bills nothing: a handoff, a rewrite, a revision, a final edit) is not skipped: the run pauses at each such stage for its answer; after each answer resume the run as usual (your --finish-now is on record), and the run ends after the last without asking for a limit.';
  return `\n## Or end it here, without paying\n\n    ${command} --resume runs/${runId} --finish-now\n\n${raise} ${now} Once you have given --finish-now, a plain resume goes on ending the run; to raise the limit instead, resume with --raise-cap. A plan that ends NOT agreed can still be accepted by the person. The calls not made are listed in report.json (stages_not_run).${session}${handoff}\n`;
}

/**
 * WORDING LAD-R2 (A-DRAFT): the sentence of the quote of a spending stop, read by the handling session. Facts, then the ways on; it asks nothing of the session: the stop is the person's.
 * `stop`: the partial report's stop { label, phase, cap_name? }; `spentUsd`, `limitUsd`: what the run counted and the limit on record (null when not known); `limitQuestion`: the id of a limit question (a gate) that is open, or null.
 */
export function budgetStopSentence({ stop, spentUsd = null, limitUsd = null, runDir = '<run folder>', limitQuestion = null, hasPlan = false, recordStands = false } = {}) {
  const where = stop?.phase === 'loop' ? 'inside the review rounds' : stop?.phase === 'after' ? 'after the review rounds' : 'before the review rounds';
  const figures = Number.isFinite(spentUsd) && Number.isFinite(limitUsd) ? ` Counted so far: $${spentUsd.toFixed(2)} of a $${limitUsd.toFixed(2)} limit${stop?.cap_name ? ` (the ${stop.cap_name} limit)` : ''}.` : '';
  const ways = stop?.phase === 'loop' || stop?.phase === 'after'
    ? ` The ways on are the person's: raise the limit (the person's own number: resume_run with their words, or at a terminal), or end the run here at no cost: finish_now with the person's words${stop.phase === 'loop' ? ' (or finish, which ends it after one last read of the final plan paid out of a raise)' : ''}. ${stop.phase === 'loop' ? 'The run then ends NOT agreed.' : 'The run then keeps the verdict the review rounds reached.'}`
    : ' This stop came before the review rounds began, so there is no plan to end: the only way on is to raise the limit.';
  const standing = recordStands ? " The person's finish_now is on record and a session's stage waits to be answered; a choice given now replaces it (the latest choice decides)." : '';
  const open = limitQuestion ? ` A limit question is open (gate ${limitQuestion}): the person answers it, or ends the run here instead.` : '';
  return `THE RUN STOPPED AT ITS SPENDING LIMIT ${where}, at stage "${stop?.label ?? '?'}", before its next call was paid for.${figures} ${hasPlan ? `The plan as it stands is in deliverable-partial.md in ${runDir}.` : 'No draft of the plan is in the run folder yet.'}${ways}${standing}${open}`;
}
