// E4b unit one (gate page Review/Build_0.8.3/m6-closing/E4b_Gate_Page.md; rule R, the dated amendment of contract section 13 #10): the pure detector of the alternating objection.
// Nothing calls it yet. No imports: it reads plain data only, so no path can reach roles.js or the clock.
//
// RULE R (exact; no model decides what is "the same"): lab A (layer k) raised id X in round a; in a later round b lab A WAS ASKED and X is absent from A's failures AFTER the carry
// (a withdrawn X is silent; a sustained X is carried into the failures and is NOT silent); in the first later round c lab A raises X again as its OWN raise (not a carried one);
// and between b and c (rounds b..c-1) a revise was made for an objection of a layer other than k. Paraphrase with another quote is another id and is not caught.
//
// Input (all plain data; a missing or malformed part reads as "no conflict", never as an error):
//   round         the round whose failures are being checked (c)
//   failuresByRound  [{ round, failures: [{ lab, id, carried_from_round? }] }]   the failures of each round AFTER the carry (own and carried), as chain.js folds them
//   heardByRound  { [round]: [lab, ...] }   the labs whose verdict of that round was read
//   layerOf       { [lab]: layer }
//   revisedRounds [round, ...]            the rounds that ended in a revise (the last round never does)
// Output: [] or [{ round, lab, layer, id, first_round (a), silent_round (b), other: [{ id, lab, layer, round }] }], sorted by lab, then id (code-unit order, locale-free).
const byCode = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const isNum = n => Number.isFinite(n);
const failuresOf = r => (Array.isArray(r?.failures) ? r.failures : []).filter(f => f && typeof f.lab === 'string' && f.lab && typeof f.id === 'string' && f.id);
const carriedFailure = f => isNum(f.carried_from_round);

export function findConflict({ round, failuresByRound = [], heardByRound = {}, layerOf = {}, revisedRounds = [] } = {}) {
  if (!isNum(round) || !Array.isArray(failuresByRound)) return [];
  const rounds = new Map(); // round -> its clean failure list
  for (const r of failuresByRound) if (isNum(r?.round)) rounds.set(r.round, failuresOf(r));
  const revised = new Set((Array.isArray(revisedRounds) ? revisedRounds : []).filter(isNum));
  const heard = (rd, lab) => Array.isArray(heardByRound?.[rd]) && heardByRound[rd].includes(lab);
  const appears = (rd, lab, id) => (rounds.get(rd) || []).some(f => f.lab === lab && f.id === id); // own or carried: present after the carry
  const found = [];
  const seen = new Set();
  for (const f of rounds.get(round) || []) {
    if (carriedFailure(f)) continue; // a carried restatement is no re-raise
    const key = `${f.lab}\u0000${f.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const layer = layerOf?.[f.lab];
    if (!isNum(layer)) continue;
    // p = the latest earlier round in which the id appeared (own or carried); b = the EARLIEST round after p in which the lab was heard (the id is absent in every round after p by the choice of p),
    // so every revise since the lab let the id go is inside the window b..c-1; a = the round the id was raised in (a carried appearance reports the round it was carried from).
    let p = null;
    for (let t = round - 1; t >= 1; t--) if (appears(t, f.lab, f.id)) { p = t; break; }
    if (p === null) continue;
    const mine = (rounds.get(p) || []).find(x => x.lab === f.lab && x.id === f.id);
    const a = carriedFailure(mine) ? mine.carried_from_round : p;
    let b = null;
    for (let t = p + 1; t < round; t++) if (heard(t, f.lab)) { b = t; break; }
    if (b === null) continue;
    // a revise between b and c for an objection of another layer
    const other = [];
    for (let t = b; t < round; t++) {
      if (!revised.has(t)) continue;
      for (const g of rounds.get(t) || []) {
        const gl = layerOf?.[g.lab];
        if (isNum(gl) && gl !== layer) other.push({ id: g.id, lab: g.lab, layer: gl, round: t });
      }
    }
    if (!other.length) continue;
    const uniq = [...new Map(other.map(o => [`${o.lab}\u0000${o.id}\u0000${o.round}`, o])).values()].sort((x, y) => x.round - y.round || byCode(x.lab, y.lab) || byCode(x.id, y.id));
    found.push({ round, lab: f.lab, layer, id: f.id, first_round: a, silent_round: b, other: uniq });
  }
  return found.sort((x, y) => byCode(x.lab, y.lab) || byCode(x.id, y.id));
}
