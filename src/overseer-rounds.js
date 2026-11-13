// Round-semantics unit one (gate page Review/Build_0.8.3/m6-closing/Round_Semantics_Gate_Page.md, PASS ON CONDITIONS by C&C 15 Oct 2026; Muad's rule: a round ends only when the overseer layer gives a verdict): the pure bookkeeping
// of the two counters. Nothing calls it yet. No imports: it reads plain data only, so no path reaches roles.js, the clock or a provider.
//
// A "pass" is what chain.js calls a round today (its stage labels panel-<pass>-<lab> never change). An OVERSEER ROUND is every pass up to and including the one in which the top layer gives a verdict (a sign-off, or an objection that
// goes back into revision). Per overseer round the harness counts the revisions TRIGGERED by layer 1 and by layer 2 against their bounds (a layer-3 objection ends the overseer round, so it needs no bound), and the consecutive
// passes that ended with NO revise because a seat was unheard (the re-ask branch: bounded today only by the pass cap). Reaching a bound or the overseer-round cap is a RESUMABLE STOP, never agreement.
//
// config: { maxOverseerRounds, layerRevisions: { 1: b1, 2: b2 }, reasks }   (reasks defaults to REASKS_NO_REVISE: E3b's two re-asks per seat before a seat counts as unheard)
// state:  { overseerRound, passInRound, used: { 1, 2 }, noRevise }          (newRoundState() is the start; advance() returns a NEW state and never mutates its input)
// pass:   { outcome: 'layer_objected', layer: 1 | 2 }                       a lower layer objected: a revise would follow
//         { outcome: 'overseer_verdict', verdict: 'signed_off' | 'objected' }   layer 3 gave its verdict
//         { outcome: 'unheard', layer }                                     the climb stopped on an unheard seat of that layer, nothing to revise
// result: { state, action: 'revise' | 'ask_again' | 'done' | 'stop', overseerRoundEnded, stop? }  stop: { kind: 'layer_bound' | 'overseer_cap', ... } (layer_bound carries why: 'revisions' | 'unheard')
// 0.8.4 S5 (U-C): a third kind, 'stall_stop', is raised by src/chain.js's stall block, not by advance(): an objection stood unchanged and cannot be passed up (the top layer holds it, or no pass is left).
export const REASKS_NO_REVISE = 2;   // what a --continue at the silent-seat stop adds: passes of the silent seat again (each with its in-pass re-asks and its solo ask)
/** 0.8.4 (ladder unit, silent judges, Muad 10 Nov "b is OK"): the unheard passes a silent seat may cost BEFORE the stop. It was REASKS_NO_REVISE (two repeated full passes); the one SOLO ask a silent judge now gets inside the pass (src/chain.js, label `-solo`) replaces them, so the first pass that ends on a still-silent judge stops the run. */
export const UNHEARD_PASSES_BEFORE_STOP = 0;

const isCount = n => Number.isInteger(n) && n >= 1;

/** The most passes advance() can allow before it stops. The unheard counter is CONSECUTIVE (any revise resets it, C&C ruling), so each of the (b1 + b2 + 1) productive passes of an overseer round (the allowed revisions and the climb
 *  that ends it) can be preceded by `reasks` unheard passes: maxOverseerRounds x (b1 + b2 + 1) x (reasks + 1). chain-lint refuses a maxRounds below it, so the old pass-cap ending is unreachable for these chains. null when the config is malformed. */
export function passCeiling({ maxOverseerRounds, layerRevisions, reasks = UNHEARD_PASSES_BEFORE_STOP + REASKS_NO_REVISE } = {}) {   // the lone-heard pass (layer 1) can still repeat twice before its stop, so the backstop counts those passes
  const b1 = layerRevisions?.[1]; const b2 = layerRevisions?.[2];
  if (!isCount(maxOverseerRounds) || !isCount(b1) || !isCount(b2) || !Number.isInteger(reasks) || reasks < 0) return null;
  return maxOverseerRounds * (b1 + b2 + 1) * (reasks + 1);
}

export function newRoundState() {
  return { overseerRound: 1, passInRound: 0, used: { 1: 0, 2: 0 }, noRevise: 0 };
}

export function advance(config, state, pass) {
  const { maxOverseerRounds, layerRevisions } = config || {};
  const reasks = config?.reasks ?? UNHEARD_PASSES_BEFORE_STOP;
  // The ladder (src/ladder.js) has no layer bounds, and no layer-3 count unless the person wrote one (`--rounds N`): each of the two is then null. A null layer-3 count means a layer-3 objection starts the next overseer round with no cap; null layer bounds
  // mean a lower layer never reaches a bound. The silent-seat bound (`reasks`) always stays. Each is checked on its own: one null beside a number is allowed only for the layer-3 count (the person's `--rounds` on a ladder run is a number beside null layer bounds).
  const noLayerBounds = layerRevisions === null;
  const noCap = maxOverseerRounds === null;
  const capOk = noCap || isCount(maxOverseerRounds);
  const boundsOk = noLayerBounds || (isCount(layerRevisions?.[1]) && isCount(layerRevisions?.[2]));
  if (!capOk || !boundsOk || (noCap && !noLayerBounds) || !Number.isInteger(reasks) || reasks < 0) throw new RangeError('advance: maxOverseerRounds, layerRevisions {1,2} and reasks must be whole numbers >= 1 (>= 0 for reasks); on a ladder chain layerRevisions is null and maxOverseerRounds is null or the number the person typed');
  const s = { overseerRound: state.overseerRound, passInRound: state.passInRound + 1, used: { 1: state.used[1], 2: state.used[2] }, noRevise: state.noRevise };
  switch (pass?.outcome) {
    case 'layer_objected': {
      const layer = pass.layer;
      if (layer !== 1 && layer !== 2) throw new RangeError(`advance: layer_objected names layer 1 or 2, not ${JSON.stringify(layer)} (a layer-3 objection is an overseer_verdict)`);
      if (!noLayerBounds && s.used[layer] >= layerRevisions[layer]) {
        return { state: s, action: 'stop', overseerRoundEnded: false, stop: { kind: 'layer_bound', why: 'revisions', layer, used: s.used[layer], bound: layerRevisions[layer], overseerRound: s.overseerRound } };
      }
      s.used[layer] += 1; s.noRevise = 0;
      return { state: s, action: 'revise', overseerRoundEnded: false };
    }
    case 'overseer_verdict': {
      if (pass.verdict === 'signed_off') return { state: s, action: 'done', overseerRoundEnded: true };
      if (pass.verdict !== 'objected') throw new RangeError(`advance: verdict is signed_off or objected, not ${JSON.stringify(pass.verdict)}`);
      if (!noCap && s.overseerRound >= maxOverseerRounds) return { state: s, action: 'stop', overseerRoundEnded: true, stop: { kind: 'overseer_cap', rounds: s.overseerRound, cap: maxOverseerRounds } };
      return { state: { overseerRound: s.overseerRound + 1, passInRound: 0, used: { 1: 0, 2: 0 }, noRevise: 0 }, action: 'revise', overseerRoundEnded: true };
    }
    case 'unheard': {
      s.noRevise += 1;
      // The lone-heard pass (layer 1: one judge heard and objecting, its peer silent; `lone` from src/chain.js) keeps the two re-ask passes it had before the ladder unit (the owner's "silent judge being asked twice", 10 Nov 2026); every other silent judge has had its solo ask inside the pass, so its first unheard pass stops.
      const bound = pass.lone === true ? reasks + REASKS_NO_REVISE : reasks;
      if (s.noRevise > bound) return { state: s, action: 'stop', overseerRoundEnded: false, stop: { kind: 'layer_bound', why: 'unheard', layer: pass.layer ?? null, passes: s.noRevise, reasks: bound, overseerRound: s.overseerRound } };
      return { state: s, action: 'ask_again', overseerRoundEnded: false };
    }
    default:
      throw new RangeError(`advance: unknown outcome ${JSON.stringify(pass?.outcome)}`);
  }
}

/** The chain file's `ladder` key as the numbers the run uses, or null when the chain has none or it is malformed (chain-lint refuses a malformed one before a run). `block` = the layer-1 revisions in one block, `visits` = the layer-2 visits; layer 3 has no number. */
export function ladderKeyOf(config) {
  const k = config && typeof config === 'object' ? config.ladder : undefined;
  if (!k || typeof k !== 'object' || Array.isArray(k)) return null;
  return isCount(k.block) && isCount(k.visits) ? { block: k.block, visits: k.visits } : null;
}

/** True for a chain the overseer rules read: one with overseer rounds (`overseer` is a number) or one with the ladder key (`ladder`). The one test every reader of the limits uses in place of `overseer !== null`. */
export const isOverseerChain = limits => !!limits && (limits.overseer !== null || !!limits.ladder);

/**
 * The one reader of "how many rounds" for every consumer of a chain config (round-semantics 2a, C&C ruling 15 Oct 2026: derive, do not duplicate a key).
 * A chain with `maxOverseerRounds` + `layerRevisions` carries NO `maxRounds`: `passes` is then the derived passCeiling (the most advance() allows, so the old pass-cap ending is only a backstop) and
 * `overseer` is the number of overseer rounds; every other chain keeps `maxRounds ?? 2` passes and no overseer rounds. `layerRevisions` is returned for the estimate.
 * A malformed pair of new keys reads as no overseer rounds (chain-lint refuses such a file before a run).
 */
export function roundLimitsOf(config, { defaultPasses = 2 } = {}) {
  // The ladder (0.8.4): a chain whose file carries `ladder` {block, visits} runs the permanent ladder (src/ladder.js). It has no layer-3 count and no layer bounds, so `overseer` and `layerRevisions` are null and there is NO pass ceiling
  // (`passes` is null) unless the chain or the person sets one (`maxRounds`, `--rounds`). Read the chain with isOverseerChain(limits), never with `overseer !== null`: a ladder chain is an overseer chain with no overseer-round count.
  const ladder = ladderKeyOf(config);
  if (ladder) return { passes: Number.isInteger(config.maxRounds) ? config.maxRounds : null, overseer: null, layerRevisions: null, ladder };
  const ceiling = config && 'maxOverseerRounds' in config ? passCeiling({ maxOverseerRounds: config.maxOverseerRounds, layerRevisions: config.layerRevisions }) : null;
  if (ceiling !== null) return { passes: ceiling, overseer: config.maxOverseerRounds, layerRevisions: { 1: config.layerRevisions[1], 2: config.layerRevisions[2] } };
  return { passes: config?.maxRounds ?? defaultPasses, overseer: null, layerRevisions: null };
}

/** The `--rounds N` override (cli.js, api.js, a resume's saved value): on a chain with overseer rounds it sets THEM (the number a person reads as "rounds"), on any other chain `maxRounds`. Mutates and returns the config. */
export function setRounds(config, n) {
  if (roundLimitsOf(config).overseer !== null) config.maxOverseerRounds = n; else config.maxRounds = n;
  return config;
}

/** The number `--rounds` and a run.json's saved `rounds` carry: the overseer rounds on a chain that has them, else `maxRounds` (undefined when a chain sets neither). */
export function roundsSetting(config) {
  return roundLimitsOf(config).overseer ?? config?.maxRounds;
}

/**
 * What `--continue` adds at each stop, in words (the same amounts defaultAdd gives and effectiveLimits applies: an overseer-round extension is global; a layer's revisions and a silent seat's passes belong to the overseer round the stop
 * was in). A stop that does not carry its figures (an unreadable partial report) says it generally. The amounts are read from the stop, from REASKS_NO_REVISE and (a revisions stop) from `add`, the defaultAdd a caller holding the chain passes; never typed.
 */
const extendWords = (stop, add = null) => {
  if (stop.kind === 'overseer_cap') return 'one more overseer round';
  if (stop.kind === 'stall_stop') return 'the objections that stood unchanged are counted afresh and the run goes on';   // 0.8.4 S5 (A-DRAFT): it adds no overseer round
  if (stop.why === 'unheard') return `the silent seat gets ${REASKS_NO_REVISE} more passes in this overseer round`;
  if (stop.why === 'final_read') return `${topLayerWord(stop)} reads the final plan once more`;   // WORDING S16-w27c
  // BUG-D-010: `stop.bound` is the EXTENDED bound (the chain's base plus the continues already recorded for this overseer round), but `--continue` adds defaultAdd = the chain's BASE bound. A caller that holds the chain passes that amount as `add`; without it the stop's own bound is read, as before.
  const n = Number.isInteger(add) && add > 0 ? add : stop.bound;
  return Number.isInteger(n) && n > 0 && stop.layer ? `layer ${stop.layer} gets ${n} more ${n === 1 ? 'revision' : 'revisions'} in this overseer round`
    : 'it extends the limit that was reached';
};
/**
 * WHY a run stopped, in words, for the head of stopSentence. A stop read from report-partial.json carries its figures (cap, layer, bound, passes, overseer_round) and the sentence names them. A stop WITHOUT them (cli.js builds one, `{ kind }` alone, for a
 * tree member whose partial report cannot be read) says it generally: a figure that is not there is never printed as "undefined" or "null" (A-DRAFT: the general sentences). Pure.
 */
/** 0.8.4 S5 (A-DRAFT): the stalled objections of a stop as the sentence counts them: { n, w } (how many, and the window of verdicts they stood through), or null when the stop does not carry them. */
const stalledFigures = stop => (Array.isArray(stop?.stalled) && stop.stalled.length && isCount(stop.stalled[0]?.passes?.length) ? { n: stop.stalled.length, w: stop.stalled[0].passes.length } : null);
/** 0.8.4 S16 (D): the final-read stop (kind layer_bound, why final_read). One predicate for the stop sentence and the member sentences. */
export const isFinalReadStopOf = stop => stop?.kind === 'layer_bound' && stop?.why === 'final_read';
/** WORDING S16-w28: what a finish does at the final-read stop. */
export const finalReadFinishWords = stop => `${topLayerWord(stop)} reads the final plan once more first; if a seat reads it, the handoff runs, the open objections are handed over and the result stays "not agreed", with each seat that did not read named; if no seat reads it, the run does not end and stays stopped`;
/** WORDING S16-w44 (the SESSION form of S16-w30 / w31): the refusal of a finish at the final-read stop, with the choices named as choices. null when the stop carries no refusal. Pure. */
export const finalReadSessionRefusal = (stop, spentUsd = null) => {
  if (!isFinalReadStopOf(stop) || !stop.finish_refused) return null;
  const T = topLayerWord(stop);
  if (stop.finish_refused === 'ran') return `The choice finish did not end the run: the final read ran once more and no seat of ${T} gave a usable reply, so nobody has read the final plan. A finish does not end the run before ${T} has read it, so this run stays stopped, and the request to end it is recorded. What remains: the choice continue (${T} reads the final plan once more), the choice finish_now on the person's own words (the run ends now with the verdict the panel had before the read, and ${T} did not read the final plan), or leaving the run stopped while the draft is revised outside the Council.${spentUsd === null || spentUsd === undefined ? '' : ` Spent so far: $${Number(spentUsd).toFixed(2)}.`}`;
  return `The choice finish did not end the run: no seat of ${T} has read the final plan, and a finish does not end the run before ${T} has read it. No further read was made for this request: only the choice continue reads again. What remains: the choice continue, the choice finish_now on the person's own words (the run ends now with the verdict the panel had before the read, and ${T} did not read the final plan), or leaving the run stopped while the draft is revised outside the Council. Nothing was run and nothing was spent.`;
};
/** WORDING S16-w27c / w40: the same stop in a tree member's sentences. */
export const finalReadContinueWords = stop => extendWords(stop);
export const finalReadMemberFinishWords = stop => `${topLayerWord(stop)} reads the final plan once more first; if a seat reads it, the handoff runs and the result stays not agreed; if no seat reads it, the run stays stopped`;
export const finalReadMemberRecordedFinish = stop => `finish: ${topLayerWord(stop)} reads the final plan once more first, the handoff runs if a seat reads it, and the result stays "not agreed"`;
/** 0.8.4 S16 (D): "layer N" when the stop carries the run's top layer, else "the top layer" (as didNotSignOffPhrase says it). */
const topLayerWord = stop => (isCount(stop?.top_layer) ? `layer ${stop.top_layer}` : 'the top layer');
function whyOf(stop) {
  if (stop.kind === 'overseer_cap' && stop.handler_not_yet === true) return isCount(stop.cap) ? `all ${stop.cap} overseer rounds were used and the handler still said not yet to the plan the top layer signed` : 'all its allowed overseer rounds were used and the handler still said not yet to the plan the top layer signed';   // 0.8.4 S4, A-DRAFT
  if (stop.kind === 'overseer_cap') {
    const base = isCount(stop.cap) ? `all ${stop.cap} overseer rounds were used and the top layer still objected` : 'all its allowed overseer rounds were used and the top layer still objected';
    const f = stalledFigures(stop);   // 0.8.4 S5 (A-DRAFT): a stall pending at this stop is said; a stop without one keeps its sentence byte for byte
    return f ? `${base}, and ${f.n === 1 ? 'an objection also stood' : `${f.n} objections also stood`} unchanged through the last ${f.w} verdicts of ${f.n === 1 ? 'its judge' : 'their judges'}` : base;
  }
  if (stop.kind === 'stall_stop') {   // 0.8.4 S5 (A-DRAFT): the code picks the one reason that is true (stop.why); no sentence offers two
    const f = stalledFigures(stop);
    if (!f) return 'objections stood unchanged for several verdicts in a row and could not be passed up';
    const one = f.n === 1; const judges = one ? 'its judge' : 'their judges'; const it = one ? 'it' : 'them';
    if (stop.why === 'top_layer') return `${one ? 'an objection of the top layer stood' : `${f.n} objections, the top layer's among them, stood`} unchanged through the last ${f.w} verdicts of ${judges}, and no layer is above the top layer to pass ${it} to`;
    if (stop.why === 'ladder_next') return `${one ? 'an objection stood' : `${f.n} objections stood`} unchanged through the last ${f.w} verdicts of ${judges}, and the next pass is a ladder pass, which does not pass ${it} up`;   // A-DRAFT (0.8.4 round 2, the stranded run: the words are Helper B's; placeholder until the round-2 sheet)
    if (stop.why === 'last_pass') return `${one ? 'an objection stood' : `${f.n} objections stood`} unchanged through the last ${f.w} verdicts of ${judges}, and no pass is left to pass ${it} up`;
    return `${one ? 'an objection stood' : `${f.n} objections stood`} unchanged through the last ${f.w} verdicts of ${judges} and could not be passed up`;
  }
  if (stop.kind === 'layer_bound' && stop.why === 'unheard') {
    return isCount(stop.layer) && isCount(stop.passes) && isCount(stop.overseer_round)
      ? `a seat in layer ${stop.layer} stayed silent for ${stop.passes} passes in a row in overseer round ${stop.overseer_round}` : 'a seat of a layer stayed silent for too many passes in a row';
  }
  if (stop.kind === 'layer_bound' && stop.why === 'final_read') return `no seat of ${topLayerWord(stop)} gave a usable reply to the final read, so nobody has read the final plan`;   // WORDING S16-w25
  if (stop.kind === 'layer_bound' && stop.why === 'revisions') {
    return isCount(stop.layer) && isCount(stop.bound) && isCount(stop.overseer_round)
      ? `layer ${stop.layer} needed more than its ${stop.bound} allowed revisions in overseer round ${stop.overseer_round} and still objects` : 'a layer needed more than its allowed revisions and still objects';
  }
  if (stop.kind === 'layer_bound') return 'a layer needed more than its allowed revisions, a seat of a layer stayed silent for too many passes in a row, or no seat of the top layer could read the final plan';   // WORDING S16-w38
  return 'a limit was reached';
}
/** The GENERAL words for a stop kind (no figures), for a line that has only the kind: the first line of BOARD-partial.md (src/report-shape.js). Pure. */
export const stopWhyGeneral = kind => whyOf({ kind });
/**
 * The sentence a person reads when a layered run stops at the overseer-round cap, at a layer's revision bound or because a seat of a layer stays silent (E item for Muad's yes at M7; round-semantics 2b). It says it is NOT agreement, what is on disk, what was spent, and the
 * choices. `stop` is advance()'s stop plus { pass, overseer_round }. Pure.
 */
/** 0.8.4 S4 (E3(b), RU-S4-35): the number of used overseer rounds at which every chain presents the HARD STOP: only the person decides, with a line of its own. Since Muad's word of 05 Nov 2026 it offers --finish too (with the line that the top layer did not sign off); the old "cannot be finished as it stands" is gone. */
/** 0.8.4 S5 (A-DRAFT): the round stops in words, ONE place for the three member sentences (tree-redirect.js, tree-resume.js, and any later one). Keyed by the stop CAUSE; layer_bound has two reasons. test/stall-stop.test.js pins that every round-stop cause has a phrase here. */
export const ROUND_STOP_PHRASES = Object.freeze({
  overseer_cap: 'at its overseer-round limit',
  layer_bound: ["at a layer's revision limit", 'because a seat of a layer stayed silent for too many passes in a row', 'because no seat of the top layer could read the final plan'],   // the third: WORDING S16-w26
  stall_stop: 'because an objection stood unchanged and could not be passed up',
});
/** 0.8.4 S5 (A-DRAFT): the one phrase that is true for THIS stop (the stop's kind, and a layer-bound stop's reason), else the whole list. */
export const roundStopPhraseOf = stop => { const p = ROUND_STOP_PHRASES[stop?.kind]; if (typeof p === 'string') return p; if (Array.isArray(p) && (stop.why === 'revisions' || stop.why === 'unheard' || stop.why === 'final_read')) return stop.why === 'final_read' ? p[2] : stop.why === 'unheard' ? p[1] : p[0]; return roundStopsInWords(); };
export const roundStopsInWords = () => { const all = Object.values(ROUND_STOP_PHRASES).flat(); return `${all.slice(0, -1).join(', ')}, or ${all[all.length - 1]}`; };
/** 0.8.4 S5 (A-DRAFT): what a --continue does, in words, for every sentence that names it for any round stop (the member sentence, the decide screen, --help). */
export const CONTINUE_WORDS = 'it extends the limit that was reached, counts the stalled objections afresh, or has the top layer read the final plan once more when none of its seats could read it';   // WORDING S16-w27b
/** 0.8.4 S5 (C&C's fix-up rule): --continue is offered at a stall_stop only while a pass is left (it counts the stalled objections afresh and goes on); refused only when none is. ONE predicate for the CLI, the stop sentence, the member sentence, the tree's choice and the chain's replay. A stop without the figure (an older or unreadable one) offers it. */
/**
 * 0.8.4 SG-1 (C&C 08 Nov 2026, option B): the reason a stall could not be passed up, in the one order that is true: the top layer holds a stalled objection (no layer above it); else no pass is left; else the climb is not shown to the receiving layer (the stall gate is off: the chain keeps no answer-back list or the rating demand is not recorded). Pure.
 * The fallback (gate on, a pass left, not the top layer) cannot be reached by chain.js (then the stall goes up); it keeps the pre-SG-1 reading, `last_pass`.
 */
export const stallStopWhy = ({ topHeld, passLeft, gateOn, ladderNext = false }) => (topHeld ? 'top_layer' : !passLeft ? 'last_pass' : gateOn === false ? 'climb_not_shown' : ladderNext ? 'ladder_next' : 'last_pass');   // 0.8.4 round 2 (the stranded run, RESULT 1): ladderNext = the last credited pass, the next one a ladder pass (which never passes a plan up); the gate on and a pass left, as for the fallback
export const stopOffersContinue = stop => !(stop?.kind === 'stall_stop' && stop.pass_left === false);
/** 0.8.4 S5 (Muad's word, A-DRAFT): the clause that tells the person the top layer did not sign off on this plan. Said only for a READABLE stop (an integer pass: the partial report read) and never at a stop the handler's not_yet reached (the top layer signed that plan). */
/** 0.8.4 L3: the clause itself, once: "layer N" when the layer is known, else "the top layer" (a stop raised by advance() carries no layer number). The stop sentence (didNotSignOffWords) and the finished run's own readers (src/verdict-headline.js) both say it through here, so the two cannot drift. */
export const didNotSignOffPhrase = n => `${isCount(n) ? `layer ${n}` : 'the top layer'} did not sign off on this plan`;
export const didNotSignOffWords = stop => (Number.isInteger(stop?.pass) && stop.handler_not_yet !== true && stop?.why !== 'final_read' ? `, and ${didNotSignOffPhrase(stop.top_layer)}` : '');
export const HARD_STOP_ROUNDS = 7;
export const isHardStop = stop => (stop?.kind === 'overseer_cap' || stop?.kind === 'stall_stop') && stop.ladder !== true && Number.isInteger(stop.rounds) && stop.rounds >= HARD_STOP_ROUNDS;   // 0.8.4 S5 (C&C 05 Nov 2026): at seven used overseer rounds the CHOICE SET is the hard stop's, whatever the effective cap: a top-layer stall there carries `rounds` and presents the same (--continue offered, --finish refused)
/** 0.8.4 (C&C 10 Nov): a stop only the person's own words decide: the hard stop off the ladder (seven overseer rounds) and, on a ladder run, the stop at the limit the person typed (`--rounds N`) at every N. The session gives no answer of its own there; it relays the person's (src/gate.js, src/mcp/stop-decide.js). */
/**
 * The ONE place a ladder run's stop is marked (C&C 10 Nov, fail closed): an overseer_cap or stall_stop raised while a ladder is in force for the run carries `ladder: true`, whatever pass it fell on and however the limit came to be (a number typed at the start, typed at a resume, or kept across a resume).
 * chain.js calls it where advance()'s stop is built, which is the only place an overseer_cap is raised; every resume path reaches that place. A stop the run kept as it was raised keeps the mark (a resume may adopt a ladder later).
 */
export const markLadderStop = (stop, ladderInForce) => (ladderInForce && (stop?.kind === 'overseer_cap' || stop?.kind === 'stall_stop') ? { ...stop, ladder: true } : stop);   // a stall stop of a run with a ladder in force is marked too, so the seven-round count never makes it the hard stop, even on a pass the ladder has not started yet (credit); only the typed-limit stop is the person's alone
/** 0.8.4 (C&C 10 Nov, typed = relayed): the ONE check of a new top-layer limit given with a continue (`--rounds N` at the terminal, `rounds` through the session): a whole number above the reads already made. cli.js and src/gate.js both ask it. */
export const limitReachable = (n, made) => Number.isSafeInteger(n) && Number.isSafeInteger(made) && n > made;
/** The refusal of a new top-layer limit that is not above the reads already made, with the count (A-DRAFT; the terminal's own form is cli.js, which names --rounds). One sentence for the gate and for the tool. */
export const roundsUnreachableSentence = (n, made) => `rounds ${n}: this run has already made ${made} top-layer read${made === 1 ? '' : 's'}, so ${n} is not a limit it can still reach. Give a whole number above ${made}, or no number. Nothing was recorded.`;
export const isPersonStop = stop => isHardStop(stop) || (stop?.kind === 'overseer_cap' && stop.ladder === true) || stop?.kind === 'owner_pause' || stop?.kind === 'budget_stop';   // the owner pause and the spending stop are the person's: the session relays, never answers (0.8.4 ladder unit)
export function stopSentence(stop, { spentUsd = null, draftFile = null, runDir = '<run folder>', memberTail = null, add = null, finalRead = false } = {}) {
  const why = whyOf(stop);
  const spent = spentUsd === null || spentUsd === undefined ? '' : ` Spent so far: $${Number(spentUsd).toFixed(2)}.`;
  const draft = draftFile ? ` The plan as it stands is in ${draftFile} in ${runDir}.` : '';
  // 0.8.4 S16 (D; WORDING S16-w32, w30, w31): the final-read stop. A run with NO handling session is PAUSED, not asked: no person, no choices, no command. A finish asked for while no seat has read is refused here (the read before it ran, or no read was made).
  if (stop.kind === 'layer_bound' && stop.why === 'final_read') {
    const T = topLayerWord(stop);
    if (stop.no_chooser === true) return `THE RUN IS PAUSED, NOT ENDED: ${why}.${spent}${draft} Nothing more was paid for after this point. A run does not end before ${T} has read the final plan, so it waits. It stays paused: nobody is named to choose in this run, and it can be resumed only when a handling session is there to choose.`;
    if (stop.finish_refused === 'ran') return `--finish: the final read ran once more and no seat of ${T} gave a usable reply, so nobody has read the final plan. A finish does not end the run before ${T} has read it, so this run did not end: it stays stopped, and your request to end it is recorded. What remains: --continue (${T} reads the final plan once more), --finish-now (the run ends now with the verdict the panel had before the read, and ${T} did not read the final plan), or revising the draft yourself outside the Council with this run left stopped.${spent}`;
    if (stop.finish_refused === 'repeat') return `--finish: no seat of ${T} has read the final plan, and a finish does not end the run before ${T} has read it, so this run did not end. No further read was made for this request: only --continue reads again. What remains: --continue, --finish-now (the run ends now with the verdict the panel had before the read, and ${T} did not read the final plan), or revising the draft yourself outside the Council with this run left stopped. Nothing was run and nothing was spent.`;
  }
  const head = `THE RUN STOPPED, NOT AGREED, and is waiting for your choice: ${why}.${spent}${draft} Nothing more was paid for after this point. `;
  // A tree MEMBER is resumed only by its tree (src/tree-redirect.js): its text never names a direct --resume.
  if (memberTail) return `${head}\n\n${memberTail}`;
  // 0.8.4 S5 (A-DRAFT, C&C): a last-pass stall left layer N unread; where the chain's final read is ON, --finish gives it that read, and the sentence says so (one branch).
  const readsFinal = finalRead === true && stop.kind === 'stall_stop' && stop.why === 'last_pass' && isCount(stop.top_layer);
  // Muad's word (heading "FINISHING A LAYERED RUN AT A STOP STAYS THE PERSON'S CHOICE; THC TELLS HIM THAT LAYER 3 DID NOT SIGN OFF IN THAT CASE", 05 Nov 2026): the choice to finish says that the top layer did not sign off on this plan. True at a layer-bound stop (a lower layer stopped the climb, the top layer was not asked), at a cap stop (the top layer objected) and at a stall stop; NOT at a stop the handler's not_yet reached (the top layer signed that plan), where it is left out.
  const isFinalReadStop = isFinalReadStopOf(stop);
  const finishWords = isFinalReadStop
    ? finalReadFinishWords(stop)
    : `the dispute stage and the handoff run, ${readsFinal ? `layer ${stop.top_layer} reads the final plan, ` : ''}the open objections are handed over, the result stays "not agreed"${didNotSignOffWords(stop)}`;
  // 0.8.4 S4 (RU-S4-35, RU-ADD-A10, T15j/T15l; A-DRAFT), AMENDED by Muad 05 Nov 2026 ("1: a"): at seven used overseer rounds the stop is the HARD STOP on every chain: its own line (only the person decides here), and it offers --continue, --finish (with the line that the top layer did not sign off) and revising outside the Council. The line is the only thing that is different; the tail is the same one every round stop gets.
  const hardLine = isHardStop(stop) ? `This is the hard stop after ${HARD_STOP_ROUNDS} overseer rounds: only you decide here. ` : '';
  if (!stopOffersContinue(stop)) return head + hardLine + `To end it here: council --resume ${runDir} --finish (${finishWords}). No pass is left, so there is no --continue. Or take the draft and revise it yourself outside the Council.`;   // 0.8.4 S5 (A-DRAFT): a stall with no pass left
  // 0.8.4 S16 (D): the read before a finish happens once in a run (Cl = 8); after it a finish ends nothing while no seat has read, so the sentence offers the two choices that can (WORDING S16-w31 answers a finish typed anyway).
  if (isFinalReadStop && stop.finish_read_used === true) return head + `To go on: council --resume ${runDir} --continue (${extendWords(stop, add)}; the run's spending limit still applies). Or take the draft and revise it yourself outside the Council.`;
  return head + hardLine
    + `To go on: council --resume ${runDir} --continue (${extendWords(stop, add)}; the run's spending limit still applies). To end it here: council --resume ${runDir} --finish (${finishWords}). `
    + `Or take the draft and revise it yourself outside the Council.`;
}

// ---- Round semantics 2b-ii: the person's choice at a stop (continue / finish), recorded in run.json `roundChoices` and applied on the replay.
/** True for a layer-1 stop for its revision bound (not the overseer-round cap, not a silent seat, not layer 2): the one stop where `--send-up` was offered until it was turned off on 1 Nov 2026. Kept for the recorded choices of older runs and for its test. */
export const canSendUp = stop => stop?.kind === 'layer_bound' && stop.why === 'revisions' && stop.layer === 1;
/** 0.8.4 S7 (Q7, the layer-2 bound go-up; trigger 'layer2_bound'): true for the stop that used to end a run at layer 2's revision bound. Automatic: no person's choice is read (canSendUp, the layer-1 person's choice, is untouched). The caller (src/chain.js) acts on it only when a pass is left; the stop stands otherwise. NOT the ladder of src/ladder.js. */
export const layer2BoundGoUp = stop => stop?.kind === 'layer_bound' && stop.why === 'revisions' && stop.layer === 2;
/** 0.8.4 M1 COMPLETE U2 (T4c; N5, the shipped form of CA1): true for the stop that ends a pass at layer 1's revision bound. AUTOMATIC: no person's choice is read (the person's `--send-up`, `canSendUp`, is the same stop and is turned off since 1 Nov 2026; a recorded choice of an older run is read first). The caller (src/chain.js) acts on it only when the held go-up line is recorded and a pass is left; the stop stands otherwise. */
export const layer1BoundGoUp = stop => stop?.kind === 'layer_bound' && stop.why === 'revisions' && stop.layer === 1;
/** The identity of one stop: its kind, overseer round and pass. A choice names it, so re-typing the same command (after the limit screen, say) never counts twice. */
export const stopIdOf = stop => `${stop.kind}:${stop.overseer_round}:${stop.pass}${stop.kind === 'layer_bound' && stop.why === 'final_read' && Number.isInteger(stop.attempt) ? `:final_read${stop.attempt}` : ''}${stop.kind === 'budget_stop' && typeof stop.label === 'string' ? `:${stop.label}${typeof stop.sha === 'string' && /^[0-9a-f]{12,64}$/.test(stop.sha) ? `:${stop.sha.slice(0, 12)}` : ''}` : ''}`;   // 0.8.4 (relay of --finish-now at a spending stop): a spending stop names the stage it stopped before; an answer is bound to the stop by the hash of its quote, which carries the figures any raise changes   // 0.8.4 S16 (D): a second stop at the final read (after a continue) in the same round and pass is another stop; every older id is byte for byte what it was

/** What `--continue` adds when the person gives no number: one more overseer round at the cap; the layer's own bound again for revisions; the allowed silent passes again for an unheard seat. */
export function defaultAdd(stop, config) {
  if (stop.kind === 'overseer_cap') return 1;
  if (stop.kind === 'stall_stop') return 0;   // 0.8.4 S5 (C&C): a continue at a top-layer stall adds no overseer round; the stalled objections are counted afresh
  if (stop.why === 'unheard') return REASKS_NO_REVISE;
  if (stop.why === 'final_read') return 0;   // 0.8.4 S16 (D): a continue at the final-read stop adds no pass and no limit: it is one more final read
  return roundLimitsOf(config).layerRevisions?.[stop.layer] ?? 1;
}

/**
 * How the person's recorded choice ends THIS stop (0.8.4, finish at once): 'finish_now' (the run ends here, the final read and the ending exchange are not run), 'finish' (it ends here and the usual last steps follow) or null (no finish recorded).
 * One definition for the two places the pass loop consumes a finish; a recorded finish_now wins when both are on file for the stop.
 */
export function finishChoiceOf(choices, stopId) {
  const own = (Array.isArray(choices) ? choices : []).filter(c => c && c.stop === stopId);
  return own.some(c => c.choice === 'finish_now') ? 'finish_now' : own.some(c => c.choice === 'finish') ? 'finish' : null;
}
/** 0.8.4 (finish at once, relayed): true when the finish (finish_now, else finish) that ends THIS stop was the person's words relayed by the handling session (the entry carries `relayed: true`, src/stop-decision.js). A typed finish_now, or none, is false. */
export const finishRelayedOf = (choices, stopId) => { const own = (Array.isArray(choices) ? choices : []).filter(c => c && c.stop === stopId); const deciding = own.find(c => c.choice === 'finish_now') ?? own.find(c => c.choice === 'finish'); return deciding?.relayed === true; };
/** The words every line a person reads adds to "at the person's choice" when the choice was relayed (A-DRAFT LAD-F14): the one spelling, read by the run log, the board, the run status and the stop reason. */
export const RELAYED_TAIL = ', relayed by the handling session';
export const relayedTail = x => (x?.relayed === true ? RELAYED_TAIL : '');

/** The ONE shape of a roundChoices entry (run.json), written by the standalone `--continue`/`--finish` and by a tree sitting applying a member's recorded choice. With no `config` a continue carries no `add`: the reader (cli.js) fills it with defaultAdd. */
export function roundChoiceEntry(stop, choice, config = null) {
  return { stop: stopIdOf(stop), choice, kind: stop.kind, overseer_round: stop.overseer_round, ...(stop.layer ? { layer: stop.layer } : {}), ...(stop.why ? { why: stop.why } : {}), ...(stop.why === 'final_read' && stop.finish_read_used === true ? { finish_read_used: true } : {}), ...(choice === 'continue' ? (config ? { add: defaultAdd(stop, config) } : {}) : { add: 0 }) };
}

/**
 * The limits a run works under once the person's choices are applied (pure; the chain file is never changed). Choices are applied where they were made: an overseer-round extension is global, a layer or silent-pass
 * extension belongs to the overseer round it was made in. `passes` (the backstop ceiling) uses the LOOSE sum of every extension, so the replay can never hit the old ceiling before advance() does; it counts the lone-heard pass's two re-ask passes on top of the silent-seat extensions.
 */
export function effectiveLimits(config, choices = []) {
  const base = roundLimitsOf(config);
  if (base.ladder) {   // a ladder chain: no caps; only the silent-seat bound (and the person's recorded continues at it) is read
    const cont = (Array.isArray(choices) ? choices : []).filter(c => c?.choice === 'continue' && Number.isInteger(c.add) && c.add > 0 && c.kind === 'layer_bound' && c.why === 'unheard');
    return { ...base, advanceConfigAt: round => ({ maxOverseerRounds: null, layerRevisions: null, reasks: UNHEARD_PASSES_BEFORE_STOP + cont.filter(c => c.overseer_round === round).reduce((n, c) => n + c.add, 0) }) };
  }
  if (base.overseer === null) return { ...base, advanceConfigAt: () => null };
  const cont = (Array.isArray(choices) ? choices : []).filter(c => c?.choice === 'continue' && Number.isInteger(c.add) && c.add > 0);
  const sum = pred => cont.filter(pred).reduce((n, c) => n + c.add, 0);
  const capAdd = sum(c => c.kind === 'overseer_cap');
  const layerAdd = layer => sum(c => c.kind === 'layer_bound' && c.why === 'revisions' && c.layer === layer);
  const silentAdd = sum(c => c.kind === 'layer_bound' && c.why === 'unheard');
  const total = { maxOverseerRounds: base.overseer + capAdd, layerRevisions: { 1: base.layerRevisions[1] + layerAdd(1), 2: base.layerRevisions[2] + layerAdd(2) }, reasks: UNHEARD_PASSES_BEFORE_STOP + silentAdd };
  // A send-up uses no revision (layerRevisions are unchanged) but the escalation it makes needs passes: one for layer 2 to review and rule, the layer-2 loop it may still need (b2), and the top layer's read. Each recorded send-up grants layerRevisions[2] + 2 passes on the backstop ceiling.
  const sendUps = (Array.isArray(choices) ? choices : []).filter(c => c?.choice === 'send_up' && c.kind === 'layer_bound' && c.why === 'revisions' && c.layer === 1).length;
  return {
    passes: passCeiling({ ...total, reasks: total.reasks + REASKS_NO_REVISE }) + sendUps * (base.layerRevisions[2] + 2), overseer: total.maxOverseerRounds, layerRevisions: total.layerRevisions,
    advanceConfigAt: round => ({
      maxOverseerRounds: total.maxOverseerRounds,
      layerRevisions: {
        1: base.layerRevisions[1] + sum(c => c.kind === 'layer_bound' && c.why === 'revisions' && c.layer === 1 && c.overseer_round === round),
        2: base.layerRevisions[2] + sum(c => c.kind === 'layer_bound' && c.why === 'revisions' && c.layer === 2 && c.overseer_round === round),
      },
      reasks: UNHEARD_PASSES_BEFORE_STOP + sum(c => c.kind === 'layer_bound' && c.why === 'unheard' && c.overseer_round === round),
    }),
  };
}

/**
 * What ended the run's panel, as ONE plain word (report.json answer.ending, beside an answer given after the panel). It was a chain of ternaries inside runChain; moved here so a test can ask it. ROADMAP 83: an EARLY FINISH is its own
 * ending, `early_finish`, and it is never `finish_chosen` (that word says a PERSON chose to finish at a limit; nobody did). Order matters only for the endings that cannot coincide.
 */
export function panelEnding({ passed, finishedStop = null, earlyFinish = null, layerStop = null, noHeardReviewer = null, notQuorate = null, escalatedEnd = null }) {
  if (passed === true) return 'signed_off';
  if (escalatedEnd) return 'escalated_signoff';   // stall escalation: the top layer signed off with layers passed over; never `signed_off` (passed stays false)
  if (earlyFinish) return 'early_finish';
  if (finishedStop?.chosen === 'rule') return 'rule_no_handler';   // 0.8.4 S16 (E): the run has no handling session, nobody chose; never `finish_chosen`
  if (finishedStop) return 'finish_chosen';
  if (layerStop) return 'layer_stop';
  if (noHeardReviewer) return 'no_reviewer_heard';
  if (notQuorate) return 'not_quorate';
  return 'not_signed_off';
}
