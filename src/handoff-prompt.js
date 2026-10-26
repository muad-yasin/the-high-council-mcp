// The handoff seat's two prompts, in one place (0.8.2 wiring, items 10a and 10c). Code only: the words are src/roles.js's (HANDOFF_SYSTEM, handoffUser) and, once the milestone format is recorded there, its `handoffSystem` /
// `handoffUserMilestones` (until then held test data, src/held-roles.js). A chain that sets `handoff_contract.milestones` asks the seat for milestones with checks (src/milestones.js lints what it writes); every
// other chain, and every chain before the re-record, gets the prompts that have always been sent, byte for byte. The run (src/chain.js) and `council handoff --from-run` (src/cli.js) both come through here so they cannot drift.
import * as R from './roles.js';
import { held } from './held-roles.js';

/** { system, user } for the handoff seat. `criteria` are the run's criteria texts (the milestone prompt numbers them C1, C2, ...). */
export function handoffPrompt({ config, request, draft, planFile = 'PLAN.md', checks = '', criteria = [], treeMember = false, notes = null }) {
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
  if (system && user) return { system: withNote(system({ milestones: true })), user: withAsk(user({ request, draft, planFile, checks, criteria })) };
  return { system: withNote(R.HANDOFF_SYSTEM), user: withAsk(R.handoffUser({ request, draft, planFile, checks })) };
}
