// The request-time PRICE PIN (0.8.3 A3a, Muad 18 Okt 2026: "1" = lock the price in the request; gate note Review/Build_0.8.3/m7/A3a_Price_Pin_Gate_Note.md, C&C PASS ON CONDITIONS).
// OpenRouter's `provider.max_price` is a FILTER ("To filter providers by price, specify the max_price field in the provider parameter ... the highest provider pricing you will accept";
// https://openrouter.ai/docs/guides/routing/provider-selection, read 2026-10-18). Every OpenRouter call carries a pin at the seat's table price, so the figure the spend cap projects with
// is the most such a call can be billed per token (a ceiling, not the bill: a host may be cheaper). What OpenRouter does when NO host is at or under the pin is documented nowhere;
// the one probe (18 Okt 2026, a pin of 0.01 on a model whose only host is 0.3/1.8) was refused with HTTP 404 "No endpoints found that satisfy the max price for this request".
//
// Contract (pure; no I/O):
//   pinnedExtra(seat, extra) -> the `extra` a call SENDS: for an OpenRouter seat with a usable row, `extra` with provider.max_price = { prompt: row.in, completion: row.out } merged into any existing
//                               extra.provider (zdr, data_collection, order, only ... kept). A seat's own max_price wins field by field: a `prompt` or `completion` it set as a finite number above 0 is sent exactly as typed,
//                               every other key of it passes through, and a missing or malformed `prompt`/`completion` is filled from the row (A3a fix-up, C&C 18 Okt 2026: the cap prices both sides at the row, so
//                               both sides carry the filter). A complete pin is returned as the same object. Any other seat, or a seat with no usable row, is returned UNCHANGED. An OpenRouter seat whose
//                               `extra.provider` or `provider.max_price` is not a plain object THROWS PinRefused (never a pass-through without a pin); chain-lint's `invalid-price-pin` says it first (pinShapeProblem).
//                               It builds a new object; the seat and its `extra` are never written.
//   ownPinOf(seat)           -> { prompt?, completion? } from the seat's OWN extra.provider.max_price (finite numbers above 0 only), or null. cost.js's worstCaseOf prices a call at max(table row, own pin):
//                               a pin ABOVE the row raises the projection, a pin below never lowers it.
import { effectiveRow } from './price-table.js';

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

// The pin as this seat would carry it from the table, for the fix sentences: the seat's own row, or a plainly generic shape when the table has none.
export function pinExampleOf(seat) {
  const row = effectiveRow(seat?.provider, seat?.model);
  return row && above0(row.in) && above0(row.out) ? `{"prompt": ${row.in}, "completion": ${row.out}}` : '{"prompt": <dollars per million input tokens>, "completion": <dollars per million output tokens>}';
}

// controlFlow, like UnpricedSeat: no catch around an invoke() may turn it into an abstention. The wording is A-DRAFT (Builder A, 18 Okt 2026) for the later Fable pass.
export class PinRefused extends Error {
  constructor(seat, { field, got }) {
    const name = `${seat.provider}/${seat.model}`;
    super(`${name}: ${field} must be an object like ${pinExampleOf(seat)}; found ${JSON.stringify(got) ?? 'not a value'}. The price limit cannot be built, so this call was not sent. Make ${field} an object, or remove it to use the table price.`);
    this.controlFlow = true;
    this.seat = name;
    this.field = field;
  }
}

export function pinnedExtra(seat, extra) {
  if (seat?.provider !== 'openrouter') return extra;
  const bad = pinShapeProblem({ ...seat, extra });
  if (bad) throw new PinRefused(seat, bad);
  const row = effectiveRow(seat.provider, seat.model);                              // the shipped row merged with the project's own (a user row can only raise)
  if (!row || !above0(row.in) || !above0(row.out)) return extra;                    // no usable price: no pin (an unpriced seat is already refused under a cap)
  const own = extra?.provider?.max_price ?? {};
  if (above0(own.prompt) && above0(own.completion)) return extra;                   // a complete pin of the user's own: sent exactly as typed
  const base = plain(extra) ? extra : {};
  const max_price = { ...own, prompt: above0(own.prompt) ? own.prompt : row.in, completion: above0(own.completion) ? own.completion : row.out };
  return { ...base, provider: { ...(base.provider ?? {}), max_price } };
}
