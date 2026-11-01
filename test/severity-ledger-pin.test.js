// B3 prep, JUDGE lane, unit 4a fix-up: the objection ledger the top layer reads is BYTE-IDENTICAL without the severity switch. The digests (sha256, first 16 hex) were taken from src/roles.js as it was BEFORE unit 4a (bd2443d8) on the sample rows in
// test/helpers/ledger-samples.js; with the switch on (severityShown) the text must differ. A switch-off claim that rests on reading is no evidence (C&C).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import * as R from '../src/roles.js';
import { samples } from './helpers/ledger-samples.js';

const BEFORE_4A = {
  "open_plain": "2ad886f977e3bcc1",
  "open_declined_withdrawn": "583424796d48e867",
  "exchange_withdrawal_and_quote": "7affb5cad6eb5950",
  "observed_and_stated_pass": "0819dd84c66dfb52",
  "compact_and_left_out": "0bf34be54e742443"
};
const digest = text => createHash('sha256').update(text).digest('hex').slice(0, 16);

test('switch off: every sample ledger renders byte-for-byte as before unit 4a (severityShown absent or false)', () => {
  assert.deepEqual(Object.keys(samples).sort(), Object.keys(BEFORE_4A).sort());
  for (const [name, input] of Object.entries(samples)) {
    assert.equal(digest(R.overseerLedgerSection(input)), BEFORE_4A[name], name);
    assert.equal(digest(R.overseerLedgerSection({ ...input, severityShown: false })), BEFORE_4A[name], `${name} (severityShown: false)`);
  }
});

test('switch on: the same rows render differently (an open entry carries its severity, and only an open one)', () => {
  const withSeverity = { rows: samples.open_plain.rows.map(r => ({ ...r, severity: 6.5 })), severityShown: true };
  const text = R.overseerLedgerSection(withSeverity);
  assert.notEqual(digest(text), BEFORE_4A.open_plain);
  assert.match(text, /open\. Severity: 6\.5\. Criterion:/);
  const closed = R.overseerLedgerSection({ rows: samples.open_declined_withdrawn.rows.map(r => ({ ...r, severity: 6.5 })), severityShown: true });
  assert.equal(digest(closed), BEFORE_4A.open_declined_withdrawn, 'a closed entry shows no severity, so it is unchanged');
});
