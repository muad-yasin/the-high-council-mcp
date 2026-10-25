// MCP tool `tree_decide` (SESSION CHANNEL, step 2c; plan Review/Build_0.8.3/m7/Channel_Plan_2026-10-19.md; C&C thcmcp-6d rulings 19 Okt 2026; the tool name and description are B-DRAFT, agent-facing public text).
// The controlling session answers a SUB-PLAN stop of a tree in two calls, over the same builders as `council tree decide`:
//   step "quote"  -> the exact text a person would read and its hash (marked model-written: it carries the stop's own text); nothing is decided;
//   step "answer" -> the hash back with the session's written reason: the text is rebuilt and must be the quoted one; the answer is recorded as the SESSION's (actor session, via mcp) with the reason.
// Never answered here, by design: a root re-plan, an obligation decision, top-up, cap, limits, close, abandon, restore, and every personal-data or key-scan answer. Those stay a person's, at a terminal.
import { RUN_FOLDER } from '../run-status.js';
import { trustedRunDir } from '../run-files.js';
import { readTreeRecord } from '../tree-record.js';
import { memberFolderRefusal } from './tree-members.js';
import { sessionFrontierAnswer, sessionFrontierQuote } from '../tree-approve-session.js';
import { sessionDraft } from '../tree-session-draft.js';
import { SESSION_FORMS, sessionDecideAnswer, sessionDecideQuote, sessionDefer, sessionPriceAnswer, sessionPriceQuote } from '../tree-decide-session.js';

export const TREE_DECIDE_UNTRUSTED_FIELDS = Object.freeze(['text']);
/** The TOOL_TRUST entry for `tree_decide`: the quoted text carries the stop's text, which a model wrote. */
export const treeDecideTrustRule = () => ({ wrap: 'fields', fields: [...TREE_DECIDE_UNTRUSTED_FIELDS] });
export const TREE_DECIDE_DESCRIPTION = `Answer a stop of a recursive-councils sub-plan as the controlling session, in two calls (for forms price and frontier the reason is the USER's own words, asked first). Call 1 (step "quote") returns the exact text a person would be shown and its hash; nothing is decided. Call 2 (step "answer") sends the hash back with your written reason; the answer is recorded as the session's, never as the person's. Forms for a stop: ${SESSION_FORMS.join(', ')}; forms price and frontier follow. When you cannot decide, step "defer" hands the stop to the person with named condition codes and your reason. A regenerate states planMode "fresh" or "data" with its reason; its quote shows the plan being replaced as data (not instructions) so you can read it before choosing, and "data" offers that plan to the writer of the new one. Form "price" adds or raises one model's price for every run in the project (model, inUsdPerM, outUsdPerM, a cited source) and only for the model a stopped member of this tree was refused for at its price limit; it never lowers a price and moves no money. For form "price": SHOW THE USER THE QUOTED TEXT AND GET THEIR YES IN THE CHAT BEFORE YOU CALL THE ANSWER, AND PASS THEIR WORDS AS reason (at the quote, reason is required by the schema but not recorded for a price: write "asking the user"); NEVER ANSWER A PRICE ON YOUR OWN (a higher price raises what every later call of that model is counted at). Form "frontier" (no stop, no text): SHOW THE USER THE QUOTED TEXT AND GET THEIR YES IN THE CHAT BEFORE YOU CALL THE ANSWER, AND PASS THEIR WORDS AS reason (at the quote, reason is required by the schema but not recorded for a frontier: write "asking the user"); NEVER APPROVE A FRONTIER ON YOUR OWN. It approves the next frontier of the tree only as a first approval of a split frontier (never a root re-plan, a frontier approved before or reopened, or the first children frontier of a re-planned root), when every child is admitted and gets its full ceiling, nothing is held back or unenforced, no money of unknown size is held and the grants fit the free amount; otherwise it is refused and the person approves it with "council tree approve". A root re-plan is a person's: for a stuck ROOT plan write the new decision with step "draft" (stop, text, reason; nothing is decided and nothing is spent). The person reads your draft in full at \`council tree decide\` and approves it by typing the stop id, so tell the user in the chat that it is waiting; a newer draft replaces an older one, and you can hand a stop over with step "defer" as well. A person may ask for a change at the terminal: it shows in tree_status as draftedStops[].changeAsked (the person's words, untrusted text); write a new draft from it. Money, close, abandon and personal-data answers are a person's and are refused.`;

const result = obj => ({ content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }] });

/** The tool's result for one call. */
export function treeDecideResult({ runsDir, work, args, now }) {
  const { run, step } = args ?? {};
  if (typeof run !== 'string' || !RUN_FOLDER.test(run)) return result({ error: 'no such run' });
  const t = trustedRunDir(runsDir, run);
  if (t.refusal) return result({ error: t.refusal });
  const record = readTreeRecord(t.dir);
  if (!record.exists) return result({ error: `run ${run} is not the root of a recursive-councils tree` });
  // CR-3B-001: the same containment check as `tree_status`, before ANY step: the readers below open the member folders the record registers.
  const unsafeMember = memberFolderRefusal(runsDir, record);
  if (unsafeMember) return result({ error: unsafeMember });
  if (step === 'defer') {
    const d = sessionDefer({ rootDir: t.dir, stop: args.stop, conditions: args.conditions, reason: args.reason });
    return result(d.refusal ? { error: d.refusal } : { recorded: d.recorded });
  }
  if (step === 'draft') {
    const w = sessionDraft({ rootDir: t.dir, rootId: run, stop: args.stop, text: args.text, reason: args.reason });
    return result(w.refusal ? { error: w.refusal } : { recorded: w.recorded, draft: w.draftId, bytes: w.bytes, sha256: w.sha256 });
  }
  if (args.form === 'frontier' && (step === 'quote' || step === 'answer')) {
    const fa = { rootDir: t.dir, work, reason: args.reason, gate: args.gate, shown: args.shown };
    if (step === 'quote') { const q = sessionFrontierQuote(fa, { now }); return result(q.refusal ? { error: q.refusal } : { gate: q.gateId, shown: q.shownSha256, expiresAt: q.expiresAt, text: q.text }); }
    const r = sessionFrontierAnswer(fa, { now }); return result(r.refusal ? { error: r.refusal } : { recorded: r.recorded });
  }
  if (args.form === 'price' && (step === 'quote' || step === 'answer')) {
    const pa = { rootDir: t.dir, runsDir, work, model: args.model, inUsdPerM: args.inUsdPerM, outUsdPerM: args.outUsdPerM, source: args.source, reason: args.reason, gate: args.gate, shown: args.shown };
    if (step === 'quote') { const q = sessionPriceQuote(pa, { now }); return result(q.refusal ? { error: q.refusal } : { gate: q.gateId, shown: q.shownSha256, expiresAt: q.expiresAt, text: q.text }); }
    const r = sessionPriceAnswer(pa, { now }); return result(r.refusal ? { error: r.refusal } : { recorded: r.recorded });
  }
  const a = { rootDir: t.dir, rootId: run, work, form: args.form, stop: args.stop, node: args.node, milestone: args.milestone, text: args.text, reason: args.reason, planMode: args.planMode, changesProvides: args.changesProvides, gate: args.gate, shown: args.shown };
  if (step === 'quote') {
    const q = sessionDecideQuote(a, { now });
    return result(q.refusal ? { error: q.refusal } : { gate: q.gateId, shown: q.shownSha256, expiresAt: q.expiresAt, text: q.text });
  }
  if (step === 'answer') {
    const r = sessionDecideAnswer(a, { now });
    return result(r.refusal ? { error: r.refusal } : { recorded: r.recorded, after: r.after });
  }
  return result({ error: 'step is "quote", "answer", "defer" or "draft"' });
}
