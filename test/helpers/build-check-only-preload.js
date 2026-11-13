// A preload for a CLI child (`node --import test/helpers/build-check-only-preload.js src/cli.js ...`): the build-check wording (CHECK in test/helpers/build-check.js) is in force for that process and NOTHING else (the rating demand stays as src/roles.js has it).
// For a test of another lane whose run reaches a layer-3 sign-off: it asserts what the run does now (waits at the check, or ends not agreed). The recorded word makes the same process behave the same way.
import { setHeldForTest } from '../../src/held-roles.js';
import { CHECK } from './build-check.js';

setHeldForTest({ ...CHECK });
