// The personal-data mode of a recursive-councils tree (0.8.3 M6 S5b part A; contract Review/Build_0.8.3/m6-closing/S5b_PII_Gate_And_Registration_Precheck_Contract.md section 3): `council tree start --pii-gate warn|hard-stop` records
//   piiGate: 'warn' | 'hard-stop'
// in tree.json, and tree.json is the ONE source every member of the tree is held to (the starter hands the mode to each member's CLI; the member's start compares what it was given with this; a registration pre-check applies it to a
// member's input before the member exists). This file only READS the field; src/tree-record.js createTreeFile writes it.
//
// Contract: treePiiModeFrom(tree) -> { status: 'off' } | { status: 'on', mode: 'warn' | 'hard-stop' } | { status: 'unusable', reason }. Never throws.
//   no field on an object        -> off. True of every tree written before this slice and of a tree started without the flag: they ran with the gate off (tree.json stays schema tree/1; the field is additive and optional)
//   'warn' / 'hard-stop'         -> on
//   anything else, or `tree` itself not an object -> unusable. A member start is REFUSED on it (src/tree-member.js, A's): FAIL CLOSED. This is the opposite of the root task pin (src/tree-task-pin.js), where "unknown" is
//   harmless; here reading damage as "off" would run a tree's children with the gate off. The mode words are exactly the CLI's own (`--pii-gate warn|hard-stop`): no other case, no padding, no `off`.
// Persistence (backend-developer checklist): the state is persisted in tree.json, never edited after the tree is started (createTreeFile refuses to overwrite); a tree.json without it reads as off (goldens in
// test/fixtures/tree-json/); a damaged value reads as unusable. How a damage can arise: createTreeFile refuses a bad mode, and a hand edit of tree.json is caught by the record's own hash check (readTreeRecord compares tree.json with the hash tree_started recorded and reports it as corrupt), so the `unusable` branch is defence in depth - reached only through a writer bug or a forged tree_started - and it still fails closed. Whether a verb keeps working on a record that readTreeRecord calls corrupt is not decided here.
// T-b (19 Okt 2026): the same file reads the optional `piiAllow` (the root task's allowance, written by `tree start --allow-pii`); a sub-plan's allowance is a tree EVENT (bundle_input_allowed), not a tree.json field.
// 19 Okt 2026 (C&C): a tree with NO field is still read as "off" HERE (a record is never rewritten), but every input check and every member's own scan now asks it as hard-stop (treeInputScanModeFrom; cli.js): no released tree lacks a mode.
// This file reads no file, clock or environment variable.

/** The PII gate modes a tree may carry: the CLI's own words (src/cli.js --pii-gate). */
export const TREE_PII_MODES = Object.freeze(['warn', 'hard-stop']);

/** Why a value is not a usable mode, or null. Pure. */
export function piiModeProblem(x) {
  return typeof x === 'string' && TREE_PII_MODES.includes(x) ? null : `piiGate must be exactly "warn" or "hard-stop", not ${typeof x === 'string' ? JSON.stringify(x.slice(0, 40)) : Array.isArray(x) ? 'an array' : x === null ? 'null' : typeof x}`;
}

/** What tree.json says about the tree's personal-data mode. Never throws; see the contract above. */
export function treePiiModeFrom(tree) {
  try {
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return { status: 'unusable', reason: 'tree.json is not an object, so the tree\'s personal-data mode cannot be read' };
    if (!Object.hasOwn(tree, 'piiGate')) return { status: 'off' };
    const reason = piiModeProblem(tree.piiGate);
    return reason ? { status: 'unusable', reason } : { status: 'on', mode: tree.piiGate };
  } catch (e) {
    return { status: 'unusable', reason: 'tree.json could not be read (a hostile or damaged value)' };
  }
}

/** The types a person allowed for the ROOT task at `council tree start --allow-pii <types found>` (T-b, 19 Okt 2026), after seeing the stop. The four fixed words of src/pii-gate.js. */
// NOT `secret` (C&C ruling, 19 Okt 2026): the PII gate's secret type reads the key scan's own pattern list, and a tree takes no override of the key scan; a pii:secret finding in a tree is closed or replaced, never allowed.
export const TREE_PII_ALLOW_TYPES = Object.freeze(['email', 'iban', 'card']);

/** Why a value is not a usable allowance, or null. Pure. */
export function piiAllowProblem(x) {
  if (!Array.isArray(x) || x.length === 0) return 'piiAllow must be a non-empty list of the types email, iban, card';
  if (x.some(t => !TREE_PII_ALLOW_TYPES.includes(t)) || new Set(x).size !== x.length) return 'piiAllow may hold each of email, iban, card at most once, and nothing else';
  return null;
}

/**
 * What tree.json says about the allowance for the root task: { status: 'none' } (no field: every tree written before, and every tree started without --allow-pii) | { status: 'on', types } | { status: 'unusable', reason } (fail CLOSED: the
 * root's own scan then stops on everything, never reads damage as an allowance). Never throws. The allowance belongs to the ROOT (every generation: a root plan's task.md is the task's bytes and a replan's context holds the root's own earlier plan and the person's typed decisions); a sub-plan gets none from it.
 */
export function treePiiAllowFrom(tree) {
  try {
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) return { status: 'unusable', reason: 'tree.json is not an object' };
    if (!Object.hasOwn(tree, 'piiAllow')) return { status: 'none' };
    const reason = piiAllowProblem(tree.piiAllow);
    return reason ? { status: 'unusable', reason } : { status: 'on', types: [...tree.piiAllow] };
  } catch { return { status: 'unusable', reason: 'tree.json could not be read' }; }
}

/**
 * The mode the tree's INPUT checks ask (registration, rebuild, the root backstop): what tree.json records, and `hard-stop` when it records none (C&C 19 Okt 2026: a member handed no mode scans under the stop, and no released tree lacks a mode). Registration and the member's
 * own start must ask the SAME question, or a child registers and is then refused at its start (the stranded shape the bundle_input stop exists to prevent). `unusable` stays unusable. Pure.
 */
export function treeInputScanModeFrom(tree) {
  const m = treePiiModeFrom(tree);
  return m.status === 'off' ? { status: 'on', mode: 'hard-stop' } : m;
}
