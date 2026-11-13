// 0.8.4 S11 (the cost output of Part 0): the most Council CALLS a layered unanimous chain with overseer rounds can make, counted in calls and never in money. A pure file: it reads the chain's config and the held-text registry
// (through src/call-gates.js) and nothing else; no I/O, no model call, no clock. estimateChainRows (src/cost.js) is NOT read: the USD maximum and this ceiling are different quantities (the USD maximum leaves the re-ask
// PASSES out by the 15 Oct definition and prices no stall rows; C&C S11-R2), and the equality between them is a test (test/call-ceiling.test.js, R-S5) that names every difference.
//
// Maximum = X + V + Ia + Rk + Pn + Cl + S + CR + Nd   (n = 0 continues, n_u = 0), the plan's Part 0 (REFERENCE.md C2) plus two terms C&C ruled in (S11-R1, S11-R2, Muad's OWNER 6 pick of 03 Nov 2026):
//   X  exchange calls, with F3's factor 3 (REASKS_NO_REVISE + 1: a seat that gave no usable reply may be asked again on the same draft, at most 2 more PASSES); E_r = the escalation extras inside it
//   V  blind reviews, with the factor 3
//   Ia the IN-PASS re-asks (chain.js: a seat not heard is asked again up to IN_PASS_REASKS_PER_SEAT times inside one pass) on EVERY blind-review call the figure counts: V, the reviews inside E_r and the reviews inside S.
//      Reading B of S11-R2: the in-pass re-ask is a second mechanism that stacks on the re-ask passes, up to 3 attempts x (1 + 2) = 9 calls per seat per productive pass (a bound of the rules: it needs a heard clean seat in the pass)
//   Rk the S6 `-reask3` call (one verdict call more for a top-layer judge whose reply ended "sign-off: no" with nothing of its own standing), with the factor 3
//   Pn proposer returns: 3P(C-1), live only behind callGatesOf(config).proposerReturn (S9)         Cl final reads: 2 x K3 per read, two reads per run (FINAL_READS_PER_RUN, S16)
//   S  the stale-rerun bound (CA2): ONE rerun pass the guard permits, with the factor 3    CR the manners step: 0 (R32)    Nd the ending exchange, with the factor 3
// A term is live when the code path that makes those calls can run in this tree with this chain (built, switch on, held text recorded): src/call-gates.js. A re-send of the SAME call (a network resume, an Anthropic seat's
// same-effort retry) is not a call the rules schedule and is outside the count; the USD maximum carries its cost.
//
// NAMED LIMITS: Part 0's formulas are defined for three layers numbered 1, 2, 3 (K1, K2, K3 and the two revision bounds); any other shape returns null. A = K in every layer (a standing objection in every pass), as Part 0 assumes.
// The review counts inside E_r and S rest on CA5's split of one blind review and one ruling per judge, which CA5 itself marks UNVERIFIED; Rk with the factor 3 and the component gating of S are derivations of this unit.
import { roundLimitsOf, UNHEARD_PASSES_BEFORE_STOP, REASKS_NO_REVISE } from './overseer-rounds.js';
import { EXCHANGE_ROUNDS, LAYER_ONE_EXCHANGE_ROUNDS, exchangeJudgeCount } from './layer-debate.js';
import { IN_PASS_REASKS_PER_SEAT, SOLO_ASKS_PER_SEAT } from './cost.js';
import { extraPartCalls } from './final-read-room.js';
import { callGatesOf, stallWindowOf } from './call-gates.js';

/** Proposer returns (CA3): one return costs at most 3P calls (P blind alternatives, P posts, P answers) after each overseer round but the last. Built by S9 (src/proposer-return.js); the term is live only behind callGatesOf(config).proposerReturn (decisions rule on, the words recorded, P >= 1). */
export const PROPOSER_RETURNS_BUILT = true;
export const proposerReturnCalls = (P, C) => 3 * P * (C - 1);
/** Final reads per run: Part 0 prices two (the read at the ending and the read before a finish at the stop of Q9(e)); the second site (the read before a finish) is built later in S16; the ceiling counts it from the first S16 commit on, so the figure errs high until then. */
export const FINAL_READS_PER_RUN = 2;
/** Calls of one exchange (Q4(e)): a round costs its K posts and, when at least two judges raise, one reply from each raiser (K + A); with one raiser the round costs K (K - 1 posters and the one reply); a round of only support or no-view posts costs its K posts and no reply (A = 0). `aPerRound` = the raisers of each round. */
export const exchangeCallsOf = (K, aPerRound) => aPerRound.reduce((t, A) => t + (A >= 2 ? K + A : K), 0);

const F3 = UNHEARD_PASSES_BEFORE_STOP + REASKS_NO_REVISE + 1;   // 0.8.4: a silent seat costs no repeated pass before the stop (its solo ask replaces them) EXCEPT the lone-heard pass of layer 1 (one judge heard and objecting, its peer silent), which keeps its two re-ask passes (the owner, 10 Nov 2026): the worst case still counts them
const IN_PASS_ASKS_PER_SEAT = IN_PASS_REASKS_PER_SEAT + SOLO_ASKS_PER_SEAT;   // the in-pass re-asks and the solo ask, all at the re-ask price

/**
 * The call ceiling for `config`, or null when the chain is not a layered unanimous chain with overseer rounds and three layers numbered 1, 2, 3.
 * reading 'per_round' (PR: the code's own reading, the layer revisions b1 and b2 per overseer round) or 'run_wide' (PN: the pending P1 reading, tested and printed nowhere).
 */
export function callCeilingOf(config, { reading = 'per_round' } = {}) {
  const limits = roundLimitsOf(config);
  if (limits.overseer === null || config?.signoff !== 'unanimous') return null;
  const g = callGatesOf(config);
  if (!g.layered || g.layerNumbers.join() !== '1,2,3') return null;
  const critics = config.seats.critics;
  const K = n => critics.filter(c => c.layer === n).length;
  const [K1, K2, K3] = [K(1), K(2), K(3)];
  const C = limits.overseer; const b1 = limits.layerRevisions[1]; const b2 = limits.layerRevisions[2];
  const w = Math.max(1, stallWindowOf(config));
  const P = Array.isArray(config.seats.proposers) ? config.seats.proposers.length : 0;
  const run = reading === 'run_wide';

  // ---- the live pieces (A = K in every layer)
  const exchangeOk = exchangeJudgeCount(config) >= 2;
  const lowEx = exchangeOk ? exchangeCallsOf(K1, Array(LAYER_ONE_EXCHANGE_ROUNDS).fill(K1)) : 0;          // 3 x (K1 + A1) (0.8.4: the layer-1 exchange stops after 3 rounds)
  const endEx = exchangeOk ? exchangeCallsOf(K1, Array(EXCHANGE_ROUNDS).fill(K1)) : 0;                   // the ENDING exchange keeps its 7 rounds: 7 x (K1 + A1)
  const up2 = g.shortExchange && K2 >= 2 ? exchangeCallsOf(K2, [K2]) : 0;                             // K2 + A2 = 6
  const up3 = g.shortExchange && K3 >= 2 ? exchangeCallsOf(K3, [K3]) : 0;                             // K3 + A3 = 4
  const eventsLive = g.stallPass || g.layerOnePass;                                                    // a stall escalation or the N5 send-up at the layer-1 bound
  const rev2 = eventsLive ? K2 : 0;                                                                    // CA5: the receiving layer's blind review ...
  const rul2 = eventsLive && g.rulingLive ? K2 : 0;                                                    // ... and its ruling (the ruling words are tested INSIDE the pass)
  const ex2 = eventsLive ? up2 : 0;                                                                    // ... and the shortened exchange
  const rev3 = K3;                                                                                     // the layer-2-bound go-up pass (chain.js layer2BoundGoUp) has no held-text gate: layer 3 reviews blind
  const rul3 = (eventsLive && g.rulingLive) || g.goUpRulingLive ? K3 : 0;
  const ex3 = up3;
  const leg2 = rev2 + rul2 + ex2; const leg3 = rev3 + rul3 + ex3;                                      // 3K2 + A2 = 12 per event, 3K3 + A3 = 8 per round when all live
  const p1 = b1 + b2 + 1; const p2 = b2 + 1;

  // ---- counts of the layered loop for the reading
  let base; let extras; let blind; let erRev;
  if (!run) {
    const ev = Math.max(0, p1 - w + 1);                                                                // events per overseer round: layer-1 passes minus the window plus 1
    base = C * (lowEx * p1 + up2 * p2 + up3);                                                          // 3072
    extras = C * (ev * leg2 + leg3);                                                                   // E_r over the run: 560
    blind = C * (p1 * K1 + p2 * K2 + K3);                                                              // V before the factor 3: 288
    erRev = C * (ev * rev2 + rev3);
  } else {
    const m1 = C * (1 + b1) + b2; const m2 = C + b2;
    const ev = Math.max(0, m1 - C * (w - 1));
    base = lowEx * m1 + up2 * m2 + up3 * C;                                                            // 2142
    extras = ev * leg2 + C * leg3;                                                                     // 380
    blind = m1 * K1 + m2 * K2 + C * K3;
    erRev = ev * rev2 + C * rev3;
  }
  // S: the one rerun the guard permits, 85 calls at T13's shape (exchange 56 + 6 + 4, the pass's 9 reviews, the escalation's rulings 2K2 + 2K3 = 10); it has no chain-level gate (a rerun is a resume event), its components follow their own gates
  const sPass = lowEx + up2 + up3 + (K1 + K2 + K3) + rev2 + rul2 + rev3 + rul3;
  const sRev = K1 + K2 + K3 + rev2 + rev3;

  const terms = {
    X: F3 * (base + extras),
    V: F3 * blind,
    Ia: 0, Rk: g.signoffReask && K3 >= 2 ? F3 * K3 * C : 0,
    Pn: PROPOSER_RETURNS_BUILT && g.proposerReturn ? proposerReturnCalls(P, C) : 0,
    Cl: g.finalRead ? 2 * K3 * FINAL_READS_PER_RUN : 0,
    S: F3 * sPass, CR: 0,
    Nd: g.endingExchange && exchangeOk ? F3 * endEx : 0,
  };
  const parts = { IaV: IN_PASS_ASKS_PER_SEAT * terms.V, IaE: IN_PASS_ASKS_PER_SEAT * F3 * erRev, IaS: IN_PASS_ASKS_PER_SEAT * F3 * sRev };
  terms.Ia = IN_PASS_ASKS_PER_SEAT * (terms.V + F3 * erRev + F3 * sRev);   // reading B: the in-pass term on every blind-review call the figure counts (the three `parts` are the same sum, shown apart)
  const maximum = Object.values(terms).reduce((t, n) => t + n, 0);

  // ---- one continue = one more overseer round (CA1): PR adds one round; PN adds the pass counts of one more round (1 + b1 layer-1 passes, one layer-2 pass, one layer-3 verdict)
  let cBase; let cExtras; let cBlind; let cErRev;
  if (!run) {
    const ev = Math.max(0, p1 - w + 1);
    cBase = lowEx * p1 + up2 * p2 + up3; cExtras = ev * leg2 + leg3; cBlind = p1 * K1 + p2 * K2 + K3; cErRev = ev * rev2 + rev3;
  } else {
    const ev = Math.max(0, (1 + b1) - (w - 1));
    cBase = lowEx * (1 + b1) + up2 + up3; cExtras = ev * leg2 + leg3; cBlind = (1 + b1) * K1 + K2 + K3; cErRev = ev * rev2 + rev3;
  }
  const perContinue = F3 * (cBase + cExtras) + F3 * cBlind + (PROPOSER_RETURNS_BUILT && g.proposerReturn ? 3 * P : 0) + K3
    + IN_PASS_ASKS_PER_SEAT * (F3 * cBlind + F3 * cErRev) + (terms.Rk ? F3 * K3 : 0);
  const rerunPass = sPass + IN_PASS_ASKS_PER_SEAT * sRev;                                            // one stale-rerun pass with its in-pass re-asks, no factor 3 (n_u is counted outside F3)
  const untilNoReply = { perPass: rerunPass, perContinue: 2 * rerunPass, handlingBound: 2 * (2 * rerunPass) };   // T13i (170 -> 226), c_u (340 -> 452): the handling session makes at most 2 such continues (CA1)

  // ---- W_api: the writer's or reviser's own calls, only when that seat is an API seat (not the handling session)
  const writer = config.seats.reviser || config.seats.builder;
  const apiWriter = writer && writer.provider !== 'external'
    ? (run ? { calls: (C * (1 + b1) + b2) + (C + b2) + C + 2, perContinue: (1 + b1) + 1 + 1 } : { calls: C * (p1 + p2 + 1) + 2, perContinue: p1 + p2 + 1 })
    : null;

  // ---- what the USD maximum's rows hold, by the same formula (PR, no factor 3, no E_r): the counting equality of test/call-ceiling.test.js compares these with the `times` of estimateChainRows(config, { maximum: true })
  const rowTerms = {
    panel: C * (p1 * K1 + p2 * K2 + K3),
    inPass: IN_PASS_ASKS_PER_SEAT * C * (p1 * K1 + p2 * K2 + K3),
    layer1Exchange: C * p1 * lowEx,
    upperExchange: C * (p2 * up2 + up3),
    reask3: terms.Rk ? K3 * C : 0,
    ruleBound: g.layerOnePass && g.rulingLive ? K2 * C * p2 : 0,
    ruleGoUp: g.goUpRulingLive && K2 > 0 ? K3 * C : 0,
    endingExchange: g.endingExchange && exchangeOk ? endEx : 0,
    finalRead: g.finalRead ? 2 * K3 : 0,
    proposerReturn: g.proposerReturn ? (P >= 2 ? 3 * P : P) * (C - 1) : 0,   // S9: the rows hold the calls a return CAN make (a lone proposer has nothing to read, so one call)
  };
  const out = {
    reading: run ? 'run_wide' : 'per_round',
    inputs: { K: [K1, K2, K3], C, b1, b2, w, P },
    maximum, terms, parts, base: run ? base : C * (lowEx * p1 + up2 * p2 + up3),
    perContinue, untilNoReply, apiWriter,
    manners: { pointsPerRun: C + 1, perPoint: 0, total: terms.CR },                                  // CA8, R32: no separate manners call at any of the C + 1 agreement points
    finalReads: { perRead: 2 * K3, readsPerRun: FINAL_READS_PER_RUN, total: terms.Cl, perExtraPart: extraPartCalls(K3, 2) },   // S16 (T21bp): Cp = 2 x K3 x (p_L - 1), the price of ONE extra part; not in the maximum (p_L is not known before a run)
    live: { lowExchange: lowEx > 0, upperExchange: up2 + up3 > 0, events: eventsLive, rulings: g.rulingLive, goUpRulings: g.goUpRulingLive, signoffReask: terms.Rk > 0, endingExchange: terms.Nd > 0, finalRead: g.finalRead, finalReadParts: g.finalReadParts, proposerReturns: PROPOSER_RETURNS_BUILT && g.proposerReturn },
    rowTerms,
  };
  out.words = callCeilingWordsOf(out);
  return out;
}

/** The sentences the dry run prints for a call ceiling (A-DRAFT, Review/WORDING_0.8.4.md S11-w1 to S11-w4): one string, one line per sentence group. A figure line names what the number is for and no term of the formula. */
export function callCeilingWordsOf(cc) {
  const lines = [
    `Calls: at most ${cc.maximum} model calls in a run with no continue added. That is the most this chain's rules allow; it counts calls, not money. A repeat of the same call (a dropped connection asked again, an Anthropic seat's one retry) is not in it: the dollar figures above include those. The limit you type is what stops a run.`,
    `Each continue you choose adds at most ${cc.perContinue} calls.`,
  ];
  if (cc.apiWriter) lines.push(`A writer or reviser on an API seat adds at most ${cc.apiWriter.calls} calls to that.`);
  lines.push(`If a seat gives no usable reply, one continue adds at most ${cc.untilNoReply.perContinue} calls; the handling session can make at most 2 of these on its own, so at most ${cc.untilNoReply.handlingBound} more in all. That is a hard bound against a runaway, not something planned or expected.`);
  if (cc.live?.finalReadParts) lines.push(`The final read asks each judge of the top layer once; when the open objections do not fit a judge's input window it asks the judges again for the rest, in parts. Each extra part adds at most ${cc.finalReads.perExtraPart} calls (one call and one re-ask for each judge of the top layer), and the maximum of calls above does not count them: how many parts a run needs depends on its objections. A part the provider refuses for its size is split and asked again in halves; a list of n open objections and late findings takes at most 2 x n - 1 asks for each judge, and those asks are not in the maximum either.`);   // WORDING S16-w55d: said once the part sentence is recorded
  return lines.join('\n');
}
