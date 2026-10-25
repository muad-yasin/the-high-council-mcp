// The reader of the `split_changed` refusals (0.8.3 M6 S0 b): a pure read of the record, for `council tree status` (S6). There are TWO refusals with this check word and they answer differently:
//   (A) the FRONTIER path (tree-loop.js registration, tree-frontier.js describeFrontier): the approval showed split X and the plan now holds Y. The `blocked` record carries the frontierKey, REOPEN_CHECKS includes
//       it, and a NEW APPROVAL is the remedy: it is listed while frontierReopened says the frontier is waiting for one.
//   (C) `council tree approve` (tree-approve.js) records the refusal describeFrontier gives at item 3 - the same wording as (A), but with the node as scope and no frontierKey: the record names another verified split than
//       the plan holds. An approval IS pending there and cannot go on; it is neither (A) (nothing was approved) nor (B) (it says nothing of a first verification standing).
//   (B) verifySplit (tree-expansion.js, M5f (a)): a node@generation that already holds its ONE split_verified was verified again against another plan. The record is `blocked`, reason expansion_refused, transition
//       `expansion`, scope `node@gN`, NO frontierKey: it reopens nothing and no approval is waiting on it. It is keyed on node+generation (the scope); the first verification stands.
// The record is unchanged: nothing here writes. The two short hashes come out of the stored `detail` (the sentences tree-loop.js, tree-frontier.js and tree-expansion.js write); a detail that does not read that way
// still lists the item, without hashes.
import { frontierReopened } from './tree-frontier.js';

const SCOPE = /^(.+)@g(\d+)$/;
const verifiedWords = /was verified with split ([0-9a-f]{12})[^]*its plan now reads as ([0-9a-f]{12})/;
const frontierWords = /the verified split ([0-9a-f]{12}) is not the block now in the plan \(([0-9a-f]{12})\)/;

/** -> [{ kind: 'verified' | 'approve_refused', node, generation, verified, now }, { kind: 'frontier', frontierKey, scope, verified, now }]: (B), then (C), each in path order, then (A); `verified` / `now` are short hashes or null. */
export function splitChangedOf(record) {
  const refusals = record.events.filter(e => e.event === 'blocked' && e.reason === 'expansion_refused' && e.check === 'split_changed');
  const fromB = new Map(); const fromA = new Map();
  const fromC = new Map();
  for (const e of refusals) {
    if (typeof e.frontierKey === 'string') { fromA.set(e.frontierKey, e); continue; }
    if (e.transition !== 'expansion' || !SCOPE.test(String(e.scope))) continue;
    (frontierWords.test(String(e.detail)) ? fromC : fromB).set(e.scope, e);
  }
  const out = [];
  for (const [scope, e] of [...fromB].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [, node, generation] = SCOPE.exec(scope);
    const m = verifiedWords.exec(String(e.detail));
    out.push({ kind: 'verified', node, generation: Number(generation), verified: m?.[1] ?? null, now: m?.[2] ?? null });
  }
  for (const [scope, e] of [...fromC].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [, node, generation] = SCOPE.exec(scope);
    const m = frontierWords.exec(String(e.detail));
    out.push({ kind: 'approve_refused', node, generation: Number(generation), verified: m?.[1] ?? null, now: m?.[2] ?? null });
  }
  for (const [frontierKey, e] of fromA) {
    if (!frontierReopened(record, frontierKey)) continue;
    const m = frontierWords.exec(String(e.detail));
    out.push({ kind: 'frontier', frontierKey, scope: e.scope ?? null, verified: m?.[1] ?? null, now: m?.[2] ?? null });
  }
  return out;
}
