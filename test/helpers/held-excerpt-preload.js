// A preload for a CLI child (`node --import test/helpers/held-excerpt-preload.js src/cli.js ...`): records the excerpt channel's drafted words (test/held-prompts/held-084-a.js) the way the release apply will, so
// a spawned command runs with the channel ON, and writes every prompt a seat is sent to the file named by THC_PROMPT_LOG (one JSON line each: label, system, user), so a test can read what the seats saw.
// By default only the channel's two words are recorded (session reads); THC_HELD_ALL=1 records every word of lane A (the quote words and the text requests). Test data only.
import { appendFileSync } from 'node:fs';
import { setHeldForTest } from '../../src/held-roles.js';
import { setPromptSpy } from '../../src/chain.js';
import * as H from '../held-prompts/held-084-a.js';

setHeldForTest(process.env.THC_HELD_ALL === '1' ? { ...H } : { excerptsBlock: H.excerptsBlock, sessionReadsField: H.sessionReadsField });
if (process.env.THC_PROMPT_LOG) setPromptSpy(({ label, system, user }) => { appendFileSync(process.env.THC_PROMPT_LOG, `${JSON.stringify({ label, system, user })}\n`); });
