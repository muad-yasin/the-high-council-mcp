// The paid repair recommendation, the TERMINAL ROUTE (0.8.3 ROADMAP 77, step 4b; plan note Review/Build_0.8.3/m7/Roadmap77_Paid_Repair_Plan_Note_2026-10-20.md sections 12 and 13). One foreground process, the person's terminal:
// the offer and the grant gate (a tree_decide gate answered by TYPING a word: PLAN 8.2, no new gate kind; C&C ruling B of 20 Okt), the hold (registerAdviceAdmitted), the advice add-on's own quote -> approve -> send path
// (createAdviceSendContext, the brief approved at the terminal by answerAtTerminal), the wait for the detached run (polled), the reading of the answer (parseRecommendations), the person's pick. The request is ended (endAdvice) BEFORE
// the route returns, so the decision that follows is built on figures with no hold in them (the table refuses a root re-plan while one is open). Neither the session nor this route ever answers a personal-data stop.
// HELD: the brief the advisor reads needs harness-written phrases that have no yes yet (the structured brief's other fields); `deps.buildBrief` is injected and the production default throws HeldBriefWording, so the route is
// DORMANT in production (it offers nothing) until the owner has said yes to those phrases. A request is never ended while its run can still spend (Ctrl-C stops the run and waits for it).
import { spawn } from 'node:child_process';
import { existsSync, openSync, closeSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdviceSendContext } from './advice-send-context.js';
import { adviceResult } from './mcp/advice.js';
import { loadAdviceChain } from './send-profiles.js';
import { nextRunId, readRunJson } from './run-files.js';
import { writeStopRequest } from './stop-files.js';
import { TREE_GATE_KINDS, askBriefAtTerminal, askTreeGate, recordTreeUse, requestTreeGate } from './tree-gate.js';
import { TreeRefusal, readTreeRecord } from './tree-record.js';
import { budgetOf, capFactsOf, gateTree } from './tree-budget.js';
import { rootReplanPreflight } from './tree-root-replan.js';
import { adviceChainNamed, adviceOfferFacts, adviceOfferLines } from './tree-advice.js';
import { RUNNING, adviceStart, defaultRunStatusOf, endAdvice, registerAdviceAdmitted, writeAdviceTreeMarker } from './tree-advice-record.js';
import { parseRecommendations } from './tree-advice-parse.js';
import { DECISION_MAX_BYTES } from './tree-decide-stop.js';
import { terminalSafe, terminalSafeMarked } from './terminal-safe.js';
import { sha256Of } from './thin-contract.js';

/** The word the person types to approve the grant (B-DRAFT; PLAN 8.2: a tree gate is answered by typing what its last line names). */
export const GRANT_WORD = 'ask';
/** The grant gate's text: the offer lines with E22-6's "[y/N]" replaced by the one instruction (B-DRAFT: one instruction only, a person who types y is not met by two). */
export function grantGateText(lines) {
  const last = lines.at(-1);
  if (!last.endsWith(' [y/N]')) throw new Error('the offer\'s last line is not the question');
  return `${[...lines.slice(0, -1), `${last.slice(0, -' [y/N]'.length)}. To ask for it, type: ${GRANT_WORD}`].join('\n')}\n`;
}

export class HeldBriefWording extends Error {}
/** The production brief builder: HELD (see the file header). */
export const heldBriefBuilder = () => { throw new HeldBriefWording('the words of the recommendation brief are held for the owner\'s yes'); };

/** A detached run of the CLI in the working folder, as the MCP server starts an advice run. -> { started, exitCode?, logTail? } once the run has begun (its advise-log exists) or ended. */
export function cliRunSpawner({ work, cli = fileURLToPath(new URL('./cli.js', import.meta.url)), env = process.env, startupMs = 60_000 }) {
  return async (id, args) => {
    const logPath = join(work, `council-${id}.log`);
    const fd = openSync(logPath, 'a');
    const child = spawn(process.execPath, process.pkg ? args : [cli, ...args], { cwd: work, env: process.pkg ? { ...env, PKG_EXECPATH: '' } : env, detached: true, stdio: ['ignore', fd, fd] });
    closeSync(fd);
    let exited = null;
    child.on('exit', (code, signal) => { exited = { code, signal }; });
    child.unref();
    const runDir = join(work, 'runs', id);
    const t0 = Date.now();
    while (!exited && !existsSync(join(runDir, 'advise-log.json')) && Date.now() - t0 < startupMs) await new Promise(r => setTimeout(r, 100));
    if (exited && !existsSync(join(runDir, 'advise-log.json'))) {
      let logTail = ''; try { logTail = readFileSync(logPath, 'utf8').split('\n').slice(-20).join('\n'); } catch { /* no log */ }
      return { started: false, exitCode: exited.code, logTail };
    }
    return { started: true, pid: child.pid };
  };
}

const none = (why) => ({ kind: 'none', why });

/**
 * Offers the recommendation and, when the person says yes, asks for it and waits. -> { kind: 'none', why } (nothing asked, nothing changed), { kind: 'own', adviceId } (asked, the person types their own decision),
 * { kind: 'recommended', text, fromRecommendation: { n, adviceId } } (the chosen recommendation's text, verbatim). The request is ended in every case where it was begun.
 */
export async function askForRecommendation({ rootDir, rootId, work, stdin, stdout, stderr, env = process.env, now = () => Date.now(), sittingHeld = () => false, stopId, deps = {} }) {
  const out = s => stdout.write(`${s}\n`); const err = s => stderr.write(`${s}\n`);
  const runsDir = dirname(rootDir);
  const d = { buildBrief: heldBriefBuilder, spawnRun: cliRunSpawner({ work, env }), nextRunId, loadChain: name => loadAdviceChain(name, { env, work }), pollMs: 2000, progressMs: 20_000, ...deps };
  d.buildBrief ??= heldBriefBuilder;
  const pre = rootReplanPreflight(rootDir, { work, stopId, sittingHeld });             // the existing guard (any active node, a sitting, the accounting gate, the money), not a copy
  if (pre.refusal) return none('preflight');                                             // not a root re-plan, or decide's own preflight says why
  let brief;
  try { brief = d.buildBrief({ rootDir, stop: pre.stop, task: pre.task }); } catch (e) { if (e instanceof HeldBriefWording) return none('held'); throw e; }
  const chain = adviceChainNamed({ env });
  if (!chain.named) { for (const l of adviceOfferLines({ offer: false, why: 'no_chain' })) out(l); return none('no_chain'); }
  const ctx = createAdviceSendContext({ work, runsDir, env, loadChain: d.loadChain, spawnRun: d.spawnRun, nextRunId: d.nextRunId });
  const { sendPath } = ctx;
  const priced = sendPath.runQuote('advice', { brief, mode: 'single', max_usd: null });
  if (priced.refusal) { err(`No recommendation is offered: ${terminalSafe(priced.refusal.reason)}`); return none('quote_refused'); }
  // the offer, from what the tree can grant TODAY (one formula: budgetOf) and the quote's own upper estimate for one call
  const figuresNow = ceilingUsd => {
    const record = readTreeRecord(rootDir); const gate = gateTree(rootDir, { record }); const budget = budgetOf(rootDir, { record, gate });
    return adviceOfferFacts({ chain, cap: capFactsOf(record, budget), availableNowUsd: budget.availableUsd, freeUsd: pre.freeUsd, cheapestUsd: pre.chain.figures.cheapestUsd, ceilingUsd, reaskAvailable: false });
  };
  const facts = figuresNow(priced.quote.price.ceiling_usd);
  const lines = adviceOfferLines(facts, { rootId });
  if (!facts.offer) { for (const l of lines) out(l); return none(facts.why); }
  const text = grantGateText(lines);
  const gate = requestTreeGate(rootDir, { kind: TREE_GATE_KINDS.decide, text }, { now });
  if (!gate.ok) { err(`tree decide: cannot ask for the recommendation (${gate.code}): ${gate.message}`); return none('gate'); }
  const code = await askTreeGate(rootDir, gate.gate.id, { expectPrefix: GRANT_WORD, typedLabel: 'the word', stdin, stdout, stderr, now });
  if (code !== 0) { out(`No recommendation was asked for. To ask for it, run the command again and type: ${GRANT_WORD}`); return none('declined'); }
  // what the person read must still be what is held: the figures are built AGAIN, the quote too, BEFORE the approval is used
  const quoteNow = sendPath.runQuote('advice', { brief, mode: 'single', max_usd: null });
  const again = quoteNow.refusal ? null : figuresNow(quoteNow.quote.price.ceiling_usd);       // the price is the one the quote gives NOW, not the one that was shown
  if (!again?.offer || grantGateText(adviceOfferLines(again, { rootId })) !== text) {
    err('tree decide: what you were shown has changed while you were reading it (a figure or a limit). Your approval was NOT used and nothing was held. Run the command again to see the new figures.');
    return none('changed');
  }
  const used = recordTreeUse(rootDir, gate.gate.id, 'tree_decide', { form: 'recommendation' }, { now });
  if (!used.ok) { err(`tree decide: the approval could not be used (${used.code}): ${used.message}. Nothing was held.`); return none('gate'); }
  const adviceId = `rec-${gate.gate.id}`;
  try {
    registerAdviceAdmitted(rootDir, { adviceId, grantUsd: facts.grantUsd, stopId: pre.stop.id, gateId: gate.gate.id, shownSha256: sha256Of(text), answer: used.answeredBy, ttlMs: ctx.ttlMs }, { now });
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    err(`tree decide: ${terminalSafe(e.reason)}. Nothing was held and nothing was spent.`);
    return none('not_admitted');
  }
  // from here the request is OURS to end, on every way out
  let runId = null; let runDir = null; let mayStillSpend = false;
  const finish = (reason) => { if (!mayStillSpend) endAdvice(rootDir, { adviceId, reason }, { now }); };
  try {
    const q = sendPath.runQuote('advice', { brief, mode: 'single', max_usd: facts.grantUsd });
    if (q.refusal || !(q.quote.price.ceiling_usd <= facts.grantUsd + 1e-9)) {
      err(`The recommendation was not asked for: ${q.refusal ? terminalSafe(q.refusal.reason) : 'its price is more than was set aside'}. Nothing was spent. You can type your own decision.`);
      finish('never_started'); return { kind: 'own', adviceId };
    }
    const io = { canElicit: () => false, budgetEnd: Date.now() + 120_000 };
    const first = await sendPath.runSend('advice', { quote_id: q.quote.quote_id, confirm_sha256: q.quote.sha256 }, io);
    if (!first.awaiting) {
      err(`The recommendation was not asked for: ${terminalSafe(first.refusal?.reason ?? first.startFailed?.logTail ?? 'it could not be prepared')}. Nothing was spent. You can type your own decision.`);
      finish('never_started'); return { kind: 'own', adviceId };
    }
    runId = first.awaiting.run; runDir = join(runsDir, runId);
    adviceStart(rootDir, { adviceId, runId, kind: 'first', briefSha256: q.quote.sha256, shownSha256: q.quote.sha256 }, { now });     // the call is added to the request BEFORE the person is asked and before anything is sent
    writeAdviceTreeMarker(runDir, { rootDir, adviceId });
    const approved = await askBriefAtTerminal(runDir, first.awaiting.gate, { stdin, stdout, stderr, now });
    if (approved !== 0) { out('The brief was not approved: nothing was sent and nothing was spent.'); finish('declined'); return { kind: 'own', adviceId }; }
    mayStillSpend = true;
    const sent = await sendPath.runSend('advice', { quote_id: q.quote.quote_id, confirm_sha256: q.quote.sha256 }, io);
    if (!sent.startedRun) {
      mayStillSpend = false;
      err(`The recommendation was not asked for: ${terminalSafe(sent.refusal?.reason ?? sent.startFailed?.logTail ?? 'the run did not start')}. Nothing was spent. You can type your own decision.`);
      finish('never_started'); return { kind: 'own', adviceId };
    }
    // the wait: this process polls the run folder; Ctrl-C asks the run to stop (by the person) and keeps waiting for it to end, because a call in flight finishes and is billed
    let interrupted = false;
    const onSigint = () => { if (interrupted) return; interrupted = true; try { writeStopRequest(runDir, { by: 'user', run: runId, note: 'ctrl-c in council tree decide' }); } catch { /* the run ends at its own ceiling */ } out('Stopping the recommendation request; waiting for the call in flight to end.'); };
    (d.signals ?? process).on('SIGINT', onSigint);
    let status;
    try {
      let lastNote = Date.now();
      for (;;) {
        status = defaultRunStatusOf(runDir);
        if (!RUNNING.has(status)) break;
        if (Date.now() - lastNote >= d.progressMs) { out('Still waiting for the recommendation...'); lastNote = Date.now(); }
        await new Promise(r => setTimeout(r, d.pollMs));
      }
    } finally { (d.signals ?? process).off('SIGINT', onSigint); sent.disarm?.(); }
    mayStillSpend = false;
    if (interrupted) { out('Stopped. Nothing was decided.'); finish('stopped'); return { kind: 'own', adviceId, interrupted: true }; }
    const report = readRunJson(runDir, 'report.json');
    if (status !== 'done' || !report?.advise) {
      err(`The recommendation could not be asked for: the request ended (${terminalSafe(String(status))}). You can type your own decision.`);
      finish('stopped'); return { kind: 'own', adviceId };
    }
    const answer = adviceResult({ run: runId, report, mapping: ctx.masks.get(runId) || null }).structuredContent.answer;
    const parsed = parseRecommendations(answer, { maxBytes: DECISION_MAX_BYTES });
    finish('settled');
    if (!parsed.ok) {
      out('The answer could not be read as recommendations. It is shown below as it came back. Type your own decision.');
      out(terminalSafeMarked(String(answer ?? '')));
      return { kind: 'own', adviceId };
    }
    if (!parsed.numbered) out('The answer is shown as one recommendation.');
    out('Recommendations (a suggestion, never a fix; nothing in them is checked):');
    for (const it of parsed.items) out(`${it.n}. ${terminalSafe(it.text)}`);
    const pick = await readPick({ stdin, stdout });
    const chosen = /^\d+$/.test(pick) ? parsed.items.find(it => it.n === Number(pick)) : null;
    if (chosen) return { kind: 'recommended', text: chosen.text, fromRecommendation: { n: chosen.n, adviceId } };
    return { kind: 'own', adviceId };
  } catch (e) {
    if (!mayStillSpend) { try { endAdvice(rootDir, { adviceId, reason: 'crashed' }, { now }); } catch { /* the reconcile ends it */ } }
    throw e;
  }
}

/** One line from the terminal: a number, or anything else. B-DRAFT prompt. */
function readPick({ stdin, stdout }) {
  stdout.write('Type a number to use that recommendation as your decision, or press Enter to type your own decision: ');
  return new Promise(res => {
    let buf = '';
    const onData = chunk => { buf += String(chunk); const i = buf.indexOf('\n'); if (i !== -1) { stdin.off('data', onData); stdin.pause?.(); res(buf.slice(0, i).trim()); } };
    stdin.on('data', onData); stdin.resume?.();
  });
}
