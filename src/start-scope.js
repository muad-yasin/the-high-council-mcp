// What a paid start is, and what the person's typed limit is bound to (0.8.3 M6 typed cap T4a; typed-cap gate page sections 2 and 3, T4 start-path page sections 1 and 4; 14 Oct 2026). PURE: a chain and plain values in, a decision and a digest out; no file, no clock, no environment.
//
// Contract:
//   chainIsPaid(config) -> boolean      true when ANY seat slot of the chain is a provider that bills: not `mock`, not `external` (a person or another session answers), not a free local provider (ollama, `isFreeProvider`).
//                                       A mixed chain is paid. Asked once at the start of a run; a FREE-ONLY chain needs no typed limit, no prompt and no gate (page 2).
//   buildStartScope(parts) -> scope        the object the typed limit is bound to; the caller hashes it with capScopeSha256 (src/gate.js: this module imports no gate module, test/gate-answer.test.js R2)
//       parts = { taskSha256, contextSha256|null, chainSha256, seats: [{ role, provider, model }], policySha256|null, sensitivityFloor|null, piiMode|null, deliverableSha256?|null (T5b: omitted when absent), userPrices: [{ key, file_in, file_out, effective_in, effective_out }] }
//       capScopeSha256(scope) is the one digest the gate request and the consume both use.
//   user_prices (T4 page / price-row page section 9): for every seat of the chain whose price rests on the project's pricing.user.json, the raw row and the merged result; a row edited between the screen and the start is a changed screen. Shipped rows are NOT in it.
//   Every field is REQUIRED (null where there is genuinely none): a missing field throws, so a caller that forgot one cannot get a digest that silently covers less than the screen showed. Seat order is part of the scope. CEILINGS ARE NOT IN IT (C&C-pending default, 14 Oct 2026): the ceiling in force is bound in the gate's own `cap` fields and checked against the typed amount at answer time, and again at consume
//   (src/start-cap.js, against the CURRENT environment); a ceiling in the digest made an MCP-started run (ceiling from the plugin's settings) fail to consume an answer given and resumed in a terminal without that variable.
import { isFreeProvider } from './providers.js';
import { everySeatSlotsOf } from './chain.js';

const isPaidSeat = seat => !!seat && seat.provider !== 'mock' && seat.provider !== 'external' && !isFreeProvider(seat.provider);

export function chainIsPaid(config) {
  return everySeatSlotsOf(config).some(({ seat }) => isPaidSeat(seat));
}

const HEX64 = /^[0-9a-f]{64}$/;
const need = (cond, what) => { if (!cond) throw new TypeError(`start scope: ${what}`); };

export function buildStartScope(parts = {}) {
  const { taskSha256, contextSha256, chainSha256, seats, policySha256, sensitivityFloor, piiMode, userPrices, deliverableSha256 = null } = parts;
  need(HEX64.test(taskSha256 ?? ''), 'taskSha256 must be a sha256 hex digest');
  need(contextSha256 === null || HEX64.test(contextSha256 ?? ''), 'contextSha256 must be a sha256 hex digest or null');
  need(HEX64.test(chainSha256 ?? ''), 'chainSha256 must be a sha256 hex digest');
  need(Array.isArray(seats) && seats.every(s => s && typeof s.role === 'string' && typeof s.provider === 'string' && typeof s.model === 'string'), 'seats must be [{ role, provider, model }]');
  need(policySha256 === null || HEX64.test(policySha256 ?? ''), 'policySha256 must be a sha256 hex digest or null');
  need(sensitivityFloor === null || typeof sensitivityFloor === 'string', 'sensitivityFloor must be a string or null');
  need(piiMode === null || typeof piiMode === 'string', 'piiMode must be a string or null');
  need(deliverableSha256 === null || HEX64.test(deliverableSha256 ?? ''), 'deliverableSha256 must be a sha256 hex digest or null');
  need(Array.isArray(userPrices) && userPrices.every(r => r && typeof r.key === 'string' && r.key.includes('/') && [r.file_in, r.file_out, r.effective_in, r.effective_out].every(n => Number.isFinite(n) && n > 0)), 'userPrices must be [{ key, file_in, file_out, effective_in, effective_out }] (numbers above 0; [] when no seat rests on the project\'s price file)');
  const scope = {
    task_sha256: taskSha256, context_sha256: contextSha256, chain_sha256: chainSha256,
    seats: seats.map(s => ({ role: s.role, provider: s.provider, model: s.model })),
    policy_sha256: policySha256, sensitivity_floor: sensitivityFloor, pii_mode: piiMode,
    // T5b: OMITTED when absent (every start before it hashes exactly as it did): the draft a handoff / contract draft works from; a changed draft is an AMEND of the same logical run, not a new one.
    ...(deliverableSha256 !== null ? { deliverable_sha256: deliverableSha256 } : {}),
    // OMITTED when empty: a run with no user-priced seat hashes exactly as it did before the price row existed ("unused means unchanged"), so a T4a-era pending or consumed run is not re-asked or refused by an upgrade.
    ...(userPrices.length ? { user_prices: [...userPrices].map(r => ({ key: r.key, file_in: r.file_in, file_out: r.file_out, effective_in: r.effective_in, effective_out: r.effective_out })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)) } : {}),
  };
  return scope;
}

/**
 * Which inputs of a run differ between the scope its last limit was typed under and the scope now (T4b2: the amend screen NAMES them; "the scope differs" alone is a screen a person cannot judge). Pure.
 * -> [plain-words name] in a fixed order, [] when equal. A scope object that lacks a part reads as that part being absent (null / empty), so a missing `user_prices` key is the same as no user-priced seat.
 */
export function changedParts(before, after) {
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const parts = [['task_sha256', 'the task'], ['context_sha256', 'the context documents'], ['deliverable_sha256', 'the draft it works from'], ['chain_sha256', 'the chain file'], ['seats', 'the seats'], ['policy_sha256', 'the policy file'], ['sensitivity_floor', 'the sensitivity floor'], ['pii_mode', 'the personal-data check'], ['user_prices', 'a price row of the project\'s pricing.user.json']];
  return parts.filter(([k]) => !same(before?.[k], after?.[k])).map(([, name]) => name);
}
