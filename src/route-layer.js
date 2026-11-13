// N7 for the control that routes the next pass to layer 3 (S20 slice 2, control 1; FEATURE_SPECS: "a route past a layer-2 objection is refused, because that restart must begin at layer 1"). PURE apart from the seat-key registration: it reads the
// run folder's FILE NAMES and the chain config, never a running chain. At a revise pause after pass P, the layer that objected is the highest layer that has a `panel-<P>-<seatKey>[-reask<k>][-retry|-answered|-question].md` file: the climb stops at
// the first layer that does not sign off, so the layers above it were not asked (chain.js, the climb and `layerState`). The key of a seat is `seatKeyOf(seat)`: for one model on two layers the lowest layer keeps the bare lab and the others are `<lab>-l<layer>`
// (src/seat-key.js), and the keys are registered by `registerSeatKeys(config)`, which the CLI calls only after the flag block, so it is called HERE (it is idempotent on the same config). FAIL CLOSED: a panel file whose key maps to no layer, or a pass
// with no panel file, refuses the route ("cannot tell"), never allows it. KNOWN LIMIT: on an answer_back chain an older layer-2 objection that stays open while layer 1 objects in pass P leaves no trace in pass P's files; this check allows that route.
import { registerSeatKeys, seatKeyOf } from './seat-key.js';

const SUFFIX = /^(?:-(?:reask\d+|solo))?(?:-(?:retry|answered|question))*$/;

/** -> null (the route may go on) | { code, message } for the pass `nextPass` (the pass that would start at layer 3); the pass that ended is nextPass - 1. */
export function routeLayerRefusal(config, files, nextPass) {
  const ended = nextPass - 1;
  registerSeatKeys(config);
  const layerOfKey = new Map((config?.seats?.critics ?? []).filter(c => Number.isFinite(c.layer)).map(c => [seatKeyOf(c), c.layer]));
  const re = new RegExp(`^panel-${ended}-(.+)\\.md$`);
  let top = 0; let seen = 0;
  for (const f of files) {
    const m = re.exec(f);
    if (!m) continue;
    seen += 1;
    let layer = null; let bestLen = -1;
    for (const [key, l] of layerOfKey) if (m[1].startsWith(key) && SUFFIX.test(m[1].slice(key.length)) && key.length > bestLen) { layer = l; bestLen = key.length; }
    if (layer === null) return { code: 'route_layer_unknown', message: `the stage file ${f} does not say which layer it was asked at, so it cannot be checked which layer objected in pass ${ended}.` };   // A-DRAFT
    if (layer > top) top = layer;
  }
  if (!seen) return { code: 'route_layer_unknown', message: `pass ${ended} has no panel file, so it cannot be checked which layer objected in it.` };   // A-DRAFT
  if (top >= 2) return { code: 'route_after_upper_objection', message: `pass ${ended} ended with an objection from layer ${top}, and a pass after that restarts at layer 1, so it cannot be routed to layer 3.` };   // A-DRAFT
  return null;
}
