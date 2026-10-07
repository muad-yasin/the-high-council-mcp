// Which seats of a chain have no price, for the spend cap to refuse (0.8.2 item 8a; ChatGPT review 1 #4a; owner, 7 Oct 2026: "build it tonight"). Pure: it reads the chain and pricing.json, calls nothing.
// An unpriced seat projects $0, so a cap could not stop what a call to it costs. Under a cap the harness refuses such a seat before anything is sent (the run's start; invoke() is the backstop for any call that
// reaches it some other way). mock, external and the free local provider (ollama) are exempt: see needsPrice in src/cost.js.
import { needsPrice } from './cost.js';
import { everySeatSlotsOf } from './chain.js';

/** -> [{ provider, model, roles: 'critics[0], builder' }] one entry per distinct provider/model that needs a price and has none. */
export function unpricedSeats(config) {
  const found = new Map();
  for (const { role, seat } of everySeatSlotsOf(config)) {
    if (!needsPrice(seat)) continue;
    const key = `${seat.provider}/${seat.model}`;
    const e = found.get(key) ?? { provider: seat.provider, model: seat.model, roles: [] };
    e.roles.push(role);
    found.set(key, e);
  }
  return [...found.values()].map(e => ({ ...e, roles: e.roles.join(', ') }));
}
