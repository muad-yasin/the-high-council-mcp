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
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';

export const ALLOWED_TOOLS = Object.freeze(['run_tests', 'check_versions', 'grep_repo', 'read_file']);

// A path is "inside" root if, after resolving both, root is a prefix of it
// on a path-segment boundary. Rejects `..` escapes and absolute paths outside
// the workspace; does not touch the filesystem, so it also rejects symlink
// escapes at the string level (the resolved target still has to land inside).
function sandboxPath(root, requested) {
  const base = resolve(root);
  const target = resolve(base, requested ?? '.');
  const rel = relative(base, target);
  if (rel === '' ) return target;
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`path escapes workspace: ${requested}`);
  }
  return target;
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
  const res = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 60_000, shell: false });
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
  const root = resolve(cwd);
  let re;
  try { re = new RegExp(pattern); } catch (err) { return { ok: false, error: `bad pattern: ${err.message}` }; }
  const matches = [];
  const skip = new Set(['.git', 'node_modules']);
  const walk = path => {
    const st = statSync(path);
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
