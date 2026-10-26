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
export const REASKS_NO_REVISE = 2;

const isCount = n => Number.isInteger(n) && n >= 1;

/** The most passes advance() can allow before it stops. The unheard counter is CONSECUTIVE (any revise resets it, C&C ruling), so each of the (b1 + b2 + 1) productive passes of an overseer round (the allowed revisions and the climb
 *  that ends it) can be preceded by `reasks` unheard passes: maxOverseerRounds x (b1 + b2 + 1) x (reasks + 1). chain-lint refuses a maxRounds below it, so the old pass-cap ending is unreachable for these chains. null when the config is malformed. */
export function passCeiling({ maxOverseerRounds, layerRevisions, reasks = REASKS_NO_REVISE } = {}) {
  const b1 = layerRevisions?.[1]; const b2 = layerRevisions?.[2];
  if (!isCount(maxOverseerRounds) || !isCount(b1) || !isCount(b2) || !Number.isInteger(reasks) || reasks < 0) return null;
  return maxOverseerRounds * (b1 + b2 + 1) * (reasks + 1);
}

export function newRoundState() {
  return { overseerRound: 1, passInRound: 0, used: { 1: 0, 2: 0 }, noRevise: 0 };
}

export function advance(config, state, pass) {
  const { maxOverseerRounds, layerRevisions } = config || {};
  const reasks = config?.reasks ?? REASKS_NO_REVISE;
  if (passCeiling({ maxOverseerRounds, layerRevisions, reasks }) === null) throw new RangeError('advance: maxOverseerRounds, layerRevisions {1,2} and reasks must be whole numbers >= 1 (>= 0 for reasks)');
  const s = { overseerRound: state.overseerRound, passInRound: state.passInRound + 1, used: { 1: state.used[1], 2: state.used[2] }, noRevise: state.noRevise };
  switch (pass?.outcome) {
    case 'layer_objected': {
      const layer = pass.layer;
      if (layer !== 1 && layer !== 2) throw new RangeError(`advance: layer_objected names layer 1 or 2, not ${JSON.stringify(layer)} (a layer-3 objection is an overseer_verdict)`);
      if (s.used[layer] >= layerRevisions[layer]) {
        return { state: s, action: 'stop', overseerRoundEnded: false, stop: { kind: 'layer_bound', why: 'revisions', layer, used: s.used[layer], bound: layerRevisions[layer], overseerRound: s.overseerRound } };
      }
      s.used[layer] += 1; s.noRevise = 0;
      return { state: s, action: 'revise', overseerRoundEnded: false };
    }
    case 'overseer_verdict': {
      if (pass.verdict === 'signed_off') return { state: s, action: 'done', overseerRoundEnded: true };
      if (pass.verdict !== 'objected') throw new RangeError(`advance: verdict is signed_off or objected, not ${JSON.stringify(pass.verdict)}`);
      if (s.overseerRound >= maxOverseerRounds) return { state: s, action: 'stop', overseerRoundEnded: true, stop: { kind: 'overseer_cap', rounds: s.overseerRound, cap: maxOverseerRounds } };
      return { state: { overseerRound: s.overseerRound + 1, passInRound: 0, used: { 1: 0, 2: 0 }, noRevise: 0 }, action: 'revise', overseerRoundEnded: true };
    }
    case 'unheard': {
      s.noRevise += 1;
      if (s.noRevise > reasks) return { state: s, action: 'stop', overseerRoundEnded: false, stop: { kind: 'layer_bound', why: 'unheard', layer: pass.layer ?? null, passes: s.noRevise, reasks, overseerRound: s.overseerRound } };
      return { state: s, action: 'ask_again', overseerRoundEnded: false };
    }
    default:
      throw new RangeError(`advance: unknown outcome ${JSON.stringify(pass?.outcome)}`);
  }
}

/**
 * The one reader of "how many rounds" for every consumer of a chain config (round-semantics 2a, C&C ruling 15 Oct 2026: derive, do not duplicate a key).
 * A chain with `maxOverseerRounds` + `layerRevisions` carries NO `maxRounds`: `passes` is then the derived passCeiling (the most advance() allows, so the old pass-cap ending is only a backstop) and
 * `overseer` is the number of overseer rounds; every other chain keeps `maxRounds ?? 2` passes and no overseer rounds. `layerRevisions` is returned for the estimate.
 * A malformed pair of new keys reads as no overseer rounds (chain-lint refuses such a file before a run).
 */
export function roundLimitsOf(config, { defaultPasses = 2 } = {}) {
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
  if (stop.why === 'unheard') return `the silent seat gets ${REASKS_NO_REVISE} more passes in this overseer round`;
  // BUG-D-010: `stop.bound` is the EXTENDED bound (the chain's base plus the continues already recorded for this overseer round), but `--continue` adds defaultAdd = the chain's BASE bound. A caller that holds the chain passes that amount as `add`; without it the stop's own bound is read, as before.
  const n = Number.isInteger(add) && add > 0 ? add : stop.bound;
  return Number.isInteger(n) && n > 0 && stop.layer ? `layer ${stop.layer} gets ${n} more ${n === 1 ? 'revision' : 'revisions'} in this overseer round`
    : 'it extends the limit that was reached';
};
/**
 * WHY a run stopped, in words, for the head of stopSentence. A stop read from report-partial.json carries its figures (cap, layer, bound, passes, overseer_round) and the sentence names them. A stop WITHOUT them (cli.js builds one, `{ kind }` alone, for a
 * tree member whose partial report cannot be read) says it generally: a figure that is not there is never printed as "undefined" or "null" (A-DRAFT: the general sentences). Pure.
 */
function whyOf(stop) {
  if (stop.kind === 'overseer_cap') return isCount(stop.cap) ? `all ${stop.cap} overseer rounds were used and the top layer still objected` : 'all its allowed overseer rounds were used and the top layer still objected';
  if (stop.kind === 'layer_bound' && stop.why === 'unheard') {
    return isCount(stop.layer) && isCount(stop.passes) && isCount(stop.overseer_round)
      ? `a seat in layer ${stop.layer} stayed silent for ${stop.passes} passes in a row in overseer round ${stop.overseer_round}` : 'a seat of a layer stayed silent for too many passes in a row';
  }
  if (stop.kind === 'layer_bound' && stop.why === 'revisions') {
    return isCount(stop.layer) && isCount(stop.bound) && isCount(stop.overseer_round)
      ? `layer ${stop.layer} needed more than its ${stop.bound} allowed revisions in overseer round ${stop.overseer_round} and still objects` : 'a layer needed more than its allowed revisions and still objects';
  }
  if (stop.kind === 'layer_bound') return 'a layer needed more than its allowed revisions, or a seat of a layer stayed silent for too many passes in a row';
  return 'an overseer limit was reached';
}
/** The GENERAL words for a stop kind (no figures), for a line that has only the kind: the first line of BOARD-partial.md (src/report-shape.js). Pure. */
export const stopWhyGeneral = kind => whyOf({ kind });
/**
 * The sentence a person reads when a layered run stops at the overseer-round cap, at a layer's revision bound or because a seat of a layer stays silent (E item for Muad's yes at M7; round-semantics 2b). It says it is NOT agreement, what is on disk, what was spent, and the
 * choices. `stop` is advance()'s stop plus { pass, overseer_round }. Pure.
 */
export function stopSentence(stop, { spentUsd = null, draftFile = null, runDir = '<run folder>', memberTail = null, add = null } = {}) {
  const why = whyOf(stop);
  const spent = spentUsd === null || spentUsd === undefined ? '' : ` Spent so far: $${Number(spentUsd).toFixed(2)}.`;
  const draft = draftFile ? ` The plan as it stands is in ${draftFile} in ${runDir}.` : '';
  const head = `THE RUN STOPPED, NOT AGREED, and is waiting for your choice: ${why}.${spent}${draft} Nothing more was paid for after this point. `;
  // A tree MEMBER is resumed only by its tree (src/tree-redirect.js): its text never names a direct --resume.
  if (memberTail) return `${head}\n\n${memberTail}`;
  return head
    + `To go on: council --resume ${runDir} --continue (${extendWords(stop, add)}; the run's spending limit still applies). To end it here: council --resume ${runDir} --finish (the dispute stage and the handoff run, the open objections are handed over, the result stays "not agreed"). `
    + `Or take the draft and revise it yourself outside the Council.`;
}

// ---- Round semantics 2b-ii: the person's choice at a stop (continue / finish), recorded in run.json `roundChoices` and applied on the replay.
/** The identity of one stop: its kind, overseer round and pass. A choice names it, so re-typing the same command (after the limit screen, say) never counts twice. */
export const stopIdOf = stop => `${stop.kind}:${stop.overseer_round}:${stop.pass}`;

/** What `--continue` adds when the person gives no number: one more overseer round at the cap; the layer's own bound again for revisions; the allowed silent passes again for an unheard seat. */
export function defaultAdd(stop, config) {
  if (stop.kind === 'overseer_cap') return 1;
  if (stop.why === 'unheard') return REASKS_NO_REVISE;
  return roundLimitsOf(config).layerRevisions?.[stop.layer] ?? 1;
}

/** The ONE shape of a roundChoices entry (run.json), written by the standalone `--continue`/`--finish` and by a tree sitting applying a member's recorded choice. With no `config` a continue carries no `add`: the reader (cli.js) fills it with defaultAdd. */
export function roundChoiceEntry(stop, choice, config = null) {
  return { stop: stopIdOf(stop), choice, kind: stop.kind, overseer_round: stop.overseer_round, ...(stop.layer ? { layer: stop.layer } : {}), ...(stop.why ? { why: stop.why } : {}), ...(choice === 'continue' ? (config ? { add: defaultAdd(stop, config) } : {}) : { add: 0 }) };
}

/**
 * The limits a run works under once the person's choices are applied (pure; the chain file is never changed). Choices are applied where they were made: an overseer-round extension is global, a layer or silent-pass
 * extension belongs to the overseer round it was made in. `passes` (the backstop ceiling) uses the LOOSE sum of every extension, so the replay can never hit the old ceiling before advance() does.
 */
export function effectiveLimits(config, choices = []) {
  const base = roundLimitsOf(config);
  if (base.overseer === null) return { ...base, advanceConfigAt: () => null };
  const cont = (Array.isArray(choices) ? choices : []).filter(c => c?.choice === 'continue' && Number.isInteger(c.add) && c.add > 0);
  const sum = pred => cont.filter(pred).reduce((n, c) => n + c.add, 0);
  const capAdd = sum(c => c.kind === 'overseer_cap');
  const layerAdd = layer => sum(c => c.kind === 'layer_bound' && c.why === 'revisions' && c.layer === layer);
  const silentAdd = sum(c => c.kind === 'layer_bound' && c.why === 'unheard');
  const total = { maxOverseerRounds: base.overseer + capAdd, layerRevisions: { 1: base.layerRevisions[1] + layerAdd(1), 2: base.layerRevisions[2] + layerAdd(2) }, reasks: REASKS_NO_REVISE + silentAdd };
  return {
    passes: passCeiling(total), overseer: total.maxOverseerRounds, layerRevisions: total.layerRevisions,
    advanceConfigAt: round => ({
      maxOverseerRounds: total.maxOverseerRounds,
      layerRevisions: {
        1: base.layerRevisions[1] + sum(c => c.kind === 'layer_bound' && c.why === 'revisions' && c.layer === 1 && c.overseer_round === round),
        2: base.layerRevisions[2] + sum(c => c.kind === 'layer_bound' && c.why === 'revisions' && c.layer === 2 && c.overseer_round === round),
      },
      reasks: REASKS_NO_REVISE + sum(c => c.kind === 'layer_bound' && c.why === 'unheard' && c.overseer_round === round),
    }),
  };
}

/**
 * What ended the run's panel, as ONE plain word (report.json answer.ending, beside an answer given after the panel). It was a chain of ternaries inside runChain; moved here so a test can ask it. ROADMAP 83: an EARLY FINISH is its own
 * ending, `early_finish`, and it is never `finish_chosen` (that word says a PERSON chose to finish at a limit; nobody did). Order matters only for the endings that cannot coincide.
 */
export function panelEnding({ passed, finishedStop = null, earlyFinish = null, layerStop = null, noHeardReviewer = null, notQuorate = null }) {
  if (passed === true) return 'signed_off';
  if (earlyFinish) return 'early_finish';
  if (finishedStop) return 'finish_chosen';
  if (layerStop) return 'layer_stop';
  if (noHeardReviewer) return 'no_reviewer_heard';
  if (notQuorate) return 'not_quorate';
  return 'not_signed_off';
}
