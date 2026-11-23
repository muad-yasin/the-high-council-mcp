// 0.8.4 round 1, held fix P2: an early finish hands the builder, and asks the overseer layer about, EVERY objection open in the record, not only the ones the pass before the revise raised. Through the real CLI, $0 (test/helpers/early-ladder-run.js: the ladder
// chain, every judge a mock, the writer external). Leg P2: layer 1 objects to every draft (rated 5); the ladder starts pass 4 at layer 2, where layers 2 and 3 sign off, so the pass that triggers the revise raised NOTHING while 3 layer-1 objections still stand;
// the handler says not yet, the revise carries the EARLY-FINISH line, the overseer layer says yes. One set of objections must feed the three places that name it: (1) the list the overseer layer decides on in the early ask, (2) the builder tasks of HANDOFF.md,
// (3) the count in the headline and in stop.items. They were three different sets (an empty list above a headline saying 0 while 3 stood).
// What tells the case apart (not a wording pin): the ids. The ask lists exactly the ids the record holds open (report.dispute.open_objections), the HANDOFF.md tasks and stop.items name the same ids, and the headline's count is that number.
// Controls: a run whose first pass raised the objections and whose first revise proposed the early finish (every standing objection is the pass's own: today's list, nothing added), and the three places agree there too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { earlyLadderRun } from './helpers/early-ladder-run.js';
import { verdictHeadline } from '../src/verdict-headline.js';

const ONE = l => (l === 1 ? 'mock-exch-support-keep-always-sev5' : 'mock-exch-support-keep-clean');
const ran = {};
const P2 = () => (ran.P2 ??= earlyLadderRun({ name: 'eor-p2', critic: ONE }));
const FLAT = () => (ran.FLAT ??= earlyLadderRun({ name: 'eor-first', critic: ONE, earlyAt: 'first-revise' }));
const idsOf = s => [...new Set([...String(s ?? '').matchAll(/\b(O-[0-9a-f]{8}(?:#r?\d+)?)/g)].map(m => m[1]))].sort();
const taskIds = w => idsOf(w.handoffMd.slice(w.handoffMd.indexOf('## Builder tasks left open'), w.handoffMd.indexOf('## Before you build')));
const askIds = w => idsOf(w.asks[0]?.text.split('\n').filter(l => l.startsWith('- ')).join('\n'));
const recordIds = w => (w.report.dispute?.open_objections ?? []).map(o => o.id).sort();

function premise(w, n) {
  assert.ok(w.report, `premise: the run wrote report.json (steps ${JSON.stringify(w.steps)})`);
  assert.equal(w.report.stop?.kind, 'early_finish', 'premise: the run ended early');
  assert.ok(w.asks.length > 0, 'premise: the overseer layer was shown the early ask');
  assert.equal(w.report.signed_text.open_objections, n, 'premise: the count the record holds at the end');
  assert.equal(recordIds(w).length, n, 'premise: the dispute record lists them');
}
const want = recordIds;
function agree(w) {   // the three places name one set
  const want = recordIds(w);
  assert.deepEqual(askIds(w), want, 'the early ask lists every objection the record holds open');
  assert.deepEqual(taskIds(w), want, 'the builder tasks of HANDOFF.md name the same');
  assert.deepEqual((w.report.stop.items ?? []).map(i => i.id).sort(), want, 'stop.items names the same');
  return w.report.stop.items;
  assert.ok(verdictHeadline(w.report).text.includes(`${want.length} open objection(s) go to the builder`), 'the headline counts them');
}

test('P2 (leg P2: 3 layer-1 objections stand, the last pass raised none): the early ask, the builder tasks, stop.items and the headline count are ONE set, the record\'s', () => {
  const w = P2(); premise(w, 3);
  const items = agree(w);
  assert.deepEqual(items.filter(i => i.earlier === true).map(i => i.id).sort(), want(w), 'each is marked as an objection of an earlier pass: the pass that triggered the revise raised none of them');
});
test('P2 control (the first pass raised every objection that stands): the same three places agree, on the pass\'s own list', () => {
  const w = FLAT(); premise(w, 3);
  assert.deepEqual(agree(w).filter(i => i.earlier !== undefined), [], 'none is marked as an earlier pass\'s: the pass raised them all');
});
