// 0.8.3 ROADMAP 77, step 4 (records): a root re-plan is decided only after the recommendation request ended, and a decision that says its text is a recommendation names a request of this stop that ended settled. The table's own answers
// (src/tree-transitions.js, case 'decision_recorded'); all $0. Rows: (D1) a root re-plan with a request still open is refused; (D2) fromRecommendation needs a root re-plan and a request of THIS stop that ended settled; (D3) with the request settled neither new rule refuses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readTreeRecord, stateOf } from '../src/tree-record.js';
import { transitionRefusal } from '../src/tree-transitions.js';
import { registerAdviceAdmitted, endAdvice } from '../src/tree-advice-record.js';
import { closedRootTree } from './helpers/tree-fixture.js';
import { track } from './helpers/temp-trees.js';

const SHA = 'a'.repeat(64);
const answer = { actor: 'person', via: 'terminal' };
const TTL = 600_000;
const withRequest = () => {
  const t = closedRootTree({ cap: 20 }); track(t.work);
  registerAdviceAdmitted(t.rootDir, { adviceId: 'A1', grantUsd: 4, stopId: 'S1', gateId: 'g-grant', shownSha256: SHA, answer, ttlMs: TTL });
  return t;
};
const stateOfTree = t => { const s = stateOf(readTreeRecord(t.rootDir)); s.openStops = ['S1']; return s; };
const decision = over => ({ event: 'decision_recorded', text: 'Try again with a narrower scope.', affected: [], stopId: 'S1', gateId: 'g1', shownSha256: SHA, form: 'regenerate', replansRoot: true, actor: 'person', via: 'terminal', ...over });
const reason = (state, over) => transitionRefusal(state, decision(over), {})?.reason ?? null;

test('D1 a root re-plan is refused while a recommendation request is still open', () => {
  const t = withRequest();
  assert.match(reason(stateOfTree(t)), /a recommendation request \(A1\) is still open: it ends before the decision is recorded/);
});

test('D2 fromRecommendation needs a root re-plan and a request of THIS stop that ended settled', () => {
  const t = withRequest();
  const from = { n: 2, adviceId: 'A1' };
  endAdvice(t.rootDir, { adviceId: 'A1', reason: 'declined' });
  assert.match(reason(stateOfTree(t), { fromRecommendation: from }), /A1 is not a recommendation request of this stop that was answered \(settled\)/, 'a declined request is not an answer');
  assert.match(reason(stateOfTree(t), { fromRecommendation: { n: 1, adviceId: 'nope' } }), /nope is not a recommendation request of this stop/);
  assert.match(reason(stateOfTree(t), { fromRecommendation: from, replansRoot: false }), /only a root re-plan carries a recommendation/);
});

test('D3 with the request ended settled for this stop, neither rule refuses; a settled request of ANOTHER stop does', () => {
  const t = withRequest();
  endAdvice(t.rootDir, { adviceId: 'A1', reason: 'settled' });
  const s = stateOfTree(t);
  const r = reason(s, { fromRecommendation: { n: 1, adviceId: 'A1' } });
  assert.doesNotMatch(String(r), /recommendation request|only a root re-plan carries|was answered/, `later rows may still refuse for their own reasons: ${r}`);
  assert.match(reason(s, { fromRecommendation: { n: 1, adviceId: 'A1' }, stopId: 'S2' }) ?? '', /open stop|not a recommendation request of this stop/);
});
