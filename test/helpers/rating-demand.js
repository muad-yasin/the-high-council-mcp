// S19 (M1): the rating demand is ONE held word (`ratingDemand`, test/held-prompts/held-084-b.js; src/ratings-demand.js). While src/roles.js does not export it the judges are not told to rate and a missing rating reads as unrated; a test of the demand injects it, a test of the held state forces it off (so it keeps proving the held path after the release re-record, when the name is recorded and `setHeldForTest(null)` would return the real function).
import * as HB084 from '../held-prompts/held-084-b.js';
import * as HS8 from '../held-prompts/held-084-s8.js';

/** The held map that puts the rating demand in force (merge it into a bigger map with `{ ...HELD, ...DEMAND }`). */
export const DEMAND = Object.freeze({ ratingDemand: HB084.ratingDemand });
/** The held map that keeps the demand OUT, whatever src/roles.js records. */
export const NO_DEMAND = Object.freeze({ ratingDemand: undefined });

/** The held map that puts the sorting in force: the rating demand AND all three S8 words (src/sorting.js sortingOn needs all four). */
export const SORTING = Object.freeze({ ratingDemand: HB084.ratingDemand, layerThreeSortingRule: HS8.layerThreeSortingRule, layerThreeSortingForm: HS8.layerThreeSortingForm, layerThreeSortingItems: HS8.layerThreeSortingItems });
