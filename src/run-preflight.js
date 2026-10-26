// The refusals a run makes before it has a run folder, in one place, so `council tree start` asks the SAME questions the root run will ask (0.8.3 M6 S5 commit 3; C&C ruling 12 Oct: "each must call the same
// function the run calls ... never a second predicate in tree-start.js"). Extracted from src/cli.js without changing a byte of what a normal run prints or which exit it takes
// (test/tree-start-prechecks.test.js GOLD-1 pins the output captured at 35a9b38). Each function returns what the caller prints and decides; none of them prints, exits or writes.
//   chainLintLines(config, path)           -> null | [lines]      the chain lint (exit 1 in cli.js), asked FIRST: before the policy file, as the run asks it
//   missingKeyLines(config, allSeats)      -> null | [lines]      a seat whose provider has no key (exit 5 in cli.js): the E001 text per provider, then the pointer to `doctor`
//   policyGate({ config, allSeats, ... })  -> { policy: null } | { parseError } | { ok, reasons, checks, warnings }      the central policy file (parse error exit 6, refusal exit 12)
//   policyRefusalText(gate, ...)           -> the E005 text for a parse error or a refusal
//   piiGateReport({ mode, allow, sources }) -> { blocked, lines, findings }   the PII gate (findings = where/type/line/column data without the value, for a tree member's WARNINGS.md: piiWarningLines) (OFF unless a mode is given; exit 11 in cli.js when blocked): asked FIRST, before the key scan, as the run asks them
//   inputSecretFindings({ ... })           -> [{ where, line, name }]      credential-shaped strings in what every seat will read (exit 11)
//   secretScanRefusalLines(found, opts)    -> [lines]
// The key check reads the environment and `.env` through src/providers.js keyFor (src/key-env.js), as the run does; this file reads no environment variable of its own.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSeats } from './chain.js';
import { keyFor, envKeyName } from './providers.js';
import { formatCouncilError } from './errors.js';
import { councilCommand } from './invocation.js';
import { loadPolicy, buildPolicyContext, evaluatePolicy, parseChangeRequestFields, POLICY_PATH } from './policy.js';
import { secretShapesIn, secretRefusalLines } from './outbound-scan.js';
import { lintChain } from './chain-lint.js';
import { scanForPii, applyPiiGate, PII_TYPES } from './pii-gate.js';

/** null when the chain passes the chain lint; else the lines to print (the header with the file, then each finding and its fix). Exit 1 in cli.js. `config` as the file says it, before transport rerouting. */
export function chainLintLines(config, path) {
  const findings = lintChain(config, path);
  if (!findings.length) return null;
  return [`\nchain lint: ${path} has ${findings.length} problem(s) and will not run:\n`, ...findings.flatMap(f => [`  [${f.kind}] ${f.message}`, `    fix: ${f.fix}\n`])];
}

/** null when every seat has its key; else the lines to print, in order (a blank line, each provider's E001 and a blank line, then the pointer to `doctor`). */
export function missingKeyLines(config, allSeats) {
  if (!checkSeats(allSeats).length) return null;
  // v5 §1 candidate 4, COUNCIL-E001: one tone-shaped message per missing provider, deduplicated - a chain with three seats on the same unset key gets told once, not three times.
  const missingProviders = [...new Set(allSeats.filter(Boolean).map(s => s.provider).filter(p => !keyFor(p)))];
  const lines = [''];
  for (const provider of missingProviders) lines.push(formatCouncilError('COUNCIL-E001', { provider, chain: config.name, envVar: envKeyName(provider) }), '');
  lines.push(`Run "${councilCommand()} doctor" to see exactly which keys each shipped chain needs.`);
  return lines;
}

/**
 * The central policy file (work/policy.json): no file = { policy: null }. `taskText` is a function, called only when a policy is in force (the task file is read there because the policy gate runs first; a task without a
 * `target_file:` line is not a change request). `policyCwd`: where the file is looked for (a resume looks in the run's own folder). -> { policy: null } | { parseError } | { ok, reasons, checks, warnings }.
 */
export function policyGate({ config, allSeats, work, policyCwd = work, taskText = () => '', signoffFlag, callFigureUsd = null }) {
  const { policy, error: parseError } = loadPolicy(policyCwd);
  if (parseError) return { parseError };
  if (!policy) return { policy: null };
  const ctx = buildPolicyContext(config, allSeats, join(work, 'runs'));
  // T5b: a command that makes ONE call on a finished run (digest) is judged on that call's own figure, the one its --dry-run prints (projectStage). The chain its config stands for cannot say what one call costs: a stand-in with an unknown slot priced $0, and a readable chain
  // priced the whole run again. `figure: 'call'` is the wording the advice path already uses; there is no separate ceiling to warn about, so maximumUsd is not set.
  if (callFigureUsd !== null) { ctx.worstCaseUsd = callFigureUsd; ctx.maximumUsd = null; ctx.figure = 'call'; }
  const fields = parseChangeRequestFields(taskText());
  if (fields.target_file !== undefined) ctx.changeRequest = { target_file: fields.target_file };
  const signoff = signoffFlag || fields.signoff;   // precedence: --signoff flag, then the task file's `signoff:` line
  if (signoff !== undefined) ctx.signoff = signoff;
  const { ok, reasons, checks, warnings } = evaluatePolicy(policy, ctx);
  return { policy, ok, reasons, checks, warnings };
}

/**
 * THE policy gate of every command that calls a model on a finished run (T2-1 commit 5, 14 Oct 2026): `--replay`, `--rematch`, `handoff --from-run`, `contract draft --from-run` and `digest --provider`. It used to exist twice, as the main run's
 * `policyGate` call and as an inline copy in the handoff block, and the other three had NONE, so a seat the policy forbids could be called through them. -> null (nothing to say) | { text, parseError }: the E005 text the CLI prints and whether
 * the policy file did not parse (exit 6) or refused the chain (exit 12). It is also the one place the person's typed cap for every run plugs in later: these commands are run starts, and there is no second gate. It reads the policy file and
 * the spend history; it prints nothing and writes nothing.
 */
export function sideCommandGate({ config, allSeats, work, policyCwd = work, callFigureUsd = null }) {
  const gate = policyGate({ config, allSeats, work, policyCwd, callFigureUsd });
  if (gate.parseError) return { text: policyRefusalText(gate, { work }), parseError: true };
  if (gate.policy !== null && !gate.ok) return { text: policyRefusalText(gate, { work, chainName: config.name }), parseError: false };
  return null;
}

/** The E005 text (with its leading blank line, as the CLI prints it) for a parse error or a refusal of `gate`. */
export function policyRefusalText(gate, { work, chainName }) {
  return gate.parseError
    ? `\n${formatCouncilError('COUNCIL-E005', { path: POLICY_PATH(work), parseError: gate.parseError })}`
    : `\n${formatCouncilError('COUNCIL-E005', { path: POLICY_PATH(work), chain: chainName, reasons: gate.reasons })}`;
}

// The input scan is a REFUSAL scan: it asks for the reserved-placeholder-host exemption (src/secret-patterns.js, Part E); redaction and the advice send path do not.
const INPUT_SCAN = Object.freeze({ exemptReservedHosts: true });

/**
 * Credential-shaped strings in what every seat will read, every shape checked (the generic ones included), with the file and line, never the value. `contextFiles` are read with `readContext`; a file that cannot be read adds
 * nothing here (the run refuses it elsewhere). `criteriaPath`: a --criteria file; else the chain's own criteria. -> [{ where, line, name }]
 */
export function inputSecretFindings({ taskFile, taskText, contextFiles = [], readContext = () => '', handedDraft = '', criteriaPath = null, config }) {
  return [
    ...secretShapesIn(taskText, INPUT_SCAN).map(f => ({ where: taskFile, ...f })),
    ...contextFiles.flatMap(f => { try { return secretShapesIn(readContext(f), INPUT_SCAN).map(x => ({ where: f, ...x })); } catch { return []; } }),
    ...secretShapesIn(handedDraft || '', INPUT_SCAN).map(f => ({ where: 'the handed draft (--draft / --from-run)', ...f })),
    // Verify pass 2026-09-28 F4: the criteria reach every seat too, and are echoed to run.log. A --criteria file by its own lines; criteria reused from --from-run by criterion number.
    ...(criteriaPath
      ? secretShapesIn(readFileSync(criteriaPath, 'utf8'), INPUT_SCAN).map(f => ({ where: criteriaPath, ...f }))
      : secretShapesIn((Array.isArray(config.criteria) ? config.criteria : []).map(c => (typeof c === 'string' ? c : JSON.stringify(c)).replace(/\n/g, ' ')).join('\n'), INPUT_SCAN)
        .map(f => ({ where: 'the criteria reused from --from-run (criterion number)', ...f }))),
  ];
}

/**
 * The key scan of a TEXT A PERSON TYPES AT A TREE VERB (`council tree decide`: the repair text reaches children's context.md, part 7): the SAME scan a run applies to its inputs (all shapes, the reserved-placeholder-host
 * exemption of INPUT_SCAN), so the two cannot disagree. -> [{ where, line, name }] - the pattern NAME and the position, never the value.
 */
export const textSecretFindings = (text, where) => secretShapesIn(String(text ?? ''), INPUT_SCAN).map(f => ({ where, ...f }));

/**
 * The way on after a PII stop (19 Okt 2026): the ONE builder of the stop screen's closing lines and, below, the ONE parser of them (the MCP server reads the types the child found from these lines; producer and reader cannot drift). The
 * types are the ones FOUND, in the fixed order of PII_TYPES, so the person chooses by looking. Only the four fixed words are ever printed or parsed.
 */
/**
 * BUG-D-012 (a): the refusal sentence for a SAVED piiGate (run.json, project-writable text) that is not usable, or null. A mode must be warn or hard-stop; allow must be a list made of the four PII types. Pure.
 * A-DRAFT words, modeled on src/pii-mode.js's refusal for the setting.
 */
export function savedPiiGateRefusal(saved, runJsonPath, { mode: checkMode = true, allow: checkAllow = true } = {}) {   // checkMode / checkAllow: only the parts this resume will actually USE (a typed --pii-gate replaces both, a typed --allow-pii replaces the list)
  const tail = 'Nothing was started and nothing was spent.';
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) return `${runJsonPath}: piiGate must hold a mode and a list of types. Fix it or remove the piiGate entry. ${tail}`;
  if (checkMode && saved.mode !== undefined && saved.mode !== 'warn' && saved.mode !== 'hard-stop') {
    // eslint-disable-next-line no-control-regex
    const shown = String(saved.mode).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
    return `${runJsonPath}: piiGate.mode "${shown}" is not a mode. Set it to hard-stop (the default) or warn, or remove the piiGate entry. ${tail}`;
  }
  if (checkAllow && saved.allow !== undefined && (!Array.isArray(saved.allow) || saved.allow.some(w => !PII_TYPES.includes(w)))) {
    return `${runJsonPath}: piiGate.allow must be a list of the words email, iban, card or secret. Fix it or remove the piiGate entry. ${tail}`;
  }
  return null;
}
export const PII_ALLOW_PREFIX = 'To send it anyway, run the same command again and add:  --allow-pii ';
export function piiAllowLines(types) {
  const t = PII_TYPES.filter(x => (types || []).includes(x));
  return [`${PII_ALLOW_PREFIX}${t.join(',')}`, `That allows every ${t.join(' / ')}-shaped string in these files, also when this run is resumed.`];
}
/** -> the types named by the stop screen's way-on line in `text` (a subset of PII_TYPES, fixed order), or null when there is no such line or it names a word outside the four. */
export function parsePiiAllowLine(text) {
  const line = String(text ?? '').split('\n').map(l => l.trim()).find(l => l.startsWith(PII_ALLOW_PREFIX));
  if (!line) return null;
  const words = line.slice(PII_ALLOW_PREFIX.length).split(',');
  if (!words.length || words.some(w => !PII_TYPES.includes(w))) return null;
  return PII_TYPES.filter(t => words.includes(t));
}

/**
 * The PII gate over `sources` ([[where, text], ...]; an empty text is skipped): per source the findings (`scanForPii` with the allow-list) and the gate's answer (`applyPiiGate`: under `hard-stop` a finding blocks, under
 * `warn` it only reports). -> { blocked, lines }: the lines the CLI prints, in order (each `  PII-GATE (<mode>): [<where>] <message>`, then per blocking source the refusal line, then ONE closing line when blocked). The normal run
 * prints the lines and exits 11 when `blocked`. `forTree`: a tree MEMBER has no allow-list of its own (its text is model-written); `true` = `council tree start` offers `--allow-pii <types found>` for the ROOT task only (T-b), `'member'` names the per-sub-plan verb. `true` = `council tree start` (it tells the person
 * what to change); `keyScanRefuses` (see below, warn only) drops a secret finding the key scan refuses anyway; `'member'` = a member's own run (13 Oct 2026, member unit): the line states the fact and names NO remedy, because a member's output is read through the sitting, and the sitting is the one place a remedy lives.
 */
export function piiGateReport({ mode, allow = [], sources, forTree = false, keyScanRefuses = false, keyScanAllowed = false, allowTask = null, allowRanges = null }) {
  const lines = []; const found = []; const typesFound = []; let blocked = false;
  for (const [where, text] of sources.filter(([, t]) => t)) {
    let scanResult = scanForPii(text, { allow });
    // 0.8.3 (C&C ruling 18 Okt 2026): ONE line per finding. Under `warn`, a credential-shaped string the outbound key scan is about to REFUSE is not also warned about: the refusal that follows names it (the key scan reads the same text,
    // so a source it flags is refused whole). `keyScanRefuses` is true for `council tree start` (a tree takes no override) and for a run without --allow-secret-shaped. Under `hard-stop` the gate's own refusal still comes first, as before.
    if (keyScanRefuses && textSecretFindings(text, where).length > 0) scanResult = { ...scanResult, findings: scanResult.findings.filter(f => f.type !== 'secret') };
    // one act, one flag (19 Okt 2026): a person who typed (or saved) --allow-secret-shaped has decided about the key-shaped text the key scan covers, so the PII gate does not stop on the same lines a second time. The PII `secret` type reads
    // MORE shapes than the key scan (key-redaction's scan keeps the scan-only patterns that the key scan's `redactable` pass leaves out), so only findings on lines the key scan itself flags are dropped; any other `secret` shape still stops and
    // the screen names `--allow-pii secret`.
    // T-b (19 Okt 2026, C&C ruling (c)): the ROOT task's allowance (tree.json piiAllow) covers the task's own text only. The task sits at the start of the combined source, so its lines are 1..allowTask.lines; a finding of an allowed type on those
    // lines is the task's own and is dropped (reported as suppressed); the same type further down (the --context documents) still stops.
    if (allowTask && Array.isArray(allowTask.types) && allowTask.types.length && (allowTask.where === undefined || allowTask.where === where)) {
      const inTask = f => allowTask.types.includes(f.type) && f.line <= allowTask.lines;
      scanResult = { ...scanResult, suppressed: [...new Set([...scanResult.suppressed, ...scanResult.findings.filter(inTask).map(f => f.type)])], findings: scanResult.findings.filter(f => !inTask(f)) };
    }
    // the same allowance for a CHILD member: the stretches of its context the tree code copied verbatim from the pinned root task (tree-bundle-input rootTaskCoverage), as 1-based inclusive line ranges of THIS source
    if (allowRanges && Array.isArray(allowRanges.types) && allowRanges.types.length && (allowRanges.where === undefined || allowRanges.where === where)) {
      const inRange = f => allowRanges.types.includes(f.type) && allowRanges.ranges.some(([a, b]) => f.line >= a && f.line <= b);
      scanResult = { ...scanResult, suppressed: [...new Set([...scanResult.suppressed, ...scanResult.findings.filter(inRange).map(f => f.type)])], findings: scanResult.findings.filter(f => !inRange(f)) };
    }
    if (keyScanAllowed) { const covered = new Set(textSecretFindings(text, where).map(f => f.line)); scanResult = { ...scanResult, findings: scanResult.findings.filter(f => !(f.type === 'secret' && covered.has(f.line))) }; }
    const { block } = applyPiiGate(scanResult, mode);
    // the findings as DATA, for a member's WARNINGS.md (piiWarningLines): where, type, position, and a secret's pattern NAME - never the matched value, not even its masked prefix
    for (const f of scanResult.findings) found.push({ where, type: f.type, line: f.line, column: f.column, ...(f.type === 'secret' ? { pattern: f.pattern } : {}) });
    // ONE builder for what is printed and what is persisted (council-<id>.log, run.log, a failed start's logTail): kind and place, never the value, not even its masked prefix (C&C ruling 18 Okt 2026, fix-up 4).
    for (const s of scanResult.suppressed) lines.push(`  PII-GATE (${mode}): [${where}] suppressed pattern class '${s}' (--allow-pii)`);
    for (const f of scanResult.findings) lines.push(piiFindingLine(mode, { where, type: f.type, line: f.line, column: f.column, pattern: f.pattern }));
    if (block) {
      lines.push(`\nPII-GATE: stopped - ${scanResult.findings.length} match(es) found in ${where}. Nothing was started, sent or spent.`);
      blocked = true;
      for (const f of scanResult.findings) if (!typesFound.includes(f.type)) typesFound.push(f.type);
    }
  }
  if (blocked) lines.push(...(forTree === 'member'
    ? ['Nothing was sent. A tree member takes no --allow-pii of its own; a person allows personal data for one sub-plan after seeing it: council tree decide <root> --allow-pii-node <node>@g<N>.']
    : forTree
      ? (() => { const tree = PII_TYPES.filter(t => t !== 'secret' && typesFound.includes(t)); const blind = 'Or change the task, or start the tree with --pii-gate warn (a choice made before seeing anything: every sub-plan the models write later goes on unchecked).'; return tree.length ? [`${PII_ALLOW_PREFIX}${tree.join(',')}`, 'That allows these types in the root TASK text only. Every sub-plan the models write later is checked on its own, and you answer each stop after seeing it (`council tree decide <root> --allow-pii-node <node>@g<N>`). Key-shaped text is never allowed in a tree.', blind] : ['Key-shaped text is never allowed in a tree: change the task.', blind]; })()
      : piiAllowLines(PII_TYPES.filter(t => typesFound.includes(t)))));
  return { blocked, lines, findings: found };
}

/**
 * The WARNINGS.md lines of a tree member's PII findings under `--pii-gate warn` (S5b part A commit 3): `- pii_gate (warn): [<where>] line L, col C: <type>` (a secret adds its pattern name). From the finding fields only, never from
 * the printed lines, which carry a masked prefix of the value; control characters in a label are removed so a label cannot add a line of its own. -> [string] each ending in a newline.
 */
export function piiWarningLines(findings) {
  const clean = s => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ');
  return (Array.isArray(findings) ? findings : []).map(f => `- pii_gate (warn): ${clean(f.where)} line ${f.line}, col ${f.column}: possible ${clean(f.type)}${f.type === 'secret' && f.pattern ? ` (${clean(f.pattern)})` : ''}\n`);
}

/**
 * ONE line for one PII finding, built from the finding's fields only (C&C ruling 18 Okt 2026): `  PII-GATE (<mode>): [<where>] line L, col C: <type>` (a secret adds its pattern name) and "(value not shown)". Never the value and never a
 * masked prefix of it: this builder feeds the console lines (which land in council-<id>.log and in a failed start's logTail) AND run.log, so nothing persisted carries any part of the matched text. Control characters in a label are removed.
 */
export function piiFindingLine(mode, f) {
  const clean = s => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ');
  return `  PII-GATE (${mode}): [${clean(f.where)}] line ${f.line}, col ${f.column}: ${clean(f.type)}${f.type === 'secret' && f.pattern ? ` (${clean(f.pattern)})` : ''} (value not shown)`;
}

/** The run.log lines of a normal run's PII findings under `warn`: the same builder as the console lines (piiFindingLine). -> [string] without a trailing newline. */
export function piiLogLines(findings) {
  return (Array.isArray(findings) ? findings : []).map(f => piiFindingLine('warn', f));
}

/** The refusal lines of the outbound key scan. `forTree`: `true` = `council tree start` has no override, so its closing sentence says so instead of offering `--allow-secret-shaped`; `'member'` = a member's own run: the fact, no remedy. */
export function secretScanRefusalLines(found, { forTree = false } = {}) {
  return [
    `\nOUTBOUND KEY SCAN: refusing to run - ${found.length} credential-shaped string(s) in the input, which would be sent to every seat:`,
    ...secretRefusalLines(found),
    forTree === 'member'
      ? 'Nothing was sent. A tree takes no override.'
      : forTree
      ? 'Nothing was sent. A tree takes no override: change the task, or use a normal `council --task` run with --allow-secret-shaped.'
      : 'Nothing was sent. Remove the key from the input, or rerun with --allow-secret-shaped to send it deliberately.',
  ];
}
