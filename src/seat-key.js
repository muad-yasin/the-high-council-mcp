// The SEAT KEY (lab-identity unit, 19 Okt 2026; Muad 18 Okt 21:08 "a same model in separate seats is ONE lab"; C&C rulings Q1, D1-D3). Two keys, two jobs:
//   labOf(seat)      the INDEPENDENCE key (seat.lab || seat.provider): what a lab COUNT counts. Unchanged.
//   seatKeyOf(seat)  the IDENTITY key: what a stage label, a cache key and a per-seat record are built from. It equals labOf(seat) for every seat except one case: the SAME model repeated in a LAYERED critics panel,
//                    on different layers or (0.8.4, seats unit) twice on one layer. There the first seat on the LOWEST layer keeps the bare lab string, the first seat on every other layer is `<lab>-l<layer>` (what a chain
//                    author used to write by hand as a lab suffix: a chain that kept those suffixes gets byte-identical stage labels), and a second, third ... seat of the SAME layer is `<lab>-l<layer>-<n>` (n = 2, 3 ...,
//                    in the order the chain file lists them). Chains with no repeated model: no seat is registered, the key IS the lab string, nothing moves; a chain with one model once per layer gets the keys it always got.
// Only a layered critics panel may repeat a lab (Q1): repeatedModelKeys() is the ONE test the lints and the run-time check share. Registration is per seat OBJECT (a WeakMap), done once per run by registerSeatKeys().
// Two seats of one model share ONE lab for every count and still never share a stage label, a cache entry, a record, a persona key or an objection id: each has its own seat key.
import { labOf, seatIdentity } from './stage-system.js';

const SEAT_KEYS = new WeakMap();
export const seatKeyOf = seat => SEAT_KEYS.get(seat) ?? labOf(seat);
/** The extra field a record carries for a repeated seat: { seat: key } when the key differs from the lab, else nothing (so unique-lab reports stay byte-identical). */
export const seatField = seat => (seatKeyOf(seat) !== labOf(seat) ? { seat: seatKeyOf(seat) } : {});

/**
 * The seats of ONE lab in a critics panel -> Map(seat -> key) when the repeat is the allowed one (every seat the same model by seatIdentity, a whole-number layer each, no key equal to another lab in the panel), else null. Seats may share a layer (0.8.4).
 */
export function repeatedModelKeys(seats, allLabs = []) {
  const group = seats.filter(Boolean);
  if (group.length < 2) return null;
  // the same model: by seatIdentity (a real model, or an external seat's declared session/model). A mock seat has none by design (mock chains reuse names on purpose), so for a REPEAT only - the same lab string AND different layers are already required - the mock model string is the identity, which lets the offline tests run the machinery.
  const idOf = s => seatIdentity(s) ?? (s.provider === 'mock' && s.model ? `mock:${s.model}` : null);
  const ids = new Set(group.map(idOf));
  if (ids.size !== 1 || ids.has(null)) return null;
  const layers = group.map(s => s.layer);
  if (!layers.every(Number.isInteger)) return null;
  const lab = labOf(group[0]);
  const sorted = [...group].sort((a, b) => a.layer - b.layer);   // a stable sort: seats of one layer keep the order of the chain file
  const nth = new Map();   // layer -> how many seats of this layer came before
  const keys = new Map(sorted.map((s, i) => {
    const k = (nth.get(s.layer) ?? 0) + 1; nth.set(s.layer, k);
    return [s, i === 0 ? lab : k === 1 ? `${lab}-l${s.layer}` : `${lab}-l${s.layer}-${k}`];
  }));
  const taken = new Set(allLabs);
  for (const k of [...keys.values()].slice(1)) if (taken.has(k)) return null;
  return keys;
}

/** The labs repeated in a critics list, each with its key map or null: { lab, seats, keys }[]. */
export function repeatedLabsOf(critics) {
  const list = (critics || []).filter(Boolean);
  const labs = list.map(labOf);
  return [...new Set(labs.filter((l, i) => labs.indexOf(l) !== i))].map(lab => {
    const seats = list.filter(s => labOf(s) === lab);
    return { lab, seats, keys: repeatedModelKeys(seats, labs.filter(l => l !== lab)) };
  });
}

/** Seat -> its place among the seats of the SAME model on the SAME layer (1, 2, 3 ...), for every seat of an allowed repeat; a seat that is not part of one is absent. Pure (no registration): the dry run's row labels read it, so two seats of one model on one layer never share a row. */
export function sameLayerOrdinals(critics) {
  const out = new Map();
  for (const r of repeatedLabsOf(critics)) if (r.keys) {
    const seen = new Map();
    for (const s of r.seats) { const k = (seen.get(s.layer) ?? 0) + 1; seen.set(s.layer, k); out.set(s, k); }
  }
  return out;
}

const REPEATED_IDS = new Map();   // lab -> the model identity of every ALLOWED repeat of the registered config (cleared with KEY_INFO)
const identityOf = s => seatIdentity(s) ?? (s.provider === 'mock' && s.model ? `mock:${s.model}` : null);
const KEY_INFO = new Map();   // key -> { lab, layer } for every seat of an allowed repeat (cleared by every registerSeatKeys, so a run with no repeat shows nothing of an earlier one)
/** What a person or a model is SHOWN for a record's `lab` value: the bare lab, never the internal seat key. A value that is no registered key comes back as it is. */
export const labFromKey = key => KEY_INFO.get(key)?.lab ?? key;
/** " (layer N)" for a seat of an allowed repeat (the same model on more than one layer), else ""; the reviser's "Raised by" line adds it. */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
// A-DRAFT (same-layer twins): the note names the seat's place among the seats of ITS model on ITS layer, and only for a seat that has such a twin; every other note reads as before.
const noteOf = info => ` (layer ${info.layer}${info.nth ? `, the model's ${ORDINALS[info.nth - 1] ?? `${info.nth}th`} seat on this layer` : ''})`;
export const layerNoteOf = key => (KEY_INFO.has(key) ? noteOf(KEY_INFO.get(key)) : '');
/** How a seat is NAMED in text a person reads: the bare lab, plus " (layer N)" for a seat of an allowed repeat. */
export const shownSeat = seat => `${labOf(seat)}${SEAT_KEYS.has(seat) ? noteOf({ layer: seat.layer, nth: KEY_INFO.get(SEAT_KEYS.get(seat))?.nth ?? null }) : ''}`;
/** THE GUARD: a seat with a layer, of a model that sits more than once in the registered panel, must reach a call WITH its seat key. A copy made with a plain spread has none (the key lives in a WeakMap on the seat object) and would be recorded under the first seat of its lab, silently. Throws loudly instead; keepSeatKey is the fix at the copy. A proposer or a writer seat of the same lab has no layer and is never caught. */
export function assertSeatKeyed(seat) {
  if (!seat || SEAT_KEYS.has(seat) || !Number.isInteger(seat.layer)) return;
  const id = REPEATED_IDS.get(labOf(seat));
  if (id !== undefined && identityOf(seat) === id) {
    const err = new Error(`internal error: a seat of the repeated model "${labOf(seat)}" (layer ${seat.layer}) reached a call without its seat key; a copy of a seat must keep it (keepSeatKey in src/seat-key.js)`);
    err.controlFlow = true;   // never turned into an abstention by a stage's catch (rethrowControlFlow in src/chain.js): the run fails loudly
    throw err;
  }
}
/** A copy of a seat (a spread, e.g. a lower output cap for one call) carries the original's seat key: the key lives in a WeakMap on the seat object, so a plain copy would read as the first seat of its lab. Returns the copy. */
export const keepSeatKey = (from, copy) => { if (SEAT_KEYS.has(from)) SEAT_KEYS.set(copy, SEAT_KEYS.get(from)); return copy; };
/** A seat KEY as a person reads it: the bare lab plus the layer note (and, for a same-layer twin, which seat of the model it is). A value that is no registered key comes back as it is. */
export const shownKey = key => `${labFromKey(key)}${layerNoteOf(key)}`;
/** The key a record stands for: its `seat` field when it has one (a repeated seat), else its lab. */
export const keyOfRecord = r => r?.seat ?? r?.lab;
/** The seat keys of a layers row: its `seats` field when a seat of it is repeated, else its labs. */
export const seatsOfRow = row => row?.seats ?? row?.labs ?? [];

/** Registers the keys of every ALLOWED repeat in config.seats.critics (once per run, before any stage). A repeat that is not allowed is left alone: the lint and the run-time check refuse it. */
export function registerSeatKeys(config) {
  KEY_INFO.clear(); REPEATED_IDS.clear();
  for (const r of repeatedLabsOf(config?.seats?.critics)) if (r.keys) {
    REPEATED_IDS.set(r.lab, identityOf(r.seats[0]));
    const perLayer = new Map(); for (const s of r.seats) perLayer.set(s.layer, (perLayer.get(s.layer) ?? 0) + 1);
    const seen = new Map();
    for (const s of r.seats) {   // file order within a layer, the order the keys use
      const n = (seen.get(s.layer) ?? 0) + 1; seen.set(s.layer, n);
      const key = r.keys.get(s); SEAT_KEYS.set(s, key); KEY_INFO.set(key, { lab: r.lab, layer: s.layer, nth: perLayer.get(s.layer) > 1 ? n : null });
    }
  }
}
