// B3 PROTOTYPE (pinned branch only; decided 30 Okt 2026, the person's word via C&C): `council relay-answer <run folder> <gate> --total <dollars> --person-words "<his words>"` is the handler session's relay of a person's permission for a
// raised limit or a ruling. It is its own module and subcommand so that src/gate-cli.js keeps its pinned shape (one option, --decline, which can only decline: test/gate-answer.test.js R7). Needs no terminal. Records channel session,
// actor main-session, the person's words verbatim and, for a limit, the total, which must appear in those words (src/gate.js answerGateAsRelay). The tool cannot verify the permission; the record shows who relayed it.
import { ratingsRecorded } from './severity.js';
import { resolve, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { answerGateAsRelay, requestRuling, requestWithdrawal, declineOwnRequest, readGateAnswer, readGateText, textSha256, GATES_DIR, RUN_CAP_KIND, RULING_KIND, RULING_WITHDRAWAL_KIND } from './gate.js';
import { addHandlerRetag } from './handler-retags.js';
import { answerControl, isRaiseGate, isRulingGate, RELAY_REASON, decideRoute, pausePointOf, requestPause, pauseAskOf, highestStagedPass } from './run-controls.js';
import { stagesOfPass } from './ladder-steps.js';
import { terminalSafe } from './terminal-safe.js';

/** The stages a pass already has on disk. A ruling, or the withdrawal of one, is asked for and relayed only for a pass with none: after that its prompts would differ from the stages on disk, which would be asked again for money. */
const stageOnDisk = (runDir, pass) => stagesOfPass(readdirSync(runDir), pass);

const USAGE = ['usage: council relay-answer <run folder> <gate> [--total <dollars>] --person-words "<the person\'s words, as typed in the handler\'s window>"', '       --total is required for a limit raise and must appear, in digits, in the words'];   // A-DRAFT

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
  if (state.status !== 'pending') { err(`gate ${gateArg} is ${state.status}${state.reason ? ` (${state.reason})` : ''}; only a gate that still waits can be answered. Nothing was written.`); return 1; }
  const bytes = readGateText(runDir, state.gate.text);
  if (!bytes) { err(terminalSafe(`gate ${gateArg}: its text file ${state.gate.text} cannot be read inside the run folder. Nothing was written.`)); return 1; }
  // a ruling and its withdrawal are relayed only before their pass has started: the interface asks that (src/run-controls.js stalePassRefusal), after it asks whose gate this is
  if (state.gate.kind === RUN_CAP_KIND && (total === undefined || total === '')) { err('relay-answer: a limit needs --total <dollars>. Nothing was written.'); return 2; }   // A-DRAFT
  const reason = RELAY_REASON;   // one sentence for every relay, the terminal's and the MCP server's (src/run-controls.js); the bytes are the ones this line used to carry
  // S20 slice 1: a relayed RAISE is recorded through the one interface (src/run-controls.js); so, since slice 2 step 3.1, are a ruling and its withdrawal; any other limit gate keeps answerGateAsRelay (gate.js refuses it: only a raise may be relayed)
  const res = isRaiseGate(state.gate)
    ? answerControl(runDir, gateArg, { control: 'raise', channel: 'session', shownSha256: textSha256(bytes), reason, personWords, typedCap: String(total) }, opts)
    : isRulingGate(state.gate)   // step 3.1: a ruling and a withdrawal go through the interface too (its stage check is the same as the one above)
      ? answerControl(runDir, gateArg, { control: 'ruling', channel: 'session', shownSha256: textSha256(bytes), reason, personWords }, opts)
      : answerGateAsRelay(runDir, gateArg, { shownSha256: textSha256(bytes), reason, personWords }, opts);
  if (!res.ok) { err(terminalSafe(`gate ${gateArg}: ${res.message}`)); return 1; }
  out(`gate ${gateArg}: recorded, relayed by the handler session on the person's words. The tool cannot verify the permission; the record shows who relayed it.`);   // A-DRAFT
  return 0;
}

export function relayCommand(positional, { work = process.cwd(), personWords, total, stdout = process.stdout, stderr = process.stderr, now } = {}) {
  const err = s => stderr.write(`${s}\n`);
  const [runArg, gateArg, extra] = positional;
  if (!runArg || !gateArg || extra !== undefined) { for (const l of USAGE) err(l); return 2; }
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, GATES_DIR))) { err(`relay-answer: ${runArg} has no gates. Nothing was written.`); return 2; }
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
  const paused = pausePointOf(runDir, files);   // a revise pause, or a run stopped at the owner's pause (#16c)
  if (!paused.ok) { err(paused.why === 'pending' ? `ruling-add: the run waits for an answer to ${paused.label}; give that first. Nothing was written.` : 'ruling-add: the run is not at a revise pause, so there is no next pass to give a ruling to. Nothing was written.'); return 2; }   // A-DRAFT
  const on = stageOnDisk(runDir, paused.pass);
  if (on.length) { err(`ruling-add: pass ${paused.pass} already has a stage on disk (${on[0]}), so a ruling for it would change what that stage was asked. Nothing was written.`); return 2; }   // A-DRAFT
  const res = requestRuling(runDir, { pass: paused.pass, text: ruling, relayed }, now ? { now } : {});
  if (!res.ok) { err(terminalSafe(`ruling-add: ${res.message} Nothing was written.`)); return 2; }
  out(`ruling-add: a ruling for pass ${paused.pass} waits for his answer as gate ${res.gate.id}. The run will not go on until it is answered or has expired.`);   // A-DRAFT
  out(relayed ? `  council relay-answer ${runArg} ${res.gate.id} --person-words "<their answer exactly as they typed it in this window; it is accepted only if they wrote the ruling text in it>"` : `  council gate answer ${runArg} ${res.gate.id}`);   // A-DRAFT
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
      err(`ruling-withdraw: gate ${gateArg} still waits for the person's answer. To decline it at a terminal: council gate answer ${runArg} ${gateArg} --decline`);   // A-DRAFT
      err(`  If the handler session asked for it (--relayed), the session declines it itself: council ruling-withdraw ${runArg} ${gateArg} --relayed. Nothing was written.`);
      return 2;
    }
    const res = declineOwnRequest(runDir, gateArg, { reason: 'withdrawn by the handler session, which asked for it; this request never took effect' }, opts);
    if (!res.ok) { err(terminalSafe(`ruling-withdraw: gate ${gateArg}: ${res.message} Nothing was recorded.`)); return 1; }   // A-DRAFT
    out(`ruling-withdraw: gate ${gateArg} is declined; it set no ruling, and the run no longer waits for it.`);   // A-DRAFT
    return 0;
  }
  if (state.status !== 'approved' || state.gate.kind !== RULING_KIND) { err(`ruling-withdraw: gate ${gateArg} is ${state.status}${state.gate.kind === RULING_WITHDRAWAL_KIND ? ' and is a withdrawal' : ''}: only a waiting gate or an approved ruling can be withdrawn. Nothing was written.`); return 2; }   // A-DRAFT
  const files = readdirSync(runDir);
  const paused = pausePointOf(runDir, files);   // a revise pause, or a run stopped at the owner's pause (#16c)
  if (!paused.ok) { err(paused.why === 'pending' ? `ruling-withdraw: the run waits for an answer to ${paused.label}; give that first. Nothing was written.` : 'ruling-withdraw: the run is not at a revise pause, so there is no next pass to withdraw the ruling from. Nothing was written.'); return 2; }   // A-DRAFT
  const on = stageOnDisk(runDir, paused.pass);
  if (on.length) { err(`ruling-withdraw: pass ${paused.pass} already has a stage on disk (${on[0]}), so a withdrawal from it would change what that stage was asked. Nothing was written.`); return 2; }   // A-DRAFT
  const res = requestWithdrawal(runDir, { gate: gateArg, pass: paused.pass, relayed }, opts);
  if (!res.ok) { err(terminalSafe(`ruling-withdraw: ${res.message} Nothing was written.`)); return 2; }
  out(`ruling-withdraw: the withdrawal of ruling ${gateArg} from pass ${paused.pass} waits for the person's answer as gate ${res.gate.id}. The ruling stays in the record, and the passes that already ran keep it. The run will not go on until it is answered or has expired.`);   // A-DRAFT
  out(relayed ? `  council relay-answer ${runArg} ${res.gate.id} --person-words "<the person's answer, as typed in this window>"` : `  council gate answer ${runArg} ${res.gate.id}`);
  return 0;
}

/**
 * `council retag-add <run folder> --retag-objection <O-id> --retag-severity <1 to 10> --retag-reason "<why>"` (M1, S19 (c); copy N23, W38; his 31 Okt 2026 words "Handler session or layer-3 have permission to change severity tags"): the handler session's OWN act. It changes
 * the rating of ONE objection from the NEXT pass on, the one after the revise pause the run is waiting at. It needs no answer from the person, so there is no gate: the act is appended to retags.jsonl in the run folder (src/handler-retags.js) and the next resume
 * applies it at the top of its pass. Works only where the chain keeps ratings (a layered chain with "signoff": "unanimous") and has a reviser that pauses for the handler session (`chainOf(runMeta)` -> the chain config or null, supplied by the caller).
 * Refuses, writing nothing: no run, a chain that keeps no ratings or whose chain cannot be read, a pause that is not answered yet, a pass that already has a stage on disk (a re-tag would change what that stage was asked), an invalid or repeated re-tag, `--relayed` (nothing is relayed).
 * There is no undo: a mistaken re-tag is changed by the layer 3 verdict or by another handler re-tag in a later pass.
 */
export function retagAddCommand(positional, { work = process.cwd(), objection, severity, reason, relayed = false, chainOf, readRunMeta, stdout = process.stdout, stderr = process.stderr, now } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, extra] = positional;
  if (!runArg || extra !== undefined || typeof objection !== 'string' || typeof severity !== 'string' || typeof reason !== 'string') { err('usage: council retag-add <run folder> --retag-objection <O-id or L-id> --retag-severity <1 to 10> --retag-reason "<why>"'); return 2; }   // A-DRAFT
  if (relayed) { err('retag-add: --relayed does nothing here: a re-tag is the handler session\'s own act and needs no answer from the person. Nothing was written.'); return 2; }   // A-DRAFT
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, 'run.json'))) { err(`retag-add: ${runArg} is not a run folder. Nothing was written.`); return 2; }   // A-DRAFT
  const config = typeof chainOf === 'function' ? chainOf(readRunMeta ? readRunMeta(runDir) : null) : null;
  if (!config) { err('retag-add: the chain of this run cannot be read, so it cannot be checked for ratings. Nothing was written.'); return 2; }   // A-DRAFT
  if (!ratingsRecorded(config)) { err('retag-add: this run\'s chain keeps no ratings (only a layered chain with "signoff": "unanimous" does), so a rating cannot be changed on it. Nothing was written.'); return 2; }   // A-DRAFT
  const files = readdirSync(runDir);
  const paused = pausePointOf(runDir, files);   // a revise pause, or a run stopped at the owner's pause (#16c)
  // 0.8.4 S18 (Q3 (a), WORDING S18-w16): a LATE FINDING (L-...) is re-tagged while the run waits at its build check (the pause is `pending` for build-check-<n>); the re-tag belongs to the pass of the check (the highest pass with a stage), and no stage-on-disk refusal applies there: it changes no stage's ask.
  const lateId = /^L-/.test(objection);
  const atCheck = paused.ok === false && paused.why === 'pending' && /^build-check-\d+$/.test(String(paused.label ?? ''));
  if (lateId && !atCheck) { err('retag-add: a late finding (L-...) is re-tagged while the run waits at its build check; this run is not at one. Nothing was written.'); return 2; }   // A-DRAFT
  if (!lateId && !paused.ok) { err(paused.why === 'pending' ? `retag-add: the run waits for an answer to ${paused.label}; give that first. Nothing was written.` : 'retag-add: the run is not at a revise pause, so there is no next pass to change a rating from. Nothing was written.'); return 2; }   // A-DRAFT
  const pass = atCheck ? Math.max(1, highestStagedPass(files)) : paused.pass;
  const on = atCheck ? [] : stageOnDisk(runDir, paused.pass);
  if (on.length) { err(`retag-add: pass ${paused.pass} already has a stage on disk (${on[0]}), so a re-tag for it would change what that stage was asked. Nothing was written.`); return 2; }   // A-DRAFT
  const res = addHandlerRetag(runDir, { pass, id: objection, severity: Number(severity), reason }, now ? { now } : {});
  if (!res.ok) { err(terminalSafe(`retag-add: ${res.message} Nothing was written.`)); return 2; }
  out(atCheck
    ? `retag-add: the handler session's re-tag of ${objection} to ${Number(severity)} is recorded for pass ${pass}. The run applies it at its build check when it goes on (council --resume ${runArg}); the check you are answering is unchanged. It cannot be taken back.`   // A-DRAFT
    : `retag-add: the handler session's re-tag of ${objection} to ${Number(severity)} is recorded for pass ${pass}. The run applies it at the top of that pass when it goes on (council --resume ${runArg}). It cannot be taken back.`);   // A-DRAFT
  return 0;
}

/**
 * `council route-decide <run folder> [<request>] (--route | --decline) [--reason "<why>"] [--person-words "<the person's answer>"]` (S20 slice 2, control 1): the handler session's decision on the person's request to start the next pass at layer 3, or its own route
 * (no request number). `--route` is refused where the flag is (no ladder, a round-limit stop, a pause that is not at a revise, the credit, a stage already on disk) and where N7 forces a restart at layer 1; `--decline` closes a request and changes nothing else. The
 * handler gives a reason; when the PERSON decided and the session carries the answer out, `--person-words` holds his answer as he typed it and NO `--reason` is given (the line carries the relay sentence). Records one `route_decided` line; the pass starts at
 * layer 3 on the plain resume that follows. Takes no run lock (a named gap, closes at Q9(b)). `chainOf(meta)` loads the run's chain config (seats resolved) the way a resume does; `readRunMeta(dir)` reads run.json. Exit 0 recorded, 2 refused.
 */
export function routeDecideCommand(positional, { work = process.cwd(), route = false, decline = false, reason, personWords, stdout = process.stdout, stderr = process.stderr, now, chainOf, readRunMeta } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const usage = 'usage: council route-decide <run folder> [<request number>] (--route | --decline) [--reason "<why>"] [--person-words "<the person\'s answer>"]';   // A-DRAFT
  const [runArg, requestArg, extra] = positional;
  if (!runArg || extra !== undefined || route === decline) { err(usage); return 2; }
  if (requestArg !== undefined && !/^[1-9]\d*$/.test(requestArg)) { err(usage); return 2; }
  const requestSeq = requestArg === undefined ? null : Number(requestArg);
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, 'run.json'))) { err(`route-decide: ${runArg} is not a run folder. Nothing was written.`); return 2; }   // A-DRAFT
  const meta = readRunMeta ? readRunMeta(runDir) : null;
  const config = route && meta && chainOf ? chainOf(meta) : null;
  if (route && !config) { err('route-decide: the chain this run used cannot be loaded, so the route cannot be checked. Nothing was written.'); return 2; }   // A-DRAFT
  const res = decideRoute(runDir, { requestSeq, decision: route ? 'routed' : 'declined', personWords: typeof personWords === 'string' ? personWords : null, reason: typeof reason === 'string' ? reason : undefined, ladder: meta?.ladder ?? null, config }, now ? { now } : {});
  if (!res.ok) { err(terminalSafe(`route-decide: ${res.message} Nothing was written.`)); return 2; }
  if (route) {
    out(`route-decide: pass ${res.pass} is routed to layer 3 (decision ${res.seq}${requestSeq === null ? '' : `, request ${requestSeq}`}). Resume the run to start it: council --resume ${runArg}`);   // A-DRAFT
  } else {
    out(`route-decide: request ${requestSeq} is declined (decision ${res.seq}). Nothing was started.`);   // A-DRAFT
  }
  return 0;
}

/**
 * `council pause <run folder> [--reason "<why>"] [--person-words "<the person's answer>"]` (S20 slice 2, #16c, "pause after this round"): asks the RUNNING run to stop before its next pass. The run finishes the pass it is in; at the next pass boundary it stops
 * (exit 23, `run_status` owner_paused) before anything of that pass is logged, written or paid for, and a plain `council --resume <run folder>` continues it. Records ONE `pause_requested` line; takes no run lock (it must work while the run holds it).
 * Three ways to ask, as for a route decision: nothing given = the person at a TERMINAL (stdin and stdout must both be a terminal, read off the streams given, as `council gate answer` does; otherwise it refuses, so a handler session cannot be recorded as the person); `--person-words` =
 * the handler session relaying the person's answer (no `--reason`); `--reason` alone = the handler's own request. Refuses, writing nothing: no run, a bare request without a terminal, a run nobody is running, a tree member, a request that is already open. Exit 0 recorded, 2 refused.
 */
export function pauseCommand(positional, { work = process.cwd(), reason, personWords, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, now, readRunMeta } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, extra] = positional;
  if (!runArg || extra !== undefined) { err('usage: council pause <run folder> [--reason "<why>"] [--person-words "<the person\'s answer>"]'); return 2; }   // A-DRAFT
  const runDir = resolve(work, runArg);
  if (!existsSync(join(runDir, 'run.json'))) { err(`pause: ${runArg} is not a run folder. Nothing was written.`); return 2; }   // A-DRAFT
  const words = typeof personWords === 'string' ? personWords : null;
  const own = typeof reason === 'string' ? reason : null;
  if (words !== null && own !== null) { err('pause: a request that is the person\'s carries no reason of its own (the person types none); give --person-words or --reason, not both. Nothing was written.'); return 2; }   // A-DRAFT
  // the bare form is the PERSON'S, typed at a terminal: isTTY off the streams given, never off a setting (src/gate-cli.js answerAtTerminal). Without a terminal it refuses, before anything is looked up or written.
  if (words === null && own === null && (!stdin.isTTY || !stdout.isTTY)) { err('pause: a request typed by the person needs a person at a terminal: stdin and stdout must both be a terminal. A handler session gives the person\'s answer with --person-words "<their answer>" or its own reason with --reason "<why>". Nothing was written.'); return 2; }   // A-DRAFT
  const { ask } = pauseAskOf({ personWords: words, reason: own });   // the one mapping (src/run-controls.js); the both-given case was refused above
  const meta = readRunMeta ? readRunMeta(runDir) : null;
  const res = requestPause(runDir, { ...ask, tree: !!meta?.tree }, now ? { now } : {});
  if (!res.ok) { err(terminalSafe(`pause: ${res.message} Nothing was written.`)); return 2; }
  out(`pause: recorded (request ${res.seq}). The run finishes the pass it is in and stops at the next pass boundary, before that pass starts; nothing is paid for it. To go on afterwards: council --resume ${runArg}`);   // A-DRAFT
  out('  If no pass follows (the last pass is running), the request stays open and is listed in the report as not taken.');   // A-DRAFT
  return 0;
}
