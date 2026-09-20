// `council fence` (2026-09-20). The cheap-7 run of that date asked seven labs about a
// codebase and showed them none of it: the pre-flight warned, the run proceeded, and the
// seats debated a repository they could not read. One of them converged on a claim about a
// directory that does not exist, and it survived to the deliverable.
//
// The fix had two candidate shapes. Give the seats a read tool, or give the human a way to
// put real source in front of them. This is the second, and the reason is not convenience:
// with a tool, what reaches a third-party lab is decided mid-run by a model; with a fence,
// it is decided beforehand by a person, and the task file is the exact, reviewable record of
// what left the machine. The operator is the filter.
//
// So this command does something deliberately dumb: it copies named files into the task,
// fenced and labelled, and then stops. It never chooses files, never follows imports, never
// summarises. Every byte it writes is a byte a human can read before anything is sent.
//
// The safety layers are src/tools.js's, reused rather than re-implemented - the denylist and
// the secret scan are the same code that guards the sandboxed tools, so there is one place
// where "a lab must never see this" is defined, not two that can drift.
import { readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { isDeniedPath, redactSecrets } from './tools.js';

// Per-file ceiling. A fenced file is read by a person before it is sent, and a 200KB paste
// is not read by anyone - it is scrolled past. Truncation is marked in the text so both the
// operator and the seats can see that what they have is partial.
export const FENCE_MAX_BYTES = 6_000;

const EXT_LANG = {
  cs: 'csharp', js: 'javascript', ts: 'typescript', jsx: 'jsx', tsx: 'tsx', py: 'python',
  rs: 'rust', go: 'go', java: 'java', rb: 'ruby', php: 'php', c: 'c', h: 'c',
  cpp: 'cpp', hpp: 'cpp', json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  xml: 'xml', sql: 'sql', sh: 'bash', bash: 'bash', ps1: 'powershell', md: 'markdown',
  html: 'html', css: 'css',
};

function langOf(path) {
  return EXT_LANG[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] || '';
}

// Same jail as src/tools.js's sandboxPath, including the symlink re-check: a link sitting
// inside the repo that points outside it resolves lexically to an inside path, so the
// string check alone is not enough and never was.
function jail(root, requested) {
  const base = realpathSync(resolve(root));
  const target = resolve(base, requested);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`refused: '${requested}' is outside the repository root`);
  }
  if (!existsSync(target)) throw new Error(`no such file: ${requested}`);
  const realTarget = realpathSync(target);
  const realRel = relative(base, realTarget);
  if (realRel.startsWith('..') || isAbsolute(realRel)) {
    throw new Error(`refused: '${requested}' escapes the repository via a symlink`);
  }
  if (!statSync(realTarget).isFile()) throw new Error(`not a file: ${requested}`);
  return { path: realTarget, rel: realRel.split(sep).join('/') };
}

/**
 * Build the fenced block for one file. Returns the text to append plus what happened to it,
 * so the caller can tell the operator exactly what is about to be sent - "it worked" is not
 * enough information when the consequence is source code reaching seven labs.
 */
export function fenceFile(root, requested) {
  const { path, rel } = jail(root, requested);
  if (isDeniedPath(rel)) {
    throw new Error(`refused: '${rel}' matches the secret/credential denylist - it is never fenced into a task`);
  }
  const raw = readFileSync(path);
  const truncated = raw.length > FENCE_MAX_BYTES;
  const body = raw.subarray(0, FENCE_MAX_BYTES).toString('utf8');
  const { text: safe, redacted } = redactSecrets(body);
  const note = truncated
    ? `\n[truncated: ${raw.length - FENCE_MAX_BYTES} of ${raw.length} bytes not shown]`
    : '';
  return {
    rel,
    bytes: raw.length,
    truncated,
    redacted,
    // The path is repeated inside the fence as well as in the heading: the artifact
    // pre-flight matches a filename against fenced text, and a seat reading the block
    // needs to know which file it is looking at without relying on the surrounding prose.
    text: `\n\n## ${rel}\n\n\`\`\`${langOf(rel)}\n// ${rel}\n${safe}${note}\n\`\`\`\n`,
  };
}

// Secret-pattern scan over the whole task text, run before a task is sent. This BLOCKS,
// where the artifact gate's equivalent only warns: an unfenced file costs a bad answer,
// while a fenced credential is unrecoverable the moment it is sent - it is on another
// company's servers, possibly in their logs, and rotating it is the only remedy.
//
// Reuses redactSecrets rather than defining a second pattern set, so a pattern added for
// the sandboxed tools protects the fence path too, automatically.
export function scanTaskForSecrets(text) {
  const { redacted } = redactSecrets(text || '');
  if (!redacted) return { clean: true, hits: 0 };
  return {
    clean: false,
    hits: redacted,
    message: `refusing to proceed: the task text contains ${redacted} value(s) matching a credential pattern. `
      + 'Everything in a task file is sent to every seat, and therefore to every lab behind them. '
      + 'Remove the value (a placeholder is fine) and rotate it if it was ever real.',
  };
}

/**
 * The header written above the first fenced block, once per task. It tells the seats what
 * the fenced text is and - more importantly - what it is not: a partial, human-chosen slice,
 * not the repository. A seat that believes it has seen the codebase will reason as if the
 * absence of something is evidence it does not exist, which is the failure this whole
 * command exists to prevent, one step removed.
 */
export const FENCE_HEADER = `

# Source, fenced verbatim

The blocks below are real file contents from the repository this task is about, pasted by a
human before this run started. They are the only source you can see.

This is a hand-picked, partial slice - not the repository, and not necessarily every relevant
file. Do not infer that something does not exist because it is not here. A file may also be
truncated, which is marked inside its block.

Cite these blocks when you make a claim about the code. If a claim cannot be checked against
what is shown here, say so and mark it UNVERIFIED rather than asserting it.
`;
