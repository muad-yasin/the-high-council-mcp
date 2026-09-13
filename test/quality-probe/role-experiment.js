// v6 role-seat plan §5 (KIMI-5/GLM-4 merged design): the four-arm role-conditioning experiment
// that gates phases 5-6. Reuses the v5 seeded-defect probe's fixtures and detectors UNCHANGED
// (test/quality-probe/fixtures.js, detectors.js) - this file only adds the mock-seat / arm /
// decision layer on top. Deliberately test-only, offline, no API key - see this directory's
// README.md for what a catch-rate or unanimity number here may never be quoted as, including the
// one forbidden sentence.
//
// PRE-REGISTRATION: every threshold and the lens->defect-type mapping below is committed before
// any arm has ever been run against real data (phases 1-3 do not exist yet in this worktree) -
// that ordering is the whole discipline this section exists to enforce. Nothing here may be
// tuned after seeing a result.
import { FIXTURES, DEFECT_TYPES } from './fixtures.js';
import { detect, SENSITIVITIES } from './detectors.js';

export const ARMS = ['A', 'B', 'C', 'D'];
export const ARM_LABELS = {
  A: 'plain (no role set - today\'s behavior)',
  B: 'lens-only (5 mock seats, distinct lens each, no persona)',
  C: 'persona-only (5 mock seats, persona each, no lens)',
  D: 'lens+persona (both set)',
};

// Five lenses, one per mock seat - named directly from the plan §5 text, not invented here.
export const LENSES = ['adversary', 'integrator', 'long-horizon', 'user-advocate', 'security-and-legal'];

// Pre-registered lens -> defect-type routing. Each lens is the "assigned specialist" for exactly
// one defect type, chosen for a stated reason before any run - not fitted to make an arm win.
// A lens-bearing seat checks its assigned category with the detector's 'strict' tier (its
// specialty); every seat also runs a generic, unspecialized 'loose' pass on every category
// (a seat without focus on a topic still gives it a shallow look, same as today's plain arm
// includes a loose-tier vote). This is the "routing, not smarter" mechanism the plan requires:
// nothing here makes the underlying detector functions more powerful, only which tier gets
// invoked with priority for which category.
export const LENS_TO_DEFECT_TYPE = {
  adversary: 'dropped_constraint', // an adversarial read looks for a requirement quietly weakened
  integrator: 'broken_ordering', // an integrator checks how the pieces are sequenced/fit together
  'long-horizon': 'wrong_number', // long-horizon thinking is what catches a figure drifting over time
  'user-advocate': 'missing_section', // a user advocate notices when the reader-facing section is gone
  'security-and-legal': 'unresolved_objection', // security/legal cares whether a raised objection was actually closed
};

// Persona has NO modeled effect on catch or unanimity, by construction, and this is the point,
// not an oversight: this experiment measures whether ROLE-CONDITIONING (specifically lens-driven
// routing) changes what a detector notices. A persona is a name and a voice, not a checklist -
// giving it one here would be inventing a mechanism the real design (§3/§6) never claims persona
// has. Arm C is therefore mechanically identical to Arm A, and Arm D identical to Arm B, in this
// mock-seat model. Whether a REAL model panel's persona affects anything is exactly the kind of
// question this offline harness cannot answer - see LIMIT below.
const PERSONA_HAS_DETECTION_EFFECT = false;

export const LIMIT =
  'LIMIT: the "seats" here are deterministic heuristic mocks selecting which detector tier to ' +
  'run, not real GLM/Kimi/DeepSeek/Mistral/Qwen model calls. This measures whether role-' +
  'conditioning changes what the PROBE catches (a routing effect over fixed detector functions) ' +
  '- it says nothing directly about what a live multi-lab council would catch, whether real ' +
  'model judgment changes with a role, or whether narration affects a live debate. ' + FORBIDDEN();

function FORBIDDEN() {
  // Kept as a function so this exact string can never silently drift from
  // test/quality-probe/README.md's own copy without a diff surfacing it.
  return 'The forbidden phrasing this experiment must never become, anywhere its numbers are quoted: "The High Council catches N% of defects."';
}

/**
 * Runs one (fixture, defectType) cell for a plain-arm read: reuses the existing three-tier
 * detector vote unchanged, exactly the v5 probe's own per-cell logic - Arm A IS "today's
 * behavior" by definition, not a re-implementation of it.
 */
function plainCell(fixture, defectType, draft) {
  const votes = SENSITIVITIES.map((s) => detect(defectType, fixture, draft, s));
  return {
    caught: votes.filter(Boolean).length >= 2,
    unanimous: votes.every((v) => v === votes[0]),
  };
}

/**
 * Runs one (fixture, defectType) cell for a lens-bearing arm: the seat whose lens is assigned to
 * this defectType votes with the 'strict' tier (its specialty); every seat (including the
 * specialist) also has a generic 'loose' vote available. caught = specialist-strict OR generic-
 * loose; unanimous = the two distinct vote values agree (specialist vote and generic vote are the
 * same). Five mock seats exist conceptually (one per lens) but only the assigned specialist's
 * vote differs from the shared generic read for any given defectType, so the other four seats'
 * votes are identical to the generic read by construction, not fabricated diversity.
 */
function lensCell(fixture, defectType, draft) {
  const specialistLens = Object.entries(LENS_TO_DEFECT_TYPE).find(([, dt]) => dt === defectType)?.[0];
  if (!specialistLens) throw new Error(`no lens is registered for defect type "${defectType}" - LENS_TO_DEFECT_TYPE is missing an entry`);
  const specialistVote = detect(defectType, fixture, draft, 'strict');
  const genericVote = detect(defectType, fixture, draft, 'loose');
  return {
    caught: specialistVote || genericVote,
    unanimous: specialistVote === genericVote,
    specialistLens,
  };
}

/**
 * Runs every (fixture, defectType) cell for one arm against one fixture set. A cell that throws
 * is recorded with status 'error' and excluded from every numeric aggregate, but it stays in
 * `rows` and is additionally listed in the returned `errors` array - it must be visible, never
 * silently dropped from a mean (the exact false-pass shape this measurement must not reproduce).
 */
function runArmAgainstFixtures(arm, fixtures) {
  const rows = [];
  const errors = [];
  for (const fixture of fixtures) {
    for (const defectType of DEFECT_TYPES) {
      const base = { arm, fixture: fixture.id, defectType };
      try {
        const draft = fixture.defects[defectType];
        if (draft === undefined) throw new Error(`fixture "${fixture.id}" has no planted draft for defect type "${defectType}"`);
        const result = arm === 'A' || arm === 'C' ? plainCell(fixture, defectType, draft) : lensCell(fixture, defectType, draft);
        rows.push({ ...base, status: 'ok', caught: result.caught, unanimous: result.unanimous, persona: arm === 'C' || arm === 'D' });
      } catch (err) {
        const row = { ...base, status: 'error', caught: null, unanimous: null, error: err.message };
        rows.push(row);
        errors.push(row);
      }
    }
  }
  return { rows, errors };
}

function scored(rows) {
  return rows.filter((r) => r.status === 'ok');
}

function overallOf(rows) {
  const ok = scored(rows);
  return {
    totalCells: rows.length,
    scoredCells: ok.length,
    erroredCells: rows.length - ok.length,
    catchRate: ok.length ? ok.filter((r) => r.caught).length / ok.length : null,
    unanimityRate: ok.length ? ok.filter((r) => r.unanimous).length / ok.length : null,
  };
}

/**
 * Compares one role-bearing arm against Arm A on one fixture, counting only defect types where
 * BOTH arms have a scoreable ('ok') cell. A defect type where either side errored is excluded
 * from the comparison entirely, not silently treated as "arm A didn't catch it" - bug-audit
 * finding: counting only the surviving arm's 'ok' cells let an errored Arm A cell quietly
 * deflate its own count, making a role arm look like it won a fixture it never actually beat
 * Arm A on for that type. Returns { armCaught, otherCaught, comparable } so a caller can also see
 * how many types were even eligible to compare, if that ever needs surfacing.
 */
function compareCaughtTypes(rows, arm, fixtureId) {
  const byType = (a) => Object.fromEntries(
    rows.filter((r) => r.arm === a && r.fixture === fixtureId).map((r) => [r.defectType, r]),
  );
  const armRows = byType(arm);
  const aRows = byType('A');
  let armCaught = 0;
  let otherCaught = 0;
  let comparable = 0;
  for (const defectType of DEFECT_TYPES) {
    const armRow = armRows[defectType];
    const aRow = aRows[defectType];
    if (!armRow || !aRow || armRow.status !== 'ok' || aRow.status !== 'ok') continue; // excluded, not counted as a loss for either side
    comparable++;
    if (armRow.caught) armCaught++;
    if (aRow.caught) otherCaught++;
  }
  return { armCaught, otherCaught, comparable };
}

/**
 * The pre-registered decision rule (plan §5), implemented once so it can be unit-tested directly
 * against synthetic per-arm data as well as exercised end-to-end - the SAME function both paths
 * call, so a "prove it can say NEGATIVE" test is exercising the real decision code, not a shadow
 * copy of it.
 *
 * - POSITIVE: some role-bearing arm (B/C/D) catches at least one more distinct defect type than
 *   Arm A on >= 3 of the fixtures in this run, AND that same arm's overall unanimity does not
 *   drop below Arm A's.
 * - INCONCLUSIVE: some role-bearing arm wins on >= 3 fixtures but ALSO shows an unanimity drop -
 *   the mixed-signal case the plan names explicitly, never allowed to read as a win.
 * - NEGATIVE: no role-bearing arm wins on >= 3 fixtures at all (whether or not unanimity moved),
 *   or - having found no clean or mixed win - some arm's unanimity dropped outright. Both are
 *   valid, reportable, expected outcomes, not failures of the experiment itself.
 */
export function decide(rows, fixtureIds) {
  const armAOverall = overallOf(rows.filter((r) => r.arm === 'A'));
  const perArm = {};
  let cleanWinner = null;
  let mixedWinner = null;

  for (const arm of ['B', 'C', 'D']) {
    const armRows = rows.filter((r) => r.arm === arm);
    const armOverall = overallOf(armRows);
    const winFixtures = fixtureIds.filter((fid) => {
      const cmp = compareCaughtTypes(rows, arm, fid);
      return cmp.armCaught > cmp.otherCaught;
    });
    const wins = winFixtures.length >= 3;
    const unanimityDrop = armOverall.unanimityRate !== null && armAOverall.unanimityRate !== null
      && armOverall.unanimityRate < armAOverall.unanimityRate;
    perArm[arm] = { overall: armOverall, winFixtureCount: winFixtures.length, winFixtures, wins, unanimityDrop };
    if (wins && !unanimityDrop && !cleanWinner) cleanWinner = arm;
    if (wins && unanimityDrop && !mixedWinner) mixedWinner = arm;
  }

  let verdict;
  let reason;
  if (cleanWinner) {
    verdict = 'POSITIVE';
    reason = `arm ${cleanWinner} caught more distinct defect types than arm A on ${perArm[cleanWinner].winFixtureCount}/${fixtureIds.length} fixtures with no unanimity drop`;
  } else if (mixedWinner) {
    verdict = 'INCONCLUSIVE';
    reason = `arm ${mixedWinner} caught more distinct defect types than arm A on ${perArm[mixedWinner].winFixtureCount}/${fixtureIds.length} fixtures, but its overall unanimity dropped below arm A's - a mixed signal, not a win`;
  } else {
    verdict = 'NEGATIVE';
    const anyDrop = Object.values(perArm).some((a) => a.unanimityDrop);
    reason = anyDrop
      ? 'no role-bearing arm won on >=3 fixtures, and at least one arm\'s unanimity dropped below arm A\'s'
      : 'no role-bearing arm caught more distinct defect types than arm A on >=3 fixtures';
  }

  return { verdict, reason, armA: armAOverall, perArm };
}

/**
 * Runs all four arms against the given fixture set (defaults to the five checked-in v5 fixtures)
 * and returns the full experiment result: every row (including error rows), the decision, and
 * the LIMIT statement that must travel with this result every time it is reported.
 */
export function runRoleExperiment(fixtures = FIXTURES) {
  const allRows = [];
  const allErrors = [];
  for (const arm of ARMS) {
    const { rows, errors } = runArmAgainstFixtures(arm, fixtures);
    allRows.push(...rows);
    allErrors.push(...errors);
  }
  const fixtureIds = fixtures.map((f) => f.id);
  const decision = decide(allRows, fixtureIds);
  return {
    fixtureCount: fixtures.length,
    defectTypeCount: DEFECT_TYPES.length,
    totalCells: allRows.length,
    arms: ARMS,
    armLabels: ARM_LABELS,
    lensToDefectType: LENS_TO_DEFECT_TYPE,
    personaHasDetectionEffect: PERSONA_HAS_DETECTION_EFFECT,
    rows: allRows,
    errors: allErrors,
    decision,
    limit: LIMIT,
  };
}

/**
 * Human-readable one-line summary, for `node --test` output and for scripts/role-experiment-
 * report.mjs. Prints exactly one of POSITIVE/NEGATIVE/INCONCLUSIVE, the reason, the error count
 * (never hidden even when zero), and the LIMIT statement - a caller cannot print the verdict
 * without this string carrying the limit along with it, the same inseparability discipline
 * probe.js's own caveat already uses.
 */
export function summarize(result) {
  const lines = [
    `${result.decision.verdict} - ${result.decision.reason}`,
    `cells: ${result.totalCells} total, ${result.errors.length} errored (errored cells are excluded from every rate above, never averaged in as a pass or a fail)`,
    result.limit,
  ];
  return lines.join('\n');
}
