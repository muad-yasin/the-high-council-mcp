// 0.8.4 S8 (follow-up): the words a text uses for the run's TOP LAYER. A shipped chain has layers 1, 2, 3, but a chain of the user's own may have two (or more), and a sentence that says "layer 3" in
// the report of a two-layer run is wrong. The number comes from the run's own record. When the record names none (an older report, a hand-built one) the words stay and say less: "the top layer",
// never a 3 and never a skipped sentence (a verdict reader that printed nothing would turn NOT AGREED into PASSED). The fallback is reachable only from readers of a REPORT: the chain passes its
// own topLayer, so a live run never prints it. Pure.

/** The run's top layer from a record: the highest `layer` of its `layers[]` rows, else of the final read's seats and reused seats; null when it names none. */
export function topLayerOf({ layers = null, finalRead = null } = {}) {
  const num = rows => (Array.isArray(rows) ? rows.map(r => r?.layer).filter(Number.isInteger) : []);
  const ls = num(layers);
  const fl = [...num(finalRead?.seats), ...num(finalRead?.reused)];
  const all = ls.length ? ls : fl;
  return all.length ? Math.max(...all) : null;
}
const known = n => Number.isInteger(n) && n >= 1;
/** "layer 3" / "the top layer" */
export const layerWord = n => (known(n) ? `layer ${n}` : 'the top layer');
/** "Layer 3" / "The top layer" */
export const layerWordCap = n => (known(n) ? `Layer ${n}` : 'The top layer');
/** "layer-3" / "top-layer" (as in "every layer-3 seat") */
export const layerHyphen = n => (known(n) ? `layer-${n}` : 'top-layer');
/** "LAYER 3" / "THE TOP LAYER" */
export const layerUpper = n => layerWord(n).toUpperCase();
/** "LAYER-3" / "TOP-LAYER" */
export const layerHyphenUpper = n => layerHyphen(n).toUpperCase();
