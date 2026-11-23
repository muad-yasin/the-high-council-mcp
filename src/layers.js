// src/layers.js - the layered review panel's pure helpers (0.8.3; contract: Review/Build_0.8.3/m6-closing/Layered_Panel_Contract.md, gate page E2_Gate_Page.md).
//
// A chain can put its panel critics (seats.critics) in ordered layers with `layer: 1 | 2 | 3` on each seat. A layer is asked only when every seat of the layers below it signed off on the
// SAME draft; any objection ends the climb, the reviser gets the union, and the next round starts at layer 1. Nothing here calls a model, reads a file or knows the clock.
//
// Contract of this module:
//   layerProblems(config, filePath)  -> [{ message, fix }]   every misuse of `layer`; empty = fine (or no layers at all). Read by chain-lint (council doctor, the CLI's lint gate) AND by runChain
//                                       (src/chain.js, runChainStages), which throws the first one, so a chain that reaches runChain without the lint gate (a direct import, a test) is refused the same way.
//   layersHeadline(layers)           -> string | null          one sentence for the last round recorded in `layers[]` (the report's per-round, per-layer rows); null when there are none.
//   topLayerNotSignedFrom({ layers, stop }) -> { layer } | null  0.8.4 L3: the top layer's row for the stop's pass did not sign off (derived, null = no claim).
//   LAYER_MAX                        -> 3                     the owner's three-layer design; raising it is this one constant.
// State owned: none.

import { repeatedLabsOf } from './seat-key.js';
import { isLayerOneUp } from './escalation.js';
export const LAYER_MAX = 3;

/** The plain words for each state a layer can end a round in (report.json `layers[].state`); the run log and BOARD.md say these, never the state name. */
export const LAYER_STATE_WORDS = {
  signed_off: 'every seat signed off',
  objected: 'a seat objected',
  unheard: 'a seat was not heard',
  abstained: 'no usable verdict',
  not_asked: 'not asked (a layer below did not sign off)',
  unfinished: 'interrupted before it finished',
  escalated: 'not asked (objections that stood unchanged were passed up a layer)',   // stall escalation, A-DRAFT
};

/** The words for one layer row: LAYER_STATE_WORDS, except that a layer left unasked because the person SENT THE PLAN UP does not say the objections stood unchanged (A-DRAFT). */
export const layerStateWord = r => (r?.state === 'escalated' && isLayerOneUp(r.escalated_by) ? 'not asked (the plan was sent up a layer while its objections were still open)' : r?.state === 'escalated' && r.escalated_by === 'layer2_bound' ? "not asked (the plan was sent up to layer 3 while layer 2's objections were still open)" : r?.state === 'not_asked' && r.floor_by === 'request' ? 'not asked (the pass was asked to start at the top layer)' : r?.state === 'not_asked' && r.floor_by === 'ladder' ? 'not asked (the ladder started the pass above this layer)' : r?.state === 'not_asked' && r.floor_by === 'ladder_visits' ? 'not asked (the ladder passed this layer over: it had used its visits)' : (LAYER_STATE_WORDS[r?.state] || r?.state));   // 0.8.4 S4 A-DRAFT: a row a request left out of its pass (control 1, with or without the ladder) is not a layer below that failed to sign off; 0.8.4 round 1, 10a (A-DRAFT, ROUND1 10a-1): a row below the layer the ladder started the pass at says so

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

  const whyNot = config?.descending ? 'is a descending chain'
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
 * unfinished, escalated). Every layer is named, so a layer that was never asked reads as never asked, not as missing. Pure; the callers (the CLI's headline, the run status, the board export) decide where it is shown.
 */
export function layersHeadline(layers) {
  if (!Array.isArray(layers) || layers.length === 0) return null;
  const last = Math.max(...layers.map(r => r.round));
  const rows = layers.filter(r => r.round === last).sort((a, b) => a.layer - b.layer);
  const count = r => `${r.labs.length} lab${r.labs.length === 1 ? '' : 's'}`;
  if (rows.every(r => r.state === 'signed_off') && !rows.some(r => r.raised_again?.length)) return `every layer signed off (${rows.map(r => `layer ${r.layer}: ${count(r)}`).join(', ')})`;
  const say = {
    signed_off: r => (r.raised_again?.length ? `layer ${r.layer} signed off apart from ${r.raised_again.join(', ')} (closed by an earlier ruling)` : `layer ${r.layer} signed off`),   // the raised_again words: stall escalation, A-DRAFT
    objected: r => `layer ${r.layer} objected`,
    unheard: r => `layer ${r.layer} was not fully heard`,
    abstained: r => `layer ${r.layer} gave no usable verdict`,
    not_asked: r => `layer ${r.layer} was never asked`,
    unfinished: r => `layer ${r.layer} was interrupted`,
    escalated: r => (r.escalated_by === 'layer2_bound' ? `layer ${r.layer} was passed over (the plan went up to layer 3)` : `layer ${r.layer} was passed over (its objections went up a layer)`),   // stall escalation, A-DRAFT
  };
  return `round ${last}: ${rows.map(r => (say[r.state] || (() => `layer ${r.layer} is ${r.state}`))(r)).join(', ')} - not agreement`;
}

/**
 * 0.8.4 L3: did the TOP layer sign off on the plan the stop was raised on? `{ layer }` when it did not, else null. Pure and derived: it reads the rows of report.json `layers[]` and the stop (report-partial.json or report.json `stop`),
 * and records nothing. The row is keyed on the stop's OWN pass (`stop.pass`), never "the last round"; the layer is `stop.top_layer` when the stop names one, else the highest layer in `layers[]`.
 * Null (so no claim is made) when: the stop is absent or unreadable (no whole-number `pass`), `handler_not_yet` is true (the top layer signed that plan), `layers[]` is absent or empty (an unlayered chain has no top layer), the row is absent, or the row signed off.
 * It does NOT ask whether a person finished the stop: each reader adds its own gate (the finished run's readers: `stop.chosen === 'finish'` or, for a run with no handling session, 'rule'; the decide screen: the choice being recorded).
 */
export function topLayerNotSignedFrom({ layers, stop } = {}) {
  if (!stop || typeof stop !== 'object' || stop.handler_not_yet === true || !Number.isInteger(stop.pass)) return null;
  if (!Array.isArray(layers) || layers.length === 0) return null;
  const top = Number.isInteger(stop.top_layer) && stop.top_layer >= 1 ? stop.top_layer : Math.max(...layers.map(r => r?.layer).filter(Number.isInteger));
  if (!Number.isInteger(top)) return null;   // Math.max of nothing is -Infinity: no readable layer number, no claim
  const row = layers.find(r => r?.layer === top && r.round === stop.pass);
  return !row || row.state === 'signed_off' ? null : { layer: top };
}

/**
 * The ladder key (0.8.4, the permanent ladder): `"ladder": { "block": N, "visits": M }` on a layered chain of exactly three layers. `block` = the layer-1 revisions in one block, `visits` = the layer-2 visits before the plan reaches layer 3;
 * layer 3 has no number. Both are whole numbers, 1 or more, and nothing else is in the object. The key replaces `maxOverseerRounds` and `layerRevisions`, so a chain cannot carry both (one question, two answers). `maxRounds` is the person's own pass bound
 * and may stand beside it. Read by chain-lint; each message names the key and the file.
 */
export function ladderKeyProblems(config, filePath = '<chain>') {
  const out = [];
  if (!config || typeof config !== 'object' || !('ladder' in config)) return out;
  const add = (message, fix) => out.push({ message, fix });
  const k = config.ladder;
  const whole = n => Number.isInteger(n) && n >= 1;
  if (!k || typeof k !== 'object' || Array.isArray(k)) { add(`"ladder" must be an object with "block" and "visits" (got ${JSON.stringify(k)}).`, `Write "ladder": { "block": 3, "visits": 3 } in ${filePath}.`); return out; }
  const keys = Object.keys(k).sort();
  if (keys.join(',') !== 'block,visits') add(`"ladder" must have exactly the keys "block" and "visits" (got ${JSON.stringify(Object.keys(k))}): layer 1's block size and layer 2's visits; layer 3 has no number.`, `Write "ladder": { "block": 3, "visits": 3 } in ${filePath}.`);
  else if (!whole(k.block) || !whole(k.visits)) add(`ladder.block and ladder.visits must be whole numbers, 1 or more (got ${JSON.stringify(k)}).`, `Use positive integers for "ladder" in ${filePath}.`);
  if ('maxOverseerRounds' in config || 'layerRevisions' in config) add(`"ladder" is set beside "${'maxOverseerRounds' in config ? 'maxOverseerRounds' : 'layerRevisions'}": the ladder has no layer-3 count and no layer bounds, so that key could only contradict it.`, `Remove "maxOverseerRounds" and "layerRevisions" from ${filePath}.`);
  const layers = new Set((Array.isArray(config?.seats?.critics) ? config.seats.critics : []).map(s => s?.layer).filter(l => l !== undefined));
  if (!(layers.size === 3 && [1, 2, 3].every(l => layers.has(l)))) add(`"ladder" is set on a chain whose panel is not exactly three layers (1, 2 and 3, found: ${[...layers].sort().join(', ') || 'none'}): the ladder is written for the three-layer climb.`, `Give seats.critics layers 1, 2 and 3 in ${filePath}, or remove "ladder".`);
  return out;
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
