// GAP A (Muad 23 Okt 2026, option B: "To me B sounds much more user friendly"; plan Review/Build_0.8.3/m8/C_GapA_Session_Draft_Plan_2026-10-23.md, C&C PASS WITH CONDITIONS): the controlling session writes the new decision for a stuck ROOT plan as a DRAFT.
// `council tree decide` shows the draft in full and the person approves it by typing the stop id (src/tree-decide.js, src/tree-decide-stop.js buildRootReplan); the draft decides nothing, spends nothing and answers nothing.
//   draftTextRefusal({ rootDir, text, reason })   the SAME scans a typed decision gets (credential shapes, then the tree's personal-data mode), on the text AND the reason: null | a sentence. Used by the draft step and by the terminal; the
//                                                 table judges the record only (src/tree-transitions.js stop_draft_written), as it does for every other text.
//   sessionDraft({ rootDir, stop, text, reason }) the MCP step "draft": -> { refusal } | { recorded, draftId, bytes, sha256 }.
//   waitingDraft({ rootDir, stopArg })            (src/tree-decide-stop.js) the newest draft of the root stop a regenerate would answer.
// All sentences are A-DRAFT (model-facing and person-facing words need Muad's yes).
import { createHash } from 'node:crypto';
import { TreeRefusal, appendTreeEvent, readTreeRecord, unreadableRecordRefusal } from './tree-record.js';
import { finalSentenceOf, recordRefusalLine } from './tree-abandon.js';
import { DECISION_MAX_BYTES } from './tree-decide-stop.js';
import { piiGateReport, textSecretFindings } from './run-preflight.js';
import { treeInputScanModeFrom } from './tree-pii-mode.js';
import { secretRefusalLines } from './outbound-scan.js';
import { hiddenIn } from './hidden-chars.js';
import { terminalSafe } from './terminal-safe.js';

/**
 * What a typed decision is held to (readDecisionText: terminalSafe, then hiddenIn): the gate screen must show what is recorded, so a control or direction-changing character, or an invisible one, is refused (A-DRAFT sentences).
 * `pairs` = [[where, text], ...]. -> null | the refusal sentence (it names the place and the code point, never more). BUG-C-050: ONE copy of the check and its sentences, run by a draft here and by the session's decision text and reason (tree-decide-session.js preflight).
 */
export function invisibleTextRefusal(pairs) {
  for (const [where, t] of pairs) {
    if (terminalSafe(t) !== t) return `${where} holds a control or direction-changing character that a person cannot see on the screen; write it again without it`;
    const bad = hiddenIn(t, { allowQuiet: true });
    if (bad) return `${where} holds an invisible character (${bad.code}) that a person cannot see on the screen; write it again without it`;
  }
  return null;
}

/** The scans of a typed decision text, run over a draft's text and reason. -> null | the refusal sentence (it names the pattern or type and the position, never the value). */
export function draftTextRefusal({ rootDir, text, reason }) {
  const invisible = invisibleTextRefusal([['the draft text', text], ['the reason', reason]]);
  if (invisible) return invisible;
  for (const [where, t] of [['the draft text', text], ['the reason', reason]]) {
    const keyed = textSecretFindings(t, where);
    if (keyed.length) return `${where} holds ${keyed.length} credential-shaped string(s):\n${secretRefusalLines(keyed).join('\n')}\nA tree takes no override: change the text`;
  }
  const mode = treeInputScanModeFrom(readTreeRecord(rootDir).tree);
  if (mode.status === 'unusable') return `the tree's personal-data mode in tree.json is unusable (${mode.reason}): no text is accepted for its members`;
  if (mode.status === 'on') {
    const pii = piiGateReport({ mode: mode.mode, sources: [['the draft text', text], ['the reason', reason]], forTree: true });
    if (pii.blocked) return `the draft holds personal data under --pii-gate ${mode.mode}: ${pii.findings.map(f => `${f.where}, line ${f.line}, col ${f.column}: ${f.type}`).join('; ')}`;
  }
  return null;
}

/** The scans of a typed decision, run over a person's change request (it reaches a model through the status): -> null | the refusal sentence (type or pattern and position, never the value). */
export function changeRequestRefusal({ rootDir, text }) {
  const keyed = textSecretFindings(text, 'your request');
  if (keyed.length) return `your request holds ${keyed.length} credential-shaped string(s):\n${secretRefusalLines(keyed).join('\n')}\nA tree takes no override: change the text`;
  const mode = treeInputScanModeFrom(readTreeRecord(rootDir).tree);
  if (mode.status === 'unusable') return `the tree's personal-data mode in tree.json is unusable (${mode.reason}): no text is accepted for its members`;
  if (mode.status === 'on') {
    const pii = piiGateReport({ mode: mode.mode, sources: [['your request', text]], forTree: true });
    if (pii.blocked) return `your request holds personal data under --pii-gate ${mode.mode}: ${pii.findings.map(f => `${f.where}, line ${f.line}, col ${f.column}: ${f.type}`).join('; ')}`;
  }
  return null;
}

/** The words of the second prompt (A-DRAFT): a request for a change, or a bare dot for the person's own decision. */
export const CHANGE_EMPTY = 'a bare dot: the person writes their own decision';
export const CHANGE_WORDS = Object.freeze({
  intro: maxBytes => `Type what the session should change (at most ${maxBytes} bytes). End it with a line holding only a dot (.); type only a dot to write your own decision instead.`,
  prompt: 'change: ',
  empty: CHANGE_EMPTY,
  tooLong: maxBytes => `the request is longer than ${maxBytes} bytes`,
  hidden: code => `the request holds an invisible character (${code}) that you cannot see on the screen; type it again without it`,
});

/** The MCP step "draft". The text is the decision as the session would have a person type it; the stop is an open stop of the ROOT. Nothing is decided and nothing is spent. */
/** The refusal for a decision text over the limit: the draft step and the session's quote and answer say it in the same words (BUG-C-051). */
export const textTooLongSentence = bytes => `the text is ${bytes} bytes; a decision holds at most ${DECISION_MAX_BYTES} bytes`;

export function sessionDraft({ rootDir, rootId = null, stop, text, reason }) {
  { const unreadable = unreadableRecordRefusal(readTreeRecord(rootDir)); if (unreadable) return { refusal: unreadable }; }
  if (typeof stop !== 'string') return { refusal: 'name the open stop of the root the draft is for (stop)' };
  if (typeof text !== 'string' || !text.trim()) return { refusal: 'the draft text is empty: write the decision, word for word, as a person would type it' };
  if (typeof reason !== 'string' || !reason.trim()) return { refusal: 'the session\'s written reason is missing' };
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > DECISION_MAX_BYTES) return { refusal: textTooLongSentence(bytes) };
  const final = finalSentenceOf(rootDir); if (final) return { refusal: final };
  const scan = draftTextRefusal({ rootDir, text, reason }); if (scan) return { refusal: scan };
  try {
    const e = appendTreeEvent(rootDir, { event: 'stop_draft_written', stopId: stop, text, reason: reason.trim(), sha256: createHash('sha256').update(text, 'utf8').digest('hex'), actor: 'session', via: 'mcp' });
    return { recorded: `draft ${e.id} for stop ${stop} (${bytes} bytes). Nothing is decided and nothing was spent: tell the user to run \`council tree decide ${rootId ?? '<root run id>'}\` at a terminal, where the draft is shown in full for them to approve`, draftId: e.id, bytes, sha256: e.sha256 };
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    return { refusal: recordRefusalLine({ verb: 'tree decide', reason: e.reason, rootDir }) };
  }
}
