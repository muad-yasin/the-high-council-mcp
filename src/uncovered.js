// Which caps a chain is asked for, and which of its seats no enabled cap covers (0.8.4 DUALCAP; the contract is src/caps.js). Pure: it reads the chain and
// calls nothing. The input is the RESOLVED roster (resolveChainSeats; src/cli.js resolves before any check), so a seat rerouted through a vendor counts
// against that vendor's cap. Every seat slot is read through everySeatSlotsOf (preflight seats and the default security reviewer included): the walker the
// unpriced refusal (src/unpriced.js) uses, so the two refusals can never see different rosters.
import { everySeatSlotsOf } from './chain.js';
import { billingAccountOf, seatBillingRefusal, capCeilingName, readCapCeiling, capsUncoveredSentence, capsCeilingMissingSentence, capsRunWideSentence } from './caps.js';

/** -> the sorted ids of the enabled caps (`caps`: parseCapsSetting's answer) that at least one seat bills through. [] when the switch is OFF (no caps) or nothing bills. */
export function capsInForce(config, caps) {
  const on = new Set(caps ?? []);
  const found = new Set();
  for (const { seat } of everySeatSlotsOf(config)) {
    const account = billingAccountOf(seat);
    if (account && on.has(account)) found.add(account);
  }
  return [...found].sort();
}

/**
 * -> [{ account, provider, model, roles: 'critics[0], critics[2]' }]: one entry per account and provider/model whose account no enabled cap covers, in roster
 * order. [] when the switch is OFF: the one typed limit counts every seat.
 */
export function uncoveredSeats(config, caps) {
  if (!caps?.length) return [];
  const on = new Set(caps);
  const found = new Map();
  for (const { role, seat } of everySeatSlotsOf(config)) {
    const account = billingAccountOf(seat);
    if (!account || on.has(account)) continue;
    const key = `${account} ${seat.provider}/${seat.model}`;
    const entry = found.get(key) ?? { account, provider: seat.provider, model: seat.model, roles: [] };
    entry.roles.push(role);
    found.set(key, entry);
  }
  return [...found.values()].map(e => ({ ...e, roles: e.roles.join(', ') }));
}

/**
 * The start refusals of a chain (unit 3b; the contract and the order are src/caps.js "THE START REFUSALS"): [{ code, exit, sentence }], in the order a start meets
 * them. A seat that is not mock carrying mockBills, WHATEVER the switch says (one entry per distinct sentence, exit 2); with caps on (`caps`: parseCapsSetting's
 * answer): the seats no enabled cap covers (one entry, exit 5); then, when at least one cap is in force: a COUNCIL_MAX_USD_LIMIT that is set but cannot be read
 * (`limitUnreadable`, its sentence: it used to read as absent and skip option B; unit 4b2), option B when the main limit is set (`limitUsd`, src/cli.js
 * readUsdCeiling): the caps in force with no ceiling of their own (one entry, exit 2), the caps in force whose own ceiling cannot be read WHATEVER the main limit
 * says (one entry, exit 2; unit 4b2), and last a run-wide figure that cannot act under the switch (`runWide`: 'flag' | 'environment' | 'project-env', Q1, one
 * entry, exit 2; unit 4b2). A chain with no cap in force meets none of those (today's path). [] when nothing refuses. Pure, given `ceilingOf`.
 */
export function capsStartRefusals(config, caps = [], { limitUsd = null, limitUnreadable = null, runWide = null, ceilingOf = id => readCapCeiling(id) } = {}) {
  const out = [];
  const seen = new Set();
  for (const { seat } of everySeatSlotsOf(config)) {
    const refusal = seatBillingRefusal(seat);
    if (refusal && !seen.has(refusal.sentence)) { seen.add(refusal.sentence); out.push({ code: refusal.code, exit: 2, sentence: refusal.sentence }); }
  }
  if (!caps?.length) return out;
  const uncovered = uncoveredSeats(config, caps);
  if (uncovered.length) out.push({ code: 'uncovered_seats', exit: 5, sentence: capsUncoveredSentence(uncovered, caps) });
  const inForce = capsInForce(config, caps);
  if (!inForce.length) return out;
  if (limitUnreadable) out.push({ code: 'usd_limit_unreadable', exit: 2, sentence: limitUnreadable });
  const limitSet = limitUsd !== null && limitUsd !== undefined;
  const missing = [];
  const unreadable = [];
  for (const id of inForce) {
    const ceiling = ceilingOf(id);
    if (ceiling?.unreadable) unreadable.push(ceiling.unreadable);
    else if (limitSet && (ceiling?.usd === null || ceiling?.usd === undefined)) missing.push(capCeilingName(id));
  }
  if (missing.length) out.push({ code: 'cap_ceiling_missing', exit: 2, sentence: capsCeilingMissingSentence(missing, caps) });
  if (unreadable.length) out.push({ code: 'cap_ceiling_unreadable', exit: 2, sentence: `${unreadable.join(' ')} Nothing was started.` });
  if (runWide) out.push({ code: 'max_usd_refused', exit: 2, sentence: capsRunWideSentence(runWide, caps) });
  return out;
}
