// The ladder (Muad's shape for B2, 29 Okt 2026): which layer a pass STARTS at, as a pure function of how the earlier passes ended. Nothing here reads a clock, a file or a provider.
//
// The order, once the ladder is running: layer 1 does a block of `block` revisions, then the next pass starts at layer 2 (one visit); after `visits` layer-2 visits the next block ends at layer 3 instead (one visit), and the count of
// layer-2 visits starts again. Every revision after an upper layer's objection goes back to layer 1 (a new block). A pass asks the layers from its floor upward, as the climb always has: a layer that signs off sends the plan up at once.
// Layer 2 signing off therefore reaches layer 3 in the same pass, and layer 3 signing off ends the run. Layer 3's `visits`-th visit without a sign-off is the end stop (chain.js turns it into the overseer-round cap: one layer-3 visit = one overseer round).
//
// `credit` = the number of passes that already ran under the plain rules (B2 passes 1-7: its seven layer-1 revisions are the first block). Passes up to `credit` follow today's code unchanged, which keeps every prompt of those passes
// byte-identical (a stage replays at $0 only when it answers the same prompt, src/cache-integrity.js); the ladder begins at pass credit + 1 with the first block already complete, so that pass starts at layer 2 (visit 1 of `visits`).
//
// state: { used1, l2, l3 }   used1 = layer-1 revisions in the current block, l2 = layer-2 visits since the last layer-3 visit, l3 = layer-3 visits so far
export const LADDER_BLOCK = 3;
export const LADDER_VISITS = 3;
// The most rounds of the layer exchange the ladder may ask at layers 2 and 3. One number for ladderOf below and the MCP start_run argument (src/mcp/start-ladder.js); the CLI's own check (src/cli.js, --ladder-exchange) spells the same bound as 0 to 7.
export const LADDER_EXCHANGE_MAX = 7;

const isCount = n => Number.isInteger(n) && n >= 1;

/** The normalised setting, or null when it is not a usable one. `block` and `visits` default to Muad's 3 and 3; `credit` to 0 (a run that starts under the ladder); `exchange` = the rounds of the layer exchange at layers 2 and 3 (0 = none; layer 1's exchange always runs N9's own loop: until a round changes nothing, at most seven). */
export function ladderOf(setting) {
  if (!setting || typeof setting !== 'object') return null;
  const block = setting.block ?? LADDER_BLOCK; const visits = setting.visits ?? LADDER_VISITS; const credit = setting.credit ?? 0; const exchange = setting.exchange ?? 0;
  if (!isCount(block) || !isCount(visits) || !Number.isInteger(credit) || credit < 0 || !Number.isInteger(exchange) || exchange < 0 || exchange > LADDER_EXCHANGE_MAX) return null;
  return { block, visits, credit, exchange };
}

/** The state at the first ladder pass: the credited passes count as a finished block, a run with no credit starts a block. */
export function newLadderState(ladder) {
  return { used1: ladder.credit > 0 ? ladder.block : 0, l2: 0, l3: 0 };
}

/** The layer the next pass starts at (1, 2 or 3). */
export function floorOf(ladder, state) {
  if (state.used1 < ladder.block) return 1;
  return state.l2 < ladder.visits ? 2 : 3;
}

/**
 * The state after a pass that ended with an OBJECTION (a revision follows). `reached` is the highest layer the pass asked (the one that objected). A layer-1 objection is one revision of the block; reaching layer 2 is a layer-2 visit
 * whatever layer the pass started at (layer 1 signing off sends the plan up at once and that counts as the block); reaching layer 3 is a layer-3 visit and starts the layer-2 count again. After an upper visit the plan goes back to layer 1.
 * Pure: returns a NEW state.
 */
export function afterObjection(state, reached) {
  if (reached === 1) return { ...state, used1: state.used1 + 1 };
  if (reached === 2) return { used1: 0, l2: state.l2 + 1, l3: state.l3 };
  return { used1: 0, l2: 0, l3: state.l3 + 1 };
}
