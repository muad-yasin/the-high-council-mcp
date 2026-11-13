// A preload for a CLI child (`node --import test/helpers/held-names-preload.js src/cli.js ...`): records ONLY the lane A held words named in THC_HELD_NAMES (comma separated, names of test/held-prompts/held-084-a.js), the way the
// release apply will, so a spawned command runs with exactly one slot's words on and every other channel off. An unknown name stops the child at load, so a typo is a red row and never a silent no-op. With THC_PROMPT_LOG set it also
// writes every prompt a seat is sent to that file (one JSON line each: label, system, user). Test data only.
import { appendFileSync } from 'node:fs';
import { setHeldForTest } from '../../src/held-roles.js';
import { setPromptSpy } from '../../src/chain.js';
import * as H from '../held-prompts/held-084-a.js';

const names = (process.env.THC_HELD_NAMES || '').split(',').map(s => s.trim()).filter(Boolean);
for (const n of names) if (typeof H[n] !== 'function') throw new Error(`held-names-preload: "${n}" is not a held word of test/held-prompts/held-084-a.js`);
setHeldForTest(Object.fromEntries(names.map(n => [n, H[n]])));
if (process.env.THC_PROMPT_LOG) setPromptSpy(({ label, system, user }) => { appendFileSync(process.env.THC_PROMPT_LOG, `${JSON.stringify({ label, system, user })}\n`); });
