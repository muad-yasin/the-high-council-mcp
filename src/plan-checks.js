// 0.8.4 D15 (plan A T1.1) and D33 (T1.6): the two information checks of the delivered plan's own BODY, wired at the run's end (src/cli.js). Pure and offline. Plan A l.22: "its findings go to the run's warnings file and the report as information"; a finding
// never changes `passed`, the exit code, the verdict or any text.
//   claim_markers    src/claim-markers.js checkClaimMarkers: a statement about the project with none of the four markers, a DISPUTED marker no dispute pass wrote, a CHECKED marker whose cited range or excerpt no seat was shown.
//   test_identifiers src/fence-tests.js checkTestIdentifiers: names a fenced test file uses that the plan never mentions.
// Each check is asked for by a lane A word (no new held name): the claim checker when `builderMarkersRule` is recorded (it tests the rule the writer seat was given), the identifier check when `handoffNoTestsLine` is recorded (D33's own line). While
// neither is recorded planChecksOf gives null: no report field, no WARNINGS.md line, every output is what it was.
// Three states per check, readable in report.json `plan_checks` (an absent check is NOT "found nothing", the rule of src/tree-ready.js milestoneLintOf): the check key absent = it was not asked for; { ran: false, reason: 'no_plan_body' } = it was asked for and the
// plan body could not be separated from the notes above it by the report's own record, so it did not run (the same named limit as the verify-first gap check); { ran: true, findings } = it ran, an empty list means it found nothing.
import { held } from './held-roles.js';
import { checkClaimMarkers, claimFindingLine } from './claim-markers.js';
import { checkTestIdentifiers, findingLine as testFindingLine } from './fence-tests.js';

const asked = name => typeof held(name) === 'function';
const rowOf = f => ({ id: f.id, message: f.message });

/**
 * { claim_markers?, test_identifiers? } for a run, or null when neither check is asked for. `plan` is the plan body (src/cli.js gapPlanOf: the body found by the report's record, else undefined), `task` the task text with its fenced blocks,
 * `excerpts` { shown, noText } (src/excerpt-record.js excerptIdSetsOf), `disputePassRan` whether the dispute pass ran.
 */
export function planChecksOf({ plan, task = null, excerpts = { shown: [], noText: [] }, disputePassRan = false } = {}) {
  const out = {};
  const haveBody = typeof plan === 'string';
  if (asked('builderMarkersRule')) out.claim_markers = haveBody ? { ran: true, findings: checkClaimMarkers({ plan, task, excerptIds: excerpts.shown, excerptNoText: excerpts.noText, disputePassRan }).map(rowOf) } : { ran: false, reason: 'no_plan_body' };
  if (asked('handoffNoTestsLine')) out.test_identifiers = haveBody && typeof task === 'string' ? { ran: true, findings: checkTestIdentifiers({ task, plan }).map(rowOf) } : { ran: false, reason: 'no_plan_body' };
  return Object.keys(out).length ? out : null;
}

/** The WARNINGS.md lines of the findings (one per finding, `- <id>: <message>`), in check order; [] when there is none. */
export function planCheckLines(checks) {
  const lines = [];
  for (const f of checks?.claim_markers?.findings ?? []) lines.push(`- ${claimFindingLine(f)}\n`);
  for (const f of checks?.test_identifiers?.findings ?? []) lines.push(`- ${testFindingLine(f)}\n`);
  return lines;
}
