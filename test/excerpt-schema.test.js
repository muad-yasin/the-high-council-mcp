// 0.8.4 D9 (plan A T5.6 and T5.3): the excerpt line as a published format. schemas/excerpts-v1.json is one line of excerpts.jsonl (like schemas/spend-reservations-v1.json for its record); schemas/report-v1.json holds the report's additive `excerpts` entry. A seat_read (reserved
// for a later seat that reads the project itself) has exactly the fields of a seat_request, so a later release adds nothing but a source. Offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { PERSON_CHANNELS, SESSION_CHANNEL } from '../src/gate.js';
import * as XR from '../src/excerpt-record.js';   // PERSONAL_DATA_RESULTS is read through the namespace so the file LOADS on a tree without it and the pin below fails by assertion
import { buildExcerptEntry, excerptProblems, EXCERPT_SCHEMA, REQUEST_KINDS, SOURCE_KINDS, SCAN_RESULTS, APPROVAL_STATUSES, ADVISOR_VALUES, APPROVAL_CHANNELS } from '../src/excerpt-record.js';

const schema = JSON.parse(readFileSync(new URL('../schemas/report-v1.json', import.meta.url), 'utf8'));
const recordSchema = JSON.parse(readFileSync(new URL('../schemas/excerpts-v1.json', import.meta.url), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
ajv.addKeyword({ keyword: 'x-stability', schemaType: 'string' });
const validateRecord = ajv.compile(recordSchema);
const validateEntry = ajv.compile({ ...schema.properties.excerpts, $schema: 'https://json-schema.org/draft/2020-12/schema' });
const AT = '2026-11-04T05:00:00.000Z';
const base = over => ({
  request_kind: 'seat_request', requested_by: 'lab-a', objection_id: 'O-1a2b3c4d', origin: 'panel-1-lab-a', why: 'To judge the retry claim.', source_kind: 'repository_file', path: 'src/a.js', lines: '3-5', text: 'three\nfour\nfive',
  file_sha256: 'a'.repeat(64), edited: false, pasted_by: 'claude-code-session', advisor: 'consulted', advisor_said: null, answered_stage: 'revise-1',
  scans: { key_shape: 'clear', personal_data: 'hit' }, approval: { status: 'approved', actor: 'alice', channel: 'cli', at: AT, reason: null }, ...over,
});
const declined = (status, over = {}) => base({ text: null, file_sha256: null, answered_stage: status === 'unanswered' ? null : 'revise-1', scans: null, approval: { status, actor: status === 'unanswered' ? null : 'claude-code', channel: status === 'unanswered' ? null : 'elicitation', at: AT, reason: 'Not needed.' }, ...over });

test('schema: a refusal without a reason (null) validates, an empty-string reason does not (absence is null), and unanswered and withheld keep needing one in the module', () => {
  const noReason = buildExcerptEntry(1, declined('refused', { approval: { status: 'refused', actor: 'alice', channel: 'cli', at: AT, reason: null } }));
  assert.ok(validateRecord(noReason), JSON.stringify(validateRecord.errors));
  assert.equal(validateRecord({ ...noReason, approval: { ...noReason.approval, reason: '' } }), false, 'an empty string is not "none"');
});

test('every kind of line the module writes validates against schemas/excerpts-v1.json: an excerpt, a session_read, and a refused, unanswered and withheld request', () => {
  const lines = [
    buildExcerptEntry(1, base()),
    buildExcerptEntry(2, base({ request_kind: 'session_read', requested_by: null, origin: null, objection_id: null, answered_stage: 'revise-1' })),
    buildExcerptEntry(3, base({ source_kind: 'task_file', lines: null, file_sha256: null, edited: true, approval: { status: 'edited', actor: 'claude-code', channel: 'elicitation', at: AT, reason: 'Removed a name.' } })),
    buildExcerptEntry(4, declined('refused')), buildExcerptEntry(5, declined('unanswered')), buildExcerptEntry(6, declined('withheld')),
    buildExcerptEntry(9, base({ text: '', lines: null })),
    buildExcerptEntry(10, base({ text: '\n', lines: null })),
    buildExcerptEntry(7, base({ text: null, file_sha256: null, scans: null, answered_stage: 'revise-1', approval: { status: 'not_cut', actor: null, channel: null, at: AT, reason: 'The text could not be cut: there is no such file.' } })),
    buildExcerptEntry(8, base({ request_kind: 'session_read', requested_by: null, origin: null, objection_id: null, text: null, file_sha256: null, scans: null, answered_stage: 'revise-1', approval: { status: 'not_cut', actor: null, channel: null, at: AT, reason: 'The text could not be cut: it is outside the project folder.' } })),
  ];
  for (const e of lines) assert.ok(validateRecord(e), `${e.id}: ${JSON.stringify(validateRecord.errors)}`);
});

test('the schema refuses what the table does not have: an unknown status, an unknown channel, an extra field, a missing field, a bad id', () => {
  const ok = buildExcerptEntry(1, base());
  const mutate = f => { const c = JSON.parse(JSON.stringify(ok)); f(c); return c; };
  assert.equal(validateRecord(mutate(c => { c.approval.status = 'maybe'; })), false);
  assert.equal(validateRecord(mutate(c => { c.approval.channel = 'dialog'; })), false);
  assert.equal(validateRecord(mutate(c => { c.surprise = 1; })), false);
  assert.equal(validateRecord(mutate(c => { delete c.why; })), false);
  assert.equal(validateRecord(mutate(c => { c.id = 'X-1'; })), false);
  assert.equal(validateRecord(mutate(c => { c.schema = 'excerpts/2'; })), false);
  assert.equal(validateRecord(mutate(c => { c.scans.key_shape = 'maybe'; })), false);
});

test('T5.6: a seat_read entry with pasted_by set to a seat key is valid against the same field set as a seat_request entry', () => {
  const asRequest = buildExcerptEntry(1, base());
  const asRead = buildExcerptEntry(1, base({ request_kind: 'seat_read', pasted_by: 'lab-a' }));
  assert.deepEqual(Object.keys(asRead), Object.keys(asRequest), 'a seat_read needs no field the others lack, and has none fewer');
  assert.ok(validateRecord(asRead), JSON.stringify(validateRecord.errors));
  assert.deepEqual(excerptProblems(asRead), []);
  // passes only with a shared field: drop one from each and both fail
  for (const field of ['why', 'path', 'text_sha256']) {
    for (const e of [asRequest, asRead]) { const c = { ...e }; delete c[field]; assert.notDeepEqual(excerptProblems(c), [], `${e.request_kind} without ${field}`); assert.equal(validateRecord(c), false, `${e.request_kind} without ${field}`); }
  }
  assert.throws(() => buildExcerptEntry(1, base({ request_kind: 'seat_read', requested_by: null })), /is not valid/, 'a seat read has its asking seat, like a seat request');
});

test('the report\'s additive `excerpts` entry: { count, file_sha256 }, marked experimental and described; nothing else validates', () => {
  assert.equal(schema.properties.excerpts['x-stability'], 'experimental');
  assert.ok(schema.properties.excerpts.description.length > 20);
  assert.ok(validateEntry({ count: 3, file_sha256: 'b'.repeat(64) }), JSON.stringify(validateEntry.errors));
  assert.equal(validateEntry({ count: -1, file_sha256: 'b'.repeat(64) }), false);
  assert.equal(validateEntry({ count: 1, file_sha256: 'XYZ' }), false);
  assert.equal(validateEntry({ count: 1 }), false);
});

test('the schema and the module cannot drift: each enum equals the module\'s own list, the channel enum is the gate\'s channels, and `required` is the keys of a built entry', () => {
  const p = recordSchema.properties;
  assert.deepEqual(p.request_kind.enum, REQUEST_KINDS);
  assert.deepEqual(p.source_kind.enum, SOURCE_KINDS);
  assert.deepEqual(p.scans.properties.key_shape.enum, SCAN_RESULTS);
  // CHANGED ACCEPTED (0.8.4 unit 1, C&C ruling 09 Nov 2026). OLD: personal_data's enum equalled SCAN_RESULTS. NEW: it equals PERSONAL_DATA_RESULTS (SCAN_RESULTS plus not_scanned); key_shape's enum is unchanged. WHY: no personal-data check runs during a run (his 08 Nov answer), so the entry must be able to say so rather than record a pass.
  assert.deepEqual(p.scans.properties.personal_data.enum, XR.PERSONAL_DATA_RESULTS);
  assert.deepEqual(p.approval.properties.status.enum, APPROVAL_STATUSES);
  assert.deepEqual(p.advisor.enum, [...ADVISOR_VALUES, null]);
  assert.deepEqual(p.approval.properties.channel.enum, [...PERSON_CHANNELS, SESSION_CHANNEL, null]);
  assert.deepEqual(APPROVAL_CHANNELS, [...PERSON_CHANNELS, SESSION_CHANNEL], 'the module\'s copy of the gate\'s channels is the gate\'s');
  const built = buildExcerptEntry(1, base());
  assert.deepEqual(recordSchema.required, Object.keys(built));
  assert.equal(recordSchema.properties.schema.const, EXCERPT_SCHEMA);
  assert.deepEqual(Object.keys(p).filter(k => k !== 'supersedes'), Object.keys(built));   // CHANGED ACCEPTED (PR #2 fix unit, A1): OLD: every schema property is a key of a built row. NEW: `supersedes` is optional, written only on the copy of a row that was held at the switch (src/excerpt-resume.js), so the built row of an ordinary read does not carry it
  assert.deepEqual(recordSchema.properties.approval.required, Object.keys(built.approval));
});

test('personal_data may be not_scanned and key_shape may not: the schema takes the entry the module writes, and refuses the same word on key_shape', () => {
  const e = buildExcerptEntry(1, base({ scans: { key_shape: 'clear', personal_data: 'not_scanned' } }));
  assert.ok(validateRecord(e), JSON.stringify(validateRecord.errors));
  assert.equal(validateRecord({ ...e, scans: { key_shape: 'not_scanned', personal_data: 'clear' } }), false);
  assert.ok(XR.PERSONAL_DATA_RESULTS?.includes('not_scanned') && !SCAN_RESULTS.includes('not_scanned'));
});
