// 0.8.4 item 6 (his 05 Nov 2026 "1: a" and 10 Nov 18:06 "1:a", and his "a" on not-agreed ends): the plan summary and index, written by the handling session AFTER the run and put at the top of deliverable.md. A leaf: no import beyond node:crypto, so every reader of a delivered file can strip it.
// The block is NOT a harness note (delivered_text.harness_notes, delivered_text.sha256 and body_sha256 stay what the run wrote). It is recorded in its own additive field, report.json `delivered_text.summary_block` = { chars, sha256, text_sha256, at }:
// `chars` is the length of the block as written to the file (its closing `---` line included), `sha256` its hash. `withoutSummaryBlock` strips the first `chars` characters of a file ONLY when their hash is the recorded one (never by looking for a heading), so a plan that starts with the
// same words is never cut, and a block that was edited afterwards strips nothing and shows as a changed file. The sidecar `handler-summary.json` holds the session's own text: the text of the LAST call, replaced at every call before a block is delivered (src/summary-add.js); once a block is delivered a second call is refused, so a delivered block's sidecar stays.
import { createHash } from 'node:crypto';

export const SUMMARY_FILE = 'handler-summary.json';
export const SUMMARY_MAX = 20000;   // characters (code points) of the session's text
export const SUMMARY_HEADING = '## Summary and index (written by the handling session)';   // A-DRAFT (WRR-s3)
export const SUMMARY_INTRO = 'The handling session wrote this block after the run ended, from the plan in this file. It is the session\'s own text, not a seat\'s, and no judge read it. Everything below the line that ends this block is the file as the run wrote it, unchanged.';   // A-DRAFT (WRR-s3)
export const ENDING_LINE_START = 'How the run ended: ';   // A-DRAFT (WRR-s4)

const sha = s => createHash('sha256').update(String(s ?? ''), 'utf8').digest('hex');

/** The block as written to the top of deliverable.md: the heading, the ending line (`headline` = verdictHeadline(report).text, THC's own words for how the run ended; for an agreed run that was finished at once with the owed read not made it also carries the run status line's clause and the final-read block's own sentence, src/summary-add.js), the note, the session's text, and one closing `---` line. */
export function renderSummaryBlock({ text, headline }) {
  return `${SUMMARY_HEADING}\n\n${ENDING_LINE_START}${headline}\n\n${SUMMARY_INTRO}\n\n${String(text).trim()}\n\n---\n`;
}

/** The record of a block: { chars, sha256, text_sha256, at }. */
export const summaryRecordOf = (block, text, at) => ({ chars: block.length, sha256: sha(block), text_sha256: sha(String(text).trim()), at });

/** Does the file start with exactly the recorded block? */
export function startsWithRecordedBlock(fileText, record) {
  return !!record && Number.isInteger(record.chars) && record.chars > 0 && typeof record.sha256 === 'string' && typeof fileText === 'string' && fileText.length >= record.chars && sha(fileText.slice(0, record.chars)) === record.sha256;
}

/** The file as the run wrote it: the text without its recorded summary block. Anything that is not exactly the recorded block (no record, a block edited since, no block) is returned as it is. */
export function withoutSummaryBlock(fileText, record) {
  return startsWithRecordedBlock(fileText, record) ? fileText.slice(record.chars) : fileText;
}
