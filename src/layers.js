// src/layers.js - the layered review panel's pure helpers (0.8.3; contract: Review/Build_0.8.3/m6-closing/Layered_Panel_Contract.md, gate page E2_Gate_Page.md).
//
// A chain can put its panel critics (seats.critics) in ordered layers with `layer: 1 | 2 | 3` on each seat. A layer is asked only when every seat of the layers below it signed off on the
// SAME draft; any objection ends the climb, the reviser gets the union, and the next round starts at layer 1. Nothing here calls a model, reads a file or knows the clock.
//
// Contract of this module:
//   layerProblems(config, filePath)  -> [{ message, fix }]   every misuse of `layer`; empty = fine (or no layers at all). Read by chain-lint (council doctor, the CLI's lint gate) AND by runChain
//                                       (src/chain.js, runChainStages), which throws the first one, so a chain that reaches runChain without the lint gate (a direct import, a test) is refused the same way.
//   layersHeadline(layers)           -> string | null          one sentence for the last round recorded in `layers[]` (the report's per-round, per-layer rows); null when there are none.
//   LAYER_MAX                        -> 3                     the owner's three-layer design; raising it is this one constant.
// State owned: none.

import { repeatedLabsOf } from './seat-key.js';
export const LAYER_MAX = 3;

/** The plain words for each state a layer can end a round in (report.json `layers[].state`); the run log and BOARD.md say these, never the state name. */
export const LAYER_STATE_WORDS = {
  signed_off: 'every seat signed off',
  objected: 'a seat objected',
  unheard: 'a seat was not heard',
  abstained: 'no usable verdict',
  not_asked: 'not asked (a layer below did not sign off)',
  unfinished: 'interrupted before it finished',
};

/**
 * Every misuse of the per-seat `layer` key, as { message, fix } (the fix names `filePath`). A panel with no `layer` anywhere has no problems. Each rule exists because the key would otherwise
 * silently do nothing, or leave a seat with no place:
 *  - `layer` outside seats.critics;
 *  - layers on a chain that is not a unanimous, non-relay panel (an advice, descending or `first` chain), or that sets a quorum;
 *  - some critics layered and some not; a layer outside 1..LAYER_MAX; layers with a gap or not starting at 1;
 *  - a layered critic with no `lab` of its own (its lab would be its provider, so seats on one router would count as one lab), or two layered critics sharing a lab.
 */
export function layerProblems(config, filePath = '<chain>') {
  const out = [];
  const add = (message, fix) => out.push({ message, fix });
  const seats = config?.seats || {};
  for (const [key, value] of Object.entries(seats)) {
    if (key === 'critics') continue;
    const flat = key === 'descending' && value && typeof value === 'object' && !Array.isArray(value) && value.model === undefined ? Object.values(value) : (Array.isArray(value) ? value : [value]);
    if (flat.some(seat => seat && typeof seat === 'object' && seat.layer !== undefined)) {
      add(`seats.${key} has a "layer": a layer is read on panel critics (seats.critics) only, so it would silently do nothing here.`, `Remove "layer" from seats.${key} in ${filePath}.`);
    }
  }
  const panel = Array.isArray(seats.critics) ? seats.critics.map((seat, index) => ({ seat, index })).filter(x => x.seat && typeof x.seat === 'object') : [];
  const layered = panel.filter(x => x.seat.layer !== undefined);
  if (!layered.length) return out;

  const whyNot = config?.advise?.enabled === true ? 'is an advice chain'
    : config?.descending ? 'is a descending chain'
    : config?.signoff !== 'unanimous' ? 'signs off with "first"'
    : config?.panel === 'relay' ? 'runs the relay panel'
    : null;
  if (whyNot) add(`The critics have layers, but this chain ${whyNot}. Layers need a unanimous panel that reviews as one set, so they would silently do nothing.`, `Remove "layer" from seats.critics in ${filePath}, or make the chain a unanimous, non-relay panel.`);
  if (config?.quorum !== undefined) add('The critics have layers, but this chain sets "quorum". A quorum has no meaning per layer, so the two cannot be combined.', `Remove "quorum" from ${filePath}, or remove "layer" from seats.critics.`);
  if (layered.length !== panel.length) add(`${layered.length} of ${panel.length} critics have a "layer". Every critic needs one, or none, so no seat is left without a place.`, `Give every seat in seats.critics a "layer" in ${filePath}, or remove it from all of them.`);
  const valid = ({ seat }) => Number.isInteger(seat.layer) && seat.layer >= 1 && seat.layer <= LAYER_MAX;
  for (const x of layered.filter(x => !valid(x))) {
    add(`seats.critics[${x.index}] has layer ${JSON.stringify(x.seat.layer)}, which is not a whole number from 1 to ${LAYER_MAX}.`, `Set "layer" on seats.critics[${x.index}] in ${filePath} to 1, 2 or 3.`);
  }
  const used = [...new Set(layered.filter(valid).map(x => x.seat.layer))].sort((a, b) => a - b);
  if (used.length && used.some((n, i) => n !== i + 1)) add(`The layers in use are ${used.join(', ')}. They must start at 1 and run without a gap.`, `Renumber the layers of seats.critics in ${filePath} so they start at 1 and run without a gap (1, 2 or 1, 2, 3).`);
  for (const x of layered) {
    if (!x.seat.lab) add(`seats.critics[${x.index}] has a layer but no "lab" of its own. Without one its lab is its provider, so seats on one router count as one lab and the layers could not tell them apart.`, `Add a distinct "lab" to seats.critics[${x.index}] in ${filePath}.`);
  }
  const byLab = new Map();
  for (const x of layered.filter(x => x.seat.lab)) byLab.set(x.seat.lab, [...(byLab.get(x.seat.lab) || []), x.index]);
  const repeats = new Map(repeatedLabsOf(layered.map(x => x.seat)).map(r => [r.lab, r.keys]));
  for (const [lab, indexes] of byLab) {
    // lab-identity unit (Q1): the SAME model on DIFFERENT layers is allowed (it gets a seat key); anything else stays refused
    if (indexes.length > 1 && !repeats.get(lab)) add(`The lab "${lab}" is on ${indexes.map(i => `seats.critics[${i}]`).join(' and ')}. In a layered panel each lab sits on exactly one seat, or one position would answer twice.`, `Give each of those seats its own "lab" in ${filePath}.`);
  }
  return out;
}

/**
 * One sentence about how the last round of a layered run ended, from the `layers[]` rows (shape: { round, layer, labs: [lab...], state }, state one of signed_off, objected, unheard, abstained, not_asked,
 * unfinished). Every layer is named, so a layer that was never asked reads as never asked, not as missing. Pure; the callers (the CLI's headline, the run status, the board export) decide where it is shown.
 */
export function layersHeadline(layers) {
  if (!Array.isArray(layers) || layers.length === 0) return null;
  const last = Math.max(...layers.map(r => r.round));
  const rows = layers.filter(r => r.round === last).sort((a, b) => a.layer - b.layer);
  const count = r => `${r.labs.length} lab${r.labs.length === 1 ? '' : 's'}`;
  if (rows.every(r => r.state === 'signed_off')) return `every layer signed off (${rows.map(r => `layer ${r.layer}: ${count(r)}`).join(', ')})`;
  const say = {
    signed_off: r => `layer ${r.layer} signed off`,
    objected: r => `layer ${r.layer} objected`,
    unheard: r => `layer ${r.layer} was not fully heard`,
    abstained: r => `layer ${r.layer} gave no usable verdict`,
    not_asked: r => `layer ${r.layer} was never asked`,
    unfinished: r => `layer ${r.layer} was interrupted`,
  };
  return `round ${last}: ${rows.map(r => (say[r.state] || (() => `layer ${r.layer} is ${r.state}`))(r)).join(', ')} - not agreement`;
}

/**
 * Round semantics (2a; Muad 15 Oct 2026: a round ends only when the overseer layer gives a verdict; C&C: derive, do not duplicate a key): the rules for `maxOverseerRounds` + `layerRevisions`. A chain without either key is untouched
 * (every shipped chain until the 2b fix-up). With them: both together; whole numbers >= 1; `layerRevisions` names exactly layers 1 and 2 (a layer-3 objection ends the overseer round, so it needs no bound); a layered chain of exactly three
 * layers (the overseer rules are written for the three-layer climb); and NO `maxRounds` beside them (the pass ceiling is derived: src/overseer-rounds.js passCeiling). Read by chain-lint; each message names the key and the file.
 */
export function overseerKeyProblems(config, filePath = '<chain>') {
  const out = [];
  const add = (message, fix) => out.push({ message, fix });
  const has = key => config && typeof config === 'object' && key in config;
  if (!has('maxOverseerRounds') && !has('layerRevisions')) return out;
  const whole = n => Number.isInteger(n) && n >= 1;
  if (has('maxOverseerRounds') !== has('layerRevisions')) add(`"${has('maxOverseerRounds') ? 'maxOverseerRounds' : 'layerRevisions'}" is set without "${has('maxOverseerRounds') ? 'layerRevisions' : 'maxOverseerRounds'}": the two belong together, so one alone would silently do nothing.`, `Set both in ${filePath}, or remove the one.`);
  if (has('maxOverseerRounds') && !whole(config.maxOverseerRounds)) add(`maxOverseerRounds must be a whole number, 1 or more (got ${JSON.stringify(config.maxOverseerRounds)}).`, `Set "maxOverseerRounds" to a positive integer in ${filePath}.`);
  if (has('layerRevisions')) {
    const lr = config.layerRevisions;
    const keys = lr && typeof lr === 'object' && !Array.isArray(lr) ? Object.keys(lr).sort() : null;
    if (!keys || keys.join(',') !== '1,2') add(`layerRevisions must be an object with exactly the keys "1" and "2" (got ${JSON.stringify(lr)}): layer 1 and layer 2 each have a bound on the revisions they may trigger in one overseer round; layer 3's objection ends the round.`, `Write "layerRevisions": { "1": <whole number>, "2": <whole number> } in ${filePath}.`);
    else if (!whole(lr[1]) || !whole(lr[2])) add(`layerRevisions bounds must be whole numbers, 1 or more (got ${JSON.stringify(lr)}).`, `Use positive integers for "layerRevisions" in ${filePath}.`);
  }
  if (has('maxRounds') && has('maxOverseerRounds')) add(`"maxRounds" is set beside "maxOverseerRounds": the pass limit of a chain with overseer rounds is derived from maxOverseerRounds and layerRevisions, so a second number could only disagree with it.`, `Remove "maxRounds" from ${filePath}.`);
  const layers = new Set((Array.isArray(config?.seats?.critics) ? config.seats.critics : []).map(s => s?.layer).filter(l => l !== undefined));
  if (!(layers.size === 3 && [1, 2, 3].every(l => layers.has(l)))) add(`maxOverseerRounds is set on a chain whose panel is not exactly three layers (1, 2 and 3, found: ${[...layers].sort().join(', ') || 'none'}): the overseer rules are written for the three-layer climb.`, `Give seats.critics layers 1, 2 and 3 in ${filePath}, or remove the overseer keys.`);
  return out;
}
