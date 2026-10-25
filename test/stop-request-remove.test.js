// removeStopRequestBy (src/stop-files.js, 13 Oct 2026, the late-window cancel): the send path removes the STOP its own abort listener wrote when the start fails and the quote becomes reusable,
// and ONLY that one: a person's `council stop` (by user) or a request naming another run stays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeStopRequest, removeStopRequestBy, readStopRequest } from '../src/stop-files.js';

test('removeStopRequestBy removes the client_cancel request for this run and nothing else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'thc-stoprm-'));
  assert.equal(removeStopRequestBy(dir, { by: 'client_cancel', run: 'r1' }), false, 'no file: nothing to remove');
  writeStopRequest(dir, { by: 'client_cancel', run: 'r1' });
  assert.equal(removeStopRequestBy(dir, { by: 'client_cancel', run: 'other' }), false, 'a request naming another run stays');
  assert.ok(existsSync(join(dir, 'STOP')));
  assert.equal(removeStopRequestBy(dir, { by: 'client_cancel', run: 'r1' }), true);
  assert.equal(existsSync(join(dir, 'STOP')), false);
  writeStopRequest(dir, { by: 'user', run: 'r1' });
  assert.equal(removeStopRequestBy(dir, { by: 'client_cancel', run: 'r1' }), false, 'a person\'s stop stays');
  assert.deepEqual(readStopRequest(dir, 'r1'), { by: 'user' });
});
