// Bug audit 2026-10-24 D-013 / C-024 (member half): a tree MEMBER applies only the roundChoices its TREE RECORD backs. run.json is project-writable text; chain.js effectiveLimits adds every `continue` entry by its kind (not by its stop id) and finishes at any stop an entry names, so an extra entry used to raise a
// member's overseer limit or end it at a stop nobody chose. Same fixture style as test/tree-member-conflict-verb.test.js CV4 (the conflict choices have the same rule). Synthetic nodes, offline, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTreeEvent } from '../src/tree-record.js';
import { backedRoundChoices } from '../src/backed-round-choices.js';
import { track } from './helpers/temp-trees.js';
import { IDS, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, syntheticRun } from './helpers/tree-fixture.js';

const dead = { pidAlive: () => false };
const LINEAGE = { node: 'R/M1', generation: 1 };

/** R/M1 started (its claim's process is gone): a node the tree can record choices for. */
function startedMember() {
  const t = closedRootTree({ cap: 100 }); track(t.work);
  const key = approveFrontier(t.rootDir, ['R/M1', 'R/M2']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  syntheticRun(t, IDS[0], {});
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  return t;
}
const give = (t, choice, stop) => appendTreeEvent(t.rootDir, { event: 'node_choice', node: 'R/M1', generation: 1, runId: IDS[0], choice, stop }, { facts: dead });
const entry = (stop, choice, extra = {}) => ({ stop, choice, kind: 'overseer_cap', ...(choice === 'continue' ? { add: 1 } : {}), ...extra });

test('RC1 a member applies only the roundChoices its tree record backs: an entry for a stop nobody chose at, a choice the newest event replaced and one the record never held are dropped; older backed stops stay', () => {
  const t = startedMember();
  give(t, 'continue', 'overseer_cap:2:2');                       // an older stop, continued
  give(t, 'continue', 'overseer_cap:3:3'); give(t, 'finish', 'overseer_cap:3:3');   // the stop after it: continue, then replaced by finish
  const entries = [entry('overseer_cap:2:2', 'continue'), entry('overseer_cap:3:3', 'continue'), entry('overseer_cap:3:3', 'finish'), entry('overseer_cap:9:9', 'continue', { add: 50 }), entry('overseer_cap:9:9', 'finish'), null, 'junk'];
  assert.deepEqual(backedRoundChoices(t.rootDir, LINEAGE, entries).map(e => [e?.stop, e?.choice]), [['overseer_cap:2:2', 'continue'], ['overseer_cap:3:3', 'finish']]);
  assert.deepEqual(backedRoundChoices(t.rootDir, { node: 'R/M2', generation: 1 }, entries), [], 'another node\'s record backs nothing of this one\'s');
});

test('RC2 a record that does not read, and an entries value that is not a list, back nothing (fails closed)', () => {
  const t = startedMember();
  give(t, 'continue', 'overseer_cap:2:2');
  assert.deepEqual(backedRoundChoices(`${t.rootDir}-nowhere`, LINEAGE, [entry('overseer_cap:2:2', 'continue')]), []);
  assert.deepEqual(backedRoundChoices(t.rootDir, LINEAGE, 'not a list'), []);
  assert.deepEqual(backedRoundChoices(t.rootDir, LINEAGE, undefined), []);
});

// The wiring in src/cli.js (a script that cannot be imported): a source pin, the same weakness as test/note-lines-ignored.test.js, which is why the unit rows above carry the behaviour.
test('RC3 cli.js runs a member\'s roundChoices through backedRoundChoices after the resume rewrite is set up, and ignores a member\'s seatChoices', () => {
  const src = readFileSync(join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'src', 'cli.js'), 'utf8');
  assert.match(src, /if \(treeLineage && resumeRun\) roundChoices = backedRoundChoices\(join\(dirname\(resolve\(resumeRun\)\), treeLineage\.treeId\), treeLineage, roundChoices\);/);
  assert.match(src, /if \(treeLineage\) seatChoices = \[\];/);
  assert.ok(src.indexOf('resumeMeta.roundChoices = roundChoices;   // the resume branch') < src.indexOf('backedRoundChoices(join(dirname'), 'the filter comes after run.json\'s copy is set, so the file keeps what it holds');
});
