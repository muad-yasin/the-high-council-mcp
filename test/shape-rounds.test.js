// test/shape-rounds.test.js
//
// v5 §1 candidate 1: which critique rounds were spent entirely on document
// shape. A round with only format-class failures is shape_only; a round
// with any substance failure, or zero failures, is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyFailure, shapeRounds } from '../src/shape-rounds.js';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'thc-shape-'));
  const write = (name, body) => writeFileSync(join(dir, name), typeof body === 'string' ? body : JSON.stringify(body));
  return { dir, write };
}

test('classifyFailure: format-class vs substance-class', () => {
  assert.equal(classifyFailure({ criterion: 'Section headings match the required order.', problem: 'Heading numbering is off.' }), 'format');
  assert.equal(classifyFailure({ criterion: 'The plan prices the migration correctly.', problem: 'The cost estimate omits the backfill step entirely.' }), 'substance');
});

test('test_shape_round_flagging: a mock run with one all-format round and one mixed round', () => {
  const { dir, write } = fixture();

  // Round 1: a two-lab panel, both failures are format-class -> shape_only.
  write('panel-1-glm.md', { meets: false, failures: [
    { criterion: 'Markdown structure is consistent.', problem: 'Bullet list style changes mid-section.' },
  ] });
  write('panel-1-kimi.md', { meets: false, failures: [
    { criterion: 'Heading capitalization is consistent.', problem: 'Title case is inconsistent across headings.' },
  ] });

  // Round 2: one format failure and one substance failure -> not shape_only.
  write('panel-2-glm.md', { meets: false, failures: [
    { criterion: 'Section order matches the template.', problem: 'Formatting of the numbered list is wrong.' },
  ] });
  write('panel-2-kimi.md', { meets: false, failures: [
    { criterion: 'The refund SLA is stated correctly.', problem: 'The plan omits the 14-day refund window entirely.' },
  ] });

  // Round 3: a clean pass, zero failures -> not counted at all.
  write('panel-3-glm.md', { meets: true, failures: [] });

  // Non-round stage files must be ignored.
  write('criteria.md', 'not JSON, and not a round file');
  write('build.md', { meets: false, failures: [{ criterion: 'x', problem: 'y' }] });

  const r = shapeRounds(dir);
  assert.equal(r.shapeOnlyRounds, 1);
  assert.deepEqual(r.rounds.map(x => [x.round, x.shapeOnly, x.failureCount]), [
    [1, true, 2],
    [2, false, 2],
    [3, false, 0],
  ]);
});

test('shapeRounds on a missing directory returns zero, not an error', () => {
  const r = shapeRounds('/no/such/directory/anywhere');
  assert.deepEqual(r, { rounds: [], shapeOnlyRounds: 0 });
});
