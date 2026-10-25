// `council tree decide <rootId> --accept-plan --stop <id>` (0.8.3 M6 unit 2c; gate page Review/Build_0.8.3/m6-closing/Restore_Gap_Gate_Page.md sections 13 and 13.9; C&C PASS ON CONDITIONS 14 Oct 2026; Muad's packet-3 answer 4: "a CHANGED plan file: ACCEPTING a change to an
// accepted obligation is the person's, with the diff"). The PERSON'S form for a stop whose cause is a plan file that changed: the person reads what changed (a diff against the text the panel signed, or the whole new plan when no signed copy is kept), types the stop id, and the gate
// records ONE `plan_accepted` (actor person, via terminal) through the one writer, src/tree-accept.js. Every number and refusal sentence comes from `candidatePlanAccept` (the form's preflight, its text and its rebuild comparison are the writer's own view): this file computes none.
//
// Contract:
//   buildAcceptPlan({ rootDir, rootId, stopArg, facts }) -> { refusal } | { text, expect, typedLabel, formName, after, apply }   (the shape every `decide` form returns; nothing is written here)
//   lineDiff(oldText, newText) -> string[]   a pure line diff (`- old`, `+ new`, two lines of context, `...` between hunks); used only here
// Order, as every decide form: preflight (refusals ask nobody and write nothing) -> text -> the gate -> the form is built AGAIN after the yes and the approval is NOT used when the text moved (src/tree-decide.js) -> `apply`.
import { dirname } from 'node:path';
import { sha256Of } from './thin-contract.js';
import { readRunFile, trustedRunDir } from './run-files.js';
import { readTreeRecord, stateOf } from './tree-record.js';
import { DEAD_REASON } from './tree-transitions.js';
import { acceptChangedPlan, candidatePlanAccept } from './tree-accept.js';
import { PLAN_COPY_FILE } from './tree-member.js';
import { terminalSafeMarked } from './terminal-safe.js';

/** The largest plan body (or diff) this form prints: a person approves what they were shown, so a larger text is refused, never cut (gate page 13.9 A1; known-limit E item). 64 KB = 65536 bytes, the size of one screen-full of a long plan, chosen by C&C 14 Oct 2026. */
export const ACCEPT_SHOW_MAX_BYTES = 65536;
const DIFF_CONTEXT = 2;
const DIFF_CELLS_MAX = 4_000_000;            // the middle part of two plans that differ everywhere: 2000 x 2000 lines; above it the diff is one replaced block, said so

/** A line diff: common start and end are trimmed, the middle is an LCS table (bounded by DIFF_CELLS_MAX; above it the whole middle is one `-` block and one `+` block). Output lines are unprefixed-by-position: `  ` kept context, `- ` removed, `+ ` added, `...` between hunks. */
export function lineDiff(oldText, newText) {
  const a = oldText.split('\n'); const b = newText.split('\n');
  let head = 0; while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0; while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  const am = a.slice(head, a.length - tail); const bm = b.slice(head, b.length - tail);
  const ops = [];                              // { t: ' ' | '-' | '+', s }
  for (let i = 0; i < head; i++) ops.push({ t: ' ', s: a[i] });
  if ((am.length + 1) * (bm.length + 1) > DIFF_CELLS_MAX) { for (const s of am) ops.push({ t: '-', s }); for (const s of bm) ops.push({ t: '+', s }); } else {
    const w = bm.length + 1; const L = new Uint32Array((am.length + 1) * w);
    for (let i = am.length - 1; i >= 0; i--) for (let j = bm.length - 1; j >= 0; j--) L[i * w + j] = am[i] === bm[j] ? L[(i + 1) * w + j + 1] + 1 : Math.max(L[(i + 1) * w + j], L[i * w + j + 1]);
    let i = 0; let j = 0;
    while (i < am.length && j < bm.length) {
      if (am[i] === bm[j]) { ops.push({ t: ' ', s: am[i] }); i++; j++; } else if (L[(i + 1) * w + j] >= L[i * w + j + 1]) { ops.push({ t: '-', s: am[i] }); i++; } else { ops.push({ t: '+', s: bm[j] }); j++; }
    }
    while (i < am.length) ops.push({ t: '-', s: am[i++] }); while (j < bm.length) ops.push({ t: '+', s: bm[j++] });
  }
  for (let k = a.length - tail; k < a.length; k++) ops.push({ t: ' ', s: a[k] });
  // keep only the changed lines and DIFF_CONTEXT lines around them
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, k) => { if (o.t !== ' ') for (let d = -DIFF_CONTEXT; d <= DIFF_CONTEXT; d++) if (ops[k + d]) keep[k + d] = true; });
  const out = []; let gap = false;
  ops.forEach((o, k) => { if (keep[k]) { if (gap && out.length) out.push('...'); gap = false; out.push(`${o.t} ${o.s}`.replace(/^ {2}/, '  ')); } else gap = true; });
  return out;
}

const indent = text => text.split('\n').map(l => `      ${l}`).join('\n');   // every shown line starts with six spaces: a line of the plan can never stand where the form's own markers stand
const kb = n => `${Math.ceil(n / 1024)} KB`;
const idsOf = nodes => `${nodes.slice(0, 3).map(k => (typeof k === 'string' ? k : k.node)).join(', ')}${nodes.length > 3 ? ', ...' : ''}`;

/** What the person is told a SESSION could not have decided alone: the table's own session-only conditions, from the same functions (candidatePlanAccept's facts.conditions). */
/** The words for registered nodes that are dead, whichever way they died (a decision replaced them, or the plan they grow from; the plan accepted here is still standing): they never start and nothing is rebuilt for them. */
const deadTail = n => (n === 1 ? `is dead: it was ${DEAD_REASON}, so it never starts and nothing is rebuilt for it.` : `are dead: each was ${DEAD_REASON}, so they never start and nothing is rebuilt for them.`);
function sessionOnlyLines(c, { rootId, stopId }) {
  const out = [];
  if (c.root) out.push('This is the root plan. A session never accepts a change to it; only you do.');
  // REBUILD (Muad, 14 Oct 2026: "Rebuild them (Recommended)"; gate page section 14): a sub-plan registered and NOT started has its input rebuilt from the accepted text before it starts (src/tree-rebuild.js), so the person is told that and nothing else about it. One that started, stopped or finished read the old text and is not redone.
  // already-false unit (M2): a DEAD sub-plan (replaced or set aside by a decision, or a node above it was) is never rebuilt and never starts, so it is not one of the ones "rebuilt before it starts". The table still counts it (a session is refused while a registered child exists, dead or not): it keeps its place in the list, with its own sentence. `c.dead` is deadKeys(state).
  const dead = new Set(c.dead ?? []); const isDead = k => dead.has(`${k.node}@g${k.generation}`); const keyIds = nodes => idsOf(nodes.map(k => `${k.node}@g${k.generation}`));
  const waiting = c.children.filter(k => k.phase === 'registered' && !isDead(k)); const begun = c.children.filter(k => k.phase !== 'registered'); const deadWaiting = c.children.filter(k => k.phase === 'registered' && isDead(k));
  if (begun.length) out.push(`${begun.length} registered sub-plan${begun.length === 1 ? ' has' : 's have'} started, stopped or finished (${idsOf(begun)}). ${begun.length === 1 ? 'It was' : 'They were'} derived from the old text and ${begun.length === 1 ? 'is' : 'are'} not redone.`);
  if (waiting.length) out.push(`${waiting.length} registered sub-plan${waiting.length === 1 ? ' has' : 's have'} not started yet (${idsOf(waiting)}). ${waiting.length === 1 ? 'Its input is' : 'Their inputs are'} rebuilt from the accepted text before ${waiting.length === 1 ? 'it starts' : 'they start'}, unless the accepted plan no longer holds a section ${waiting.length === 1 ? 'it quotes: then it does not start' : 'they quote: then that one does not start'}, and the next \`council tree resume\` says why and what you can do.`);
  if (deadWaiting.length) out.push(`${deadWaiting.length} registered sub-plan${deadWaiting.length === 1 ? '' : 's'} (${keyIds(deadWaiting)}) ${deadTail(deadWaiting.length)}`);       // A-DRAFT
  if (c.approvedFrontiers.length) out.push(`The children of this plan were already approved (${idsOf(c.approvedFrontiers)}) on a preview built from the old text, and their bundles quote sections of it. They are not redone.`);
  const depsWaiting = c.dependents.filter(k => k.phase === 'registered' && !isDead(k)); const depsBegun = c.dependents.filter(k => k.phase !== 'registered'); const depsDead = c.dependents.filter(k => k.phase === 'registered' && isDead(k));
  if (depsBegun.length) out.push(`${depsBegun.length} registered node${depsBegun.length === 1 ? '' : 's'} (${idsOf(depsBegun)}) depend on this plan, ${depsBegun.length === 1 ? 'has' : 'have'} started, stopped or finished, and were built against the old text. They are not redone.`);
  if (depsWaiting.length) out.push(`${depsWaiting.length} registered node${depsWaiting.length === 1 ? '' : 's'} (${idsOf(depsWaiting)}) ${depsWaiting.length === 1 ? 'depends' : 'depend'} on this plan and ${depsWaiting.length === 1 ? 'has' : 'have'} not started yet: ${depsWaiting.length === 1 ? 'its input is' : 'their inputs are'} rebuilt from the accepted text before ${depsWaiting.length === 1 ? 'it starts' : 'they start'}, unless the accepted plan no longer holds a section ${depsWaiting.length === 1 ? 'it quotes: then it does not start' : 'they quote: then that one does not start'}, and the next \`council tree resume\` says why and what you can do.`);
  if (depsDead.length) out.push(`${depsDead.length} registered node${depsDead.length === 1 ? '' : 's'} (${keyIds(depsDead)}) ${depsDead.length === 1 ? 'depends' : 'depend'} on this plan and ${deadTail(depsDead.length)}`);       // A-DRAFT
  return out;
}

export function buildAcceptPlan({ rootDir, rootId, stopArg, facts = {} }) {
  const record = readTreeRecord(rootDir);
  if (!record.tree || record.corrupt.length) return { refusal: `the record of this tree does not read (${record.corrupt.length} problem${record.corrupt.length === 1 ? '' : 's'}); nothing can be decided on it` };
  const state = stateOf(record);
  const open = state.openStops.map(id => { const m = state.stopMeta.get(id); return `${id} (${m?.source ?? 'a stop'}${m?.node ? `, ${m.node}@g${m.generation ?? 1}` : ''})`; });
  if (typeof stopArg !== 'string') return { refusal: `--accept-plan needs --stop <id>: the stop it answers${open.length ? ` (open: ${open.join(', ')})` : ' (no stop is open that this form answers)'}` };
  if (!state.openStops.includes(stopArg)) return { refusal: `--stop ${stopArg}: that is not an open stop${open.length ? ` (open: ${open.join(', ')})` : ' (no stop is open that this form answers)'}` };
  const runsDir = dirname(rootDir);
  // the preview of the event a person's answer would write: the gate does not exist yet, so the candidate carries a placeholder gate that is NEVER recorded (the real gate fields come in `apply`)
  const c = candidatePlanAccept(rootDir, { stopId: stopArg, actor: 'person', via: 'terminal', gate: { gateId: 'preview', shownSha256: '0'.repeat(64) }, runsDir });
  if (c.refusal) return { refusal: c.refusal };
  const f = c.facts; const n = f.node; const stop = f.stop;
  const key = `${stop.node}@g${stop.generation}`;
  const was = n.acceptedBy ? ` (this plan was already accepted once, by ${n.acceptedBy.actor === 'person' ? 'a person' : 'the session'}; that text is not kept, so only the change from the signed text can be shown)` : '';
  let change; let effectLine;
  if (f.revert) {
    change = 'This puts back the text the panel signed. The earlier acceptance is undone and the plan is the panel\'s again.';
    effectLine = 'the plan file is the text the panel signed, the stop is answered, and the record shows the earlier acceptance undone';
  } else {
    // THE BASELINE IS ALWAYS THE TEXT THE PANEL SIGNED (the audit copy kept when the node closed), shown only when the copy hashes to what the record holds for the close
    const dir = trustedRunDir(runsDir, stop.runId);
    const copy = dir.refusal ? { refusal: dir.refusal } : readRunFile(dir.dir, PLAN_COPY_FILE);
    const signed = typeof copy.text === 'string' && sha256Of(copy.text) === n.closedBodySha256 ? copy.text : null;
    if (signed !== null) {
      const diff = lineDiff(signed, f.text).join('\n');
      if (Buffer.byteLength(diff, 'utf8') > ACCEPT_SHOW_MAX_BYTES) return { refusal: `the change to ${key} is ${kb(Buffer.byteLength(diff, 'utf8'))} of difference, above the ${kb(ACCEPT_SHOW_MAX_BYTES)} this form can show, and nothing is accepted that was not shown. A plan changed that much cannot be accepted here: the answers are a new plan (council tree decide ${rootId} --stop ${stop.id}) or abandon (council tree decide ${rootId} --abandon)` };
      change = `Compared with the text the panel signed${was}:\n${indent(diff)}\n(- removed, + added)`;
    } else {
      if (f.bodyBytes > ACCEPT_SHOW_MAX_BYTES) return { refusal: `the changed plan of ${key} is ${kb(f.bodyBytes)}, above the ${kb(ACCEPT_SHOW_MAX_BYTES)} this form can show, and the text the panel signed is not kept to compare it with. Nothing is accepted that was not shown, so a plan that large cannot be accepted here: the answers are a new plan (council tree decide ${rootId} --stop ${stop.id}) or abandon (council tree decide ${rootId} --abandon)` };
      change = `The text the panel signed is not kept for this node, so no change can be shown${was ? ` (this plan was already accepted once, by ${n.acceptedBy.actor === 'person' ? 'a person' : 'the session'})` : ''}. The whole plan as the file reads now (${f.bodyBytes} bytes, sha256 ${f.acceptedBodySha256.slice(0, 12)}) follows:\n${indent(f.text)}`;
    }
    effectLine = 'the plan file stays as it is, the record holds it as the accepted plan, and the stop is answered';
  }
  const why = (stop.blockedBy ?? []).map(b => `  - ${b.code}: ${b.text ?? ''}`.trimEnd());
  const only = sessionOnlyLines(f.conditions, { rootId, stopId: stop.id });
  const text = f.revert
    ? `Put back the signed plan for ${key}?   (stop ${stop.id})
The plan file of ${key} was accepted as a changed plan earlier, and it is the text the panel signed again now. Why the tree stopped:
${why.join('\n') || '  (the stop names no reason)'}

${change}

Recording it: ${effectLine}. No money moves.

To approve, type the stop id: ${stop.id}
`
    : `Accept a changed plan for ${key}?   (stop ${stop.id})
The plan file of ${key} is not the text its panel signed. Why the tree stopped:
${why.join('\n') || '  (the stop names no reason)'}
Accepting means this file stands as the plan; the panel did not sign it.

${change}

What stays the same: the thin contract and the split are the ones the panel checked. The file holds no key-shaped string${f.piiOn ? ' and no personal-data-shaped string' : ''} that the tree's own checks would refuse.${only.length ? `\n\nA session could not accept this on its own, because:\n${only.map(l => `  - ${l}`).join('\n')}` : ''}

Recording it: ${effectLine}. \`council tree status\`, the tree handoff and the MCP tree status then say this plan was accepted by a person and not signed by the panel. No money moves.

To approve, type the stop id: ${stop.id}
`;
  return {
    text: terminalSafeMarked(text), expect: stop.id, typedLabel: 'the stop id', formName: `accept the changed plan of ${key} (stop ${stop.id})`,
    after: `${f.revert ? 'The plan is the panel\'s again' : 'The plan is accepted'} for ${key}; stop ${stop.id} is answered. Run \`council tree resume ${rootId}\` to go on; \`council tree status ${rootId}\` shows who accepted it.`,
    apply: ({ gateId, shownSha256, actor, via }) => acceptChangedPlan(rootDir, { stopId: stop.id, actor, via, gate: { gateId, shownSha256 }, runsDir, facts, expect: { acceptedBodySha256: f.acceptedBodySha256, previousBodySha256: f.previousBodySha256 } }),
  };
}
