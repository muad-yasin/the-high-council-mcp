// A preload for a CLI child (`node --import test/helpers/held-off-preload.js src/cli.js ...`): the explicit off state of the held prompts (test/helpers/held-off.js) for that process only, so a real-verb test can prove what
// a run does when the words are NOT recorded (a resume of a run that used the envelope, a side run of a run that did not), whatever src/roles.js records. Test data only.
import { setHeldForTest } from '../../src/held-roles.js';
import { HELD_OFF } from './held-off.js';

setHeldForTest(HELD_OFF);
