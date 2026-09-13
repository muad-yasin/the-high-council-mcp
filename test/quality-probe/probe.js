// v5 §1 candidate 15, Phase 1: run the three sensitivity-tiered detectors (test/quality-probe/
// detectors.js, standing in for a "mock panel") against the five checked-in fixtures
// (test/quality-probe/fixtures.js), and report unanimity and catch-rate as two SEPARATE numbers.
//
// Deliberately test-only: not under src/, not in package.json's `files`, never imported by
// runtime code. See README.md in this directory for the caveats this result must always carry,
// including the one sentence this must never be quoted as.
import { FIXTURES, DEFECT_TYPES } from './fixtures.js';
import { detect, SENSITIVITIES } from './detectors.js';

/**
 * One row per (fixture, defectType): which of the three sensitivity-tiered detectors caught the
 * planted defect. `caught` (majority: >=2 of 3) and `unanimous` (all 3 agree, whether that
 * agreement is "caught" or "missed") are computed and kept separate on purpose - a panel that
 * agrees is not the same claim as a panel that is right, which is the entire reason this probe
 * exists rather than reusing an ordinary sign-off-rate number.
 */
export function runQualityProbe() {
  const rows = [];
  for (const fixture of FIXTURES) {
    for (const defectType of DEFECT_TYPES) {
      const draft = fixture.defects[defectType];
      const votes = SENSITIVITIES.map(s => detect(defectType, fixture, draft, s));
      const caughtCount = votes.filter(Boolean).length;
      rows.push({
        fixture: fixture.id,
        defectType,
        votes: Object.fromEntries(SENSITIVITIES.map((s, i) => [s, votes[i]])),
        caught: caughtCount >= 2,
        unanimous: votes.every(v => v === votes[0]),
      });
    }
  }

  const byType = {};
  for (const type of DEFECT_TYPES) {
    const typeRows = rows.filter(r => r.defectType === type);
    byType[type] = {
      instances: typeRows.length,
      catchRate: typeRows.filter(r => r.caught).length / typeRows.length,
      unanimityRate: typeRows.filter(r => r.unanimous).length / typeRows.length,
    };
  }

  const overall = {
    instances: rows.length,
    catchRate: rows.filter(r => r.caught).length / rows.length,
    unanimityRate: rows.filter(r => r.unanimous).length / rows.length,
  };

  return {
    // Everything a reader needs to know this number cannot mean more than it says, carried
    // inseparably with the numbers themselves - see the caveat-loss check in the test file.
    fixtureCount: FIXTURES.length,
    defectTypes: DEFECT_TYPES,
    baseline: 'each fixture is a synthetic planning-doc draft with one of the five defect types below planted into it; the panel is three deterministic heuristic detectors at different sensitivities, not real labs',
    caveat: 'This measures whether three heuristic detectors notice defects WE PLANTED OURSELVES in synthetic fixtures - not real-world correctness, not a comparison against any other tool, and not a claim about how a real model panel would perform. The forbidden phrasing this must never become: "The High Council catches N% of defects." Unanimity (the detectors agreed) and catch-rate (the majority was right) are reported separately because conflating them is the reason this probe exists.',
    overall,
    byDefectType: byType,
    rows,
  };
}
