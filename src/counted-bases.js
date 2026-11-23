// 0.8.4 unit 6 (D11; plan A T6.2): the BASIS of a counted charge - what the amount stands for - in one leaf module so the writers (src/chain.js, src/superseded.js, src/spend-reservations.js, the usage-file writers) and the one reader
// (src/counted-spend.js) share the list without a cycle. A record carries `basis` as an additive string; a record from before 0.8.4 carries none and is read as "unlabelled" (never guessed from its `reason` text).
//   token_priced        THC's own count: the reply's tokens times the price row (a normal reply, a discarded thinking attempt). Not the provider's bill.
//   provider_usage      an error reply that carried a usage figure: charged at that figure.
//   typical_error       an error reply, or a 5xx answer, that carried no usage figure: charged at a typical cost for the call (src/cost.js typicalCallUsd). An estimate.
//   expected_retry      a failed attempt of a call that is asked again (a dropped connection): charged at the call's expected cost. An estimate.
//   reserved_unsettled  a reservation no settlement closed (the process ended with the call in flight): charged at its worst case. An estimate.
//   worst_case          an attempt charged at one attempt's worst case because no better figure exists (a reply whose usage cannot be read; a failure after the send with no typical figure). An estimate.
// `provider_cost` (plan A F3 (c)) is NOT a basis: the provider-reported figure is recorded beside THC's count and counted nowhere (units 1-2; his 03 Nov 2026 "records what was billed beside THC's own count").
export const BASES = Object.freeze(['token_priced', 'provider_usage', 'typical_error', 'expected_retry', 'reserved_unsettled', 'worst_case']);
export const ESTIMATED_BASES = Object.freeze(['typical_error', 'expected_retry', 'reserved_unsettled', 'worst_case']);
export const isBasis = v => typeof v === 'string' && BASES.includes(v);
/** `{ basis }` for a record or stage that carries a valid one, else `{}` (spread it into a record being written). */
export const basisField = o => (o && isBasis(o.basis) ? { basis: o.basis } : {});
