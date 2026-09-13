// Prompt-file truncation integrity (v2 plan §10 Phase 2 item 4, DEEPSEEK-2 / GLM-2).
//
// Real incident: a 61,000-token NEEDS-<stage>.md was cut off when a driving session
// tried to read its own prompt back. The session could not see what it was actually
// being asked. That is a read/write correctness bug, independent of size or cost -
// this module closes it with a footer marker any generated prompt file carries, and
// a read-side check that raises a loud warning rather than silently proceeding when
// the marker is missing or doesn't match the actual content.
import { createHash } from 'node:crypto';

const FOOTER_RE = /\n<!-- INTEGRITY: lines=(\d+) bytes=(\d+) sha256=([0-9a-f]{12}) -->\n?$/;

export function fingerprint(content) {
  const lines = content.split('\n').length;
  const bytes = Buffer.byteLength(content, 'utf8');
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 12);
  return { lines, bytes, sha256 };
}

/** Append an integrity footer to `content`, computed over `content` itself (before the footer). */
export function withIntegrityFooter(content) {
  const { lines, bytes, sha256 } = fingerprint(content);
  return `${content}\n<!-- INTEGRITY: lines=${lines} bytes=${bytes} sha256=${sha256} -->\n`;
}

/**
 * Verify a file written by withIntegrityFooter(). Returns { ok: true } when the footer
 * is present and matches the body it's attached to, or { ok: false, warning } naming
 * exactly what's wrong (missing footer vs. a mismatched count/hash - the second is the
 * truncation/corruption signature, the first means this file predates the fix or was
 * never covered by it).
 */
export function verifyIntegrityFooter(fileContent) {
  const match = fileContent.match(FOOTER_RE);
  if (!match) {
    return { ok: false, warning: 'no integrity footer found - this file was not written with an integrity marker, or the marker itself was truncated away' };
  }
  const [footerLine, expectedLines, expectedBytes, expectedSha] = match;
  const body = fileContent.slice(0, fileContent.length - footerLine.length);
  const actual = fingerprint(body);
  if (String(actual.lines) !== expectedLines || String(actual.bytes) !== expectedBytes || actual.sha256 !== expectedSha) {
    return {
      ok: false,
      warning: `integrity footer does not match this file's actual content - it looks truncated or corrupted (expected lines=${expectedLines} bytes=${expectedBytes} sha256=${expectedSha}, got lines=${actual.lines} bytes=${actual.bytes} sha256=${actual.sha256})`,
    };
  }
  return { ok: true };
}
