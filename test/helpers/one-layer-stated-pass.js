// The ONE-LAYER stated-pass end the final-read rows are re-aimed at (0.8.4 apply, C&C ruling 12 Nov 2026, part 3). A layered chain whose critics are all on layer 1 (the lint accepts it: layers start at 1 and run without a gap) with the undocumented chain key
// `freedoms: { pass: true }`: seat-a signs off, seat-b STATES A PASS at the panel, a handler (an external reviser) answers good_to_build, so the run ends AGREED (passed true) with seat-b's final read owed on an UNCHANGED text (the pass is not a read). Printed in jobs 124, 127, 135, 136.
// `finalRead` is seat-b's scripted reply: CLEARS (the run stays agreed) or OBJECTS (a rated-5 failure: the run ends not agreed, passed true). An in-process run on a scripted cache (test/helpers/layer-two-run.js scenario), nothing armed. Not a test file.
import { scenario, CRITERION, failureOf, FINAL_READ_OK } from './layer-two-run.js';
import { answer } from './build-check.js';

export const STATED_PASS = JSON.stringify({ pass: true, pass_reason: 'Nothing to object to.' });
export const CLEARS = FINAL_READ_OK['final-read-lc'];
export const OBJECTS = JSON.stringify({ meets: false, criteria: [{ criterion: CRITERION, verdict: 'FAILED', evidence: 'Missing.' }], failures: [failureOf(5)], verdict_line: 'no' });

/** { result, served }: the run with seat-b's final read answered by `finalRead` (CLEARS or OBJECTS); `lines` collects the run log. */
export const oneLayerRun = ({ finalRead, lines = null } = {}) => scenario({
  handler: true, critics: [['seat-a', 1], ['seat-b', 1]], lines,
  extra: { freedoms: { pass: true }, layerRevisions: undefined, maxOverseerRounds: undefined },
  overrides: { 'panel-1-seat-b': STATED_PASS, 'build-check-1': answer('good_to_build', ''), 'final-read-seat-b': finalRead },
});
