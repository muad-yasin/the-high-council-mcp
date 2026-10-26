// 0.8.3 M6 S2: the shape of `integration_recorded` (src/tree-transitions.js). `result` is exactly pass or fail; `gateId`, `shownSha256` and `bound` are checked when present and are NOT required by the shape - a bare event is
// well formed, and the READER (src/tree-ready.js) is what refuses to count an incomplete one (S1's bare-pass test in test/tree-ready.test.js stays as it was). Pure, plus one real record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { eventShapeError } from '../src/tree-transitions.js';
import { appendTreeEvent, readTreeRecord } from '../src/tree-record.js';
import { newTree } from './helpers/tree-fixture.js';

const line = over => ({ schema: 'tree-events/1', id: 'e9', at: '2026-10-11T12:00:00.000Z', event: 'integration_recorded', agreement: 'R@g1:A1', result: 'pass', ...over });
const SHA = 'a'.repeat(64);

test('result is exactly pass or fail: yes, Pass, PASS, ok, passed, 1, an empty string and a missing result are malformed', () => {
  assert.equal(eventShapeError(line({})), null); assert.equal(eventShapeError(line({ result: 'fail' })), null);
  for (const result of ['yes', 'Pass', 'PASS', 'ok', 'passed', '1', '', undefined, 1, true, null]) assert.match(eventShapeError(line({ result })) ?? '', /field "result" is missing or malformed/, String(result));
  assert.match(eventShapeError(line({ agreement: undefined })) ?? '', /field "agreement"/);
});

test('gateId, shownSha256 and bound are checked when present and are not required: a bare event and a complete one are both well formed', () => {
  assert.equal(eventShapeError(line({})), null, 'bare');
  assert.equal(eventShapeError(line({ gateId: 'g-1', shownSha256: SHA, bound: { kind: 'agreement', participants: [] } })), null, 'complete');
  for (const [field, value] of [['gateId', ''], ['gateId', 7], ['shownSha256', 7], ['shownSha256', ''], ['bound', 'text'], ['bound', []], ['bound', 7], ['bound', null]]) {
    assert.match(eventShapeError(line({ [field]: value })) ?? '', new RegExp(`field "${field}" is malformed`), `${field}=${JSON.stringify(value)}`);
  }
});

test('on a real record: a bare pass is appended (S1\'s pin is a reader rule, not a shape rule), a result of "yes" is refused before anything is written', () => {
  const t = newTree({ cap: 10 });
  const before = readTreeRecord(t.rootDir).events.length;
  assert.throws(() => appendTreeEvent(t.rootDir, { event: 'integration_recorded', agreement: 'R@g1:A1', result: 'yes' }), /result/);
  assert.equal(readTreeRecord(t.rootDir).events.length, before, 'nothing written');
  appendTreeEvent(t.rootDir, { event: 'integration_recorded', agreement: 'R@g1:A1', result: 'pass' });
  assert.equal(readTreeRecord(t.rootDir).events.length, before + 1);
});
