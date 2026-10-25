// Notes lane unit 2, 2a (gate note Notes_Lane_Unit2_Gate_Note.md + addendum 1; C&C PASS ON CONDITIONS 15 Okt 2026): the pure pieces: the chain key's numbers (notesConfigOf), the ONE activation predicate
// (reviewNotesActive: the key on AND every lane sentence held), the strip of the two note keys off a judge reply (splitNotes), the chain-lint rules and the chain/report schemas. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import Ajv2020 from 'ajv/dist/2020.js';
import { notesConfigOf, reviewNotesActive, splitNotes, LANE_HELD_NAMES, NOTES_ITEM_CHARS_DEFAULT, NOTES_ABOUT_CHARS_DEFAULT, NOTES_TEXT_MAX_DEFAULT, NOTES_ABOUT_MAX_DEFAULT } from '../src/review-notes-lane.js';
import { lintChain } from '../src/chain-lint.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const on = (extra = {}) => ({ signoff: 'unanimous', reviewNotes: { enabled: true, perKind: 3, ...extra } });
const allHeld = name => (LANE_HELD_NAMES.includes(name) ? () => 'x' : undefined);

test('RN-1: notesConfigOf: off by default; on only with enabled:true and a whole perKind; defaults for the rest; a bad number turns the lane OFF, never on', () => {
  assert.equal(notesConfigOf({}), null);
  assert.equal(notesConfigOf({ reviewNotes: { enabled: false, perKind: 3 } }), null);
  assert.equal(notesConfigOf({ reviewNotes: { enabled: true } }), null);
  assert.equal(notesConfigOf({ reviewNotes: { enabled: true, perKind: 0 } }), null);
  assert.equal(notesConfigOf({ reviewNotes: { enabled: true, perKind: 2.5 } }), null);
  assert.deepEqual(notesConfigOf(on()), { perKind: 3, itemChars: NOTES_ITEM_CHARS_DEFAULT, aboutChars: NOTES_ABOUT_CHARS_DEFAULT, textMax: NOTES_TEXT_MAX_DEFAULT, aboutMax: NOTES_ABOUT_MAX_DEFAULT });
  assert.equal(notesConfigOf(on({ itemChars: 250 })).itemChars, 250);
  assert.equal(notesConfigOf(on({ itemChars: -1 })), null);
  assert.deepEqual([NOTES_ITEM_CHARS_DEFAULT, NOTES_ABOUT_CHARS_DEFAULT, NOTES_TEXT_MAX_DEFAULT, NOTES_ABOUT_MAX_DEFAULT], [400, 200, 8000, 400]);
});

test('RN-2 (condition 1): the lane is active only with the key on AND EVERY lane sentence held: with only the ask held (a partial M7 re-record) it stays OFF', () => {
  assert.deepEqual([...LANE_HELD_NAMES], ['reviewNotesAsk', 'reviewNotesRevise', 'reviewNotesMemory', 'reviewNotesAnswer']);
  assert.equal(reviewNotesActive(on(), allHeld), true);
  assert.equal(reviewNotesActive({}, allHeld), false, 'no key: off even when every sentence exists');
  for (const missing of LANE_HELD_NAMES) assert.equal(reviewNotesActive(on(), name => (name === missing ? undefined : allHeld(name))), false, `without ${missing}: off`);
  assert.equal(reviewNotesActive(on(), name => (name === 'reviewNotesAsk' ? () => 'x' : undefined)), false, 'only the ask held: off');
  // A2 (18 Okt 2026), CHANGED ACCEPTED TEST: old bar = the last row: the real roles.js records none of them, so reviewNotesActive(on()) is false; new bar = the real roles.js records all four, so reviewNotesActive(on()) is true, and a chain without the key stays off; why = src/roles.js now records the four lane sentences (Muad 18 Okt, E195), so 'the real roles.js records none of them' no longer holds; a partial or missing set must be MASKED explicitly (setHeldForTest with the names set to undefined).
  assert.equal(reviewNotesActive(on()), true, 'the real roles.js records all four: on');
  assert.equal(reviewNotesActive({}), false, 'the real roles.js, no key: off');
});

test('RN-3: splitNotes takes proposals and ideas off a parsed reply, never mutates it, and leaves anything that is not a plain object to normaliseCritique', () => {
  const reply = Object.freeze({ meets: true, failures: [], proposals: [{ text: 'a' }], ideas: [{ text: 'b' }], verdict_line: 'ok' });
  const { verdictPart, notesReply } = splitNotes(reply);
  assert.deepEqual(Object.keys(verdictPart).sort(), ['failures', 'meets', 'verdict_line']);
  assert.deepEqual(notesReply, { proposals: [{ text: 'a' }], ideas: [{ text: 'b' }] });
  assert.equal('proposals' in reply, true, 'the input is untouched');
  assert.equal(splitNotes({ meets: true }).notesReply, null);
  assert.deepEqual(splitNotes({ meets: true, proposals: 'junk' }).notesReply, { proposals: 'junk' }, 'a wrong type is kept for readNotes to drop and count, not silently lost');
  for (const odd of [null, undefined, 'text', 4, ['x']]) assert.deepEqual(splitNotes(odd), { verdictPart: odd, notesReply: null });
});

test('RN-4: chain-lint: reviewNotes needs signoff unanimous, a whole perKind, and a written limit not above the read cap (itemChars <= textMax, aboutChars <= aboutMax)', () => {
  const kinds = cfg => lintChain({ seats: { criteria: { provider: 'mock', model: 'mock-criteria' }, builder: { provider: 'mock', model: 'mock-builder' }, critics: [{ provider: 'mock', model: 'mock-critic-a', lab: 'a' }] }, ...cfg }, 'x.json').map(f => f.kind);
  assert.deepEqual(kinds(on()).filter(k => k.startsWith('review-notes')), []);
  assert.ok(kinds({ reviewNotes: { enabled: true, perKind: 3 } }).includes('review-notes-needs-unanimous'));
  assert.ok(kinds(on({ perKind: 0 })).includes('review-notes-per-kind'));
  assert.ok(kinds(on({ itemChars: 9000 })).includes('review-notes-limit-above-cap'), 'itemChars above the default textMax');
  assert.ok(kinds(on({ aboutChars: 500 })).includes('review-notes-limit-above-cap'), 'aboutChars above the default aboutMax');
  assert.equal(kinds(on({ itemChars: 9000, textMax: 12000 })).includes('review-notes-limit-above-cap'), false, 'raising the read cap is the other way out');
});

test('RN-5: the chain schema accepts a valid reviewNotes block and refuses an unknown key, a zero perKind and a string number', () => {
  const schema = JSON.parse(readFileSync(join(root, 'config', 'chain-schema.json'), 'utf8'));
  const validate = new Ajv({ allErrors: true }).compile(schema);
  const base = { seats: { critics: [{ provider: 'mock', model: 'mock-x' }] }, signoff: 'unanimous' };
  assert.equal(validate({ ...base, reviewNotes: { enabled: true, perKind: 3, itemChars: 400, aboutChars: 200, textMax: 8000, aboutMax: 400 } }), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...base, reviewNotes: { enabled: true, perKind: 3, bogus: 1 } }), false);
  assert.equal(validate({ ...base, reviewNotes: { enabled: true, perKind: 0 } }), false);
  assert.equal(validate({ ...base, reviewNotes: { enabled: true, perKind: '3' } }), false);
  assert.equal(validate({ ...base, reviewNotes: { perKind: 3 } }), false, 'enabled is required');
});

test('RN-6: the report schema describes review_notes (items with raised_by, cut, dropped with lab/pass/why, long) and refuses an item without an id in the N- form', () => {
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'report-v1.json'), 'utf8'));
  const sub = schema.properties.review_notes;
  assert.ok(sub, 'report-v1 has a review_notes property');
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile({ ...sub, $schema: undefined });
  const good = { enabled: true, per_kind: 3, item_chars: 400, about_chars: 200, items: [{ id: 'N-0123abcd', kind: 'idea', lab: 'a', layer: 1, overseer_round: 1, pass: 1, text: 't', about: 'x', raised_by: ['a'] }], cut: [{ lab: 'a', overseer_round: 1, pass: 1, kind: 'idea', count: 1 }], dropped: [{ lab: 'a', pass: 1, why: 'verdict_not_recorded' }], long: 0 };
  assert.equal(validate(good), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...good, items: [{ ...good.items[0], id: 'N-xyz' }] }), false);
  assert.equal(validate({ ...good, dropped: [{ lab: 'a', pass: 1 }] }), false, 'a dropped row names its reason');
});
