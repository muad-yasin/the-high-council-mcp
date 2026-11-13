// 0.8.4 S11 (the cost output of Part 0): the CONFIG-LEVEL gates of the calls a layered unanimous chain with overseer rounds can make, in one place. The call ceiling (src/call-ceiling.js) and src/chain.js read the SAME
// booleans, so the number the dry run prints and the run that fires the call cannot drift apart (C&C S11-R2: "for S and E_r, the ceiling imports the gate chain.js itself uses to fire the call, never a restated expression").
// A pure file: it reads the config and the held-text registry (src/held-roles.js, through the predicates that already exist), calls no model and touches no file. It imports only leaf modules that src/cost.js already
// imports, so it adds no import cycle (nothing here imports chain.js, cost.js or escalation.js's callers).
//
// What is moved here, byte for byte in value:
//   - chain.js `layered` (every critic has a layer), `retained = answerBackOn && layered`, `ledgerOn = retained && layerNumbers.length >= 2` and `severityOn = ratingsDemanded(config)`:
//     `goUpOn` = ledgerOn && severityOn is the old `stallGoUpOn` (chain.js, the stall escalation) and the first three terms of the layer-1 go-up condition;
//   - `layerOnePass` = ledgerOn && severityOn && the held go-up line recorded (the layer-1 go-up's pass gate; neither it nor the stall gate tests the ruling words: they are tested INSIDE the pass, ruleOnEscalation);
//   - `stallWindowOf` = chain.js's stall window expression (3 in every shipped layered chain, 2 by the code's default);
//   - `finalReadOn` = the config part of cost.js's final-read rows gate.
// 0.8.4 S9 adds the proposer return's gates (decisionLevelOn, proposerSeatsOf, proposerReturnOn), read by chain.js, the call ceiling and cost.js's maximum rows alike.
import { held } from './held-roles.js';
import { ratingsDemanded } from './ratings-demand.js';
import { settingsOf, decisionLevelOn, proposerSeatsOf } from './stage-system.js';
import { shortExchangeOn, signoffRefusalOn } from './short-exchange.js';
import { endingExchangeOn } from './ending-exchange-prompts.js';
import { rulingActive, goUpRulingActive } from './escalation.js';
import { finalReadGate } from './final-read-gate.js';

/** The chain's stall window as chain.js reads it: `dispute.stall_rounds` when it is a whole number, else 2 (the code's default; E10 set 3 in the shipped layered chains only). */
export const stallWindowOf = config => (Number.isInteger(config.dispute?.stall_rounds) ? config.dispute.stall_rounds : 2);

/** The dispute stage is on (`dispute.enabled`): chain.js `disputeEnabled` and the stall pass gate below read this one term. */
export const disputeOn = config => config?.dispute?.enabled === true;

/** The layer-1 go-up's held line is recorded. Read at the moment the go-up fires (chain.js) and at the moment of the dry run (callGatesOf), as before. */
export const layerOneGoUpLineOn = () => typeof held('layerOneGoUpLine') === 'function';

/** A layered unanimous chain's final-read gate (0.8.4 S16: always on, no switch; the one predicate is src/final-read-gate.js). cost.js prices the final-read rows on it; the ceiling's Cl term is live on it. */
export const finalReadOn = config => finalReadGate(config);

// 0.8.4 S9: decisionLevelOn and proposerSeatsOf are defined in src/stage-system.js (beside settingsOf; the route words there read them) and re-exported here, so every reader (chain.js, the call ceiling, cost.js) still imports the gates from this file.
export { decisionLevelOn, proposerSeatsOf };
/** The proposer return can run: decision-level reading live and at least one proposer seat. The call ceiling's Pn, the cost rows and chain.js's trigger read this. */
export const proposerReturnOn = config => decisionLevelOn(config) && proposerSeatsOf(config).length >= 1;

/**
 * The gates, as booleans of the config and the held-text registry at the moment of the call.
 * `goUpOn` is chain.js's old `stallGoUpOn` (ledgerOn && severityOn); `stallPass` adds `dispute.enabled`; `layerOnePass` is the layer-1 go-up's pass gate.
 * `rulingLive` / `goUpRulingLive` are the ruling WORDS (src/escalation.js): a pass whose words are held still fires and asks no ruling.
 */
export function callGatesOf(config) {
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  const layered = critics.length > 0 && critics.every(c => c.layer !== undefined);
  const layerNumbers = layered ? [...new Set(critics.map(c => c.layer))].sort((a, b) => a - b) : [];
  const ledgerOn = settingsOf(config).answerBackOn && layered && layerNumbers.length >= 2;
  const severityOn = ratingsDemanded(config);
  const goUpOn = ledgerOn && severityOn;
  return {
    layered, layerNumbers, ledgerOn, severityOn, goUpOn,
    stallPass: disputeOn(config) && goUpOn,
    layerOnePass: goUpOn && layerOneGoUpLineOn(),
    rulingLive: rulingActive(held),
    goUpRulingLive: goUpRulingActive(held),
    shortExchange: shortExchangeOn(),
    signoffReask: signoffRefusalOn(),
    endingExchange: endingExchangeOn(),
    finalRead: finalReadOn(config),
    finalReadParts: finalReadOn(config) && typeof held('finalReadPartRule') === 'function',   // S16 (H, W42): parts exist only once the part sentence is recorded; the Cp line is said on it
    decisionLevel: decisionLevelOn(config),
    proposerReturn: proposerReturnOn(config),
  };
}
