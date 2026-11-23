// What a changed chain or task does to a run's finished steps, read from the run folder (0.8.4): a finished stage whose recorded inputs fingerprint is not today's is stale and is asked again when the run reaches it again; on a paid chain it is paid
// again and its old cost still counts toward the limit (chargeReplay, src/chain.js). `staleFinishedStages` counts those stages and their recorded cost, so the limit screen can say it before a person types a limit. The count is what was made under
// another fingerprint, not a promise about the path the run will take (a re-asked seat may answer differently, and some old stages are then never reached). A stage that goes stale by its prompt alone (a ladder that starts at the resume, reworded
// text) is not seen: the fingerprint is the only thing compared. The record is read as the stage cache reads it: `<label>.prompt.json` (an external answer's) merged with `<label>.usage.json`; the cost is read by readUsd, the reader the replay
// uses. A paid stage whose record holds no usable cost is counted in `unrecorded`: the limit counts such a stage at one call's worst case, which depends on the call and is not known here.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readUsd, formatUsd } from './cost.js';
import { isPaidSeat, recordedCapOf } from './caps.js';

export function staleFinishedStages(runDir, fingerprint, { capName = null } = {}) {   // capName: the per-provider limit this screen is for; the paid count and the cost then cover the steps billed through it, n still counts them all
  let n = 0; let paid = 0; let usd = 0; let unrecorded = 0;
  if (!existsSync(runDir)) return { n, paid, usd, unrecorded };
  const labels = new Set();
  for (const f of readdirSync(runDir)) { const m = /^(.+)\.(?:prompt|usage)\.json$/.exec(f); if (m) labels.add(m[1]); }
  for (const label of labels) {
    if (!existsSync(join(runDir, `${label}.md`))) continue;
    let u = {};
    const externalOnly = existsSync(join(runDir, `${label}.prompt.json`)) && !existsSync(join(runDir, `${label}.usage.json`));
    for (const f of [`${label}.prompt.json`, `${label}.usage.json`]) {
      if (!existsSync(join(runDir, f))) continue;
      try { u = { ...u, ...JSON.parse(readFileSync(join(runDir, f), 'utf8')) }; } catch { u = {}; break; }   // an unreadable record is not counted: the screen says less, never more than it knows
    }
    if (typeof u.inputsFingerprint !== 'string' || u.inputsFingerprint === fingerprint) continue;
    n += 1;
    if (capName ? recordedCapOf(u) !== capName : !isPaidSeat({ provider: u.provider }) || externalOnly) continue;   // a step whose ONLY record is its prompt.json (an external answer) is not said to be paid again; a usage.json that names no provider (an older record) stays counted, so a charge is never understated   // under per-provider limits a step bills through the limit its own record names (src/caps.js recordedCapOf, the rule invoke() replays by); a step of another limit is counted in n only   // a mock seat, a session of the person's (an external answer has a prompt record only) and a free local model cost nothing to ask again
    paid += 1;
    // A paid step whose record holds NO cost counts apart too: a replay charges it one call's worst case (src/chain.js replayFigures treats an absent figure as missing), so the screen must say so; readUsd alone reads absent as $0.
    const recorded = u.usd === undefined || u.usd === null ? null : readUsd(u.usd);
    if (recorded !== null) usd += recorded; else unrecorded += 1;
  }
  return { n, paid, usd, unrecorded };
}

/** The money part, after "what they cost before": the recorded figure and, for a paid step with no cost on record, the worst case of one call that the limit counts instead. '' when there is nothing to name. */
export function costBeforeWords({ usd = 0, unrecorded = 0 } = {}) {
  const parts = [];
  if (usd > 0) parts.push(formatUsd(usd));
  if (unrecorded > 0) parts.push(`one call's worst case for ${unrecorded === 1 ? 'the 1 step' : `each of the ${unrecorded} steps`} with no cost on record`);
  return parts.length ? ` (${parts.join(', plus ')})` : '';
}

/**
 * The two sentences of the limit screen and of the log line (A-DRAFT, LAD-S3 / LAD-S5 / LAD-S6): a COUNT of the finished steps made under the earlier chain or task (not a promise about the path the run takes), what happens to the ones it reaches again, and, only for the steps
 * that bill, that they are paid again with their old cost still counted. Under per-provider limits each limit's screen carries the paid count and the cost of the steps billed through THAT limit, assigned by the same function the cap replays by (caps.js recordedCapOf: the record's own capName).
 */
export function staleSentences(rerun) {
  const { n, paid, usd, unrecorded } = rerun;
  const made = n === 1 ? '1 finished step of this run was made under the earlier chain or task: if the run reaches it again, it is asked again.' : `${n} finished steps of this run were made under the earlier chain or task: each one the run reaches again is asked again.`;
  const { limit } = rerun;   // the name of the per-provider limit this screen is for, when there is one: the sentence then says which limit its numbers are of
  if (limit) return paid ? `${made} Of these, ${paid === 1 ? '1 bills' : `${paid} bill`} through the ${limit} limit and ${paid === 1 ? 'is' : 'are'} paid again if asked again, and what ${paid === 1 ? 'it' : 'they'} cost there before${costBeforeWords({ usd, unrecorded })} still counts toward the ${limit} limit.` : `${made} None of these bills through the ${limit} limit.`;
  if (!paid) return made;
  return `${made} ${paid === 1 ? 'The paid step is' : `The ${paid} paid steps are`} paid again if asked again, and what ${paid === 1 ? 'it' : 'they'} cost before${costBeforeWords({ usd, unrecorded })} still counts toward the limit.`;
}

/** The ONE line of a resume with no limit screen (a chain with no paid seat, or a paid one without a gate: a tree member, an adopted advice call). */
export function staleNoticeLine(stale) {
  return `The chain or the task changed since this run's steps were made. ${staleSentences(stale)}`;
}
