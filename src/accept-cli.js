// 0.8.4 T2.3 / D2 (plan A, C&C 09 Nov 2026): `council accept <run folder> --reason "<why>"`, the verb the PERSON types at a terminal to accept the plan of a run that ended without agreement, as it stands. It agrees with no judge and changes no
// objection: it records who accepted, when, why and which open objections stand, puts one line under the banner of HANDOFF.md and gives the seat's Status back (src/acceptance.js, src/accept-run.js). The handling session's half is the
// `accept` step of `stop_decide`. No model call and no money.
//
// The flow is `council contract lock`'s: the question is a gate; at a terminal the person reads it and answers y/N (the reason typed on the command line is recorded with the answer); with no terminal the command says the gate waits and
// exits 3; run again after the gate is answered, it applies an approved acceptance. Exit 0 done, 1 refused or failed, 2 usage or no terminal, 3 waiting.
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { terminalSafe } from './terminal-safe.js';
import { acceptanceReasonProblem, ACCEPTANCE_REASON_MAX } from './acceptance.js';
import { askAcceptance, applyAcceptance, acceptanceQuoteOf, usableAcceptanceOf } from './accept-run.js';
import { answerAtTerminal } from './gate-cli.js';

export const ACCEPT_USAGE = 'usage: council accept <run folder> --reason "<up to 600 characters>"';   // A-DRAFT

export async function acceptCommand(positional, { work = process.cwd(), reason, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, now, rename, write } = {}) {   // `rename`, `write`: the rebuild's rename and the question file's writer; a test passes ones that fail
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, extra] = positional;
  if (!runArg || extra !== undefined) { err(ACCEPT_USAGE); return 2; }
  const runDir = resolve(work, runArg);
  const shown = terminalSafe(runArg);
  if (!existsSync(join(runDir, 'run.json'))) { err(`accept: ${shown} is not a run folder. Nothing was written.`); return 2; }   // A-DRAFT
  const runId = basename(runDir);
  // what the question is about, read first: nothing is written until the person has given a usable reason (or an approved acceptance is already on the ledger, which needs none)
  const probe = acceptanceQuoteOf(runDir, runId);
  if (probe.refusal) {
    if (probe.refusal.code === 'already_accepted') { out(`accept: ${shown}: ${probe.refusal.message}`); return 0; }
    err(`accept: ${shown}: ${terminalSafe(probe.refusal.message)} Nothing was written.`);   // A-DRAFT
    return probe.refusal.code === 'not_ended' || probe.refusal.code === 'agreed' ? 2 : 1;
  }
  const approvedAlready = usableAcceptanceOf(runDir, runId, { now }) !== null;   // a person's approval, or a session's that passes today's checks; one that does not is no obstacle
  if (!approvedAlready) {
    if (typeof reason !== 'string') { err(`${ACCEPT_USAGE}\naccept: no --reason was given; the reason is what the record keeps beside your answer. Nothing was written.`); return 2; }   // A-DRAFT
    const bad = acceptanceReasonProblem(reason);
    if (bad === 'empty') { err('accept: the reason is empty. Say why you accept this plan as it stands. Nothing was written.'); return 2; }   // A-DRAFT
    if (bad === 'control') { err('accept: the reason must be one line of plain text (no line breaks, control characters or hidden characters). Nothing was written.'); return 2; }   // A-DRAFT
    if (bad === 'long') { err(`accept: the reason is ${[...reason].length} characters; at most ${ACCEPTANCE_REASON_MAX}. Nothing was written.`); return 2; }   // A-DRAFT
    if (!stdin.isTTY || !stdout.isTTY) {
      const asked = askAcceptance(runDir, runId, { now, ...(write ? { write } : {}) });
      if (!asked.ok) { err(`accept: ${shown}: ${terminalSafe(asked.message)}`); return 1; }
      out(`accept: gate ${asked.gate.id} is waiting for a person. Run this at a terminal: council accept ${shown} --reason "<why>"`);   // A-DRAFT
      return 3;
    }
    const asked = askAcceptance(runDir, runId, { now, ...(write ? { write } : {}) });
    if (!asked.ok) { err(`accept: ${shown}: ${terminalSafe(asked.message)}`); return 1; }
    const code = await answerAtTerminal(runDir, asked.gate.id, { reason: reason.trim(), stdin, stdout, stderr, ...(now ? { now } : {}) });
    if (code !== 0) return code;
  }
  const applied = applyAcceptance(runDir, runId, { now, ...(rename ? { rename } : {}) });
  if (!applied.ok) { err(`accept: ${shown}: ${terminalSafe(applied.message)}`); return 1; }
  out(`accept: the plan of ${shown} is accepted as it stands. HANDOFF.md carries the line under its banner and the seat's own Status; the open objections stay listed. Accepting agrees with no judge.`);   // A-DRAFT
  return 0;
}
