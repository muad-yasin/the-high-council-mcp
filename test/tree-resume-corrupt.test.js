// CR-RC-002 (fix-up ON TOP of 9dc0a208): `tree resume` runs the record-only phase before its corrupt-record check, so the phase must write nothing to a record that does not read. A corrupt record whose skipped line is the root's
// split_verified made the phase verify the split again and append to the corrupt file (a `blocked record_corrupt` line, then an uncaught TreeRefusal) instead of the corrupt-record message. Real tree, real verb, all-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { resumeHandler } from '../src/tree-resume.js';
import { EVENTS_FILE, readTreeRecord, treeDirOf } from '../src/tree-record.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

test('CR-RC-002: a corrupt record (the root\'s split_verified line damaged, a whole line) -> `tree resume` prints the corrupt-record message, starts nothing, exits 1, and events.jsonl is byte-identical before and after', { timeout: 400_000 }, async () => {
  const r = await trackedRealRoot(pricedChildren());
  const file = join(treeDirOf(r.t.rootDir), EVENTS_FILE);
  const lines = readFileSync(file, 'utf8').split('\n');
  const at = lines.findIndex(l => { try { const e = JSON.parse(l); return e.event === 'split_verified' && e.node === 'R'; } catch { return false; } });
  assert.ok(at >= 0, 'the root\'s split_verified is in the record');
  assert.equal(lines.at(-1), '', 'every line ends with a newline, so the damaged line is a whole line, not a torn tail');
  lines[at] = 'this is not json';
  writeFileSync(file, lines.join('\n'));
  assert.ok(readTreeRecord(r.t.rootDir).corrupt.length >= 1, 'the record does not read');
  const before = readFileSync(file);
  const out = new PassThrough(); const err = new PassThrough(); const buf = []; out.on('data', d => buf.push(String(d))); err.on('data', d => buf.push(String(d)));
  let calls = 0;
  const code = await resumeHandler({ rootDir: r.t.rootDir, rootId: ROOT_ID, work: r.t.work, stdout: out, stderr: err, deps: { startRun: async () => { calls += 1; return { exitCode: 0 }; } } }).catch(e => e);
  const text = buf.join('');
  assert.ok(readFileSync(file).equals(before), `the record-only phase wrote nothing to the corrupt record (${code instanceof Error ? `rejected: ${code.message}` : `exit ${code}`})`);
  assert.equal(code, 1, text);
  assert.match(text, /council tree resume: the tree record is corrupt \(.+\)\. Nothing was started\./, text);
  assert.equal(calls, 0, 'nothing was started');
});
