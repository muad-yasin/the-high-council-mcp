// 0.8.3 M7 (C&C gate finding on the L13 figure): the per-child upper estimate is never shown below the raw figure, and the may-stop line is computed from the grant that gets RECORDED.
// A chain whose at-most is $4.919 used to show ceiling $4.91 and a grant of $4.91 with mayStop false: the child could stop on budget while the screen (and the session's condition) said it could not.
// All-mock, $0. Rows: (GR1) proposeGrants on the odd-cent case; (GR2) the described frontier, the stored preview and the REGISTERED grant of the real priced fixture all agree with the raw figure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { proposeGrants, MONEY_EPS } from '../src/tree-budget.js';
import { renderLimitStop } from '../src/tree-stop.js';
import { readTreeRecord } from '../src/tree-record.js';
import { registerNextChild } from '../src/tree-loop.js';
import { trackedRealRoot } from './helpers/temp-trees.js';
import { pricedChildren } from './helpers/child-chains.js';
import { approvePending, eventsOf } from './helpers/sitting.js';

test('GR1 an at-most that binds is granted whole, rounded UP to the cent when the equal share holds that cent; otherwise it is floored AND flagged may-stop; grants never sum past what is available', () => {
  const one = proposeGrants({ availableUsd: 100, children: [{ id: 'a', atMostUsd: 4.919, cheapestUsd: 0.5 }] })[0];
  assert.equal(one.grantUsd, 4.92); assert.equal(one.maysStopBeforeFinishing, false);
  const exact = proposeGrants({ availableUsd: 100, children: [{ id: 'a', atMostUsd: 4, cheapestUsd: 0.5 }] })[0];
  assert.equal(exact.grantUsd, 4); assert.equal(exact.maysStopBeforeFinishing, false);
  const tight = proposeGrants({ availableUsd: 4.9195, children: [{ id: 'a', atMostUsd: 4.919, cheapestUsd: 0.5 }] })[0];   // the share holds the raw figure but not the cent above it
  assert.ok(tight.grantUsd <= 4.9195 + MONEY_EPS); assert.equal(tight.maysStopBeforeFinishing, true, 'a grant that records below the at-most figure says so');
  const three = proposeGrants({ availableUsd: 14.76, children: [1, 2, 3].map(i => ({ id: 'c' + i, atMostUsd: 4.919, cheapestUsd: 0.5 })) });
  assert.ok(three.reduce((a, g) => a + g.grantUsd, 0) <= 14.76 + MONEY_EPS, 'the sum never passes available');
});

test('GR2 the described frontier, the stored preview and the registered grant agree with the raw at-most figure: nothing is shown below it, and a child shown as unable to stop is granted its whole figure', async () => {
  const r = await trackedRealRoot({ ...pricedChildren() });
  const d1 = approvePending(r);
  const open = d1.view.children.filter(c => c.admitted && !c.registered && !c.reused);
  assert.ok(open.length >= 2);
  const rawOf = node => open.find(o => o.node === node).chain.figures.atMostUsd;
  // what is WRITTEN first: the registered grant, then the stored preview
  const b = registerNextChild(r.t.rootDir, { work: r.t.work });
  const reg = eventsOf(r).filter(e => e.event === 'node_registered' && e.node === b.node).at(-1);
  assert.ok(reg.grant.amount + MONEY_EPS >= rawOf(b.node), `the REGISTERED grant ${reg.grant.amount} holds the whole upper estimate ${rawOf(b.node)}`);
  const previewed = eventsOf(r).filter(e => e.event === 'frontier_previewed').at(-1);
  for (const c of previewed.children.filter(x => x.admitted)) assert.ok(c.ceilingUsd + MONEY_EPS >= rawOf(c.node) && c.capUsd + MONEY_EPS >= rawOf(c.node), `stored preview of ${c.node}: ceiling ${c.ceilingUsd}, cap ${c.capUsd}`);
  for (const c of open) {
    const raw = c.chain.figures.atMostUsd;
    assert.ok(c.ceiling + MONEY_EPS >= raw, `${c.node}: ceiling ${c.ceiling} is not below ${raw}`);
    assert.equal(c.mayStop, false, c.node);
    assert.ok(c.grant + MONEY_EPS >= raw, `${c.node}: shown grant ${c.grant} is below ${raw} while mayStop is false`);
  }
  assert.equal(readTreeRecord(r.t.rootDir).corrupt?.length ?? 0, 0);
});

test('GR3 the per-child upper estimate on the limit stop is never shown below the raw figure: 4.913 reads $4.92 (money() alone rounds to nearest and read $4.91)', () => {
  const text = renderLimitStop({ limit: 'maxRuns', count: 3, effective: 3, initial: 3, open: [], perChild: { atMostUsd: 4.913, name: 'priced-debate' }, wouldAdmit: 2, flag: 'max-runs', budget: { rootCapUsd: 100, availableUsd: 90 } });
  assert.match(text, /2 more children x \$4\.92 \(priced-debate, upper estimate\) = \$9\.84\./);   // CHANGED ACCEPTED (label rename, 20 Okt 2026): OLD "at most"; NEW "upper estimate". WHY: only the printed label (src/tree-stop.js).
  assert.doesNotMatch(text, /\$4\.91|\$9\.83/);
});

test('GR4 the pool edge: k children whose rounded-up grants land EXACTLY on the free amount are all granted whole, and registration\'s own test (grant <= what is still free + MONEY_EPS, tree-register.js:79) passes for each in turn', () => {
  const pool = 9.84;                                                                                  // 2 x 4.92
  const gs = proposeGrants({ availableUsd: pool, children: [1, 2].map(i => ({ id: 'c' + i, atMostUsd: 4.913, cheapestUsd: 0.5 })) });
  assert.deepEqual(gs.map(g => g.grantUsd), [4.92, 4.92]); assert.deepEqual(gs.map(g => g.maysStopBeforeFinishing), [false, false]);
  let free = pool; for (const g of gs) { assert.ok(g.grantUsd <= free + MONEY_EPS, `${g.id}: ${g.grantUsd} fits the ${free} still free`); free -= g.grantUsd; }
  const short = proposeGrants({ availableUsd: 9.83, children: [1, 2].map(i => ({ id: 'c' + i, atMostUsd: 4.913, cheapestUsd: 0.5 })) });   // one cent short: the cent is not there, so no grant passes the pool
  assert.ok(short.reduce((a, g) => a + g.grantUsd, 0) <= 9.83 + MONEY_EPS); assert.ok(short.every(g => g.maysStopBeforeFinishing), 'a cent short of the whole figure: floored and flagged');
});
