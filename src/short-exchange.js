// 0.8.4 S6 (M1; Q5, D4, W5, W14): the shortened exchange at layers 2 and 3.
// ONE switch, the S4b / S19 pattern: the pair W5 (shortExchangeRule) and W14 (signoffLineRule) is recorded or it is not. While either is held, nothing of S6 exists: no call, no record, no prompt byte, no cost row, and the ladder pilot's
// `--ladder-exchange` keeps working as before. The wording lives in test/held-prompts/held-084-b.js until the release apply records it in src/roles.js (the held function of the same name); tests inject it with setHeldForTest.
import { held } from './held-roles.js';

/** Is the shortened exchange in force? True exactly while BOTH W5 and W14 are recorded (the whole held-084-b batch is recorded together, test/held-prompts-084-b.test.js; this reads the two it needs). */
export const shortExchangeOn = () => typeof held('shortExchangeRule') === 'function' && typeof held('signoffLineRule') === 'function';

/** Does a top-layer "no" act (G7)? The pair is recorded AND the re-ask note is: with the note held, a "no" is recorded and the computed rule decides (the batch is recorded all together, so this is the state of every test that injects the pair alone). */
export const signoffRefusalOn = () => shortExchangeOn() && typeof held('signoffRefusedReaskNote') === 'function';
