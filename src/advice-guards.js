// The guards an advice call runs BEFORE anything is paid for (thc-research brief 28 section 3, built for brief 29).
// Pure functions over a ledger that is DERIVED from the run folders, never recorded elsewhere (the product's
// own rule, CLAUDE.md "Cross-run spend": a separate ledger is a second copy of the truth that can drift).
//
// What these guards are, and are not. They bind the ADVICE tools (`council_quote`, `council_advise`) and
// `start_run`/`resume_run` for advice chains, which refuse them. They do not bind anything else that spends:
// `start_run` on another chain, `submit_stage`, or an agent with a shell that runs `council` itself. The ledger
// is under the working directory, the same tree a coding agent can write to, so a hostile agent can edit it;
// a same-user process cannot be kept from that by any file. What they stop is the failure that has been
// observed: a well-meaning model, or a fleet of subagents, calling a paid advisor again and again (brief 28
// section 1.5, issue 94656: 292 of 434 calls came from subagents). A damaged entry refuses the call: an
// unreadable entry may be a call that was paid for, and ignoring it would let the cap pass.
//
// Every threshold is a named constant with its derivation, and every one is UNTUNED: a starting value, not a
// measurement. The operator changes them with environment variables (server settings), never a tool argument.
import { createHash, randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { readdirSync, readFileSync, writeFileSync, existsSync, linkSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_FOLDER } from './run-status.js';
import { NEW_EVIDENCE_MIN_CHARS } from './advice-brief.js';
import { mask } from './advice-mask.js';

export const ADVISE_LOG_FILE = 'advise-log.json';
export const DISPOSITION_DECISIONS = ['accept', 'reject', 'defer'];
// 15 characters: long enough that "no", "not relevant" and "fine" do not pass, short enough for a real one-line reason (28's prototype; untuned).
export const DISPOSITION_MIN_REASON_CHARS = 15;
// One reason pasted onto this many objections or more counts as one reason given once (28: three; untuned).
export const BOILERPLATE_MIN_OBJECTIONS = 3;

const HOUR = 3600_000;
export const ADVICE_DEFAULTS = Object.freeze({
  // A session is a sliding window read from disk, so a restart does not reset it. 6 hours is one working sitting.
  sessionMs: 6 * HOUR,
  dayMs: 24 * HOUR,
  // Anthropic's own suggested pace for its advisor is two to three calls per task (advisor-tool docs, 2026-09-30).
  sessionCalls: 3,
  dayCalls: 8,
  // Dollars are counted at the call's CEILING (the most it can spend: worst case plus one retry of the costliest seat) until the run has
  // recorded what it spent. Derivation of the defaults, from results/29's price table at the 12,000-character brief cap: ceilings are $0.30
  // for the default single seat, $0.50 for the council and $1.50 for the dearest swap (Astra). Since 0.8.1 the council's ceiling is $1.40
  // (its roster is Sol, GLM-5.3, Gemini 3.8 Flash, Sol and Gemini at 12,000 output tokens, GLM-5.3 at 54,000; worst $1.2253 at the 48,000-character brief cap and $1.382 at a 30,000-token brief (the envelope test/advise.test.js holds every ceiling to), with GLM-5.3's
  // output priced at the live list's $7.0/M since the 2026-10-06 audit; the ceiling was $1.20 before: it covers the worst case at the 30,000-token brief, rounded up) and the
  // brief cap is 48,000 characters (src/advice-brief.js). Since 0.8.1 milestone R the default single seat has a 36,000-token reply cap and a $1.32 ceiling
  // (chains/advise-single.json derives it); the $0.30 above is the 12,000-token ceiling it replaced. $1.32 covers the first call and one retry of a cut-off
  // reply at the 64,000-token retry cap (a retry is reserved at its worst case on top of what the first call cost), so a cut-off answer is retried, not dropped. A session of $3 holds two council calls in flight at their ceilings; a finished
  // call counts what it really spent (expected about $0.6), so three council calls one after another fit (sessionCalls is 3). A day of
  // $10 holds about seven at their ceilings. advise-premium ($6.50 since the 2026-10-06 price refresh: its worst case at a 30,000-token brief is $6.20) is above all three limits on purpose: an operator raises them to use it.
  // The limit for ONE call, compared with its ceiling (not its worst case): a cut-off reply is retried at twice its cap, which the ceiling allows.
  perCallUsd: 1.5,
  sessionUsd: 3,
  dayUsd: 10,
  // Slows a loop without stopping a person who reads the answer first: the last call's START to this call's.
  cooldownMs: 120_000,
  // A question asked again inside this window is a repeat (a day: a repeat the next hour is still a repeat).
  duplicateMs: 24 * HOUR,
  // Jaccard overlap of the hashed content words of the question and option names. 28's prototype: 0.6; its test
  // rewording scored 0.69 (thin margin) and opposite questions scored as duplicates. The escape is new_evidence.
  duplicateSimilarity: 0.6,
  newEvidenceMinChars: NEW_EVIDENCE_MIN_CHARS,
});

/** The limits in force: the defaults, then the operator's environment. A caller argument can only lower a limit. */
export function limitsFromEnv(env = process.env) {
  const num = (name, dflt, { int = false, min = 0 } = {}) => {
    const v = Number(env[name]);
    return env[name] !== undefined && env[name] !== '' && Number.isFinite(v) && v >= min ? (int ? Math.floor(v) : v) : dflt;
  };
  const d = ADVICE_DEFAULTS;
  return {
    ...d,
    perCallUsd: num('COUNCIL_ADVISE_MAX_USD_PER_CALL', d.perCallUsd),
    sessionUsd: num('COUNCIL_ADVISE_MAX_USD_PER_SESSION', d.sessionUsd),
    dayUsd: num('COUNCIL_ADVISE_MAX_USD_PER_DAY', d.dayUsd),
    sessionCalls: num('COUNCIL_ADVISE_CALLS_PER_SESSION', d.sessionCalls, { int: true }),
    dayCalls: num('COUNCIL_ADVISE_CALLS_PER_DAY', d.dayCalls, { int: true }),
    cooldownMs: num('COUNCIL_ADVISE_COOLDOWN_MS', d.cooldownMs, { int: true }),
    // No allowance: patch 29's operator allowance let an operator waive approval for cheap public or internal calls. 0.8.1 removes
    // it (plan DR-3, decided rule 5a): every advice call is sent only after a person has seen the exact text.
  };
}

// ---- the question's identity ----------------------------------------------------------------------------------

const STOP = new Set(('a an and are as at be by can do does for from how i if in is it its of on or our should so that the '
  + 'their then there this to us was we what when which who will with would you your not no').split(' '));

/** Volatile tokens (timestamps, run ids, hashes, line numbers) must not make a repeated question look new. */
export function normalize(text) {
  return String(text ?? '').toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.\-z]+/g, ' ')
    .replace(/\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,64}\b/g, ' ') // hashes and ids only: a digit AND a letter a-f, so 1000000 survives
    .replace(/:\d+(?::\d+)?\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// A per-install salt, kept outside the run folders (home directory), so the hashed words in advise-log.json cannot be reversed with a
// dictionary by someone who has only the run folders. An agent that can read the home directory can still read the salt.
// 0.8.1 P15: council_quote is read-only (its annotation says so), so it only READS the salt (readSalt); the file is created by the
// first council_advise (installSalt). A salt that exists but cannot be read, or cannot be created, makes council_advise refuse
// (salt_unavailable) instead of writing an unsalted hash, which the guards would later compare against salted ones.
const saltPath = () => join(homedir(), '.the-high-council-advice-salt');
const SALT_RE = /^[0-9a-f]{32}$/;
let saltCache = null;
/** The salt if the file exists and holds one; null if there is no file yet. Throws when the file exists but cannot be read or is not a salt. Never writes. */
export function readSalt() {
  if (saltCache !== null) return saltCache;
  let raw;
  try { raw = readFileSync(saltPath(), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const s = raw.trim();
  if (!SALT_RE.test(s)) throw new Error(`${saltPath()} does not hold a salt`);
  return (saltCache = s);
}
/** council_advise only: the salt, created on first use (temp file, then an exclusive link, so two servers cannot both create one). null when it cannot be read or created. */
export function installSalt() {
  try { const s = readSalt(); if (s !== null) return s; } catch { return null; }
  const tmp = `${saltPath()}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, randomBytes(16).toString('hex'), { mode: 0o600 });
    try { linkSync(tmp, saltPath()); } catch (e) { if (e.code !== 'EEXIST') throw e; /* another process created it first: use theirs */ }
  } catch { return null; } finally { try { unlinkSync(tmp); } catch { /* never created */ } }
  try { return readSalt(); } catch { return null; }
}
export const resetSaltCache = () => { saltCache = null; };
// For the quote's guard check only: an unreadable salt reads as none here (the quote's fingerprint is then compared against nothing that
// could match) because council_advise refuses that state itself (salt_unavailable) before anything is sent.
const readSaltOrEmpty = () => { try { return readSalt() ?? ''; } catch { return ''; } };

/**
 * What identifies a question without keeping its text: the hash of the normalised question and option names, and the SET of hashed content
 * words (so two wordings can be compared). The words are taken AFTER masking (an email's local part is never hashed) and salted. `tried` and
 * `new_evidence` change legitimately between two honest asks, so they are not part of it. Hashed words are not text, but a salted hash of a
 * short vocabulary is weak protection against someone who holds the salt: advise-log.json holds no brief text, and says no more.
 */
// The default salt is read, never created (P15): a quote computes its fingerprint before any salt exists; council_advise recomputes it
// with the salt it creates. With no salt yet there are no salted ledger entries to compare against.
export function fingerprintOf(brief, salt = readSaltOrEmpty()) {
  const opts = (brief.options_considered || []).map(o => o.name).sort();
  let raw = [brief.question, ...opts].join(' | ');
  try { raw = mask(raw).text; } catch { /* a placeholder-shaped token: hash it as written */ }
  const text = normalize(raw);
  const h = w => createHash('sha256').update(`${salt}:${w}`).digest('hex').slice(0, 8);
  const words = [...new Set(text.split(/[\s|]+/).filter(w => w && !STOP.has(w)))].map(h).sort();
  return { hash: createHash('sha256').update(`${salt}:${text}`).digest('hex').slice(0, 16), words };
}
export function similarity(a, b) {
  const A = new Set(a || []), B = new Set(b || []);
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

// ---- the ledger -----------------------------------------------------------------------------------------------

/**
 * Every advice run in `runsDir`, oldest first: { run, ts, ...advise-log.json }. A folder of an advice chain with an
 * unreadable or missing log is kept as { unreadable: true, run }: decide() fails closed on it.
 */
export function readLedger(runsDir, { now = Date.now(), windowMs = ADVICE_DEFAULTS.dayMs } = {}) {
  if (!existsSync(runsDir)) return [];
  const out = [];
  // A damaged record fails closed, but only inside the window the limits look at: run ids are timestamps, so a folder older than that
  // cannot change any limit and must not block every call for ever.
  const damaged = id => {
    const t = Date.parse(id.slice(0, 10) + 'T' + id.slice(11, 19).replace(/-/g, ':') + 'Z');
    return Number.isFinite(t) && now - t > windowMs ? null : { unreadable: true, run: id };
  };
  for (const d of readdirSync(runsDir)) {
    if (!RUN_FOLDER.test(d)) continue;
    const dir = join(runsDir, d);
    const p = join(dir, ADVISE_LOG_FILE);
    if (existsSync(p)) {
      try {
        const e = JSON.parse(readFileSync(p, 'utf8'));
        if (!e || typeof e !== 'object' || !Number.isFinite(e.ts) || typeof e.quoted?.ceiling_usd !== 'number') throw new Error('not an advise-log');
        out.push({ ...e, run: d });
      } catch { { const x = damaged(d); if (x) out.push(x); } }
    } else {
      // A run folder of an advice chain whose log is gone is a damaged record, not an absent one.
      try {
        const meta = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
        if (typeof meta.chain === 'string' && /^(mock-)?advise-/.test(meta.chain)) { const x = damaged(d); if (x) out.push(x); }
      } catch { /* not an advice run */ }
    }
  }
  return out.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0) || (a.run < b.run ? -1 : 1));
}

/** Dollars a ledger entry counts for: what it spent once the run recorded that, else the most it can still spend. */
export const committedUsd = e => (Number.isFinite(e.spent_usd) ? e.spent_usd : e.quoted?.ceiling_usd ?? 0);

/** Objection ids of one answered advice run, from the answer's dissent: `<run>#<lab>`. Empty for a unanimous run. */
export const objectionIds = (run, advise) => (advise?.dissent || []).map(d => `${run}#${d.lab}`);

/** { complete, missing, invalid, boilerplate } for one entry's objection ids against its recorded dispositions. */
export function checkDispositions(ids, dispositions = []) {
  const by = new Map((dispositions || []).map(d => [d.id, d]));
  const missing = [], invalid = [];
  for (const id of ids) {
    const d = by.get(id);
    if (!d) { missing.push(id); continue; }
    if (!DISPOSITION_DECISIONS.includes(d.decision) || String(d.reason ?? '').trim().length < DISPOSITION_MIN_REASON_CHARS) invalid.push(id);
  }
  // One reason pasted onto three or more objections is silence with extra steps.
  const reasons = ids.map(id => by.get(id)?.reason).filter(Boolean);
  const boilerplate = ids.length >= BOILERPLATE_MIN_OBJECTIONS && new Set(reasons.map(r => normalize(r))).size === 1;
  return { complete: !missing.length && !invalid.length && !boilerplate, missing, invalid, boilerplate };
}

// ---- the decision ---------------------------------------------------------------------------------------------

const money = n => `$${(Math.round(n * 1e4) / 1e4).toFixed(n >= 1 ? 2 : 4)}`;

/**
 * decide({ fingerprint, hasNewEvidence, worstUsd, ceilingUsd, ledger, now, limits }) -> { allow: true } or
 * { allow: false, code, message, next, run? }. Every refusal says nothing was spent, what to do next, and never
 * invites a retry of the same call. Order: the cheapest and most informative checks first. A quote passes
 * skipDispositions: the caller records its dispositions WITH council_advise, so the quote may not refuse what only that call can fix.
 */
export function decide({ fingerprint, hasNewEvidence = false, skipDispositions = false, worstUsd, ceilingUsd, ledger, now = Date.now(), limits = limitsFromEnv() }) {
  const L = limits;
  const no = (code, message, next, extra = {}) => ({ allow: false, code, message: `${message} Nothing was spent.`, next, ...extra });
  if (!Number.isFinite(worstUsd) || worstUsd < 0 || !Number.isFinite(ceilingUsd) || ceilingUsd <= 0) {
    return no('unpriced', 'This call has no worst-case price, so it is refused: a call that cannot be priced cannot be capped.', 'Use a seat with a price in pricing.json (council_quote lists them).');
  }
  const bad = ledger.find(e => e.unreadable || !Number.isFinite(e.ts));
  if (bad) {
    return no('ledger_unreadable', `The record of an earlier advice call (run ${bad.run ?? 'unknown'}) is damaged, so the caps cannot be checked.`, 'Ask the user to repair or delete that run folder\'s advise-log.json, then ask again. Do not retry before that.', { run: bad.run });
  }
  // A run a person started at the terminal is theirs: it is not the tools' calls, so it is not counted against their limits.
  const sorted = ledger.filter(e => e.origin !== 'cli').sort((a, b) => a.ts - b.ts);
  const inSession = sorted.filter(e => now - e.ts < L.sessionMs);
  const inDay = sorted.filter(e => now - e.ts < L.dayMs);
  const last = inSession[inSession.length - 1];
  if (last && L.cooldownMs > 0 && now - last.ts < L.cooldownMs) {
    return no('cooldown', `Another advice call started ${Math.round((now - last.ts) / 1000)} s ago (run ${last.run}).`, `Read that answer first (run ${last.run}); a second call in this window needs a person to decide. Do not retry.`, { run: last.run });
  }
  for (const e of sorted.filter(x => now - x.ts < L.duplicateMs)) {
    const same = e.question_hash === fingerprint.hash;
    const near = !same && similarity(fingerprint.words, e.question_words) >= L.duplicateSimilarity;
    if ((same || near) && !hasNewEvidence) {
      return no('duplicate', `This is ${same ? 'the same question' : 'a close rewording of a question'} already answered in run ${e.run}.`, `Use that answer. To ask again, put in the brief's new_evidence (at least ${L.newEvidenceMinChars} characters): what you found or changed since, not a rephrasing.`, { run: e.run });
    }
  }
  const open = skipDispositions ? null : inSession.find(e => (e.dissent_ids || []).length && !e.dispositions_complete);
  if (open) {
    const left = (open.dissent_ids || []).filter(id => !(open.dispositions || []).some(d => d.id === id));
    return no('dispositions_missing', `Run ${open.run} still has ${(left.length || open.dissent_ids.length)} recorded objection(s) with no accept, reject or defer and a reason.`, `Pass dispositions for ${(left.length ? left : open.dissent_ids).join(', ')} (each: id, decision accept|reject|defer, a reason of at least ${DISPOSITION_MIN_REASON_CHARS} characters) with this call.`, { run: open.run, ids: left.length ? left : open.dissent_ids });
  }
  if (ceilingUsd > L.perCallUsd) return no('cap_call', `This call can spend up to ${money(ceilingUsd)} (worst case ${money(worstUsd)} plus one retry); the limit for one call is ${money(L.perCallUsd)}.`, 'Shorten the brief, ask in single mode, or ask the user to raise COUNCIL_ADVISE_MAX_USD_PER_CALL in the server\'s settings.');
  if (inSession.length >= L.sessionCalls) return no('cap_calls', `This session already made ${inSession.length} of ${L.sessionCalls} advice calls.`, 'Decide with what you have, or ask the user to raise COUNCIL_ADVISE_CALLS_PER_SESSION in the server\'s settings.');
  const sessionUsd = inSession.reduce((n, e) => n + committedUsd(e), 0);
  if (sessionUsd + ceilingUsd > L.sessionUsd) return no('cap_session_usd', `This call could take the session to ${money(sessionUsd + ceilingUsd)} (${money(sessionUsd)} already counted); the session limit is ${money(L.sessionUsd)}.`, 'Decide with what you have, or ask the user to raise COUNCIL_ADVISE_MAX_USD_PER_SESSION.');
  if (inDay.length >= L.dayCalls) return no('cap_day_calls', `Today already has ${inDay.length} of ${L.dayCalls} advice calls.`, 'Decide with what you have, or ask the user to raise COUNCIL_ADVISE_CALLS_PER_DAY.');
  const dayUsd = inDay.reduce((n, e) => n + committedUsd(e), 0);
  if (dayUsd + ceilingUsd > L.dayUsd) return no('cap_day_usd', `This call could take today to ${money(dayUsd + ceilingUsd)} (${money(dayUsd)} already counted); the daily limit is ${money(L.dayUsd)}.`, 'Decide with what you have, or ask the user to raise COUNCIL_ADVISE_MAX_USD_PER_DAY.');
  return { allow: true };
}

/** The objection ids of the session's earlier calls that still have no accept, reject or defer with a reason. */
export function openObjections(ledger, { now = Date.now(), limits = limitsFromEnv() } = {}) {
  return ledger.filter(e => !e.unreadable && e.origin !== 'cli' && now - e.ts < limits.sessionMs && (e.dissent_ids || []).length && !e.dispositions_complete)
    .flatMap(e => e.dissent_ids.filter(id => !(e.dispositions || []).some(d => d.id === id)));
}

