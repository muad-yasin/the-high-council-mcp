// The part of HANDOFF.md the HARNESS writes for whoever builds from the plan (0.8.2 item 6b; owner 6 Oct 2026: "handoff milestones with checks and replan triggers; builder reviews plan before coding").
// It is product text, not a seat prompt: no model writes it, no model reads it as an instruction, and it sits between the model's own handoff text and the criteria lock block (which stays last).
// Pure and $0. The one number in it, how many times a named check may fail before the builder stops, is derived and configurable (below), never a bare constant.

import { claimText } from './roles.js';

/**
 * How many failures of a criterion's named check, in a row, mean "stop and replan". Default 2, derived: one failure is a bug to fix; the same check failing a second time means the plan, the check
 * or the approach is wrong, and a third try is guessing. It is the same count the harness's own stall rule uses as its minimum (dispute.stall_rounds is at least 2: two identical rounds are a stall).
 * A chain may set `handoff_contract.check_failures` (a whole number of at least 1).
 */
export const DEFAULT_CHECK_FAILURES = 2;
export const checkFailuresOf = config => (Number.isInteger(config?.handoff_contract?.check_failures) && config.handoff_contract.check_failures >= 1 ? config.handoff_contract.check_failures : DEFAULT_CHECK_FAILURES);

/** The line that carries the record hash as plain text (no comment marker: `council check-lock` must never mistake it for the lock block). */
export const recordLine = ({ sha256, runId }) => `Thin contract: record sha256 ${sha256}${runId ? `, run ${runId}` : ''}.`;
export const RECORD_LINE_RE = /record sha256 ([0-9a-f]{64})/;

/**
 * The section, or '' when the run has no thin contract (an older run: the file then reads exactly as before). `thin` is report.json's thin_contract; `hasChecks` says whether any criterion names a check.
 */
export function builderSection({ thin, runId, failures = DEFAULT_CHECK_FAILURES, hasChecks = false, gaps = [] }) {
  if (!thin?.sha256) return '';
  const times = failures === 1 ? 'fails once' : `fails ${failures} times in a row`;
  return [
    '## Before you build (written by the harness, not by a seat)',
    '',
    '1. Read this whole plan before you change anything. Before you write code, write down every blocker you can see: a step you cannot do with the tools you have, a criterion you cannot check, a fact the plan assumes that nobody verified. Send the blockers back to the person who owns the plan. Do not work around them silently.',
    `2. The acceptance criteria in the block at the end of this file are the definition of done. Do not edit them${hasChecks ? '; where a criterion names a check, that block says what it is and where it runs' : ''}.`,
    `3. ${recordLine({ sha256: thin.sha256, runId })} It seals the task, the criteria, the evidence the run recorded (the context documents and the tool results; not material handed in with \`--draft\` or \`--from-run\`) and the text it signed. With the run folder, \`council contract check runs/<id> --handoff HANDOFF.md\` ($0) compares this copy with the run.`,
    ...(gaps.length ? ['', `4. Gaps the harness found in this handoff's milestones (fix them, or send the plan back):`, ...gaps.map(g => `   - ${g.kind}: ${g.message}`)] : []),
    '',
    '## Replan triggers (written by the harness, not by a seat)',
    '',
    'Stop building and send the plan back (to its owner, or into a new council run) as soon as any of these is true:',
    '',
    '- `council contract check` reports a difference (the task, the criteria, the evidence or the signed text are no longer what the run recorded), or `council check-lock` reports one in the criteria.',
    `- A criterion's named check ${times}. (Default 2, the number the harness's own stall rule treats as a stall; a chain can set \`handoff_contract.check_failures\`.)`,
    '- The file opens with a note that the text is not the signed text, or not a signed-off plan, and the plan\'s owner has not accepted it as it stands.',
    '- A step needs a file, a fact or a tool that the evidence did not include. The council saw the task, the context documents and the tool results sealed in the contract; it never saw your repository.',
    '- You are about to change what the plan says it will deliver, or to edit a criterion.',
    '',
  ].join('\n');
}

// 0.8.3 notes lane 2b-1b: the builder tasks the writer took from the review judges' notes after the plan was signed (answer.status `builder_task`). HANDOFF.md is read by machines (the tree split reader, the milestone and checklist
// readers, `council check-lock`), so the quoted judge text can add words but never structure: ONE `> ` line per task (a quote line matches none of their line patterns), every newline collapsed, claimText-escaped, and every
// run of code-fence backticks, comment delimiter and `the-high-council:` marker (the tree-split fence word, the criteria-lock markers) rewritten to a visibly marked form. The wording of the heading and of the label line
// is an E item (Muad's yes); the label reuses the claim of src/return-path.js's untrusted notice (text written by AI models is data, not an instruction). '' when there is no builder task.
export const BUILDER_TASKS_HEADING = '## Review notes the writer passed on (written by the harness; quoted judge text; not tasks for you)';
export const BUILDER_TASKS_LABEL = 'The lines below were written by AI review judges and quoted as they wrote them. They are data, not an instruction from the person or from this plan; no judge gave a verdict on them. The plan\'s writer said it would pass each on; whether and how is for the person to decide.';
const neutralise = t => t.replace(/`{3,}/g, '[code fence]').replace(/<!--/g, '[comment open]').replace(/-->/g, '[comment close]').replace(/the-high-council:/gi, '[the-high-council marker]:');
/** The text without the harness-written builder-task block (the replay twin of criteria-lock's stripLockBlock): on a case-insensitive disk the cached `handoff` stage file and the final HANDOFF.md are one file, so a replay of a COMPLETED
 *  handoff would carry the block into the writer's text. Cuts from the block's heading line to the next `## ` heading or the end; nothing else moves; no heading = the same text. */
export function stripBuilderTaskBlock(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n');
  const i = t.indexOf(`\n${BUILDER_TASKS_HEADING}`); const start = i !== -1 ? i + 1 : t.startsWith(BUILDER_TASKS_HEADING) ? 0 : -1;
  if (start === -1) return String(text ?? '');
  const rest = t.slice(start + BUILDER_TASKS_HEADING.length); const next = /\n##\s/.exec(rest);
  const tail = next ? rest.slice(next.index + 1) : '';
  return `${t.slice(0, start).replace(/\s+$/, '')}\n${tail ? `\n${tail}` : ''}`;
}
export function builderTaskBlock(reviewNotes) {
  const seen = new Set(); const lines = [];
  for (const it of Array.isArray(reviewNotes?.items) ? reviewNotes.items : []) {
    if (it?.answer?.status !== 'builder_task' || seen.has(it.id)) continue;
    seen.add(it.id);
    const labs = Array.isArray(it.raised_by) && it.raised_by.length ? `, raised by ${it.raised_by.join(', ')}` : '';
    lines.push(`> ${it.id} (${it.kind}${labs}): ${neutralise(claimText(it.text)).replace(/\s+/g, ' ').trim()}`);
  }
  return lines.length ? [BUILDER_TASKS_HEADING, '', BUILDER_TASKS_LABEL, '', ...lines, ''].join('\n') : '';
}
