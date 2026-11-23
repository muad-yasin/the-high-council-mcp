// The request-time PRICE PIN (0.8.3 A3a, Muad 18 Okt 2026: "1" = lock the price in the request; gate note Review/Build_0.8.3/m7/A3a_Price_Pin_Gate_Note.md, C&C PASS ON CONDITIONS).
// OpenRouter's `provider.max_price` is a FILTER ("To filter providers by price, specify the max_price field in the provider parameter ... the highest provider pricing you will accept";
// https://openrouter.ai/docs/guides/routing/provider-selection, read 2026-10-18). Every OpenRouter call carries a pin at the seat's table price, so the figure the spend cap projects with
// is the most such a call can be billed per token (a ceiling, not the bill: a host may be cheaper). What OpenRouter does when NO host is at or under the pin is documented nowhere;
// the one probe (18 Okt 2026, a pin of 0.01 on a model whose only host is 0.3/1.8) was refused with HTTP 404 "No endpoints found that satisfy the max price for this request".
//
// Contract (pure; no I/O):
//   pinnedExtra(seat, extra, size?) -> the `extra` a call SENDS (size = { promptTokens?, zeroRetention? }; zeroRetention is the list of allowed endpoint slugs: it adds provider.zdr = true and provider.only at the call, below): for an OpenRouter seat with a usable row, `extra` with provider.max_price = { prompt: row.in, completion: row.out } merged into any existing
//                               extra.provider (zdr, data_collection, order, only ... kept). A seat's own max_price wins field by field: a `prompt` or `completion` it set as a finite number above 0 is sent exactly as typed,
//                               every other key of it passes through, and a missing or malformed `prompt`/`completion` is filled from the row (A3a fix-up, C&C 18 Okt 2026: the cap prices both sides at the row, so
//                               both sides carry the filter). A complete pin of the seat's own is returned as it was typed, with the host block below added. Any other seat (not OpenRouter) is returned UNCHANGED. An OpenRouter seat whose
//                               `extra.provider` or `provider.max_price` is not a plain object THROWS PinRefused (never a pass-through without a pin); chain-lint's `invalid-price-pin` says it first (pinShapeProblem).
//                               It builds a new object; the seat and its `extra` are never written.
//                               HOST BLOCK (0.8.4, his decision 8 of 28 Okt 2026: "Please blacklist Open Inference from THC"): EVERY OpenRouter call, a user's own chain included and with no opt-out, carries "open-inference" in
//                               provider.ignore. The seat's own ignore entries are kept, in their order, with the slug added at the end unless that exact slug is already there; an entry is never removed. The block is merged FIRST, before every
//                               return below and before the host preference, so a preferred endpoint under open-inference is dropped from `order` (orderFor reads the ignore list). An OpenRouter seat whose `extra.provider.ignore` is present
//                               and is not a list of strings THROWS PinRefused (the block cannot be added to it: fail closed, nothing is sent); chain-lint's `invalid-provider-ignore` says it first (ignoreShapeProblem).
//                               HOST PREFERENCE (0.8.4 unit 3, src/provider-preference.js): BEFORE any of the returns below (a seat with a complete pin of its own is a seat too), an OpenRouter seat whose model has a row in the project's
//                               provider-preference.json and whose `extra.provider.order` is not set gets `provider.order` = those endpoint tags (minus any host its own `extra.provider.ignore` bans). A seat's own `order` always wins; `allow_fallbacks`
//                               and `only` are never written, so the rest of the hosts stay a fallback; with no file the request is the one it always was, byte for byte. The preference changes the order hosts are tried in, never the price.
//                               PER-CALL TIER (0.8.4 unit 2b; wired in unit 4d): the optional third argument { promptTokens } is the size of the prompt this call sends; given it, the limit is rateFor(provider, model, promptTokens) of src/price-table.js
//                               (an ABSENT size gives the base; a size that is passed but broken, NaN or null, prices at the dearest tier, so a caller that means "no size" passes undefined). invoke() (src/chain.js) passes the size of the call's system + user
//                               characters by the one formula in src/cost.js (promptTokensOfChars, ceil(chars / 4)), which is also the size the spend cap projects the same call with (worstCaseOf), so the pin and the projection are one tier per call.
//                               Whichever way OpenRouter compares max_price (a host's base or its tier price; its docs do not say), a long call pinned at its tier routes inside the projected ceiling or finds no host and is refused.
//   ownPinOf(seat)           -> { prompt?, completion? } from the seat's OWN extra.provider.max_price (finite numbers above 0 only), or null. cost.js's worstCaseOf prices a call at max(table row, own pin):
//                               a pin ABOVE the row raises the projection, a pin below never lowers it.
import { effectiveRow, rateFor } from './price-table.js';
import { orderFor } from './provider-preference.js';
import { OPEN_INFERENCE } from './host-block.js';

const above0 = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const plain = o => !!o && typeof o === 'object' && !Array.isArray(o);

export function ownPinOf(seat) {
  const p = seat?.extra?.provider?.max_price;
  if (!plain(p)) return null;
  const out = {};
  if (above0(p.prompt)) out.prompt = p.prompt;
  if (above0(p.completion)) out.completion = p.completion;
  return Object.keys(out).length ? out : null;
}

// The one place that says which shapes the pin cannot be built on: an OpenRouter seat whose extra.provider, or whose provider.max_price, is present and is not a plain object. Read by chain-lint
// (`invalid-price-pin`, before the run) and by pinnedExtra (the backstop at the call), so the two cannot disagree. Returns { field, got } or null.
export function pinShapeProblem(seat) {
  if (seat?.provider !== 'openrouter') return null;
  const p = seat.extra?.provider;
  if (p === undefined) return null;
  if (!plain(p)) return { field: 'extra.provider', got: p };
  if (p.max_price !== undefined && !plain(p.max_price)) return { field: 'extra.provider.max_price', got: p.max_price };
  return null;
}

// The slug OpenRouter's provider.ignore takes for the Open Inference host (the same slug plan-the-high-council carries in its own chain file). Matched exactly: nothing here shows OpenRouter treats a display name as the same entry.
export { OPEN_INFERENCE };

// The one place that says which shape the host block cannot be added to: an OpenRouter seat whose extra.provider.ignore is present and is not a list of strings. Read by chain-lint (`invalid-provider-ignore`, before the run) and by pinnedExtra (the backstop
// at the call). A non-object extra.provider is pinShapeProblem's to say. Returns { field, got } or null.
export function ignoreShapeProblem(seat) {
  if (seat?.provider !== 'openrouter') return null;
  const p = seat.extra?.provider;
  if (!plain(p) || p.ignore === undefined) return null;
  if (!Array.isArray(p.ignore) || p.ignore.some(x => typeof x !== 'string')) return { field: 'extra.provider.ignore', got: p.ignore };
  return null;
}

/** Every OpenRouter seat anywhere in a chain config, as { path, seat }. Walks the whole object rather than a fixed list of seat keys (like deniedSeatsOf in src/denied-models.js), so a seat under preflight.seats, descending.* or a key added later is still found. A seat's `extra` is not walked. */
export function openRouterSeatsOf(config) {
  const found = [];
  const walk = (node, path) => {
    if (!node || typeof node !== 'object') return;
    if (node.provider === 'openrouter') found.push({ path, seat: node });
    for (const [k, v] of Object.entries(node)) {
      if (k === 'extra') continue;
      walk(v, path ? `${path}.${k}` : k);
    }
  };
  walk(config, '');
  return found;
}

// The pin as this seat would carry it from the table, for the fix sentences: the seat's own row, or a plainly generic shape when the table has none.
export function pinExampleOf(seat) {
  const row = effectiveRow(seat?.provider, seat?.model);
  return row && above0(row.in) && above0(row.out) ? `{"prompt": ${row.in}, "completion": ${row.out}}` : '{"prompt": <dollars per million input tokens>, "completion": <dollars per million output tokens>}';
}

// controlFlow, like UnpricedSeat: no catch around an invoke() may turn it into an abstention. The wording is A-DRAFT (Builder A, 18 Okt 2026) for the later Fable pass.
export class PinRefused extends Error {
  constructor(seat, { field, got }) {
    const name = `${seat.provider}/${seat.model}`;
    // A-DRAFT (Builder D, 04 Nov 2026): the sentence for a malformed ignore list is new person-facing text for the one wording review.
    if (field === 'extra.provider.ignore') super(`${name}: ${field} must be a list of host names like ["open-inference"]; found ${JSON.stringify(got) ?? 'not a value'}. This program always asks OpenRouter to skip the Open Inference host and cannot add that to what you wrote, so this call was not sent. Make ${field} a list of host names, or remove it.`);
    else super(`${name}: ${field} must be an object like ${pinExampleOf(seat)}; found ${JSON.stringify(got) ?? 'not a value'}. The price limit cannot be built, so this call was not sent. Make ${field} an object, or remove it to use the table price.`);
    this.controlFlow = true;
    this.seat = name;
    this.field = field;
  }
}

// The host block: a copy of `extra` whose provider.ignore holds OPEN_INFERENCE (the seat's own entries first, in order). The same object back when the slug is already there.
function withHostBlock(extra) {
  const base = plain(extra) ? extra : {};
  const own = Array.isArray(base.provider?.ignore) ? base.provider.ignore : [];
  if (own.includes(OPEN_INFERENCE)) return extra;
  return { ...base, provider: { ...(base.provider ?? {}), ignore: [...own, OPEN_INFERENCE] } };
}

function withPreference(seat, extra) {
  if (extra?.provider?.order !== undefined) return extra;                           // the seat's own order wins
  const order = orderFor({ ...seat, extra });
  if (!order) return extra;
  const base = plain(extra) ? extra : {};
  return { ...base, provider: { ...(base.provider ?? {}), order } };
}

// ZERO RETENTION (0.8.4, the optional setting; his answer 11 of 10 Nov 2026, C&C's ruling that "zero-retention only" means the REQUEST reaches no host that keeps a prompt): with the setting on, an OpenRouter call carries provider.zdr = true AND provider.only = the endpoint
// slugs the dated table (src/zdr-hosts.json) lists for the model as keeping nothing. `only` names the ALLOWED hosts, so a host that appears after the table's date is never used (fail closed); `zdr` stays beside it. Both are added HERE, at the call, and never into
// a config: a seat's `extra` is part of the cache fingerprint (src/cache-integrity.js), so a config that carried them would make every finished stage stale when the setting is switched at a resume. A seat's own `only` is narrowed to the hosts it names (a slug or a prefix
// of one); the Open Inference block (provider.ignore) and every other key are kept as they are. With no allowed host left the call is NOT sent (a ZeroRetentionNoHost, controlFlow: the start check names such a seat first, so this is the backstop; a seat whose own ignore bans every listed host is not named by the start check, this is where it is said). The hosts the seat's own provider.ignore bans are subtracted from the allowed list before the call is built.
// `hosts` is the allowed slug list, passed by invoke() in size.zeroRetention (src/chain.js: zdrAllowedHosts of src/zero-retention.js; this file imports none of it).
export class ZeroRetentionNoHost extends Error {
  constructor(seat) {
    super(`${seat.provider}/${seat.model}: zero retention is on, but none of the hosts that the list of zero-retention hosts names for this model is left for this call, so the call was not sent. Switch zero retention off to run this seat.`);      // A-DRAFT (wording row ZR-w6)
    this.controlFlow = true; this.seat = `${seat.provider}/${seat.model}`;
  }
}
function withZdr(seat, extra, hosts) {
  const base = plain(extra) ? extra : {};
  const own = base.provider?.only;
  const named = tag => own.some(e => typeof e === 'string' && (tag === e || tag.startsWith(`${e}/`)));
  // a host the seat's own provider.ignore bans is not allowed either (0.8.4 release chores, 11 Nov 2026, the MiMo/PrimaLabs ban): the same subtraction orderFor makes for `order`, so the request never names a host in `only` that it also names in `ignore`
  const ign = Array.isArray(base.provider?.ignore) ? base.provider.ignore.filter(g => typeof g === 'string') : [];
  const open = hosts.filter(tag => !ign.some(g => tag === g || tag.startsWith(`${g}/`)));
  const only = Array.isArray(own) ? open.filter(named) : [...open];
  if (only.length === 0) throw new ZeroRetentionNoHost(seat);
  return { ...base, provider: { ...(base.provider ?? {}), zdr: true, only } };
}

/** The price limit a seat is held to at its base price, USD per million tokens: its own complete pin, else its table row. null when the seat has no usable row (an unpriced seat: no pin). The start check of the zero-retention setting compares hosts' prices with it. */
export function basePinOf(seat) {
  if (seat?.provider !== 'openrouter') return null;
  const own = seat.extra?.provider?.max_price ?? {};
  const row = rateFor(seat.provider, seat.model, undefined);
  const prompt = above0(own.prompt) ? own.prompt : row?.in, completion = above0(own.completion) ? own.completion : row?.out;
  return above0(prompt) && above0(completion) ? { prompt, completion } : null;
}

export function pinnedExtra(seat, extra, size) {
  if (seat?.provider !== 'openrouter') return extra;
  const bad = pinShapeProblem({ ...seat, extra });
  if (bad) throw new PinRefused(seat, bad);
  const badIgnore = ignoreShapeProblem({ ...seat, extra });
  if (badIgnore) throw new PinRefused(seat, badIgnore);
  extra = withHostBlock(extra);                                                    // FIRST: before the preference (orderFor reads the ignore list) and before every early return below
  extra = withPreference(seat, extra);                                              // before every early return below
  if (Array.isArray(size?.zeroRetention)) extra = withZdr(seat, extra, size.zeroRetention);   // 0.8.4 zero retention: the run's setting, the allowed hosts passed by invoke(); before every early return below
  const row = rateFor(seat.provider, seat.model, size?.promptTokens);               // the shipped row merged with the project's own (a user row can only raise), at the tier THIS call's prompt reaches (0.8.4 unit 2b); with no size it is the base, as it always was
  if (!row || !above0(row.in) || !above0(row.out)) return extra;                    // no usable price: no pin (an unpriced seat is already refused under a cap)
  const own = extra?.provider?.max_price ?? {};
  if (above0(own.prompt) && above0(own.completion)) return extra;                   // a complete pin of the user's own: sent exactly as typed
  const base = plain(extra) ? extra : {};
  const max_price = { ...own, prompt: above0(own.prompt) ? own.prompt : row.in, completion: above0(own.completion) ? own.completion : row.out };
  return { ...base, provider: { ...(base.provider ?? {}), max_price } };
}
