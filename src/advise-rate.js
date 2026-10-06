// `council advise-rate <run folder> useful|not-useful|unclear [note]` (0.8.1 plan M5 Work 7, persistence register P7): the only
// supported way to write an advice run's `owner_rating`.
//
// Why a command. advise-log.json is the record the money guards read (src/advice-guards.js readLedger), and they fail closed on an
// entry they cannot parse: a JSON typo in a hand edit of the rating made every later advice call refuse. This writes the one field,
// atomically, and nothing else.
//
// Contract.
//   adviseRateCommand(args, { work, stdout, stderr }) -> exit code
//     0  written: owner_rating = { rating, note } with rating exactly "useful", "not useful" or "unclear" (OWNER_RATINGS)
//     1  the run's advise-log.json cannot be read or written (nothing is changed; a damaged file is left for a person to look at)
//     2  usage: no such run folder in <work>/runs, or a rating token other than useful, not-useful, unclear (nothing is written)
//   The command line says `not-useful` (one word for a shell); the stored value is the schema's "not useful".
//   A later rating replaces an earlier one. Nothing here reads or writes any other field.
import { closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ADVISE_LOG_FILE } from './advice-guards.js';
import { OWNER_RATINGS } from './advice-run.js';

const TOKENS = Object.freeze({ useful: 'useful', 'not-useful': 'not useful', unclear: 'unclear' });
// A note is a person's line or two about the advice, not a document: 500 characters.
const NOTE_MAX = 500;
const USAGE = 'usage: council advise-rate <run folder> useful|not-useful|unclear [note]';

function writeAtomic(path, text) {
  const tmp = `${path}.tmp-${process.pid}`;
  const fd = openSync(tmp, 'w');
  try { writeSync(fd, text); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, path);
}

export function adviseRateCommand(args, { work = process.cwd(), stdout = process.stdout, stderr = process.stderr } = {}) {
  const out = s => stdout.write(`${s}\n`);
  const err = s => stderr.write(`${s}\n`);
  const [runArg, token, ...noteWords] = args;
  if (!runArg || !token) { err(USAGE); return 2; }
  if (!Object.hasOwn(TOKENS, token)) { err(`advise-rate: "${token}" is not a rating; use useful, not-useful or unclear. Nothing was written.`); return 2; }
  const rating = TOKENS[token];
  if (!OWNER_RATINGS.includes(rating)) throw new Error(`advise-rate: ${rating} is not in OWNER_RATINGS`); // the two lists drifted
  const dir = resolve(work, runArg);
  if (dirname(dir) !== join(resolve(work), 'runs') || !existsSync(dir)) { err(`advise-rate: ${runArg} is not a run folder in ${join(work, 'runs')}. Nothing was written.`); return 2; }
  const p = join(dir, ADVISE_LOG_FILE);
  if (!existsSync(p)) { err(`advise-rate: ${runArg} has no ${ADVISE_LOG_FILE} (not an advice run, or it never started). Nothing was written.`); return 2; }
  // Control characters out of the note (it is shown in a terminal later); whitespace runs to one space.
  const note = noteWords.join(' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (note.length > NOTE_MAX) { err(`advise-rate: the note is ${note.length} characters; at most ${NOTE_MAX}. Nothing was written.`); return 2; }
  let log;
  try { log = JSON.parse(readFileSync(p, 'utf8')); } catch (e) { err(`advise-rate: ${ADVISE_LOG_FILE} in ${runArg} cannot be read (${e.message}); it is left as it is. Nothing was written.`); return 1; }
  if (!log || typeof log !== 'object' || Array.isArray(log)) { err(`advise-rate: ${ADVISE_LOG_FILE} in ${runArg} is not an advice record; it is left as it is. Nothing was written.`); return 1; }
  try { writeAtomic(p, `${JSON.stringify({ ...log, owner_rating: { rating, note } }, null, 2)}\n`); } catch (e) { err(`advise-rate: could not write ${p} (${e.code ?? e.message}).`); return 1; }
  out(`advise-rate: ${runArg} rated "${rating}"${note ? ` (note: ${note})` : ''}.`);
  return 0;
}
