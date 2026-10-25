// The OLD PLAN AS DATA for a new plan's writer (bundle unit, step 2; Muad's direction 19 Okt 2026 via C&C: "why do you want to throw the entire sub-plan away instead of offering it as data to the draft writing seat?"; Muad's yes on the label sentence).
// The set-aside plan travels as ONE builder-only file in the new node's input bundle (`old-plan.md`): hashed with the bundle, counted by the size function at registration, NOT scanned for personal data or keys (Muad 19 Okt: it came out of a run whose own input was scanned), handed only to the BUILDER's prompt
// (never to a blind proposer or a critic: the member's CLI keeps it out of `request`). Whether it is attached is the PERSON'S choice at `tree decide` (data is the default, `--fresh` leaves it out); the choice is recorded on the decision_recorded event:
//   decision_recorded.oldPlan = { form: 'data', sha256, bytes } | { form: 'fresh' }
// `sha256` binds the attachment to the exact plan text the person's screen was about.
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { readTreeRecord } from './tree-record.js';
import { bundleDirOf } from './tree-continuation.js';
import { readPlanOf } from './tree-derive-load.js';
import { stripDeclined } from './draft-disputes.js';
import { OLD_PLAN_FILE } from './tree-bundle-input.js';
export { OLD_PLAN_FILE };

const sha256Of = t => createHash('sha256').update(t).digest('hex');

/**
 * The set-aside plan of a registered node, as the data file's text: the plan's delivered body without its declined/disputed lines (every reader of a builder's raw text goes through stripDeclined). -> { text, sha256, bytes } | { none: reason }.
 * `node` is a fold entry ({ runId, ... }) of the node whose plan is offered; the run folder is read the way every plan reader reads it (against the hash the record accepts for it).
 */
export function oldPlanOf({ rootDir, node }) {
  try {
    const read = readPlanOf(dirname(rootDir), node);
    if (!read.plan || typeof read.plan.text !== 'string' || !read.plan.text.trim()) return { none: 'the earlier plan cannot be read (no finished plan in its run folder)' };
    const text = stripDeclined(read.plan.text);
    return { text, sha256: sha256Of(text), bytes: Buffer.byteLength(text, 'utf8') };
  } catch (e) { return { none: `the earlier plan cannot be read (${e.message})` }; }
}

/**
 * THE ONE CHECK of an earlier plan: reads the plan of `node` (a fold entry) and sizes it against what the input already holds (`restBytes` of `maxBytes`, both optional). It is NOT scanned for personal data or keys (Muad, 19 Okt 2026: the plan came out of
 * a run whose own input was scanned; a plan the models wrote is not new input). -> { ok: true, text, sha256, bytes } | { ok: false, kind: 'unreadable'|'oversize', detail, bytes? }.
 */
export function checkOldPlan({ rootDir, node, restBytes = null, maxBytes = null }) {
  if (!node || typeof node.runId !== 'string') return { ok: false, kind: 'unreadable', detail: 'that node never ran, so there is no earlier plan' };
  const old = oldPlanOf({ rootDir, node });
  if (old.none) return { ok: false, kind: 'unreadable', detail: old.none };
  if (restBytes !== null && maxBytes !== null && restBytes + old.bytes > maxBytes) return { ok: false, kind: 'oversize', bytes: restBytes + old.bytes, detail: `about ${restBytes + old.bytes} bytes, over the ${maxBytes}` };
  return { ok: true, ...old };
}

/**
 * The person's choice about the earlier plan at `tree decide`: data is the DEFAULT, `--fresh` leaves it out. `restBytes`/`maxBytes`: what the new input already holds and may hold (root route; the size check). `lenient` (a sub-plan stop): a node that never ran or has no
 * readable plan has nothing to offer: fresh, with the reason. -> { refusal } | { oldPlan: { form:'fresh' } | { form:'data', sha256, bytes }, text?, note? }. All sentences are A-DRAFT.
 */
export function chooseOldPlan({ rootDir, node, fresh = false, lenient = false, restBytes = null, maxBytes = null, raiseHint = null, paidNote = '' }) {
  if (fresh) return { oldPlan: { form: 'fresh' } };
  const c = checkOldPlan({ rootDir, node, restBytes, maxBytes });
  if (c.ok) return { oldPlan: { form: 'data', sha256: c.sha256, bytes: c.bytes }, text: c.text };
  if (c.kind === 'unreadable' && lenient) return { oldPlan: { form: 'fresh' }, note: c.detail };
  if (c.kind === 'unreadable') return { refusal: `${c.detail}: run the command again with --fresh to plan without it` };
  if (raiseHint) return { refusal: `the new plan's input would be ${c.detail} this tree's approval was priced for. Two ways on: give a shorter decision or leave the earlier plan out with --fresh;${raiseHint(c.bytes)}.${paidNote}` };
  return { refusal: `the new plan's input would be ${c.detail} this tree's approval was priced for: give a shorter decision, or run the command again with --fresh to leave the earlier plan out${paidNote}` };
}

/**
 * What a tree MEMBER reads of the earlier plan: the bundle's own old-plan.md (the member is started on that folder and its identity was checked a step before: src/tree-member.js memberPreflight), and the allowance the opening decision recorded,
 * counted only for this very text. -> null (no earlier plan for this node) | { text, allow }.
 */
export function memberEarlierPlan({ rootDir, lineage }) {
  const file = join(bundleDirOf(rootDir, lineage.node, lineage.generation), OLD_PLAN_FILE);
  if (!existsSync(file)) return null;
  // fail CLOSED: the person approved this plan as data; a start that cannot read it, or its decision, must not run quietly without it
  try {
    const text = readFileSync(file, 'utf8');
    const record = readTreeRecord(rootDir);
    const opened = record.events.find(e => e.event === 'generation_opened' && e.nodes.some(n => n.node === lineage.node && n.generation === lineage.generation));
    const decision = opened ? record.events.find(e => e.event === 'decision_recorded' && e.id === opened.decisionId) : null;
    if (decision?.oldPlan?.form !== 'data') return { error: `the bundle of ${lineage.node}@g${lineage.generation} holds an earlier plan (${OLD_PLAN_FILE}) but the decision that opened it does not record offering one` };
    if (sha256Of(text) !== decision.oldPlan.sha256) return { error: `the earlier plan in the bundle of ${lineage.node}@g${lineage.generation} is not the text your decision was about` };
    return { text };
  } catch (e) { return { error: `the earlier plan of ${lineage.node}@g${lineage.generation} cannot be read (${e.message})` }; }
}

/**
 * SLOT ROUTE: the earlier plan for the node@generation a derivation is about, or null. A regenerate decision that recorded `oldPlan.form === 'data'` offers the plan of the node whose stop it answered to the NEW plan of that same slot (when the stopped node is reused finished work, the slot it fills: `oldPlan.node`, fixed at decide). Read from the record and the stopped run's folder, checked against the sha256 the person's screen was about. -> null | { text, node, generation, allow } | { refusal }.
 */
export function slotEarlierPlan({ rootDir, record, state, node, generation }) {
  for (const ev of record.events) {
    if (ev.event !== 'generation_opened' || !ev.nodes.some(n => n.node === node && n.generation === generation)) continue;
    const d = record.events.find(x => x.event === 'decision_recorded' && x.id === ev.decisionId);
    if (!d || d.oldPlan?.form !== 'data' || d.replansRoot === true || !d.stopId) continue;
    const sm = state.stopMeta.get(d.stopId);
    if (!sm || !sm.node || sm.node === 'R') continue;
    const srcKey = `${sm.node}@g${sm.generation}`;
    if ((d.oldPlan.node ?? sm.node) !== node) continue;       // the target was fixed at decide (the adoption has lapsed by now)
    const old = oldPlanOf({ rootDir, node: state.nodes.get(srcKey) });
    if (old.none || old.sha256 !== d.oldPlan.sha256) return { refusal: `the earlier plan of ${srcKey} is not the text your decision ${d.id} was about (${old.none ?? 'its text changed'})` };
    return { text: old.text, node: sm.node, generation: sm.generation };
  }
  return null;
}
