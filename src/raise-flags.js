// The raise flags of the command line (0.8.4, S20 slice 1, H2-i): which combinations of --raise-cap and --relayed are refused, decided from values the caller already has. PURE: no gate, no file, no clock; src/cli.js is the one
// caller and prints the sentence, so the refusal can sit BEFORE anything is written (the run folder, the lock, run.json). Kept out of src/run-controls.js (which imports the gate) because this is flag logic and not a recording.
/**
 * The refusal of the raise flags, decided BEFORE anything is written (the run folder, the lock, run.json): a refusal that says "Nothing was recorded, run or spent" must be true. `--raise-cap` answers a paused run; `--relayed`
 * goes with it; under the per-provider caps the cap is named or the stop names it; a run with no spending limit has nothing to raise; and a raise goes alone: an overseer-round choice (--continue, --finish, --next-pass-layer-3)
 * given with it would be recorded while the raise is still unanswered, a choice the person did not make under the limit he asked for.
 */
/** The one refusal that holds in ANY run state and so can come first, beside the --next-pass-layer-3 refusals and before the --continue / --finish ones: a raise goes alone. */
export function raiseChoiceRefusal({ argv }) {
  if (!argv.includes('--raise-cap')) return null;   // --relayed alone is refused later with its own sentence (it goes with --raise-cap)
  const choice = ['--continue', '--finish', '--next-pass-layer-3'].find(f => argv.includes(f));
  return choice ? `${choice} cannot go with --raise-cap: a raise is asked for alone. Answer the raise first, then give ${choice} on the resume that follows.` : null;   // A-DRAFT
}

/**
 * S20 slice 2 (control 1): `--next-pass-layer-3` on a resume goes alone, like a raise. It only RECORDS a request and exits (src/run-controls.js requestRoute), so any other option on the command line would be dropped without a word. The command line may hold only
 * `--resume <run folder>`, the flag and, when the handler session relays the request, `--person-words "<the person's answer>"`. ARGV-BASED, like raiseChoiceRefusal. null when it is fine or when the command is not a resume (the start case keeps its own sentence).
 */
export function routeFlagRefusal({ argv }) {
  // R2-tty (Mini-C&C R422): `--person-words` is read by this flag and by the verbs that dispatch before the main path (route-decide, pause, relay-answer); on anything else it would be dropped without a word, like `--route` and `--reason`.
  if (!argv.includes('--next-pass-layer-3')) return argv.includes('--person-words') ? '--person-words: an option of `--next-pass-layer-3` on a resume (the handler session relays the person\'s request to start the next pass at layer 3) and of `council route-decide`, `council pause` and `council relay-answer` only.' : null;   // A-DRAFT
  const at = argv.indexOf('--resume');
  if (at < 0) return null;
  const words = argv.indexOf('--person-words');   // the one other option a route request takes: the person's words, when the handler session relays the request
  const other = argv.find((a, i) => a !== '--next-pass-layer-3' && a !== '--resume' && a !== '--person-words' && i !== at + 1 && !(words >= 0 && i === words + 1));
  return other === undefined ? null : `${other} cannot go with --next-pass-layer-3: a route request is recorded alone. Give ${other} on the resume that follows the decision.`;   // A-DRAFT
}

export function raiseFlagRefusal({ argv, resumeMeta, capsArmed, raiseCapId, stopCap, capGateApplies, capsRaiseUnknownSentence, capsRaiseNameSentence }) {
  const raise = argv.includes('--raise-cap'); const relayed = argv.includes('--relayed');
  if (!raise && !relayed) return null;
  if (!resumeMeta) return '--raise-cap answers a paused run: use it with --resume <run folder>.';   // A-DRAFT (as the prototype had it)
  if (relayed && !raise) return '--relayed goes with --raise-cap on a resume.';   // A-DRAFT
  const choice = raiseChoiceRefusal({ argv });
  if (choice) return choice;
  if (capsArmed.length) {
    if (raiseCapId !== null) return capsArmed.includes(raiseCapId) ? null : capsRaiseUnknownSentence(raiseCapId, capsArmed);
    return stopCap ? null : capsRaiseNameSentence(capsArmed);
  }
  if (!capGateApplies) return '--raise-cap: this run has no spending limit to raise (its seats cost nothing, or it is a tree member).';   // A-DRAFT
  return null;
}
