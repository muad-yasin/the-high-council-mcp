// v5 §1 candidate 15, Phase 1: five checked-in fixtures, each a small planning-doc draft with
// one defect of each of the five named types planted into it. Deliberately test-only - not
// under src/, not in package.json's `files`, never shipped or imported by runtime code.
//
// Each fixture carries its own ground truth (expected sections, expected order, the correct
// number, the required constraint phrase, the objection id that must be resolved) so a detector
// never needs anything the fixture itself doesn't supply - there is no hidden "answer key" a
// probe run could drift from.
export const DEFECT_TYPES = [
  'missing_section', 'wrong_number', 'dropped_constraint', 'broken_ordering', 'unresolved_objection',
];

function makeFixture({ id, sections, numberLabel, correctValue, draftValue, constraintPhrase, decoy, objectionId }) {
  // Baseline: every section present, in order, correct number, constraint present, objection
  // resolved. The planted-defect draft is derived from this by breaking exactly one thing per
  // defect type (checked independently below, not compounded into one draft) so each defect
  // type's catch rate is measured in isolation rather than confounded by the others.
  const bodyFor = (missingSection, order, number, includeConstraint, objectionResolved) => {
    const present = sections.filter(s => s !== missingSection);
    // Swaps the two MIDDLE sections (never the first or last), so a detector that only compares
    // a document's first and last heading (the "loose" tier below) genuinely cannot see this
    // break - a deliberately different failure shape from a detector that walks the whole order.
    const ordered = order === 'broken' ? [present[0], present[2], present[1], ...present.slice(3)] : present;
    const lines = ordered.map(s => `## ${s}\n\nContent for ${s}.`);
    lines.push(`\n${numberLabel}: ${number}`);
    if (includeConstraint) lines.push(`\nConstraint: ${constraintPhrase}.`);
    else lines.push(`\nConstraint note: ${decoy}.`);
    lines.push(objectionResolved
      ? `\nOBJECTION ${objectionId}: raised in round 1.\nRESOLVED ${objectionId}: addressed in round 2.`
      : `\nOBJECTION ${objectionId}: raised in round 1.`);
    return lines.join('\n');
  };

  return {
    id,
    sections,
    numberLabel,
    correctValue,
    constraintPhrase,
    objectionId,
    baseline: bodyFor(null, 'ok', correctValue, true, true),
    defects: {
      missing_section: bodyFor(sections[2], 'ok', correctValue, true, true),
      wrong_number: bodyFor(null, 'ok', draftValue, true, true),
      dropped_constraint: bodyFor(null, 'ok', correctValue, false, true),
      broken_ordering: bodyFor(null, 'broken', correctValue, true, true),
      unresolved_objection: bodyFor(null, 'ok', correctValue, true, false),
    },
  };
}

export const FIXTURES = [
  makeFixture({
    id: 'case-1-plan-shop',
    sections: ['Summary', 'Plan', 'Risks', 'Rollout', 'Open Objections'],
    numberLabel: 'Budget', correctValue: '40', draftValue: '45',
    constraintPhrase: 'no new payment provider',
    decoy: 'payment provider integration unchanged, no new servers',
    objectionId: 'A1',
  }),
  makeFixture({
    id: 'case-2-intake-form',
    sections: ['Overview', 'Design', 'Compliance', 'Timeline', 'Open Objections'],
    numberLabel: 'Turnaround days', correctValue: '3', draftValue: '5',
    constraintPhrase: 'no new always-on service',
    decoy: 'service architecture is unchanged from the prior design',
    objectionId: 'B2',
  }),
  makeFixture({
    id: 'case-3-scoreboard',
    sections: ['Goal', 'Mechanism', 'Cost', 'Rollout', 'Open Objections'],
    numberLabel: 'Cost per run USD', correctValue: '0.28', draftValue: '0.45',
    constraintPhrase: 'no live-call staffing requirement',
    decoy: 'staffing model matches the existing shop, nothing new required',
    objectionId: 'C3',
  }),
  makeFixture({
    id: 'case-4-membership-hub',
    sections: ['Purpose', 'Tiers', 'Pricing', 'Migration', 'Open Objections'],
    numberLabel: 'Tier count', correctValue: '3', draftValue: '4',
    constraintPhrase: 'Kleinunternehmer no-VAT invoicing',
    decoy: 'invoicing follows the existing shop process',
    objectionId: 'D4',
  }),
  makeFixture({
    id: 'case-5-quality-probe-itself',
    sections: ['What', 'Why', 'Test', 'Breaks', 'Open Objections'],
    numberLabel: 'Fixture count', correctValue: '5', draftValue: '6',
    constraintPhrase: 'no efficacy claim published',
    decoy: 'no claims section changed from the last draft',
    objectionId: 'E5',
  }),
];
