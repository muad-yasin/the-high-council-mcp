// A scripted terminal for the tree's gate tests (0.8.3 M5b): stdin and stdout report isTTY, and each answer is written only when the PREVIOUS prompt has been printed (readline per question would otherwise swallow the
// rest of a chunk), the way test/contract-cli.test.js drives its prompts. Not a test file.
import { PassThrough } from 'node:stream';

/** answers: the lines to type, in order. tty: false gives plain streams (no terminal). */
export function terminal(answers = [], { tty = true } = {}) {
  const stdin = new PassThrough(); const stdout = new PassThrough(); const stderr = new PassThrough();
  if (tty) { stdin.isTTY = true; stdin.setRawMode = () => {}; stdout.isTTY = true; }
  let shown = ''; let errs = ''; let next = 0;
  stdout.on('data', d => {
    shown += d;
    if (next < answers.length && /(?:\[y\/N\]|:) $/.test(shown)) { const a = answers[next++]; setImmediate(() => stdin.write(`${a}\n`)); }
  });
  stderr.on('data', d => { errs += d; });
  return { stdin, stdout, stderr, shown: () => shown, errors: () => errs, typed: () => next };
}
