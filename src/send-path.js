// The shared send path (0.8.1 plan DR-5): quote, approve, start. One copy for every kind of send; a kind brings its
// own profile (src/send-profiles.js) and nothing else. The MCP tools are thin handlers over it (src/mcp/advice.js).
//
// Contract.
//   createSendPath(ctx) -> { runQuote(kind, input), runSend(kind, input, io), quotes }
//     ctx: { work, runsDir, env, loadChain, spawnRun, nextRunId, usdLimit, masks, maskAt, ownRuns, ttlMs }
//     runQuote -> { refusal } | { quote, out }            nothing is sent, written or spent
//     runSend  -> { refusal, recorded } | { busy: true } | { awaiting } | { startFailed } | { startedRun }
//     io (from the handler, the parts only a live client has):
//        { elicit(message, schema, timeoutMs), canElicit(), signal, approvalDeadline, clientName, clientVersion }
//   A send (plan DR-3, DR-15): the run folder with the exact text, the meta file and a gate are written first; a person
//   approves the gate (the client's dialog here, or `council gate answer`); the run starts only on an approved gate, through
//   `council --advice-adopt runs/<id>`, which records the send. Until someone answers, runSend returns `awaiting`.
//   previewText(q): the text a person reads before approving.
// Owned state: the in-memory quote store (transient by design, persistence register P14: a restart loses it and the
// agent quotes again) and the cross-process lock in the working folder.
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dashFence } from './text-fence.js';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { retentionAsOf, retentionAgeDays, RETENTION_STALE_DAYS, sensitivityWords } from './advice-tier.js';
import { ADVISE_LOG_FILE, DISPOSITION_MIN_REASON_CHARS, checkDispositions, decide, installSalt, openObjections, readLedger } from './advice-guards.js';
import { sha256Hex, ADVICE_BRIEF_FILE, ADVICE_META_FILE, ADVICE_META_SCHEMA, moreMaterialRequested } from './advice-run.js';
import { requestGate, answerGate, readGateAnswer } from './gate.js';
import { loadPolicy, evaluatePolicy, monthToDateUsd } from './policy.js';
import { acquireRunLock, RunLockedError } from './run-lock.js';
import { profileFor, DEFAULT_SEAT } from './send-profiles.js';
import { preSendRefusals, admitChain, seatsOf, previewSeats, gateSeatsOf, money } from './send-path-refusals.js';

// A quote lives this long (brief 29: about ten minutes). A quote stores the masked text, so the number of live quotes is capped too.
export const QUOTE_TTL_MS = 10 * 60_000;
export const MAX_LIVE_QUOTES = 20;

// The terminal fallback command (audit A3-3, 0.8.1): `council` is on PATH only after a global install, and `runs/<id>` is relative to wherever the person's shell
// is. This names this very install's node and cli.js and the absolute run folder, so it works from any folder, under a plugin or an npx install, with no network.
const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), 'cli.js');
const shellQuote = v => (/^[A-Za-z0-9_\/.:@%+=,-]+$/.test(v) ? v : `"${v.replace(/(["\\$`])/g, '\\$1')}"`);
// The standalone binary (process.pkg) IS the CLI: its first argument is the subcommand, and CLI_PATH would point inside its snapshot. Under a plain Node install the command is
// node + cli.js. Not verified under the .mcpb route (Claude Desktop's own Node): a README Known limit says so.
export const gateAnswerCommand = (runDir, gateId, { pkg = process.pkg, execPath = process.execPath, cli = CLI_PATH } = {}) =>
  `${shellQuote(execPath)}${pkg ? '' : ` ${shellQuote(cli)}`} gate answer ${shellQuote(runDir)} ${gateId}`;

const lastLineOf = text => { const lines = String(text).split('\n').filter(l => l.trim() !== ''); const l = lines.length ? lines[lines.length - 1].trim() : ''; return l.length > 80 ? `${l.slice(0, 77)}...` : l; };

// The message of the approval dialog (the client's elicitation): the preview, then the exact text, then a closing sentence. (Extracted unchanged for tests.)
export function dialogMessage(q) {
  const fence = dashFence(q.text);   // audit A3-4: longer than any dash run in the text, so the text cannot fake its own end
  return `${previewText(q)}\n\nThe text that would be sent (everything between the two lines of ${fence.length} dashes, ${[...q.text].length} characters):\n${fence}\n${q.text.endsWith('\n') ? q.text : `${q.text}\n`}${fence}\nThe text above has ${[...q.text].length} characters and its last line reads: ${JSON.stringify(lastLineOf(q.text))}. (If a client draws the dash lines alike, check that last line: nothing after it is sent.)\nAn AI agent asked for this. Approve only if you want this text sent to the models above, and this money spent.`;
}

/** The text a person reads before approving: who, what (hash and size), the price. The brief text follows it in an elicitation. */
export function previewText(q) {
  const lines = [
    `Send preview (nothing has been sent or spent). Quote ${q.quote_id}, valid until ${new Date(q.expires_ms).toISOString()}.`,
    ...(q.follow_up ? [q.follow_up] : []),
    `Mode: ${q.mode}. Sensitivity: ${sensitivityWords(q.sensitivity)}. The agent's label is its word: check it against the text.`,
    'To:',
    ...q.seats.map(s => `  - ${s.lab} (${s.model}): ${s.retention}${s.retention_class ? ` [class ${s.retention_class}]` : ''}. ${s.detail}`),
    `Text: ${q.bytes} bytes, sha256 ${q.sha256}${Object.keys(q.masked).length ? `; masked before sending: ${Object.entries(q.masked).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ')}` : '; nothing needed masking'}.`,
    `Price: worst case ${money(q.price.worst_usd)}, expected about ${money(q.price.expected_usd)} (expected uses assumed or review-length output sizes: unmeasured for advice). The call cannot spend more than ${money(q.price.ceiling_usd)}.`,
    `"ZDR-tagged by OpenRouter" is OpenRouter's routing tag for that endpoint, not a guarantee. The retention table is dated ${retentionAsOf()}${retentionAgeDays() > RETENTION_STALE_DAYS ? ` (${retentionAgeDays()} days old: re-check it)` : ''}. No scanner catches names, addresses, phone numbers or passwords written as prose: read the text.`,
  ];
  return lines.join('\n');
}

// A lock across server processes in one working folder (two terminals on one repo): the guards and the start of a run are one critical
// section, and an in-process queue alone cannot make it so for two servers. It is run-lock.js's O_EXCL file with stale-pid takeover.
async function withProcessLock(work, fn, waitMs = 30_000) {
  // waitMs: what is left of the caller's hold (createSendPath's lockWaitFor), so a busy lock never keeps a client past it.
  const dir = join(work, '.council-advice-lock');
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  let release;
  for (;;) {
    // P14: a lock file that cannot be read (a crash between creating it and writing the pid) is stale once older than 30 s, as the
    // ledger lock's is; otherwise every council_advise in this folder would answer `busy` for ever. A readable lock is judged by its
    // pid (its holder legitimately spans a run's start-up wait).
    try { release = acquireRunLock(dir, { unreadableStaleMs: 30_000 }); break; } catch (e) {
      if (!(e instanceof RunLockedError)) throw e;
      if (Date.now() - t0 > waitMs) return { busy: true };
      await new Promise(r => setTimeout(r, 150));
    }
  }
  try { return await fn(); } finally { release(); }
}

export function createSendPath(ctx) {
  const { work, runsDir, env = process.env, loadChain, spawnRun, nextRunId, usdLimit = null, masks, maskAt, ownRuns } = ctx;
  const ttlMs = ctx.ttlMs ?? QUOTE_TTL_MS;
  const quotes = new Map();
  let queue = Promise.resolve();
  const serial = fn => { const r = queue.then(fn, fn); queue = r.then(() => {}, () => {}); return r; };
  const readJson = p => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
  // The session's last tool-started advice run (the one `previous_run` names).
  const latestToolRun = ledger => [...ledger].filter(e => !e.unreadable && e.origin === 'tool').sort((a, b) => b.ts - a.ts)[0] ?? null;
  // 0.8.1 DR-8: a call that follows, in the same session, an answer that listed what is missing from the brief tells the person so in
  // its approval text: the text may answer a model's request, and the person decides whether that material should go out.
  const followUpOf = (ledger, limits, now) => {
    const prev = latestToolRun(ledger);
    if (!prev || now - prev.ts >= limits.sessionMs || !moreMaterialRequested(join(runsDir, prev.run))) return null;
    return `This call follows an advisor's request for more material (run ${prev.run}). The text below is the agent's answer to it: check that it holds only what you want sent.`;
  };
  const sameDispositions = (a, b) => JSON.stringify((a || []).map(d => [d.id, d.decision, String(d.reason).trim()])) === JSON.stringify((b || []).map(d => [d.id, d.decision, String(d.reason).trim()]));

  // The original text behind a placeholder is kept in memory only as long as a session is: six hours, then the answer stays masked.
  const pruneMasks = now => { for (const [id, t] of maskAt) if (now - t > 6 * 3600_000) { masks.delete(id); maskAt.delete(id); } };
  const prune = now => { pruneMasks(now); for (const [id, q] of quotes) if (q.expires_ms <= now || q.used) quotes.delete(id); while (quotes.size > MAX_LIVE_QUOTES) quotes.delete(quotes.keys().next().value); };

  function runQuote(kind, { brief, mode, advisor, max_usd }) {
    const now = Date.now();
    prune(now);
    const passed = preSendRefusals(kind, { brief, mode, advisor, max_usd }, { work, runsDir, env, loadChain, usdLimit, now });
    if (passed.refusal) return passed;
    const { limits, sens, chainName, config, masked, price, fp, ledgerNow } = passed;
    const q = {
      kind,
      quote_id: `q_${randomBytes(12).toString('hex')}`, created_ms: now, expires_ms: now + ttlMs,
      mode, chain: chainName, advisor: mode === 'single' ? (advisor || DEFAULT_SEAT) : null,
      sha256: sha256Hex(masked.text), bytes: Buffer.byteLength(masked.text), text: masked.text, mapping: masked.mapping, masked: masked.counts,
      fingerprint: fp, sensitivity: sens,
      // What the fingerprint is made of, kept so council_advise can recompute it with the salt it creates (P15).
      fpBrief: { question: brief.question, options_considered: (brief.options_considered || []).map(o => ({ name: o.name })) },
      seats: previewSeats(config),
      price: { worst_usd: price.worst, expected_usd: price.expected, floor_usd: price.floor, ceiling_usd: price.ceiling },
      max_usd: max_usd ?? null, hasNewEvidence: !!brief.new_evidence, used: false,
      follow_up: followUpOf(ledgerNow, limits, now),
    };
    quotes.set(q.quote_id, q);
    const open = openObjections(ledgerNow, { now, limits });
    const out = {
      kind: 'send_preview', quote_id: q.quote_id, expires_at: new Date(q.expires_ms).toISOString(), mode, advisor: q.advisor, chain: chainName,
      seats: q.seats,
      text: { bytes: q.bytes, chars: masked.text.length, sha256: q.sha256, masked: masked.counts },
      sensitivity: { label: sens.label, effective: sens.effective, floor: sens.floor, raised: sens.raised, operator_floor: sens.operator_floor, operator_source: sens.operator_source, project_floor: sens.project_floor },
      // M5 Work 1 (decided rule 5a): the text itself is not returned to the agent; the person reads all of it before approving.
      approval: 'The user reads the whole masked text, with the seats, the price and the sensitivity, in the approval step (the client\'s dialog, or council gate answer at a terminal) and approves or declines it there. Nothing is sent before that.',
      price: { worst_usd: q.price.worst_usd, expected_usd: q.price.expected_usd, ceiling_usd: q.price.ceiling_usd, calls_at_most: price.calls },
      retention_table_as_of: retentionAsOf(),
      ...(q.follow_up ? { follow_up: q.follow_up } : {}),
      ...(open.length ? { open_objections: open } : {}),
      next: `council_advise(quote_id: "${q.quote_id}", confirm_sha256: "${q.sha256}"${open.length ? `, dispositions: [one {id, decision accept|reject|defer, reason} for each of ${open.join(', ')}]` : ''}). The user will be asked to approve the send.`,
    };
    return { quote: q, out };
  }

  // The answer to a send, settled or not, in the shape the handler turns into a tool result.
  const awaiting = (q, why) => ({ awaiting: { run: q.gate.run, gate: q.gate.id, expires_at: new Date(q.expires_ms).toISOString(), why,
    terminal: gateAnswerCommand(join(runsDir, q.gate.run), q.gate.id), quote_id: q.quote_id } });

  // Section one of a send: the caller's dispositions, the salt, the guards, admission and policy, then the run folder with the exact
  // text, the meta file and the gate (plan DR-15). Under the process lock, released before anyone is asked: a person's wait never holds
  // it. Nothing here starts or spends; a folder whose gate is never approved is ignored by the money guards (it has no advise-log.json).
  async function prepare(kind, q, dispositions, io) {
    const profile = profileFor(kind);
    const limits = profile.limits(env);
    const refuse = (code, reason, next, extra = {}, recorded = false) => ({ refusal: { code, reason, next, extra }, recorded });
    return withProcessLock(work, async () => {
      if (q.used) return refuse('quote_used', 'that quote was already used to start a call.', 'Ask for a new quote with council_quote if the user wants another call.');
      if (q.gate) return { prepared: true, recorded: false }; // a second call with the same quote while the first was being prepared
      if (q.expires_ms <= Date.now()) return refuse('quote_expired', 'the quote has expired (a quote lives ten minutes).', 'Ask for a new quote with council_quote.');
      let recorded = false;
      const R = (code, reason, next, extra) => refuse(code, reason, next, extra, recorded);
      // The caller's accept, reject or defer for the previous call's objections, recorded first: the guards below read them.
      const ledger0 = readLedger(runsDir);
      if (dispositions?.length) {
        const byRun = new Map();
        for (const d of dispositions) { const run = String(d.id).split('#')[0]; (byRun.get(run) || byRun.set(run, []).get(run)).push(d); }
        for (const [run, ds] of byRun) {
          const entry = ledger0.find(e => e.run === run && !e.unreadable);
          if (!entry) return R('disposition_unknown', `no advice run ${run}, so its objections cannot be recorded.`, 'Use the dissent ids from the previous answer.');
          const unknown = ds.filter(d => !(entry.dissent_ids || []).includes(d.id));
          if (unknown.length) return R('disposition_unknown', `not objections of run ${run}: ${unknown.map(d => d.id).join(', ')}.`, `The ids are: ${(entry.dissent_ids || []).join(', ') || '(none)'}.`);
          const merged = [...(entry.dispositions || []).filter(x => !ds.some(d => d.id === x.id)), ...ds.map(d => ({ id: d.id, decision: d.decision, reason: d.reason.trim() }))];
          const check = checkDispositions(entry.dissent_ids || [], merged);
          if (check.invalid.length || check.boilerplate) return R('disposition_invalid', `${check.invalid.length ? `reasons too short or decisions not accept, reject or defer for ${check.invalid.join(', ')}` : 'the same reason was given for three or more objections'}.`, `Give each objection its own reason of at least ${DISPOSITION_MIN_REASON_CHARS} characters.`);
          const p = join(runsDir, run, ADVISE_LOG_FILE);
          const log = readJson(p);
          if (!log) return R('ledger_unreadable', `the record of run ${run} cannot be read.`, 'Ask the user to repair it.');
          writeFileSync(`${p}.tmp`, `${JSON.stringify({ ...log, dispositions: merged, dispositions_complete: check.complete }, null, 2)}\n`);
          renameSync(`${p}.tmp`, p);
          recorded = true;
        }
      }
      const ledger = readLedger(runsDir);
      // The salt is created here, by the first council_advise, never by council_quote (P15). The fingerprint is recomputed with it.
      const salt = installSalt();
      if (salt === null) return R('salt_unavailable', 'the per-install salt (~/.the-high-council-advice-salt) cannot be read or created, so this call cannot be recorded without a readable hash of the question.', 'Ask the user to check that file (it holds one line of 32 hex characters) or remove it so a new one is made.');
      const fingerprint = profile.fingerprint(q.fpBrief, salt);
      const checked = checkBeforeStart(kind, q, fingerprint, ledger, limits, R);
      if (checked) return checked;
      // The seats the gate binds are the chain's as it stands now; they must be the ones the quote showed the person.
      const seats = gateSeatsOf(loadChain(q.chain));
      if (JSON.stringify(seats) !== JSON.stringify(q.seats.map(s => ({ lab: s.lab, model: s.model, retention: s.retention })))) {
        return R('seat_not_allowed', 'the chain behind this quote changed after the quote was made.', 'Ask for a new quote.');
      }
      // The run folder, the exact text (q.text as is: the gate hashes these bytes, the quote showed their hash), the meta file, the gate.
      // Created exclusively: a folder another process made in the same millisecond is never shared (run ids are unique per process only).
      mkdirSync(runsDir, { recursive: true });
      let id, dir;
      for (let i = 0; ; i++) {
        id = nextRunId(); dir = join(runsDir, id);
        try { mkdirSync(dir); break; } catch (e) { if (e.code !== 'EEXIST' || i >= 5) throw e; await new Promise(r => setTimeout(r, 2)); }
      }
      writeFileSync(join(dir, ADVICE_BRIEF_FILE), q.text);
      const previous = latestToolRun(ledger);
      // Recomputed here: what the person is asked about is the session as it stands when the folder is made.
      q.follow_up = followUpOf(ledger, limits, Date.now());
      const meta = {
        schema: ADVICE_META_SCHEMA, quote_id: q.quote_id, chain: q.chain, gate: 'g1', brief_sha256: q.sha256, mode: q.mode, advisor: q.advisor,
        effective_sensitivity: q.sensitivity.effective, question_hash: fingerprint.hash, question_words: fingerprint.words, has_new_evidence: q.hasNewEvidence,
        quoted: { worst_usd: q.price.worst_usd, expected_usd: q.price.expected_usd, ceiling_usd: q.price.ceiling_usd },
        previous_run: previous?.run ?? null,
        dispositions: (dispositions || []).map(d => ({ id: d.id, decision: d.decision, reason: d.reason.trim() })),
        // P7: the client as it named itself at initialize; a label for the log, never an authority.
        // Cut to the 200 characters readAdviceMeta accepts (M5 review D4: a longer name failed every adopt after approval).
        client: { name: io.clientName == null ? null : String(io.clientName).slice(0, 200), version: io.clientVersion == null ? null : String(io.clientVersion).slice(0, 200) },
      };
      writeFileSync(join(dir, `${ADVICE_META_FILE}.tmp`), `${JSON.stringify(meta, null, 2)}\n`);
      renameSync(join(dir, `${ADVICE_META_FILE}.tmp`), join(dir, ADVICE_META_FILE));
      const g = requestGate(dir, {
        kind, textPath: ADVICE_BRIEF_FILE,
        price: { ceiling_usd: q.price.ceiling_usd, expected_usd: q.price.expected_usd },
        seats,
        // Who set each part, in the words the person reads (decided rule 5d); bound to the ledger with the rest (meta_sha256).
        sensitivity: { label: q.sensitivity.effective, set_by: sensitivityWords(q.sensitivity) },
        masks: Object.fromEntries(Object.entries(q.masked).map(([k, n]) => [k.toLowerCase(), n])),
        ...(q.follow_up ? { follow_up: q.follow_up } : {}),
        expiresAt: q.expires_ms,
      });
      if (!g.ok) return R('gate_failed', `the approval record could not be written (${g.code}: ${g.message}).`, 'Ask the user to look at the run folder; nothing was sent.', { run: id });
      if (g.gate.id !== meta.gate || g.gate.sha256 !== q.sha256) return R('gate_failed', 'the approval record does not match the quote.', 'Ask for a new quote.', { run: id });
      q.gate = { run: id, id: g.gate.id };
      q.dispositionsSent = dispositions || [];
      return { prepared: true, recorded };
    }, lockWaitFor(io));
  }

  // A lock wait never outlasts the call's hold (DR-6; P14: the critical section never waits longer than the hold).
  const lockWaitFor = io => Math.max(0, (io.budgetEnd ?? Date.now() + 30_000) - Date.now());

  // The guards, admission and policy, checked before the folder is made and again just before the start: another call may have started
  // while the person was reading. Returns a refusal or null.
  function checkBeforeStart(kind, q, fingerprint, ledger, limits, R) {
    const verdict = decide({ fingerprint, hasNewEvidence: q.hasNewEvidence, worstUsd: q.price.worst_usd, ceilingUsd: q.price.ceiling_usd, ledger, now: Date.now(), limits });
    if (!verdict.allow) return R(verdict.code, verdict.message.replace(/ Nothing was spent\.$/, ''), verdict.next, { ...(verdict.run ? { run: verdict.run } : {}), ...(verdict.ids ? { ids: verdict.ids } : {}) });
    const config = loadChain(q.chain);
    const gap = admitChain(q.chain, config);
    if (gap) return R('seat_not_allowed', `${gap}.`, 'Ask for a new quote.');
    const { policy } = loadPolicy(work);
    if (policy) {
      const ev = evaluatePolicy(policy, { config, allSeats: seatsOf(config), worstCaseUsd: q.price.ceiling_usd, monthToDateUsd: monthToDateUsd(runsDir, Date.now()) });
      if (!ev.ok) return R('policy', `policy.json refuses this call: ${ev.reasons.join(' ')}`, 'Ask the user; the policy is theirs.');
    }
    return null;
  }

  // Ask the person, through the client, until the approval deadline. The answer is written by answerGate (channel elicitation),
  // bound to the hash of the exact text the dialog showed. Returns 'approved' | 'declined' | 'timeout' | 'cancelled' | { error }.
  // One dialog per quote at a time: a second call with the same quote waits for the open dialog instead of opening another.
  function askPerson(q, io) {
    if (!q.asking) q.asking = askOnce(q, io).finally(() => { q.asking = null; });
    return q.asking;
  }
  async function askOnce(q, io) {
    const leftMs = io.approvalDeadline - Date.now();
    if (leftMs <= 0) return 'timeout';
    let res;
    try {
      res = await io.elicit(
        dialogMessage(q),
        { type: 'object', properties: { send: { type: 'boolean', title: `Send this text and spend up to ${money(q.price.ceiling_usd)}?`, description: `Expected about ${money(q.price.expected_usd)}. sha256 ${q.sha256.slice(0, 16)}...`, default: false } }, required: ['send'] },
        leftMs,
      );
    } catch (e) {
      // The client cancelled the call while the dialog was open: nothing is answered, the gate stays pending.
      if (io.signal?.aborted || e?.name === 'AbortError') return 'cancelled';
      // The SDK's request timeout is MCP error -32001; anything else is the client failing to ask.
      if (e?.code === -32001 || /timed? ?out/i.test(String(e?.message))) return 'timeout';
      return { error: String(e?.message ?? e).slice(0, 120) };
    }
    const decision = res.action === 'accept' && res.content?.send === true ? 'approved' : 'declined';
    // A dialog the person dismissed (cancel) is not a decline they wrote: the gate stays pending and the terminal can still answer.
    if (res.action === 'cancel') return 'timeout';
    const a = answerGate(join(runsDir, q.gate.run), q.gate.id, { channel: 'elicitation', shownSha256: q.sha256, decision, actor: io.clientName ?? null, tty: null });
    if (!a.ok) {
      if (a.code === 'gate_not_pending') return readGateAnswer(join(runsDir, q.gate.run), q.gate.id).status; // the terminal answered first
      if (a.code === 'gate_expired') return 'expired';
      return { error: `${a.code}: ${a.message}` };
    }
    return decision;
  }

  /**
   * One council_advise call. io: { elicit(message, schema, timeoutMs), canElicit(), signal, approvalDeadline (ms), clientName }.
   * The person approves the exact text through the client's dialog or at the terminal; the run starts only on an approved gate,
   * through `council --advice-adopt runs/<id>`. A call that ends before anyone answered returns `awaiting`; the same quote sent
   * again picks the same gate up (idempotent) and asks again.
   */
  async function runSend(kind, { quote_id, confirm_sha256, dispositions }, io) {
    const profile = profileFor(kind);
    const now = Date.now();
    const q = quotes.get(quote_id);
    prune(now - 10 * 60_000); // an expired quote is kept a while longer, so the refusal can say it expired
    const refuse = (code, reason, next, extra = {}, recorded = false) => ({ refusal: { code, reason, next, extra }, recorded });
    if (!q || q.kind !== kind) return refuse('quote_missing', 'there is no live quote with that id (it was already used, or the server restarted).', 'Ask for a new quote with council_quote.');
    if (q.used) return refuse('quote_used', 'that quote was already used to start a call.', 'Ask for a new quote with council_quote if the user wants another call.');
    if (confirm_sha256 !== q.sha256) return refuse('hash_mismatch', 'confirm_sha256 is not the hash of the text this quote previewed, so the text the user approved is not the text that would be sent.', 'Pass the sha256 that council_quote returned, or ask for a new quote.');
    if (!q.gate && q.expires_ms <= now) return refuse('quote_expired', 'the quote has expired (a quote lives ten minutes).', 'Ask for a new quote with council_quote.');
    let recorded = false;
    // M4 review follow-up: dispositions are recorded when a quote's call is first prepared. The same ones sent again (an agent repeating
    // its call while the person reads) are fine; different ones would be dropped without a word, so they are refused instead.
    if (q.gate && dispositions?.length && !sameDispositions(dispositions, q.dispositionsSent)) {
      return refuse('dispositions_too_late', `this quote's call was already prepared (run ${q.gate.run}, waiting for approval) with the dispositions sent first; these were not recorded.`, 'Send the same quote with the dispositions you sent first (or none) to continue, or ask for a new quote to send these with it.', { run: q.gate.run });
    }
    if (!q.gate) {
      const p = await serial(() => prepare(kind, q, dispositions, io));
      if (p.busy || p.refusal) return p;
      recorded = p.recorded;
    }
    const R = (code, reason, next, extra) => refuse(code, reason, next, extra, recorded);
    // Where the gate stands; ask the person if nobody has answered yet.
    const dir = join(runsDir, q.gate.run);
    let st = readGateAnswer(dir, q.gate.id);
    if (st.status === 'pending') {
      if (!io.canElicit()) return awaiting(q, 'this client cannot show the person the text and ask (no MCP elicitation)');
      const asked = await askPerson(q, io);
      // One dialog serves every caller with this quote; it is a cancel only for the caller whose own client cancelled.
      if (io.signal?.aborted) return R('cancelled', 'the client cancelled this call while the person was being asked; nothing was approved or started.', 'Nothing more to do; ask again only if the user still wants it.', { run: q.gate.run });
      if (asked?.error) return R('no_approval_channel', `the client did not answer the approval request (${asked.error}).`, `The person can approve at a terminal: ${gateAnswerCommand(join(runsDir, q.gate.run), q.gate.id)}; then send the same quote again.`, { run: q.gate.run, gate: q.gate.id });
      if (asked === 'timeout' || asked === 'cancelled') return awaiting(q, 'the person has not answered yet');
      if (asked === 'expired') return R('quote_expired', 'the quote and its approval request expired while the person was being asked.', 'Ask for a new quote with council_quote.', { run: q.gate.run });
      st = readGateAnswer(dir, q.gate.id);
    }
    if (st.status === 'declined') { q.used = true; return R('declined', 'the user declined.', 'Decide with what you have and say you did not consult.', { run: q.gate.run }); }
    if (st.status === 'expired') return R('quote_expired', 'the quote and its approval request have expired (a quote lives ten minutes).', 'Ask for a new quote with council_quote.', { run: q.gate.run });
    if (st.status !== 'approved') return R('approval_invalid', `the approval record of run ${q.gate.run} cannot be trusted (${st.reason ?? st.status}).`, 'Ask the user to look at it: council gate show runs/' + q.gate.run);
    if (!st.usable) return R(st.used ? 'quote_used' : 'quote_expired', st.used ? 'that approval was already used to start a call.' : 'the approval lapsed with its quote.', 'Ask for a new quote with council_quote.', { run: q.gate.run });
    if (q.used) return R('quote_used', 'that quote was already used to start a call.', 'Ask for a new quote with council_quote if the user wants another call.', { run: q.gate.run });
    if (io.signal?.aborted) return R('cancelled', 'the client cancelled this call before the run started.', 'Nothing more to do; ask again only if the user still wants it.', { run: q.gate.run });
    // Section two: the guards once more, then the start, under the process lock. The run records its send (`sent`) and its
    // advise-log.json before any call, so the next call's guards count it.
    return serial(() => withProcessLock(work, async () => {
      // A quote is used up when its run starts (plan M4 Work 3): of two calls with one approved quote, the first to get here starts
      // it. Set here, not at approval, so an approved gate whose start fails or is refused can be started by sending the quote again.
      if (q.used) return R('quote_used', 'that quote was already used to start a call.', 'Ask for a new quote with council_quote if the user wants another call.', { run: q.gate.run });
      const salt = installSalt();
      if (salt === null) return R('salt_unavailable', 'the per-install salt (~/.the-high-council-advice-salt) cannot be read or created.', 'Ask the user to check that file.');
      const checked = checkBeforeStart(kind, q, profile.fingerprint(q.fpBrief, salt), readLedger(runsDir), profile.limits(env), R);
      if (checked) return checked;
      const id = q.gate.run;
      q.used = true;
      const res = await spawnRun(id, ['--advice-adopt', join('runs', id), '--allow-unfenced']);
      if (!res.started) { q.used = false; return { startFailed: res }; }
      ownRuns.add(id);
      masks.set(id, q.mapping); maskAt.set(id, Date.now());
      quotes.delete(q.quote_id);
      return { startedRun: id };
    }, lockWaitFor(io)));
  }

  return { runQuote, runSend, quotes };
}
