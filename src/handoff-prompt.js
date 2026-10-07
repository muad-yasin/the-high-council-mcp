// The handoff seat's two prompts, in one place (0.8.2 wiring, items 10a and 10c). Code only: the words are src/roles.js's (HANDOFF_SYSTEM, handoffUser) and, once the milestone format is recorded there, its `handoffSystem` /
// `handoffUserMilestones` (until then held test data, src/held-roles.js). A chain that sets `handoff_contract.milestones` asks the seat for milestones with checks (src/milestones.js lints what it writes); every
// other chain, and every chain before the re-record, gets the prompts that have always been sent, byte for byte. The run (src/chain.js) and `council handoff --from-run` (src/cli.js) both come through here so they cannot drift.
import * as R from './roles.js';
import { held } from './held-roles.js';

/** { system, user } for the handoff seat. `criteria` are the run's criteria texts (the milestone prompt numbers them C1, C2, ...). */
export function handoffPrompt({ config, request, draft, planFile = 'PLAN.md', checks = '', criteria = [] }) {
  const milestones = config?.handoff_contract?.milestones === true;
  const system = milestones ? held('handoffSystem') : undefined;
  const user = milestones ? held('handoffUserMilestones') : undefined;
  if (system && user) return { system: system({ milestones: true }), user: user({ request, draft, planFile, checks, criteria }) };
  return { system: R.HANDOFF_SYSTEM, user: R.handoffUser({ request, draft, planFile, checks }) };
}
