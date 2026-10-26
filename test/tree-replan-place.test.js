// D2 F10 with D3 F10-1 (CR-2A-002), T10 part (2): the root re-plan judges a node BY PLACE at any depth. A NESTED adoption (R/M1@g2's children frontier adopts R/M1/A@g1 into the slot R/M1/B@g2) on a record written through the
// real table (test/helpers/adoption-fixture.js adoptedTree: every event appended through appendTreeEvent / registerChildUnchecked, as the adoption readers' tests build theirs). The adopted node sits under R/M1@g2 (its adopting
// frontier's parent), which hangs under the current root plan, so a stop on it makes it ineligible for the next root re-plan. Before, the walk filed it under R/M1@g1 (its own frontier's parent), which is no longer live, and
// never judged it. Part (1), real verbs, is in test/tree-adoption-walk.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendTreeEvent, readTreeRecord, stateOf } from '../src/tree-record.js';
import { ineligibleBelowRoot } from '../src/tree-transitions.js';
import { adoptedTree } from './helpers/adoption-fixture.js';
import { IDS } from './helpers/tree-fixture.js';

test('T10 (2) CR-2A-002 at depth: a stop on the NESTED adopted R/M1/A@g1 makes it ineligible for the next root re-plan (ineligibleBelowRoot lists it); with no stop it is not listed (control)', () => {
  const { t } = adoptedTree({ finishC: true });
  const st0 = stateOf(readTreeRecord(t.rootDir));
  assert.equal(st0.adopted.get('R/M1/A@g1')?.slot, 'R/M1/B@g2', 'the adoption is the nested one: R/M1@g2\'s frontier adopted R/M1/A@g1');
  assert.equal(ineligibleBelowRoot(st0).includes('R/M1/A@g1'), false, 'control: finished and passed, no stop: holdable');
  appendTreeEvent(t.rootDir, { event: 'needs_decision_opened', node: 'R/M1/A', generation: 1, runId: IDS[1], source: 'blocked', blockedBy: [{ code: 'contract_check', text: 'its HANDOFF.md changed' }], affected: [{ node: 'R/M1/A', generation: 1 }] });
  const st = stateOf(readTreeRecord(t.rootDir));
  assert.ok(ineligibleBelowRoot(st).includes('R/M1/A@g1'), `the nested adopted node is judged by place: ${JSON.stringify(ineligibleBelowRoot(st))}`);
});
