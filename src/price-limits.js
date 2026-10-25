// A seat's PRICE LIMIT is the two numbers of its own `extra.provider.max_price` (`prompt`, `completion`): they filter which hosts OpenRouter may use by price (src/price-pin.js). They say nothing about what a
// finished stage said, so they are not part of what makes a cached stage stale (src/cache-integrity.js fingerprintInputs) and not part of what a tree's pinned chain protects beyond a person's say-so
// (src/tree-chain-limits.js). 0.8.3, Muad 23 Okt 2026 ("2: ii"): raising a seat's own limit keeps the finished stages, like raising a row in pricing.user.json always did.
//
// Contract (pure; no I/O):
//   priceLimitsOf(config)          -> [{ path, limits }]: every object that carries extra.provider.max_price.prompt and/or .completion, `path` = the keys from the config root (strings and array indexes), `limits` = those two
//                                     fields exactly as typed (any JSON value; a malformed one behaves as missing at the call, price-pin.js, so it is kept and shown as typed).
//   withoutPriceLimits(config)     -> the config with those two fields removed; the SAME object when there is none (so a config with no limit hashes byte-identically to before). Only what this removal emptied is
//                                     pruned (max_price, then extra.provider, then extra): raising, lowering, adding and removing a limit are one thing to the hash. Every other key stays: provider, model, caps, reasoning,
//                                     other provider keys (only, zdr ...), other max_price keys (request, image), prompts, roster.
//   withPriceLimits(config, snap)  -> a copy of `config` with each snapshot entry's limits put back at its path (a field the entry lacks is removed): the config as it was under the old limits.
//   limitFreeSha256Of(text)        -> sha256 of the canonical form of a chain FILE's text without its limits: two files with this hash equal differ in nothing but those numbers (and formatting).
import { sha256Of } from './thin-contract.js';

const plain = o => !!o && typeof o === 'object' && !Array.isArray(o);
const FIELDS = ['prompt', 'completion'];
const pinOf = o => (plain(o) && plain(o.extra) && plain(o.extra.provider) && plain(o.extra.provider.max_price) ? o.extra.provider.max_price : null);
const hasLimit = mp => !!mp && FIELDS.some(f => Object.hasOwn(mp, f));

export function priceLimitsOf(config) {
  const out = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) { node.forEach((v, i) => walk(v, [...path, i])); return; }
    if (!plain(node)) return;
    const mp = pinOf(node);
    if (hasLimit(mp)) out.push({ path, limits: Object.fromEntries(FIELDS.filter(f => Object.hasOwn(mp, f)).map(f => [f, mp[f]])) });
    for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
  };
  walk(config, []);
  return out;
}

export function withoutPriceLimits(config) {
  let found = false;
  const strip = node => {
    if (Array.isArray(node)) { let changed = false; const next = node.map(v => { const s = strip(v); if (s !== v) changed = true; return s; }); return changed ? next : node; }
    if (!plain(node)) return node;
    let changed = false; const next = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'extra' && hasLimit(pinOf(node))) { changed = true; found = true; const e = withoutOwn(v); if (e !== undefined) next[k] = e; continue; }
      const s = strip(v); if (s !== v) changed = true; next[k] = s;
    }
    return changed ? next : node;
  };
  const out = strip(config);
  return found ? out : config;
}

// `extra` without the two fields, pruning what this emptied (never a container that was already empty: this runs only where a limit exists, so max_price had a key)
function withoutOwn(extra) {
  const mp = { ...extra.provider.max_price }; for (const f of FIELDS) delete mp[f];
  const provider = { ...extra.provider };
  if (Object.keys(mp).length) provider.max_price = mp; else delete provider.max_price;
  const next = { ...extra };
  if (Object.keys(provider).length) next.provider = provider; else delete next.provider;
  return Object.keys(next).length ? next : undefined;
}

export function withPriceLimits(config, snapshot) {
  const copy = structuredClone(config);
  for (const { path, limits } of snapshot ?? []) {
    let node = copy; for (const k of path) node = node?.[k];
    if (!plain(node)) continue;
    node.extra = plain(node.extra) ? node.extra : {};
    node.extra.provider = plain(node.extra.provider) ? node.extra.provider : {};
    node.extra.provider.max_price = plain(node.extra.provider.max_price) ? node.extra.provider.max_price : {};
    for (const f of FIELDS) { if (Object.hasOwn(limits, f)) node.extra.provider.max_price[f] = limits[f]; else delete node.extra.provider.max_price[f]; }
    if (!Object.keys(node.extra.provider.max_price).length) delete node.extra.provider.max_price;
    if (!Object.keys(node.extra.provider).length) delete node.extra.provider;
    if (!Object.keys(node.extra).length) delete node.extra;
  }
  return copy;
}

export const limitFreeSha256Of = text => sha256Of(JSON.stringify(withoutPriceLimits(JSON.parse(text))));
