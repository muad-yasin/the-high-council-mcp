// The cache-shaped prompt order of a judge call (0.8.4 cache part (b)1). THE POINT: a prompt cache reads only an identical beginning, so every judge call of one seat in one pass must start with the same text: the same system
// text (the Council welcome, then the seat's persona block, if it has one) and the same first user block H (the request, the criteria, the checks block, the draft and, when the draft boundary is on, its lines). What differs
// between call kinds (the instructions that used to sit in the system text, then the round's own material) comes after H.
//
// ORDER, in the recorded state: system = welcome + persona block; user = H, [the excerpt block, placed by invoke() directly under H], the lead-in (held name `judgeKindLeadIn`), the call kind's instructions, the round's own material, the closing sentence.
// The instructions are MOVED, not rewritten: they are the system text the call used to send (composed by the same functions as before), less the welcome and less the persona block.
//
// WHEN: the chain's prompt_cache switch is on AND the batch of words is recorded in src/roles.js (until then held names, test data in test/held-prompts/held-084-cache-order.js; src/cache-order-gate.js ORDER_WORDS) AND the seat is not a session seat.
// `cacheOrderSeat` is the ONE predicate that decides which seats get the new order; every reader asks it. Off: the very same bytes as before.
//
// This file holds no prompt words and no prompt wording: the lead-in comes from held(), the instructions from the composers in src/stage-system.js.
import * as R from './roles.js';
import { held } from './held-roles.js';
import { cacheOrderSeat } from './cache-order-gate.js';
import { withoutNotes } from './persona-record.js';
import { withoutPersonaBlock, judgeSystemR1, systemTextsFor } from './stage-system.js';
import { setMockInstructionsFinder } from './providers.js';

/** The call kinds a lead-in is written for: the blind review (also the first-mode critic and the final read), the exchange post, the exchange answer. */
export const CALL_KINDS = Object.freeze(['panel', 'post', 'answer']);

// The mock provider (MOCK ONLY) finds a judge's instructions in the user text through this: the start of the earliest lead-in, or -1 where the order is not live.
setMockInstructionsFinder(user => {
  const lead = held('judgeKindLeadIn');
  if (typeof lead !== 'function') return -1;
  const at = CALL_KINDS.map(kind => user.indexOf(lead({ kind }))).filter(i => i >= 0);
  return at.length ? Math.min(...at) : -1;
});

/** A layout problem is a bug of the harness, never a model's fault: control flow (rethrowControlFlow), so it stops the run instead of reading as a judge's silence. */
const fail = message => Object.assign(new Error(`cache-shaped prompt order: ${message} (nothing was sent)`), { controlFlow: true });

// The gate lives in src/cache-order-gate.js (the cost estimate reads it without importing this file); re-exported here for the layout's callers.
export { cacheOrderOn, cacheOrderSeat, orderNote, ORDER_WORDS, markTtlOf, exchangeLayerOf } from './cache-order-gate.js';

/** The lead-in of a call kind (heading line and sentence), '' where the order is not live for the seat. */
export function leadInOf(config, seat, kind) {
  if (!cacheOrderSeat(config, seat)) return '';
  if (!CALL_KINDS.includes(kind)) throw fail(`unknown call kind ${JSON.stringify(kind)}`);
  const text = held('judgeKindLeadIn')({ kind });
  if (typeof text !== 'string' || text === '') throw fail(`the lead-in of the call kind ${kind} is empty`);
  return text;
}

/**
 * H for every call kind (C&C, 10 Nov 2026: ONE kind-neutral wording in H, never a variant per kind), BUILT FROM THE ARGUMENTS the verdict prompts' head is built from, never found by a text search of the assembled head (the repo's rule for the head, src/prompts/core.js
 * criticUserHead: a request, a criterion or a check that holds the very text of a heading and a sentence would be edited instead of the real ones; FIX 1 of Helper B's review of 10 Nov 2026). `cu` is the arguments object of the call site ({ request, criteria, draft, checks, endMarker }),
 * where `draft` is the BOUNDED draft (src/draft-bounds.js boundedDraft: the sentence, the start line, then the draft). Where the draft boundary is on, the recorded end line and boundary sentence say "the draft you grade", which a post does not do; the order puts their
 * kind-neutral variants in their place: the sentence is swapped at the one place it sits by construction (the very start of `cu.draft`, which the head puts directly under its own heading), the end line is the head's last line. Boundary off: the head as it is.
 */
export function neutralHeadOf(cu) {
  if (!cu || !cu.endMarker) return R.criticUserHead(cu);
  const sentence = held('draftBoundarySentence')?.();
  const start = held('draftStartLine')?.();
  const prefix = `${sentence}\n\n${start}\n\n`;
  if (typeof sentence !== 'string' || sentence === '' || typeof start !== 'string' || typeof cu.draft !== 'string' || !cu.draft.startsWith(prefix)) throw fail('with the draft boundary on, the draft handed to the head does not start with the boundary sentence followed by the start line');
  const neutral = held('draftBoundarySentenceNeutral')?.();
  if (typeof neutral !== 'string' || neutral === '') throw fail('the kind-neutral boundary sentence is empty');
  const body = R.criticUserHead({ ...cu, draft: `${neutral}\n\n${start}\n\n${cu.draft.slice(prefix.length)}`, endMarker: false });
  return `${body}\n\n${held('draftEndLineNeutral')()}`;
}

/**
 * The prompt of one judge call. `compose()` returns the system text the call sends TODAY (with its persona block); `user` is the user text the call sends today, which starts with `userHead` (the head its own builder
 * made); `head` is H, the shared first block of this pass (R.criticUserHead of the pass's arguments). Not live for the seat: { system: compose(), user } and nothing else, byte for byte (compose is called once, as it always was). Live: { system, user, head, laid: true } (compose is called once more, without the persona block and without leaving a note).
 */
export function judgePrompt({ config, seat, kind, compose, user, head, userHead = head, endMarker = false, headArgs }) {
  if (!cacheOrderSeat(config, seat)) return { system: compose(), user };
  const welcome = R.COUNCIL_INTRO;
  const lead = leadInOf(config, seat, kind);
  const composed = withoutNotes(() => withoutPersonaBlock(compose));
  if (typeof composed !== 'string' || !composed.startsWith(`${welcome}\n\n`)) throw fail('the system text of a judge call no longer starts with the Council welcome, so its instructions cannot be moved');
  if (typeof head !== 'string' || head === '' || typeof userHead !== 'string' || !user.startsWith(userHead)) throw fail('the first block of the user text is not the head that was named (a call-site error)');
  // the kind-neutral H is BUILT from the arguments the head itself is built from (neutralHeadOf), and those arguments must give exactly the head that was named: the rest of the user text is cut off after that head, so a call site whose arguments differ would send a wrong H
  // and nothing else would notice
  if (endMarker && (!headArgs || typeof headArgs !== 'object')) throw fail('a call with the draft boundary on did not hand over the arguments of its head (a call-site error)');
  if (endMarker && R.criticUserHead(headArgs) !== head) throw fail('the arguments handed over for the head do not build the head that was named (a call-site error)');
  const shared = endMarker ? neutralHeadOf(headArgs) : head;
  const system = judgeSystemR1(seat, config);
  // shownSystem = the instructions block exactly as the user message carries it (a repair request shows it as the reply format)
  return { system, user: `${shared}\n\n${lead}\n\n${composed.slice(welcome.length + 2)}${user.slice(userHead.length)}`, head: shared, laid: true, shownSystem: composed.slice(welcome.length + 2) };
}

/** The row label whose system texts (the estimator's, src/stage-system.js RULES) a call kind sends: the same composers the send uses. */
const ROW_OF_KIND = Object.freeze({ panel: 'panel-1-x', post: 'ldebate-1-x', answer: 'lreply-1-x' });

/**
 * The run-start check (like assertEndingPrompts): for every judge seat of a chain whose order is live, every call kind's system texts (all the variants a run can send) are composed once, before the first paid call, so a layout problem
 * stops the run before it spends. It sends nothing and leaves no persona note. A chain whose order is not live builds nothing.
 */
export function assertCacheOrder(config) {
  const critics = Array.isArray(config?.seats?.critics) ? config.seats.critics : [];
  for (const seat of critics.filter(c => c && cacheOrderSeat(config, c))) {
    for (const kind of CALL_KINDS) {
      for (const text of withoutPersonaBlock(() => systemTextsFor(ROW_OF_KIND[kind], config, seat))) {
        if (!text.startsWith(`${R.COUNCIL_INTRO}\n\n`)) throw fail(`the ${kind} system text of the seat ${seat.lab || seat.model} does not start with the Council welcome`);
      }
      leadInOf(config, seat, kind);
    }
  }
}
