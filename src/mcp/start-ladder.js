// start_run and the ladder (084/mcp-start; A-DRAFT, every sentence a model or a person reads here is A-DRAFT until the owner approves it).
// The CLI start line carries the ladder as `--ladder`, `--ladder-exchange N` and `--ladder-credit N` (src/cli.js; the setting is saved in run.json and a resume keeps it, src/ladder.js). start_run took none of them, so a run that needs
// the ladder could only be started from a terminal. These three arguments carry the same settings: one place for their words, their bounds and the refusal, used by start_run in src/mcp/server.js.
// The bound of the exchange rounds is src/ladder.js's own (LADDER_EXCHANGE_MAX), so ladderOf and the schema cannot drift apart (test/mcp-start-ladder.test.js compares them).
// Not here, on purpose: resume_run takes no ladder (a saved ladder is never replaced, and a run started plain that is to continue under the ladder is a terminal resume, `--resume ... --ladder --ladder-credit N`), and dry_run takes none
// (the dry run prices the chain and does not read the ladder).
import { z } from 'zod';
import { ladderOf, LADDER_BLOCK, LADDER_VISITS, LADDER_EXCHANGE_MAX } from '../ladder.js';
import { shortExchangeOn } from '../short-exchange.js';

// 0.8.4 S6 (Q2; C&C: REFUSE, not ignore): once the shortened exchange is in force (the pair W5 + W14 recorded) layers 2 and 3 have their own exchange round and `ladder_exchange` is refused with any value, before a run id is taken. The three sentences that mention it are functions of that
// state: the held state is the text this file always had, byte for byte; the zod description and the exported constants are read when the module loads (in production: the recorded state), the functions at the call (a test injects the pair). A-DRAFT, every word.
const EXCHANGE_DESCRIPTION_HELD = `rounds of the layer exchange at layers 2 and 3, 0 to ${LADDER_EXCHANGE_MAX} (layer 1's exchange in a pass ends when a round has no withdrawal and no new objection, at most three rounds); goes with ladder: true. Left out: 0.`;
const START_DESCRIPTION_HELD = "ladder, ladder_exchange and ladder_credit set the ladder for a chain with exactly three reviewer layers (the CLI's --ladder, --ladder-exchange and --ladder-credit).";
const NEEDS_LADDER_HELD = 'ladder_exchange and ladder_credit go with ladder: true. Nothing was started and nothing was spent.';
export const ladderExchangeDescription = () => (shortExchangeOn() ? 'no longer used: layers 2 and 3 have their own exchange round, so any value is refused. Leave it out.' : EXCHANGE_DESCRIPTION_HELD);   // A-DRAFT
export const ladderStartDescription = () => (shortExchangeOn() ? "ladder and ladder_credit set the ladder for a chain with exactly three reviewer layers (the CLI's --ladder and --ladder-credit)." : START_DESCRIPTION_HELD);   // A-DRAFT
export const ladderNeedsLadderSentence = () => (shortExchangeOn() ? 'ladder_credit goes with ladder: true. Nothing was started and nothing was spent.' : NEEDS_LADDER_HELD);   // A-DRAFT
/** The refusal of `ladder_exchange` (any value) once the shortened exchange is in force (A-DRAFT; the CLI's own sentence, with this tool's argument name). */
export const LADDER_EXCHANGE_NOT_USED_SENTENCE = 'ladder_exchange is no longer used: layers 2 and 3 have their own exchange round. Leave it out. Nothing was started and nothing was spent.';   // A-DRAFT

/** The three start_run arguments (a zod shape, spread into the tool's own). */
export const LADDER_START_SHAPE = {
  ladder: z.boolean().optional().describe(`true to run the chain under the ladder: a block of ${LADDER_BLOCK} layer-1 revisions, then a pass that starts at layer 2; after ${LADDER_VISITS} such layer-2 visits the next block ends at layer 3. It needs a chain with exactly three reviewer layers and either overseer rounds or its own \`ladder\` key; anything else is refused and nothing is started. The setting is saved in the run, so a resume keeps it. Left out: the chain decides: one with a \`ladder\` key runs the ladder, any other runs without it.`),   // A-DRAFT
  ladder_exchange: z.number().int().min(0).max(LADDER_EXCHANGE_MAX).optional().describe(ladderExchangeDescription()),   // A-DRAFT
  ladder_credit: z.number().int().min(0).optional().describe('how many of the first passes run under the plain rules before the ladder starts (they count as its first block), a whole number; goes with ladder: true. Left out: 0.'),   // A-DRAFT
};

/** The sentence added to start_run's description (A-DRAFT). */
export const LADDER_START_DESCRIPTION = ladderStartDescription();   // A-DRAFT

/** The refusal of an exchange or a credit without the ladder (A-DRAFT; the CLI's own sentence, with this tool's argument names). */
export const LADDER_NEEDS_LADDER_SENTENCE = ladderNeedsLadderSentence();   // A-DRAFT

/**
 * What start_run adds to the CLI's argument list for the ladder: { args: [...] } (empty when no ladder was asked), or { refused: sentence } with nothing to start.
 * ladder_exchange or ladder_credit without `ladder: true` is refused here, before a run id is taken or a child is spawned (the CLI refuses it too, at its start). The schema already holds the bounds; ladderOf is the backstop for a caller that skips it.
 */
export function ladderStartArgs({ ladder, ladder_exchange: exchange, ladder_credit: credit } = {}) {
  if (exchange !== undefined && shortExchangeOn()) return { refused: LADDER_EXCHANGE_NOT_USED_SENTENCE };   // 0.8.4 S6 (Q2): any value, with or without `ladder: true`, before a run id is taken
  if (ladder !== true) return exchange !== undefined || credit !== undefined ? { refused: ladderNeedsLadderSentence() } : { args: [] };
  if (!ladderOf({ exchange, credit })) return { refused: 'ladder_exchange is a whole number from 0 to ' + LADDER_EXCHANGE_MAX + ' and ladder_credit a whole number from 0. Nothing was started and nothing was spent.' };   // A-DRAFT
  return { args: ['--ladder', ...(exchange !== undefined ? ['--ladder-exchange', String(exchange)] : []), ...(credit !== undefined ? ['--ladder-credit', String(credit)] : [])] };
}
