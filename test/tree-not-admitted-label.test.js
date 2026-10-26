// FX-001 (d0, chunk 17; lane B, 24 Okt 2026): every refusal reason of a child already begins "not admitted: " (tree-frontier.js, tree-budget.js), and the frontier screens printed it under their own label, "NOT ADMITTED: not admitted: ...", and the session's refusal as "is not admitted (not admitted: ...)". The reasons keep their prefix (the bound preview and their tests pin it); the three lines that carry their own label print the rest. Reasons come from the real producers, not typed by hand. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { admitAgainstLimits } from '../src/tree-budget.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { sessionFrontierQuote } from '../src/tree-approve-session.js';
import { renderFrontierText } from '../src/tree-stop.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { block3, planWith } from './helpers/split-fixture.js';

/** block3 with every criterion delegated and the third child inheriting nothing (as test/tree-no-criteria-child.test.js): the producer then refuses it with `not admitted: no acceptance item is left ...`. */
function emptyChildBlock() {
  const b = block3();
  b.classes = [{ id: 'C1', class: 'delegated' }, { id: 'C2', class: 'delegated' }, { id: 'C3', class: 'delegated' }];
  b.children[0].inherits = ['C1', 'C2']; b.children[1].inherits = ['C3']; b.children[2].inherits = [];
  return b;
}
const times = (text, re) => (text.match(re) || []).length;

test('the children screen prints the label once: the real refusal of a child with no acceptance item is "NOT ADMITTED: " and the rest of the reason, and the reason keeps its prefix', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: planWith(emptyChildBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const reason = d.view.children.find(c => c.node === 'R/M3').notAdmittedReason;
  assert.match(reason, /^not admitted: /, 'the reason itself keeps its prefix');
  const lines = renderFrontierText(d.view).split('\n').filter(l => /NOT ADMITTED/.test(l));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.equal(lines[0].trim(), `NOT ADMITTED: ${reason.replace(/^not admitted: /, '')}`);
  assert.equal(times(lines[0], /not admitted/gi), 1, lines[0]);
});

test('the session refusal prints the words once: "R/M3 is not admitted (" and the rest of the reason', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), plan: planWith(emptyChildBlock(), { preface: 'REVISED MOCK DELIVERABLE\n\n' }) });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  const rest = d.view.children.find(c => c.node === 'R/M3').notAdmittedReason.replace(/^not admitted: /, '');
  const q = sessionFrontierQuote({ rootDir: r.t.rootDir, work: r.t.work });
  assert.ok((q.refusal ?? '').startsWith(`R/M3 is not admitted (${rest})`), JSON.stringify(q));
  assert.equal(times(q.refusal, /not admitted/gi), 1, q.refusal);
});

test('the root-replacement screen prints the label once: a limit refusal from admitAgainstLimits, a reason without the prefix stays as it was', () => {
  const real = admitAgainstLimits({ limits: { maxDepth: 3, maxChildrenPerSplit: 4, maxRuns: 1 }, registeredRuns: 1, children: [{ id: 'R', depth: 0 }] })[0];
  assert.match(real.reason, /^not admitted: run limit/, 'the producer still prefixes');
  const view = reason => ({ kind: 'root_replan', frontierKey: 'a'.repeat(64), rootId: 'rid', generation: 3, previous: { generation: 2, runId: 'run-2' }, openedBy: [{ id: 'e9', text: 'Plan it again.' }], taskHash: 'abc123def456',
    child: { chain: { name: 'c', figures: null }, grant: 0, ceiling: 4, admitted: false, notAdmittedReason: reason, mayStop: false, refusedLimit: 'maxRuns' }, setAside: 1, held: 1, heldEras: [2], budget: { rootCapUsd: 100, spentUsd: 1, heldUsd: 0, availableUsd: 99 }, limits: [] });
  const line = v => renderFrontierText(v).split('\n').find(l => /NOT ADMITTED/.test(l));
  assert.equal(line(view(real.reason)), '  NOT ADMITTED: run limit');
  assert.equal(line(view('run limit (12 of 12 runs are registered)')), '  NOT ADMITTED: run limit (12 of 12 runs are registered)');
  // Fable FINAL H-07 (26 Okt 2026): the root re-plan screen prints the limit line from its one copy (src/tree-stop.js limitRaiseLine), as the children screen does
  assert.ok(renderFrontierText(view(real.reason)).split('\n').includes('  A limit can be raised only by you, at the terminal: council tree decide rid --max-runs|--max-depth|--max-children <n> (a raise never changes the root cap).'), renderFrontierText(view(real.reason)));
});
