// 0.8.4 S16 (Q9(f), route 4; T21n, T21ba, T21bn, T21bo, T21bq, T21ce, T21cf, NEW-A13-1): the ROOM of a layer-3 seat in the final read and the PARTS of a list that does not fit it. Pure: no model call, no I/O.
// The room is an input (chain.js `finalReadRoomsOf`); nothing here is read for a seat whose room is not given, so a run without one is byte-identical to what it was.

const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** The rating an item stands at for the ORDER: its number, or the highest when unrated (the ledger's own rule, objection-ledger.js fitOpenRows: an unrated row reads as 4 or above and is never put after a rated one). */
export const orderRank = it => (typeof it?.rating === 'number' && Number.isFinite(it.rating) ? it.rating : Infinity);

/** The plan's own order (Q9(f)): the highest rating first, then the oldest (`first_round`), then the id. Returns a new array. */
export function orderForParts(items) {
  return [...(items || [])].sort((a, b) => {
    const ra = orderRank(a), rb = orderRank(b);
    return (ra === rb ? 0 : rb > ra ? 1 : -1) || (a.first_round ?? 0) - (b.first_round ?? 0) || byCode(String(a.id), String(b.id));
  });
}

/**
 * Pack the items, in order, into parts whole rows at a time. `fits(partItems)` says whether a part with those items fits the room (the caller measures the PRINTED list). Greedy, in order: a part takes the next row while it fits.
 * -> { parts: [[item...], ...], oversize: item | null }. `oversize` is the first row that does not fit a part alone (no part can hold it: the seat is not called for it, T21cf); then `parts` is [].
 */
export function packParts(items, fits) {
  const parts = []; let current = [];
  for (const it of items || []) {
    if (fits([...current, it])) { current.push(it); continue; }
    if (!current.length) return { parts: [], oversize: it };
    parts.push(current); current = [it];
    if (!fits(current)) return { parts: [], oversize: it };
  }
  if (current.length) parts.push(current);
  return { parts, oversize: null };
}

/** Cp (Part 0, T21bp): the calls of the extra parts of ONE read, 2 x K3 x (p_L - 1): each layer-3 seat asks once more per extra part, and once more again when the reply is unreadable. Pure; 0 for one part. */
export const extraPartCalls = (K3, pL) => 2 * K3 * Math.max(0, (Number.isInteger(pL) ? pL : 1) - 1);
