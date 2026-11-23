// 0.8.4 S2: every reader in src/ that matches the shape of an objection id accepts the suffix of a repeated or reopened objection (#2, #r2). The readers found by grep: src/severity.js (checkRetag, applyRetags), src/handler-retags.js (addHandlerRetag; M1 S19 (c) replaced the gate reader src/gate.js requestRetag and src/rulings.js parseRetagGateText). Offline, $0. A suffixed id is the id of a real objection once the relation wording is recorded; a re-tag of it must not be refused as "names no objection id".
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Sev from '../src/severity.js';

const IDS = ['O-4b7ee5be', 'O-4b7ee5be#2', 'O-4b7ee5be#r2'];
const gateFolder = () => { const d = join(mkdtempSync(join(tmpdir(), 'ids-rtg-')), 'run-1'); mkdirSync(d); return d; };

test('checkRetag: a re-tag may name an old id and a suffixed id; a malformed suffix is refused', () => {
  const change = id => Sev.checkRetag({ id, by: 'layer3', from: 6, to: 3, reason: 'It does not change what is built.', pass: 2 });
  assert.deepEqual(IDS.map(id => change(id).ok), [true, true, true]);
  assert.deepEqual(['O-4b7ee5be#', 'O-4b7ee5be#x', 'O-4b7ee5be#2x'].map(id => change(id).ok), [false, false, false]);
});
test('applyRetags: layer 3 re-tagging a suffixed id is not refused as "no objection id"', () => {
  const run = Sev.createSeverityRun();
  const out = run.applyRetags(2, [{ seat: 'top', retags: [{ id: 'O-4b7ee5be#2', severity: 3, reason: 'It does not change what is built.' }] }], new Map());
  assert.deepEqual(out.refused.map(r => r.why).filter(w => w === 'no_objection_id'), []);
});
// CHANGED ACCEPTED (0.8.4 S19 (c)). OLD: 'requestRetag: a handler re-tag of a suffixed id is asked for (not refused as invalid)' and 'parseRetagGateText: ... round-trips' (the gate text reader). NEW: 'addHandlerRetag' accepts a suffixed id and handlerRetagsOf reads it back (the file name of the old gate carried the '#'; the new record is a line of JSON, so the id is plain data). WHY: the re-tag gate is removed; the id readers are the same shape check (src/handler-retags.js ID). RED BEFORE (c): src/handler-retags.js does not exist on the tree before (c), so the import fails.
test('addHandlerRetag: a handler re-tag of a suffixed id is recorded (not refused as invalid) and listed back', async () => {
  const HR = await import('../src/handler-retags.js');
  const d = gateFolder(); const now = () => Date.parse('2026-11-01T12:00:00.000Z');
  for (const id of IDS) assert.equal(HR.addHandlerRetag(d, { pass: 3, id, severity: 2, reason: 'It does not change what is built.' }, { now }).ok, true, id);
  assert.deepEqual(HR.handlerRetagsOf(d).retags.map(r => r.id), IDS);
  assert.equal(HR.addHandlerRetag(d, { pass: 3, id: 'O-4b7ee5be#', severity: 2, reason: 'x' }, { now }).code, 'retag_invalid', 'a malformed suffix is refused');
});
