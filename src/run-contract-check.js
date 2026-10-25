// `council contract check <run>` as a function (0.8.3 M2): what the CLI command computes, without printing, so the tree's ancestor check (PLAN 5.5 item 2, 7.6 step 2) and the command run ONE implementation.
// It reads the run folder and answers; it changes nothing. The exit codes are the command's own: 0 sealed and unchanged, 1 drift, 2 nothing outside report.json could be checked (or there is no record).
import { checkContract } from './contract-record.js';
import { contextBundleText, contextFileList } from './context-files.js';
import { contextFilesInside, readRecordedTask, readRunFile, readRunJson } from './run-files.js';
import { checkThinContract, renderCheck } from './thin-contract-check.js';

/**
 * { kind: 'noreport', record } for a run with no readable report.json (the caller words that case), or { kind: 'checked', verdict, shown, record, exit } with `shown` = renderCheck(verdict).
 * `dir` must already be a trusted run folder (src/run-files.js trustedRunDir). `handoffCopy` is an optional function returning the builder's own copy of HANDOFF.md (the command's --handoff); it is called only after
 * the report and the context have been read, where the command always read it, so its own errors come in the same order.
 * `deny` (R16): the secret denylist predicate (src/tools.js isDeniedPath). A caller that reads a run folder it does not trust (every MCP path) passes it: the recorded task path is refused if denied, and every recorded context
 * path must be a regular file inside `work` and not denied (an unreadable one is reported as unreadable, like a context file that is gone). The CLI on the person's own folder passes none.
 */
export function contractCheckOf(dir, { work, handoffCopy, deny = null, accepted = null } = {}) {
  // A run that holds a contract record (or amendment requests) is also checked as a record: ledger, versions, approvals, CONTRACT.md (0.8.2 item 6d). A run with none is checked and answered exactly as before.
  const record = checkContract(dir);
  const report = readRunJson(dir, 'report.json');
  if (!report) return { kind: 'noreport', record, exit: record.present ? record.exit : 2 };
  const meta = readRunJson(dir, 'run.json') || {};
  const task = meta.task ? readRecordedTask(meta.task, work, deny ?? undefined) : {};
  let contextBundle;
  if (meta.context) { try { contextBundle = contextBundleText(deny ? contextFilesInside(meta.context, work, deny) : contextFileList(meta.context)); } catch { contextBundle = undefined; /* a context file that is gone or refused (size, FIFO) is reported as unreadable, never as a pass */ } }
  const handoffCopyText = typeof handoffCopy === 'function' ? handoffCopy() : undefined;
  const verdict = checkThinContract({
    report, taskText: task.text, contextBundle, hasContext: Boolean(meta.context), handoffCopyText, accepted,
    deliverableText: readRunFile(dir, 'deliverable.md').text, handoffText: readRunFile(dir, 'HANDOFF.md').text,
  });
  const shown = renderCheck(verdict);
  // The record half decides when the run has no thin contract to check (verdict.note); otherwise a drift in either is 1, and thin's own 2 ("nothing outside report.json could be checked") stays 2.
  const exit = !record.present ? verdict.exit : record.exit === 1 ? 1 : verdict.note ? record.exit : verdict.exit;
  return { kind: 'checked', verdict, shown, record, exit };
}
