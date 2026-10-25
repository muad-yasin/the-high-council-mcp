// R17 follow-up (C&C, 11 Oct 2026): the approve text printed "A limit can be raised only by you ... council tree decide --max-runs|--max-depth|--max-children" whenever ANY child was not admitted. Since R17 a raise is
// accepted only at a limit stop, so for a child held back as stale, or refused for budget or price, that line pointed at a command that refuses. It now prints only when a refused child carries `refusedLimit`.
// Pure views (the fixture's R/M3 is the limit refusal) and one real frontier whose R/M2 is held stale. All-mock, $0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFrontierText } from '../src/tree-stop.js';
import { appendTreeEvent } from '../src/tree-record.js';
import { describeFrontier, findPendingFrontier } from '../src/tree-frontier.js';
import { frontierView } from './helpers/stop-views.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { ROOT_ID } from './helpers/tree-fixture.js';

const HINT = /A limit can be raised only by you/;
/** the fixture view with R/M3 (its limit refusal) replaced by another reason, or removed */
const viewWith = third => { const v = frontierView(); v.children = v.children.slice(0, 2); if (third) v.children.push({ ...frontierView().children[2], ...third }); return v; };

test('a child refused for a LIMIT: the raise hint prints once, naming the command (the positive control for the three refusals below)', () => {
  const t = renderFrontierText(frontierView());
  assert.match(t, /Not admitted, and why\n  R\/M3 generation 1: run limit/);
  assert.equal((t.match(HINT) || []).length, 1);
  assert.ok(t.includes('council tree decide 2026-10-08T11-00-00-000Z --max-runs|--max-depth|--max-children <n>'));
});

test('a child held back as stale, one refused for budget and one for price: the reason is listed and the raise hint is NOT, because there is no limit to raise', () => {
  for (const [label, third] of [
    ['stale', { notAdmittedReason: 'stale: R/M3 is held while a stop that names it is open', refusedLimit: null, refusedBy: 'stale' }],
    ['budget', { notAdmittedReason: 'budget: the root cap leaves $0.40, this child needs $3.10', refusedLimit: null, refusedBy: 'budget' }],
    ['price', { notAdmittedReason: 'price: the chain has no figure', refusedLimit: null, refusedBy: 'price' }],
  ]) {
    const t = renderFrontierText(viewWith(third));
    assert.match(t, new RegExp(`Not admitted, and why\\n  R/M3 generation 1: ${third.notAdmittedReason.split(':')[0]}`), `${label}: the reason is shown`);
    assert.equal(HINT.test(t), false, `${label}: no raise hint`);
    assert.equal(/--max-runs|--max-depth|--max-children/.test(t), false, `${label}: no limit flag is named at all`);
  }
});

test('a stale child beside a limit-refused one: the hint prints (one child is refused by a limit)', () => {
  const v = viewWith({ notAdmittedReason: 'stale: held', refusedLimit: null, refusedBy: 'stale' });
  v.children.push({ ...frontierView().children[2], node: 'R/M4', milestone: 'M4' });
  assert.equal((renderFrontierText(v).match(HINT) || []).length, 1);
});

test('a real frontier whose R/M2 is held stale: describeFrontier carries no refusedLimit for it, and the text it renders has no raise hint', async () => {
  const r = await trackedRealRoot(pricedChildren());
  appendTreeEvent(r.t.rootDir, { event: 'needs_decision_opened', node: 'R', generation: 1, runId: ROOT_ID, source: 'status', affected: [{ node: 'R', generation: 1 }, { node: 'R/M2', generation: 1 }] });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const m2 = d.view.children.find(c => c.node === 'R/M2');
  assert.deepEqual([m2.admitted, m2.refusedBy, m2.refusedLimit], [false, 'stale', null]);
  const t = renderFrontierText(d.view);
  assert.match(t, /Not admitted, and why\n  R\/M2 generation 1: /);
  assert.equal(HINT.test(t), false);
});

test('a real frontier with a child refused by the fan-out limit: describeFrontier carries a refusedLimit for it (not only the fixture view), and the text it renders prints the raise hint exactly once', async () => {
  const r = await trackedRealRoot({ ...pricedChildren(), limits: { maxDepth: 2, maxRuns: 12, maxChildrenPerSplit: 2, attemptsPerChild: 1 } });
  const d = describeFrontier({ rootDir: r.t.rootDir, work: r.t.work, pending: findPendingFrontier({ rootDir: r.t.rootDir }) });
  assert.equal(d.refusal, undefined, JSON.stringify(d.refusal));
  const m3 = d.view.children.find(c => c.node === 'R/M3');
  assert.deepEqual([m3.admitted, m3.notAdmittedReason, m3.refusedBy], [false, 'not admitted: fan-out limit', null]);
  assert.ok(m3.refusedLimit, `the real view carries the limit that refused it: ${JSON.stringify(m3.refusedLimit)}`);
  assert.equal(d.view.children.filter(c => c.refusedLimit).length, 1, 'only the refused child carries one');
  assert.equal((renderFrontierText(d.view).match(HINT) || []).length, 1);
  assert.equal(d.preview.children.find(c => c.node === 'R/M3').limit, m3.refusedLimit, 'the preview binds the same limit');
});

test('C&C 12 Oct (the ceiling finding, rulings row 126): the may-stop sentence prints when the grant EQUALS the ceiling too, with its reason and the top-up route; a grant below the ceiling keeps the old line; a registered child gets neither; nothing in the text is new data (the same view, only its text)', () => {
  const only = child => { const v = frontierView(); v.children = [{ ...v.children[0], ...child }]; return renderFrontierText(v); };
  const at = only({ grant: 4, ceiling: 4, mayStop: false, admitted: true, registered: null, node: 'R/M1' });
  assert.match(at, /May stop before finishing: possibly \(the grant equals the chain's upper estimate, but that figure rests on the chain's assumed prompt sizes, not on the real plan: a longer plan or more criteria can stop the run at its grant; then raise it with `council tree decide 2026-10-08T11-00-00-000Z --top-up R\/M1 --amount <usd>`\)\./);
  assert.equal(/May stop before finishing: yes/.test(at), false, 'only one of the two sentences');
  const below = only({ grant: 3.33, ceiling: 4, mayStop: true, admitted: true, registered: null });
  assert.ok(below.includes("May stop before finishing: yes (the grant is below the chain's upper estimate)."));
  assert.equal(/May stop before finishing: possibly/.test(below), false);
  const reg = only({ grant: 4, ceiling: 4, mayStop: false, admitted: true, registered: { phase: 'closed', heldUsd: 4, runId: 'r1' } });
  assert.equal(/May stop before finishing/.test(reg), false, 'a registered child keeps the grant it has: no sentence');
  const refused = only({ grant: 0, ceiling: 0, mayStop: false, admitted: false, registered: null, notAdmittedReason: 'not admitted: budget' });
  assert.equal(/May stop before finishing/.test(refused), false, 'not admitted: no grant, no sentence');
});
