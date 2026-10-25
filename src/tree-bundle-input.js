// The registration pre-check (0.8.3 M6 S5b part B, c3a; contract Review/Build_0.8.3/m6-closing/S5b_PII_Gate_And_Registration_Precheck_Contract.md sections 5-9, half page Review/Build_0.8.3/M6_S5b_Record_Side_HalfPage_2026-10-12.md with
// C&C's rulings): a child's derived input (task.md, context.md, criteria.json) is asked the SAME questions its run will ask at its own start - the outbound key scan (every shape, the reserved placeholder hosts exempt) and, when the
// tree carries the personal-data mode 'hard-stop', the PII gate - BEFORE the child is registered. A child that would be refused at its start was, until now, registered and then refused on every sitting (exit 11), with no run folder and
// no stop to answer: stranded. Now nothing is registered and a person gets a stop.
//
//   bundleInputCheck({ files, carrierSpans, piiMode, allow, allowOnly }) -> { findings: [{ file, line, name }], carriers: [{ node, generation }], parentOwned }   (empty findings = the input is clean). Pure.
//        `findings` name the shape and the place, NEVER the value (a key scan finding is { where, line, name }; a PII finding is { type, line, column, pattern? }: both become { file, line, name }; the PII name is `pii:<type>[:<pattern>]`).
//        `carriers` = the finished nodes whose text the finding sits in (derive's `carrierSpans` say whose text each stretch of context.md is); `parentOwned` = at least one finding sits in text the PARENT owns (its split entry,
//        its plan sections, its criteria, the task, a decision text): the parent is then a carrier too.
//   openBundleInputStop(rootDir, { child, parent, found, facts, now }) -> { kind: 'stop_opened', node, generation, stop } | { kind: 'refused', node, check, detail }
//        ONE lock hold: the affected set is built from the record as it is NOW, and `needs_decision_opened { source: 'bundle_input' }` is appended (no runId, nothing registered, $0). The stop is recorded on the CHILD when no carrier is the
//        ROOT; when the root's own text carries it the stop is recorded on the ROOT (node 'R', the live generation; `child` names the unregistered node), so the S8 machinery answers it with a new root plan.
import { dirname } from 'node:path';
import { piiGateReport, textSecretFindings } from './run-preflight.js';
import { TreeRefusal, appendTreeEventLocked, readTreeRecord, stateOf, withTreeLock } from './tree-record.js';
import { affectedFor } from './tree-affected.js';
import { bundleInputBytes } from './tree-budget.js';
import { treePiiAllowFrom } from './tree-pii-mode.js';
import { rootTaskPinFrom } from './tree-task-pin.js';
import { latestGenerationOf } from './tree-transitions.js';

export const OLD_PLAN_FILE = 'old-plan.md';       // the builder-only earlier plan (src/old-plan.js): counted in the size, NEVER scanned (Muad 19 Okt: it came out of a run whose own input was scanned)
const FILES = ['task.md', 'context.md', 'criteria.json'];           // what the member's start reads: the task, the context documents, the --criteria file (src/cli.js 2192-2205)

const lineStarts = text => { const out = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') out.push(i + 1); return out; };

/**
 * C&C ruling (19 Okt 2026): the root allowance covers the root TASK TEXT wherever the TREE CODE copied it verbatim, so a child's context.md section 2 (derive's `rootTaskSpans`) is covered, while model-written text that holds the
 * same address (a child's scope, a provider's text, a parent-plan section) is not. Bytes, never the value. -> { types, spans }; empty unless the tree records an allowance, pins its task, and the task the derivation read is the pinned one.
 */
export function rootTaskCoverage(tree, derived) {
  const a = treePiiAllowFrom(tree); const pin = rootTaskPinFrom(tree);
  if (a.status !== 'on' || pin.status !== 'ok' || !derived || derived.rootTaskHash !== pin.pin.taskHash) return { types: [], spans: [] };
  return { types: a.types, spans: Array.isArray(derived.rootTaskSpans) ? derived.rootTaskSpans : [] };
}

export function bundleInputCheck({ files, carrierSpans = [], piiMode = { status: 'off' }, allow = [], allowOnly = null, rootCover = { types: [], spans: [] }, maxBytes = null }) {
  const findings = [];
  // BUNDLE UNIT (19 Okt 2026): the input is bigger than the size its approval was priced for (tree.json bundleAllowanceBytes): a finding like any other, so the SAME stop (close it, or re-plan it) answers it and nothing is registered. Counted over EVERY file of the map.
  if (maxBytes !== null) { const bytes = bundleInputBytes(files); if (bytes > maxBytes) findings.push({ file: '(whole input)', line: null, name: `oversize: ${bytes} bytes, over the ${maxBytes} its approval was priced for` }); }
  for (const file of FILES) if (typeof files[file] === 'string') for (const f of textSecretFindings(files[file], file)) findings.push({ file, line: f.line, name: f.name });
  // the PII gate: only 'hard-stop' refuses. 'warn' never refuses a run, so it never keeps a child from registering (the member writes its own WARNINGS.md); the run scans the task and context documents, not criteria.json
  if (piiMode.status === 'on' && piiMode.mode === 'hard-stop') {
    // `allowOnly` = the files the allowance covers (the ROOT's covers task.md only, C&C ruling (c)); null = all of them (a child's own allowance)
    const allowFor = f => (allowOnly === null || allowOnly.includes(f) ? allow : []);
    const reports = ['task.md', 'context.md'].map(f => piiGateReport({ mode: 'hard-stop', allow: allowFor(f), sources: [[f, files[f]]], forTree: true }));
    const ctxStarts = typeof files['context.md'] === 'string' ? lineStarts(files['context.md']) : [];
    const covered = f => f.where === 'context.md' && rootCover.types.includes(f.type) && rootCover.spans.some(s => ctxStarts[f.line - 1] >= s.from && ctxStarts[f.line - 1] < s.to);
    const kept = reports.map(x => ({ ...x, findings: x.findings.filter(f => !covered(f)) }));
    const report = { blocked: kept.some(x => x.findings.length), findings: kept.flatMap(x => x.findings) };   // `allow`: the types a person allowed for THIS child after seeing them (state.piiAllowed), nothing else
    if (report.blocked) for (const f of report.findings) findings.push({ file: f.where, line: f.line, name: `pii:${f.type}${f.pattern ? `:${f.pattern}` : ''}` });
  }
  findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : (a.line ?? 0) - (b.line ?? 0) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
  const starts = typeof files['context.md'] === 'string' ? lineStarts(files['context.md']) : [];
  const carriers = new Map(); let parentOwned = false;
  for (const f of findings) {
    const at = f.file === 'context.md' ? starts[f.line - 1] : undefined;
    const span = at === undefined ? undefined : carrierSpans.find(s => at >= s.from && at < s.to);
    if (span) carriers.set(`${span.node}@g${span.generation}`, { node: span.node, generation: span.generation });
    else parentOwned = true;
  }
  return { findings, carriers: [...carriers.values()].sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.generation - b.generation)), parentOwned };
}

/**
 * Opens the stop for a child that could not be registered. `child` = { node, generation }, `parent` = { node, generation }, `found` = bundleInputCheck's answer. -> see the header.
 */
export function openBundleInputStop(rootDir, { child, parent, found, facts, now }) {
  const carriers = [...found.carriers];
  if (found.parentOwned && !carriers.some(c => c.node === parent.node)) carriers.push({ node: parent.node, generation: parent.generation });
  try {
    return withTreeLock(rootDir, () => {
      const record = readTreeRecord(rootDir); const state = stateOf(record);
      const runsDir = dirname(rootDir);
      const rootCarries = carriers.some(c => c.node === 'R');
      let affected;
      if (rootCarries) affected = [{ node: 'R', generation: latestGenerationOf(state, 'R') }];     // the whole plan is replaced: a new root plan answers it
      else {
        affected = affectedFor({ record, state, runsDir, node: carriers[0].node, generation: carriers[0].generation, obligationCarriers: carriers.slice(1) }).affected;       // C2b-ob: carriers are nodes (path, generation), mapped to their places inside
      }
      if (!affected.some(a => a.node === child.node && a.generation === child.generation)) affected = [...affected, { node: child.node, generation: child.generation }];
      const onRoot = rootCarries;
      const event = {
        event: 'needs_decision_opened', source: 'bundle_input',
        node: onRoot ? 'R' : child.node, generation: onRoot ? latestGenerationOf(state, 'R') : child.generation,
        ...(onRoot ? { child: { node: child.node, generation: child.generation } } : {}),
        parent: { node: parent.node, generation: parent.generation }, findings: found.findings, carriers, affected,
      };
      const stop = appendTreeEventLocked(rootDir, event, { facts, now });
      return { kind: 'stop_opened', node: child.node, generation: child.generation, stop };
    });
  } catch (e) {
    if (!(e instanceof TreeRefusal)) throw e;
    return { kind: 'refused', node: child.node, check: e.code, detail: e.reason };       // another sitting registered the child, or opened the stop, between our read and the lock: nothing was written
  }
}

/**
 * T-b (19 Okt 2026): the person's allowance for a child whose input holds personal data, after seeing where. ONE `bundle_input_allowed` under the tree lock; it answers the open `bundle_input` stop it names in the same event. The gate's approval is
 * already used by the caller. The table re-checks everything (the stop is still open and about this child, the types are among those the stop found, no key-shaped finding, the child is still unregistered); a refusal throws a TreeRefusal.
 */
export function allowBundleInput(rootDir, { node, generation, stopId, types, gateId, shownSha256, actor, via } = {}, { facts = {}, now } = {}) {
  if (typeof gateId !== 'string' || !gateId || typeof shownSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(shownSha256)) throw new TypeError('allowBundleInput: gateId and shownSha256 (64 hex) are required');
  return withTreeLock(rootDir, () => appendTreeEventLocked(rootDir, { event: 'bundle_input_allowed', node, generation, stopId, types, gateId, shownSha256, actor, via }, { facts, now }));
}
