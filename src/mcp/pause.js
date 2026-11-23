// MCP tool `pause_run` (0.8.4, 16c-MCP; the owner's "pause after this round", the MCP half of `council pause`, src/gate-relay-cli.js). Everything A-DRAFT here is agent-facing public text, shown once at the release wording review.
// It RECORDS one request in the run's gate ledger through the same functions the verb uses (src/run-controls.js pauseAskOf for WHO is asking, requestPause for the record); it takes no run lock, spawns nothing and pays nothing.
// An MCP call is never the person at a terminal: a request is recorded only as the person's RELAYED answer (person_words) or as the handler's own (reason); the bare, terminal form is refused here, always.
import { RUN_FOLDER } from '../run-status.js';
import { trustedRunDir, readRunJson } from '../run-files.js';
import { pauseAskOf, requestPause } from '../run-controls.js';

export const PAUSE_RUN_DESCRIPTION = 'Ask a RUNNING run to pause after the pass it is in: it finishes that pass, then stops before the next one starts (run_status reads it as owner_paused). The stop spends nothing; the person decides when to go on, and resume_run with only the run id continues it. Pass person_words, the person\'s own answer as they typed it, when the person asked for the pause; pass reason, your own, when you ask on your own account; never both, and one of them is required (a session is never the person at a terminal). Refuses a run nobody is running, a member of a tree, and a request that is already open. Nothing is recorded on a refusal.';   // A-DRAFT

const BOTH = 'pause_run takes person_words (the person\'s own answer, as they typed it) or reason (your own), not both: a request that is the person\'s carries no reason of its own. Nothing was recorded.';   // A-DRAFT
const NEITHER = 'pause_run needs person_words (the person\'s own answer asking for the pause, as they typed it) or reason (your own reason for asking). A session cannot ask as the person at a terminal. Nothing was recorded.';   // A-DRAFT
const NOT_A_RUN = run => `${run} is not a run folder. Nothing was recorded.`;   // A-DRAFT
const NOTE = 'The run finishes the pass it is in and stops at the next pass boundary, before that pass starts; nothing is paid for the stop. Going on is the person\'s call: resume_run with only the run id continues it. If no pass follows (the last pass is running), the request stays open and is listed in the report as not taken.';   // A-DRAFT

const result = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });
const refused = error => result({ paused_requested: false, error });

/** The tool's result for one call. `args` = { run, person_words?, reason? }. */
export function pauseRunResult({ runsDir, args, now }) {
  const { run, person_words: personWords, reason } = args ?? {};
  if (typeof run !== 'string' || !RUN_FOLDER.test(run)) return refused('no such run');
  const t = trustedRunDir(runsDir, run);
  if (t.refusal) return refused(t.refusal);
  const asked = pauseAskOf({ personWords, reason });
  if (!asked.ok) return refused(BOTH);
  if (asked.bare) return refused(NEITHER);   // the person's own, typed form needs a terminal, and an MCP call has none
  const meta = readRunJson(t.dir, 'run.json');
  if (!meta) return refused(NOT_A_RUN(run));
  const res = requestPause(t.dir, { ...asked.ask, tree: !!meta.tree }, now ? { now } : {});
  if (!res.ok) return refused(`${res.message} Nothing was recorded.`);
  return result({ paused_requested: true, run, request: res.seq, pass: res.pass, by: asked.ask.by, note: NOTE });
}
