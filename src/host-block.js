// The OPEN INFERENCE HOST BLOCK, the part that has to be pure and cheap to import (0.8.4, Muad's decision 8 of 28 Okt 2026: "Please blacklist Open Inference from THC"). Every OpenRouter call asks OpenRouter to skip that host
// (src/price-pin.js adds the slug to provider.ignore at the call, whatever a chain says), so a chain file's own entry changes nothing a finished stage said: it is not part of what makes a cached stage stale
// (src/cache-integrity.js fingerprintInputs), exactly like the two numbers of a seat's own price limit (src/price-limits.js).
//
// Contract (pure; no I/O):
//   OPEN_INFERENCE             the slug, 'open-inference' (OpenRouter's docs: provider.ignore takes provider slugs; the endpoint tags read open-inference/<variant>).
//   withoutHostBlock(config)   -> the config with that exact slug removed from every OpenRouter seat's extra.provider.ignore; the SAME object when there is none (a config without the entry hashes byte-identically to before).
//                                 Only what this removal emptied is pruned (ignore, then extra.provider, then extra); a seat's other ignore entries, an ignore list that was already empty, `only`/`order` entries naming the slug, and
//                                 an entry on a seat of another provider all stay, so any edit but the slug itself still changes the hash.
export const OPEN_INFERENCE = 'open-inference';

const plain = o => !!o && typeof o === 'object' && !Array.isArray(o);
const blocked = node => node.provider === 'openrouter' && plain(node.extra) && plain(node.extra.provider) && Array.isArray(node.extra.provider.ignore) && node.extra.provider.ignore.includes(OPEN_INFERENCE);

export function withoutHostBlock(config) {
  let found = false;
  const strip = node => {
    if (Array.isArray(node)) { let changed = false; const next = node.map(v => { const s = strip(v); if (s !== v) changed = true; return s; }); return changed ? next : node; }
    if (!plain(node)) return node;
    let changed = false; const next = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === 'extra' && blocked(node)) { changed = true; found = true; const e = withoutSlug(v); if (e !== undefined) next[k] = e; continue; }
      const s = strip(v); if (s !== v) changed = true; next[k] = s;
    }
    return changed ? next : node;
  };
  const out = strip(config);
  return found ? out : config;
}

// `extra` without the slug, pruning what this emptied
function withoutSlug(extra) {
  const ignore = extra.provider.ignore.filter(x => x !== OPEN_INFERENCE);
  const provider = { ...extra.provider };
  if (ignore.length) provider.ignore = ignore; else delete provider.ignore;
  const next = { ...extra };
  if (Object.keys(provider).length) next.provider = provider; else delete next.provider;
  return Object.keys(next).length ? next : undefined;
}
