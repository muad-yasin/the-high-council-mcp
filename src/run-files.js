// The one place the MCP server reads or writes a file inside a run folder (0.8.2 item 2; ChatGPT review 1, intake 2026-10-06, F1b/F1c; owner: all of it in 0.8.2).
//
// The threat: a cloned repository can ship runs/<id>/<file> or tasks/<name>.md as a symbolic link, and the MCP tools (read_run_file, run_status, external_prompt, plan_outline,
// list_runs, prepare_stage_prompt, submit_stage, write_task ...) then read or overwrite a file outside the folder the person meant. The harness itself NEVER creates a symbolic
// link in a run folder (grep symlinkSync src: nothing), so the rule is stricter than "stay inside the working directory" (jailRefusal in src/mcp/server.js, which would still let a
// link to .env's neighbour or to another run through, and whose gitignore check refuses every real run file because runs/ is gitignored):
//
//   1. runs/<id> must be a real directory (lstat, not a link) whose real path sits inside the real path of runs/ (runs/ itself may be a link: people move it to another disk).
//   2. Nothing inside it, to a depth of four, may be a symbolic link (a flat run folder plus gates/ and superseded/). One link refuses the whole run for every MCP tool, so the
//      modules the tools call (run-status.js, resume-brief.js, peer-claim.js ...) never see one.
//   3. Every file the server returns or writes is opened with O_NOFOLLOW where the platform has it (Linux, macOS), so a link planted after step 2 fails with ELOOP; on a
//      platform without it (Windows) the lstat in step 2 and in writeRunFile is the check.
//
// Reads return { text } | { missing: true } | { refusal }, never a throw; a refusal carries the words a person reads.
import { lstatSync, realpathSync, readdirSync, openSync, closeSync, fstatSync, readFileSync, writeFileSync, constants } from 'node:fs';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
// O_NONBLOCK: opening a FIFO for reading blocks until a writer appears (and for writing until a reader does), which would hang the server; with it the open returns at once and the
// regular-file check below refuses it. On a regular file it changes nothing. (Git cannot ship a FIFO, so this is a local-hardening case; the review found it.)
const NONBLOCK = constants.O_NONBLOCK ?? 0;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const MAX_DEPTH = 4;
const strictlyInside = (root, p) => { const r = relative(root, p); return r !== '' && r !== '..' && !r.startsWith(`..${sep}`) && !isAbsolute(r); };

/** The first symbolic link under `dir` (relative path), looking MAX_DEPTH levels down; null when there is none. */
export function firstSymlink(dir, depth = 0) {
  let names;
  // Fails closed (item 2 review): a folder that cannot be listed is reported as if it held a link, so the run is refused rather than trusted unseen.
  try { names = readdirSync(dir); } catch { return '(unreadable folder)'; }
  for (const n of names) {
    let st;
    try { st = lstatSync(join(dir, n)); } catch { continue; }
    if (st.isSymbolicLink()) return n;
    if (st.isDirectory() && depth < MAX_DEPTH - 1) { const inner = firstSymlink(join(dir, n), depth + 1); if (inner) return join(n, inner); }
  }
  return null;
}

/** { dir } for a run folder the server may touch, or { refusal } saying why not ("no such run" when there is none). `dir` is runsDir/run, as callers already build it. */
export function trustedRunDir(runsDir, run) {
  const dir = join(runsDir, run);
  let st;
  try { st = lstatSync(dir); } catch { return { refusal: 'no such run' }; }
  if (st.isSymbolicLink()) return { refusal: `refused: runs/${run} is a symbolic link, and the harness never creates one` };
  if (!st.isDirectory()) return { refusal: 'no such run' };
  try {
    if (!strictlyInside(realpathSync(runsDir), realpathSync(dir))) return { refusal: `refused: runs/${run} is outside runs/` };
  } catch { return { refusal: 'no such run' }; }
  const link = firstSymlink(dir);
  if (link) return { refusal: `refused: runs/${run}/${link} is a symbolic link, and the harness never creates one in a run folder (remove it, or look at the folder yourself)` };
  return { dir };
}

/** Text of runs/<id>/<name> (a plain file name, no path). */
export function readRunFile(dir, name) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name) || name === '.' || name === '..') return { refusal: 'bad file name' };
  // The lstat is the check where the platform has no O_NOFOLLOW (Windows); elsewhere O_NOFOLLOW closes the gap between this line and the open.
  try { if (lstatSync(join(dir, name)).isSymbolicLink()) return { refusal: `refused: ${name} is a symbolic link` }; } catch { /* absent: the open below says so */ }
  let fd;
  try { fd = openSync(join(dir, name), constants.O_RDONLY | NOFOLLOW | NONBLOCK); } catch (e) {
    if (e.code === 'ENOENT') return { missing: true };
    return { refusal: e.code === 'ELOOP' || e.code === 'EMLINK' ? `refused: ${name} is a symbolic link` : `unreadable: ${name} (${e.code})` };
  }
  try {
    if (!fstatSync(fd).isFile()) return { refusal: `refused: ${name} is not a regular file` };
    return { text: readFileSync(fd, 'utf8') };
  } catch (e) { return { refusal: `unreadable: ${name} (${e.code || e.message})` }; } finally { closeSync(fd); }
}

/** Parsed JSON of a run-folder file, or null when it is missing, refused or not JSON (the old readJson contract). */
export function readRunJson(dir, name) {
  const r = readRunFile(dir, name);
  if (r.text === undefined) return null;
  try { return JSON.parse(r.text); } catch { return null; }
}

/** Names in the run folder (never a path through a link: the caller has already passed trustedRunDir). */
export function listRunFiles(dir) {
  try { return readdirSync(dir); } catch { return []; }
}

/** Writes runs/<id>/<name>, replacing a regular file, never following a link. Returns {} or { refusal }. */
export function writeRunFile(dir, name, content) {
  if (typeof name !== 'string' || !SAFE_NAME.test(name) || name === '.' || name === '..') return { refusal: 'bad file name' };
  const p = join(dir, name);
  try { if (lstatSync(p).isSymbolicLink()) return { refusal: `refused: ${name} is a symbolic link, and nothing was written` }; } catch { /* absent: created below */ }
  let fd;
  try { fd = openSync(p, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | NOFOLLOW | NONBLOCK, 0o666); } catch (e) {
    return { refusal: e.code === 'ELOOP' || e.code === 'EMLINK' ? `refused: ${name} is a symbolic link, and nothing was written` : `could not write ${name} (${e.code})` };
  }
  try { writeFileSync(fd, content); return {}; } catch (e) { return { refusal: `could not write ${name} (${e.code || e.message})` }; } finally { closeSync(fd); }
}

/**
 * The text of the task file a run.json names, or a refusal. The path comes from run-folder DATA, so it is read only when it is a regular file inside `workDir`, the SERVER's own
 * working folder (never a folder the run.json names: run.json is as untrusted as the path inside it; the review of item 2 showed a hostile `cwd` widened the root to anywhere), by its
 * real path (a link out is refused), and not on the secret denylist (`isDenied`, src/tools.js). A task the person gave from elsewhere is simply not shown.
 */
export function readRecordedTask(taskPath, workDir, isDenied = () => false) {
  if (typeof taskPath !== 'string' || typeof workDir !== 'string' || !taskPath || !workDir) return { refusal: 'no recorded task path or working folder' };
  try {
    const root = realpathSync(workDir);
    const real = realpathSync(resolve(workDir, taskPath));
    if (!strictlyInside(root, real)) return { refusal: `refused: the task path in run.json is outside the working folder` };
    if (isDenied(relative(root, real)) || isDenied(real)) return { refusal: 'refused: the task path in run.json matches the secret denylist' };
    if (!lstatSync(real).isFile()) return { refusal: 'refused: the task path in run.json is not a regular file' };
    return { text: readFileSync(real, 'utf8') };
  } catch (e) { return e.code === 'ENOENT' ? { missing: true } : { refusal: `unreadable: the task path in run.json (${e.code || e.message})` }; }
}
