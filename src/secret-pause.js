// A credential-shaped string found in a prompt DURING a run pauses the run; it does not end it (0.8.4; Muad 8 Nov 2026: "It should pause not stop").
// This module is the small record of that pause and the words of its marker. Reads the record through src/run-files.js readRunJson.
//
//   secret-stop.json   schema secret-stop/1: { schema, stop, label, phase?, findings: [{ part, line, name }], values: [hmac], at }. `phase` (c2) = 'before' | 'loop' | 'after': where in the run the pause came
//                      (a --finish is possible only inside the review rounds, 'loop'); a record without it is a c1 record and refuses --finish. `stop` is the stop id (outbound-scan.js
//                      secretStopIdOf: the stage label plus the sha256 of the exact prompt); `values` are valueHashOf of each open value with the run's key. No
//                      value of a secret is ever stored.
//
// The record is NOT a consent. A consent is the person's typed `--resume <run> --continue` (or `--allow-secret-shaped` on a resume): it adds the record's
// `values` to the run's allowed list (run.json `secretAllow`), so the person allows exactly those values and a different value pauses again. A missing,
// torn, unparseable or other-schema file reads as null here, and null means nothing to answer and no consent (fails closed). The file is not a STOPPED-<cause>.json marker and no cause is added to
// stop-files.js STOP_CAUSES: a tree resume never sees a secret pause. The handling session's stop_decide sees it since Q9 (10 Nov 2026): it only RELAYS the person's own choice with their words (the gate stop id is secretGateStopId); it never answers on its own.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readRunJson } from './run-files.js';

/** 0.8.4 D38: the stop label of a pause at an EXCERPT is excerpt-E-<n>, n = the id the excerpt's line gets in excerpts.jsonl (src/excerpt-resume.js). Here, in the leaf, so the pause text can tell the two kinds apart without importing the record. */
export const EXCERPT_LABEL_PREFIX = 'excerpt-';
export const excerptLabelOf = n => `${EXCERPT_LABEL_PREFIX}E-${n}`;
export const isExcerptLabel = label => typeof label === 'string' && /^excerpt-E-[1-9]\d*$/.test(label);

export const SECRET_STOP_FILE = 'secret-stop.json';
export const SECRET_STOP_SCHEMA = 'secret-stop/1';
export const SECRET_MARKER_FILE = 'STOPPED-secret.md';
/**
 * THE ONE READER of whether a found-secret pause is in a run folder (stop_decide, run_status and resume_run ask it). `marker`: STOPPED-secret.md, which is what the terminal's own commands (--continue, --finish, --drop-excerpt) test and what a sitting's start deletes together with the record; `record`: secret-stop.json,
 * written AFTER the marker. The two are deleted together at the next sitting's start, so a record WITHOUT its marker is only a leftover (a crash between the two writes' deletions, or a hand edit): the terminal does not treat it as a pause. Each asker decides what to do with it - the stop tool refuses the stop on EITHER file (it may refuse too much, never too little), run_status and resume_run report a pause only on the marker.
 */
export const secretPauseFiles = dir => ({ marker: existsSync(join(dir, SECRET_MARKER_FILE)), record: existsSync(join(dir, SECRET_STOP_FILE)) });

/** 0.8.4 (Q9, the person's yes of 10 Nov 2026): the id the handling session's stop_decision gate carries for a found-secret pause: `secret_pause:` and the record's own 16-hex stop id (the stage label plus the sha256 of the exact prompt), so an answer given for one pause is never taken for another. */
export const secretGateStopId = rec => `secret_pause:${rec.stop}`;
/** The choices the terminal takes at this pause, which the handling session may RELAY in the person's own words (one list for the tool and the gate): a continue always; a drop only at an excerpt; a plain finish only inside the review rounds; a finish-now inside or after them, never before. */
export const secretChoicesOf = pause => [...['continue'], ...(isExcerptLabel(pause?.label) ? ['drop'] : []), ...(pause?.phase === 'loop' ? ['finish'] : []), ...(pause?.phase === 'loop' || pause?.phase === 'after' ? ['finish_now'] : [])];

/** The record for a pause. `err` is a SecretShapedPrompt. */
export function secretStopRecord(err, now = Date.now()) {
  return {
    schema: SECRET_STOP_SCHEMA,
    stop: err.stopId,
    label: err.label,
    phase: err.phase === 'loop' || err.phase === 'after' ? err.phase : 'before',
    findings: err.findings.map(f => ({ part: f.part, line: f.line, name: f.name })),
    values: [...new Set(err.valueHashes)],
    at: new Date(now).toISOString(),
  };
}

/** The record in a run folder, or null for anything that is not a whole secret-stop/1 file (missing, torn, other schema, no stop id). */
export function readSecretStop(dir) {
  const rec = readRunJson(dir, SECRET_STOP_FILE);   // src/run-files.js: null for a missing, unreadable or unparseable file (the house reader of a run folder's files)
  if (!rec || typeof rec !== 'object' || rec.schema !== SECRET_STOP_SCHEMA) return null;
  if (typeof rec.stop !== 'string' || !/^[0-9a-f]{16}$/.test(rec.stop)) return null;
  if (typeof rec.label !== 'string' || !rec.label || typeof rec.at !== 'string' || !Number.isFinite(Date.parse(rec.at))) return null;
  if (rec.phase !== undefined && rec.phase !== 'before' && rec.phase !== 'loop' && rec.phase !== 'after') return null;
  if (!Array.isArray(rec.findings)) return null;
  if (!Array.isArray(rec.values) || !rec.values.length || !rec.values.every(v => typeof v === 'string' && /^[0-9a-f]{32}$/.test(v))) return null;   // no value hashes = nothing a --continue could allow
  return rec;
}

/** The record, only when this sitting wrote it: its `at` is not before `sinceMs` (a child's spawn time). A stale record from an earlier pause is null. */
export function readSecretStopSince(dir, sinceMs) {
  const rec = readSecretStop(dir);
  return rec && Date.parse(rec.at) >= sinceMs ? rec : null;
}

/**
 * The MCP spawn sites' decision (src/mcp/server.js): a child that ended with exit 11 AFTER writing a whole secret-stop/1 record at or after its spawn did not fail to start, it
 * paused. -> the record, or null for anything else: a child still running, another exit code, no record, a record older than the spawn (a stale one from an earlier pause, left beside a
 * later PRE-RUN refusal), a torn record. `exited` is the 'exit' event ({ code }) or null.
 */
export function secretPauseAfterExit(dir, exited, spawnedAtMs) {
  if (!exited || exited.code !== 11) return null;
  return readSecretStopSince(dir, spawnedAtMs);
}

const findingLines = err => err.findings.map(f => `- ${f.part} prompt, line ${f.line}: ${f.name}`).join('\n');

/** The sentence that says who answers a pause (0.8.4, Q9: the person, at a terminal or through the handling session that relays their own words; before Q9 it was terminal only). */
export const SECRET_TERMINAL_SENTENCE = "Only the person answers this: at a terminal with a command above, or by telling the handling session, which relays the person's choice in the person's own words.";   // A-DRAFT (LAD-Q9-2; Q9, 10 Nov 2026): the old sentence said "Only a command typed at a terminal answers this: none of the Council's MCP tools can."

/** STOPPED-secret.md for a run (A-DRAFT; WORDING_0.8.4.md, section 'Found-secret pause', second draft). */
export function secretPauseText(err, { runId, command, ending = null }) {   // `ending`: the sentence src/secret-ending.js secretEndingSentence builds from the chain, or null (no --finish offered)
  if (isExcerptLabel(err.label)) return excerptPauseText(err, { runId, command });
  return `# Run paused: a credential-shaped string in a prompt

Stage \`${err.label}\` was about to be sent with text shaped like a key (the value is not repeated here):

${findingLines(err)}

Nothing was sent for this stage. The run is paused, not ended: the stages already done are on disk and replay for free.
The input files were scanned before the run started, so this text came from an earlier stage's output or the chain itself. Read \`${err.label}\`'s inputs, then choose, at a terminal:

    ${command} --resume runs/${runId} --continue

sends this stage as it is. That is your explicit consent to send the credential-shaped value(s) listed above, now and in every later prompt of this run: a different value pauses the run again. Do nothing and the run stays paused; you can come back to it later.
${err.phase === 'loop' && ending ? `
    ${command} --resume runs/${runId} --finish

records that you want to end the run here, NOT agreed. The run stays paused and nothing is sent until you also give --continue.${ending}
` : ''}${SECRET_TERMINAL_SENTENCE}
`;
}

/** STOPPED-secret.md for a tree member: the old words, a member takes no override and no choice (unchanged). */
export function secretMemberStopText(err, memberTail) {
  return `# Run stopped: a credential-shaped string in a prompt

Stage \`${err.label}\` was about to be sent with text shaped like a key (the value is not repeated here):

${findingLines(err)}

Nothing was sent for this stage. The input files were scanned before the run started (for these distinctive key formats and
the generic shapes), so this text came from an earlier stage's output or the chain itself. Completed stages are on disk and replay for free.
Read \`${err.label}\`'s inputs.

${memberTail}`;
}

/**
 * The person's recorded --finish for THIS pause (run.json `secretFinish`: { choice: 'finish', label, at, via }). -> 'none' (no entry: c1 behaviour), 'finish' (a whole entry naming the paused stage) or
 * 'bad' (an entry that is not whole, or names another stage: the resume is REFUSED, because going on with the review would send more than the person chose). It is not a consent: --continue allows the value.
 */
export function secretFinishState(runMeta, pause) {
  const f = runMeta?.secretFinish;
  if (f === undefined) return 'none';
  const whole = f && typeof f === 'object' && (f.choice === 'finish' || f.choice === 'finish_now') && typeof f.label === 'string' && f.label && typeof f.at === 'string' && Number.isFinite(Date.parse(f.at));
  if (!whole || !pause) return 'bad';
  if (f.label === pause.label) return f.choice;
  // 0.8.4 (ladder unit, step 3): a recorded --finish-now adds NO allowed value, so the ending it started may pause AGAIN at a later stage (a prompt of the ending that still holds the value, phase `after`): the person's --continue there goes on with the ending they chose. A plain --finish allowed the values, so it never needed this.
  return f.choice === 'finish_now' && pause.phase === 'after' ? 'finish_now' : 'bad';
}

/** STOPPED-secret.md for a pause at an EXCERPT (the stop label is excerpt-E-<n>): what the text is, and the person's three choices, at a terminal. A finish cannot arise here (the pause comes at the start of a resume). A-DRAFT, WORDING D38-w7. */
export function excerptPauseText(err, { runId, command }) {
  return `# Run paused: a credential-shaped string in an excerpt

Excerpt \`${err.label.slice('excerpt-'.length)}\` was about to be recorded with text shaped like a key (the value is not repeated here):

${err.findings.map(f => `- line ${f.line}: ${f.name}`).join('\n')}

Nothing was recorded or shown to any seat. The run is paused, not ended: the stages already done are on disk and replay for free.
This text is lines of a file in your project: one the handling session read for its answer, or one a seat asked to see and the handling session answered. Read it, then choose, at a terminal:

    ${command} --resume runs/${runId} --continue

records this text as it is and shows it to the seats. That is your explicit consent to record the credential-shaped value(s) listed above and to send them in every later prompt of this run: a different value pauses the run again.

    ${command} --resume runs/${runId} --drop-excerpt

leaves this text out: it is recorded as withheld, no seat is shown it, and the run goes on without it.
Do nothing and the run stays paused; you can come back to it later.
${SECRET_TERMINAL_SENTENCE}
`;
}
