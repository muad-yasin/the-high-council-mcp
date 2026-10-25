// A seat's lab is written into the file name of every stage that seat answers (panel-<round>-<lab>.md, propose-<lab>.usage.json, ...). A path separator, a lab that is exactly "." or ".." or a control character
// would let a chain file place those files outside the run folder (bug audit 24 Okt 2026, BUG-D-021), so chain-lint refuses such a lab and invoke() refuses to run a stage whose lab or label is one.
// The check names what is wrong, not an allow-list: a lab with spaces or "+" in an existing user chain stays valid.
// No imports: invoke() (chain.js) and chain-lint.js both read it.

const SEPARATOR = /[\\/]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/** null when `lab` can be part of a stage file name, else the words for what is wrong with it (one of the three the sentence below names). */
export function labProblem(lab) {
  if (typeof lab !== 'string') return null;   // a missing or odd lab is another check's finding
  if (SEPARATOR.test(lab)) return 'a path separator';
  if (CONTROL.test(lab)) return 'a control character';
  // Named by its own value (24 Okt 2026, FX-009): the sentence reads `which contains "."` for the lab "." and `which contains ".."` for "..".
  if (lab === '.') return '"."';
  if (lab === '..') return '".."';
  return null;
}

// eslint-disable-next-line no-control-regex
const shown = lab => String(lab).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);

/** The ONE sentence (lint finding and run-time refusal). `where` is `seats.<slot>` (or `a seat of this chain`) in the lint, `stage "<label>"` at run time. */
export const labUnsafeMessage = (where, lab, what) => `${where} names the lab "${shown(lab)}", which contains ${what} and so cannot be part of a file name. The lab is written into the stage file names of every run.`;

/** A plain lab to suggest in place of `lab`: every separator, control character and a name that is exactly "." or ".." replaced. */
export function labSuggestion(lab) {
  // eslint-disable-next-line no-control-regex
  const plain = String(lab).replace(/[\\/\u0000-\u001f\u007f]+/g, '-').replace(/^-+|-+$/g, '');
  return plain && plain !== '.' && plain !== '..' ? plain.slice(0, 40) : 'seat';
}

/** For invoke(): throws the sentence when the seat's lab or the stage label cannot be part of a file name. Nothing has been sent or paid at that point. */
export function assertStageLabelSafe(label, lab) {
  const labWhat = labProblem(lab);
  // controlFlow, like DeniedModel (src/denied-models.js): no catch around an invoke() may turn it into a seat's abstention and carry on (chain.js rethrowControlFlow).
  const refuse = (lab_, what) => Object.assign(new Error(labUnsafeMessage(`stage "${shown(label)}"`, lab_, what)), { controlFlow: true });
  if (labWhat) throw refuse(lab, labWhat);
  const labelWhat = labProblem(label);
  if (labelWhat) throw refuse(label, labelWhat);
}
