// 0.8.4 item 6: `council summary-add <run folder> --summary-file <file>`: the handling session's plan summary and index, put at the top of deliverable.md AFTER a run has ended (his "a": every run that delivers a plan and has a handling session, not-agreed ends included). Terminal only, like
// `council note-add` (no MCP tool); no harness call and no money path. The block (src/summary-block.js) is the harness's heading, THC's own words for how the run ended (verdictHeadline(report).text: no new ending sentence) and the session's text; the file below it is the file the run wrote, byte for byte.
// OFF AS SHIPPED: what reaches the session as an instruction is HELD (`handlerSummaryInstruction`, test/held-prompts/held-084-summary.js). Until the one wording review records it in src/roles.js the command refuses ("this build does not offer a summary block yet") and no run gets a block.
// Records. The sidecar `handler-summary.json` holds the session's own text (replaced atomically at every call, so it is always the text of the LAST call: an earlier call's text is never kept silently); report.json gets `delivered_text.summary_block` FIRST, deliverable.md SECOND: a crash between the two leaves a record that does not match the file's start, which every reader reads as "no block", and the next summary-add writes the block again, with ITS text.
// An AGREED run that was finished at once with the owed read not made (FS-2 at a spending stop, FN-5c at the final-read stop) says so in the block: the ending line carries the run status line's clause ("on the signed draft; the delivered text differs ...") where the text changed after the sign-off, then the final-read block's own sentence ("... did not read the final plan."), joined by punctuation only. Both are words THC already prints; no new sentence.
// Refused, nothing written: a run with no handling session, a run that has not ended, a run that already has a block, a deliverable that is no longer the one the run wrote, a text that is empty, too long or carries control or hidden characters.
// Exit 0 recorded, 2 refused (nothing written), 1 recorded in the sidecar but the files could not be updated, 13 the run folder is locked.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, statSync, writeSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { held } from './held-roles.js';
import { hasHandlingSession } from './ending.js';
import { hiddenIn } from './hidden-chars.js';
import { acquireRunLock, RunLockedError } from './run-lock.js';
import { terminalSafe } from './terminal-safe.js';
import { verdictHeadline } from './verdict-headline.js';
import { textSha256, deliveredDiffersClause } from './text-labels.js';
import { agreedOf } from './ending-matrix.js';
import { finalReadNotReadWords } from './final-read.js';
import { SUMMARY_FILE, SUMMARY_MAX, renderSummaryBlock, summaryRecordOf, startsWithRecordedBlock } from './summary-block.js';

const USAGE = 'usage: council summary-add <run folder> --summary-file <file>';   // A-DRAFT

/** The text's problem, or null: 'empty', 'control' (a control character other than a line break or a tab, or a hidden character: refused, never stripped) or 'long' (more than SUMMARY_MAX characters, counted as code points). */
export function summaryProblem(text) {
  if (typeof text !== 'string' || !text.trim()) return 'empty';
  if ([...text].some(c => { const n = c.codePointAt(0); return (n < 0x20 && n !== 0x0a && n !== 0x09) || (n >= 0x7f && n <= 0x9f); }) || hiddenIn(text, { allowQuiet: true })) return 'control';
  if ([...text].length > SUMMARY_MAX) return 'long';
  return null;
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  try { renameSync(tmp, path); } catch (e) { try { unlinkSync(tmp); } catch { /* already gone */ } throw e; }
}

export function summaryAddCommand(positional, { work = process.cwd(), summaryFile, chainOf, readRunMeta, stdout = process.stdout, stderr = process.stderr, now = () => Date.now() } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, extra] = positional;
  const instruction = held('handlerSummaryInstruction');
  if (typeof instruction !== 'function') { err('summary-add: this build does not offer a summary block yet. Nothing was written.'); return 2; }   // A-DRAFT: the shipped state
  if (!runArg || extra !== undefined) { err(USAGE); return 2; }
  if (typeof summaryFile !== 'string') { out(USAGE); out(''); out(instruction()); return 0; }   // the usage and the held instruction the session writes from
  const runDir = resolve(work, runArg);
  const shownRun = terminalSafe(runArg);
  if (!existsSync(join(runDir, 'run.json'))) { err(`summary-add: ${shownRun} is not a run folder. Nothing was written.`); return 2; }   // A-DRAFT
  const reportPath = join(runDir, 'report.json'); const planPath = join(runDir, 'deliverable.md');
  if (!existsSync(reportPath) || !existsSync(planPath)) { err('summary-add: this run has not ended, and the summary can be added only after the ending. Nothing was written.'); return 2; }   // A-DRAFT
  const meta = typeof readRunMeta === 'function' ? readRunMeta(runDir) : null;
  const config = typeof chainOf === 'function' ? chainOf(meta) : null;
  if (!config) { err('summary-add: the chain of this run cannot be read, so it cannot be checked for a handling session. Nothing was written.'); return 2; }   // A-DRAFT
  if (!hasHandlingSession(config)) { err('summary-add: this run had no handling session, so a summary would be recorded as the words of someone the run did not have. Nothing was written.'); return 2; }   // A-DRAFT
  let text;
  try { const p = resolve(work, summaryFile); if (!statSync(p).isFile()) throw new Error('not a file'); text = readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch { err(`summary-add: ${terminalSafe(summaryFile)} cannot be read. Nothing was written.`); return 2; }   // A-DRAFT
  const problem = summaryProblem(text);
  if (problem === 'empty') { err('summary-add: the summary file is empty. Nothing was written.'); return 2; }   // A-DRAFT
  if (problem === 'control') { err('summary-add: the summary must be plain text (line breaks and tabs are fine; no other control characters and no hidden characters). Nothing was written.'); return 2; }   // A-DRAFT
  if (problem === 'long') { err(`summary-add: the summary is ${[...text].length} characters; at most ${SUMMARY_MAX}. Nothing was written.`); return 2; }   // A-DRAFT
  // One command at a time on a run folder (the run lock a resume, `council handoff` and `council note-add` take).
  let release;
  try { release = acquireRunLock(runDir); } catch (e) {
    if (!(e instanceof RunLockedError)) throw e;
    err(`\n${e.message}`);
    return 13;   // EXIT_RUN_LOCKED of src/cli.js
  }
  try {
    let report; let file; let reportText;
    try { reportText = readFileSync(reportPath, 'utf8'); report = JSON.parse(reportText); file = readFileSync(planPath, 'utf8'); } catch { err('summary-add: report.json or deliverable.md cannot be read. Nothing was written.'); return 2; }   // A-DRAFT
    if (!report || typeof report !== 'object' || Array.isArray(report) || !report.delivered_text || typeof report.delivered_text !== 'object') { err('summary-add: report.json has no delivered_text, so the plan the run delivered cannot be told. Nothing was written.'); return 2; }   // A-DRAFT
    const have = report.delivered_text.summary_block;
    if (have && startsWithRecordedBlock(file, have)) { err('summary-add: this run already has a summary block. Nothing was written.'); return 2; }   // A-DRAFT
    // The note of the block says the file below it is the file the run wrote, so the file must BE that file: its hash is the one report.json recorded when the run wrote it (a crashed earlier call left no matching record, so the file is still as the run wrote it). A run whose deliverable.md was changed after it ended, a harness block edited included, gets no block.
    if (textSha256(file) !== report.delivered_text.sha256) { err('summary-add: deliverable.md is not the file the run wrote (its hash differs from report.json). Nothing was written.'); return 2; }   // A-DRAFT
    // An agreed finish-now that skipped the owed read keeps "agreed" (his 10 Nov 19:01 ruling), so the verdict line alone would not say that the top layer did not read the last version: the block carries the words THC already prints for that run (the status line's clause, the final-read block's sentence).
    const unread = agreedOf(report) && report.final_read?.run_end === 'agreed' ? finalReadNotReadWords(report.final_read) : '';
    const differs = unread ? deliveredDiffersClause(report.delivered_text) : null;
    const headline = `${verdictHeadline(report).text}${differs ? `, ${differs}` : ''}${unread ? `. ${unread}` : ''}`;   // one ending line: the verdict, the status line's clause, the final-read block's sentence (joined by punctuation only)
    const at = new Date(now()).toISOString();
    const block = renderSummaryBlock({ text, headline });
    const record = summaryRecordOf(block, text, at);
    try { writeAtomic(join(runDir, SUMMARY_FILE), `${JSON.stringify({ at, actor: 'handler', text: String(text).trim() })}\n`); } catch (e) { err(`summary-add: could not write ${SUMMARY_FILE} (${e.code ?? e.message}). Nothing was written.`); return 2; }   // A-DRAFT: replaces an earlier call's sidecar (a call that stopped before the file was updated): the new text is the one delivered
    try {
      const next = { ...report, delivered_text: { ...report.delivered_text, summary_block: record } };
      writeAtomic(reportPath, `${JSON.stringify(next, null, 2)}${reportText.endsWith('\n') ? '\n' : ''}`);   // the record first: a crash after it leaves a record that matches no file start, which reads as "no block"
      writeAtomic(planPath, `${block}${file}`);
    } catch (e) { err(terminalSafe(`summary-add: the summary is recorded in ${SUMMARY_FILE}, but report.json and deliverable.md could not be updated (${e.code ?? e.message}). Run summary-add again to complete it.`)); return 1; }   // A-DRAFT
    out(`summary-add: the handling session's summary block is at the top of deliverable.md of ${shownRun}. It is the session's own text: the rest of the file is as the run wrote it and the plan is unchanged. It cannot be taken back.`);   // A-DRAFT
  } finally { release(); }
  return 0;
}
