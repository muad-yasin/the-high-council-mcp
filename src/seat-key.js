// The SEAT KEY (lab-identity unit, 19 Okt 2026; Muad 18 Okt 21:08 "a same model in separate seats is ONE lab"; C&C rulings Q1, D1-D3). Two keys, two jobs:
//   labOf(seat)      the INDEPENDENCE key (seat.lab || seat.provider): what a lab COUNT counts. Unchanged.
//   seatKeyOf(seat)  the IDENTITY key: what a stage label, a cache key and a per-seat record are built from. It equals labOf(seat) for every seat except one case: the SAME model repeated in a LAYERED critics panel,
//                    on different layers. There the seat on the LOWEST layer keeps the bare lab string and every other seat is `<lab>-l<layer>` (what a chain author used to write by hand as a lab suffix: a chain that
//                    kept those suffixes gets byte-identical stage labels). Chains with no repeated model: no seat is registered, the key IS the lab string, nothing moves.
// Only a layered critics panel may repeat a lab (Q1): repeatedModelKeys() is the ONE test the lints and the run-time check share. Registration is per seat OBJECT (a WeakMap), done once per run by registerSeatKeys().
import { labOf, seatIdentity } from './stage-system.js';

const SEAT_KEYS = new WeakMap();
export const seatKeyOf = seat => SEAT_KEYS.get(seat) ?? labOf(seat);
/** The extra field a record carries for a repeated seat: { seat: key } when the key differs from the lab, else nothing (so unique-lab reports stay byte-identical). */
export const seatField = seat => (seatKeyOf(seat) !== labOf(seat) ? { seat: seatKeyOf(seat) } : {});

/**
 * The seats of ONE lab in a critics panel -> Map(seat -> key) when the repeat is the allowed one (every seat the same model by seatIdentity, a whole-number layer each, all layers different, no key equal to another lab in the panel), else null.
 */
export function repeatedModelKeys(seats, allLabs = []) {
  const group = seats.filter(Boolean);
  if (group.length < 2) return null;
  // the same model: by seatIdentity (a real model, or an external seat's declared session/model). A mock seat has none by design (mock chains reuse names on purpose), so for a REPEAT only - the same lab string AND different layers are already required - the mock model string is the identity, which lets the offline tests run the machinery.
  const idOf = s => seatIdentity(s) ?? (s.provider === 'mock' && s.model ? `mock:${s.model}` : null);
  const ids = new Set(group.map(idOf));
  if (ids.size !== 1 || ids.has(null)) return null;
  const layers = group.map(s => s.layer);
  if (!layers.every(Number.isInteger) || new Set(layers).size !== layers.length) return null;
  const lab = labOf(group[0]);
  const sorted = [...group].sort((a, b) => a.layer - b.layer);
  const keys = new Map(sorted.map((s, i) => [s, i === 0 ? lab : `${lab}-l${s.layer}`]));
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

const KEY_INFO = new Map();   // key -> { lab, layer } for every seat of an allowed repeat (cleared by every registerSeatKeys, so a run with no repeat shows nothing of an earlier one)
/** What a person or a model is SHOWN for a record's `lab` value: the bare lab, never the internal seat key. A value that is no registered key comes back as it is. */
export const labFromKey = key => KEY_INFO.get(key)?.lab ?? key;
/** " (layer N)" for a seat of an allowed repeat (the same model on more than one layer), else ""; the reviser's "Raised by" line adds it. */
export const layerNoteOf = key => (KEY_INFO.has(key) ? ` (layer ${KEY_INFO.get(key).layer})` : '');
/** How a seat is NAMED in text a person reads: the bare lab, plus " (layer N)" for a seat of an allowed repeat. */
export const shownSeat = seat => `${labOf(seat)}${SEAT_KEYS.has(seat) ? ` (layer ${seat.layer})` : ''}`;
/** The key a record stands for: its `seat` field when it has one (a repeated seat), else its lab. */
export const keyOfRecord = r => r?.seat ?? r?.lab;
/** The seat keys of a layers row: its `seats` field when a seat of it is repeated, else its labs. */
export const seatsOfRow = row => row?.seats ?? row?.labs ?? [];

/** Registers the keys of every ALLOWED repeat in config.seats.critics (once per run, before any stage). A repeat that is not allowed is left alone: the lint and the run-time check refuse it. */
export function registerSeatKeys(config) {
  KEY_INFO.clear();
  for (const r of repeatedLabsOf(config?.seats?.critics)) if (r.keys) for (const [seat, key] of r.keys) { SEAT_KEYS.set(seat, key); KEY_INFO.set(key, { lab: r.lab, layer: seat.layer }); }
}
