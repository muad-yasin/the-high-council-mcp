// The personal-data gate's DEFAULT and its one setting (0.8.3, owner 18 Okt 2026, 16:45: "The warning has to stop the plan from running, unless the user explicitly chooses to continue"; this REVERSES the earlier warn default).
// Every run scans its input for the shapes src/pii-gate.js knows before the first provider call. Without a flag the gate STOPS at a finding (`hard-stop`, exit 11, nothing started, sent or spent); the stop screen names the way on
// (`--allow-pii <types found>`). `warn` (print, go on) stays as a word, and only the USER may choose it as a standing setting: the typed flag `--pii-gate warn`, the real shell environment, the Claude Desktop settings field or the
// JS API option. NEVER a project `.env` (src/env-file.js refuses the name: a project-writable file must not remove the stop) and never an agent parameter (MCP `start_run` has no such argument). There is no "off".
// A value that is neither `warn` nor `hard-stop` REFUSES the run (C&C ruling 18 Okt 2026, "refuse loudly" as for T7): a typo would otherwise change what the person asked for. The reader never exits; it returns the refusal
// sentence and every caller that reads the setting refuses with it (src/cli.js for a run and for `council tree start`).
import { keyPresent } from './key-env.js';

export const PII_DEFAULT_MODE = 'hard-stop';
export const PII_SETTING_NAME = 'COUNCIL_PII_GATE';

/**
 * { mode, refusal }: `mode` is 'warn' or 'hard-stop'; `refusal` is null, or the one sentence a caller prints (exit 2, before anything is written or sent) for a value that is neither. Unset, blank and an unresolved Desktop placeholder all mean the default.
 * On a refusal `mode` is 'hard-stop', never warn and never null: a caller that forgets to check still errs strict (a tree record without a mode reads as the gate OFF, src/tree-record.js). The shown value has its control characters removed and is cut to 40.
 */
export function piiModeSetting(env = process.env) {
  const raw = env?.[PII_SETTING_NAME];
  if (!keyPresent(raw)) return { mode: PII_DEFAULT_MODE, refusal: null };
  const v = raw.trim().toLowerCase();
  if (v === 'warn' || v === 'hard-stop') return { mode: v, refusal: null };
  // eslint-disable-next-line no-control-regex
  const shown = raw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
  return { mode: 'hard-stop', refusal: `${PII_SETTING_NAME}: "${shown}" is not a mode. Set it to hard-stop (the default) or warn, or remove it. Nothing was started and nothing was spent.` };
}
