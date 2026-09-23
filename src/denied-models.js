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
// Pre-release audit 2026-09-23 (GuardLayer #5): the `$` anchor let `openrouter/auto:nitro`,
// `:online`, `:floor` and `openrouter/auto/` through, and `@preset/<name>` (a server-side preset
// that picks the model) was not covered at all.
export const ROUTER_MODEL = /(^|\/)(auto|pareto-code)(?=$|[:/])|(^|[/:_-])router([/:_-]|$)|^@preset\//i;

// The request-body keys through which `extra` can choose or route the model. Pre-release audit
// 2026-09-23 (GuardLayer #2, HIGH): only extra.models and extra.plugins were checked, and the
// adapters spread extra last, so extra.model silently replaced the checked model. The adapters now
// spread extra first; this refuses a denied or router id under any of these keys as well, at any
// depth (e.g. OpenRouter's `provider: { order: [...] }`).
const EXTRA_ROUTING_KEYS = ['model', 'models', 'route', 'provider', 'plugins'];
function stringsIn(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => stringsIn(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => stringsIn(x, out));
  return out;
}

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
  const extra = seat.extra && typeof seat.extra === 'object' ? seat.extra : {};
  for (const key of EXTRA_ROUTING_KEYS) {
    if (key === 'models' || key === 'plugins') continue; // reported above, with their own wording
    for (const id of stringsIn(extra[key])) {
      if (DENIED_MODEL.test(id)) out.push(`extra.${key} "${id}" names a denied model (no xAI/Grok, no Kimi/Moonshot)`);
      else if (ROUTER_MODEL.test(id)) out.push(`extra.${key} "${id}" is a router id that could route to a denied model`);
    }
  }
  // extra.models/extra.plugins in any shape the checks above do not read: a models value that is
  // not an array, and every field of a plugin besides its `id`.
  const loose = [
    ...(Array.isArray(extra.models) ? [] : stringsIn(extra.models)),
    ...(Array.isArray(extra.plugins) ? extra.plugins.flatMap(p => stringsIn(p && typeof p === 'object' ? { ...p, id: undefined } : p)) : stringsIn(extra.plugins)),
  ];
  for (const id of loose) {
    if (DENIED_MODEL.test(id)) out.push(`extra "${id}" names a denied model (no xAI/Grok, no Kimi/Moonshot)`);
    else if (ROUTER_MODEL.test(id)) out.push(`extra "${id}" is a router id that could route to a denied model`);
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
