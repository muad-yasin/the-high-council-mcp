// The run record of an advice call (thc-research brief 29), written by the CLI that runs it.
//
// `advise-log.json` is one small file per advice run. It holds NO brief text: a date, the mode, the seats, the
// brief's sha256, hashed words of the question (so a repeat can be recognised without keeping what it said), the
// quoted and the spent price, the wall clock, the leaning, how many positions dissented and their ids, the
// dispositions the caller recorded, and one empty field a person fills in later (`owner_rating`). It is the ledger
// the guards read (src/advice-guards.js) and the month's log the owner reads in October (brief 30). Written when the
// run starts (so a run that dies is still counted) and again when it finishes.
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { retentionOf } from './advice-tier.js';
import { ADVISE_LOG_FILE, objectionIds, DISPOSITION_DECISIONS } from './advice-guards.js';
import { readGateAnswer, readGateText, textSha256, moreMaterialRecorded } from './gate.js';

export const ADVISE_LOG_SCHEMA = 'advise-log/1';
export { STOP_FILE } from './stop-files.js';
export const OWNER_RATINGS = ['useful', 'not useful', 'unclear'];
// How the person approved (0.8.1 plan DR-3): through an MCP elicitation or at the terminal (`council gate answer`), read from the
// gate's answer when the run is adopted; 'cli' is also the record of a person who started an advice chain at a terminal themselves.
// 'allowance' and 'host' are gone in 0.8.1: there is no waiver and no operator statement.
export const APPROVAL_CHANNELS = ['elicitation', 'cli'];
// An advice call's run folder, created by the server before anyone approves (plan DR-15, persistence register P6): the masked text
// the person approves and a meta file that holds no brief text.
export const ADVICE_BRIEF_FILE = 'advice-brief.md';
export const ADVICE_META_FILE = 'advice.meta.json';
export const ADVICE_META_SCHEMA = 'advice-meta/1';

export { isAdviceFolder } from './stop-files.js';

export const sha256Hex = text => createHash('sha256').update(text, 'utf8').digest('hex');

const isHex = (v, n) => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
const num = v => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * The meta file the MCP server writes into an advice call's run folder (advice.meta.json), validated. Nothing in it is
 * trusted beyond its shape: it cannot name a seat, a price or a provider, only describe what the server did. It names
 * the chain and the gate; it does not say how the call was approved (nobody had when it was written: the gate says).
 * Returns { meta } or { error }.
 */
export function readAdviceMeta(path) {
  let m;
  try { m = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { return { error: `--advice-adopt: cannot read ${path} (${e.message})` }; }
  const bad = why => ({ error: `--advice-adopt: ${ADVICE_META_FILE}: ${why}` });
  if (!m || typeof m !== 'object' || Array.isArray(m)) return bad('not an object');
  if (m.schema !== ADVICE_META_SCHEMA) return bad(`schema is not ${ADVICE_META_SCHEMA}`);
  if (typeof m.chain !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(m.chain)) return bad('chain');
  if (typeof m.gate !== 'string' || !/^g[1-9][0-9]{0,5}$/.test(m.gate)) return bad('gate');
  if (typeof m.quote_id !== 'string' || !/^q_[0-9a-f]{24}$/.test(m.quote_id)) return bad('quote_id');
  if (!isHex(m.brief_sha256, 64)) return bad('brief_sha256');
  if (!['single', 'council'].includes(m.mode)) return bad('mode');
  if (!isHex(m.question_hash, 16) || !Array.isArray(m.question_words) || m.question_words.length > 400 || !m.question_words.every(w => isHex(w, 8))) return bad('question_hash or question_words');
  if (!m.quoted || !num(m.quoted.worst_usd) || !num(m.quoted.expected_usd) || !(num(m.quoted.ceiling_usd) && m.quoted.ceiling_usd > 0)) return bad('quoted');
  if (m.previous_run !== null && m.previous_run !== undefined && typeof m.previous_run !== 'string') return bad('previous_run');
  if (!Array.isArray(m.dispositions) || m.dispositions.length > 40 || !m.dispositions.every(d => d && typeof d.id === 'string' && DISPOSITION_DECISIONS.includes(d.decision) && typeof d.reason === 'string')) return bad('dispositions');
  if (typeof m.effective_sensitivity !== 'string') return bad('effective_sensitivity');
  // 0.8.1 P7, additive: the client's own name and version as it gave them at initialize (a label, never an authority). Absent in
  // folders written before M5.
  const label = v => v === null || (typeof v === 'string' && v.length <= 200);
  if (m.client !== undefined && !(m.client && typeof m.client === 'object' && label(m.client.name) && label(m.client.version))) return bad('client');
  return { meta: m };
}

/** Where a brief went: one row per seat (panel, then the synthesis seat), from the chain as it ran. */
export function sentToOf(config, stages = []) {
  const seats = [...(config.seats?.critics || []), ...(config.advise?.synthesis === 'seat' && config.seats?.builder ? [config.seats.builder] : [])];
  return seats.map(s => {
    const r = retentionOf(s);
    const lab = s.lab || s.provider;
    // The host the provider says answered, when it says (OpenRouter does). Empty when no call was made or none named one.
    const served = [...new Set((stages || []).filter(x => x.lab === lab && x.endpoint).map(x => x.endpoint))];
    return { lab, model: s.model, provider: s.provider, retention: r.label, retention_class: r.class, served_by: served };
  });
}

function writeAtomic(path, text) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/**
 * Whether the advice call in `dir` may start now (`council --advice-adopt`, plan DR-15): its meta file reads, nothing has
 * started in it, its gate is approved, unexpired and unused, and the brief's bytes hash to what the person approved and to
 * what the quote showed. Returns { meta, channel, gate } or { error }. Writes nothing: the CLI records the send (recordSent), after
 * checking the chain it loaded against the gate's seats, ceiling and sensitivity (src/cli.js), since advice.meta.json is not hashed.
 */
export function adoptCheck(dir, { now } = {}) {
  const r = readAdviceMeta(join(dir, ADVICE_META_FILE));
  if (r.error) return r;
  const meta = r.meta;
  if (existsSync(join(dir, 'run.json')) || existsSync(join(dir, ADVISE_LOG_FILE))) return { error: '--advice-adopt: a run already started in this folder; an approval covers one send' };
  const st = readGateAnswer(dir, meta.gate, now ? { now } : {});
  if (st.status !== 'approved') return { error: `--advice-adopt: gate ${meta.gate} is ${st.status}${st.reason ? ` (${st.reason})` : ''}, not approved` };
  if (st.used) return { error: `--advice-adopt: gate ${meta.gate} was already used for a send` };
  if (!st.usable) return { error: `--advice-adopt: the approval of gate ${meta.gate} lapsed at ${st.usable_until}` };
  if (st.gate.text !== ADVICE_BRIEF_FILE) return { error: `--advice-adopt: gate ${meta.gate} approves ${st.gate.text}, not ${ADVICE_BRIEF_FILE}` };
  // What the person was shown about the send is bound in the gate (meta_sha256); an advice gate that showed no price or no seats
  // approved nothing the run could be held to.
  if (st.gate.kind !== 'advice' || !st.gate.price || !(st.gate.price.ceiling_usd > 0) || !Array.isArray(st.gate.seats) || !st.gate.seats.length) {
    return { error: `--advice-adopt: gate ${meta.gate} does not name the seats and the ceiling the person approved` };
  }
  const bytes = readGateText(dir, ADVICE_BRIEF_FILE);
  const sha = bytes ? textSha256(bytes) : null;
  if (sha !== st.gate.sha256 || sha !== meta.brief_sha256) return { error: `--advice-adopt: ${ADVICE_BRIEF_FILE} is not the text that was approved and quoted` };
  // P7: how long the person took, from the gate's request to its answer (both in the verified ledger and the gate file).
  const waited = Date.parse(st.answer.ts) - Date.parse(st.gate.requested_at);
  return { meta, channel: st.answer.channel, gate: st.gate, approvalWaitMs: Number.isFinite(waited) && waited >= 0 ? waited : null };
}

/**
 * Whether the advice run in `dir` asked for more material (0.8.1 DR-8): its ledger holds `more_material_requested`, or its
 * report.json's advise.missing_from_brief is not empty. Either is enough: the event is the record the plan names, the report is
 * what it was derived from, so a lost event still shows the follow-up line (it errs toward telling the person).
 */
export function moreMaterialRequested(dir) {
  if (moreMaterialRecorded(dir)) return true;
  try { return (JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).advise?.missing_from_brief || []).length > 0; } catch { return false; }
}

/** The first write: before any call, so a run that dies is still in the ledger. `approval`: the gate's channel, or 'cli'. */
export function writeAdviceLogStart(dir, { run, chain, config, meta, briefSha256, startedMs, approval = 'cli', approvalWaitMs = null }) {
  const log = {
    schema: ADVISE_LOG_SCHEMA,
    run, ts: startedMs, date: new Date(startedMs).toISOString().slice(0, 10),
    origin: meta ? 'tool' : 'cli',
    chain,
    mode: meta?.mode ?? null,
    approval,
    gate: meta?.gate ?? null,
    // 0.8.1 P7 (additive): the client that asked, as it named itself, and how long the person took to approve. null for a person's
    // own terminal run.
    client: meta?.client ?? null,
    approval_wait_ms: approvalWaitMs,
    sensitivity: meta?.effective_sensitivity ?? null,
    seats: sentToOf(config).map(({ lab, model }) => ({ lab, model })),
    brief_sha256: briefSha256,
    question_hash: meta?.question_hash ?? null,
    question_words: meta?.question_words ?? [],
    quoted: meta?.quoted ?? { worst_usd: null, expected_usd: null, ceiling_usd: config.advise.usd },
    status: 'started',
    spent_usd: null, wall_ms: null, leaning: null, confidence: null, dissent_count: null, dissent_ids: [], stopped_by: null,
    previous_run: meta?.previous_run ?? null,
    dispositions: [], dispositions_complete: true,
    // Filled in by a person, later: { "rating": "useful" | "not useful" | "unclear", "note": "" }. Never read by the tools.
    owner_rating: null,
    note: 'No brief text is kept here: only its sha256 and hashed words of the question.',
  };
  writeAtomic(join(dir, ADVISE_LOG_FILE), `${JSON.stringify(log, null, 2)}\n`);
  return log;
}

/** The last write: what the run did. `advise` is report.json's advise object, absent when the run stopped before an answer. */
export function writeAdviceLogFinish(dir, { status, spentUsd, wallMs, advise = null, stoppedBy = null }) {
  const p = join(dir, ADVISE_LOG_FILE);
  if (!existsSync(p)) return;
  let log;
  try { log = JSON.parse(readFileSync(p, 'utf8')); } catch { return; }
  const ids = advise ? objectionIds(log.run, advise) : [];
  Object.assign(log, {
    status,
    spent_usd: Math.round(spentUsd * 1e6) / 1e6,
    wall_ms: wallMs,
    leaning: advise?.verdict ?? null,
    confidence: advise?.confidence ?? null,
    dissent_count: advise ? (advise.dissent || []).length : null,
    dissent_ids: ids,
    // Nothing to disposition means the gate is open; a run with objections waits for the caller's words.
    dispositions_complete: ids.length === 0,
    stopped_by: stoppedBy ?? advise?.stopped_by ?? null,
  });
  writeAtomic(p, `${JSON.stringify(log, null, 2)}\n`);
}

/**
 * The additive report.json fields of an advice run (brief 29; all experimental), nested under `advise` (0.8.1 DR-13
 * naming pass): where the brief went (`sent_to`) and the dispositions the caller recorded before this call (about
 * `previous_run`). The brief's hash is the report's `task_sha256` (the brief is the task file) and why the call
 * stopped short is `advise.stopped_by`, so neither is repeated here.
 */
export function adviceReportExtra({ config, meta, stages = [] }) {
  return {
    sent_to: sentToOf(config, stages),
    dispositions: (meta?.dispositions || []).map(d => ({ id: d.id, decision: d.decision, reason: d.reason })),
  };
}
