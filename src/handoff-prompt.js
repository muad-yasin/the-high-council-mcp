// The handoff seat's two prompts, in one place (0.8.2 wiring, items 10a and 10c). Code only: the words are src/roles.js's (HANDOFF_SYSTEM, handoffUser) and, once the milestone format is recorded there, its `handoffSystem` /
// `handoffUserMilestones` (until then held test data, src/held-roles.js). A chain that sets `handoff_contract.milestones` asks the seat for milestones with checks (src/milestones.js lints what it writes); every
// other chain, and every chain before the re-record, gets the prompts that have always been sent, byte for byte. The run (src/chain.js) and `council handoff --from-run` (src/cli.js) both come through here so they cannot drift.
import * as R from './roles.js';
import { held } from './held-roles.js';
import { oneShotFor, oneShotSeatSystem } from './builder-kind.js';
import { withVerifyFirst } from './verify-first.js';

/**
 * The file name the handoff prompt tells the build session the plan is saved as (0.8.4 D3, plan A T2.6): the chain's own `handoffPlanFile` when it sets one, else the name the CLI writes the delivered plan under
 * (`deliverable.md`, src/cli.js) once that proposed name is recorded in src/roles.js (T3.3 entry 8: held, `handoffPlanFileName`), else `PLAN.md` as it always was. `council handoff --from-run` (src/cli.js) passes this as `planFile` now;
 * the run's own handoff stage (src/chain.js) still passes `config.handoffPlanFile || 'PLAN.md'` and moves to this as its own unit, so the two say the same thing once the name is recorded.
 */
export function handoffPlanFileOf(config) {
  if (config?.handoffPlanFile) return config.handoffPlanFile;
  const recorded = held('handoffPlanFileName')?.();
  return typeof recorded === 'string' && recorded ? recorded : 'PLAN.md';
}
import { ratingsDemanded } from './ratings-demand.js';

/** { system, user } for the handoff seat. `criteria` are the run's criteria texts (the milestone prompt numbers them C1, C2, ...). */
export function handoffPrompt({ config, request, draft, planFile = 'PLAN.md', checks = '', criteria = [], treeMember = false, notes = null, ending = null, openObjections = null }) {
  const milestones = config?.handoff_contract?.milestones === true;
  const system = milestones ? held('handoffSystem') : undefined;
  const user = milestones ? held('handoffUserMilestones') : undefined;
  // 0.8.3 M3 (PLAN 5.2): a tree member's handoff seat is also asked to reproduce the plan's split block verbatim. Held like the rest: nothing is added while `treeSplitHandoffNote` is not recorded in src/roles.js.
  const note = treeMember ? held('treeSplitHandoffNote')?.() : null;
  const withNote = s => (note ? `${s}\n\n${note}` : s);
  // 0.8.3 notes lane 2b-1b (the FOLD): the items still unanswered ride in this call, appended to the USER prompt (quoted judge text is data, never part of the system prompt). `notes` is built by the run only when the lane is on, items
  // are unanswered and the held `reviewNotesAnswer` exists; absent, both prompts are the strings that have always been sent (`council handoff --from-run` passes none).
  const noteText = notes?.rows?.length ? held('reviewNotesAnswer')?.({ rows: notes.rows, ending: notes.ending }) : null;
  const withAsk = u => (noteText ? `${u}\n\n${noteText}` : u);
  // 0.8.4 round 1, 9a (A-DRAFT): the objections still open at a run that ended agreed on the handler's check (src/chain.js passes them only then) ride at the END of the user prompt, after the notes fold, as quoted data with one lead sentence; no system sentence.
  const openText = openObjections?.length ? R.handoffOpenObjectionsBlock({ rows: openObjections }) : null;
  const withOpen = u => (openText ? `${u}\n\n${openText}` : u);
  // 0.8.4 D29 / T2.5 (T3.3 entry 7): after a run that did NOT agree, the seat is told at the top of its user prompt how the run ended (the ending word and the matrix's reason sentence) and that ready_for_build and partial are not Status values it may write. `ending` is passed by
  // the run only ({ word, reason, agreed }); `council handoff --from-run` and the dry run's estimate pass none. Held: nothing is added while `handoffEndingLines` is not recorded in src/roles.js, and an agreed run is told nothing.
  const endingText = ending && ending.agreed !== true ? held('handoffEndingLines')?.({ word: ending.word, reason: ending.reason }) : null;
  const withEnding = u => (endingText ? `${endingText}\n\n${u}` : u);
  // TAGS SHOWN (A-DRAFT): with the rating demand in force (src/ratings-demand.js), the handoff seat is told what the number on an objection means (the writer's sentence, the same one the reviser and the dispute prompt carry): the draft it reads carries each unresolved objection's rating. Demand held, or a chain that records no ratings: nothing is added.
  // 0.8.4 D22 (settled item 6): a chain with `builder_kind: "one_shot"` writes the handoff for a build session that works alone (src/builder-kind.js). Inert unless its held words are recorded; the key unset or "session": no change.
  const oneShot = oneShotFor(config);
  const forBuilder = s => (oneShot ? oneShotSeatSystem(s, oneShot) : s);
  const withSev = s => (ratingsDemanded(config) ? `${s}\n\n${R.SEVERITY_WRITER_SENTENCE}` : s);
  if (system && user) return { system: withSev(withNote(forBuilder(withVerifyFirst(system({ milestones: true }), { milestones: true })))), user: withEnding(withOpen(withAsk(user({ request, draft, planFile, checks, criteria })))) };
  return { system: withSev(withNote(forBuilder(withVerifyFirst(R.HANDOFF_SYSTEM)))), user: withEnding(withOpen(withAsk(R.handoffUser({ request, draft, planFile, checks })))) };
}
