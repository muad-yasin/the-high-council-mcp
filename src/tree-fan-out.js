import { slotHeldBy } from './tree-transitions.js';
// 0.8.3 M7 apply, C2b-2: how many children of ONE split exist, for maxChildrenPerSplit. ONE definition for its three counters (admission at registration, the frontier screen, the limit stop's sibling count): two counters for one fact drift.
// A child of a split is a node registered under that frontier OR a slot of it filled by a finished run of an earlier plan (state.adopted); the adopted node's own registration names the OLD frontier, so counting registrations alone would leave the slot out.
// `pending`: children the caller is about to propose that the record does not hold yet (a preview before its approval): the reused slots the record does not hold yet, and for the screen the new children it admits.
export function fanOutOf(state, frontierKey, { pending = 0 } = {}) {
  const registered = [...state.nodes.values()].filter(n => n.frontierKey === frontierKey).length;
  // C2b-2 money fix-up 2: the children of THIS frontier's recorded preview whose slot a LIVE adoption holds - the `reused` slots it carries AND the slots held by another frontier's approval (a re-keyed second frontier shows them as not admitted). NOT the adoptions this frontier OWNS: the table lets one approved frontier carry a candidate's entry, so counting by owner left the slot out of every other frontier's width.
  const adopted = (state.frontiers?.get(frontierKey)?.children ?? []).filter(c => slotHeldBy(state, `${c.node}@g${c.generation}`) !== null).length;
  return registered + adopted + pending;
}
