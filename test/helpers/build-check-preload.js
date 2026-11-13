// A preload for a CLI child (`node --import test/helpers/build-check-preload.js src/cli.js ...`): the build-check wording (buildCheckSystem, buildCheckUser, buildCheckReasonsNote of test/held-prompts/held-084-b.js) and the rating demand are in force for that process
// only, so a real-verb test of the build check and the `ending` record runs the recorded state whatever src/roles.js records (C&C's Q-a ADDENDUM: ONE held read gates the check and the `ending` record).
import { setHeldForTest } from '../../src/held-roles.js';
import { DEMAND } from './rating-demand.js';
import { CHECK } from './build-check.js';

setHeldForTest({ ...DEMAND, ...CHECK });
