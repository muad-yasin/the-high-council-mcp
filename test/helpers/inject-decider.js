// A preload for a CLI child (`node --import test/helpers/inject-decider.js src/cli.js ...`): records the conflict decider's three DRAFTED prompt functions for that process only, as setHeldForTest does in-process. Test data, never shipped: the real
// functions are held until Muad's yes at M7, so the real CLI cannot ask the decider yet; this lets a test drive the real verbs (exit 25, --prevail) with the drafted words.
import { setHeldForTest } from '../../src/held-roles.js';
import * as HDEC from '../held-prompts/held-083-decider.js';

setHeldForTest({ conflictDeciderSystem: HDEC.conflictDeciderSystem, conflictDeciderUser: HDEC.conflictDeciderUser, reviserDecisionNote: HDEC.reviserDecisionNote });
