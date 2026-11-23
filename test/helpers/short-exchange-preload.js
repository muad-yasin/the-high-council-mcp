// A preload for a CLI child (`node --import test/helpers/short-exchange-preload.js src/cli.js ...`): the pair of held words of the shortened exchange (W5 and W14) is in force for that process and NOTHING else.
// Used by test/ladder-exchange-refusal.test.js: with the pair recorded, `--ladder-exchange` is refused with any value (0.8.4 S6, Q2).
import { setHeldForTest } from '../../src/held-roles.js';
import * as HB084 from '../held-prompts/held-084-b.js';

setHeldForTest({ shortExchangeRule: HB084.shortExchangeRule, signoffLineRule: HB084.signoffLineRule });
