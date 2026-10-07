// The part of HANDOFF.md the HARNESS writes for whoever builds from the plan (0.8.2 item 6b; owner 6 Oct 2026: "handoff milestones with checks and replan triggers; builder reviews plan before coding").
// It is product text, not a seat prompt: no model writes it, no model reads it as an instruction, and it sits between the model's own handoff text and the criteria lock block (which stays last).
// Pure and $0. The one number in it, how many times a named check may fail before the builder stops, is derived and configurable (below), never a bare constant.

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
