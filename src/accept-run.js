// 0.8.4 T2.3 / D2 (C&C 09 Nov 2026): ask for and apply the ACCEPTANCE of a finished run's plan, for BOTH halves: the person's `council accept` (src/accept-cli.js) and the handling session's step of `stop_decide` (src/mcp/stop-decide.js).
// The question is a `kind: acceptance` gate whose text is built here from the run's report (src/acceptance.js) and rebuilt, byte for byte, whenever it is checked, so a changed report is a changed hash. The authority is the gate ledger;
// applying it derives the report's `acceptance` entry and the HANDOFF.md edit through the ONE rebuild note-add uses (src/handler-notes.js planAcceptance + writeDerived: temp files, then renames). A failed write leaves the old files and the
// approved gate, so the next call applies it again. No model call, no money.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRunJson, listRunFiles, writeRunFileAtomic } from './run-files.js';
import { requestGate, acceptancesOf, readGateAnswer, answerAcceptanceAsSession, ACCEPTANCE_KIND, RELAY_REASON } from './gate.js';
import { sha256Of } from './thin-contract.js';
import { acceptanceQuoteText, openObjectionsOf, acceptanceRefusal, acceptanceReasonProblem, sessionMayAccept } from './acceptance.js';
import { planAcceptance, writeDerived } from './handler-notes.js';

const QUOTE = /^accept-quote-(\d{4})\.md$/;
const quoteFileName = n => `accept-quote-${String(n).padStart(4, '0')}.md`;
const nextQuoteNumber = names => 1 + Math.max(0, ...names.map(n => Number(QUOTE.exec(n)?.[1] ?? 0)));

/** What the acceptance of this run is about, from its files: { report, meta, objections, body, sha256 } or { refusal: { code, message } }. */
export function acceptanceQuoteOf(runDir, runId) {
  const report = readRunJson(runDir, 'report.json');
  const refusal = acceptanceRefusal(report);
  if (refusal) return { refusal, report };
  if (!existsSync(join(runDir, 'HANDOFF.md'))) return { refusal: { code: 'no_handoff', message: 'this run wrote no HANDOFF.md, so there is no handoff to put the acceptance on.' }, report };   // A-DRAFT
  const meta = readRunJson(runDir, 'run.json') ?? {};
  if (meta.tree) return { refusal: { code: 'tree_member', message: `this run is a node of a recursive-councils tree. A node that did not agree is answered with the tree's own command, council tree decide ${typeof meta.tree.treeId === 'string' ? meta.tree.treeId : '<tree id>'} --stop <stop id> (it gives the node a new generation), not here.` }, report };   // A-DRAFT
  const objections = openObjectionsOf(report);
  const body = acceptanceQuoteText({ runId, report, objections });
  return { report, meta, objections, body, sha256: sha256Of(body) };
}

/**
 * Asks the acceptance question for this run: reuses the pending gate (or an approved one not yet applied) whose text is exactly today's question, else writes the question to accept-quote-NNNN.md and requests the gate.
 * `requestedBy`: 'session' for the handling session's question, undefined for the person's. -> { ok: true, gate, quote, approved } | { ok: false, code, message }.
 */
export function askAcceptance(runDir, runId, { requestedBy, now, write = writeRunFileAtomic } = {}) {   // `write`: the question file's writer (a test passes one that fails)
  const quote = acceptanceQuoteOf(runDir, runId);
  if (quote.refusal) return { ok: false, ...quote.refusal };
  const opts = now ? { now } : {};
  const found = acceptancesOf(runDir, opts);
  const done = found.accepted.find(x => x.gate === pickAcceptance(quote, found.accepted).chosen?.gate);
  if (done) return { ok: true, gate: readGateAnswer(runDir, done.gate, opts).gate ?? { id: done.gate }, quote, approved: true };
  const waiting = found.pending.find(x => x.sha256 === quote.sha256 && (requestedBy === 'session' ? x.requested_by === 'session' : x.requested_by !== 'session'));
  if (waiting) return { ok: true, gate: readGateAnswer(runDir, waiting.gate, opts).gate ?? { id: waiting.gate }, quote, approved: false };
  const file = quoteFileName(nextQuoteNumber(listRunFiles(runDir)));
  const written = write(runDir, file, quote.body);
  if (written.refusal) return { ok: false, code: 'io_error', message: `${written.refusal}. Nothing was recorded.` };
  const asked = requestGate(runDir, { kind: ACCEPTANCE_KIND, textPath: file, ...(requestedBy ? { requestedBy } : {}) }, opts);
  if (!asked.ok) return { ok: false, code: asked.code, message: `${asked.message} Nothing was recorded.` };
  return { ok: true, gate: asked.gate, quote, approved: false };
}

/** The handling session's approval of the acceptance question (src/gate.js answerAcceptanceAsSession: the kind, requester and shape rules are the gate's); this module is the one the tool reaches the gate through. */
export const answerAcceptance = (runDir, gateId, fields, opts) => answerAcceptanceAsSession(runDir, gateId, fields, opts);
/** 0.8.4 (relayed accept; typed = relayed): the PERSON's acceptance, carried by the session with the person's own words: no advisor, no person test (the session decides nothing), the relay sentence as the reason. */
export const answerAcceptanceRelayed = (runDir, gateId, { shownSha256, personWords }, opts) => answerAcceptanceAsSession(runDir, gateId, { shownSha256, reason: RELAY_REASON, acceptanceAnswer: { relayed: true }, personWords }, opts);

/** The report's `acceptance` entry for an approved gate (see src/acceptance.js): who, where, when, why, the objections accepted as they stand and, for the session, its advisor state and person tests. */
function entryOf(accepted, quote) {
  const answer = accepted.acceptance_answer ?? null;
  const tests = new Map((answer?.objections ?? []).map(o => [o.id, o.person_test]));
  const restored = quote.report.handoff_milestones?.status_set_by_harness ? quote.report.handoff_milestones.status : undefined;
  const relayed = answer?.relayed === true;   // the person's words, carried by the session: the actor is the person, the words sit beside the relay sentence
  return {
    gate: accepted.gate, actor: relayed ? 'person' : accepted.actor, channel: accepted.channel, at: accepted.at, reason: accepted.reason,
    ...(relayed ? { relayed: true, person_words: accepted.person_words } : {}),
    ...(answer && !relayed ? { advisor: answer.advisor, advisor_said: answer.advisor_said } : {}),
    objections: quote.objections.map(o => ({ id: o.id, ...(tests.has(o.id) ? { person_test: tests.get(o.id) } : {}), ...(o.late === true ? { late: true } : {}) })),   // a late finding is marked late (U3-w33, U3-w34)
    ...(answer?.over_disagreement?.length ? { over_disagreement: answer.over_disagreement } : {}),
    ...(typeof restored === 'string' ? { status_restored: restored } : {}),
  };
}

/**
 * Which approved acceptance counts for this question today: a PERSON's first (it needs no re-check), then a session's that passes today's checks (who may accept; its person tests name exactly the open objections). An approved gate that
 * fails its check is skipped, not an obstacle: it neither applies nor blocks the person's. -> { chosen } | { refusal: { code, message } } (the first reason found when nothing counts, or none approved).
 */
export function pickAcceptance(quote, accepted) {
  const mine = accepted.filter(a => a.sha256 === quote.sha256);
  if (!mine.length) return { refusal: { code: 'no_approved_gate', message: 'no approved acceptance of this run\'s plan as it stands is on the record (the plan, the objections or the question changed since it was asked).' } };   // A-DRAFT
  let first = null;
  const relayedOf = x => x.channel === 'session' && x.acceptance_answer?.relayed === true;   // the person's acceptance carried by the session: it counts as the person's (no session checks, no person tests)
  for (const a of [...mine.filter(x => x.channel !== 'session' || relayedOf(x)), ...mine.filter(x => x.channel === 'session' && !relayedOf(x))]) {
    const problem = acceptanceReasonProblem(a.reason);
    if (problem) { first ??= { code: 'no_reason', message: problem === 'empty' ? 'the acceptance carries no written reason, so it is not applied. Ask again with council accept --reason.' : 'the acceptance reason is not one line of plain text of at most 600 characters, so it is not applied.' }; continue; }   // A-DRAFT
    if (a.channel === 'session' && !relayedOf(a)) {
      const may = sessionMayAccept({ report: quote.report, meta: quote.meta });
      if (!may.ok) { first ??= { code: `session_${may.why}`, message: `the handling session may not accept this plan: ${may.message}` }; continue; }   // A-DRAFT
      const have = (a.acceptance_answer?.objections ?? []).map(o => o.id).sort();
      if (JSON.stringify(have) !== JSON.stringify(quote.objections.map(o => o.id))) { first ??= { code: 'objections_differ', message: 'the session\'s person tests do not name exactly the open objections of this run, so the acceptance is not applied.' }; continue; }   // A-DRAFT
    }
    return { chosen: a };
  }
  return { refusal: first };
}

/** Is there an approved acceptance that counts today for this run? (the reader the terminal command uses: gate.js stays this module's alone to import.) */
export function usableAcceptanceOf(runDir, runId, { now } = {}) {
  const quote = acceptanceQuoteOf(runDir, runId);
  if (quote.refusal) return null;
  const found = acceptancesOf(runDir, now ? { now } : {});
  return found.ok && pickAcceptance(quote, found.accepted).chosen ? { quote } : null;
}

/**
 * Applies the approved acceptance of this run: derives the entry from the ledger and writes report.json and HANDOFF.md through the shared rebuild. Idempotent (an acceptance already recorded is reported, not written again).
 * -> { ok: true, entry, already? } | { ok: false, code, message }.
 */
export function applyAcceptance(runDir, runId, { now, rename } = {}) {   // `rename`: passed to the shared rebuild (writeDerived), which a test makes fail
  const quote = acceptanceQuoteOf(runDir, runId);
  if (quote.refusal) return quote.refusal.code === 'already_accepted' ? { ok: true, already: true, entry: quote.report.acceptance } : { ok: false, ...quote.refusal };
  const found = acceptancesOf(runDir, now ? { now } : {});
  if (!found.ok) return { ok: false, code: 'gate_ledger_corrupt', message: 'the gate ledger of this run cannot be read, so no acceptance is applied.' };   // A-DRAFT
  const picked = pickAcceptance(quote, found.accepted);
  if (!picked.chosen) return { ok: false, ...picked.refusal };
  const entry = entryOf(picked.chosen, quote);
  const plan = planAcceptance(runDir, entry);
  if (!plan.ok) return { ok: false, code: plan.code, message: plan.code === 'handoff_changed' ? 'HANDOFF.md is not the file the run wrote (its hash differs from report.json), and an acceptance would hide that.' : plan.message };   // A-DRAFT
  const done = writeDerived(runDir, plan, rename ? { rename } : {});
  if (!done.ok) return { ok: false, code: 'io_error', message: `report.json and HANDOFF.md could not be updated (${done.why}). The approved acceptance stays on the ledger; run it again.` };   // A-DRAFT
  return { ok: true, entry };
}
