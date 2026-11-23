// 0.8.4 S18 (Q3 (a); WORDING S18-w16, w16b): the real verb `council retag-add` meets the second application point: a LATE FINDING's id (L-...) is accepted only while the run waits at its build check (the pause is `pending` for build-check-<n>), and its re-tag belongs to the pass of that check (the highest pass with a stage on disk); an objection id (O-...) at that pause stays refused
// ("give that first"); an L- id at a revise pause is refused. `retagAddCommand` is called in process against a fake run folder (run.json and stage files), with a fake chain reader. Offline, $0. Written without a run (no tests on the laptop). The red is the parent commit (the id is refused as invalid there).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retagAddCommand } from '../src/gate-relay-cli.js';
import { handlerRetagsOf } from '../src/handler-retags.js';

const chainOf = () => ({ signoff: 'unanimous', seats: { critics: [{ layer: 1 }, { layer: 2 }, { layer: 3 }] } });
const folder = files => { const dir = mkdtempSync(join(tmpdir(), 's18-rta-')); writeFileSync(join(dir, 'run.json'), '{}'); for (const f of files) writeFileSync(join(dir, f), 'x'); return dir; };
const call = (dir, objection) => {
  let out = ''; let err = '';
  const code = retagAddCommand([dir], { work: '/', objection, severity: '3', reason: 'It does not change what is built.', chainOf, readRunMeta: () => ({}), stdout: { write: s => { out += s; } }, stderr: { write: s => { err += s; } } });
  return { code, out, err };
};
const AT_CHECK = ['panel-1-la.md', 'panel-2-la.md', 'panel-3-lc.md', 'NEEDS-build-check-1.md'];
const LATE = 'L-0a1b2c3d';

test('retag-add: a late finding at a build check pause is recorded for the pass of the check (the highest pass with a stage), and the resume reads the line as valid', () => {
  const dir = folder(AT_CHECK);
  const r = call(dir, LATE);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /re-tag of L-0a1b2c3d to 3 is recorded for pass 3\. The run applies it at its build check when it goes on .*the check you are answering is unchanged/);
  const have = handlerRetagsOf(dir);
  assert.deepEqual([have.ok, have.unreadable.length, have.retags.map(x => [x.pass, x.id, x.severity])], [true, 0, [[3, LATE, 3]]], 'the line is valid on resume (cli.js reads it with handlerRetagsOf) and names pass 3');
});

test('retag-add: an objection id at a build check pause stays refused ("give that first"), and a late finding anywhere else is refused with its own sentence', () => {
  const dirA = folder(AT_CHECK);
  const a = call(dirA, 'O-4b7ee5be');
  assert.equal(a.code, 2);
  assert.match(a.err, /the run waits for an answer to build-check-1; give that first\. Nothing was written\./);
  assert.equal(existsSync(join(dirA, 'retags.jsonl')), false);
  const dirB = folder(['panel-1-la.md', 'NEEDS-revise-1.md', 'revise-1.md']);
  const b = call(dirB, LATE);
  assert.equal(b.code, 2);
  assert.match(b.err, /a late finding \(L-\.\.\.\) is re-tagged while the run waits at its build check; this run is not at one\. Nothing was written\./);
  assert.equal(existsSync(join(dirB, 'retags.jsonl')), false);
});
