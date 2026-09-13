// test/probe-role-experiment.test.js
//
// v6 role-seat plan §5 (KIMI-5/GLM-4 merged design): the four-arm role-conditioning measurement
// that gates phases 5-6. Offline, deterministic, no API key - reuses v5's seeded-defect probe
// fixtures/detectors unchanged (test/quality-probe/fixtures.js, detectors.js); the mock-seat /
// arm / decision layer lives in test/quality-probe/role-experiment.js. See that file's own header
// comment for the pre-registered lens->defect-type mapping and decision rule, and this
// directory's test/quality-probe/README.md for what a catch-rate or unanimity number here may
// never be quoted as.
//
// STATUS NOTE for anyone reading this file before it has ever produced a real result: this test
// suite validates the MEASUREMENT HARNESS itself, offline, against its own checked-in fixtures.
// It does not require, and must not be run as if it exercises, the live role-seat mechanism
// (phases 1-3), which does not exist in this worktree. Running `node --test` here is testing this
// harness's own code, the same as running any other test file in this repo - it is not "running
// the experiment" against phases 1-3, which stays gated until they land (handoff.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import { runRoleExperiment, decide, ARMS, LENSES, LENS_TO_DEFECT_TYPE, summarize } from './quality-probe/role-experiment.js';
import { DEFECT_TYPES } from './quality-probe/fixtures.js';

test('role_experiment_smoke: all four arms run all 100 cells (5 fixtures x 5 defect types x 4 arms), offline, no API key', () => {
  const result = runRoleExperiment();
  assert.equal(result.fixtureCount, 5);
  assert.equal(result.defectTypeCount, 5);
  assert.equal(result.totalCells, 100);
  assert.deepEqual(result.arms, ['A', 'B', 'C', 'D']);
  assert.equal(result.rows.length, 100);
});

test('role_experiment: the lens->defect-type routing is pre-registered, one lens per defect type, every defect type covered', () => {
  assert.equal(LENSES.length, 5);
  assert.deepEqual(Object.keys(LENS_TO_DEFECT_TYPE).sort(), [...LENSES].sort());
  assert.deepEqual(Object.values(LENS_TO_DEFECT_TYPE).sort(), [...DEFECT_TYPES].sort());
});

test('role_experiment: persona-only arm C is mechanically identical to arm A, and lens+persona arm D identical to arm B - persona carries no detection effect by design', () => {
  const result = runRoleExperiment();
  const byArmFixtureType = (arm) => Object.fromEntries(
    result.rows.filter((r) => r.arm === arm).map((r) => [`${r.fixture}:${r.defectType}`, { caught: r.caught, unanimous: r.unanimous }]),
  );
  assert.deepEqual(byArmFixtureType('C'), byArmFixtureType('A'));
  assert.deepEqual(byArmFixtureType('D'), byArmFixtureType('B'));
});

test('role_experiment: the summary prints exactly one of POSITIVE / NEGATIVE / INCONCLUSIVE, and always carries the LIMIT statement', () => {
  const result = runRoleExperiment();
  assert.ok(['POSITIVE', 'NEGATIVE', 'INCONCLUSIVE'].includes(result.decision.verdict));
  const summary = summarize(result);
  assert.ok(summary.includes(result.decision.verdict));
  assert.ok(summary.includes('LIMIT'));
  assert.ok(result.limit.includes('GLM/Kimi/DeepSeek/Mistral/Qwen'), 'the LIMIT must name real labs by name to make the contrast with the mock seats concrete');
  assert.ok(result.limit.length > 0);
});

test('role_experiment: the forbidden sentence from test/quality-probe/README.md is named inside the LIMIT, not just implied', () => {
  const result = runRoleExperiment();
  assert.ok(result.limit.includes('The High Council catches'), 'LIMIT must name the exact forbidden phrasing, so a caller cannot report this result without seeing it');
});

test('role_experiment: a cell that throws is visible in rows and in errors, excluded from every rate, never silently dropped', () => {
  // Regression-shaped test: tonight's real incident was a chain reporting passed:true while a
  // lab's reply could not be parsed and its verdict was silently dropped. This proves the
  // equivalent failure shape cannot happen quietly here - a malformed fixture must surface as an
  // explicit error row and an explicit errors[] entry, and must not be averaged in as a pass.
  const malformedFixture = {
    id: 'malformed-fixture',
    sections: ['A', 'B', 'C'],
    numberLabel: 'X', correctValue: '1', constraintPhrase: 'irrelevant', objectionId: 'Z',
    // 'defects' is missing entirely - every cell for this fixture must throw and be recorded as
    // an error, not silently produce `undefined` and pass a truthiness check somewhere.
  };
  const result = runRoleExperiment([malformedFixture]);
  assert.equal(result.totalCells, DEFECT_TYPES.length * 4); // 4 arms x 5 defect types, all attempted
  assert.equal(result.errors.length, result.totalCells); // every single cell for this fixture failed
  for (const row of result.rows) {
    assert.equal(row.status, 'error');
    assert.equal(row.caught, null);
    assert.equal(row.unanimous, null);
    assert.ok(row.error.length > 0);
  }
  // The decision must still be reachable and must not crash or silently read the errored cells as
  // zero catches averaged into a rate - overallOf() returns null rates when scoredCells is 0,
  // never 0 (which would misleadingly look like "ran clean and caught nothing").
  assert.equal(result.decision.armA.scoredCells, 0);
  assert.equal(result.decision.armA.catchRate, null);
  assert.equal(result.decision.armA.erroredCells, DEFECT_TYPES.length);
});

test('role_experiment: decide() can be proven to emit NEGATIVE directly, against a fixture engineered so no arm can ever win', () => {
  // Engineered by hand (not via fixtures.js's makeFixture) so every one of its properties is
  // visible and auditable right here, not inherited implicitly from the shared v5 fixture
  // generator. The single vulnerability that lets a lens-bearing arm ever beat arm A on the real
  // v5 fixtures is dropped_constraint's decoy sharing >=2 significant (>3 letter) words with the
  // real constraint phrase (case-1-plan-shop's "payment"/"provider" overlap) - which makes the
  // 'medium' and 'loose' detector tiers disagree with 'strict'. This fixture's decoy is chosen to
  // share ZERO significant words with its constraint phrase, closing that one gap; every other
  // defect type's strict/medium tiers already agree by the detectors' own construction (verified
  // against the real fixtures in this same test run below), so this fixture ties arm A and every
  // role-bearing arm on all 5 defect types - no arm can catch a type arm A doesn't already catch.
  const sections = ['Overview', 'Method', 'Numbers', 'Timeline', 'Open Objections'];
  const numberLabel = 'Widget count';
  const correctValue = '10';
  const draftValue = '999'; // wildly off - unambiguous for strict AND medium's >5% drift check
  const constraintPhrase = 'no shared infrastructure';
  const decoy = 'the weather today is cloudy with occasional sun'; // zero words in common with the constraint phrase
  const objectionId = 'NEG1';

  const bodyFor = (missingSection, order, number, includeConstraint, objectionResolved) => {
    const present = sections.filter((s) => s !== missingSection);
    const ordered = order === 'broken' ? [present[0], present[2], present[1], ...present.slice(3)] : present;
    const lines = ordered.map((s) => `## ${s}\n\nContent for ${s}.`);
    lines.push(`\n${numberLabel}: ${number}`);
    lines.push(includeConstraint ? `\nConstraint: ${constraintPhrase}.` : `\nConstraint note: ${decoy}.`);
    lines.push(objectionResolved
      ? `\nOBJECTION ${objectionId}: raised in round 1.\nRESOLVED ${objectionId}: addressed in round 2.`
      : `\nOBJECTION ${objectionId}: raised in round 1.`);
    return lines.join('\n');
  };

  const negativeControlFixture = {
    id: 'negative-control',
    sections, numberLabel, correctValue, constraintPhrase, objectionId,
    baseline: bodyFor(null, 'ok', correctValue, true, true),
    defects: {
      missing_section: bodyFor(sections[2], 'ok', correctValue, true, true),
      wrong_number: bodyFor(null, 'ok', draftValue, true, true),
      dropped_constraint: bodyFor(null, 'ok', correctValue, false, true),
      broken_ordering: bodyFor(null, 'broken', correctValue, true, true),
      unresolved_objection: bodyFor(null, 'ok', correctValue, true, false),
    },
  };

  const result = runRoleExperiment([negativeControlFixture]);
  assert.equal(result.errors.length, 0, 'the engineered fixture must be well-formed, not merely a disguised error case');

  // Confirm the tie is real and content-driven, not an artifact of only having 1 fixture to win
  // on (which alone could never reach the required 3): every role-bearing arm's win count on
  // THIS fixture is exactly 0, not just "below 3".
  for (const arm of ['B', 'C', 'D']) {
    assert.equal(result.decision.perArm[arm].winFixtureCount, 0, `arm ${arm} must not win even the one fixture available`);
  }
  assert.equal(result.decision.verdict, 'NEGATIVE');
  assert.match(result.decision.reason, /no role-bearing arm caught more distinct defect types/);
});

test('role_experiment: regression anchor - the real 5-fixture run currently reads NEGATIVE, not synthesized', () => {
  // Not a contrived scenario: this is what runRoleExperiment() actually returns today against
  // the checked-in v5 fixtures, under this mock-seat model (specialist=strict, generic=loose).
  // Arm B/D's specialist vote (always 'strict', which is true for essentially every planted
  // defect in these fixtures) only ever out-catches arm A on one fixture (case-1-plan-shop,
  // where the dropped_constraint decoy happens to share words with the real phrase) - short of
  // the >=3-fixture bar. Recorded here as an anchor: if a future edit to detectors.js or
  // fixtures.js changes this, that's worth a human noticing via a failing test, not silently.
  const result = runRoleExperiment();
  assert.equal(result.decision.verdict, 'NEGATIVE');
  assert.equal(result.decision.perArm.B.winFixtureCount, 1);
  assert.deepEqual(result.decision.perArm.B.winFixtures, ['case-1-plan-shop']);
});

test('decide(): unit-tested directly against synthetic per-arm data for all three verdicts, independent of the detector/fixture machinery', () => {
  const fixtureIds = ['f1', 'f2', 'f3', 'f4', 'f5'];
  const row = (arm, fixture, defectType, caught, unanimous) => ({ arm, fixture, defectType, status: 'ok', caught, unanimous });

  // POSITIVE: arm B catches one more type than A on 3 of 5 fixtures, unanimity held steady.
  const positiveRows = [];
  for (const fid of fixtureIds) {
    positiveRows.push(row('A', fid, 'missing_section', true, true));
    positiveRows.push(row('A', fid, 'wrong_number', false, true));
  }
  for (const [i, fid] of fixtureIds.entries()) {
    const bWins = i < 3;
    positiveRows.push(row('B', fid, 'missing_section', true, true));
    positiveRows.push(row('B', fid, 'wrong_number', bWins, true));
  }
  const positive = decide(positiveRows, fixtureIds);
  assert.equal(positive.verdict, 'POSITIVE');

  // NEGATIVE: arm B never catches more than A anywhere.
  const negativeRows = [];
  for (const fid of fixtureIds) {
    negativeRows.push(row('A', fid, 'missing_section', true, true));
    negativeRows.push(row('B', fid, 'missing_section', true, true));
  }
  assert.equal(decide(negativeRows, fixtureIds).verdict, 'NEGATIVE');

  // INCONCLUSIVE: arm B wins on 3 fixtures (like POSITIVE above) but its overall unanimity is
  // lower than arm A's - the mixed signal the plan says must never read as a clean win.
  const mixedRows = [];
  for (const fid of fixtureIds) {
    mixedRows.push(row('A', fid, 'missing_section', true, true));
    mixedRows.push(row('A', fid, 'wrong_number', false, true));
  }
  for (const [i, fid] of fixtureIds.entries()) {
    const bWins = i < 3;
    mixedRows.push(row('B', fid, 'missing_section', true, false)); // unanimity broken on every fixture
    mixedRows.push(row('B', fid, 'wrong_number', bWins, false));
  }
  assert.equal(decide(mixedRows, fixtureIds).verdict, 'INCONCLUSIVE');
});

test('decide(): a fixture where arm A errors on one defect type must not count as a "win" for a role arm that scores it - bug-audit fix', () => {
  // Before this fix, an errored Arm A cell was simply absent from Arm A's own 'ok'-only count,
  // which silently deflated Arm A's total and could make a role arm look like it beat Arm A on a
  // defect type where the two were never actually compared. The fix excludes any defect type
  // from a fixture's win comparison unless BOTH arms have a scoreable cell for it.
  const fixtureIds = ['f1'];
  const rows = [
    { arm: 'A', fixture: 'f1', defectType: 'missing_section', status: 'ok', caught: true, unanimous: true },
    { arm: 'A', fixture: 'f1', defectType: 'wrong_number', status: 'error', caught: null, unanimous: null },
    { arm: 'B', fixture: 'f1', defectType: 'missing_section', status: 'ok', caught: true, unanimous: true },
    { arm: 'B', fixture: 'f1', defectType: 'wrong_number', status: 'ok', caught: true, unanimous: true },
  ];
  const result = decide(rows, fixtureIds);
  // Arm B must NOT be credited with a win on f1: the only comparable defect type
  // (missing_section) is a tie, and wrong_number is excluded because Arm A never scored it.
  assert.equal(result.perArm.B.winFixtureCount, 0);
  assert.deepEqual(result.perArm.B.winFixtures, []);
});

test('role_experiment: this module and its harness are never imported by any runtime src/ file (test-only, same isolation the v5 probe enforces)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const srcDir = join(root, 'src');

  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, name.name);
      if (name.isDirectory()) { walk(p); continue; }
      if (!name.name.endsWith('.js')) continue;
      const text = readFileSync(p, 'utf8');
      if (/quality-probe|role-experiment/.test(text)) offenders.push(p);
    }
  };
  walk(srcDir);
  assert.deepEqual(offenders, [], `no src/ file may import the quality probe or the role experiment: ${offenders.join(', ')}`);
});

test('role_experiment: no efficacy claim - ARM_LABELS and the decision reason never assert one arm is "better", only what was measured', () => {
  const result = runRoleExperiment();
  const forbidden = /\bbetter\b|\bbest\b|\bsuperior\b|\bimproves the council\b/i;
  assert.doesNotMatch(result.decision.reason, forbidden);
  for (const label of Object.values(result.armLabels)) assert.doesNotMatch(label, forbidden);
});
