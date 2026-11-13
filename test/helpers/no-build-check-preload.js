// A preload for a CLI child (`node --import test/helpers/no-build-check-preload.js src/cli.js ...`): the build-check wording is HELD for that process, whatever src/roles.js records (NO_CHECK in test/helpers/build-check.js).
// For a test that pins today's behaviour of a layered chain (no check, no `ending`) and must keep doing so after the re-record.
import { setHeldForTest } from '../../src/held-roles.js';
import { NO_CHECK } from './build-check.js';

setHeldForTest({ ...NO_CHECK });
