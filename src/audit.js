// 7.x item 5: structured audit export (audit.jsonl).
//
// Contract:
//   createAuditWriter({ runDir, run, chain, user, hmacKey }) -> { recordStage(stage), close() }
//     recordStage(stage): append one signed, hash-chained line for one provider call. `stage` is
//       the same object runChain()'s onStage callback already hands cli.js (label/provider/
//       model/lab/usage/usd) - every field here is DERIVED from that, never separately recorded.
//     close(): append the one final hash-chain line covering every prior line. Idempotent to
//       call at most once per run; a crashed run simply has no close line, which is a real,
//       discoverable, non-corrupt state (see docs/audit-schema.md), not a bug to paper over.
//   verifyAuditLog(lines, { hmacKey } = {}) -> { valid, failedAt, reason }
//     Pure, offline, re-derivable from the file alone (plus the signing key, if checking
//     signatures). Never trusts anything about the file except its own bytes.
//   shouldEnableAudit({ config, policyPath }) -> boolean
//   loadHmacKey({ runDir }) -> string | null
//
// Privacy posture, same as verdict-stats.js/spend.js: seat/lab/counts/cost/timing/user identity
// only - never task content, prompt text, or the deliverable.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { createHash, createHmac } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { userInfo } from 'node:os';

const GENESIS_HASH = '0'.repeat(64);

export function auditFilePath(runDir) {
  return resolve(runDir, 'audit.jsonl');
}

// os.userInfo() throws on some sandboxed/containerized environments with no passwd entry for
// the running uid - a real, observed failure mode, not a hypothetical one. Falls back to the
// env vars a shell would have set, then a literal 'unknown' rather than crashing an otherwise
// successful run over an audit-log identity field.
export function userIdentity() {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER || process.env.USERNAME || 'unknown';
  }
}

function sha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

function hmacHex(key, str) {
  return createHmac('sha256', key).update(str, 'utf8').digest('hex');
}

// The exact fields and order the hash is computed over - a schema change here is a breaking
// change to every previously-written audit.jsonl's verifiability, same discipline as
// report.json's own "adding fields is fine, renaming or removing one is not" contract.
const LINE_FIELDS = ['seq', 'ts', 'run', 'chain', 'user', 'stage', 'provider', 'model', 'lab', 'region', 'tokensIn', 'tokensOut', 'usd', 'prevHash'];

function canonicalLineBody(line) {
  return JSON.stringify(LINE_FIELDS.map(k => (line[k] === undefined ? null : line[k])));
}

// `policy.json`'s presence gate - read-only, and deliberately not the file's parsed contents.
// item 1 (src/policy.js, built separately) owns parsing and enforcement; this only asks "does
// the file exist", the one fact this item actually needs, so the two never duplicate logic that
// could drift out of sync with each other.
export function shouldEnableAudit({ config, policyPath }) {
  if (config?.audit === true) return true;
  return existsSync(policyPath);
}

// A signing key kept inside the run folder it signs gives no real tamper-evidence - anyone who
// can edit the log can edit the key next to it. Checked, not just documented: AUDIT_HMAC_KEY_FILE
// resolving under `runDir` is refused outright rather than silently accepted.
export function loadHmacKey({ runDir } = {}) {
  if (process.env.AUDIT_HMAC_KEY) return process.env.AUDIT_HMAC_KEY;
  const keyFile = process.env.AUDIT_HMAC_KEY_FILE;
  if (!keyFile) return null;
  const resolvedKeyFile = resolve(keyFile);
  const resolvedRunDir = runDir ? resolve(runDir) + sep : null;
  if (resolvedRunDir && resolvedKeyFile.startsWith(resolvedRunDir)) {
    throw new Error(`AUDIT_HMAC_KEY_FILE (${resolvedKeyFile}) resolves inside the run folder it would sign (${runDir}) - keep the signing key outside any run folder.`);
  }
  return readFileSync(resolvedKeyFile, 'utf8').trim();
}

/**
 * Stateful append-only writer for one run's audit.jsonl. Every write goes through
 * appendFileSync with no separate open handle kept around, so nothing here can leave a
 * half-written line on a crash mid-call - each recordStage()/close() call is one atomic append.
 */
export function createAuditWriter({ runDir, run, chain, user = userIdentity(), hmacKey = null }) {
  const path = auditFilePath(runDir);
  let seq = 0;
  let prevHash = GENESIS_HASH;
  let runningChainHash = GENESIS_HASH; // rolls forward over every line's own hash, in order
  let closed = false;

  // Resume: a run paused (ExternalPause) or stopped (BudgetExceeded) never calls close(), so a
  // resumed run's audit.jsonl already has data lines with no closing line - starting a fresh
  // writer at seq 0/genesis here would write a second seq-0 line with a prevHash that doesn't
  // match the file's real last hash, silently forking the chain. Read the file's own tail once,
  // at construction, and continue from there instead - the file is the source of truth, nothing
  // about this run's prior state is trusted from anywhere else.
  if (existsSync(path)) {
    const existing = parseAuditLog(readFileSync(path, 'utf8'));
    const lastClose = existing.at(-1)?.type === 'chain-close';
    if (lastClose) closed = true;
    else if (existing.length) {
      seq = existing.length;
      prevHash = existing.at(-1).hash;
      runningChainHash = existing.reduce((h, l) => sha256Hex(h + l.hash), GENESIS_HASH);
    }
  }

  function recordStage(stage) {
    if (closed) throw new Error('audit writer already closed for this run');
    const line = {
      seq, ts: new Date().toISOString(), run, chain, user,
      stage: stage.label, provider: stage.provider, model: stage.model, lab: stage.lab ?? null,
      region: stage.region ?? null,
      tokensIn: stage.usage?.input ?? 0, tokensOut: stage.usage?.output ?? 0,
      usd: stage.usd ?? 0,
      prevHash,
    };
    const hash = sha256Hex(canonicalLineBody(line));
    line.hash = hash;
    line.signature = hmacKey ? hmacHex(hmacKey, hash) : null;
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    seq += 1;
    prevHash = hash;
    runningChainHash = sha256Hex(runningChainHash + hash);
    return line;
  }

  function close() {
    if (closed) return null;
    closed = true;
    if (seq === 0) return null; // nothing recorded this run - no close line for an empty log
    const closeLine = { type: 'chain-close', lineCount: seq, finalHash: runningChainHash };
    closeLine.signature = hmacKey ? hmacHex(hmacKey, runningChainHash) : null;
    appendFileSync(path, `${JSON.stringify(closeLine)}\n`);
    return closeLine;
  }

  return { recordStage, close, path, get lineCount() { return seq; } };
}

// Structural check only (types/required keys) - a hash/signature mismatch is a verifyAuditLog
// finding, not a schema finding, so the two failure classes stay distinguishable to a caller.
export function validateAuditLine(line) {
  if (line.type === 'chain-close') {
    return typeof line.lineCount === 'number' && typeof line.finalHash === 'string' && ('signature' in line);
  }
  return LINE_FIELDS.every(k => k in line) && typeof line.hash === 'string' && ('signature' in line);
}

/**
 * Re-derives every line's hash and the final chain hash from the file's own bytes and checks
 * them against what's stored - the only way "does this log verify" can be certified, per one
 * byte anywhere breaking the specific line (and, downstream, the final hash) it landed in.
 * `hmacKey` is optional: omitted, only the hash chain is checked (still catches tampering);
 * provided, every signature is checked too.
 */
export function verifyAuditLog(lines, { hmacKey } = {}) {
  let prevHash = GENESIS_HASH;
  let runningChainHash = GENESIS_HASH;
  let dataLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.type === 'chain-close') {
      if (i !== lines.length - 1) return { valid: false, failedAt: i, reason: 'chain-close line is not the last line' };
      if (line.finalHash !== runningChainHash) return { valid: false, failedAt: i, reason: 'final chain hash does not match the recomputed hash over all prior lines' };
      if (line.lineCount !== dataLines) return { valid: false, failedAt: i, reason: `lineCount ${line.lineCount} does not match ${dataLines} data line(s) actually present` };
      if (hmacKey && line.signature !== hmacHex(hmacKey, runningChainHash)) return { valid: false, failedAt: i, reason: 'chain-close signature does not verify against the provided key' };
      continue;
    }
    if (!validateAuditLine(line)) return { valid: false, failedAt: i, reason: 'line does not match the audit-log schema' };
    if (line.prevHash !== prevHash) return { valid: false, failedAt: i, reason: 'prevHash does not match the preceding line\'s hash' };
    const recomputed = sha256Hex(canonicalLineBody(line));
    if (recomputed !== line.hash) return { valid: false, failedAt: i, reason: 'stored hash does not match the line\'s own recomputed hash - the line was altered' };
    if (hmacKey && line.signature !== hmacHex(hmacKey, line.hash)) return { valid: false, failedAt: i, reason: 'signature does not verify against the provided key' };
    prevHash = line.hash;
    runningChainHash = sha256Hex(runningChainHash + line.hash);
    dataLines += 1;
  }
  return { valid: true, failedAt: null, reason: null };
}

export function parseAuditLog(text) {
  return text.split('\n').filter(l => l.trim()).map(l => JSON.parse(l));
}
