// --context: which files the CLI reads, and reading each one safely.
//
// One list for the CLI (which reads the files) and the MCP server (which checks each one before it
// hands the path to the CLI), so the two cannot disagree about what a context folder contains.
// A folder contributes its *.md files except README.md, sorted by name; a file entry is itself.
//
// Security scan 2026-09-26 (THC #1, #10): a context entry was read with no size limit and with
// whatever readFileSync does on a FIFO or a device (block forever, or read without end). Every file
// is now opened non-blocking and checked on the open descriptor, so what is checked is what is read:
// a regular file of at most MAX_CONTEXT_FILE_BYTES, or a refusal naming the file.
import { openSync, fstatSync, readFileSync, closeSync, statSync, readdirSync, constants } from 'node:fs';
import { join } from 'node:path';

export const MAX_CONTEXT_FILE_BYTES = 2_000_000;

export class ContextFileError extends Error {}

// The files a --context value names, in the order the CLI appends them. `entries` is the
// comma-separated value, already resolved to absolute paths. Throws ContextFileError for an entry
// that does not exist.
export function contextFileList(entries) {
  const files = [];
  for (const entry of String(entries).split(',').map(x => x.trim()).filter(Boolean)) {
    let st;
    try { st = statSync(entry); } catch { throw new ContextFileError(`--context: no such file or folder: ${entry}`); }
    if (st.isDirectory()) {
      for (const f of readdirSync(entry).sort()) if (f.endsWith('.md') && f !== 'README.md') files.push(join(entry, f));
    } else files.push(entry);
  }
  return files;
}

// Reads one context file, refusing anything that is not a regular file within the size limit.
export function readContextFile(path, maxBytes = MAX_CONTEXT_FILE_BYTES) {
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0)); } catch (e) {
    throw new ContextFileError(`--context: cannot open ${path} (${e.code || e.message})`);
  }
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new ContextFileError(`--context: ${path} is not a regular file (a folder entry, FIFO or device is never read)`);
    if (st.size > maxBytes) throw new ContextFileError(`--context: ${path} is ${st.size} bytes, over the ${maxBytes}-byte limit per context file`);
    const text = readFileSync(fd, 'utf8');
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new ContextFileError(`--context: ${path} grew past the ${maxBytes}-byte limit while it was read`);
    return text;
  } finally { closeSync(fd); }
}
