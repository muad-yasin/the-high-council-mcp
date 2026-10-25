// ONE latest-by-path helper (0.8.3 M6 rulings row 68; the helper merge of the M5 API reviews). tree-loop.js, tree-affected.js and tree-ready.js each kept a private copy; they now call latestByPath in
// src/tree-transitions.js. The copies were not the same function: tree-loop took the newest generation of each path FIRST and dropped orphans afterwards, the other two dropped orphans first. The two only differ
// for a path whose NEWEST generation is an orphan while an older one is live; this file pins that the record cannot be built (the table refuses it), then that the callers agree on a replaced-parent record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { foldRecord, latestByPath, liveNodesOf, orphansOf, transitionRefusal } from '../src/tree-transitions.js';
import { treeGraph } from '../src/tree-affected.js';
import { providerEligibility } from '../src/tree-loop.js';
import { APPROVAL_FIELDS, FIXTURE_BOUND } from './helpers/tree-fixture.js';

const run = (n, g, parent, fk) => ({ event: 'node_registered', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, attempt: 1, depth: n.split('/').length - 1, parentNode: parent, frontierKey: fk, chain: { name: 'c', sha256: 'a'.repeat(64) }, grant: { amount: 1, unit: 'usd' } });
const front = (fk, parent, pg, children, id) => [{ id: `${id}a`, event: 'frontier_previewed', boundSha256: FIXTURE_BOUND, frontierKey: fk, parentNode: parent, parentGeneration: pg, parentRunId: 'x', splitSha256: 's', children }, { id: `${id}b`, event: 'frontier_approved', ...APPROVAL_FIELDS, frontierKey: fk, revision: 1 }];
const closed = (id, n, g) => ({ id, event: 'node_closed', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, outcome: 'passed', passed: true, status: null, share: 'released' });
const started = (id, n, g) => ({ id, event: 'node_started', node: n, generation: g, runId: `run-${n.replace(/\//g, '-')}-${g}`, pid: 1, host: 'h' });

/** R closed; R/M1@g1 closed and split; its child R/M1/M1@g1 registered under kB; then R/M1 is REPLACED (g2 registered under kC): R/M1/M1@g1 is an orphan, R/M1@g2 is live. */
const events = [
  { id: 'e1', event: 'tree_started', treeId: 't' },
  { id: 'e2', ...run('R', 1, null, null), runId: 't', depth: 0 }, started('e2b', 'R', 1), closed('e2c', 'R', 1),
  ...front('kA', 'R', 1, [{ node: 'R/M1', generation: 1 }], 'e3'),
  { id: 'e4', ...run('R/M1', 1, 'R', 'kA') }, started('e4b', 'R/M1', 1), closed('e4c', 'R/M1', 1),
  ...front('kB', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 1 }], 'e5'),
  { id: 'e6', ...run('R/M1/M1', 1, 'R/M1', 'kB') }, started('e6b', 'R/M1/M1', 1), closed('e6c', 'R/M1/M1', 1),
  { id: 'e7', event: 'needs_decision_opened', node: 'R/M1', generation: 1, runId: 'run-R-M1-1', source: 'status', affected: [{ node: 'R/M1', generation: 1 }] },
  { id: 'e8', event: 'decision_recorded', text: 't', affected: [{ node: 'R/M1', generation: 1 }], form: 'regenerate', stopId: 'e7', gateId: 'g', shownSha256: '0'.repeat(64) },
  { id: 'e9', event: 'generation_opened', decisionId: 'e8', nodes: [{ node: 'R/M1', generation: 2 }] },
  ...front('kC', 'R', 1, [{ node: 'R/M1', generation: 2 }], 'e10'),
  { id: 'e11', ...run('R/M1', 2, 'R', 'kC') }, started('e11b', 'R/M1', 2), closed('e11c', 'R/M1', 2),
];
const keys = m => [...m.values()].sort((a, b) => (a.node < b.node ? -1 : 1)).map(n => `${n.node}@g${n.generation}`);

test('the pin: "the newest generation of a path an orphan, an older one live" cannot be built - the older one registered under the CURRENT parent\'s frontier is accepted, the newer one under a frontier of the REPLACED parent that lists it is refused for exactly that reason', () => {
  // the record without the old child: R/M1 replaced (g2 registered and closed), nothing registered below it
  const base = events.filter(e => !['e6', 'e6b', 'e6c'].includes(e.id));
  // an OLDER generation (g1) of R/M1/M1 under the frontier of the CURRENT parent R/M1@g2 (the preview lists it at g1)
  const live = [...base, ...front('kD', 'R/M1', 2, [{ node: 'R/M1/M1', generation: 1 }], 'e12'), { id: 'e13', ...run('R/M1/M1', 1, 'R/M1', 'kD') }, started('e13b', 'R/M1/M1', 1), closed('e13c', 'R/M1/M1', 1)];
  const st = foldRecord(live);
  assert.equal(transitionRefusal(foldRecord([...base, ...front('kD', 'R/M1', 2, [{ node: 'R/M1/M1', generation: 1 }], 'e12')]), { id: 'e99', ...run('R/M1/M1', 1, 'R/M1', 'kD') }), null, 'the older generation under the current parent is accepted');
  assert.deepEqual([...orphansOf(st)], [], 'and it is live');
  // a NEWER generation (g2) under a frontier of the REPLACED parent R/M1@g1 that lists it there
  const withOld = [...live, ...front('kE', 'R/M1', 1, [{ node: 'R/M1/M1', generation: 2 }], 'e14')];
  const reason = transitionRefusal(foldRecord(withOld), { id: 'e99', ...run('R/M1/M1', 2, 'R/M1', 'kE') })?.reason ?? null;
  assert.match(reason, /belongs to a frontier of R\/M1@g1, which was replaced/, 'refused because its parent generation was replaced, not because of the child list');
  // and the control: the same step under a frontier of the CURRENT parent is accepted, so the refusal above is the replaced-parent rule and nothing else
  const withNew = [...live, ...front('kF', 'R/M1', 2, [{ node: 'R/M1/M1', generation: 2 }], 'e15')];
  assert.equal(transitionRefusal(foldRecord(withNew), { id: 'e99', ...run('R/M1/M1', 2, 'R/M1', 'kF') }), null);
});

test('the callers agree on a replaced-parent record: latestByPath over the live nodes is what treeGraph and providerEligibility see; the orphan is out of all of them, and the old copies are gone', () => {
  const st = foldRecord(events);
  const orphans = orphansOf(st);
  const live = [...st.nodes.values()].filter(n => !orphans.has(`${n.node}@g${n.generation}`));
  assert.deepEqual(keys(latestByPath(live)), ['R@g1', 'R/M1@g2']);
  assert.deepEqual(keys(latestByPath(st.nodes.values())), ['R@g1', 'R/M1@g2', 'R/M1/M1@g1'], 'with the orphan left in it is still found: the helper does not filter');
  assert.deepEqual(liveNodesOf(st, live).map(n => `${n.node}@g${n.generation}`).sort(), ['R/M1@g2', 'R@g1'], 'C2b-1b: with nothing adopted the live set is exactly the newest node of each path');
  const record = { events, corrupt: [], tree: {} };
  assert.deepEqual(keys(treeGraph({ record, state: st, runsDir: '/nonexistent' }).latest), ['R@g1', 'R/M1@g2'], 'the graph');
  const why = providerEligibility({ record, state: st, runsDir: '/nonexistent', work: '/nonexistent' }, 'R/M1/M1').why;
  assert.match(why.join(' '), /^R\/M1\/M1 is not registered: every registration of it \(generation 1\) belonged to a plan that R\/M1@g2 replaced/, 'the loop: the orphan path is not in its latest');
  const src = f => readFileSync(join(import.meta.dirname, '..', 'src', f), 'utf8');
  for (const f of ['tree-loop.js', 'tree-affected.js', 'tree-ready.js']) {
    // C2b-1b (OLD: `latestByPath` itself; NEW: `latestByPath` or `liveNodesOf`; WHY: the three callers now iterate the LIVE nodes of the plan in force - the newest node of each path PLUS the adopted ones - and `liveNodesOf` is the one place that is built on `latestByPath`; with nothing adopted it holds exactly the same nodes, which the next assertion pins)
    assert.match(src(f), /import \{[^}]*\b(latestByPath|liveNodesOf)\b[^}]*\} from '\.\/tree-transitions\.js'/, `${f} uses the shared helper`);
    assert.equal(/(const|function) latestByPath\b/.test(src(f)), false, `${f} keeps no private copy`);
  }
});
