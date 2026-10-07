// 0.8.2 item 3 (owner decision 2, 5 Oct 2026): seeded per-reader shuffle of lab letters, listing order and canary target (debate_hygiene.shuffle). $0, offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runChain } from '../src/chain.js';
import { readerView, viewRecord } from '../src/debate-order.js';
import { pickCanaryTargetSeeded, pickCanaryTarget } from '../src/canary.js';
import * as R from '../src/roles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chain = name => JSON.parse(readFileSync(join(root, 'chains', `${name}.json`), 'utf8'));
const items = ['x', 'y', 'z', 'w'].flatMap(lab => [1, 2].map(n => ({ id: `${lab}-${n}`, lab })));

test('readerView: a pure function of (run, stage, reader); letters follow the shuffled order; different readers/runs/stages differ', () => {
  const a = readerView(items, 'x', { runId: 'r1', anonymise: R.anonymise });
  const again = readerView(items, 'x', { runId: 'r1', anonymise: R.anonymise });
  assert.deepEqual(a.items, again.items, 'same seed, same order (a resume replays it)');
  assert.deepEqual([...a.items].sort((p, q) => (p.id < q.id ? -1 : 1)), [...items].sort((p, q) => (p.id < q.id ? -1 : 1)), 'a permutation: nothing lost or added');
  const firstLab = a.items[0].lab;
  assert.equal(a.maps.labTo[firstLab], 'Lab A', 'the letters follow the order the reader was shown');
  const orders = new Set(['x', 'y', 'z', 'w'].map(r => readerView(items, r, { runId: 'r1', anonymise: R.anonymise }).items.map(i => i.id).join()));
  assert.ok(orders.size > 1, 'readers do not all get the same order');
  assert.notEqual(readerView(items, 'x', { runId: 'r2', anonymise: R.anonymise }).items.map(i => i.id).join(), a.items.map(i => i.id).join(), 'another run, another order');
  assert.notEqual(readerView(items, 'x', { runId: 'r1', stage: 'alternatives', anonymise: R.anonymise }).items.map(i => i.id).join(), a.items.map(i => i.id).join(), 'another stage, another order');
  assert.deepEqual(viewRecord('debate', 'x', a), { stage: 'debate', reader: 'x', order: a.items.map(i => i.id), letters: a.maps.labTo });
});

test('pickCanaryTargetSeeded: deterministic, always a standing proposal, spread over targets (the old pick is always the first), and the target depends on nothing but the seed', () => {
  const props = [{ id: 'a-1', lab: 'a' }, { id: 'b-1', lab: 'b' }, { id: 'c-1', lab: 'c', withdrawn: true }, { id: 'd-1', lab: 'd' }];
  assert.equal(pickCanaryTarget(props).id, 'a-1', 'the old rule: always the first roster lab');
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const t = pickCanaryTargetSeeded(props, `run-${i}`); assert.ok(!t.withdrawn); seen.add(t.id); assert.equal(pickCanaryTargetSeeded(props, `run-${i}`).id, t.id); }
  assert.deepEqual([...seen].sort(), ['a-1', 'b-1', 'd-1']);
  // the review's finding: a lab with SEVERAL proposals must not see its target move between sittings - the pick depends on nothing but the seed and the standing proposals
  const two = [{ id: 'a-1', lab: 'a' }, { id: 'a-2', lab: 'a' }, { id: 'b-1', lab: 'b' }, { id: 'b-2', lab: 'b' }];
  for (let i = 0; i < 200; i++) assert.equal(pickCanaryTargetSeeded(two, `run-${i}`).id, pickCanaryTargetSeeded([...two], `run-${i}`).id);
  assert.equal(pickCanaryTargetSeeded([{ id: 'x', lab: 'x', withdrawn: true }], 's'), null);
});

test('a mock debate with debate_hygiene.shuffle: posts and replies still map back to the real ids, the orders are recorded, the same run id replays the same orders, another run id does not', async () => {
  const cfg = { ...chain('mock-debate'), debate_hygiene: { shuffle: true } };
  const go = runId => runChain({ request: 'Write a short fixture deliverable.', config: cfg, runId, log: () => {} });
  const r1 = await go('2026-10-06T20-00-00-000Z');
  const ids = new Set(r1.proposals.map(p => p.id));
  assert.ok(r1.debate.posts.length >= 1);
  for (const p of r1.debate.posts) assert.ok(ids.has(p.on), `post on ${p.on}: not a real proposal id (the reader's own letters were not mapped back)`);
  assert.ok(r1.debateOrders.length >= 2 && r1.debateOrders.every(o => o.stage === 'debate' && o.order.length === ids.size));
  const r2 = await go('2026-10-06T20-00-00-000Z');
  assert.deepEqual(r2.debateOrders, r1.debateOrders, 'the same run id: the same orders');
  const r3 = await go('2026-10-06T21-11-11-111Z');
  assert.notDeepEqual(r3.debateOrders.map(o => o.order), r1.debateOrders.map(o => o.order), 'another run id: other orders');
  const plain = await runChain({ request: 'Write a short fixture deliverable.', config: chain('mock-debate'), runId: 'x', log: () => {} });
  assert.equal(plain.debateOrders, undefined, 'off: no new key');
});

test('the alternatives debate shuffles per reader too, maps replies back to the real alternative ids, and records its orders', async () => {
  const cfg = { ...chain('mock-debate'), alternatives: { enabled: true }, debate_hygiene: { shuffle: true } };
  const r = await runChain({ request: 'A mock task.', config: cfg, runId: '2026-10-06T22-22-22-222Z', log: () => {} });
  const alt = r.debateOrders.filter(o => o.stage === 'alternatives');
  assert.ok(alt.length >= 2, JSON.stringify(r.debateOrders.map(o => o.stage)));
  const altIds = new Set(r.alternatives.items.map(a => a.id));
  for (const o of alt) assert.deepEqual([...o.order].sort(), [...altIds].sort());
  assert.ok(r.alternatives.posts.length >= 2);
  for (const p of r.alternatives.posts) assert.ok(altIds.has(p.on), `alternatives post on ${p.on}`);
});

import { translateRefs } from '../src/debate-order.js';

test('translateRefs: free text in a post is re-lettered for each reader so "A-2" and "Lab B" still name the same proposal and lab (the item 3 review\'s finding)', () => {
  const labs = ['x', 'y', 'z', 'w'];
  let checked = 0;
  for (const poster of labs) for (const author of labs) {
    const pv = readerView(items, poster, { runId: 'r9', anonymise: R.anonymise });
    const av = readerView(items, author, { runId: 'r9', anonymise: R.anonymise });
    for (const target of items) {
      const labOfTarget = target.lab;
      const text = `I disagree with ${pv.maps.idTo[target.id]} (${pv.maps.labTo[labOfTarget]}); ${pv.maps.labTo[labOfTarget]} is wrong. Also see ${pv.maps.idTo[items[0].id]}.`;
      const forAuthor = translateRefs(text, pv.maps, av.maps);
      assert.equal(forAuthor, `I disagree with ${av.maps.idTo[target.id]} (${av.maps.labTo[labOfTarget]}); ${av.maps.labTo[labOfTarget]} is wrong. Also see ${av.maps.idTo[items[0].id]}.`);
      assert.equal(translateRefs(text, pv.maps, null), `I disagree with ${target.id} (${labOfTarget}); ${labOfTarget} is wrong. Also see ${items[0].id}.`, 'null = the real ids and lab names (the builder\'s board)');
      checked++;
    }
  }
  assert.ok(checked > 100);
  // the check can fail: the same text left untouched differs between two readers whenever their lettering differs
  const pv = readerView(items, 'x', { runId: 'r9', anonymise: R.anonymise }), av = readerView(items, 'y', { runId: 'r9', anonymise: R.anonymise });
  assert.notEqual(pv.maps.idTo[items[0].id], av.maps.idTo[items[0].id], 'the premise: these two readers letter the same proposal differently');
  // tokens the poster's maps do not contain, and non-strings, are left alone
  assert.equal(translateRefs('see Q-9 and Lab Q', pv.maps, av.maps), 'see Q-9 and Lab Q');
  assert.equal(translateRefs(undefined, pv.maps, av.maps), undefined);
  assert.equal(translateRefs('Lab A', null, av.maps), 'Lab A');
});

test('wiring, with shuffle and the majority guard on: a post that cites another proposal is re-lettered for each AUTHOR\'s prompt, shown with real ids on the builder\'s board, and a withdrawal that quotes it is not marked unargued', async () => {
  const base = chain('mock-debate');
  const cfg = {
    ...base, majority_guard: { enabled: true }, debate_hygiene: { shuffle: true },
    seats: { ...base.seats, proposers: base.seats.proposers.map(s => ({ ...s, model: 'mock-proposer-xref' })) },
  };
  const result = await runChain({ request: 'Write a short fixture deliverable.', config: cfg, runId: '2026-10-06T23-00-00-000Z', log: () => {} });
  // the frames, rebuilt from what the run recorded (the order each reader saw), with roles.js's own anonymise
  const frame = {};
  for (const o of result.debateOrders.filter(x => x.stage === 'debate')) frame[o.reader] = R.anonymise(o.order.map(id => result.proposals.find(p => p.id === id)));
  const realOf = (poster, token) => frame[poster].idFrom[token];
  // the posts as each poster WROTE them (its own lettering): from the recorded stage text, since debate.posts[] is re-lettered to real ids when shuffle is on
  const posts = Object.keys(frame).flatMap(by => {
    const st = result.stages.find(x => x.label === `debate-${by}`);
    return (JSON.parse(st.text).posts || []).filter(p => p.stance === 'object').map(p => ({ ...p, by, on: frame[by].idFrom[p.on] }));
  });
  assert.ok(posts.length >= 2);
  const cited = p => (p.text.match(/^([A-Z]-\d+) \((Lab [A-Z])\)/) || []);
  let checkedAuthors = 0, differing = 0;
  for (const author of Object.keys(frame)) {
    const reply = result.stages.find(s => s.label === `reply-${author}`);
    if (!reply) continue;
    const seen = JSON.parse(reply.text)._receivedUser;
    for (const p of posts.filter(x => result.proposals.find(q => q.id === x.on)?.lab === author)) {
      const [, token, labToken] = cited(p);
      const realId = realOf(p.by, token), realLab = Object.keys(frame[p.by].labTo).find(l => frame[p.by].labTo[l] === labToken);
      const expected = `${frame[author].idTo[realId]} (${frame[author].labTo[realLab]}) is cited here`;
      assert.ok(seen.includes(expected), `author ${author} should have been shown "${expected}" (the poster ${p.by} wrote "${token} (${labToken})")`);
      if (token !== frame[author].idTo[realId]) differing++;
      checkedAuthors++;
    }
  }
  assert.ok(checkedAuthors >= 2);
  assert.ok(differing >= 1, 'the premise: at least one author\'s lettering differs from its poster\'s, so a missing translation would have been caught');
  for (const p of posts) {
    const [, token, labToken] = cited(p);
    const realId = realOf(p.by, token), realLab = Object.keys(frame[p.by].labTo).find(l => frame[p.by].labTo[l] === labToken);
    assert.ok(result.board.includes(`${realId} (${realLab}) is cited here`), `the builder's board should show the real id and lab for "${token} (${labToken})"`);
  }
  assert.ok(result.debate.replies.filter(r => r.action === 'withdraw').length >= 1);
  assert.ok(result.debate.replies.every(r => r.action !== 'withdraw' || !r.unargued), 'a withdrawal that quotes the post as its author saw it is not unargued: ' + JSON.stringify(result.debate.replies.map(r => [r.id, r.unargued])));
});

test('with shuffle on, report.json\'s debate.posts[].text carries real ids and lab names (one lettering for every human reader), and with it off the posts are untouched', async () => {
  const base = chain('mock-debate');
  const mk = extra => ({ ...base, ...extra, seats: { ...base.seats, proposers: base.seats.proposers.map(s => ({ ...s, model: 'mock-proposer-xref' })) } });
  const on = await runChain({ request: 'Write a short fixture deliverable.', config: mk({ debate_hygiene: { shuffle: true } }), runId: 'r-text', log: () => {} });
  const ids = new Set(on.proposals.map(p => p.id)); const labs = new Set(on.proposals.map(p => p.lab));
  for (const p of on.debate.posts.filter(x => x.stance === 'object')) {
    const m = p.text.match(/^(\S+) \((\S+)\) is cited here/);
    assert.ok(m && ids.has(m[1]) && labs.has(m[2]), `post text should name a real id and lab: ${p.text}`);
  }
  const off = await runChain({ request: 'Write a short fixture deliverable.', config: mk({}), runId: 'r-text', log: () => {} });
  for (const p of off.debate.posts.filter(x => x.stance === 'object')) assert.match(p.text, /^[A-Z]-\d+ \(Lab [A-Z]\) is cited here/, 'off: the anonymised wording as written');
});
