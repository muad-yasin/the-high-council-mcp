// M1 (S19, C&C's option (b)): ONE held() read decides whether the judges are TOLD to rate and whether a missing rating is REFUSED.
// Ratings themselves are recorded on every layered unanimous chain (src/severity.js ratingsRecorded); what the word gates is the DEMAND: the rating sentences in every prompt (the critic and final-read system, the exchange post and reply, the writer's, the dispute and the handoff prompts, the
// ledger frames) and the parser's strict refusal (`normaliseCritique(..., { severity })`). While `ratingDemand` is not part of src/roles.js, `held('ratingDemand')` is undefined, every prompt is byte-identical to a chain without ratings, and a failure with no rating reads as unrated (counted as rated 4 or above: it holds the sign-off). After the release re-record it is recorded and the demand reaches every layered chain.
// The prompt builders (src/stage-system.js, src/handoff-prompt.js), the cost estimate that prices them and the parsers in src/chain.js all read THIS function, so the text a seat is sent, the text the estimate prices and the parser's rule can never disagree: a prompt without the demand next to a strict parse would make every verdict unreadable.
import { held } from './held-roles.js';
import { ratingsRecorded } from './severity.js';

/** True when the rating demand (the sentences and the strict refusal) is in force for this chain: a layered unanimous chain, and the held word recorded. */
export const ratingsDemanded = config => ratingsRecorded(config) && typeof held('ratingDemand') === 'function';
