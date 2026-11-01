// B3 PROTOTYPE (pinned branch only; decided 30 Okt 2026, the person's word via C&C): `council relay-answer <run folder> <gate> --total <dollars> --person-words "<his words>"` is the handler session's relay of a person's permission for a
// raised limit or a ruling. It is its own module and subcommand so that src/gate-cli.js keeps its pinned shape (one option, --decline, which can only decline: test/gate-answer.test.js R7). Needs no terminal. Records channel session,
// actor main-session, the person's words verbatim and, for a limit, the total, which must appear in those words (src/gate.js answerGateAsRelay). The tool cannot verify the permission; the record shows who relayed it.
import { resolve, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { answerGateAsRelay, requestRuling, requestWithdrawal, declineOwnRequest, readGateAnswer, readGateText, textSha256, GATES_DIR, RUN_CAP_KIND, RULING_KIND, RULING_WITHDRAWAL_KIND } from './gate.js';
import { pauseBefore, stagesOfPass } from './ladder-steps.js';
import { parseRulingGateText, parseWithdrawalGateText } from './rulings.js';
import { terminalSafe } from './terminal-safe.js';

/** The stages a pass already has on disk. A ruling, or the withdrawal of one, is asked for and relayed only for a pass with none: after that its prompts would differ from the stages on disk, which would be asked again for money. */
const stageOnDisk = (runDir, pass) => stagesOfPass(readdirSync(runDir), pass);

const USAGE = ['usage: council relay-answer <run folder> <gate> [--total <dollars>] --person-words "<the person\'s words, as he typed them in the handler\'s window>"', '       --total is required for a limit and must appear, in digits, in the words'];   // A-DRAFT

/**
 * B3 prototype: the handler session's relay of a person's permission (decided 30 Okt 2026, the person's word via C&C). Needs no terminal. Records channel session, actor main-session, the person's words verbatim and, for a limit,
 * the total, which must appear in those words (gate.js). The tool cannot verify the permission; the record shows who relayed it. Returns an exit code: 0 recorded, 1 refused (nothing written), 2 usage.
 */
function answerRelayed(runDir, gateArg, { personWords, total, stdout, stderr, now }) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const opts = now ? { now } : {};
  const state = readGateAnswer(runDir, gateArg, opts);
  if (state.status === 'invalid' && !state.gate) { err(`gate ${gateArg}: ${state.reason}`); return state.reason === 'gate_not_found' ? 2 : 1; }
  if (state.status !== 'pending') { err(`gate ${gateArg} is ${state.status}${state.reason ? ` (${state.reason})` : ''}; only a pending gate can be answered`); return 1; }
  const bytes = readGateText(runDir, state.gate.text);
  if (!bytes) { err(terminalSafe(`gate ${gateArg}: cannot read ${state.gate.text} inside the run folder`)); return 1; }
  if (state.gate.kind === RULING_KIND || state.gate.kind === RULING_WITHDRAWAL_KIND) {   // a ruling, or its withdrawal, is relayed only before its pass has started
    const asRuling = state.gate.kind === RULING_KIND;
    const parsed = asRuling ? parseRulingGateText(bytes) : parseWithdrawalGateText(bytes);
    const on = parsed ? stageOnDisk(runDir, parsed.pass) : [];
    if (!parsed) { err(terminalSafe(`gate ${gateArg}: its text is not ${asRuling ? 'a ruling' : 'a withdrawal'}. Nothing was written.`)); return 1; }   // A-DRAFT
    if (on.length) { err(`gate ${gateArg}: pass ${parsed.pass} already has a stage on disk (${on[0]}), so ${asRuling ? 'a ruling' : 'a withdrawal'} for it would change what that stage was asked. Nothing was recorded.`); return 1; }   // A-DRAFT
  }
  if (state.gate.kind === RUN_CAP_KIND && (total === undefined || total === '')) { err('relay-answer: a limit needs --total <dollars>. Nothing was written.'); return 2; }   // A-DRAFT
  const res = answerGateAsRelay(runDir, gateArg, { shownSha256: textSha256(bytes), reason: 'relayed by the handler session on the person\'s permission; his words are in person_words', personWords, ...(state.gate.kind === RUN_CAP_KIND ? { typedCap: String(total) } : {}) }, opts);
  if (!res.ok) { err(terminalSafe(`gate ${gateArg}: ${res.message}`)); return 1; }
  out(`gate ${gateArg}: recorded, relayed by the handler session on the person's words. The tool cannot verify the permission; the record shows who relayed it.`);   // A-DRAFT
  return 0;
}

export function relayCommand(positional, { work = process.cwd(), personWords, total, stdout = process.stdout, stderr = process.stderr, now } = {}) {
  const err = s => stderr.write(`${s}\n`);
  const [runArg, gateArg, extra] = positional;
  if (!runArg || !gateArg || extra !== undefined) { for (const l of USAGE) err(l); return 2; }
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, GATES_DIR))) { err(`relay-answer: ${runArg} has no gates`); return 2; }
  return answerRelayed(runDir, gateArg, { personWords, total, stdout, stderr, now });
}

/**
 * `council ruling-add <run folder> --ruling "<text>" [--relayed]` (B3 prototype): asks for a ruling to apply from the NEXT pass, the one after the revise pause the run is waiting at. The ruling is a gate of kind `ruling` whose text is the
 * ruling as it will be shown to the judges; his answer comes with the approval (council relay-answer, or council gate answer at a terminal). Refuses, writing nothing: no run, a pause that is not answered yet, a pass that already has a
 * stage on disk, an empty or repeated ruling.
 */
export function rulingAddCommand(positional, { work = process.cwd(), ruling, relayed = false, stdout = process.stdout, stderr = process.stderr, now } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, extra] = positional;
  if (!runArg || extra !== undefined || typeof ruling !== 'string') { err('usage: council ruling-add <run folder> --ruling "<the ruling, as it will be shown to the judges>" [--relayed]'); return 2; }   // A-DRAFT
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, 'run.json'))) { err(`ruling-add: ${runArg} is not a run folder. Nothing was written.`); return 2; }   // A-DRAFT
  const files = readdirSync(runDir);
  const paused = pauseBefore(files);
  if (!paused.ok) { err(paused.why === 'pending' ? `ruling-add: the run waits for an answer to ${paused.label}; give that first. Nothing was written.` : 'ruling-add: the run is not at a revise pause, so there is no next pass to give a ruling to. Nothing was written.'); return 2; }   // A-DRAFT
  const on = stageOnDisk(runDir, paused.pass);
  if (on.length) { err(`ruling-add: pass ${paused.pass} already has a stage on disk (${on[0]}), so a ruling for it would change what that stage was asked. Nothing was written.`); return 2; }   // A-DRAFT
  const res = requestRuling(runDir, { pass: paused.pass, text: ruling, relayed }, now ? { now } : {});
  if (!res.ok) { err(terminalSafe(`ruling-add: ${res.message} Nothing was written.`)); return 2; }
  out(`ruling-add: a ruling for pass ${paused.pass} waits for his answer as gate ${res.gate.id}. The run will not go on until it is answered or has expired.`);   // A-DRAFT
  out(relayed ? `  council relay-answer ${runArg} ${res.gate.id} --person-words "<his answer, as he typed it in this window>"` : `  council gate answer ${runArg} ${res.gate.id}`);
  return 0;
}

/**
 * `council ruling-withdraw <run folder> <gate> [--relayed]` (B3 prototype, 31 Okt 2026): the way out of a ruling.
 * - A ruling or withdrawal that still WAITS: with --relayed the handler session declines the request it asked for itself (a refusal sets no ruling, so it takes no words from the person); a gate the person asked for is declined by the person, and the
 *   command prints how (`council gate answer <run> <gate> --decline`). Nothing is written then.
 * - An APPROVED ruling: asks for its withdrawal from the next pass (the pass after the revise pause the run waits at, which must have no stage on disk). His answer comes the same way as a ruling's. The ruling stays in the record; the withdrawal
 *   is listed beside it; every prompt of a pass that already ran keeps carrying it.
 * Refuses, writing nothing: no run, a gate that is not a ruling, a pause that is not answered yet, a pass with a stage, a ruling already withdrawn.
 */
export function rulingWithdrawCommand(positional, { work = process.cwd(), relayed = false, stdout = process.stdout, stderr = process.stderr, now } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const opts = now ? { now } : {};
  const [runArg, gateArg, extra] = positional;
  if (!runArg || !gateArg || extra !== undefined) { err('usage: council ruling-withdraw <run folder> <gate> [--relayed]'); return 2; }   // A-DRAFT
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, GATES_DIR))) { err(`ruling-withdraw: ${runArg} has no gates. Nothing was written.`); return 2; }   // A-DRAFT
  const state = readGateAnswer(runDir, gateArg, opts);
  if (!state.gate) { err(terminalSafe(state.reason === 'gate_not_found' ? `ruling-withdraw: this run has no gate ${gateArg}. Nothing was written.` : `ruling-withdraw: gate ${gateArg} cannot be read (${state.reason ?? state.status}). Nothing was written.`)); return 2; }   // A-DRAFT
  if (state.gate.kind !== RULING_KIND && state.gate.kind !== RULING_WITHDRAWAL_KIND) { err(terminalSafe(`ruling-withdraw: gate ${gateArg} is a ${state.gate.kind} gate, not a ruling. Nothing was written.`)); return 2; }   // A-DRAFT
  if (state.status === 'pending') {
    if (!relayed) {
      err(`ruling-withdraw: gate ${gateArg} still waits for his answer. To decline it at a terminal: council gate answer ${runArg} ${gateArg} --decline`);   // A-DRAFT
      err(`  If the handler session asked for it (--relayed), the session declines it itself: council ruling-withdraw ${runArg} ${gateArg} --relayed. Nothing was written.`);
      return 2;
    }
    const res = declineOwnRequest(runDir, gateArg, { reason: 'withdrawn by the handler session, which asked for it; it set no ruling' }, opts);
    if (!res.ok) { err(terminalSafe(`ruling-withdraw: gate ${gateArg}: ${res.message} Nothing was recorded.`)); return 1; }   // A-DRAFT
    out(`ruling-withdraw: gate ${gateArg} is declined; it set no ruling and the run can go on.`);   // A-DRAFT
    return 0;
  }
  if (state.status !== 'approved' || state.gate.kind !== RULING_KIND) { err(`ruling-withdraw: gate ${gateArg} is ${state.status}${state.gate.kind === RULING_WITHDRAWAL_KIND ? ' and is a withdrawal' : ''}: only a waiting gate or an approved ruling can be withdrawn. Nothing was written.`); return 2; }   // A-DRAFT
  const files = readdirSync(runDir);
  const paused = pauseBefore(files);
  if (!paused.ok) { err(paused.why === 'pending' ? `ruling-withdraw: the run waits for an answer to ${paused.label}; give that first. Nothing was written.` : 'ruling-withdraw: the run is not at a revise pause, so there is no next pass to withdraw the ruling from. Nothing was written.'); return 2; }   // A-DRAFT
  const on = stageOnDisk(runDir, paused.pass);
  if (on.length) { err(`ruling-withdraw: pass ${paused.pass} already has a stage on disk (${on[0]}), so a withdrawal from it would change what that stage was asked. Nothing was written.`); return 2; }   // A-DRAFT
  const res = requestWithdrawal(runDir, { gate: gateArg, pass: paused.pass, relayed }, opts);
  if (!res.ok) { err(terminalSafe(`ruling-withdraw: ${res.message} Nothing was written.`)); return 2; }
  out(`ruling-withdraw: the withdrawal of ruling ${gateArg} from pass ${paused.pass} waits for his answer as gate ${res.gate.id}. The ruling stays in the record, and the passes that already ran keep it. The run will not go on until it is answered or has expired.`);   // A-DRAFT
  out(relayed ? `  council relay-answer ${runArg} ${res.gate.id} --person-words "<his answer, as he typed it in this window>"` : `  council gate answer ${runArg} ${res.gate.id}`);
  return 0;
}
