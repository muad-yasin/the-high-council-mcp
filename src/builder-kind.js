// 0.8.4 D22 (plan A T3.3, settled item 6): the chain key `builder_kind` says what kind of session builds from the plan. Two values: "session" (the default, and what an unset key means) and "one_shot" (a sandboxed build
// session that can neither send a blocker back to a person nor run `council` commands). Pure and offline.
//
// The switch branches only on "one_shot" and never rewrites a shared string: with the key unset, "session" or anything else, every prompt is byte for byte what it was (test/builder-kind-bytes.test.js). Under "one_shot" the
// SEAT-WRITTEN half of the handoff changes (src/handoff-prompt.js): the handoff seat's prompt loses "the one line a human types to start it", its dependency paragraph's "If it cannot check, it stops and asks the person."
// is replaced, and one note is added that the build session works alone. The words of the replacement and of the note are A-DRAFT and held (test/held-prompts/held-084-a.js); until src/roles.js records BOTH, "one_shot" is
// inert: the same text as "session". The HARNESS half (the "Before you build" and "Replan triggers" blocks, src/handoff-contract-text.js builderSection) has its own held words, `oneShotHarnessWords()` below, and is inert the same
// way until all of them are recorded; the two halves are recorded together (the lane A batch is all-or-none), which closes the release-order hazard of a seat note that says "works alone" over a harness block that says
// "send the blockers back".
import { held } from './held-roles.js';

export const BUILDER_KINDS = ['session', 'one_shot'];

/** 'one_shot' only for exactly that value; an unset key, "session" and anything else read as 'session' (chain-lint refuses the rest before a run). */
export const builderKindOf = config => (config?.builder_kind === 'one_shot' ? 'one_shot' : 'session');

const WORDS = { dependencyEnd: 'oneShotDependencyEnd', handoffNote: 'oneShotHandoffNote' };

/** The two held sentences as { dependencyEnd, handoffNote }, or null while src/roles.js has not recorded both. */
export function oneShotWords() {
  const out = {};
  for (const [key, name] of Object.entries(WORDS)) {
    const f = held(name);
    if (typeof f !== 'function') return null;
    const text = f();
    if (typeof text !== 'string' || !text) return null;
    out[key] = text;
  }
  return out;
}

/** The words to apply for this chain, or null: the switch is off, or its held words are not recorded yet. */
export const oneShotFor = config => (builderKindOf(config) === 'one_shot' ? oneShotWords() : null);

// The HARNESS half's held words (plan A T3 wording; STEP3 A1): item 1's closing sentences, the replan triggers' lead line and the build session's "Assumptions" report paragraph.
const HARNESS_WORDS = { itemOneClosing: 'oneShotItemOneClosing', replanLead: 'oneShotReplanLead', assumptionsReport: 'oneShotAssumptionsReport' };

// The gaps list's parenthetical (STEP3 A8, D26's piece) has its OWN held word and its own gate, so that recording or not recording it never moves the three above: `oneShotGapsTail()` is the sentence or null.
export function oneShotGapsTail() {
  const f = held('oneShotGapsTail');
  const text = typeof f === 'function' ? f() : null;
  return typeof text === 'string' && text ? text : null;
}

/** The held sentences as { itemOneClosing, replanLead, assumptionsReport }, or null while src/roles.js has not recorded all of them. */
export function oneShotHarnessWords() {
  const out = {};
  for (const [key, name] of Object.entries(HARNESS_WORDS)) {
    const f = held(name);
    if (typeof f !== 'function') return null;
    const text = f();
    if (typeof text !== 'string' || !text) return null;
    out[key] = text;
  }
  return out;
}

// The two forms of the handoff seat's prompt write the start line with and without a comma (default form: "(scope outside the plan), and the one line ..."; milestone form: "(scope outside the plan) and the one line ...").
// ONE pattern covers both and must match exactly once; the dependency sentences must occur exactly once too (a second copy would survive a plain replace).
const START_LINE = /,? and the one line a human types to start it/g;
const DEPENDENCY_SPAN = 'If it cannot check, it stops and asks the person. It never treats this list as already checked.';

/**
 * The handoff seat's system text for a one-shot build session: the start line removed, the dependency paragraph's ask-the-person sentences replaced, the note appended. A span that is not in `system` exactly once THROWS: a
 * changed prompt must not silently skip a removal the switch promises.
 */
export function oneShotSeatSystem(system, words) {
  const text = String(system);
  const starts = (text.match(START_LINE) || []).length;
  if (starts !== 1) throw new Error(`builder_kind one_shot: the handoff prompt must carry the start line once (found ${starts}), so the switch cannot remove it`);
  const deps = text.split(DEPENDENCY_SPAN).length - 1;
  if (deps !== 1) throw new Error(`builder_kind one_shot: the handoff prompt must carry the dependency paragraph's ask-the-person sentences once (found ${deps}), so the switch cannot replace them`);
  return `${text.replace(START_LINE, () => '').replace(DEPENDENCY_SPAN, () => words.dependencyEnd)}\n\n${words.handoffNote}`;
}
