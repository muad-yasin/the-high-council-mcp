// 0.7.9 (owner decision via C&C, 2026-09-28): the outbound key scan, on by default. A key pasted
// into a task, a --context document or a handed draft used to reach every seat, and so every lab
// behind them - the credential shapes in src/secret-patterns.js were checked only under an opt-in
// `--pii-gate`. Now every prompt is scanned before it leaves: in invoke() for every provider call
// and every external seat's NEEDS file (chain.js), and once up front over the input files so the
// refusal can name the file and line (cli.js).
//
// Credential shapes only. PII (emails, IBANs, cards) stays behind the opt-in `--pii-gate`. The
// scan reads and never rewrites: a clean prompt goes out byte-identical. A match is reported by
// pattern name, where and which line - never the value. The two context-only shapes (a bare
// 32-char / 64-hex string when the text says "mistral" / "together") are left out, the same way
// redaction leaves them out: "together" is an ordinary English word and a SHA-256 is not a key.
// A key written as plain prose ("the password is hunter2") has no shape and is not detectable.
//
// The one override is `--allow-secret-shaped` (saved in run.json, so a resume keeps it; MCP
// a person's typed flag only: the MCP parameter was removed in 0.8.3).
//
// Split by source (C&C, 2026-09-28, after verify pass F1): the leak guarded against is the user's
// own secret, and it enters through the inputs. The up-front input scan (cli.js: task, --context,
// handed draft, criteria) checks every shape, the generic ones included (a password in a URL, a
// named or env-style assignment, a Bearer header). The per-call scan in invoke() sees prompts that
// carry model output, where those generic shapes are mostly placeholders
// (`postgres://postgres:postgres@localhost`, `SESSION_SECRET=change-me`), so it checks only the
// distinctive key formats (provider prefixes, PEM/PGP, JWT, AWS, GitHub, Slack, Stripe, ...): a
// placeholder no longer stops a run mid-way, and a real key a model echoes is still caught.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import { findSecrets } from './secret-patterns.js';

// [{ line, name }] for every credential-shaped span in `text`, 1-based lines. `distinctiveOnly`
// leaves out the generic shapes (see above).
// `everyContext` (the advice brief only): also the context-only shapes, with no context word needed (see findSecrets).
// `exemptReservedHosts` (the input scans only, 0.8.3 Part E): a password in a URL on a reserved placeholder host is no finding (see findSecrets); off by default, so the advice send path and every other caller keep refusing it.
export function secretShapesIn(text, opts = {}) {
  return secretSpansIn(text, opts).map(({ line, name }) => ({ line, name }));
}

// The matched SPANS of a text, with the line and the pattern name. The span is the scanner's own match (start..end of findSecrets), kept only to be
// hashed (valueHashOf) or compared in memory: it is never printed, logged or stored. secretShapesIn above drops it.
export function secretSpansIn(text, { distinctiveOnly = false, everyContext = false, exemptReservedHosts = false } = {}) {
  if (typeof text !== 'string' || !text) return [];
  return findSecrets(text, { redactable: true, distinctiveOnly, everyContext, exemptReservedHosts }).map(s => ({
    line: text.slice(0, s.start).split('\n').length,
    name: s.name,
    span: text.slice(s.start, s.end),
  }));
}

// The person's consent attaches to a VALUE (Muad's ruling 8 Nov 2026: a found secret pauses the run; the person allows it; a different value pauses again).
// A value is kept as an HMAC-SHA-256 of the matched span, keyed with a random per-run key stored beside the hashes (run.json `secretAllow`), 32 hex
// characters. The key makes the lists of two runs unmatchable and unguessable from a dictionary of known keys; it is linkage hygiene, not brute-force
// defence: a key shape is high-entropy, and anyone who holds the secret itself can compute the hash and forge an entry.
export const newAllowKey = () => randomBytes(16).toString('hex');
/** The ONE normalisation and hash both sides call: the start scan of the inputs and the stage scan of a prompt. */
export function valueHashOf(key, span) {
  return createHmac('sha256', String(key)).update(String(span).normalize('NFC').trim()).digest('hex').slice(0, 32);
}
/** The hashes of every value a text holds under `opts` (a Set). */
export function secretValueHashesIn(text, key, opts = {}) {
  return new Set(secretSpansIn(text, opts).map(f => valueHashOf(key, f.span)));
}
/**
 * The hashes of the key-shaped values the INPUTS hold, for a person who typed --allow-secret-shaped at a start or a resume: the same spans the input scan
 * refuses (all shapes, the reserved-placeholder-host exemption) and the same spans a stage prompt's scan reports (distinctive formats), both hashed with the
 * same function, so the task's own key passes every stage and a changed character does not.
 */
export function inputValueHashes(texts, key) {
  const out = new Set();
  for (const t of texts) for (const opts of [{ exemptReservedHosts: true }, { distinctiveOnly: true }]) for (const h of secretValueHashesIn(t, key, opts)) out.add(h);
  return out;
}

// The outbound key scan's refusal lines (src/cli.js, src/run-preflight.js): pattern name and line, never the value.
export function secretRefusalLines(found) {
  return found.map(f => `  ${f.where}:${f.line}  ${f.name}`);
}

// A prompt was about to go out with a credential shape in it. Control flow like BudgetExceeded:
// no catch may turn it into an abstention (rethrowControlFlow reads `controlFlow`).
// The id of one stop: the stage label plus the sha256 of the exact prompt (system, a NUL, user). It names this text and no other, so a person's
// consent to it (secret-pause.js) cannot cover a different key, a different line or a different stage. 16 hex characters; no value is stored.
export function secretStopIdOf(label, system, user) {
  const promptSha = createHash('sha256').update(String(system ?? '')).update('\0').update(String(user ?? '')).digest('hex');
  return createHash('sha256').update(String(label)).update('\0').update(promptSha).digest('hex').slice(0, 16);
}

export class SecretShapedPrompt extends Error {
  constructor(label, findings, stopId = null, valueHashes = []) {
    super(`stage "${label}": the prompt contains ${findings.length} credential-shaped string(s) (${[...new Set(findings.map(f => f.name))].join(', ')}); nothing was sent`);
    this.controlFlow = true;
    this.label = label;
    this.findings = findings; // [{ part: 'system'|'user', line, name }]
    this.stopId = stopId;     // secretStopIdOf(label, system, user): names this stop in the pause record
    this.valueHashes = valueHashes;   // valueHashOf of each open value, with the run's key; [] when the run has none. Never a value.
  }
}

// The person's recorded --finish at a found-secret pause: thrown by invoke() for the paused stage instead of scanning or sending it, caught by the two pass loops of chain.js, which end there. Control flow
// (no catch around a call may turn it into an abstention).
export class SecretFinish extends Error {
  constructor(label, atOnce = false, relayed = false) {
    super(`stage "${label}": the run was paused at a credential-shaped string and the person chose to finish; the stage was not sent`);
    this.controlFlow = true;
    this.label = label;
    this.atOnce = atOnce === true;   // 0.8.4 (ladder unit, step 3): the person gave --finish-now at the pause, so no judge is asked again
    this.relayed = relayed === true;   // 0.8.4 (Q9): the person's finish was relayed by the handling session, with their words (checked against the ledger by the command that armed it)
  }
}

// 0.8.4 S16 (F; WORDING S16-w60 to w67): the person's recorded --finish at a SPENDING stop, armed after the person's typed raise. Same place and same ending as SecretFinish (the first call of the sitting that misses the cache inside a pass loop is the stage the limit stopped), so it is a SecretFinish
// for every catch and rethrow list in chain.js, and chain.js tells them apart by this class. `capName`: the cap that stopped the run, when per-provider caps were armed.
export class SpendFinish extends SecretFinish {
  constructor(label, capName = null, atOnce = false, relayed = false) {
    super(label);
    this.message = `stage "${label}": the spending limit stopped the run at this stage and the person chose to finish; the stage was not sent after that`;
    this.capName = capName;
    this.relayed = relayed === true;   // the person's words were relayed by the handling session
    this.atOnce = atOnce === true;   // 0.8.4 (ladder unit, finish at once at a spending stop): the person gave --finish-now, so no judge reads the plan again
  }
}

// 0.8.4 (ladder unit; C&C 10 Nov 2026: --finish-now at a spending stop): in the sitting the person ended at a spending stop with --finish-now, a call that would bill is NOT made: invoke() throws this, after the cache was read (a replayed stage is free
// and still replays) and BEFORE the reservation, so no request and no reservation exists for it. Control flow like SpendFinish: no catch around a call may turn it into an abstention, a silent seat or a failed stage (rethrowControlFlow, the security
// review's own rethrow list); each post-loop call site that can go on without its call catches it and goes on. `label` is the call that was not made.
export class NotRunForLimit extends Error {
  constructor(label, reason = 'spending_limit') {
    super(reason === 'finished_at_once' ? `stage "${label}": not run (the person ended the run at once, so no judge is asked for a read that is not already on disk)` : `stage "${label}": not run (the person ended the run at the spending limit)`);
    this.controlFlow = true;
    this.label = label;
    this.reason = reason === 'finished_at_once' ? 'finished_at_once' : 'spending_limit';   // why the call was not made: the spending limit, or a finish-now at a pause (a judge's read that is not on disk)
  }
}

// Throws SecretShapedPrompt unless the prompt is clean, the scan is waived, or every value found is one the person allowed. `allowed` is { key, hashes: Set }
// (the run's `secretAllow`). Returns what happened, for the call's usage record: 'waived' (the run-wide override of a caller that has one: the post-run
// handoff verb), 'consented' (every value found was allowed) or 'clean'. Distinctive key formats only: this runs on prompts that carry model output.
export function assertOutboundClean(label, { system, user }, { allow = false, allowed = null } = {}) {
  if (allow) return 'waived';
  const found = [
    ...secretSpansIn(system, { distinctiveOnly: true }).map(f => ({ part: 'system', ...f })),
    ...secretSpansIn(user, { distinctiveOnly: true }).map(f => ({ part: 'user', ...f })),
  ];
  if (!found.length) return 'clean';
  const hashOf = f => (allowed?.key ? valueHashOf(allowed.key, f.span) : null);
  const open = found.filter(f => { const h = hashOf(f); return !(h && allowed.hashes?.has?.(h)); });
  if (!open.length) return 'consented';
  throw new SecretShapedPrompt(label, open.map(({ part, line, name }) => ({ part, line, name })), secretStopIdOf(label, system, user), allowed?.key ? open.map(hashOf) : []);
}
