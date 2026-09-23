// v7 item 1: tool-grounded verification. A fixed allowlist of four offline,
// sandboxed tools a chain may invoke on a seat's behalf (see
// relay/runs/2026-09-14T00-20-44-997Z/deliverable.md §1). Deliberately NOT a
// generic command executor: each tool takes a narrow, named argument shape,
// every filesystem path is resolved and checked to stay inside the workspace
// root before use, and none of the four makes a network call. Adding a fifth
// tool means adding a new named function here and to ALLOWED_TOOLS below -
// there is no path by which a seat (or a chain config) can name an arbitrary
// shell command.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, statSync, lstatSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export const ALLOWED_TOOLS = Object.freeze(['run_tests', 'check_versions', 'grep_repo', 'read_file']);

// 2026-09-20. Everything below this comment exists because of one finding: these tools
// were built to read a workspace, and the sandbox only ever asked "is this path inside
// the root?" - never "should a third-party lab see this?". Those are different questions.
// grep_repo walked gitignored files, applied no secret filter, and would happily have
// returned a key file; the repo this harness is most likely to be pointed at has one under
// Tools/secrets/. No shipped chain enables grep_repo, so nothing leaked - this is closing
// the hole before the fact-pack work (which is the first thing that would open it), not
// after an incident.
//
// The thing to hold onto: anything these tools return can end up in a prompt, and a prompt
// goes over the network to every lab holding a seat. "Inside the workspace" is not a
// security boundary when the output leaves the machine.

// Never returned, at any path inside the sandbox, ignored or not. Matched on the whole
// relative path so a `secrets/` segment anywhere is caught, not only at the root.
const DENY_PATTERNS = [
  /(^|\/)\.env($|\.|\/)/i,
  /\.(key|pem|p12|pfx|jks|keystore|asc|gpg)$/i,
  /(^|\/)keystore\.properties$/i,
  /(^|\/)secrets?(\/|$)/i,
  /(^|\/)\.ssh(\/|$)/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /(^|\/)credentials?(\.|$)/i,
  /(^|\/)\.aws(\/|$)/i,
  // 2026-09-23 audit (finding 9): direnv files, `prod.env`-style files, git's own config
  // (remote URLs carry tokens) and credential store, and netrc logins.
  /(^|\/)\.envrc$/i,
  /\.env$/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)\.git-credentials$/i,
  /(^|\/)[._]netrc$/i,
];

export function isDeniedPath(relPath) {
  const normalised = String(relPath).split(sep).join('/');
  return DENY_PATTERNS.some(re => re.test(normalised));
}

// Content-level scan, applied to everything these tools return. The path denylist above
// catches files whose NAME says "secret"; this catches a key pasted into a source file, a
// token in a config, a connection string in a comment - which is how secrets actually leak.
// Redacts the value and leaves a visible marker, rather than dropping the whole result: a
// seat that sees `[redacted: possible secret]` knows something was there, and silently
// returning nothing would look like the file was empty.
const PEM_BLOCK = /-----BEGIN[ A-Z]*PRIVATE KEY-----[\s\S]*?-----END[ A-Z]*PRIVATE KEY-----/g;
const SECRET_PATTERNS = [
  PEM_BLOCK,
  /\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // A named assignment whose value looks like a credential. Deliberately requires the
  // name AND a long opaque value, so ordinary code like `apiKey: config.apiKey` is left
  // alone - a filter that fires on every mention of the word is a filter people turn off.
  // 2026-09-23 audit: `(?<![A-Za-z0-9])` rather than `\b` in front, because `\b` never
  // fires after `_` - `OPENROUTER_API_KEY=` slipped through. An optional quote after the
  // name catches JSON (`"password": "..."`).
  /(?<![A-Za-z0-9])(api[_-]?key|secret|token|password|passwd|access[_-]?key|auth)\b['"]?\s*[:=]\s*['"]?([A-Za-z0-9/+_-]{20,})['"]?/gi,
  // Stripe secret/restricted keys and GitHub fine-grained tokens (underscore-separated, so
  // the `sk-` rule above never saw them).
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  // Env-style assignment to an upper-case name ending in KEY/TOKEN/SECRET/PASSWORD, with an
  // opaque value: `GOOGLE_PLAY_PUBKEY=...`, `export DEPLOY_TOKEN="..."`. The value must be
  // long, so `CACHE_KEY=1` stays.
  /\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD))\s*=\s*['"]?([A-Za-z0-9/+_.-]{16,})['"]?/g,
  // A password inside a URL: `scheme://user:pass@host`. Only the password goes.
  /\b([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):([^\s/@]+)@/gi,
];

export function redactSecrets(text) {
  if (typeof text !== 'string' || !text) return { text: text ?? '', redacted: 0 };
  let redacted = 0;
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, ...groups) => {
      // For the named-assignment pattern, keep the name so the reader knows what was
      // redacted; replace only the value.
      const value = groups.length >= 2 && typeof groups[1] === 'string' ? groups[1] : null;
      redacted += 1;
      if (value && match.includes(value)) return match.replace(value, '[redacted: possible secret]');
      return '[redacted: possible secret]';
    });
  }
  return { text: out, redacted };
}

// What goes into a prompt is capped far below what goes into the run record. 200KB of
// file text in a seat's prompt is both a cost problem and a "nobody read what we sent"
// problem; the run folder can hold the full text because it never leaves the machine.
export const PROMPT_INSERT_MAX_BYTES = 4_000;

export function capForPrompt(text, maxBytes = PROMPT_INSERT_MAX_BYTES) {
  const buf = Buffer.from(String(text ?? ''), 'utf8');
  if (buf.length <= maxBytes) return { text: String(text ?? ''), truncated: false };
  return {
    text: `${buf.subarray(0, maxBytes).toString('utf8')}\n[truncated: ${buf.length - maxBytes} more bytes not shown]`,
    truncated: true,
  };
}

// `git check-ignore` in one batch rather than per file. 2026-09-23 audit: this used to fail
// OPEN - any git error (ENOBUFS on a big candidate list, a path inside a submodule, a
// killed git) returned "nothing is ignored", and a gitignored local-secrets file went out.
// Now only one answer means "nothing is ignored": git saying the workspace is not a git
// repository at all, where no .gitignore exists to honour (the denylist and the secret scan
// still apply there). Every other failure throws, and callers refuse. `-z` on both sides so
// git never C-quotes a non-ASCII name ("geheimnis-\303\244.txt") into something that no
// longer matches the path we asked about. `root` must already be a real path: the paths
// passed in are relative to it, and a symlinked root makes them wrong.
export function gitIgnoredSet(root, relPaths) {
  if (!relPaths.length) return new Set();
  const failed = (why) => new Error(`refused: can't check .gitignore (${why}), so nothing is returned rather than risk a gitignored secret`);
  // Asked separately first: outside a repo git exits before reading stdin, and the write
  // then fails with EPIPE, indistinguishable from a real error. LC_ALL=C because the
  // "not a git repository" test reads git's message, which is translated otherwise
  // (a German git says "Kein Git-Repository" and would fail every non-git workspace).
  const env = { ...process.env, LC_ALL: 'C' };
  const probe = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', timeout: 20_000, shell: false, env });
  if (probe.error) throw failed(String(probe.error.code || probe.error.message || probe.error));
  if (probe.status === 128 && /not a git repository/i.test(probe.stderr || '')) return new Set();
  if (probe.status !== 0) throw failed(probe.signal ? `git killed by ${probe.signal}` : `git exit ${probe.status}`);
  const res = spawnSync('git', ['-C', root, 'check-ignore', '-z', '--stdin'], {
    input: relPaths.join('\0'), encoding: 'utf8', timeout: 20_000, shell: false, maxBuffer: 64 * 1024 * 1024, env,
  });
  if (res.error) throw failed(String(res.error.code || res.error.message || res.error));
  if (res.status === 0 || res.status === 1) {
    return new Set(String(res.stdout).split('\0').filter(Boolean));
  }
  throw failed(res.signal ? `git killed by ${res.signal}` : `git exit ${res.status}: ${String(res.stderr || '').trim().split('\n')[0]}`);
}

// One gate for every path a tool or the fence is about to read, so the three callers can't
// drift again (run_tests skipped all of this until 2026-09-23). Returns a refusal message, or
// null if the file may be read. Both arguments are real paths. The denylist is checked
// against the repo-relative path AND the full real path: a --repo pointed inside
// `Tools/secrets/` made every file inside look like an innocent `play.txt`.
export function pathRefusal(realRoot, realTarget) {
  const rel = relative(realRoot, realTarget).split(sep).join('/');
  if (isDeniedPath(rel) || isDeniedPath(realTarget)) {
    return `refused: '${rel}' matches the secret/credential denylist and is never returned to a seat`;
  }
  if (gitIgnoredSet(realRoot, [rel]).has(rel)) {
    return `refused: '${rel}' is gitignored, so it is not part of the repository under discussion and may hold local secrets`;
  }
  return null;
}

function realRoot(cwd) {
  const root = resolve(cwd);
  return existsSync(root) ? realpathSync(root) : root;
}

// Every call, and the exact bytes it produced, for the run folder's TOOLS.md. Held in
// memory and written by the caller: this module never touches the run folder itself, the
// same split runTool/chain.js already have.
const callLog = [];
export function toolCallLog() { return callLog.slice(); }
export function resetToolCallLog() { callLog.length = 0; }

// Bug-audit fix, 2026-09-16: this check used to be purely lexical (string comparison after
// resolve()) and its own comment claimed that also rejected symlink escapes - false. A symlink
// physically sitting inside the workspace (e.g. workspace/link -> /etc) resolves lexically to
// a path under the workspace (resolve() never touches the filesystem or follows a link), passes
// the string check, and then every caller below opens/reads/execs *through* that link, landing
// outside the workspace for real. Fixed: once the lexical check passes, and only if the target
// actually exists (a not-yet-existing path has nothing to resolve, and every caller below already
// existsSync()s before using the result), realpathSync() both the workspace root and the target
// and re-check containment against the fully resolved filesystem paths - this is the check that
// actually cannot be fooled by a symlink, because realpathSync() reads the real target, not what
// the path string says. The realpath is what's returned and used from here on, never the
// pre-realpath lexical path, so a caller can't be handed a value that still needs re-checking.
function sandboxPath(root, requested) {
  const base = resolve(root);
  const target = resolve(base, requested ?? '.');
  const rel = relative(base, target);
  if (rel !== '' && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error(`path escapes workspace: ${requested}`);
  }
  if (!existsSync(target)) return target;
  const realBase = realpathSync(base);
  const realTarget = realpathSync(target);
  const realRel = relative(realBase, realTarget);
  if (realRel !== '' && (realRel.startsWith('..') || isAbsolute(realRel))) {
    throw new Error(`path escapes workspace via symlink: ${requested}`);
  }
  return realTarget;
}

function readTextFile(path, maxBytes = 200_000) {
  const buf = readFileSync(path);
  const truncated = buf.length > maxBytes;
  return { text: buf.subarray(0, maxBytes).toString('utf8'), truncated };
}

// run_tests: { file? } - runs `node --test [file]` under the sandboxed cwd.
// No shell (`shell: false`, spawnSync's default), no network flags, no
// caller-supplied argv beyond one optional path already sandboxed above.
function run_tests({ file } = {}, { cwd }) {
  const root = realRoot(cwd);
  const args = ['--test'];
  if (file) {
    const target = sandboxPath(root, file);
    if (!existsSync(target)) return { ok: false, error: `no such file: ${file}` };
    // 2026-09-23 audit: this ran any file past read_file's gates, and node echoes the
    // offending line of a file it can't parse - {"file": ".env"} returned the key.
    const refusal = pathRefusal(root, target);
    if (refusal) return { ok: false, error: refusal };
    args.push(target);
  }
  // Inside a packaged binary process.execPath is the council binary, not node, so `--test` would
  // reach the CLI instead of a test runner - use the node on PATH, which the target repo's own
  // tests need anyway.
  // NODE_TEST_CONTEXT is dropped: when this tool itself runs under `node --test`, the child
  // would inherit it and report over IPC instead of printing TAP, so the seat (and the
  // redaction below) would see different output depending on who called the tool.
  const { NODE_TEST_CONTEXT, ...env } = process.env;
  const res = spawnSync(process.pkg ? 'node' : process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60_000, shell: false, env });
  if (res.error) return { ok: false, error: String(res.error.message || res.error) };
  // Test output goes into a prompt like any other tool result: redacted, then capped.
  const out = redactSecrets(res.stdout ?? '');
  const err = redactSecrets(res.stderr ?? '');
  const redacted = out.redacted + err.redacted;
  return {
    ok: res.status === 0,
    exitCode: res.status,
    stdout: capForPrompt(out.text).text,
    stderr: capForPrompt(err.text).text,
    ...(redacted ? { redacted } : {}),
  };
}

// check_versions: {} - reads the sandboxed package.json (name/version/deps)
// and the running node version. No `npm outdated`/registry lookup - that
// would be a network call, which this tool must never make.
function check_versions(_args, { cwd }) {
  const root = resolve(cwd);
  const pkgPath = sandboxPath(root, 'package.json');
  if (!existsSync(pkgPath)) return { ok: false, error: 'no package.json in workspace' };
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return {
    ok: true,
    node: process.version,
    name: pkg.name,
    version: pkg.version,
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
  };
}

// grep_repo: { pattern, file? } - a literal/regex text search confined to one
// sandboxed file, or (no file given) every regular file under the workspace
// root, skipping .git and node_modules. No shelling out to `grep`; matching
// is done in-process so there is no argument-injection surface.
function grep_repo({ pattern, file } = {}, { cwd }) {
  if (!pattern) return { ok: false, error: 'grep_repo requires a pattern' };
  // Security-review fix (Fable 5.1 review of c915eba, MEDIUM 1): `root` itself can be a symlink
  // (a symlinked project directory, macOS's /tmp -> /private/tmp, etc). The new lstatSync-based
  // walk() below correctly refuses to descend INTO a symlink it encounters while recursing, but
  // that same check fired on the STARTING node too when root itself was a symlink, returning
  // zero matches for every real file underneath - realpath the starting point once here so the
  // walk always begins from a real directory, not a link to one.
  let root = resolve(cwd);
  if (existsSync(root)) root = realpathSync(root);
  let re;
  try { re = new RegExp(pattern); } catch (err) { return { ok: false, error: `bad pattern: ${err.message}` }; }
  const matches = [];
  const skip = new Set(['.git', 'node_modules']);
  const walk = path => {
    // Bug-audit fix, 2026-09-16: statSync() follows symlinks, so a symlink inside the workspace
    // pointing at a directory outside it used to be walked straight through (escaping the
    // sandbox, same root cause as sandboxPath's own fix above), and a symlink forming a cycle
    // (a -> b, b -> a) recursed forever until the stack overflowed. lstatSync() reports the
    // link itself without following it; a symlink of any kind (file or directory) is skipped
    // outright rather than walked into or read through.
    const st = lstatSync(path);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      if (skip.has(path.split(sep).pop())) return;
      for (const entry of readdirSync(path)) walk(resolve(path, entry));
      return;
    }
    if (!st.isFile()) return;
    // 2026-09-20: refuse denied paths before reading them, not after. A file whose name
    // says "secret" is not searched at all, so its contents never exist in this process.
    const rel = relative(root, path);
    if (isDeniedPath(rel)) { denied.push(rel); return; }
    candidates.push({ path, rel });
  };
  const candidates = [];
  const denied = [];
  const start = file ? sandboxPath(root, file) : root;
  walk(start);

  // Gitignored files are not part of the repo the author is asking about, and are where
  // local keys, build output and scratch notes live. Previously walked in full.
  const ignored = gitIgnoredSet(root, candidates.map(c => c.rel));
  let redactedCount = 0;
  for (const { path, rel } of candidates) {
    if (ignored.has(rel)) continue;
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; }
    // A PEM block spans lines, and the per-line scan below never sees a whole one: its body
    // lines came back in clear (2026-09-23 audit). Blank each block line by line first, so
    // line numbers still point at the real lines.
    text = text.replace(PEM_BLOCK, (block) => {
      redactedCount += 1;
      return block.split('\n').map(() => '[redacted: possible secret]').join('\n');
    });
    text.split('\n').forEach((line, i) => {
      if (!re.test(line)) return;
      const { text: safe, redacted } = redactSecrets(line);
      redactedCount += redacted;
      matches.push({ file: rel, line: i + 1, text: capForPrompt(safe).text });
    });
  }
  return {
    ok: true,
    matches: matches.slice(0, 500),
    ...(denied.length ? { deniedPaths: denied.length } : {}),
    ...(ignored.size ? { gitIgnoredSkipped: ignored.size } : {}),
    ...(redactedCount ? { redacted: redactedCount } : {}),
  };
}

// read_file: { path } - returns the sandboxed file's raw text, truncated
// (flagged, not silently) past 200KB.
function read_file({ path } = {}, { cwd }) {
  if (!path) return { ok: false, error: 'read_file requires a path' };
  // Real root: sandboxPath returns a real target, and a symlinked root would otherwise make
  // the relative path '../<real dir>/...', which git can't answer about (2026-09-23 audit).
  const root = realRoot(cwd);
  const target = sandboxPath(root, path);
  if (!existsSync(target) || !statSync(target).isFile()) return { ok: false, error: `no such file: ${path}` };

  // 2026-09-20: refused by name before the file is opened. The error says which rule
  // fired, because "no such file" for a file that plainly exists sends the operator
  // hunting for a bug that isn't there.
  const refusal = pathRefusal(root, target);
  if (refusal) return { ok: false, error: refusal };

  const { text, truncated } = readTextFile(target);
  const { text: safe, redacted } = redactSecrets(text);
  const capped = capForPrompt(safe);
  return {
    ok: true,
    text: capped.text,
    truncated: truncated || capped.truncated,
    ...(redacted ? { redacted } : {}),
  };
}

const IMPLS = { run_tests, check_versions, grep_repo, read_file };

// The single entry point chain.js uses. `tool` must be one of ALLOWED_TOOLS;
// anything else is rejected before any filesystem or process access happens -
// this is the whole enforcement point for "no generic executor exposed to
// seats". `cwd` is the sandbox root (defaults to process.cwd()).
export function runTool(tool, args = {}, { cwd = process.cwd() } = {}) {
  if (!ALLOWED_TOOLS.includes(tool)) {
    return { tool, args, ok: false, error: `tool not allowed: ${tool}` };
  }
  try {
    const result = IMPLS[tool](args, { cwd });
    const out = { tool, args, ...result };
    record(out);
    return out;
  } catch (err) {
    const out = { tool, args, ok: false, error: String(err.message || err) };
    record(out);
    return out;
  }
}

// Recorded for TOOLS.md: what was asked, and the exact bytes the answer would put in a
// prompt. Reviewing what a seat was told afterwards is the only way to check the filters
// did their job, and it has to be the post-redaction, post-cap text - logging the raw
// bytes would put the secret in the run folder instead of the prompt, which is not a fix.
function record(out) {
  callLog.push({
    at: new Date().toISOString(),
    tool: out.tool,
    args: out.args,
    ok: out.ok !== false,
    ...(out.error ? { error: out.error } : {}),
    bytes: Buffer.byteLength(JSON.stringify(out.text ?? out.matches ?? '') || '', 'utf8'),
    ...(out.redacted ? { redacted: out.redacted } : {}),
    ...(out.deniedPaths ? { deniedPaths: out.deniedPaths } : {}),
    ...(out.gitIgnoredSkipped ? { gitIgnoredSkipped: out.gitIgnoredSkipped } : {}),
  });
}

// v7.x: seat-requested bounded tool calls (relay/runs/2026-09-14T14-56-18-834Z/deliverable.md
// item 3). Extends v7 item 1's config-time-only tool grounding: a seat's reply can *request* a
// bounded number of additional calls mid-stage, gated by src/chain.js on
// `config.tools.seat_requests.enabled` PLUS the existing `config.verify.tools` allowlist (v7
// item 1, unchanged) - a seat can only request a tool already on that allowlist. This function
// owns the request-parsing/cap-enforcement policy only; src/chain.js decides when to call it and
// owns the gate check itself, same split as runVerification/renderGroundTruth already have.
//
// Every request is checked against `allowedTools` BEFORE any invocation - same guarantee
// `runTool` above already gives config-time tools, reused rather than reimplemented (this
// function still calls `runTool` per request, it never bypasses it). A request past the cap is
// truncated (dropped, not invoked) and reported back as a warning string - the caller appends
// those to WARNINGS.md exactly the way pre_flight/cache_stale/claim warnings already do in
// src/cli.js. Nothing here throws: a seat that asks for zero, too many, or disallowed tools
// degrades to "fewer results than asked for", never a crashed run.
/**
 * @param {Array<{tool:string, args?:object}>} requests - parsed out of a seat's reply JSON.
 * @param {{cap?:number, allowedTools?:string[], runTool?:Function, cwd?:string, seat?:string}} opts
 * @returns {{results: Array<{tool,args,result,result_ref}>, warnings: string[], requested: number, used: number}}
 */
export function runSeatToolRequests(requests, {
  cap = 3,
  allowedTools = ALLOWED_TOOLS,
  runTool: rt = runTool,
  cwd = process.cwd(),
  seat = 'seat',
} = {}) {
  const list = Array.isArray(requests) ? requests : [];
  const results = [];
  const warnings = [];
  const perTool = new Map();
  let used = 0;
  let truncatedCount = 0;

  for (const req of list) {
    const tool = req?.tool;
    if (!allowedTools.includes(tool)) {
      warnings.push(`seat ${seat}: requested tool not allowed: ${tool} - rejected before invocation`);
      continue;
    }
    if (used >= cap) {
      truncatedCount += 1;
      continue;
    }
    used += 1;
    const idx = perTool.get(tool) || 0;
    perTool.set(tool, idx + 1);
    const result = rt(tool, req.args || {}, { cwd });
    results.push({ tool, args: req.args || {}, result, result_ref: `${tool}:${idx}` });
  }

  if (truncatedCount > 0) {
    warnings.push(`seat ${seat}: exceeded tool-request cap (${cap}) - ${truncatedCount} request(s) truncated`);
  }

  return { results, warnings, requested: list.length, used };
}
