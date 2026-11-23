// 0.8.4 (the advice add-on is removed COMPLETELY; wave 2 of the test edits): what the tree record keeps of the add-on's recommendation route, and what its money readers still look like.
//   AP-1  the tree budget has no advice hold: `budgetOf` returns no `advice` and `gateTree` no `adviceRuns` (the hold left with the route).
//   AP-2  an OLD record: a tree record line that holds advice_registered / advice_run_added / advice_ended / advice_reservation_mirrored is an UNKNOWN EVENT. The record reads as damaged (`record_corrupt`), the tree is
//         blocked and every writer refuses; the line is never ignored. The four lines are built BY HAND from the old shape (git history keeps it: src/tree-transitions.js before 0.8.4); nothing writes them any more.
//   AP-3  the READER SETS of the tree's money records (kept from the 0.8.3 pin): who reads `budget.nodes`, who reads the gate's `members`.
// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: AP-1 (an advice-shaped folder fails the accounting gate when its settlement is not mirrored) and AP-2 (no money file imports the advice path; it read src/tree-advice-record.js, which is gone). NEW: AP-1 asserts the budget carries no advice hold, AP-2 asserts an old advice event reads record_corrupt; AP-3 is unchanged. WHY: the recommendation route and its files are removed; the `settlement_not_mirrored` gate is still pinned for members in test/tree-budget.test.js and test/tree-printed-ways-f13.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EVENTS_FILE, TreeRefusal, appendTreeEvent, readTreeRecord, stateOf, treeDirOf } from '../src/tree-record.js';
import { EVENTS_SCHEMA } from '../src/tree-transitions.js';
import { budgetOf, gateTree } from '../src/tree-budget.js';
import { GATE_FIELDS, closedRootTree } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'a'.repeat(64);

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: AP-1 built an advice-shaped paid folder (label advise-solo) and expected settlement_not_mirrored unless mirrored. NEW: AP-1 asserts budgetOf has no `advice` and gateTree no `adviceRuns`. WHY: the advice hold and its side member are removed; the mirror gate for members stays pinned in test/tree-budget.test.js.
test('AP-1 the tree budget has no advice hold: budgetOf returns no `advice`, gateTree no `adviceRuns`', () => {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  const gate = gateTree(t.rootDir);
  const budget = budgetOf(t.rootDir, { gate });
  assert.equal(Object.hasOwn(budget, 'advice'), false, `budgetOf keys: ${Object.keys(budget).join(',')}`);
  assert.equal(Object.hasOwn(gate, 'adviceRuns'), false, `gateTree keys: ${Object.keys(gate).join(',')}`);
  assert.equal(gate.ok, true);
});

// The old shapes (0.8.3), fields as the table required them. `actor` and `via` (the answerer) were required on advice_registered only.
const OLD_LINES = {
  advice_registered: { adviceId: 'A1', grantUsd: 4, purpose: 'recommendation', stopId: 'S1', gateId: 'g-grant', shownSha256: SHA, pid: 4242, host: 'h', expiresAtMs: 1_900_000_000_000, actor: 'person', via: 'terminal' },
  advice_run_added: { adviceId: 'A1', runId: '2026-10-08T11-10-00-000Z', kind: 'first', briefSha256: SHA, shownSha256: SHA },
  advice_ended: { adviceId: 'A1', reason: 'settled', returnedUsd: 3.5 },
  advice_reservation_mirrored: { adviceId: 'A1', runId: '2026-10-08T11-10-00-000Z', line: { schema: 'spend-reservations/1', event: 'reserved', id: 'r1', label: 'advise-solo', seat: 'openrouter/x/y', usd: 0.5, at: '2026-10-08T11:10:01.000Z' } },
};

// CHANGED ACCEPTED TEST (0.8.4 add-on removal, wave 2): OLD: AP-2 scanned the tree money files for imports of the advice path (it read src/tree-advice-record.js, now gone). NEW: AP-2 builds each old advice event line by hand and expects an unknown event / record_corrupt. WHY: the route is removed; what must hold now is that an old record is never silently ignored.
for (const [name, fields] of Object.entries(OLD_LINES)) {
  test(`AP-2 an old ${name} line in a tree record is an unknown event: the record reads as damaged (record_corrupt), the tree is blocked, the line is never ignored`, () => {
    const t = closedRootTree({ cap: 20 }); track(t.work);
    const before = readTreeRecord(t.rootDir);
    assert.deepEqual(before.corrupt, [], 'the record reads before the old line is added');
    const id = `e${Math.max(0, ...before.events.map(e => Number(e.id.slice(1)))) + 1}`;
    // HAND-WRITTEN (marked): nothing writes this line any more
    appendFileSync(join(treeDirOf(t.rootDir), EVENTS_FILE), `${JSON.stringify({ schema: EVENTS_SCHEMA, id, event: name, at: '2026-10-08T11:20:00.000Z', ...fields })}\n`);
    const record = readTreeRecord(t.rootDir);
    assert.equal(record.corrupt.length, 1, JSON.stringify(record.corrupt));
    assert.match(record.corrupt[0].reason, new RegExp(`unknown event "${name}"`));
    assert.equal(record.events.some(e => e.event === name), false, 'the line is not folded in as an event');
    assert.equal(stateOf(record).sticky.has('record_corrupt'), true, 'the tree is blocked: record_corrupt');
    assert.throws(() => appendTreeEvent(t.rootDir, { event: 'tree_abandoned', ...GATE_FIELDS }), err => err instanceof TreeRefusal && err.code === 'record_corrupt', 'a writer refuses on a damaged record');
  });
}

test('AP-3 (reader sets): `budget.nodes` is read by tree-budget.js and tree-decide.js only; the gate\'s `members` by tree-report.js only (tree-status reads memberSpend.members): a side record of money must be reviewed against exactly these', () => {
  const files = [];
  const walk = d => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p); } };
  walk(join(root, 'src'));
  const stripped = f => readFileSync(f, 'utf8').split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n');
  const rel = f => f.slice(join(root, 'src').length + 1);
  const readers = re => files.filter(f => re.test(stripped(f))).map(rel).sort();
  assert.deepEqual(readers(/\bbudget\.nodes\b/), ['tree-budget.js', 'tree-decide.js']);
  assert.deepEqual(readers(/\b(g|gate)\.members\b/).filter(f => f !== 'tree-budget.js'), ['tree-report.js']);
  assert.deepEqual(readers(/\bmemberSpend\.members\b/), ['tree-status.js']);
});
