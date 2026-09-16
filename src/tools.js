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
  const root = resolve(cwd);
  const args = ['--test'];
  if (file) {
    const target = sandboxPath(root, file);
    if (!existsSync(target)) return { ok: false, error: `no such file: ${file}` };
    args.push(target);
  }
  // Inside a packaged binary process.execPath is the council binary, not node, so `--test` would
  // reach the CLI instead of a test runner - use the node on PATH, which the target repo's own
  // tests need anyway.
  const res = spawnSync(process.pkg ? 'node' : process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60_000, shell: false });
  if (res.error) return { ok: false, error: String(res.error.message || res.error) };
  return {
    ok: res.status === 0,
    exitCode: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
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
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { return; }
    text.split('\n').forEach((line, i) => {
      if (re.test(line)) matches.push({ file: relative(root, path), line: i + 1, text: line });
    });
  };
  const start = file ? sandboxPath(root, file) : root;
  walk(start);
  return { ok: true, matches: matches.slice(0, 500) };
}

// read_file: { path } - returns the sandboxed file's raw text, truncated
// (flagged, not silently) past 200KB.
function read_file({ path } = {}, { cwd }) {
  if (!path) return { ok: false, error: 'read_file requires a path' };
  const root = resolve(cwd);
  const target = sandboxPath(root, path);
  if (!existsSync(target) || !statSync(target).isFile()) return { ok: false, error: `no such file: ${path}` };
  const { text, truncated } = readTextFile(target);
  return { ok: true, text, truncated };
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
    return { tool, args, ...result };
  } catch (err) {
    return { tool, args, ok: false, error: String(err.message || err) };
  }
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
