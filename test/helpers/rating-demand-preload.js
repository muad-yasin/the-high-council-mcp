// A preload for a CLI child (`node --import test/helpers/rating-demand-preload.js src/cli.js ...`): the rating demand (DEMAND in test/helpers/rating-demand.js) is in force for that process only, so a real-verb test of a layered chain's ratings runs the demanded state whatever src/roles.js records (a child process has no setHeldForTest of its own). Test data only.
import { setHeldForTest } from '../../src/held-roles.js';
import { DEMAND } from './rating-demand.js';

setHeldForTest(DEMAND);
