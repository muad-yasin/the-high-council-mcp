// v5 item 1: outcome classification, split into its own pure module so it's testable with
// nothing else running (backend-developer/SKILL.md rule 1) - src/cli.js's reportJsonShape()
// only calls this.
//
// `degraded` wins over the other two: a missing or unreadable verdict means the verdict was
// never reached by the full intended roster, no matter what the roster that DID answer decided.
// Checked directly against real code before writing this: a provider-call exception during the
// critique loop pushes to `dropouts`, but a critic that answered with unreadable/unparseable
// JSON never does - it's recorded only as an abstention (`signoff[].signedOff === null`,
// `signoff[].passed === false`), with no corresponding `dropouts` entry. `outcome` checks both
// signals, not just `dropouts`, so a run degraded by unreadable replies isn't mislabeled
// consensus/no_consensus - the exact gap v5's own planning run exposed (Kimi never returned a
// verdict, an infra failure with no dropouts entry).
export function computeOutcome(result) {
  const hasDropout = Array.isArray(result?.dropouts) && result.dropouts.length > 0;
  const hasAbstention = Array.isArray(result?.signoff)
    && result.signoff.some(s => s.signedOff === null && s.passed === false);
  if (hasDropout || hasAbstention) return 'degraded';
  return result?.passed === true ? 'consensus' : 'no_consensus';
}
