// The sitting writes the tree's two files (0.8.3 M6, a must-fix found 12 Oct while writing the ROADMAP 57 contract): `afterStep` in src/tree-run.js records readiness and opens stops, and src/tree-handoff.js and
// src/tree-report.js both say the sitting is to call their writers after a step is committed - but nothing did, so a real tree never had TREE_HANDOFF.md or tree/report.json on disk (S4 was accepted on tests that call the
// writers directly). Now `afterStep` calls both once the record has moved. A writer that THROWS must neither kill the sitting nor vanish: the sitting's result carries `fileProblems` and the end text says so.
// Everything is mock and $0; every working folder is removed at the end of the file (test/helpers/temp-trees.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { gatherHandoffFacts, renderTreeHandoff } from '../src/tree-handoff.js';
import { buildTreeReport, renderTreeReport } from '../src/tree-report.js';
import { readTreeRecord } from '../src/tree-record.js';
import { sittingLines } from '../src/tree-resume.js';
import { runTree } from '../src/tree-run.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, draftStarter } from './helpers/sitting.js';

const HANDOFF = rootDir => join(rootDir, 'tree', 'TREE_HANDOFF.md');
const REPORT = rootDir => join(rootDir, 'tree', 'report.json');
/** What the builders make of the record as it stands now. */
const built = (rootDir, work) => ({ handoff: renderTreeHandoff(gatherHandoffFacts(rootDir, { work })), report: renderTreeReport(buildTreeReport(rootDir, { work })) });

test('WF-1 after a real mock sitting - the children run, the verdict is recorded - BOTH files exist and are exactly what the builders make of the record (TREE_HANDOFF.md and tree/report.json); an idle sitting writes them too', async () => {
  const r = await trackedRealRoot(pricedChildren());
  const { rootDir, work } = r.t;
  assert.equal(existsSync(HANDOFF(rootDir)), false); assert.equal(existsSync(REPORT(rootDir)), false);
  const idle = await runTree(rootDir, { work, startRun: () => { throw new Error('must not start'); } });
  assert.equal(idle.status, 'nothing_to_do');
  assert.ok(existsSync(HANDOFF(rootDir)) && existsSync(REPORT(rootDir)), 'an idle sitting writes both');
  approvePending(r);
  const out = await runTree(rootDir, { work, startRun: draftStarter(r) });
  assert.equal(out.status, 'nothing_to_do', JSON.stringify(out)); assert.ok(out.started.length >= 1, 'children ran');
  const b = built(rootDir, work);
  assert.equal(readFileSync(HANDOFF(rootDir), 'utf8'), b.handoff, 'TREE_HANDOFF.md is the builder\'s text for the final record');
  assert.equal(readFileSync(REPORT(rootDir), 'utf8'), b.report, 'tree/report.json is the builder\'s text for the final record');
  assert.match(readFileSync(HANDOFF(rootDir), 'utf8'), /R\/M1/, 'it names the nodes that ran');
  assert.deepEqual(out.fileProblems ?? [], [], 'nothing went wrong');
  assert.deepEqual(readdirSync(join(rootDir, 'tree')).filter(f => /\.tmp-/.test(f)), [], 'no temp file is left behind');
});

test('WF-2 a writer that THROWS neither kills the sitting nor vanishes: the sitting finishes as it would, `fileProblems` names the file and the reason, the end text says so, the other file is still written, and the record gets no new line for it', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const { rootDir, work } = r.t;
  // an injected writer (the seam) that fails for the handoff only
  const out = await runTree(rootDir, { work, startRun: draftStarter(r), hooks: { writeFiles: () => [{ file: 'TREE_HANDOFF.md', error: 'disk full (injected)' }] } });
  assert.equal(out.status, 'nothing_to_do', 'the sitting went on and ended as it does without the failure');
  assert.deepEqual(out.fileProblems, [{ file: 'TREE_HANDOFF.md', error: 'disk full (injected)' }]);
  const text = sittingLines(out, 'ROOT').join('\n');
  assert.match(text, /TREE_HANDOFF\.md could not be written \(disk full \(injected\)\)/); assert.match(text, /The sitting went on/);
  // a REAL failure, no seam: the writer refuses a symbolic link in place of the handoff file; the report is still written, the problem is named
  const r2 = await trackedRealRoot(pricedChildren()); approvePending(r2);
  const t2 = r2.t;
  symlinkSync(join(t2.work, 'elsewhere.md'), HANDOFF(t2.rootDir));
  const eventsBefore = readTreeRecord(t2.rootDir).events.length;
  const out2 = await runTree(t2.rootDir, { work: t2.work, startRun: draftStarter(r2) });
  // the sitting returns its result (it did not throw). Its STATUS is not asserted here: a symbolic link anywhere in the root's run folder is refused by the run-folder guard (src/run-files.js) before the root can be expanded - a separate, older guard than the one this test is about
  assert.equal(typeof out2.status, 'string', JSON.stringify(out2));
  assert.equal(out2.fileProblems.length, 1); assert.equal(out2.fileProblems[0].file, 'TREE_HANDOFF.md'); assert.match(out2.fileProblems[0].error, /symbolic link/);
  assert.equal(readFileSync(REPORT(t2.rootDir), 'utf8'), built(t2.rootDir, t2.work).report, 'one writer failing does not skip the other');
  const events = readTreeRecord(t2.rootDir).events;
  assert.ok(events.length > eventsBefore); // the older run-folder guard (above) records its own `parent_changed` block; the failed file write adds NO record line of its own
  assert.ok(events.filter(e => e.event === 'blocked').every(e => e.reason === 'parent_changed'), `a failed file write is not a record: ${JSON.stringify(events.filter(e => e.event === 'blocked').map(e => e.reason))}`);
  unlinkSync(HANDOFF(t2.rootDir));
});

test('WF-3 the hook is called with the tree and the working folder after the record has moved, and a failure of the hook itself (it throws) is a file problem too, never a crash', async () => {
  const r = await trackedRealRoot(pricedChildren()); approvePending(r);
  const calls = [];
  const out = await runTree(r.t.rootDir, { work: r.t.work, startRun: draftStarter(r), hooks: { writeFiles: (rootDir, o) => { calls.push([rootDir, o.work]); return []; } } });
  assert.equal(out.status, 'nothing_to_do'); assert.ok(calls.length >= 2, `called after steps: ${calls.length}`); assert.ok(calls.every(c => c[0] === r.t.rootDir && c[1] === r.t.work));
  const r2 = await trackedRealRoot(pricedChildren()); approvePending(r2);
  const out2 = await runTree(r2.t.rootDir, { work: r2.t.work, startRun: draftStarter(r2), hooks: { writeFiles: () => { throw new Error('boom'); } } });
  assert.equal(out2.status, 'nothing_to_do'); assert.ok(out2.fileProblems.some(p => /boom/.test(p.error)), JSON.stringify(out2.fileProblems));
});

test('WF-4 a mechanical guard for the bug that shipped: every writer a tree-*.js header says a caller invokes has a production caller (the S4 writers were called by tests only)', () => {
  const dir = join(import.meta.dirname, '..', 'src');
  const stripped = f => readFileSync(join(dir, f), 'utf8').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const files = readdirSync(dir).filter(f => f.endsWith('.js'));
  for (const [name, own] of [['writeTreeHandoff', 'tree-handoff.js'], ['writeTreeReport', 'tree-report.js']]) {
    const callers = files.filter(f => f !== own && new RegExp(`\\b${name}\\b`).test(stripped(f)));
    assert.ok(callers.length >= 1, `${name} has no caller in src/ outside ${own}`);
  }
});
