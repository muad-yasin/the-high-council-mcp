// Test code, not shipped. `node --import ./test/helpers/prompt-log-preload.js src/cli.js ...` sets chain.js's prompt spy in the CLI child and appends every prompt the run sends to $PROMPT_LOG (one JSON line: label, model, system, user).
// It changes nothing the run does; a test reads the file after the run to see the text a seat was sent.
import { appendFileSync } from 'node:fs';
import { setPromptSpy } from '../../src/chain.js';

const F = process.env.PROMPT_LOG;
if (F) setPromptSpy(p => { try { appendFileSync(F, JSON.stringify({ label: p.label, model: p.model, system: String(p.system ?? ''), user: String(p.user ?? '') }) + '\n'); } catch { /* a spy never fails a run */ } });
