// Models this harness will never seat - a standing owner decision, not a quality judgement.
//
// 2026-09-23, Muad: "Drop grok drop Kimi k3", then "No grok, ever!!!" (recorded in the owner's
// board; context in Review/BugAudit_GuardLayer_2026-09-23.md #4). There is deliberately no opt-out
// flag. A router id is denied too: a seat whose model is chosen at request time (openrouter/auto,
// the Pareto Code router, any *-router plugin) can route to a denied model without the chain ever
// naming one, so it cannot be shown to comply.
//
// Enforced twice: chain-lint's `denied-model` rule (a hard error before any metered call) and
// runChain()/invoke() at run time, so a user-written chain, a resumed run (lint is skipped on
// --resume) or a direct runChain() caller cannot get past it either.

export const DENIED_MODEL = /grok|x-ai|\bxai\b|kimi|moonshot/i;
// `openrouter/auto`, `.../pareto-code`, and any id or plugin naming a router ("pareto-router",
// "auto-router"). "openrouter" itself is a provider name and does not match: the router word must
// start the id or follow a separator.
export const ROUTER_MODEL = /(^|\/)(auto|pareto-code)$|(^|[/:_-])router([/:_-]|$)/i;

function reasonsForSeat(seat) {
  const out = [];
  const ids = [
    ['provider', seat.provider],
    ['model', seat.model],
    ...(Array.isArray(seat.extra?.models) ? seat.extra.models.map(m => ['extra.models', m]) : []),
  ].filter(([, v]) => typeof v === 'string');
  for (const [field, id] of ids) {
    if (DENIED_MODEL.test(id)) out.push(`${field} "${id}" is a denied model (no xAI/Grok, no Kimi/Moonshot)`);
    else if (field !== 'provider' && ROUTER_MODEL.test(id)) out.push(`${field} "${id}" is a router id that could route to a denied model`);
  }
  for (const plugin of Array.isArray(seat.extra?.plugins) ? seat.extra.plugins : []) {
    const id = plugin?.id;
    if (typeof id === 'string' && (ROUTER_MODEL.test(id) || DENIED_MODEL.test(id))) out.push(`extra.plugins id "${id}" is a router that could route to a denied model`);
  }
  return out;
}

/** The reason(s) a single seat is denied; empty when it is allowed. */
export function deniedReasonsOf(seat) {
  return seat && typeof seat === 'object' ? reasonsForSeat(seat) : [];
}

/**
 * Every denied seat anywhere in a chain config, as `{ path, reasons }`. Walks the whole object
 * rather than a fixed list of seat keys, so a seat under preflight.seats, descending.* or a key
 * added later is still found.
 */
export function deniedSeatsOf(config) {
  const found = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.provider === 'string' && 'model' in node) {
      const reasons = reasonsForSeat(node);
      if (reasons.length) found.push({ path, reasons });
    }
    for (const [k, v] of Object.entries(node)) {
      if (k === 'extra') continue; // a seat's extra is judged as part of that seat, above
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(config, '');
  return found;
}

export class DeniedModel extends Error {
  constructor(found) {
    super(`this chain seats a denied model, which this harness never calls:\n${found.map(f => `  - ${f.path}: ${f.reasons.join('; ')}`).join('\n')}`);
    this.found = found;
    // Control flow, not a seat being down: no catch may turn it into an abstention.
    this.controlFlow = true;
  }
}

export function assertNoDeniedModels(config) {
  const found = deniedSeatsOf(config);
  if (found.length) throw new DeniedModel(found);
}
