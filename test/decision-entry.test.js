// 0.8.4 S9 (the proposer return, Q10): src/decision-entry.js reads one numbered entry of a plan's Decisions section and checks a quoted Choice line against it. Pure, $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
const DE = await import('../src/decision-entry.js').catch(() => ({}));   // a dynamic import: on a tree without the module a row fails by assertion, not at link time
import { decisionsSection } from '../src/argued.js';

const PLAN = `# Plan

## Architecture

Some text. Decision 2 is mentioned here in passing.

## Decisions

### Decision 1: Storage engine
- Context: the plan stores orders.
- Options considered: SQLite; Postgres.
- Trade-offs: SQLite is simple; Postgres scales.
- Choice: SQLite for the first release,
  with a migration path to Postgres.
- Why the others lost: Postgres needs a server the request does not have.
  Decision 1 is kept because the first release is small.
- Consequences: a migration step later.

### Decision 2: Queue
- Context: jobs run in the background.
- Options considered: in-process; a broker.
- Choice: an in-process queue.
- Why the others lost: the broker is one more service. Decision 1 is kept.

## Risks

Text.
`;

test('an entry is found by its number: title, whole text, and the Choice field without its label (a wrapped line is joined)', () => {
  const e = DE.decisionEntryOf?.(PLAN, 1);
  assert.equal(e.ok, true);
  assert.equal(e.number, 1);
  assert.equal(e.title, 'Storage engine');
  assert.equal(e.choice, 'SQLite for the first release, with a migration path to Postgres.');
  assert.ok(e.text.startsWith('### Decision 1: Storage engine') && e.text.includes('Why the others lost: Postgres needs a server') && !e.text.includes('Decision 2: Queue'));
  const e2 = DE.decisionEntryOf?.(PLAN, 2);
  assert.equal(e2.choice, 'an in-process queue.');
  assert.ok(e2.text.includes('Decision 1 is kept.') && !e2.text.includes('Risks'), 'the last entry ends at the next heading; a body sentence that names another decision starts nothing');
});

test('a body line that only begins with "Decision 2 is ..." is not an entry heading, and the section is whole', () => {
  assert.deepEqual(DE.decisionNumbersOf?.(PLAN), [1, 2]);
  assert.ok(DE.decisionEntryOf?.(PLAN, 1).text.includes('Decision 1 is kept because the first release is small.'), 'a body line that starts with "Decision 1 is ..." stays in its entry and starts nothing');
  assert.deepEqual(DE.decisionNumbersOf?.('# P\n\nNo section here.'), []);
});

test('refusals name their reason: no section, unknown number, a number twice, a non-integer', () => {
  assert.deepEqual(DE.decisionEntryOf?.('# P\n\nNothing.', 1), { ok: false, reason: 'no_decisions_section' });
  assert.deepEqual(DE.decisionEntryOf?.(PLAN, 7), { ok: false, reason: 'entry_not_found' });
  assert.deepEqual(DE.decisionEntryOf?.(PLAN, 'two'), { ok: false, reason: 'entry_not_a_number' });
  assert.deepEqual(DE.decisionEntryOf?.(PLAN, 1.5), { ok: false, reason: 'entry_not_a_number' });
  assert.deepEqual(DE.decisionEntryOf?.(PLAN, null), { ok: false, reason: 'entry_not_a_number' });
  const twice = '## Decisions\n\n### Decision 1: A\n- Choice: x\n\n### Decision 1: B\n- Choice: y\n';
  assert.deepEqual(DE.decisionEntryOf?.(twice, 1), { ok: false, reason: 'entry_ambiguous' });
});

test('an entry number written as a digit string, or as "Decision 2", is read as the number', () => {
  assert.equal(DE.decisionEntryOf?.(PLAN, '2').choice, 'an in-process queue.');
  assert.equal(DE.decisionEntryOf?.(PLAN, ' Decision 2 ').choice, 'an in-process queue.');
  assert.equal(DE.decisionEntryOf?.(PLAN, '7').reason, 'entry_not_found');
});

test('a bold heading with the colon inside the bold marks gives a clean title', () => {
  const bold = '## Decisions\n\n**Decision 1:** Storage engine\n- Choice: SQLite\n';
  assert.deepEqual(DE.decisionNumbersOf?.(bold), [1]);
  assert.equal(DE.decisionEntryOf?.(bold, 1).title, 'Storage engine');
});

test('the Choice body ends at any other bullet field, known or not, so its words cannot pass the quote check', () => {
  const plan = '## Decisions\n\n### Decision 1: A\n- Choice: use SQLite for the first release\n- Why the alternatives lost: Postgres needs a server nobody runs\n';
  const e = DE.decisionEntryOf?.(plan, 1);
  assert.equal(e.choice, 'use SQLite for the first release');
  assert.equal(DE.choiceQuoteFound?.(e, 'Postgres needs a server nobody runs'), false);
});

test('entries written as bold lines, plain lines or same-level headings are found; an entry with no Choice field has choice null', () => {
  const bold = '## Decisions\n\n**Decision 1 - Storage**\n- Choice: SQLite\n\n**Decision 2 - Queue**\n- Context: c\n';
  assert.equal(DE.decisionEntryOf?.(bold, 1).choice, 'SQLite');
  assert.equal(DE.decisionEntryOf?.(bold, 1).title, 'Storage');
  assert.equal(DE.decisionEntryOf?.(bold, 2).choice, null);
  const flat = '## Decisions\n\n## Decision 1: Storage\nChoice: SQLite\n\n## Decision 2: Queue\nChoice: in-process\n\n## Risks\n';
  assert.equal(DE.decisionEntryOf?.(flat, 2).choice, 'in-process');
  assert.deepEqual(DE.decisionNumbersOf?.(flat), [1, 2]);
});

test('the Choice quote: with or without the bullet and the label, whitespace-normalised, a part of the Choice counts; another field\'s words, an empty quote and an invented line do not', () => {
  const e = DE.decisionEntryOf?.(PLAN, 1);
  for (const q of [
    '- Choice: SQLite for the first release,\n  with a migration path to Postgres.',
    'Choice: SQLite for the first release, with a migration path to Postgres.',
    'SQLite   for the first release, with a migration path to Postgres.',
    '* **Choice**: SQLite for the first release, with a migration path',
    'with a migration path to Postgres',
  ]) assert.equal(DE.choiceQuoteFound?.(e, q), true, q);
  // the floor: a contiguous run covering at least half of the Choice's words (never fewer than three); a short Choice must be quoted whole
  for (const q of ['first', 'SQLite', 'SQLite for the', 'SQLite for the first', '- Choice: SQLite for the first release']) assert.equal(DE.choiceQuoteFound?.(e, q), false, `below the floor: ${q}`);
  assert.equal(DE.choiceQuoteFound?.(DE.decisionEntryOf?.(PLAN, 2), 'an in-process queue.'), true);
  assert.equal(DE.choiceQuoteFound?.(DE.decisionEntryOf?.(PLAN, 2), 'an in-process'), false);
  assert.equal(DE.choiceQuoteFound?.(DE.decisionEntryOf?.('## Decisions\n\n### Decision 1: A\n- Choice: SQLite\n', 1), 'SQLite'), true);
  for (const q of ['Postgres needs a server the request does not have.', 'the plan stores orders', 'Choice:', '', '   ', 'Use MySQL for the first release']) assert.equal(DE.choiceQuoteFound?.(e, q), false, q);
  assert.equal(DE.choiceQuoteFound?.({ ok: true, choice: null }, 'x'), false);
  assert.equal(DE.choiceQuoteFound?.({ ok: false, reason: 'entry_not_found' }, 'x'), false);
  assert.equal(DE.choiceQuoteFound?.(null, 'x'), false);
});

test('the section is read whole: an entry past the 8000 characters src/argued.js decisionsSection clips for a prompt is still found', () => {
  const filler = '- Context: ' + 'long text '.repeat(900) + '\n';
  const big = `## Decisions\n\n### Decision 1: Big\n${filler}- Choice: first\n\n### Decision 2: Late\n- Choice: the late choice\n`;
  assert.ok(!decisionsSection(big).includes('the late choice'), 'decisionsSection clips this plan before the late entry');
  assert.equal(DE.decisionEntryOf?.(big, 2).choice, 'the late choice');
});

test('the section is found where decisionsSection finds it (same heading rule): both see it, or neither', () => {
  for (const plan of [PLAN, '# P\n\n## 3. Decisions\n\n### Decision 1: A\n- Choice: x\n', '# P\n\nNo section.', '# P\n\n## Decisions and more\n\ntext\n']) {
    assert.equal(decisionsSection(plan) === null, DE.decisionEntryOf?.(plan, 1).reason === 'no_decisions_section');
  }
});
