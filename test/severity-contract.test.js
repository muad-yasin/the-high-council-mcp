// B3 prep, JUDGE lane, unit 1: the severity CONTRACT (src/severity.js). Pure: no run, no provider. Muad's decisions (31 Okt 2026): a 1-10 scale with bands; 7-10 blocks sign-off until FIXED; 4-6.9 blocks until the debate SETTLES it;
// below 4 does not block and goes to the closing round; a plan climbs a layer only when no objection rated 4 or above is open; the handler session or layer 3 may change a tag. The 4 and 7 lines are a start, tuned after B3.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { objectionId } from '../src/objection-ids.js';
import {
  SEVERITY_LINES, SEVERITY_SCALE, readSeverity, bandOf, holdsSignOff, holdsClimb, openAtIds, effectiveSeverity, checkRetag, settleVerdict, SETTLE_WORDS, severityOf, lintSeverityChain, mergeSeverity, endRecord, settleStateOf,
} from '../src/severity.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('the scale and the two lines are the ones Muad decided, with their source named', () => {
  assert.deepEqual({ ...SEVERITY_SCALE }, { min: 1, max: 10, step: 0.1 });
  assert.deepEqual({ ...SEVERITY_LINES }, { settle: 4, fix: 7 });
  const src = readFileSync(join(root, 'src', 'severity.js'), 'utf8');
  assert.match(src, /31 Okt 2026/, 'the constants cite the date of his decision');
  assert.match(src, /tuned after B3/, 'the constants say the lines are a start');
});

test('readSeverity: a JSON number from 1 to 10 in steps of 0.1 is a severity; anything else is unreadable and never mapped to a number', () => {
  for (const v of [1, 1.0, 3.9, 4, 4.0, 5.5, 6.9, 7, 7.5, 9, 10]) assert.deepEqual(readSeverity(v), { ok: true, value: v }, String(v));
  for (const v of [0, 0.9, 10.1, 11, -1, 6.95, 4.05, NaN, Infinity, '7', '7.5', 'high', 'High', 'major', '', null, undefined, true, [], [7], {}, { value: 7 }]) {
    const r = readSeverity(v);
    assert.equal(r.ok, false, `${JSON.stringify(v)} must be unreadable`);
    assert.equal(typeof r.why, 'string');
    assert.ok(r.why.length > 0);
    assert.equal('value' in r, false, 'an unreadable severity carries no value');
  }
});

test('bandOf: 3.9 is swept, 4.0 and 6.9 settle, 7.0 and 10 must be fixed (the boundaries)', () => {
  assert.equal(bandOf(1), 'sweep'); assert.equal(bandOf(3.9), 'sweep');
  assert.equal(bandOf(4), 'settle'); assert.equal(bandOf(4.0), 'settle'); assert.equal(bandOf(6.9), 'settle');
  assert.equal(bandOf(7), 'fix'); assert.equal(bandOf(7.0), 'fix'); assert.equal(bandOf(10), 'fix');
  assert.throws(() => bandOf('7'), /severity/); assert.throws(() => bandOf(undefined), /severity/); assert.throws(() => bandOf(11), /severity/);
});

test('holdsSignOff and holdsClimb: below 4 holds neither; 4 and above hold both (his A: no objection rated 4 or above open)', () => {
  assert.equal(holdsSignOff(3.9), false); assert.equal(holdsClimb(3.9), false);
  for (const v of [4, 6.9, 7, 10]) { assert.equal(holdsSignOff(v), true, `${v} sign-off`); assert.equal(holdsClimb(v), true, `${v} climb`); }
  // No readable tag: held (a throw here would crash a sign-off site, and reading it as below 4 would fail open).
  assert.equal(holdsSignOff(null), true); assert.equal(holdsClimb('9'), true); assert.equal(holdsSignOff(undefined), true);
});

test('the id of an objection ignores severity, so a tag or a re-tag never makes a second objection', () => {
  const f = { criterion: 'It states the assumptions.', problem: 'None stated.', quote: 'Steps' };
  assert.equal(objectionId('la', { ...f, severity: 9 }), objectionId('la', f));
  assert.equal(objectionId('la', { ...f, severity: 2 }), objectionId('la', { ...f, severity: 9 }));
});

test('severityOf: reads the tag off an objection; a missing or unreadable tag is { ok: false } and never defaults to a number', () => {
  assert.deepEqual(severityOf({ severity: 6.5 }), { ok: true, value: 6.5 });
  for (const f of [{}, { severity: undefined }, { severity: 'high' }, { severity: 12 }, null, undefined, 'x']) assert.equal(severityOf(f).ok, false, JSON.stringify(f));
});

test('effectiveSeverity: the raiser\'s own tag stands until the handler or layer 3 changes it; every change is kept beside the original', () => {
  const f = { id: 'O-aaaaaaaa', severity: 8 };
  assert.equal(effectiveSeverity(f, []), 8);
  const changes = [
    { id: 'O-aaaaaaaa', from: 8, to: 5, by: 'layer3', reason: 'One section is affected only.', pass: 3 },
    { id: 'O-bbbbbbbb', from: 2, to: 9, by: 'handler', reason: 'Other objection.', pass: 3 },
  ];
  assert.equal(effectiveSeverity(f, changes), 5, 'only the changes naming this id count');
  const later = [...changes, { id: 'O-aaaaaaaa', from: 5, to: 3.5, by: 'handler', reason: 'Handled in the build.', pass: 4 }];
  assert.equal(effectiveSeverity(f, later), 3.5, 'the latest change wins');
  // A change that is not a valid re-tag is ignored, never applied: a seat cannot re-tag its own objection or another seat\'s.
  const forged = [{ id: 'O-aaaaaaaa', from: 8, to: 1, by: 'raiser', reason: 'I changed my mind.', pass: 2 }, { id: 'O-aaaaaaaa', from: 8, to: 'low', by: 'handler', reason: 'x', pass: 2 }, { id: 'O-aaaaaaaa', from: 8, to: 2, by: 'handler', reason: '', pass: 2 }];
  assert.equal(effectiveSeverity(f, forged), 8);
  // An objection with no readable tag has no effective severity (null), whatever the changes say about other ids.
  assert.equal(effectiveSeverity({ id: 'O-cccccccc' }, changes), null);
  assert.equal(effectiveSeverity({ id: 'O-cccccccc', severity: 'x' }, []), null);
  // A valid change on an untagged objection supplies the value (the handler or layer 3 tagged it), the original stays unreadable in the record.
  assert.equal(effectiveSeverity({ id: 'O-dddddddd' }, [{ id: 'O-dddddddd', from: null, to: 6, by: 'handler', reason: 'Tagged by the handler.', pass: 2 }]), 6);
});

test('checkRetag: only the handler or layer 3, with a reason, a readable value and the pass; the writer, a raiser and a judge of another layer cannot', () => {
  const ok = { id: 'O-aaaaaaaa', from: 8, to: 5, by: 'handler', reason: 'Settled in the build.', pass: 3 };
  assert.deepEqual(checkRetag(ok), { ok: true });
  assert.deepEqual(checkRetag({ ...ok, by: 'layer3' }), { ok: true });
  for (const bad of [
    { ...ok, by: 'raiser' }, { ...ok, by: 'writer' }, { ...ok, by: 'layer1' }, { ...ok, by: undefined },
    { ...ok, reason: '' }, { ...ok, reason: '   ' }, { ...ok, reason: undefined },
    { ...ok, to: 'low' }, { ...ok, to: 11 }, { ...ok, to: undefined },
    { ...ok, id: 'nope' }, { ...ok, id: undefined }, { ...ok, pass: 0 }, { ...ok, pass: 'x' }, null, 'x',
  ]) { const r = checkRetag(bad); assert.equal(r.ok, false, JSON.stringify(bad)); assert.ok(r.why); }
});

test('settleVerdict: a 4-6.9 or 7-10 objection is settled only by a withdrawal the raiser argued or by a fix; a tie, silence, an unreadable post and a plain keep are NOT settled', () => {
  assert.deepEqual([...SETTLE_WORDS].sort(), ['fixed', 'withdrawn']);
  for (const sev of [4, 6.9, 7, 10]) {
    assert.equal(settleVerdict(sev, 'withdrawn'), 'settled', `${sev} withdrawn`);
    assert.equal(settleVerdict(sev, 'fixed'), 'settled', `${sev} fixed`);
    for (const word of ['unresolved', 'upheld', 'not_debated', 'tie', 'silent', 'unreadable', 'kept', 'declined', undefined, null, 'settled', 'accepted'])
      assert.equal(settleVerdict(sev, word), 'open', `${sev} ${word} stays open`);
  }
  // Below 4 nothing is held at all: it is not open for sign-off, whatever its state (it goes to the closing round).
  assert.equal(settleVerdict(3.9, 'unresolved'), 'sweep');
  assert.equal(settleVerdict(3.9, 'withdrawn'), 'settled');
  assert.equal(settleVerdict(3.9, 'fixed'), 'settled');
  // No readable tag (a copy or an exchange-born objection that carries none): never read as below 4. It is held until it is settled, never swept, and never throws.
  assert.equal(settleVerdict(null, 'unresolved'), 'open'); assert.equal(settleVerdict(undefined, 'upheld'), 'open'); assert.equal(settleVerdict('high', 'not_debated'), 'open');
  assert.equal(settleVerdict(null, 'withdrawn'), 'settled'); assert.equal(settleVerdict(null, 'fixed'), 'settled');
});

test('openAtIds: the ids still holding a layer\'s climb or sign-off = every objection rated 4 or above that is not settled', () => {
  const objs = [
    { id: 'O-1', severity: 9, state: 'unresolved' }, { id: 'O-2', severity: 5, state: 'withdrawn' }, { id: 'O-3', severity: 3.9, state: 'upheld' },
    { id: 'O-4', severity: 4, state: 'upheld' }, { id: 'O-5', severity: 7, state: 'fixed' }, { id: 'O-6', severity: 6.9, state: 'not_debated' },
  ];
  assert.deepEqual(openAtIds(objs, []), ['O-1', 'O-4', 'O-6']);
  // A re-tag below 4 by layer 3 releases it from the hold (it goes to the sweep); a re-tag up holds it.
  const changes = [{ id: 'O-1', from: 9, to: 3, by: 'layer3', reason: 'Wording only.', pass: 5 }, { id: 'O-3', from: 3.9, to: 4, by: 'handler', reason: 'It breaks the build.', pass: 5 }];
  assert.deepEqual(openAtIds(objs, changes), ['O-3', 'O-4', 'O-6']);
  // An objection with no readable tag (exchange-born, or a copy that lost it) is HELD, never swept and never a throw; a withdrawal settles it like any other; a valid re-tag gives it a value.
  assert.deepEqual(openAtIds([{ id: 'O-9', state: 'upheld' }, { id: 'O-8', severity: 'x', state: 'withdrawn' }, { id: 'O-7', state: 'unresolved' }], []), ['O-9', 'O-7']);
  assert.deepEqual(openAtIds([{ id: 'O-7', state: 'unresolved' }], [{ id: 'O-7', from: null, to: 2, by: 'layer3', reason: 'Wording only.', pass: 2 }]), []);
});

test('lintSeverityChain: the switch is for a unanimous panel only (first mode would silently ignore tags), and the file carries the only copy of its words', () => {
  assert.deepEqual(lintSeverityChain({ signoff: 'unanimous', severity: { enabled: true } }), []);
  assert.deepEqual(lintSeverityChain({ signoff: 'unanimous' }), []);
  assert.deepEqual(lintSeverityChain({ signoff: 'first', severity: { enabled: false } }), []);
  const bad = lintSeverityChain({ signoff: 'first', severity: { enabled: true } });
  assert.equal(bad.length, 1); assert.equal(bad[0].kind, 'severity-needs-unanimous');
  const bad2 = lintSeverityChain({ severity: { enabled: true } });
  assert.equal(bad2[0].kind, 'severity-needs-unanimous');
});

test('mergeSeverity: two copies of one objection id keep the highest readable tag; an unreadable copy never lowers it and two unreadable copies stay unreadable', () => {
  assert.deepEqual(mergeSeverity(5, 8), { ok: true, value: 8 });
  assert.deepEqual(mergeSeverity(8, 5), { ok: true, value: 8 });
  assert.deepEqual(mergeSeverity(undefined, 3.5), { ok: true, value: 3.5 });
  assert.deepEqual(mergeSeverity('x', 6), { ok: true, value: 6 });
  assert.equal(mergeSeverity(undefined, 'high').ok, false);
});

test('endRecord: every objection rated 4 or above still open at an end, with its original tag and every change, plus the swept ones (the loud end record)', () => {
  const objs = [
    { id: 'O-1', lab: 'la', severity: 9, state: 'unresolved' }, { id: 'O-2', lab: 'lb', severity: 5, state: 'withdrawn' }, { id: 'O-3', lab: 'lc', severity: 2, state: 'upheld' },
    { id: 'O-4', lab: 'la', severity: 6, state: 'upheld' },
  ];
  const changes = [{ id: 'O-4', from: 6, to: 4.5, by: 'layer3', reason: 'Only one section.', pass: 3 }, { id: 'O-1', from: 9, to: 8, by: 'handler', reason: 'Narrower than tagged.', pass: 4 }, { id: 'O-1', from: 8, to: 7, by: 'raiser', reason: 'no', pass: 4 }];
  const rec = endRecord(objs, changes);
  assert.deepEqual(rec.lines, { settle: 4, fix: 7 });
  assert.deepEqual(rec.open_at_end.map(o => o.id), ['O-1', 'O-4']);
  assert.deepEqual(rec.open_at_end[0], { id: 'O-1', lab: 'la', original: 9, severity: 8, band: 'fix', state: 'unresolved', changes: [changes[1]] });
  assert.equal(rec.open_at_end[1].severity, 4.5); assert.equal(rec.open_at_end[1].original, 6); assert.equal(rec.open_at_end[1].band, 'settle');
  assert.deepEqual(rec.swept.map(o => o.id), ['O-3']);
  assert.deepEqual(rec.retags, [changes[0], changes[1]], 'only valid re-tags are recorded, in the order made');
  // An objection with no readable tag is in open_at_end with severity null and band 'unreadable' (the record never invents a number, and never crashes the report write).
  const none = endRecord([{ id: 'O-9', lab: 'ld', state: 'upheld' }], []);
  assert.deepEqual(none.open_at_end, [{ id: 'O-9', lab: 'ld', original: null, severity: null, band: 'unreadable', state: 'upheld', changes: [] }]);
  assert.deepEqual(endRecord([], []), { lines: { settle: 4, fix: 7 }, open_at_end: [], swept: [], retags: [] });
});


test('settleStateOf: "fixed" is what the answer-back can observe (a withdrawal whose quote is in the revised draft), "withdrawn" is the exchange\'s argued withdrawal; the literal word "fixed" from a judge settles nothing', () => {
  assert.equal(settleStateOf({ exchange: 'withdrawn' }), 'withdrawn');
  assert.equal(settleStateOf({ answer: { effect: 'withdrawn', quoted: true } }), 'fixed');
  assert.equal(settleStateOf({ answer: { effect: 'withdrawn', quoted: true, quoted_from: 'reviewer', quoted_ref: 'lb' } }), 'withdrawn', 'persuaded by another reviewer\'s evidence is not a fix');
  for (const answer of [{ effect: 'withdrawal_refused', quoted: false }, { effect: 'sustained' }, { effect: 'unreadable_answer', status: 'fixed' }, { effect: 'unanswered' }, { effect: 'unknown_id' }, { effect: 'withdrawn', quoted: false }])
    assert.equal(SETTLE_WORDS.includes(settleStateOf({ answer })), false, JSON.stringify(answer));
  assert.equal(settleStateOf({ exchange: 'unresolved' }), 'unresolved');
  assert.equal(settleStateOf({ exchange: 'upheld' }), 'upheld');
  assert.equal(settleStateOf({}), 'not_debated');
  assert.equal(settleStateOf({ exchange: 'withdrawn', answer: { effect: 'sustained' } }), 'withdrawn', 'a settle word in either source settles');
});

test('the unit-1 files carry no claim the code does not make: the header names where the build list is and does not say the run\'s handoff reads report.json', () => {
  const src = readFileSync(join(root, 'src', 'severity.js'), 'utf8');
  assert.match(src, /THE BUILD LIST does not exist/);
  assert.doesNotMatch(src, /HANDOFF\.md \(built from report\.json\)/);
});
