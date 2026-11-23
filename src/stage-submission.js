// v3 plan §1: the three warn-only checks `submit_stage` runs on a peer-submitted stage answer (and, since 14 Oct 2026, one REFUSING check before them: the credential-shape input scan, below)
// before accepting it as the stage's final one, factored out of src/mcp/server.js's tool handler
// so they're independently testable without spinning up the MCP transport (see
// test/peer-claim.test.js). Pure file-based logic, no network, no subprocess.
import { existsSync, realpathSync } from 'node:fs';
import { writeRunFileAtomic } from './run-files.js';
import { join, basename } from 'node:path';
import { answerShapeKindOf } from './stage-contract.js';
import { validateDeliverable } from './partial-deliverable.js';
import { writeClaim, readClaimFor } from './peer-claim.js';
import { words } from './ui/parse.js';
import { secretShapesIn } from './outbound-scan.js';
import { excerptChannelOn, sessionReadsProblems, excerptAnswersOn, excerptAnswersProblems } from './excerpt-channel.js';
import { readRunJson } from './run-files.js';
import { parseLineRange, extractExcerpt, REFUSAL_WORDS } from './excerpt-extract.js';
import { MAX_CLIENT_FILE_BYTES } from './tools.js';

// True when two paths are the same folder on disk (a link to it counts); a path that cannot be read is not the same (the rule of src/mcp/server.js, which cannot be imported here).
const sameFolder = (a, b) => { try { return realpathSync(a) === realpathSync(b); } catch { return false; } };

/** A-DRAFT (WORDING U1-w12): what a duplicate submission's reply adds when it carried session_reads or excerpt_answers: they sit in the late usage file, which no resume reads. '' when it carried neither. */
export function duplicateReadsNote(stage, { sessionReads, excerptAnswers } = {}) {
  const fields = [sessionReads?.length ? 'session_reads' : null, excerptAnswers?.length ? 'excerpt_answers' : null].filter(Boolean);
  return fields.length ? ` Not recorded: ${fields.join(' and ')}. They are kept, unread, in "${stage}.late.usage.json"; only the answer written first for a stage is read for them.` : '';
}

// 0.8.3 harness (a): the usage record of a session answer names no tool. Older run folders hold 'claude-code-session' here; every reader takes any string (a golden-folder test pins that), and nothing maps the old name to this one.
export const SESSION_MODEL = 'session';

/** "2 key-shaped strings (named credential assignment, Bearer token; lines 3, 7)": what a refusal says about findings of `secretShapesIn`. Names the formats and the lines, NEVER the value. */
export function credentialSentence(found) {
  const formats = [...new Set(found.map(f => f.name))].join(', ');
  const lines = [...new Set(found.map(f => f.line))];
  return `${found.length} key-shaped string${found.length === 1 ? '' : 's'} (${formats}; line${lines.length === 1 ? '' : 's'} ${lines.join(', ')})`;
}

/** prepare_stage_prompt's refusal (E 146 b/c), or null when the bundle is clean. The task file is scanned on its own first so the line numbers are the task file's; then the whole bundle. Lives here, not in server.js, so the reserved-host exemption is asked for in one small refusal-only file (RES-7). */
export function stageBundleRefusal(taskText, bundle) {
  const inTask = secretShapesIn(taskText, { exemptReservedHosts: true });
  if (inTask.length) return `stage_prompt.md was not written: the task file holds ${credentialSentence(inTask)}, and the bundle goes to a fresh subagent. Take them out of the task file, then call prepare_stage_prompt again.`;
  const inBundle = secretShapesIn(bundle, { exemptReservedHosts: true });
  if (inBundle.length) return `stage_prompt.md was not written: the stage bundle holds ${credentialSentence(inBundle)}, and the bundle goes to a fresh subagent. Take them out of what it quotes (the task file, the plan or the criteria), then call prepare_stage_prompt again.`;
  return null;
}

/**
 * Evaluate and write one stage answer. The three checks of v3 plan §1 never reject: each produces a warning,
 * not a refusal. ONE check does refuse (14 Oct 2026): an answer that holds a credential-shaped string is not written and this throws (the handler returns the message); and the existing required-arguments/return-shape contract for a caller that
 * omits `claimedBy` is unchanged (see the caller in src/mcp/server.js).
 *
 * @param {string} dir - the run folder.
 * @param {string} stage - the stage label (e.g. "build", "criteria").
 * @param {string} content - the submitted answer text.
 * @param {{ claimedBy?: string, chainConfig?: object, declaredAnswer?: object, workDir?: string }} opts - workDir: the SERVER's own working folder (src/mcp/server.js passes it): run.json is run-folder data, so its `cwd` is read for the size check below only when it is this folder (the resume is refused over MCP otherwise), and a run that names another folder is not read; absent = a library caller that trusts the run folder. declaredAnswer: the answerer's own declaration (built in src/mcp/server.js from the MCP handshake and the answered_model argument), stored in the usage record as `answered_by`; never checked
 * @returns {{ warnings: Array<object>, writtenFile: string, isDuplicate: boolean }}
 */
export function submitStageAnswer(dir, stage, content, { claimedBy, chainConfig, declaredAnswer = null, sessionReads, excerptAnswers, excerptSwitch, workDir } = {}) {
  // 3 Nov 2026 (the review of the money unit): a stage that waits for a REPAIR (src/near-json.js: `<stage>.repair.json` at the top level) is not an external stage waiting for an answer. Its seat already replied and was paid;
  // that paid usage record sits at `<stage>.usage.json`, and the write below would replace it with a $0 external record, so a paid call would vanish from every total. Refused first, before anything is read, scanned or
  // written; the marker's presence is enough (an unreadable marker is refused too). The sentence is A-DRAFT (public MCP text); 3 Nov 2026: it names the repair tool, repair_reply (its only caller is MCP submit_stage).
  if (existsSync(join(dir, `${stage}.repair.json`))) throw new Error(`"${stage}" is waiting for a repair of the reply its seat already wrote (that reply was paid for), not for a new answer, so nothing was written. Answer it with repair_reply (external_prompt shows the request).`);
  // 14 Oct 2026 (Haiku batch 4 A10 F2; Muad 12 Oct 06:19 "the check should go everywhere"): an answer a person or a peer session types for an external stage goes into the prompts of the seats that come after it. invoke()'s send-time scan reads only the DISTINCTIVE key
  // formats (it runs on prompts that carry model output), so a Bearer header, a URL password or `NAME=secret` in an answer passed. An answer is INPUT: it gets the full input scan, here, BEFORE anything is written or claimed. No override over MCP. Names stage, formats and lines, never the value.
  const found = secretShapesIn(content, { exemptReservedHosts: true });
  if (found.length) throw new Error(`the answer for "${stage}" was not written: it holds ${credentialSentence(found)}. Take them out of the answer, then submit it again.`);
  // 0.8.4 D38 (C&C, 09 Nov 2026, Q-a = A; WORDING D38-w2, w3, A-DRAFT): `session_reads` is the files the session read to write this answer. While the channel's words are not recorded the WHOLE answer is refused (never a partial record);
  // a bad shape, or a key-shaped string in a path or a why (an answer is INPUT: the scan above applies to them too; the path reaches a seat's prompt in the block heading), is refused the same way. Checked before anything is written or claimed. The reads are only STORED on the usage record here; the command that cuts, scans and records them when the run resumes is NOT BUILT at this commit.
  if (sessionReads !== undefined) {
    if (!excerptChannelOn()) throw new Error(`The answer for "${stage}" was not written: session_reads is not available in this version, so nothing was recorded. Send the answer again without session_reads.`);
    const bad = sessionReadsProblems(sessionReads);
    if (bad.length) throw new Error(`The answer for "${stage}" was not written: session_reads is not a list of { path, lines, why }: ${bad.join('; ')}. Fix it, then submit the answer again.`);
    sessionReads.forEach((r, k) => {
      const inRead = secretShapesIn(`${r.path}\n${r.why}`, { exemptReservedHosts: true });
      if (inRead.length) throw new Error(`The answer for "${stage}" was not written: session_reads entry ${k + 1} holds ${credentialSentence(inRead)}. Take them out of it, then submit the answer again.`);
    });
  }
  // 0.8.4 D18 (WORDING D18-w5, A-DRAFT; the same rule as session_reads: the WHOLE answer is refused, nothing written): the answers to the stage's listed text requests. The request numbers are the ones this stage's prompt.json holds.
  if (excerptAnswers !== undefined) {
    if (!excerptAnswersOn()) throw new Error(`The answer for "${stage}" was not written: excerpt_answers is not available in this version, so nothing was recorded. Send the answer again without excerpt_answers.`);
    const listed = new Set((readRunJson(dir, `${stage}.prompt.json`)?.text_requests ?? []).map(r => r?.n).filter(Number.isInteger));
    const bad = excerptAnswersProblems(excerptAnswers, listed);
    if (bad.length) throw new Error(`The answer for "${stage}" was not written: excerpt_answers is not a list of { request, path, lines } or { request, decline }: ${bad.join('; ')}. Fix it, then submit the answer again.`);
    excerptAnswers.forEach((a, k) => {
      const inAnswer = secretShapesIn(`${a.path ?? ''}\n${a.decline ?? ''}`, { exemptReservedHosts: true });
      if (inAnswer.length) throw new Error(`The answer for "${stage}" was not written: excerpt_answers entry ${k + 1} holds ${credentialSentence(inAnswer)}. Take them out of it, then submit the answer again.`);
    });
  }
  // 0.8.4 D10 (C&C 09 Nov 2026; WORDING D10-w6, w10..w12, w17, A-DRAFT). Two checks, kept apart. (1) The gate's LINE bounds (a range an approval gate cannot hold) apply only while a person's approval of excerpts is on, and
  // are read from the range the session named alone. (2) The harness's own BYTE cap applies in EVERY run: a whole file (no lines), or a named range whose kept bytes pass the cap, is refused here, so the session can narrow it, whatever the switch
  // says (the switch must not change what the judges get to see). The switch is read from the run's ledger inside this function (no caller can leave the check out); an unreadable record fails closed with the reader's own
  // message. A refusal refuses the WHOLE answer: nothing is written, claimed or recorded. A whole file is counted through the extraction's own jail (count-only mode, src/excerpt-extract.js: realpath, containment, denylist,
  // gitignore; the root is the folder run.json records, never the server's), keeps no text, and the resume's backstop still catches what changed since.
  if (sessionReads !== undefined || excerptAnswers !== undefined) {
    if (typeof excerptSwitch !== 'function') throw new Error('submitStageAnswer: session_reads or excerpt_answers was passed without excerptSwitch, the caller\'s reader of the privacy switch');   // a programming error, never shown to a person: the caller hands the reader in, so this module imports nothing that reaches the gate (test/gate-answer.test.js)
    const sw = excerptSwitch(dir);
    if (!sw.ok) throw new Error(`The answer for "${stage}" was not written: ${sw.message} Nothing was recorded.`);
    const named = p => String(p).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');
    const listedAll = readRunJson(dir, `${stage}.prompt.json`)?.text_requests ?? [];
    const tooBig = lines => { const r = parseLineRange(lines); return r && r.b !== null && (r.b > sw.lineNumberMax || r.b - r.a + 1 > sw.shownLinesMax); };
    const frame = (what, lines) => `The answer for "${stage}" was not written: ${what} names lines ${String(lines).trim()}, which an approval screen cannot hold (at most ${sw.shownLinesMax} lines, none past line ${sw.lineNumberMax}), and this run asks for a person's approval of excerpts.`;
    const whole = [];   // every entry that names a path: the whole file (no lines) or a named range
    (sessionReads ?? []).forEach((r, k) => {
      if (sw.on && tooBig(r.lines)) throw new Error(`${frame(`session_reads entry ${k + 1}`, r.lines)} Narrow the lines or leave the read out, then submit the answer again.`);
      whole.push({ path: r.path, lines: r.lines ?? null, what: `session_reads entry ${k + 1}`, leave: 'leave the read out' });
    });
    (excerptAnswers ?? []).forEach((a, k) => {
      if (a.decline !== undefined && a.decline !== null) return;
      const q = listedAll.find(x => x?.n === a.request);
      const lines = a.lines ?? q?.lines ?? null;   // the resume's own expression (src/excerpt-resume.js): the answer's lines, else the request's
      const what = `excerpt_answers entry ${k + 1} (request ${a.request})`;
      if (sw.on && tooBig(lines)) throw new Error(`${frame(what, lines)} Narrow the lines, or decline the request with a reason, then submit the answer again.`);
      whole.push({ path: a.path ?? q?.path, lines, what, leave: 'decline the request with a reason' });
    });
    if (whole.length) {   // every entry that names a path: the whole file (no lines) or a named range
      const root = readRunJson(dir, 'run.json')?.cwd;
      const recorded = typeof root === 'string' && root !== '';
      const rooted = recorded && (workDir === undefined || sameFolder(root, workDir));   // a folder run.json names that is not the server's own is never read here (D2, C&C 09 Nov 2026): the resume is refused for it
      if (!recorded && sw.on && whole.some(w => parseLineRange(w.lines)?.b === null)) throw new Error(`The answer for "${stage}" was not written: the folder this run started in is not recorded, so the size of ${named(whole.find(w => parseLineRange(w.lines)?.b === null).path)} could not be checked. Nothing was recorded.`);
      for (const w of rooted ? whole : []) {
        const isWhole = parseLineRange(w.lines)?.b === null;
        const c = extractExcerpt(root, w.path, isWhole ? null : w.lines, { countUpTo: isWhole && sw.on ? sw.shownLinesMax : Infinity });   // line bounds only for a whole file with the switch on (a named range was checked above)
        if (!c.ok && c.reason === 'too_large') {
          throw new Error(isWhole
            ? `The answer for "${stage}" was not written: ${w.what} names the whole of ${named(w.path)}, which holds more than ${MAX_CLIENT_FILE_BYTES} bytes; the harness keeps at most that much. Name a range of lines, or ${w.leave}, then submit the answer again.`
            : `The answer for "${stage}" was not written: ${w.what} names lines ${String(w.lines).trim()} of ${named(w.path)}, which hold more than ${MAX_CLIENT_FILE_BYTES} bytes; the harness keeps at most that much. Narrow the lines, or ${w.leave}, then submit the answer again.`);
        }
        if (!sw.on || !isWhole) continue;   // with the switch off nothing else is refused here; a named range's other refusals are the resume's
        if (!c.ok) throw new Error(`The answer for "${stage}" was not written: ${w.what} names ${named(w.path)}, which could not be cut: ${REFUSAL_WORDS[c.reason] ?? c.reason}. Fix the path, or ${w.leave}, then submit the answer again.`);
        if (c.over) throw new Error(`The answer for "${stage}" was not written: ${w.what} names the whole of ${named(w.path)}, which is longer than ${sw.shownLinesMax} lines; an approval screen cannot hold more, and this run asks for a person's approval of excerpts. Name a range of lines, or ${w.leave}, then submit the answer again.`);
      }
    }
  }
  const warnings = [];

  // (1) claim_mismatch: claimedBy given, differs from an existing claim's claimed_by.
  const existingClaim = readClaimFor(dir, stage);
  if (claimedBy && existingClaim && existingClaim.claimed_by !== claimedBy) {
    warnings.push({ type: 'claim_mismatch', stage, claimed_by: claimedBy, claim_holder: existingClaim.claimed_by });
  }
  if (claimedBy) writeClaim(dir, stage, claimedBy);

  // (2) stage_validation_failed: reuse v2's own required-sections machinery
  // (stage-contract.js/partial-deliverable.js), not a new validator.
  const kind = answerShapeKindOf(stage);   // 0.8.4 q-warn: null for a `-question` answer (prose, not a verdict)
  if (chainConfig && kind) {
    const check = validateDeliverable(kind, content);
    if (!check.ok) warnings.push({ type: 'stage_validation_failed', stage, reason: check.reason, missing: check.missing });
  }

  // (3) duplicate_answer: <stage>.md already exists - never silently overwrite (that would
  // silently discard whichever peer answered first). Keep both; the harness picks neither.
  const answerFile = join(dir, `${stage}.md`);
  const isDuplicate = existsSync(answerFile);
  const writtenFile = isDuplicate ? join(dir, `${stage}.late.md`) : answerFile;
  const usageFile = isDuplicate ? join(dir, `${stage}.late.usage.json`) : join(dir, `${stage}.usage.json`);
  if (isDuplicate) warnings.push({ type: 'duplicate_answer', stage, kept: [`${stage}.md`, `${stage}.late.md`] });

  // 0.8.2 item 2: written without following a symbolic link (src/run-files.js); a refusal stops the submission before anything is accepted.
  // Usage record FIRST, answer text LAST, both atomic (temp file + rename): the main run's order (src/stage-cache.js, src/cli.js onStage). The text file is what makes a stage "answered", so a refused or failed write of either file
  // leaves no truncated answer behind; a usage file whose text never landed is the cache's orphan case, handled on resume.
  const usage = writeRunFileAtomic(dir, basename(usageFile), JSON.stringify({ provider: 'external', model: SESSION_MODEL, ...(declaredAnswer ? { answered_by: declaredAnswer } : {}), usage: { input: 0, output: words(content) }, usd: 0, ms: 0, ...(sessionReads?.length ? { session_reads: sessionReads.map(r => ({ path: r.path, lines: r.lines ?? null, why: r.why })) } : {}), ...(excerptAnswers?.length ? { excerpt_answers: excerptAnswers.map(a => (a.decline !== undefined ? { request: a.request, decline: a.decline } : { request: a.request, path: a.path ?? null, lines: a.lines ?? null })) } : {}) }));
  if (usage.refusal) throw new Error(usage.refusal);
  const text = writeRunFileAtomic(dir, basename(writtenFile), content);
  if (text.refusal) throw new Error(text.refusal);

  return { warnings, writtenFile, isDuplicate };
}
