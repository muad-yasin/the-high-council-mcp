// ROADMAP 77, P0 (tests only; gate note m7/A_Paid_Repair_Recommendation_Gate_Note.md section 5, C&C 18 Okt 2026): what TODAY's code does, pinned BEFORE the records for a paid recommendation exist, so that P1/P2 cannot change it silently.
//   AP-1  HAND-WRITTEN lines (marked): the shape of a paid advice call's folder. A run folder with a settled paid stage in its own reservation file and NO copy in the tree record fails the accounting gate
//         (`settlement_not_mirrored`, charged at its worst case); the same folder with the mirror passes. This is F1 of the note: an advice call runs without a mirror today (src/cli.js openReservations(runDir), no `mirror`),
//         so registering it as a side member is only possible if the advice path mirrors like a member. (The member variant is pinned in test/tree-budget.test.js; this one is the advice-shaped folder: label advise-solo.)
//   AP-2  no money file of the tree reaches the advice path: a paid recommendation may enter the tree ONLY through src/tree-advice.js's admission (a later commit); there is no unmetered helper.
//   AP-3  the READER SETS P1 must review when a side record of money appears (note 1.9): who reads `budget.nodes`, who reads the gate's `members`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appendTreeEvent } from '../src/tree-record.js';
import { gateTree } from '../src/tree-budget.js';
import { IDS, approveFrontier, claim, closedRootTree, hostnameOf, registerKid, reservedLine, settledLine, syntheticRun, writeLines } from './helpers/tree-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const codes = g => g.problems.map(p => p.code);

function adviceShapedChild({ mirror }) {
  const t = closedRootTree({ cap: 100 });
  const key = approveFrontier(t.rootDir, ['R/M1']);
  registerKid(t, key, 'R/M1', IDS[0], 10);
  appendTreeEvent(t.rootDir, { event: 'node_started', ...claim('R/M1', IDS[0], process.pid, 1, hostnameOf()) });
  syntheticRun(t, IDS[0], { usage: [{ file: 'advise-solo', usd: 0.3, reservationId: 'r1' }] });
  // HAND-WRITTEN (marked): the lines a paid advice call would leave; a mock call writes none (c7 probe 5f5cfddd), so there is no real record of this shape to copy
  writeLines(t, IDS[0], 'R/M1', [reservedLine('r1', 0.5, 'advise-solo'), settledLine('r1', 'recorded', 0.3)], { mirror });
  return t;
}

test('AP-1 (HAND-WRITTEN lines): a paid advice-shaped folder with its settlement NOT mirrored in the tree record fails the accounting gate and is charged at its worst case; the same folder mirrored passes', () => {
  const bare = gateTree(adviceShapedChild({ mirror: false }).rootDir);
  assert.equal(bare.ok, false);
  assert.ok(codes(bare).includes('settlement_not_mirrored'), codes(bare).join(','));
  assert.equal(Math.round(bare.treeSpentUsd * 1e6) / 1e6, 0.5, 'the worst case (0.50), not the 0.30 the usage file records');
  const mirrored = gateTree(adviceShapedChild({ mirror: true }).rootDir);
  assert.deepEqual([mirrored.ok, codes(mirrored)], [true, []]);
  assert.equal(Math.round(mirrored.treeSpentUsd * 1e6) / 1e6, 0.3);
});

test('AP-2 (source scan): no money file of the tree imports the advice path (send-path, advise, advice-run, advice-guards, mcp/advice): the paid recommendation has no side door into the tree\'s account', () => {
  const MONEY_FILES = ['tree-budget.js', 'tree-register.js', 'tree-member.js', 'tree-loop.js', 'tree-run.js', 'tree-root-replan.js', 'tree-transitions.js', 'tree-record.js', 'tree-abandon.js', 'tree-recovery.js', 'tree-advice-record.js'];   // OLD: ten money files. NEW (ROADMAP 77): + tree-advice-record.js, the hold's own writer. WHY: the new money file must not import the advice path either; the pin has to see it.
  const ADVICE = /from '(\.\/|\.\.\/)(send-path|send-profiles|advise|advice-run|advice-guards|advice-brief|mcp\/advice)(-[a-z]+)?\.js'/;
  for (const f of MONEY_FILES) {
    const code = readFileSync(join(root, 'src', f), 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    assert.ok(!ADVICE.test(code), `${f} imports the advice path`);
  }
});

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
